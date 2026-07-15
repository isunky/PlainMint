import type {
  DocumentRecord,
  EditorTab,
  PaneId,
  StartupStatus,
  UserSettings,
  WorkspaceSession,
} from "./types";

export type StartupDecision = "restore" | "ask" | "empty";

export function decideStartupRecovery(
  mode: UserSettings["sessionRecoveryMode"],
  status: StartupStatus,
  session: WorkspaceSession | null,
  explicitPreviewState = false,
): StartupDecision {
  if (explicitPreviewState || mode === "empty" || !session) return "empty";
  const hasRecoverableWork = session.documents.some((document) =>
    Boolean(document.filePath) || document.content.length > 0,
  );
  if (mode === "ask" && status.previousExitWasUnclean && hasRecoverableWork) return "ask";
  return "restore";
}

export function createWorkspaceSession(
  state: {
    split: boolean;
    activeTab: Record<PaneId, string | null>;
    tabs: Record<PaneId, EditorTab[]>;
    documents: Record<string, DocumentRecord>;
  },
  discardDirty = false,
): WorkspaceSession {
  const documents = Object.values(state.documents)
    .filter((document) => !discardDirty || !document.dirty)
    .map(({ patch: _patch, ...document }) => document);
  const documentIds = new Set(documents.map((document) => document.id));
  const tabsFor = (pane: PaneId) => state.tabs[pane]
    .filter((tab) => documentIds.has(tab.documentId))
    .map((tab, order) => ({ ...tab, order }));
  const tabs = { left: tabsFor("left"), right: tabsFor("right") };
  const activeFor = (pane: PaneId) => tabs[pane].some((tab) => tab.id === state.activeTab[pane])
    ? state.activeTab[pane]
    : tabs[pane][0]?.id ?? null;
  return {
    savedAt: Date.now(),
    split: Boolean(state.split && tabs.right.length),
    activeTab: { left: activeFor("left"), right: activeFor("right") },
    tabs,
    documents,
  };
}
