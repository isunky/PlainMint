<div align="center">
  <img src="app/public/plainmint-icon-source.png" width="92" alt="PlainMint">

  <h1>PlainMint</h1>
  <p>
    <strong>打开就写，轻松整理，安心保存。</strong><br>
    <em>Open, write, organize, and keep every word safe.</em>
  </p>

  <p>
    <a href="https://github.com/isunky/PlainMint/releases"><img src="https://img.shields.io/badge/download-Windows%20%7C%20macOS-18b7aa?style=flat-square" alt="Download"></a>
    <a href="https://github.com/isunky/PlainMint/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/isunky/PlainMint/ci.yml?style=flat-square&label=build" alt="Build"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/isunky/PlainMint?style=flat-square&color=657076" alt="License"></a>
  </p>

  <p>
    <a href="https://github.com/isunky/PlainMint/releases"><strong>下载 / Download</strong></a>
    ·
    <a href="#zh-cn">简体中文</a>
    ·
    <a href="#english">English</a>
  </p>
</div>

<p align="center">
  <img src="app/qa/editor-1586x992.png" width="100%" alt="PlainMint editor">
</p>

<a id="zh-cn"></a>

## 简体中文

PlainMint 是一款面向 Windows 与 macOS 的轻量纯文本编辑器。无论是随手记录、整理长文本，还是同时处理多个文件，它都把常用功能放在顺手的位置，不让复杂界面打断思路。无需账户，文件始终留在你的设备上。

### 核心功能

- **文档再多也清楚** — 用多标签和左右分屏同时处理文件，还能并排比较差异、一次查找所有已打开文档
- **整理文本不用折腾** — 快速排序、去重、删除空行和行尾空格，配合多光标与矩形列编辑，批量修改更省事
- **从模板快速开始** — 内置会议记录、每日笔记、待办清单、项目计划等纯文本模板，也可以在设置中修改或新建
- **阅读和编辑更舒服** — 语法高亮、自动换行、行号、明暗主题与多种强调色，让不同内容都清晰好读
- **关闭窗口也不慌** — 未命名草稿会被保留，会话恢复、自动备份和外部修改提醒默默守护正在编辑的内容
- **从打开到输出都顺手** — 支持最近文件、拖放打开、查找替换和系统打印，常用操作简单直接
- **更新不来打扰** — 只在你主动检查时获取新版本，是否下载和安装由你决定

### 下载

前往 [GitHub Releases](https://github.com/isunky/PlainMint/releases)，下载 Windows 安装程序或 macOS DMG，打开就可以开始记录。

> PlainMint 只在本机读写文件。当前安装包尚未进行商业代码签名，首次运行时系统可能显示安全提示。

---

<a id="english"></a>

## English

PlainMint is a lightweight plain-text editor for Windows and macOS. Whether you are capturing a quick thought, cleaning up a long document, or working across several files, it keeps useful tools close without letting the interface get in your way. No account is required, and your files stay on your device.

### Highlights

- **Stay clear across many documents** — Work with tabs and split view, compare files side by side, and search every open document at once
- **Clean up text without the busywork** — Sort lines, remove duplicates, blank lines, and trailing spaces, then make batch edits with multiple cursors and column selection
- **Start quickly with templates** — Use built-in plain-text templates for meetings, daily notes, tasks, and project plans, or edit and create your own in Settings
- **Make every file easier to read** — Syntax highlighting, word wrap, line numbers, light and dark modes, and several accent colors keep content comfortable and clear
- **Close without losing your train of thought** — Untitled drafts are preserved, while session recovery, automatic backups, and external-change alerts quietly protect your work
- **Keep everyday actions close** — Recent files, drag and drop, find and replace, and system printing are ready when you need them
- **Check for updates on your terms** — PlainMint looks for a new version only when you ask, leaving download and installation in your control

### Download

Get the Windows installer or macOS DMG from [GitHub Releases](https://github.com/isunky/PlainMint/releases), then open PlainMint and start writing.

> Your files stay on your device. Current builds are unsigned, so your system may show a security warning on first launch.

---

<details>
<summary><strong>开发与构建 / Development & Build</strong></summary>

<br>

**环境要求 / Requirements：** Node.js 22、Rust stable 与 [Tauri 2 前置依赖 / prerequisites](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/isunky/PlainMint.git
cd PlainMint/app
npm install
npm run tauri:dev
```

```bash
npm run check          # 类型检查与测试 / Type checks and tests
npm run tauri:build    # 构建安装包 / Build desktop installers
```

Windows 可在仓库根目录双击 `build-windows.cmd`，一次生成 MSI、EXE 安装程序与免安装绿色 ZIP；产物统一位于 `artifacts/windows`。

On Windows, double-click `build-windows.cmd` in the repository root to produce MSI and EXE installers plus a portable ZIP in `artifacts/windows`.

### 发布 / Release

在 GitHub Actions 中手动运行 **Release**，并选择 `patch`、`minor` 或 `major`。工作流会自动推算下一版本号，随后构建并发布 Windows 与 macOS 安装包。

Run **Release** manually in GitHub Actions and choose `patch`, `minor`, or `major`. The workflow calculates the next version and publishes Windows and macOS installers.

</details>

## License

[Apache License 2.0](LICENSE)
