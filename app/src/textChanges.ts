export interface TextChangeSpec {
  from: number;
  to: number;
  insert: string;
}

export interface TextChangeSet {
  length: number;
  changes: readonly TextChangeSpec[];
}

export function createTextChangeSet(
  length: number,
  input: TextChangeSpec | readonly TextChangeSpec[],
): TextChangeSet {
  const changes = (Array.isArray(input) ? input : [input])
    .filter((change) => change.from !== change.to || change.insert.length > 0)
    .map((change) => ({ ...change }));
  let previousEnd = 0;
  for (const change of changes) {
    if (
      !Number.isInteger(change.from)
      || !Number.isInteger(change.to)
      || change.from < previousEnd
      || change.to < change.from
      || change.to > length
    ) {
      throw new RangeError("Invalid or overlapping text change");
    }
    previousEnd = change.to;
  }
  return { length, changes };
}

export function textChangeSetIsEmpty(changeSet: TextChangeSet) {
  return changeSet.changes.length === 0;
}
