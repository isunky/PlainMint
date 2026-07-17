import type { TextChangeSet } from "./textChanges";

export interface TextStats {
  characters: number;
  lines: number;
  utf8Bytes: number;
}

const encoder = new TextEncoder();

function characterCount(value: string) {
  return Array.from(value).length;
}

export function getTextStats(content: string): TextStats {
  return {
    characters: characterCount(content),
    lines: content.length === 0 ? 1 : content.split("\n").length,
    utf8Bytes: encoder.encode(content).byteLength,
  };
}

export function applyChangesToString(content: string, changeSet: TextChangeSet) {
  if (content.length !== changeSet.length) throw new RangeError("Text change length does not match content");
  let cursor = 0;
  let next = "";
  const inverseSpecs: Array<{ from: number; to: number; insert: string }> = [];
  let offset = 0;
  let characters = 0;
  let utf8Bytes = 0;
  let insertedLines = 0;
  let removedLines = 0;

  changeSet.changes.forEach(({ from: fromA, to: toA, insert: added }) => {
    const removed = content.slice(fromA, toA);
    const fromB = fromA + offset;
    const toB = fromB + added.length;
    next += content.slice(cursor, fromA) + added;
    cursor = toA;
    inverseSpecs.push({ from: fromB, to: toB, insert: removed });
    offset += added.length - (toA - fromA);
    characters += characterCount(added) - characterCount(removed);
    utf8Bytes += encoder.encode(added).byteLength - encoder.encode(removed).byteLength;
    insertedLines += (added.match(/\n/g) ?? []).length;
    removedLines += (removed.match(/\n/g) ?? []).length;
  });
  next += content.slice(cursor);

  return {
    content: next,
    inverseSpecs,
    statsDelta: { characters, utf8Bytes, lines: insertedLines - removedLines },
  };
}

export function applyTextStats(stats: TextStats, delta: { characters: number; utf8Bytes: number; lines: number }): TextStats {
  return {
    characters: Math.max(0, stats.characters + delta.characters),
    utf8Bytes: Math.max(0, stats.utf8Bytes + delta.utf8Bytes),
    lines: Math.max(1, stats.lines + delta.lines),
  };
}
