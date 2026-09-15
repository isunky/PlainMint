import { detectLanguage } from "./languageMetadata";
import type { LanguageId } from "./types";

export type TemplateLocale = "zh-CN" | "en";

export type BuiltInDocumentTemplateId =
  | "meeting-notes"
  | "daily-note"
  | "todo-list"
  | "project-plan"
  | "issue-report"
  | "readme"
  | "customer-communication"
  | "requirement-record"
  | "weekly-report"
  | "handover";

type LegacyBuiltInDocumentTemplateId = Exclude<BuiltInDocumentTemplateId, "customer-communication" | "requirement-record" | "weekly-report" | "handover">;

export type DocumentTemplateId = string;

export interface BuiltInDocumentTemplate {
  id: string;
  kind: "builtin";
  builtInId: BuiltInDocumentTemplateId;
  fileName: string;
  fileNames?: Partial<Record<TemplateLocale, string>>;
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

const previousBuiltInTemplateContent: Record<LegacyBuiltInDocumentTemplateId, Record<TemplateLocale, string>> = {
  "meeting-notes": {
    "zh-CN": "会议记录\n========\n\n会议时间：{{datetime}}（{{weekday}}）\n会议主题：\n主持人：\n记录人：\n参与者：\n\n会议目标\n--------\n本次会议需要解决：\n\n议程\n----\n1. \n2. \n3. \n\n讨论与结论\n----------\n议题：\n讨论要点：\n结论：\n\n决议\n----\n• 决议：\n  依据：\n\n行动项\n------\n□ 事项｜负责人｜截止日期｜状态\n\n待确认事项\n----------\n• \n\n下次会议\n--------\n时间：\n主题：\n会前准备：\n",
    en: "MEETING NOTES\n=============\n\nTime: {{datetime}} ({{weekday}})\nTopic:\nFacilitator:\nNote taker:\nAttendees:\n\nMEETING GOAL\n------------\nWhat this meeting needs to resolve:\n\nAGENDA\n------\n1. \n2. \n3. \n\nDISCUSSION AND CONCLUSIONS\n--------------------------\nTopic:\nKey points:\nConclusion:\n\nDECISIONS\n---------\n• Decision:\n  Rationale:\n\nACTION ITEMS\n------------\n□ Task | Owner | Due date | Status\n\nPENDING CONFIRMATION\n--------------------\n• \n\nNEXT MEETING\n------------\nTime:\nTopic:\nPreparation:\n",
  },
  "daily-note": {
    "zh-CN": "每日记录｜{{date}} {{weekday}}\n=========================\n\n今日最重要的三件事\n------------------\n1. \n2. \n3. \n\n日程\n----\n• {{time}}｜\n\n随手记录\n--------\n\n待办\n----\n□ 事项｜截止｜备注\n\n阻碍与待协助\n------------\n• \n\n今日完成\n--------\n• \n\n今日复盘\n--------\n做得好的：\n需要调整的：\n\n明天第一步\n----------\n• \n",
    en: "DAILY NOTE | {{date}} {{weekday}}\n============================\n\nTOP THREE PRIORITIES\n--------------------\n1. \n2. \n3. \n\nSCHEDULE\n--------\n• {{time}} | \n\nNOTES\n-----\n\nTASKS\n-----\n□ Task | Due | Notes\n\nBLOCKERS AND HELP NEEDED\n------------------------\n• \n\nACCOMPLISHMENTS\n---------------\n• \n\nREFLECTION\n----------\nWhat went well:\nWhat to adjust:\n\nFIRST ACTION TOMORROW\n---------------------\n• \n",
  },
  "todo-list": {
    "zh-CN": "待办清单\n========\n\n格式：□ 事项｜截止｜备注\n\n收集箱\n------\n□ \n\n今日最重要的三件事\n------------------\n1. □ \n2. □ \n3. □ \n\n本周\n----\n□ \n\n等待他人\n--------\n□ 事项｜等待对象｜跟进日期\n\n以后再做\n--------\n□ \n\n已完成\n------\n☑ \n",
    en: "TO-DO LIST\n==========\n\nFormat: □ Task | Due | Notes\n\nINBOX\n-----\n□ \n\nTOP THREE TODAY\n---------------\n1. □ \n2. □ \n3. □ \n\nTHIS WEEK\n---------\n□ \n\nWAITING FOR\n-----------\n□ Task | Person | Follow-up date\n\nLATER\n-----\n□ \n\nCOMPLETED\n---------\n☑ \n",
  },
  "project-plan": {
    "zh-CN": "项目计划\n========\n\n负责人：\n当前状态：规划中\n更新日期：{{date}}\n\n背景\n----\n为什么要做这个项目：\n\n目标\n----\n• \n\n成功标准\n--------\n• 可衡量结果：\n\n范围\n----\n包含：\n• \n\n不包含：\n• \n\n里程碑\n------\n1. 里程碑｜日期｜交付物\n\n任务计划\n--------\n□ 任务｜负责人｜截止日期｜状态\n\n依赖\n----\n• \n\n风险与应对\n----------\n• 风险：\n  影响：\n  应对：\n\n关键决策\n--------\n• {{date}}｜决策｜原因\n\n下次检查点\n----------\n日期：\n需要确认：\n",
    en: "PROJECT PLAN\n============\n\nOwner:\nStatus: Planning\nUpdated: {{date}}\n\nBACKGROUND\n----------\nWhy this project matters:\n\nGOALS\n-----\n• \n\nSUCCESS CRITERIA\n----------------\n• Measurable outcome:\n\nSCOPE\n-----\nIncluded:\n• \n\nNot included:\n• \n\nMILESTONES\n----------\n1. Milestone | Date | Deliverable\n\nTASK PLAN\n---------\n□ Task | Owner | Due date | Status\n\nDEPENDENCIES\n------------\n• \n\nRISKS AND RESPONSES\n-------------------\n• Risk:\n  Impact:\n  Response:\n\nKEY DECISIONS\n-------------\n• {{date}} | Decision | Rationale\n\nNEXT CHECKPOINT\n---------------\nDate:\nQuestions to confirm:\n",
  },
  "issue-report": {
    "zh-CN": "问题记录\n========\n\n记录时间：{{datetime}}\n标题：\n影响范围：\n优先级：高 / 中 / 低\n负责人：\n\n问题摘要\n--------\n用一两句话说明问题：\n\n环境\n----\n操作系统：\n应用与版本：\n文件类型与编码：\n其他条件：\n\n复现步骤\n--------\n1. \n2. \n3. \n\n预期结果\n--------\n\n实际结果\n--------\n\n证据\n----\n• 错误信息：\n• 截图或日志：\n\n原因假设\n--------\n• \n\n临时解决办法\n------------\n• \n\n处理记录\n--------\n• {{date}}｜处理人｜操作与结果\n\n最终解决方案\n------------\n\n验证结果\n--------\n验证人：\n验证时间：\n结论：已解决 / 未解决 / 待观察\n",
    en: "ISSUE REPORT\n============\n\nRecorded: {{datetime}}\nTitle:\nImpact:\nPriority: High / Medium / Low\nOwner:\n\nSUMMARY\n-------\nDescribe the issue in one or two sentences:\n\nENVIRONMENT\n-----------\nOperating system:\nApplication and version:\nFile type and encoding:\nOther conditions:\n\nSTEPS TO REPRODUCE\n------------------\n1. \n2. \n3. \n\nEXPECTED RESULT\n---------------\n\nACTUAL RESULT\n-------------\n\nEVIDENCE\n--------\n• Error message:\n• Screenshot or log:\n\nHYPOTHESES\n----------\n• \n\nWORKAROUND\n----------\n• \n\nINVESTIGATION LOG\n-----------------\n• {{date}} | Owner | Action and result\n\nRESOLUTION\n----------\n\nVERIFICATION\n------------\nVerified by:\nVerified at:\nResult: Resolved / Unresolved / Monitoring\n",
  },
  readme: {
    "zh-CN": "项目名称\n========\n\n用一句话说明项目解决的问题。\n\n项目概览\n--------\n适用对象：\n核心价值：\n当前状态：\n\n主要功能\n--------\n• \n\n运行要求\n--------\n• 操作系统：\n• 运行环境：\n• 其他依赖：\n\n快速开始\n--------\n1. 获取或安装项目。\n2. 完成必要配置。\n3. 运行并验证。\n\n使用示例\n--------\n输入：\n输出：\n\n配置说明\n--------\n配置项｜默认值｜说明\n\n文件结构\n--------\n目录或文件｜用途\n\n常见问题\n--------\n问：\n答：\n\n维护信息\n--------\n维护者：\n问题反馈：\n最后更新：{{date}}\n\n许可证\n------\n说明项目许可证或使用限制。\n",
    en: "PROJECT NAME\n============\n\nDescribe the problem this project solves in one sentence.\n\nOVERVIEW\n--------\nAudience:\nCore value:\nStatus:\n\nFEATURES\n--------\n• \n\nREQUIREMENTS\n------------\n• Operating system:\n• Runtime:\n• Other dependencies:\n\nQUICK START\n-----------\n1. Get or install the project.\n2. Complete the required configuration.\n3. Run and verify it.\n\nEXAMPLE\n-------\nInput:\nOutput:\n\nCONFIGURATION\n-------------\nSetting | Default | Description\n\nFILE STRUCTURE\n--------------\nPath | Purpose\n\nFAQ\n---\nQ:\nA:\n\nMAINTENANCE\n-----------\nMaintainer:\nIssue tracker:\nLast updated: {{date}}\n\nLICENSE\n-------\nDescribe the project license or usage restrictions.\n",
  },
};

const previousBuiltInFileNames: Record<LegacyBuiltInDocumentTemplateId, string> = {
  "meeting-notes": "meeting-notes-{{date}}.txt",
  "daily-note": "daily-note-{{date}}.txt",
  "todo-list": "todo-list.txt",
  "project-plan": "project-plan.txt",
  "issue-report": "issue-report-{{date}}.txt",
  readme: "README.txt",
};

export const previousBuiltInDocumentTemplates: BuiltInDocumentTemplate[] = (Object.keys(previousBuiltInFileNames) as LegacyBuiltInDocumentTemplateId[]).map((builtInId) => ({
  id: `builtin-${builtInId}.pmtpl`,
  kind: "builtin",
  builtInId,
  fileName: previousBuiltInFileNames[builtInId],
  content: previousBuiltInTemplateContent[builtInId],
}));

const builtInTemplateContent: Record<BuiltInDocumentTemplateId, Record<TemplateLocale, string>> = {
  "meeting-notes": {
    "zh-CN": "会议纪要\n\n会议主题：\n会议时间：{{date_cn}} {{time}}（{{weekday}}）\n参会人员：\n记录人：\n\n一、沟通重点\n1. \n2. \n\n二、确定事项\n1. \n2. \n\n三、待办事项\n1. 事项：\n   负责人：\n   完成时间：\n\n四、待确认问题\n1. \n\n下次沟通：\n",
    en: "MEETING MINUTES\n\nTopic:\nTime: {{datetime}} ({{weekday}})\nAttendees:\nNote taker:\n\nKEY DISCUSSION\n1. \n2. \n\nDECISIONS\n1. \n2. \n\nACTION ITEMS\n1. Task:\n   Owner:\n   Due date:\n\nOPEN QUESTIONS\n1. \n\nNEXT FOLLOW-UP:\n",
  },
  "daily-note": {
    "zh-CN": "工作日报\n日期：{{date_cn}} {{weekday}}\n\n今日完成\n1. \n2. \n\n进行中事项\n1. 事项：\n   当前进展：\n   下一步：\n\n待协调问题\n1. \n\n明日安排\n1. \n",
    en: "DAILY REPORT\nDate: {{date}} {{weekday}}\n\nCOMPLETED TODAY\n1. \n2. \n\nIN PROGRESS\n1. Item:\n   Progress:\n   Next step:\n\nNEEDS COORDINATION\n1. \n\nPLAN FOR TOMORROW\n1. \n",
  },
  "todo-list": {
    "zh-CN": "事项跟进\n更新日期：{{date_cn}}\n\n今日处理\n□ 事项：\n  负责人：\n  完成时间：\n\n近期安排\n□ 事项：\n  负责人：\n  完成时间：\n\n等待反馈\n□ 事项：\n  等待对象：\n  跟进时间：\n\n已完成\n☑ \n",
    en: "TASK FOLLOW-UP\nUpdated: {{date}}\n\nTODAY\n□ Task:\n  Owner:\n  Due date:\n\nUPCOMING\n□ Task:\n  Owner:\n  Due date:\n\nWAITING FOR RESPONSE\n□ Task:\n  Contact:\n  Follow-up date:\n\nCOMPLETED\n☑ \n",
  },
  "project-plan": {
    "zh-CN": "项目计划\n\n项目名称：\n项目负责人：\n当前阶段：\n更新时间：{{date_cn}}\n\n项目目标\n\n交付内容\n1. \n2. \n\n时间安排\n1. 事项：\n   完成时间：\n\n当前进展\n\n待协调问题\n1. \n\n下一步安排\n1. \n",
    en: "PROJECT PLAN\n\nProject name:\nOwner:\nCurrent stage:\nUpdated: {{date}}\n\nGOAL\n\nDELIVERABLES\n1. \n2. \n\nTIMELINE\n1. Item:\n   Due date:\n\nCURRENT PROGRESS\n\nNEEDS COORDINATION\n1. \n\nNEXT STEPS\n1. \n",
  },
  "issue-report": {
    "zh-CN": "问题跟进\n\n问题名称：\n发现时间：{{date_cn}} {{time}}\n影响范围：\n处理人：\n\n问题描述\n\n当前处理情况\n\n处理措施\n1. \n\n预计完成时间：\n\n验证结果\n\n后续跟进\n1. \n",
    en: "ISSUE FOLLOW-UP\n\nIssue:\nReported: {{datetime}}\nImpact:\nOwner:\n\nDESCRIPTION\n\nCURRENT STATUS\n\nACTIONS\n1. \n\nEXPECTED COMPLETION:\n\nVERIFICATION\n\nFOLLOW-UP\n1. \n",
  },
  readme: {
    "zh-CN": "项目说明\n\n项目名称：\n项目负责人：\n更新时间：{{date_cn}}\n\n项目用途\n\n主要内容\n1. \n2. \n\n使用方式\n1. \n2. \n\n相关资料\n1. \n\n联系人\n\n备注\n",
    en: "PROJECT BRIEF\n\nProject name:\nOwner:\nUpdated: {{date}}\n\nPURPOSE\n\nMAIN CONTENT\n1. \n2. \n\nHOW TO USE\n1. \n2. \n\nRELATED MATERIALS\n1. \n\nCONTACT\n\nNOTES\n",
  },
  "customer-communication": {
    "zh-CN": "客户沟通记录\n\n客户名称：\n联系人：\n沟通时间：{{date_cn}} {{time}}\n沟通方式：\n我方参与人：\n\n客户诉求\n1. \n\n沟通结论\n1. \n\n待确认事项\n1. \n\n下一步跟进\n1. 事项：\n   负责人：\n   跟进时间：\n",
    en: "CUSTOMER COMMUNICATION\n\nCustomer:\nContact:\nTime: {{datetime}}\nChannel:\nOur attendees:\n\nCUSTOMER REQUESTS\n1. \n\nCONCLUSIONS\n1. \n\nITEMS TO CONFIRM\n1. \n\nNEXT FOLLOW-UP\n1. Task:\n   Owner:\n   Follow-up date:\n",
  },
  "requirement-record": {
    "zh-CN": "需求记录\n\n需求名称：\n需求来源：\n记录时间：{{date_cn}}\n记录人：\n优先级：高 / 中 / 低\n\n使用场景\n\n具体要求\n1. \n\n验收要求\n1. \n\n待确认问题\n1. \n\n确认人：\n确认时间：\n",
    en: "REQUIREMENT RECORD\n\nRequirement:\nSource:\nRecorded: {{date}}\nOwner:\nPriority: High / Medium / Low\n\nSCENARIO\n\nDETAILS\n1. \n\nACCEPTANCE CRITERIA\n1. \n\nOPEN QUESTIONS\n1. \n\nCONFIRMED BY:\nCONFIRMED AT:\n",
  },
  "weekly-report": {
    "zh-CN": "工作周报\n汇报周期：\n提交日期：{{date_cn}}\n\n本周完成\n1. \n2. \n\n项目进展\n1. 项目：\n   进展：\n   下一步：\n\n待协调问题\n1. \n\n下周计划\n1. \n",
    en: "WEEKLY REPORT\nPeriod:\nSubmitted: {{date}}\n\nCOMPLETED THIS WEEK\n1. \n2. \n\nPROJECT PROGRESS\n1. Project:\n   Progress:\n   Next step:\n\nNEEDS COORDINATION\n1. \n\nPLAN FOR NEXT WEEK\n1. \n",
  },
  handover: {
    "zh-CN": "工作交接\n\n交接事项：\n交接人：\n接收人：\n交接日期：{{date_cn}}\n\n进行中事项\n1. 事项：\n   当前进展：\n   下一步：\n   负责人：\n\n资料位置\n1. \n\n重要时间点\n1. \n\n待确认事项\n1. \n",
    en: "WORK HANDOVER\n\nSubject:\nHanded over by:\nReceived by:\nDate: {{date}}\n\nIN-PROGRESS ITEMS\n1. Item:\n   Progress:\n   Next step:\n   Owner:\n\nMATERIAL LOCATIONS\n1. \n\nIMPORTANT DATES\n1. \n\nITEMS TO CONFIRM\n1. \n",
  },
};

const builtInFileNames: Record<BuiltInDocumentTemplateId, string> = {
  "meeting-notes": "meeting-minutes-{{date}}.txt",
  "daily-note": "daily-report-{{date}}.txt",
  "todo-list": "task-follow-up.txt",
  "project-plan": "project-plan-{{date}}.txt",
  "issue-report": "issue-follow-up-{{date}}.txt",
  readme: "project-brief.txt",
  "customer-communication": "customer-communication-{{date}}.txt",
  "requirement-record": "requirement-record-{{date}}.txt",
  "weekly-report": "weekly-report-{{date}}.txt",
  handover: "work-handover-{{date}}.txt",
};

const builtInLocalizedFileNames: Record<BuiltInDocumentTemplateId, Record<TemplateLocale, string>> = {
  "meeting-notes": { "zh-CN": "会议纪要-{{date}}.txt", en: builtInFileNames["meeting-notes"] },
  "daily-note": { "zh-CN": "工作日报-{{date}}.txt", en: builtInFileNames["daily-note"] },
  "todo-list": { "zh-CN": "事项跟进.txt", en: builtInFileNames["todo-list"] },
  "project-plan": { "zh-CN": "项目计划-{{date}}.txt", en: builtInFileNames["project-plan"] },
  "issue-report": { "zh-CN": "问题跟进-{{date}}.txt", en: builtInFileNames["issue-report"] },
  readme: { "zh-CN": "项目说明.txt", en: builtInFileNames.readme },
  "customer-communication": { "zh-CN": "客户沟通记录-{{date}}.txt", en: builtInFileNames["customer-communication"] },
  "requirement-record": { "zh-CN": "需求记录-{{date}}.txt", en: builtInFileNames["requirement-record"] },
  "weekly-report": { "zh-CN": "工作周报-{{date}}.txt", en: builtInFileNames["weekly-report"] },
  handover: { "zh-CN": "工作交接-{{date}}.txt", en: builtInFileNames.handover },
};

export const builtInDocumentTemplates: BuiltInDocumentTemplate[] = (Object.keys(builtInFileNames) as BuiltInDocumentTemplateId[]).map((builtInId) => ({
  id: `builtin-${builtInId}.pmtpl`,
  kind: "builtin",
  builtInId,
  fileName: builtInFileNames[builtInId],
  fileNames: builtInLocalizedFileNames[builtInId],
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

export function localChineseDate(now: Date) {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

export function localTime(now: Date) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function localWeekday(now: Date, locale: TemplateLocale) {
  const weekdays = locale === "zh-CN"
    ? ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return weekdays[now.getDay()];
}

export function renderTemplateVariables(value: string, locale: TemplateLocale, now: Date) {
  const date = localDate(now);
  const time = localTime(now);
  return value
    .replaceAll("{{datetime}}", `${date} ${time}`)
    .replaceAll("{{weekday}}", localWeekday(now, locale))
    .replaceAll("{{date_cn}}", localChineseDate(now))
    .replaceAll("{{date}}", date)
    .replaceAll("{{time}}", time);
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

export function templateSuggestedFileName(template: DocumentTemplate, locale: TemplateLocale) {
  return template.kind === "builtin" ? template.fileNames?.[locale] ?? template.fileName : template.fileName;
}

export function createDocumentTemplate(template: DocumentTemplate, locale: TemplateLocale, now = new Date()): DocumentTemplatePreset {
  const content = renderTemplateVariables(contentFor(template, locale), locale, now);
  const fileName = templateSuggestedFileName(template, locale).replaceAll("{{date}}", localDate(now));
  return {
    fileName,
    content,
    languageMode: detectLanguage(fileName, content),
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

export function isSafeTemplateFileName(fileName: string) {
  const variables = [...fileName.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]);
  if (variables.some((variable) => variable !== "date")) return false;
  const withoutKnownVariables = fileName.replaceAll("{{date}}", "2026-01-01");
  if (withoutKnownVariables.includes("{{") || withoutKnownVariables.includes("}}")) return false;
  return isSafeSuggestedFileName(withoutKnownVariables);
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
