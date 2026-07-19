import { detectLanguage } from "./languageMetadata";
import type { LanguageId } from "./types";

export type TemplateLocale = "zh-CN" | "en";

export type BuiltInDocumentTemplateId =
  | "meeting-notes"
  | "daily-note"
  | "todo-list"
  | "project-plan"
  | "issue-report"
  | "readme";

export type DocumentTemplateId = string;

export interface BuiltInDocumentTemplate {
  id: string;
  kind: "builtin";
  builtInId: BuiltInDocumentTemplateId;
  fileName: string;
  content: Record<TemplateLocale, string>;
  revision?: string;
}

export interface CustomDocumentTemplate {
  id: string;
  kind: "custom";
  name: string;
  description?: string;
  fileName: string;
  content: string;
  revision?: string;
}

export type DocumentTemplate = BuiltInDocumentTemplate | CustomDocumentTemplate;

export interface TemplateIssue {
  fileName: string;
  message: string;
}

export interface DocumentTemplateCatalog {
  templates: DocumentTemplate[];
  issues: TemplateIssue[];
  directoryPath?: string;
}

export interface TemplateDeleteRequest {
  id: string;
  revision?: string;
}

export interface DocumentTemplateChanges {
  upserts: DocumentTemplate[];
  deletes: TemplateDeleteRequest[];
}

export interface DocumentTemplatePreset {
  fileName: string;
  content: string;
  languageMode: LanguageId;
}

const builtInTemplateContent: Record<BuiltInDocumentTemplateId, Record<TemplateLocale, string>> = {
  "meeting-notes": {
    "zh-CN": "会议记录\n========\n\n日期：{{date}}\n主题：\n参与者：\n\n议程\n----\n• \n\n讨论要点\n--------\n• \n\n决议\n----\n• \n\n后续行动\n--------\n事项：\n负责人：\n截止日期：\n",
    en: "MEETING NOTES\n=============\n\nDate: {{date}}\nTopic:\nAttendees:\n\nAGENDA\n------\n• \n\nDISCUSSION\n----------\n• \n\nDECISIONS\n---------\n• \n\nACTION ITEMS\n------------\nItem:\nOwner:\nDue date:\n",
  },
  "daily-note": {
    "zh-CN": "每日记录 {{date}}\n==================\n\n今日重点\n--------\n1. \n2. \n3. \n\n随手记录\n--------\n\n待办\n----\n• \n\n今日回顾\n--------\n完成：\n阻碍：\n明日：\n",
    en: "DAILY NOTE — {{date}}\n=====================\n\nTOP PRIORITIES\n--------------\n1. \n2. \n3. \n\nNOTES\n-----\n\nTASKS\n-----\n• \n\nREFLECTION\n----------\nCompleted:\nBlocked by:\nTomorrow:\n",
  },
  "todo-list": {
    "zh-CN": "待办清单\n========\n\n收集箱\n------\n• \n\n今天\n----\n• \n\n稍后\n----\n• \n\n已完成\n------\n• \n",
    en: "TO-DO LIST\n==========\n\nINBOX\n-----\n• \n\nTODAY\n-----\n• \n\nLATER\n-----\n• \n\nCOMPLETED\n---------\n• \n",
  },
  "project-plan": {
    "zh-CN": "项目计划\n========\n\n目标\n----\n\n范围\n----\n包含：\n\n不包含：\n\n里程碑\n------\n名称：\n日期：\n\n任务\n----\n事项：\n负责人：\n\n风险与对策\n----------\n风险：\n对策：\n",
    en: "PROJECT PLAN\n============\n\nOBJECTIVE\n---------\n\nSCOPE\n-----\nIncluded:\n\nNot included:\n\nMILESTONES\n----------\nName:\nDate:\n\nTASKS\n-----\nItem:\nOwner:\n\nRISKS AND RESPONSES\n-------------------\nRisk:\nResponse:\n",
  },
  "issue-report": {
    "zh-CN": "问题记录\n========\n\n日期：{{date}}\n\n摘要\n----\n\n环境\n----\n系统：\nPlainMint 版本：\n文件类型与编码：\n\n复现步骤\n--------\n1. \n2. \n3. \n\n预期结果\n--------\n\n实际结果\n--------\n\n补充信息\n--------\n",
    en: "ISSUE REPORT\n============\n\nDate: {{date}}\n\nSUMMARY\n-------\n\nENVIRONMENT\n-----------\nSystem:\nPlainMint version:\nFile type and encoding:\n\nSTEPS TO REPRODUCE\n------------------\n1. \n2. \n3. \n\nEXPECTED RESULT\n---------------\n\nACTUAL RESULT\n-------------\n\nADDITIONAL CONTEXT\n------------------\n",
  },
  readme: {
    "zh-CN": "项目名称\n========\n\n一句话介绍项目。\n\n功能\n----\n• \n\n使用方法\n--------\n\n配置\n----\n\n许可证\n------\n",
    en: "PROJECT NAME\n============\n\nA short project description.\n\nFEATURES\n--------\n• \n\nUSAGE\n-----\n\nCONFIGURATION\n-------------\n\nLICENSE\n-------\n",
  },
};

const builtInFileNames: Record<BuiltInDocumentTemplateId, string> = {
  "meeting-notes": "meeting-notes.txt",
  "daily-note": "daily-note.txt",
  "todo-list": "todo-list.txt",
  "project-plan": "project-plan.txt",
  "issue-report": "issue-report.txt",
  readme: "README.txt",
};

export const builtInDocumentTemplates: BuiltInDocumentTemplate[] = (Object.keys(builtInFileNames) as BuiltInDocumentTemplateId[]).map((builtInId) => ({
  id: `builtin-${builtInId}.pmtpl`,
  kind: "builtin",
  builtInId,
  fileName: builtInFileNames[builtInId],
  content: builtInTemplateContent[builtInId],
}));

export const documentTemplates = builtInDocumentTemplates;

export function cloneTemplate<T extends DocumentTemplate>(template: T): T {
  return structuredClone(template);
}

export function cloneTemplateCatalog(catalog: DocumentTemplateCatalog): DocumentTemplateCatalog {
  return structuredClone(catalog);
}

export function localDate(now: Date) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function templateDisplayName(template: DocumentTemplate, locale: TemplateLocale, translate: (key: string) => string) {
  return template.kind === "builtin" ? translate(`templateName_${template.builtInId}`) : template.name;
}

export function templateDescription(template: DocumentTemplate, locale: TemplateLocale, translate: (key: string) => string) {
  void locale;
  return template.kind === "builtin" ? translate(`templateDescription_${template.builtInId}`) : template.description;
}

function contentFor(template: DocumentTemplate, locale: TemplateLocale) {
  return template.kind === "builtin" ? template.content[locale] : template.content;
}

export function createDocumentTemplate(template: DocumentTemplate, locale: TemplateLocale, now = new Date()): DocumentTemplatePreset {
  const content = contentFor(template, locale).replaceAll("{{date}}", localDate(now));
  return {
    fileName: template.fileName,
    content,
    languageMode: detectLanguage(template.fileName, content),
  };
}

export function isSafeSuggestedFileName(fileName: string) {
  const value = fileName.trim();
  return Boolean(value)
    && value !== "."
    && value !== ".."
    && !/[\\/:*?"<>|\u0000-\u001F]/.test(value)
    && !/[.\s]$/.test(value);
}

export function templateChanges(before: DocumentTemplateCatalog, after: DocumentTemplateCatalog): DocumentTemplateChanges {
  const beforeById = new Map(before.templates.map((template) => [template.id, template]));
  const afterById = new Map(after.templates.map((template) => [template.id, template]));
  const upserts = after.templates.filter((template) => JSON.stringify(template) !== JSON.stringify(beforeById.get(template.id)));
  const deletes = before.templates
    .filter((template) => template.kind === "custom" && !afterById.has(template.id))
    .map((template) => ({ id: template.id, revision: template.revision }));
  return { upserts, deletes };
}
