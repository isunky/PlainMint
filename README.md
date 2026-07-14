<div align="center">
  <img src="app/public/plainmint-icon-source.png" width="96" alt="PlainMint icon">
  <h1>PlainMint</h1>
  <p><strong>纯文本，清爽简单。</strong><br>Plain text, freshly simple.</p>

[![CI](https://github.com/isunky/PlainMint/actions/workflows/ci.yml/badge.svg)](https://github.com/isunky/PlainMint/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/isunky/PlainMint?display_name=tag)](https://github.com/isunky/PlainMint/releases/latest)
[![License](https://img.shields.io/github/license/isunky/PlainMint)](LICENSE)

</div>

![PlainMint editor](app/qa/editor-1586x992.png)

PlainMint 是一款面向 Windows 与 macOS 的轻量纯文本编辑器。文件只保存在本机，没有账户、云端上传或专有格式。

## 功能

- 多标签编辑与左右分屏
- 查找替换、撤销重做、自动换行与行号
- UTF-8 / UTF-16 和 LF / CRLF / CR 保留
- 自动备份、会话恢复与外部文件变更检测
- 浅色、深色、系统主题及五种强调色
- 简体中文与 English

## 下载

前往 [GitHub Releases](https://github.com/isunky/PlainMint/releases/latest) 下载 Windows 安装程序或 macOS DMG。

> 当前构建未进行商业代码签名，首次运行时系统可能显示安全提示。

## 开发

需要 Node.js 22、Rust stable 与 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
cd app
npm install
npm run tauri:dev
```

```bash
npm run check
npm run build
npm run tauri:build
```

## 发布

在 GitHub Actions 中手动运行 **Release**，选择 `patch`、`minor` 或 `major`。工作流会根据最新 `v*` 标签自动生成下一版本，并发布 Windows NSIS 与 macOS DMG。

## License

[Apache License 2.0](LICENSE)
