export type TextCleanupAction = "sortAscending" | "sortDescending" | "deduplicate" | "removeBlankLines" | "trimTrailingWhitespace";

export type TextRange = { from: number; to: number };
export type TextChange = { from: number; to: number; insert: string };

export function buildTextCleanupChanges(content: string, selections: TextRange[], action: TextCleanupAction, locale: string): TextChange[] {
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  const lines = body.length ? body.split("\n") : [""];
  const starts = lineStarts(lines);
  const nonEmpty = selections.filter((selection) => selection.from !== selection.to);
  const blocks = nonEmpty.length
    ? mergeLineBlocks(nonEmpty.map((selection) => selectionBlock(selection, starts, body.length)))
    : [{ start: 0, end: lines.length - 1 }];

  return blocks.map(({ start, end }) => {
    const from = starts[start];
    const to = end < lines.length - 1 ? starts[end + 1] : body.length;
    const transformed = cleanLines(lines.slice(start, end + 1), action, locale);
    const insert = `${transformed.join("\n")}${end < lines.length - 1 && transformed.length ? "\n" : ""}`;
    return { from, to, insert };
  }).filter((change) => content.slice(change.from, change.to) !== change.insert);
}

function lineStarts(lines: string[]) {
  const starts: number[] = [];
  let position = 0;
  for (const line of lines) {
    starts.push(position);
    position += line.length + 1;
  }
  return starts;
}

function selectionBlock(selection: TextRange, starts: number[], bodyLength: number) {
  const start = lineIndexAt(Math.min(selection.from, bodyLength), starts);
  const cappedTo = Math.min(selection.to, bodyLength);
  const end = lineIndexAt(cappedTo, starts);
  const endsAtNextLineStart = cappedTo > selection.from && starts[end] === cappedTo;
  return { start, end: endsAtNextLineStart ? Math.max(start, end - 1) : end };
}

function lineIndexAt(position: number, starts: number[]) {
  let index = 0;
  for (let next = 1; next < starts.length; next += 1) {
    if (starts[next] > position) break;
    index = next;
  }
  return index;
}

function mergeLineBlocks(blocks: Array<{ start: number; end: number }>) {
  const sorted = [...blocks].sort((left, right) => left.start - right.start || left.end - right.end);
  return sorted.reduce<Array<{ start: number; end: number }>>((merged, block) => {
    const previous = merged.at(-1);
    if (previous && block.start <= previous.end + 1) previous.end = Math.max(previous.end, block.end);
    else merged.push({ ...block });
    return merged;
  }, []);
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
