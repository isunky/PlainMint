export const systemMonospaceFont = "system-monospace";
export const systemCjkFont = "system-cjk";

export const latinFontOptions = [
  systemMonospaceFont,
  "Cascadia Mono",
  "Cascadia Code",
  "SFMono-Regular",
  "Consolas",
  "JetBrains Mono",
  "Fira Code",
  "Menlo",
  "Monaco",
  "Courier New",
] as const;

export const cjkFontOptions = [
  systemCjkFont,
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "PingFang SC",
  "Hiragino Sans GB",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "Sarasa Mono SC",
  "LXGW WenKai Mono",
  "SimSun",
] as const;

const systemMonospaceStack = '"Cascadia Mono", "Cascadia Code", "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono"';
const systemCjkStack = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC"';

function fontStackEntry(font: string, systemFont: string, fallback: string): string {
  if (font === systemFont) return fallback;
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildEditorFontFamily(latinFont: string, cjkFont: string): string {
  return `${fontStackEntry(latinFont, systemMonospaceFont, systemMonospaceStack)}, ${fontStackEntry(cjkFont, systemCjkFont, systemCjkStack)}, monospace`;
}
