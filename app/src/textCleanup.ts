export type TextCleanupAction = "sortAscending" | "sortDescending" | "deduplicate" | "removeBlankLines" | "trimTrailingWhitespace";

export type TextRange = { from: number; to: number };
export type TextChange = { from: number; to: number; insert: string };

export function buildTextCleanupChanges(content: string, selections: TextRange[], action: TextCleanupAction, locale: string): TextChange[] {
  const nonEmpty = selections.filter((selection) => selection.from !== selection.to);
  const ranges = nonEmpty.length ? nonEmpty : [{ from: 0, to: content.length }];

  return ranges.map(({ from, to }) => {
    const selected = content.slice(from, to);
    const insert = cleanText(selected, action, locale, from === 0 && to === content.length);
    return { from, to, insert };
  }).filter((change) => content.slice(change.from, change.to) !== change.insert)
    .sort((left, right) => left.from - right.from);
}

function cleanText(content: string, action: TextCleanupAction, locale: string, preserveDocumentTrailingNewline: boolean) {
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  const lines = body.length ? body.split("\n") : [""];
  const transformed = cleanLines(lines, action, locale);
  const keepTrailingNewline = trailingNewline
    && (preserveDocumentTrailingNewline || action !== "removeBlankLines" || transformed.length > 0);
  return `${transformed.join("\n")}${keepTrailingNewline ? "\n" : ""}`;
}

function cleanLines(lines: string[], action: TextCleanupAction, locale: string) {
  switch (action) {
    case "sortAscending": return stableSort(lines, locale, 1);
    case "sortDescending": return stableSort(lines, locale, -1);
    case "deduplicate": return lines.filter((line, index) => lines.indexOf(line) === index);
    case "removeBlankLines": return lines.filter((line) => !/^[ \t]*$/.test(line));
    case "trimTrailingWhitespace": return lines.map((line) => line.replace(/[ \t]+$/g, ""));
  }
}

function stableSort(lines: string[], locale: string, direction: 1 | -1) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base", usage: "sort" });
  return lines.map((line, index) => ({ line, index })).sort((left, right) => {
    const compared = collator.compare(left.line, right.line);
    return compared ? direction * compared : left.index - right.index;
  }).map(({ line }) => line);
}
