import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";
import { codeMirrorCspExtension } from "../codeMirrorCsp";
import { isSyntaxHighlightable, loadLanguage } from "../languageRegistry";
import { plainMintSyntaxHighlighting } from "../syntaxHighlighting";
import type { LanguageId } from "../types";

const comparisonTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text-primary)", backgroundColor: "var(--surface-editor)" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--editor-font)", lineHeight: "1.55" },
  ".cm-content": { padding: "12px 0 28px" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "var(--surface-editor)", color: "var(--text-tertiary)", borderRight: "1px solid var(--border-subtle)" },
});

function readOnlyExtensions(language: Extension) {
  return [
    codeMirrorCspExtension(),
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    comparisonTheme,
    plainMintSyntaxHighlighting,
    language,
  ];
}

interface ConflictCompareViewProps {
  localContent: string;
  diskContent: string;
  localLanguage: LanguageId;
  diskLanguage: LanguageId;
  localLabel: ComparisonSide;
  diskLabel: ComparisonSide;
  largeFileMessage: string;
  noDifferencesLabel: string;
  differencePositionLabel: (current: number, total: number) => string;
  previousDifferenceLabel: string;
  nextDifferenceLabel: string;
}

export interface ComparisonSide {
  label: string;
  detail?: string;
}

function scrollToChunk(view: MergeView, chunkIndex: number) {
  const chunk = view.chunks[chunkIndex];
  if (!chunk) return;
  const positionA = Math.min(chunk.fromA, view.a.state.doc.length);
  const positionB = Math.min(chunk.fromB, view.b.state.doc.length);
  view.a.dispatch({
    selection: { anchor: positionA },
    effects: EditorView.scrollIntoView(positionA, { y: "center" }),
  });
  view.b.dispatch({
    selection: { anchor: positionB },
    effects: EditorView.scrollIntoView(positionB, { y: "center" }),
  });
}

export function ConflictCompareView({
  localContent,
  diskContent,
  localLanguage,
  diskLanguage,
  localLabel,
  diskLabel,
  largeFileMessage,
  noDifferencesLabel,
  differencePositionLabel,
  previousDifferenceLabel,
  nextDifferenceLabel,
}: ConflictCompareViewProps) {
  const mergeHostRef = useRef<HTMLDivElement>(null);
  const localHostRef = useRef<HTMLDivElement>(null);
  const diskHostRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [activeChunk, setActiveChunk] = useState<number | null>(null);
  const [languageExtensions, setLanguageExtensions] = useState<[Extension, Extension]>([[], []]);
  const highlighted = isSyntaxHighlightable(localContent) && isSyntaxHighlightable(diskContent);

  useEffect(() => {
    let cancelled = false;
    if (!highlighted) {
      setLanguageExtensions([[], []]);
      return () => { cancelled = true; };
    }
    void Promise.all([loadLanguage(localLanguage), loadLanguage(diskLanguage)]).then(([local, disk]) => {
      if (!cancelled) setLanguageExtensions([local ?? [], disk ?? []]);
    }).catch(() => {
      if (!cancelled) setLanguageExtensions([[], []]);
    });
    return () => { cancelled = true; };
  }, [diskLanguage, highlighted, localLanguage]);

  useLayoutEffect(() => {
    const localExtensions = readOnlyExtensions(languageExtensions[0]);
    const diskExtensions = readOnlyExtensions(languageExtensions[1]);
    if (highlighted && mergeHostRef.current) {
      const view = new MergeView({
        a: { doc: localContent, extensions: localExtensions },
        b: { doc: diskContent, extensions: diskExtensions },
        parent: mergeHostRef.current,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 8 },
        diffConfig: { scanLimit: 500, timeout: 1_000 },
      });
      mergeViewRef.current = view;
      setChunkCount(view.chunks.length);
      setActiveChunk(view.chunks.length ? 0 : null);
      if (view.chunks.length) scrollToChunk(view, 0);
      return () => {
        mergeViewRef.current = null;
        view.destroy();
      };
    }

    setChunkCount(0);
    setActiveChunk(null);
    if (!localHostRef.current || !diskHostRef.current) return;
    const localView = new EditorView({
      state: EditorState.create({ doc: localContent, extensions: localExtensions }),
      parent: localHostRef.current,
    });
    const diskView = new EditorView({
      state: EditorState.create({ doc: diskContent, extensions: diskExtensions }),
      parent: diskHostRef.current,
    });
    return () => {
      localView.destroy();
      diskView.destroy();
    };
  }, [diskContent, highlighted, languageExtensions, localContent]);

  const navigate = (direction: -1 | 1) => {
    const view = mergeViewRef.current;
    if (!view?.chunks.length) return;
    const next = activeChunk === null
      ? direction === 1 ? 0 : view.chunks.length - 1
      : (activeChunk + direction + view.chunks.length) % view.chunks.length;
    scrollToChunk(view, next);
    setActiveChunk(next);
  };

  return (
    <div className="conflict-compare">
      <div className="conflict-compare-labels">
        {[localLabel, diskLabel].map((side, index) => (
          <span key={`${side.label}-${index}`} title={side.detail}>
            <strong>{side.label}</strong>
            {side.detail && <small>{side.detail}</small>}
          </span>
        ))}
      </div>
      {highlighted ? (
        <>
          <div className="compare-navigation">
            <span role="status" aria-live="polite">
              {chunkCount === 0 || activeChunk === null
                ? noDifferencesLabel
                : differencePositionLabel(activeChunk + 1, chunkCount)}
            </span>
            <div>
              <button type="button" className="button-secondary" disabled={chunkCount === 0} onClick={() => navigate(-1)}>{previousDifferenceLabel}</button>
              <button type="button" className="button-secondary" disabled={chunkCount === 0} onClick={() => navigate(1)}>{nextDifferenceLabel}</button>
            </div>
          </div>
          <div className="conflict-merge-host" ref={mergeHostRef} />
        </>
      ) : (
        <>
          <p className="conflict-compare-fallback">{largeFileMessage}</p>
          <div className="conflict-plain-views">
            <div ref={localHostRef} aria-label={localLabel.label} />
            <div ref={diskHostRef} aria-label={diskLabel.label} />
          </div>
        </>
      )}
    </div>
  );
}
