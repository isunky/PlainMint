import { useEffect, useLayoutEffect, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  type ChangeSet,
} from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  SearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search";
import type { DocumentRecord, PaneId, SearchState, UserSettings } from "../types";

const externalSync = Annotation.define<boolean>();
const editors: Partial<Record<PaneId, EditorView>> = {};

export function findNextInPane(pane: PaneId) {
  const view = editors[pane];
  if (view) return findNext(view);
  return false;
}

export function findPreviousInPane(pane: PaneId) {
  const view = editors[pane];
  if (view) return findPrevious(view);
  return false;
}

export function focusEditor(pane: PaneId) {
  editors[pane]?.focus();
}

interface TextEditorProps {
  pane: PaneId;
  document: DocumentRecord;
  settings: UserSettings;
  searchState: SearchState;
  onChange: (changes: ChangeSet, origin: string) => void;
  onCursor: (line: number, column: number, selected: number) => void;
  onFocus: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

function editorTheme(settings: UserSettings) {
  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: settings.fontSize + "px",
      backgroundColor: "var(--surface-editor)",
      color: "var(--text-primary)",
    },
    ".cm-scroller": {
      fontFamily: "var(--editor-font)",
      lineHeight: String(settings.lineHeight),
      overflow: "auto",
    },
    ".cm-content": {
      padding: "14px 0 44px",
      caretColor: "var(--accent-primary)",
      minHeight: "100%",
    },
    ".cm-line": {
      padding: "0 20px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--surface-editor)",
      color: "var(--text-tertiary)",
      border: "none",
      borderRight: "1px solid var(--border-subtle)",
      minWidth: "70px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 17px 0 10px",
      minWidth: "68px",
    },
    ".cm-activeLine": {
      backgroundColor: settings.highlightCurrentLine ? "var(--accent-line)" : "transparent",
    },
    ".cm-activeLineGutter": {
      color: "var(--accent-primary)",
      backgroundColor: settings.highlightCurrentLine ? "var(--accent-line)" : "transparent",
    },
    ".cm-activeLine::before": {
      content: '""',
      position: "absolute",
      left: "0",
      width: "3px",
      height: "1.55em",
      background: "var(--accent-primary)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--accent-selection) !important",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--search-match)",
      outline: "none",
      borderRadius: "3px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--search-current)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent-primary)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused": { outline: "none" },
  });
}

export function TextEditor({
  pane,
  document,
  settings,
  searchState,
  onChange,
  onCursor,
  onFocus,
  onUndo,
  onRedo,
}: TextEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastPatchRef = useRef(0);
  const compartments = useRef({
    wrap: new Compartment(),
    gutter: new Compartment(),
    theme: new Compartment(),
    readOnly: new Compartment(),
    tabSize: new Compartment(),
  });
  const callbacks = useRef({ onChange, onCursor, onFocus, onUndo, onRedo });
  callbacks.current = { onChange, onCursor, onFocus, onUndo, onRedo };
  const viewId = pane + "-" + document.id;

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const { wrap, gutter, theme, readOnly, tabSize } = compartments.current;
    const state = EditorState.create({
      doc: document.content,
      extensions: [
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        search({ top: true }),
        keymap.of([
          {
            key: "Mod-z",
            run: () => {
              callbacks.current.onUndo();
              return true;
            },
          },
          {
            key: "Mod-y",
            mac: "Mod-Shift-z",
            run: () => {
              callbacks.current.onRedo();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
        ]),
        wrap.of(settings.wordWrapByDefault ? EditorView.lineWrapping : []),
        gutter.of(settings.showLineNumbers ? lineNumbers() : []),
        theme.of(editorTheme(settings)),
        readOnly.of(EditorState.readOnly.of(document.readOnly)),
        tabSize.of(EditorState.tabSize.of(settings.tabSize)),
        EditorView.updateListener.of((update) => {
          if (update.focusChanged && update.view.hasFocus) callbacks.current.onFocus();
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalSync))) {
            callbacks.current.onChange(update.changes, viewId);
          }
          if (update.selectionSet || update.docChanged || update.focusChanged) {
            const selection = update.state.selection.main;
            const line = update.state.doc.lineAt(selection.head);
            callbacks.current.onCursor(
              line.number,
              selection.head - line.from + 1,
              Math.abs(selection.to - selection.from),
            );
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    editors[pane] = view;

    return () => {
      if (editors[pane] === view) delete editors[pane];
      view.destroy();
      viewRef.current = null;
    };
  }, [document.id, pane]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const patch = document.patch;
    if (patch && patch.sequence !== lastPatchRef.current) {
      lastPatchRef.current = patch.sequence;
      if (patch.origin !== viewId) {
        view.dispatch({ changes: patch.changes, annotations: externalSync.of(true) });
      }
      return;
    }
    if (current !== document.content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: document.content },
        annotations: externalSync.of(true),
      });
    }
  }, [document.content, document.patch, viewId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: searchState.query,
        caseSensitive: searchState.caseSensitive,
        literal: true,
        wholeWord: searchState.wholeWord,
      })),
    });
  }, [searchState.query, searchState.caseSensitive, searchState.wholeWord]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { wrap, gutter, theme, readOnly, tabSize } = compartments.current;
    view.dispatch({
      effects: [
        wrap.reconfigure(settings.wordWrapByDefault ? EditorView.lineWrapping : []),
        gutter.reconfigure(settings.showLineNumbers ? lineNumbers() : []),
        theme.reconfigure(editorTheme(settings)),
        readOnly.reconfigure(EditorState.readOnly.of(document.readOnly)),
        tabSize.reconfigure(EditorState.tabSize.of(settings.tabSize)),
      ],
    });
  }, [
    settings.wordWrapByDefault,
    settings.showLineNumbers,
    settings.fontSize,
    settings.lineHeight,
    settings.highlightCurrentLine,
    settings.tabSize,
    document.readOnly,
  ]);

  return <div className="editor-host" ref={hostRef} aria-label={pane === "left" ? "Left editor" : "Right editor"} />;
}
