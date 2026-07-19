import type { LanguageMode } from "./types";

export type DocumentTemplateId =
  | "meeting-notes"
  | "daily-note"
  | "todo-list"
  | "project-plan"
  | "issue-report"
  | "readme";

export interface DocumentTemplateDefinition {
  id: DocumentTemplateId;
  fileName: string;
  languageMode: Exclude<LanguageMode, "auto">;
}

export interface DocumentTemplatePreset {
  fileName: string;
  content: string;
  languageMode: Exclude<LanguageMode, "auto">;
}

export const documentTemplates: DocumentTemplateDefinition[] = [
  { id: "meeting-notes", fileName: "meeting-notes.md", languageMode: "markdown" },
  { id: "daily-note", fileName: "daily-note.md", languageMode: "markdown" },
  { id: "todo-list", fileName: "todo-list.md", languageMode: "markdown" },
  { id: "project-plan", fileName: "project-plan.md", languageMode: "markdown" },
  { id: "issue-report", fileName: "issue-report.md", languageMode: "markdown" },
  { id: "readme", fileName: "README.md", languageMode: "markdown" },
];

function localDate(now: Date) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function contentFor(id: DocumentTemplateId, locale: "zh-CN" | "en", date: string) {
  const zh = locale === "zh-CN";
  const templates: Record<DocumentTemplateId, string[]> = zh ? {
    "meeting-notes": [
      "# 会议记录", "", `日期：${date}`, "主题：", "参与者：", "", "## 议程", "- ", "", "## 讨论要点", "- ", "", "## 决议", "- ", "", "## 后续行动", "- [ ] 事项 — 负责人： — 截止日期：",
    ],
    "daily-note": [
      `# 每日记录 · ${date}`, "", "## 今日重点", "1. ", "2. ", "3. ", "", "## 随手记录", "- ", "", "## 待办", "- [ ] ", "", "## 今日回顾", "- 完成：", "- 阻碍：", "- 明日：",
    ],
    "todo-list": [
      "# 待办清单", "", "## 收集箱", "- [ ] ", "", "## 今天", "- [ ] ", "", "## 稍后", "- [ ] ", "", "## 已完成", "- [x] ",
    ],
    "project-plan": [
      "# 项目计划", "", "## 目标", "", "## 范围", "### 包含", "- ", "", "### 不包含", "- ", "", "## 里程碑", "- [ ] 里程碑 1 — 日期：", "", "## 任务", "- [ ] 事项 — 负责人：", "", "## 风险与对策", "- 风险：", "  - 对策：",
    ],
    "issue-report": [
      "# 问题记录", "", `日期：${date}`, "", "## 摘要", "", "## 环境", "- 系统：", "- PlainMint 版本：", "- 文件类型与编码：", "", "## 复现步骤", "1. ", "2. ", "3. ", "", "## 预期结果", "", "## 实际结果", "", "## 补充信息", "",
    ],
    readme: [
      "# 项目名称", "", "一句话介绍项目。", "", "## 功能", "- ", "", "## 使用方法", "```text", "在此填写使用说明", "```", "", "## 配置", "- ", "", "## 许可证", "",
    ],
  } : {
    "meeting-notes": [
      "# Meeting notes", "", `Date: ${date}`, "Topic:", "Attendees:", "", "## Agenda", "- ", "", "## Discussion", "- ", "", "## Decisions", "- ", "", "## Action items", "- [ ] Item — Owner: — Due:",
    ],
    "daily-note": [
      `# Daily note · ${date}`, "", "## Top priorities", "1. ", "2. ", "3. ", "", "## Notes", "- ", "", "## Tasks", "- [ ] ", "", "## Reflection", "- Completed:", "- Blocked by:", "- Tomorrow:",
    ],
    "todo-list": [
      "# To-do list", "", "## Inbox", "- [ ] ", "", "## Today", "- [ ] ", "", "## Later", "- [ ] ", "", "## Completed", "- [x] ",
    ],
    "project-plan": [
      "# Project plan", "", "## Objective", "", "## Scope", "### Included", "- ", "", "### Not included", "- ", "", "## Milestones", "- [ ] Milestone 1 — Date:", "", "## Tasks", "- [ ] Item — Owner:", "", "## Risks and responses", "- Risk:", "  - Response:",
    ],
    "issue-report": [
      "# Issue report", "", `Date: ${date}`, "", "## Summary", "", "## Environment", "- System:", "- PlainMint version:", "- File type and encoding:", "", "## Steps to reproduce", "1. ", "2. ", "3. ", "", "## Expected result", "", "## Actual result", "", "## Additional context", "",
    ],
    readme: [
      "# Project name", "", "A short project description.", "", "## Features", "- ", "", "## Usage", "```text", "Add usage instructions here", "```", "", "## Configuration", "- ", "", "## License", "",
    ],
  };
  return `${templates[id].join("\n")}\n`;
}

export function createDocumentTemplate(
  id: DocumentTemplateId,
  locale: "zh-CN" | "en",
  now = new Date(),
): DocumentTemplatePreset {
  const template = documentTemplates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown document template: ${id}`);
  return {
    fileName: template.fileName,
    languageMode: template.languageMode,
    content: contentFor(id, locale, localDate(now)),
  };
}
