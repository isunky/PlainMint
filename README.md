<div align="center">
  <img src="app/public/plainmint-icon-source.png" width="92" alt="PlainMint">

  <h1>PlainMint</h1>
  <p>
    <strong>纯文本，清爽如初。</strong><br>
    <em>Plain text, freshly simple.</em>
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

PlainMint 是一款面向 Windows 与 macOS 的轻量纯文本编辑器。它在轻巧与实用之间，保留恰到好处的功能，让书写更专注、整理更从容、保存更安心。无需账户，文件始终留在你的设备上。

### 核心功能

- **清爽而高效** — 多标签、左右分屏、查找替换与撤销重做，让常用操作顺手完成
- **提笔即可开始** — 内置会议、每日记录、待办、项目计划、问题记录与 README 模板
- **安心不打扰** — 自动备份、会话恢复与外部变更检测，默默守护每次编辑
- **忠于原文件** — 保留 UTF-8 / UTF-16 编码，以及 LF / CRLF / CR 换行格式
- **观感随心** — 自动换行、行号、明暗主题与五种强调色，舒适而克制
- **双语自然切换** — 支持简体中文与 English，并可跟随系统语言
- **更新可信可控** — 正式版自动检查 GitHub Release，并在安装前验证更新签名

### 下载

前往 [GitHub Releases](https://github.com/isunky/PlainMint/releases)，获取 Windows 安装程序或 macOS DMG。

> PlainMint 只在本机读写文件。当前安装包尚未进行商业代码签名，首次运行时系统可能显示安全提示。

---

<a id="english"></a>

## English

PlainMint is a lightweight plain-text editor for Windows and macOS. It keeps just the right features close at hand, so writing stays focused, organizing feels effortless, and saving remains dependable. No account is required, and your files stay on your device.

### Highlights

- **Clean and efficient** — Tabs, split view, find and replace, undo and redo
- **Ready when you are** — Built-in templates for meetings, daily notes, tasks, project plans, issues, and READMEs
- **Quietly dependable** — Automatic backups, session recovery, and external-change detection
- **Faithful to your files** — Preserves UTF-8 / UTF-16 and LF / CRLF / CR
- **Comfortable by design** — Word wrap, line numbers, light and dark modes, and five accents
- **Naturally bilingual** — Simplified Chinese and English with system-language detection
- **Trusted updates** — Release builds check GitHub and verify every update before installation

### Download

Get the Windows installer or macOS DMG from [GitHub Releases](https://github.com/isunky/PlainMint/releases).

> Your files stay on your device. Current builds are unsigned, so your system may show a security warning on first launch.

---

## 开发 / Development

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

<details>
<summary><strong>发布 / Release</strong></summary>

在 GitHub Actions 中手动运行 **Release**，并选择 `patch`、`minor` 或 `major`。工作流会自动推算下一版本号，随后构建并发布 Windows 与 macOS 安装包。

Run **Release** manually in GitHub Actions and choose `patch`, `minor`, or `major`. The workflow calculates the next version and publishes Windows and macOS installers.

</details>

## License

[Apache License 2.0](LICENSE)
