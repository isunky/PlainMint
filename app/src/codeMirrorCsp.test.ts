import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { codeMirrorCspExtension, findDocumentCspNonce } from "./codeMirrorCsp";

describe("CodeMirror CSP integration", () => {
  it("reads the nonce injected into a bundled stylesheet", () => {
    const testDocument = document.implementation.createHTMLDocument();
    const stylesheet = testDocument.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.nonce = "plainmint-style-nonce";
    testDocument.head.append(stylesheet);

    expect(findDocumentCspNonce(testDocument)).toBe("plainmint-style-nonce");

    const state = EditorState.create({ extensions: [codeMirrorCspExtension(testDocument)] });
    expect(state.facet(EditorView.cspNonce)).toBe("plainmint-style-nonce");
  });

  it("creates a normal editor state when no CSP nonce is present", () => {
    const testDocument = document.implementation.createHTMLDocument();
    const state = EditorState.create({
      doc: "PlainMint",
      extensions: [codeMirrorCspExtension(testDocument)],
    });

    expect(findDocumentCspNonce(testDocument)).toBe("");
    expect(state.facet(EditorView.cspNonce)).toBe("");
    expect(state.doc.toString()).toBe("PlainMint");
  });

  it("applies the nonce to CodeMirror's generated style sheets", () => {
    const testDocument = document.implementation.createHTMLDocument();
    const stylesheet = testDocument.createElement("style");
    stylesheet.nonce = "plainmint-generated-style-nonce";
    testDocument.head.append(stylesheet);
    const host = testDocument.createElement("div");
    testDocument.body.append(host);

    const view = new EditorView({
      doc: "PlainMint",
      extensions: [
        codeMirrorCspExtension(testDocument),
        EditorView.theme({ "&": { height: "100%" } }),
      ],
      parent: host,
      root: testDocument,
    });

    const generatedStyles = [...testDocument.head.querySelectorAll("style")].filter((element) => element !== stylesheet);
    expect(generatedStyles.length).toBeGreaterThan(0);
    expect(generatedStyles.every((element) => element.nonce === "plainmint-generated-style-nonce")).toBe(true);
    view.destroy();
  });
});
