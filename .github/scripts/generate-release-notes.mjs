import { execFileSync } from "node:child_process";

const previousTag = process.env.PREVIOUS_TAG?.trim() ?? "";
const releaseTag = process.env.RELEASE_TAG?.trim();
const repository = process.env.GITHUB_REPOSITORY?.trim();
const serverUrl = (process.env.GITHUB_SERVER_URL?.trim() || "https://github.com").replace(
  /\/+$/,
  "",
);

if (!releaseTag) {
  throw new Error("RELEASE_TAG is required.");
}
if (!repository) {
  throw new Error("GITHUB_REPOSITORY is required.");
}

const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
const log = execFileSync(
  "git",
  ["log", "-z", "--no-merges", "--format=%H%x00%s", range, "--"],
  { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);
const fields = log.split("\0");
if (fields.at(-1) === "") {
  fields.pop();
}
if (fields.length % 2 !== 0) {
  throw new Error("Unexpected git log output.");
}

const commits = [];
for (let index = 0; index < fields.length; index += 2) {
  commits.push({ hash: fields[index], subject: fields[index + 1] });
}

const buckets = {
  breaking: [],
  features: [],
  fixes: [],
  performance: [],
  documentation: [],
  maintenance: [],
  other: [],
};
const maintenanceTypes = new Set([
  "build",
  "chore",
  "ci",
  "refactor",
  "style",
  "test",
]);
const recognizedTypes = new Set(["docs", "feat", "fix", "perf", ...maintenanceTypes]);
const conventionalSubject =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<message>.+)$/i;

function escapeMarkdown(value) {
  return value.replace(/\\/g, "\\\\").replace(/([`*_[\]<>])/g, "\\$1");
}

function renderCommit(commit, parsed) {
  let subject = commit.subject;
  if (parsed) {
    subject = escapeMarkdown(parsed.groups.message);
    if (parsed.groups.scope) {
      subject = `**${escapeMarkdown(parsed.groups.scope)}:** ${subject}`;
    }
  } else {
    subject = escapeMarkdown(subject);
  }

  const shortHash = commit.hash.slice(0, 7);
  const commitUrl = `${serverUrl}/${repository}/commit/${commit.hash}`;
  return `- ${subject} ([\`${shortHash}\`](${commitUrl}))`;
}

for (const commit of commits) {
  const parsed = conventionalSubject.exec(commit.subject);
  const type = parsed?.groups.type.toLowerCase();
  let bucket = "other";

  if (parsed?.groups.breaking) {
    bucket = "breaking";
  } else if (type === "feat") {
    bucket = "features";
  } else if (type === "fix") {
    bucket = "fixes";
  } else if (type === "perf") {
    bucket = "performance";
  } else if (type === "docs") {
    bucket = "documentation";
  } else if (maintenanceTypes.has(type)) {
    bucket = "maintenance";
  }

  const displayParts = parsed?.groups.breaking || recognizedTypes.has(type) ? parsed : null;
  buckets[bucket].push(renderCommit(commit, displayParts));
}

const lines = [
  "> 📦 请从下方 **Assets** 下载适合平台的安装包。  ",
  "> Download the installer for your platform from **Assets** below.",
  "",
];

if (previousTag) {
  lines.push(
    `> 🧾 自 **${escapeMarkdown(previousTag)}** 以来共 ${commits.length} 项提交。  `,
    `> ${commits.length} commits since **${escapeMarkdown(previousTag)}**.`,
  );
} else {
  lines.push(
    `> 🧾 首次发布共包含 ${commits.length} 项提交。  `,
    `> This first release contains ${commits.length} commits.`,
  );
}
lines.push("");

function appendSection(title, items, level = 2) {
  if (items.length === 0) {
    return;
  }
  lines.push(`${"#".repeat(level)} ${title} (${items.length})`, "", ...items, "");
}

if (commits.length === 0) {
  lines.push(
    "本次发布未检测到新的非合并提交。  ",
    "No new non-merge commits were found for this release.",
    "",
  );
} else {
  appendSection("💥 破坏性变更 / Breaking Changes", buckets.breaking);
  appendSection("✨ 新功能 / Features", buckets.features);
  appendSection("🐛 问题修复 / Fixes", buckets.fixes);
  appendSection("⚡ 性能优化 / Performance", buckets.performance);

  const detailCount =
    buckets.documentation.length + buckets.maintenance.length + buckets.other.length;
  if (detailCount > 0) {
    lines.push(
      "<details>",
      `<summary><strong>🧰 文档与工程记录 / Documentation & Maintenance (${detailCount})</strong></summary>`,
      "",
    );
    appendSection("📝 文档 / Documentation", buckets.documentation, 3);
    appendSection("🔧 工程维护 / Maintenance", buckets.maintenance, 3);
    appendSection("📌 其他 / Other", buckets.other, 3);
    lines.push("</details>", "");
  }
}

lines.push("---", "");
if (previousTag) {
  const compareUrl = `${serverUrl}/${repository}/compare/${previousTag}...${releaseTag}`;
  lines.push(
    `**完整变更 / Full changelog:** [\`${escapeMarkdown(previousTag)}...${escapeMarkdown(releaseTag)}\`](${compareUrl})`,
  );
} else {
  const commitsUrl = `${serverUrl}/${repository}/commits/${releaseTag}`;
  lines.push(
    `**全部提交 / All commits:** [\`${escapeMarkdown(releaseTag)}\`](${commitsUrl})`,
  );
}

process.stdout.write(`${lines.join("\n")}\n`);
