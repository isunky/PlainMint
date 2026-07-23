import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  type ChangeSet,
} from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  crosshairCursor,
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
  gotoLine,
  replaceAll as replaceAllSearch,
  replaceNext as replaceNextSearch,
  search,
  selectNextOccurrence,
  setSearchQuery,
} from "@codemirror/search";
import { codeMirrorCspExtension } from "../codeMirrorCsp";
import { effectiveLanguage, isSyntaxHighlightableStats, isTextLanguage, loadLanguage } from "../languageRegistry";
import { getTextStats } from "../textStats";
import { plainMintSyntaxHighlighting } from "../syntaxHighlighting";
import type { DocumentRecord, EditorRevealTarget, PaneId, SearchState, UserSettings } from "../types";
import { createSearchQuery } from "../searchPolicy";
import { buildTextCleanupChanges, type TextCleanupAction } from "../textCleanup";

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

export function goToLineInPane(pane: PaneId) {
  const view = editors[pane];
  return view ? gotoLine(view) : false;
}

export function replaceCurrentSearchMatchInPane(pane: PaneId, match: { from: number; to: number }) {
  const view = editors[pane];
  if (!view) return false;
  view.dispatch({ selection: { anchor: match.from, head: match.to } });
  return replaceNextSearch(view);
}

export function replaceAllSearchMatchesInPane(pane: PaneId) {
  const view = editors[pane];
  return view ? replaceAllSearch(view) : false;
}

export function selectNextOccurrenceInPane(pane: PaneId) {
  const view = editors[pane];
  if (!view) return 0;
  selectNextOccurrence(view);
  return view.state.selection.ranges.length;
}

export function cleanupTextInPane(pane: PaneId, action: TextCleanupAction, locale: string) {
  const view = editors[pane];
  if (!view || view.state.facet(EditorState.readOnly)) return false;
  const changes = buildTextCleanupChanges(
    view.state.doc.toString(),
    view.state.selection.ranges.map(({ from, to }) => ({ from, to })),
    action,
    locale,
  );
  if (!changes.length) return false;
  view.dispatch({ changes });
  return true;
}

export function selectedTextInPane(pane: PaneId) {
  const view = editors[pane];
  return view ? view.state.selection.ranges.map(({ from, to }) => view.state.sliceDoc(from, to)).filter(Boolean).join("\n") : "";
}

export function cutSelectionInPane(pane: PaneId) {
  const view = editors[pane];
  if (!view || view.state.facet(EditorState.readOnly)) return "";
  const ranges = view.state.selection.ranges.filter(({ from, to }) => from !== to);
  const text = ranges.map(({ from, to }) => view.state.sliceDoc(from, to)).join("\n");
  if (!text) return "";
  view.dispatch({ changes: ranges.map(({ from, to }) => ({ from, to, insert: "" })) });
  return text;
}

export function pasteTextInPane(pane: PaneId, text: string) {
  const view = editors[pane];
  if (!view || view.state.facet(EditorState.readOnly)) return false;
  const ranges = view.state.selection.ranges;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (ranges.length > 1 && lines.length === ranges.length) {
    let index = 0;
    view.dispatch(view.state.changeByRange((range) => {
      const insert = lines[index++];
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    }));
  } else {
    view.dispatch(view.state.replaceSelection(text));
  }
  return true;
}

export function selectAllInPane(pane: PaneId) {
  const view = editors[pane];
  if (!view) return false;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
  return true;
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
  revealTarget?: EditorRevealTarget;
  onRevealHandled: (id: string) => void;
}

function editorTheme(settings: UserSettings) {
  return [EditorView.theme({
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
      padding: "0 18px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--surface-editor)",
      color: "var(--text-tertiary)",
      border: "none",
      borderRight: "1px solid var(--border-subtle)",
      minWidth: "56px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 13px 0 8px",
      minWidth: "54px",
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
      width: "2px",
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
  }), plainMintSyntaxHighlighting];
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
  revealTarget,
  onRevealHandled,
}: TextEditorProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastPatchRef = useRef(0);
  const languageRequestRef = useRef(0);
  const compartments = useRef({
    wrap: new Compartment(),
    gutter: new Compartment(),
    theme: new Compartment(),
    readOnly: new Compartment(),
    tabSize: new Compartment(),
    spellcheck: new Compartment(),
    phrases: new Compartment(),
    language: new Compartment(),
  });
  const callbacks = useRef({ onChange, onCursor, onFocus, onUndo, onRedo });
  callbacks.current = { onChange, onCursor, onFocus, onUndo, onRedo };
  const viewId = pane + "-" + document.id;
  const resolvedLanguage = effectiveLanguage(document);
  const canHighlight = isSyntaxHighlightableStats(document.textStats ?? getTextStats(document.content));
  const spellcheckEnabled = settings.spellCheckEnabled && isTextLanguage(resolvedLanguage);

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const { wrap, gutter, theme, readOnly, tabSize, spellcheck, phrases, language } = compartments.current;
    const state = EditorState.create({
      doc: document.content,
      extensions: [
        codeMirrorCspExtension(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        search({ top: true }),
        keymap.of([
          { key: "Mod-d", run: selectNextOccurrence },
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
        spellcheck.of(EditorView.contentAttributes.of({ spellcheck: spellcheckEnabled ? "true" : "false" })),
        phrases.of(EditorState.phrases.of({ "Go to line": t("goToLine"), go: t("go") })),
        language.of([]),
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
              update.state.selection.ranges.reduce((total, range) => total + Math.abs(range.to - range.from), 0),
            );
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    // The view starts from document.content, which already includes the latest patch.
    // Treat that patch as consumed so a newly mounted split-pane editor never applies
    // it a second time with the old document length.
    lastPatchRef.current = document.patch?.sequence ?? 0;
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
    const request = languageRequestRef.current + 1;
    languageRequestRef.current = request;
    const reconfigure = (extension: Awaited<ReturnType<typeof loadLanguage>>) => {
      if (languageRequestRef.current !== request || viewRef.current !== view) return;
      view.dispatch({ effects: compartments.current.language.reconfigure(extension ?? []) });
    };
    if (!canHighlight) {
      reconfigure(null);
      return;
    }
    void loadLanguage(resolvedLanguage).then(reconfigure).catch(() => reconfigure(null));
  }, [canHighlight, document.id, resolvedLanguage]);

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
      effects: setSearchQuery.of(createSearchQuery(searchState)),
    });
  }, [searchState.query, searchState.replacement, searchState.caseSensitive, searchState.wholeWord, searchState.regexp]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealTarget || revealTarget.documentId !== document.id) return;
    const length = view.state.doc.length;
    const from = Math.min(Math.max(0, revealTarget.from), length);
    const to = Math.min(Math.max(from, revealTarget.to), length);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
    onRevealHandled(revealTarget.id);
  }, [document.id, onRevealHandled, revealTarget]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { wrap, gutter, theme, readOnly, tabSize, spellcheck, phrases } = compartments.current;
    view.dispatch({
      effects: [
        wrap.reconfigure(settings.wordWrapByDefault ? EditorView.lineWrapping : []),
        gutter.reconfigure(settings.showLineNumbers ? lineNumbers() : []),
        theme.reconfigure(editorTheme(settings)),
        readOnly.reconfigure(EditorState.readOnly.of(document.readOnly)),
        tabSize.reconfigure(EditorState.tabSize.of(settings.tabSize)),
        spellcheck.reconfigure(EditorView.contentAttributes.of({ spellcheck: spellcheckEnabled ? "true" : "false" })),
        phrases.reconfigure(EditorState.phrases.of({ "Go to line": t("goToLine"), go: t("go") })),
      ],
    });
  }, [
    settings.wordWrapByDefault,
    settings.showLineNumbers,
    settings.fontSize,
    settings.lineHeight,
    settings.highlightCurrentLine,
    settings.tabSize,
    spellcheckEnabled,
    document.readOnly,
    t,
  ]);

  return <div className="editor-host" ref={hostRef} aria-label={pane === "left" ? "Left editor" : "Right editor"} />;
}
