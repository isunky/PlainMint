import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../store";
import type { DocumentRecord } from "../types";
import { pasteTextInPane, TextEditor } from "./TextEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function documentRecord(content: string): DocumentRecord {
  return {
    id: "column-editing",
    fileName: "column-editing.txt",
    content,
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: true,
    dirty: false,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: 1,
  };
}

function renderEditor(content = "alpha\nbeta\ngamma") {
  const onCursor = vi.fn();
  const result = render(
    <TextEditor
      pane="left"
      document={documentRecord(content)}
      settings={defaultSettings}
      searchState={{ open: false, replaceOpen: false, scope: "document", query: "", replacement: "", caseSensitive: false, wholeWord: false, regexp: false }}
      onChange={vi.fn()}
      onCursor={onCursor}
      onFocus={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onRevealHandled={vi.fn()}
    />,
  );
  const editor = result.container.querySelector<HTMLElement>(".cm-editor");
  if (!editor) throw new Error("Expected a CodeMirror editor");
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error("Expected a CodeMirror view");
  return { ...result, onCursor, view };
}

afterEach(cleanup);

describe("TextEditor column editing", () => {
  it("enables Alt-drag rectangular selection and shows a crosshair while Alt is pressed", () => {
    const { view } = renderEditor();

    expect(view.state.facet(EditorView.mouseSelectionStyle)).toHaveLength(1);
    fireEvent.keyDown(view.contentDOM, { key: "Alt", keyCode: 18, altKey: true });
    expect(view.contentDOM.style.cursor).toBe("crosshair");
    fireEvent.keyUp(view.contentDOM, { key: "Alt", keyCode: 18 });
    expect(view.contentDOM.style.cursor).toBe("");
  });

  it("distributes matching pasted lines across column selections and reports their total size", () => {
    const { onCursor, view } = renderEditor("alpha\nbeta\ngamma");
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(1, 3),
        EditorSelection.range(7, 9),
        EditorSelection.range(12, 14),
      ]),
    });

    expect(onCursor).toHaveBeenLastCalledWith(1, 4, 6);
    expect(pasteTextInPane("left", "X\nY\nZ")).toBe(true);
    expect(view.state.doc.toString()).toBe("aXha\nbYa\ngZma");
  });

  it("inserts the full clipboard text into every selection when its line count differs", () => {
    const { view } = renderEditor("alpha\nbeta");
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(1, 3),
        EditorSelection.range(7, 9),
      ]),
    });

    expect(pasteTextInPane("left", "X\nY\nZ")).toBe(true);
    expect(view.state.doc.toString()).toBe("aX\nY\nZha\nbX\nY\nZa");
  });
});
