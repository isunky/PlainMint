import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isAutoSaveEligible } from "./autoSavePolicy";
import type { CloudDraft, Journal, Snapshot } from "./cloudWorkspace";
import { useAppStore } from "./store";
import { useCloudWorkspace } from "./useCloudWorkspace";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./services/runtime", () => ({ isTauri: () => true }));

const root = "D:\\OneDrive";
const peer = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const openPath = "folder/sample.txt";
const fingerprint = { hash: "base", size: 4, modifiedAt: 1 };
const body = { content: "未保存的修改", fileName: "sample.txt", encoding: "utf-8", lineEnding: "lf", fingerprint } as const;
let remote: Snapshot;
let journal: Journal | null;
let stamp: number;
let offline: boolean;
let writes: Snapshot[];

const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const docs = () => Object.values(useAppStore.getState().documents);

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  useAppStore.setState({ documents: {}, histories: {}, tabs: { left: [], right: [] }, activeTab: { left: null, right: null }, activePane: "left", split: false });
  remote = { version: 1, files: [], drafts: [], resolved: [] };
  journal = null;
  writes = [];
  stamp = 1;
  offline = false;
  invoke.mockReset().mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "load_cloud_journal") return structuredClone(journal);
    if (command === "save_cloud_journal") journal = structuredClone(args.journal as Journal);
    if (command === "write_cloud_workspace") {
      if (offline) throw new Error("offline");
      writes.push(structuredClone(args.snapshot as Snapshot));
    }
    if (command === "read_cloud_workspace") {
      const name = `${peer}.json`;
      return [{ name, stamp: String(stamp), snapshot: (args.known as Record<string, string>)[name] === String(stamp) ? null : remote, unreadable: false }];
    }
    if (command === "open_cloud_document") return { ...body, content: "disk", name: "sample.txt", path: `${args.root}\\folder\\sample.txt`, readOnly: false };
  });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("writes an untitled draft after idle, persists failed writes locally, and retries after restart", async () => {
  offline = true;
  const first = renderHook(() => useCloudWorkspace(root, true));
  await tick(0);
  const id = useAppStore.getState().createDocument("left", { fileName: "草稿.txt", content: "还没有保存" });
  await tick(999);
  expect(journal).toBeNull();
  await tick(1);
  expect(writes).toEqual([]);
  expect(journal).toMatchObject({ pending: true, entries: { [id]: { body: { content: "还没有保存" } } } });
  first.unmount();
  useAppStore.setState({ documents: {}, tabs: { left: [], right: [] }, activeTab: { left: null, right: null } });
  offline = false;
  renderHook(() => useCloudWorkspace(root, true));
  await tick(0);
  expect(docs()).toEqual([expect.objectContaining({ id, content: "还没有保存", dirty: true })]);
  expect(writes).toEqual([expect.objectContaining({ files: [], drafts: [expect.objectContaining({ id: `draft:${id}` })] })]);
  expect(journal).toMatchObject({ pending: false });
});

it("heals a draft without stealing focus, preserves concurrent content, and deduplicates retries", async () => {
  const original = useAppStore.getState().createDocument("left");
  const activeTab = useAppStore.getState().activeTab.left;
  const draft: CloudDraft = { id: `file:${openPath}`, clock: { [peer]: 1 }, path: openPath, body };
  remote.drafts = [draft];
  remote.files = [openPath];
  renderHook(() => useCloudWorkspace(root, true));
  await tick(0);
  const linked = docs().find((document) => document.id !== original)!;
  expect(linked).toMatchObject({ content: body.content, dirty: true, fingerprint, externalModified: false });
  expect(isAutoSaveEligible(linked)).toBe(false);
  expect(useAppStore.getState().activeTab.left).toBe(activeTab);
  useAppStore.setState((state) => ({ documents: { ...state.documents, [linked.id]: { ...linked, content: "本机继续编辑", revision: linked.revision + 1 } } }));
  remote.drafts = [{ ...draft, clock: { [peer]: 2 }, body: { ...body, content: "远端继续编辑" } }];
  stamp++;
  await tick(30_000);
  expect(docs().find((document) => document.id === linked.id)?.content).toBe("本机继续编辑");
  expect(docs().filter((document) => document.content === "远端继续编辑")).toEqual([expect.objectContaining({ filePath: undefined, dirty: true })]);
  await tick(30_000);
  expect(docs()).toHaveLength(3);
  expect(useAppStore.getState().activeTab.left).toBe(activeTab);
});

it("does not reopen manually closed files or resurrect the discarded draft on a later poll", async () => {
  remote.files = [openPath];
  remote.drafts = [{ id: `file:${openPath}`, clock: { [peer]: 1 }, path: openPath, body }];
  renderHook(() => useCloudWorkspace(root, true));
  await tick(0);
  useAppStore.getState().closeTab("left", useAppStore.getState().tabs.left[0].id);
  await tick(30_000);
  expect(docs()).toHaveLength(0);
  expect(writes.at(-1)?.resolved).toEqual([{ id: `file:${openPath}`, clock: { [peer]: 1 } }]);
});

it("refreshes untouched imported drafts and ignores corrupt peer snapshots", async () => {
  const draft: CloudDraft = { id: "draft:peer", clock: { [peer]: 1 }, body };
  remote.drafts = [draft];
  const { result } = renderHook(() => useCloudWorkspace(root, true));
  await tick(0);
  const id = docs()[0].id;
  remote.drafts = [{ ...draft, clock: { [peer]: 2 }, body: { ...body, content: "第二版" } }];
  stamp++;
  await tick(30_000);
  expect(docs()).toEqual([expect.objectContaining({ id, content: "第二版" })]);
  remote = { ...remote, files: ["../private"] };
  stamp++;
  await tick(30_000);
  expect(docs()).toEqual([expect.objectContaining({ id, content: "第二版" })]);
  expect(result.current.status.key).toBe("cloudSyncWaiting");
});

it("checkpoints continuous editing at five seconds and retires a draft after saving", async () => {
  renderHook(() => useCloudWorkspace(root, true));
  await tick(0);
  const id = useAppStore.getState().createDocument("left", { fileName: "draft.txt", content: "start" });
  for (let revision = 1; revision <= 5; revision++) {
    await tick(800);
    useAppStore.setState((state) => ({
      documents: { ...state.documents, [id]: { ...state.documents[id], content: `edit ${revision}`, revision } },
    }));
  }
  await tick(800);
  useAppStore.setState((state) => ({
    documents: { ...state.documents, [id]: { ...state.documents[id], content: "latest", revision: 6 } },
  }));
  await tick(199);
  expect(writes).toHaveLength(0);
  await tick(1);
  expect(writes[0].drafts[0].body.content).toBe("latest");
  useAppStore.getState().markSaved(id, "D:\\OneDrive\\draft.txt", 6, fingerprint);
  await tick(1_000);
  expect(writes.at(-1)).toMatchObject({ files: ["draft.txt"], drafts: [], resolved: [expect.objectContaining({ id: `draft:${id}` })] });
});
