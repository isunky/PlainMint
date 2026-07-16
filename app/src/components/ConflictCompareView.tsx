import { useLayoutEffect, useRef } from "react";
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
  localLabel: string;
  diskLabel: string;
  largeFileMessage: string;
}

export function ConflictCompareView({
  localContent,
  diskContent,
  localLabel,
  diskLabel,
  largeFileMessage,
}: ConflictCompareViewProps) {
  const mergeHostRef = useRef<HTMLDivElement>(null);
  const localHostRef = useRef<HTMLDivElement>(null);
  const diskHostRef = useRef<HTMLDivElement>(null);
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
      return () => view.destroy();
    }

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

  return (
    <div className="conflict-compare">
      <div className="conflict-compare-labels"><span>{localLabel}</span><span>{diskLabel}</span></div>
      {highlighted ? (
        <div className="conflict-merge-host" ref={mergeHostRef} />
      ) : (
        <>
          <p className="conflict-compare-fallback">{largeFileMessage}</p>
          <div className="conflict-plain-views">
            <div ref={localHostRef} aria-label={localLabel} />
            <div ref={diskHostRef} aria-label={diskLabel} />
          </div>
        </>
      )}
    </div>
  );
}
