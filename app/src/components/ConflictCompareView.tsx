import { useLayoutEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";

const MAX_HIGHLIGHT_BYTES = 5 * 1024 * 1024;
const MAX_HIGHLIGHT_LINES = 50_000;

const comparisonTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text-primary)", backgroundColor: "var(--surface-editor)" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--editor-font)", lineHeight: "1.55" },
  ".cm-content": { padding: "12px 0 28px" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "var(--surface-editor)", color: "var(--text-tertiary)", borderRight: "1px solid var(--border-subtle)" },
});

function readOnlyExtensions() {
  return [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    comparisonTheme,
  ];
}

function isHighlightable(content: string) {
  return new TextEncoder().encode(content).byteLength <= MAX_HIGHLIGHT_BYTES
    && content.split("\n").length <= MAX_HIGHLIGHT_LINES;
}

interface ConflictCompareViewProps {
  localContent: string;
  diskContent: string;
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
  const highlighted = isHighlightable(localContent) && isHighlightable(diskContent);

  useLayoutEffect(() => {
    const extensions = readOnlyExtensions();
    if (highlighted && mergeHostRef.current) {
      const view = new MergeView({
        a: { doc: localContent, extensions },
        b: { doc: diskContent, extensions },
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
      state: EditorState.create({ doc: localContent, extensions }),
      parent: localHostRef.current,
    });
    const diskView = new EditorView({
      state: EditorState.create({ doc: diskContent, extensions }),
      parent: diskHostRef.current,
    });
    return () => {
      localView.destroy();
      diskView.destroy();
    };
  }, [diskContent, highlighted, localContent]);

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
