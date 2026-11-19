import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  dominates, draftBody, emptyJournal, incomingDrafts, isJournal, isSnapshot,
  recordResolution, relativeCloudPath, sameBody, scopeKey,
  type CloudDraft, type Journal, type Snapshot,
} from "./cloudWorkspace";
import { detectLanguage } from "./languageMetadata";
import i18n from "./i18n";
import { isTauri } from "./services/runtime";
import { useAppStore } from "./store";
import type { DocumentRecord, OpenedDocument } from "./types";

type Status = { key: "cloudSyncReady" | "cloudSyncWaiting" | "cloudSyncWritten" | "cloudSyncError"; detail?: string };
type Peer = { name: string; stamp: string; snapshot: unknown; unreadable: boolean };
type Documents = Record<string, DocumentRecord>;
const deviceKey = "plainmint.cloud-workspace.device";

function deviceId() {
  const existing = window.localStorage.getItem(deviceKey);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(deviceKey, id);
  return id;
}

export function useCloudWorkspace(root: string | undefined, hydrated: boolean) {
  const [status, setStatus] = useState<Status>({ key: "cloudSyncWaiting" });
  const flushRef = useRef<(discarded?: ReadonlySet<string>) => Promise<void>>(async () => {});
  const formerScope = useRef<string | undefined>(undefined);
  const excluded = useRef(new Map<string, string>());

  useEffect(() => {
    if (!root || !hydrated || !isTauri()) return;
    const scope = scopeKey(root);
    if (formerScope.current && formerScope.current !== scope) {
      for (const id of Object.keys(useAppStore.getState().documents)) {
        if (!excluded.current.has(id)) excluded.current.set(id, formerScope.current);
      }
    }
    formerScope.current = scope;
    let active = true;
    let applying = false;
    let journal: Journal | undefined;
    let pendingWrite = false;
    let needsJournal = false;
    let requested = false;
    let wrote = false;
    let exiting = false;
    let busy: Promise<void> | undefined;
    let timer: number | undefined;
    let deadline: number | undefined;
    const closed = new Map<string, DocumentRecord>();
    const cache = new Map<string, { stamp: string; snapshot: Snapshot }>();
    const previouslyOpened = new Set<string>();
    let device: string;
    try {
      device = deviceId();
    } catch {
      setStatus({ key: "cloudSyncError" });
      return;
    }
    setStatus({ key: "cloudSyncWaiting" });

    const relative = (path?: string) => path ? relativeCloudPath(root, path) : undefined;
    const pathKey = (path: string) => /^[a-z]:|^\/\//i.test(scope) ? path.toLowerCase() : path;
    const accepts = (document: DocumentRecord) => (!excluded.current.has(document.id) || excluded.current.get(document.id) === scope)
      && (!document.cloudDraftScope || document.cloudDraftScope === scope)
      && (!document.cloudDraft || document.cloudDraft.scope === scope);
    const project = (document: DocumentRecord, previous?: CloudDraft) => {
      const path = relative(document.filePath);
      if (!accepts(document) || (document.filePath && !path)
        || (!document.filePath && !document.content && !previous && !document.cloudDraft)
        || (document.filePath && !document.dirty)) return undefined;
      const metadata = document.cloudDraft;
      const id = path ? `file:${path}` : metadata?.id ?? `draft:${document.id}`;
      const body = draftBody(document);
      if (previous && previous.id === id && previous.path === path && sameBody(previous.body, body)) return previous;
      if (metadata?.importedRevision === document.revision && !previous) return undefined;
      const base = previous?.id === id ? previous.clock : metadata?.id === id ? metadata.clock : {};
      const sequence = Math.max(journal!.sequence, base[device] ?? 0) + 1;
      journal!.sequence = sequence;
      return { id, path, body, clock: { ...base, [device]: sequence } };
    };

    const capture = (documents: Documents) => {
      if (!journal) return;
      const record = journal;
      const retire = (document: DocumentRecord) => {
        if (!accepts(document)) return;
        const previous = record.entries[document.id];
        const current = project(document, previous);
        const marker = current ?? previous ?? document.cloudDraft;
        if (marker) {
          record.resolved = recordResolution(record.resolved, { id: marker.id, clock: marker.clock });
          delete record.entries[document.id];
          delete record.revisions[document.id];
          pendingWrite = needsJournal = true;
        }
      };
      for (const document of closed.values()) {
        if (documents[document.id]) continue;
        retire(document);
        const path = relative(document.filePath);
        if (path !== undefined && !record.dismissed.includes(pathKey(path))) {
          record.dismissed.push(pathKey(path));
          needsJournal = true;
        }
      }
      closed.clear();
      for (const document of Object.values(documents)) {
        const previous = record.entries[document.id];
        const path = relative(document.filePath);
        if (path) {
          const key = pathKey(path);
          if (!previouslyOpened.has(key) && record.dismissed.includes(key)) {
            record.dismissed = record.dismissed.filter((entry) => entry !== key);
            needsJournal = true;
          }
        }
        const draft = project(document, previous);
        if (draft && draft !== previous) {
          if (previous && previous.id !== draft.id) {
            record.resolved = recordResolution(record.resolved, { id: previous.id, clock: previous.clock });
          }
          record.entries[document.id] = draft;
          record.revisions[document.id] = document.revision;
          pendingWrite = needsJournal = true;
          // Keep draft bodies bound to the directory they were first queued for.
          if (!document.cloudDraft) {
            applying = true;
            useAppStore.setState((state) => ({
              documents: { ...state.documents, [document.id]: {
                ...document, cloudDraft: { scope, id: draft.id, clock: draft.clock },
              } },
            }));
            applying = false;
          }
        } else if (!draft && (!document.dirty || (document.filePath && !path)) &&
          (previous || (document.cloudDraft?.importedRevision !== undefined
            && !record.resolved.some((item) => item.id === document.cloudDraft?.id
              && dominates(item.clock, document.cloudDraft.clock))))) {
          retire(document);
        }
      }
      const files = [...new Set(Object.values(documents).flatMap((document) => {
        const path = relative(document.filePath);
        return path ? [path] : [];
      }))].sort();
      previouslyOpened.clear();
      files.forEach((path) => previouslyOpened.add(pathKey(path)));
      if (files.join("\0") !== record.files.join("\0")) {
        record.files = files;
        pendingWrite = needsJournal = true;
      }
    };

    const upsert = (id: string, document: DocumentRecord) => {
      applying = true;
      try {
        useAppStore.setState((state) => {
          if (state.documents[id]) {
            const histories = { ...state.histories };
            delete histories[id];
            return { documents: { ...state.documents, [id]: document }, histories };
          }
          const pane = "left";
          const tab = { id: `tab-${crypto.randomUUID()}`, documentId: id, pane, order: state.tabs.left.length } as const;
          return {
            documents: { ...state.documents, [id]: document },
            tabs: { ...state.tabs, left: [...state.tabs.left, tab] },
            activeTab: state.activeTab.left ? state.activeTab : { ...state.activeTab, left: tab.id },
          };
        });
      } finally {
        applying = false;
      }
    };

    const open = (path: string) => invoke<OpenedDocument>("open_cloud_document", { root, relative: path });
    const findPath = (path: string) => Object.values(useAppStore.getState().documents).find((document) => {
      const candidate = relative(document.filePath);
      return candidate && pathKey(candidate) === pathKey(path);
    });
    const makeDocument = (id: string, body: CloudDraft["body"], opened?: OpenedDocument): DocumentRecord => ({
      id, fileName: opened?.name ?? body.fileName, filePath: opened?.path,
      content: body.content, encoding: body.encoding, lineEnding: body.lineEnding,
      fingerprint: body.fingerprint ?? opened?.fingerprint, revision: 0, createdAt: Date.now(),
      languageMode: "auto", detectedLanguage: detectLanguage(opened?.name ?? body.fileName, body.content),
      autoLanguageDetectionComplete: true, readOnly: Boolean(opened?.readOnly),
      missing: false, dirty: false, externalModified: false,
    });

    const restoreJournalDrafts = async (record: Journal) => {
      for (const [id, draft] of Object.entries(record.entries)) {
        if (record.resolved.some((item) => item.id === draft.id && dominates(item.clock, draft.clock))) continue;
        const before = useAppStore.getState().documents[id];
        const revision = record.revisions[id] ?? 0;
        if (before && (before.revision >= revision || (before.filePath && !before.dirty))) continue;
        let opened: OpenedDocument | undefined;
        if (draft.path && !before?.filePath) {
          try { opened = await open(draft.path); } catch { continue; }
        }
        if (!active || exiting || useAppStore.getState().documents[id] !== before || closed.has(id)) continue;
        const document = makeDocument(id, draft.body, opened);
        upsert(id, {
          ...document, revision, dirty: true,
          filePath: before?.filePath ?? document.filePath,
          untitledNumber: before?.untitledNumber,
          readOnly: before?.readOnly ?? document.readOnly,
          externalModified: Boolean(before?.externalModified
            || (opened && !draft.body.fingerprint)
            || (opened && opened.fingerprint?.hash !== draft.body.fingerprint?.hash)),
          cloudDraft: { scope, id: draft.id, clock: draft.clock, importedRevision: revision },
        });
      }
    };

    const receive = async (snapshots: Snapshot[]) => {
      let unavailable = false;
      const record = journal!;
      for (const draft of incomingDrafts(snapshots, record.resolved)) {
        if (!active || exiting) break;
        // Do not await disk IO until the draft has passed version/dismissal checks.
        let opened: OpenedDocument | undefined;
        const path = draft.path;
        if (path && !Object.values(useAppStore.getState().documents).some((document) => {
          const marker = record.entries[document.id] ?? document.cloudDraft;
          return marker?.id === draft.id && dominates(marker.clock, draft.clock);
        })) {
          try {
            opened = await open(path);
          } catch {
            unavailable = true;
            continue;
          }
        }
        if (!active || exiting) break;
        capture(useAppStore.getState().documents);
        if (record.resolved.some((item) => item.id === draft.id && dominates(item.clock, draft.clock))) continue;
        const variants = Object.values(useAppStore.getState().documents).filter((document) => {
          const marker = record.entries[document.id] ?? document.cloudDraft;
          return accepts(document) && marker?.id === draft.id;
        });
        const marker = (document: DocumentRecord) => (record.entries[document.id] ?? document.cloudDraft)!;
        if (variants.some((document) => dominates(marker(document).clock, draft.clock))) continue;
        const successor = variants.find((document) => dominates(draft.clock, marker(document).clock));
        const existing = path ? findPath(path) : undefined;
        const trustedBase = !path || Boolean(draft.body.fingerprint);
        const target = (trustedBase || !successor?.filePath ? successor : undefined)
          ?? (trustedBase && !variants.length && !existing?.dirty ? existing : undefined);
        const conflict = !target && Boolean(variants.length || existing?.dirty);
        const detached = conflict || !trustedBase || Boolean(path && successor && !successor.filePath);
        const id = target?.id ?? `doc-${crypto.randomUUID()}`;
        const revision = (target?.revision ?? -1) + 1;
        const document = makeDocument(id, draft.body, detached ? undefined : opened);
        if (detached) document.fileName = target?.fileName ?? i18n.t("cloudConflictCopy", { name: draft.body.fileName });
        if (record.entries[id]) {
          delete record.entries[id];
          delete record.revisions[id];
          pendingWrite = needsJournal = true;
        }
        upsert(id, {
          ...document, revision, dirty: true,
          externalModified: Boolean(opened && !detached
            && (!draft.body.fingerprint || opened.fingerprint?.hash !== draft.body.fingerprint.hash)),
          cloudDraft: { scope, id: draft.id, clock: draft.clock, importedRevision: revision },
        });
      }

      for (const path of new Set(snapshots.flatMap((snapshot) => snapshot.files))) {
        if (!active || exiting) break;
        capture(useAppStore.getState().documents);
        if (record.dismissed.includes(pathKey(path)) || findPath(path)) continue;
        try {
          const opened = await open(path);
          if (!active || exiting) continue;
          capture(useAppStore.getState().documents);
          if (record.dismissed.includes(pathKey(path)) || findPath(path)) continue;
          const id = `doc-${crypto.randomUUID()}`;
          upsert(id, makeDocument(id, { ...opened, fileName: opened.name }, opened));
        } catch {
          unavailable = true;
        }
      }
      return unavailable;
    };

    const saveJournal = async () => {
      if (!needsJournal || !journal) return;
      await invoke("save_cloud_journal", { scope, journal: { ...journal, pending: pendingWrite } });
      needsJournal = false;
    };

    const cycle = async () => {
      if (!journal) {
        const value = await invoke<unknown>("load_cloud_journal", { scope });
        if (!active) return;
        if (value !== null && !isJournal(value)) throw new Error("Invalid local OneDrive journal");
        journal = value ?? emptyJournal();
        pendingWrite = journal.pending;
        if (!exiting) await restoreJournalDrafts(journal);
      }
      if (!active || exiting) return;
      capture(useAppStore.getState().documents);
      await saveJournal();
      if (!active) return;
      if (pendingWrite) {
        const snapshot: Snapshot = {
          version: 1, files: journal.files, drafts: Object.values(journal.entries), resolved: journal.resolved,
        };
        await invoke("write_cloud_workspace", { root, device, snapshot });
        wrote = true;
        pendingWrite = false;
        needsJournal = true;
        await saveJournal();
        if (!active) return;
        setStatus({ key: "cloudSyncWritten" });
      }
      if (!requested || !active || exiting) return;
      requested = false;
      const peers = await invoke<Peer[]>("read_cloud_workspace", {
        root, device, known: Object.fromEntries([...cache].map(([name, peer]) => [name, peer.stamp])),
      });
      if (!active || exiting) return;
      const next = new Map<typeof peers[number]["name"], { stamp: string; snapshot: Snapshot }>();
      let bad = false;
      for (const peer of peers) {
        const last = cache.get(peer.name);
        if (last?.stamp === peer.stamp) next.set(peer.name, last);
        else if (!peer.unreadable && isSnapshot(peer.snapshot)) {
          next.set(peer.name, { stamp: peer.stamp, snapshot: peer.snapshot });
        } else {
          bad = true;
          if (last) next.set(peer.name, last);
        }
      }
      cache.clear();
      next.forEach((peer, name) => cache.set(name, peer));
      const snapshots = [...cache.values()].map(({ snapshot }) => snapshot);
      for (const item of snapshots.flatMap((snapshot) => snapshot.resolved)) {
        const updated = recordResolution(journal.resolved, item);
        if (updated !== journal.resolved) {
          journal.resolved = updated;
          needsJournal = true;
        }
      }
      const unavailable = await receive(snapshots);
      if (!active) return;
      await saveJournal();
      if (active) setStatus({ key: bad || unavailable ? "cloudSyncWaiting" : wrote ? "cloudSyncWritten" : "cloudSyncReady" });
    };

    const clearSchedule = () => {
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      timer = deadline = undefined;
    };
    const run = () => {
      if (!active) return Promise.resolve();
      if (busy) return busy;
      clearSchedule();
      busy = cycle().catch((error: unknown) => {
        if (active) setStatus({
          key: "cloudSyncError",
          detail: error instanceof Error ? error.message : (error as { details?: string } | null)?.details,
        });
      }).finally(() => { busy = undefined; });
      return busy;
    };
    const schedule = () => {
      window.clearTimeout(timer);
      const fire = () => {
        clearSchedule();
        void (busy ? busy.then(run) : run());
      };
      timer = window.setTimeout(fire, 1_000);
      deadline ??= window.setTimeout(fire, 5_000);
    };
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (applying || exiting || state.documents === previous.documents) return;
      for (const document of Object.values(previous.documents)) {
        if (!state.documents[document.id]) closed.set(document.id, document);
      }
      schedule();
    });
    const poll = () => {
      if (exiting) return;
      requested = true;
      void (busy ? busy.then(run) : run());
    };
    const interval = window.setInterval(poll, 30_000);
    window.addEventListener("focus", poll);
    const startup = window.setTimeout(poll, 0);
    flushRef.current = async (discarded) => {
      exiting = true;
      clearSchedule();
      try {
        await busy;
        if (!active) return;
        if (!journal) {
          const value = await invoke<unknown>("load_cloud_journal", { scope });
          if (!active) return;
          if (value !== null && !isJournal(value)) throw new Error("Invalid local OneDrive journal");
          journal = value ?? emptyJournal();
          pendingWrite = journal.pending;
        }
        const documents = { ...useAppStore.getState().documents };
        for (const id of discarded ?? []) {
          if (documents[id]) closed.set(id, documents[id]);
          delete documents[id];
        }
        capture(documents);
        // Do not recapture tabs being explicitly discarded on exit.
        await saveJournal();
        if (active && pendingWrite) {
          await invoke("write_cloud_workspace", {
            root, device,
            snapshot: { version: 1, files: journal.files, drafts: Object.values(journal.entries), resolved: journal.resolved },
          });
          pendingWrite = false;
          needsJournal = true;
          await saveJournal();
        }
      } finally {
        exiting = false;
      }
    };
    return () => {
      active = false;
      unsubscribe();
      clearSchedule();
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener("focus", poll);
      flushRef.current = async () => {};
    };
  }, [root, hydrated]);

  return { status, flushRef };
}
