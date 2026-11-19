import { describe, expect, it } from "vitest";
import { incomingDrafts, isSnapshot, recordResolution, relativeCloudPath, type CloudDraft } from "./cloudWorkspace";

const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const draft = (clock: CloudDraft["clock"], content = "你好"): CloudDraft => ({
  id: "draft:one", clock, body: { content, fileName: "Untitled 1", encoding: "utf-8", lineEnding: "lf" },
});
const workspace = (...drafts: CloudDraft[]) => ({ version: 1 as const, files: [], resolved: [], drafts });

describe("OneDrive workspace protocol", () => {
  it("maps different roots without leaking local directories or accepting traversal", () => {
    expect(relativeCloudPath("D:\\OneDrive\\Work", "d:\\onedrive\\work\\文档\\a.txt")).toBe("文档/a.txt");
    expect(relativeCloudPath("/Users/me/OneDrive/Work", "/Users/me/OneDrive/Work/文档/a.txt")).toBe("文档/a.txt");
    expect(relativeCloudPath("/work", "/worker/a.txt")).toBeUndefined();
    expect(relativeCloudPath("/work", "/work/../a.txt")).toBeUndefined();
    expect(relativeCloudPath("/work", "/work/PlainMint Workspace/state.json")).toBeUndefined();
    expect(isSnapshot({ ...workspace(), files: ["a/../private.txt"] })).toBe(false);
  });

  it("keeps divergent drafts, deduplicates equal clocks, and drops ancestors", () => {
    const base = draft({ [a]: 1 });
    const left = draft({ [a]: 2 }, "from A");
    const right = draft({ [a]: 1, [b]: 1 }, "from B");
    expect(incomingDrafts([workspace(base, left), workspace(right, right)], [])).toEqual([left, right]);
  });

  it("resolving a draft stops old versions returning without deleting concurrent edits", () => {
    const base = draft({ [a]: 1 });
    const left = draft({ [a]: 2 }, "saved");
    const right = draft({ [a]: 1, [b]: 1 }, "still unsaved");
    const resolved = recordResolution(recordResolution([], base), { id: left.id, clock: left.clock });
    expect(resolved).toEqual([{ id: left.id, clock: left.clock }]);
    expect(incomingDrafts([workspace(base, left, right)], resolved)).toEqual([right]);
  });
});
