import type { PaneId } from "./types";

type TextEditorModule = typeof import("./components/TextEditor");

let loadedModule: TextEditorModule | undefined;
let loadingModule: Promise<TextEditorModule> | undefined;

export function loadTextEditor(): Promise<TextEditorModule> {
  if (loadedModule) return Promise.resolve(loadedModule);
  loadingModule ??= import("./components/TextEditor").then((module) => {
    loadedModule = module;
    return module;
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
