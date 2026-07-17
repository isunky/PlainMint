import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const nonceSelectors = [
  'link[rel="stylesheet"][nonce]',
  "style[nonce]",
  "script[nonce]",
];

export function findDocumentCspNonce(root: ParentNode = document) {
  for (const selector of nonceSelectors) {
    const nonce = (root.querySelector<HTMLElement>(selector)?.nonce ?? "").trim();
    if (nonce) return nonce;
  }
  return "";
}

export function codeMirrorCspExtension(root: ParentNode = document): Extension {
  const nonce = findDocumentCspNonce(root);
  return nonce ? EditorView.cspNonce.of(nonce) : [];
}
