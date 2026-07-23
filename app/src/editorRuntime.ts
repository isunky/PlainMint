import type { PaneId } from "./types";
import type { TextCleanupAction } from "./textCleanup";

type TextEditorModule = typeof import("./components/TextEditor");

let loadedModule: TextEditorModule | undefined;
let loadingModule: Promise<TextEditorModule> | undefined;

export function loadTextEditor(): Promise<TextEditorModule> {
  if (loadedModule) return Promise.resolve(loadedModule);
  loadingModule ??= import("./components/TextEditor")
    .then((module) => {
      loadedModule = module;
      return module;
    })
    .catch((error) => {
      loadingModule = undefined;
      throw error;
    });
  return loadingModule;
}

export function findNextInPane(pane: PaneId) {
  return loadedModule?.findNextInPane(pane) ?? false;
}

export function findPreviousInPane(pane: PaneId) {
  return loadedModule?.findPreviousInPane(pane) ?? false;
}

export function focusEditor(pane: PaneId) {
  loadedModule?.focusEditor(pane);
}

export function goToLineInPane(pane: PaneId) {
  return loadedModule?.goToLineInPane(pane) ?? false;
}

export function replaceCurrentSearchMatchInPane(pane: PaneId, match: { from: number; to: number }) {
  return loadedModule?.replaceCurrentSearchMatchInPane(pane, match) ?? false;
}

export function replaceAllSearchMatchesInPane(pane: PaneId) {
  return loadedModule?.replaceAllSearchMatchesInPane(pane) ?? false;
}

export function cleanupTextInPane(pane: PaneId, action: TextCleanupAction, locale: string) {
  return loadedModule?.cleanupTextInPane(pane, action, locale) ?? false;
}

export function selectedTextInPane(pane: PaneId) { return loadedModule?.selectedTextInPane(pane) ?? ""; }
export function cutSelectionInPane(pane: PaneId) { return loadedModule?.cutSelectionInPane(pane) ?? ""; }
export function pasteTextInPane(pane: PaneId, text: string) { return loadedModule?.pasteTextInPane(pane, text) ?? false; }
export function selectAllInPane(pane: PaneId) { return loadedModule?.selectAllInPane(pane) ?? false; }
