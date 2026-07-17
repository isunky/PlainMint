import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const plainMintSyntaxHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syntax-number)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "var(--syntax-function)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  { tag: [tags.operatorKeyword, tags.operator, tags.punctuation], color: "var(--syntax-operator)" },
  { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3], color: "var(--syntax-heading)", fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--syntax-link)", textDecoration: "underline" },
]));
