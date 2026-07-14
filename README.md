<div align="center">
  <img src="app/public/plainmint-icon-source.png" width="88" alt="PlainMint">

  <h1>PlainMint</h1>
  <p><strong>纯文本，清爽简单。</strong><br><sub>Plain text, freshly simple.</sub></p>

  <p>
    <a href="https://github.com/isunky/PlainMint/releases/latest"><img src="https://img.shields.io/github/v/release/isunky/PlainMint?style=flat-square&label=Download&color=18b7aa" alt="Latest release"></a>
    <a href="https://github.com/isunky/PlainMint/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/isunky/PlainMint/ci.yml?style=flat-square&label=CI" alt="CI status"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/isunky/PlainMint?style=flat-square" alt="License"></a>
  </p>

  <p>轻量、可靠、完全本地的 Windows / macOS 纯文本编辑器。</p>
</div>

<img src="app/qa/editor-1586x992.png" alt="PlainMint 编辑器界面">

## 为什么选择 PlainMint？

| 清爽编辑           | 安全可靠           | 灵活使用             |
| ------------------ | ------------------ | -------------------- |
| 多标签、左右分屏   | 自动备份、会话恢复 | 浅色、深色、系统主题 |
| 查找替换、撤销重做 | 外部文件变更检测   | 简体中文与 English   |
| 自动换行、行号统计 | 保留编码与换行格式 | Windows 与 macOS     |

文件始终保存在本机：**无需账户、不上传内容、不使用专有格式。**

## 下载

从 [GitHub Releases](https://github.com/isunky/PlainMint/releases/latest) 获取：

- **Windows** — NSIS 安装程序
- **macOS** — DMG 安装包

> 当前版本未进行商业代码签名，首次运行时系统可能显示安全提示。

## 本地开发

需要 Node.js 22、Rust stable 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/isunky/PlainMint.git
cd PlainMint/app
npm install
npm run tauri:dev
```

```bash
npm run check          # 类型检查与测试
npm run tauri:build    # 构建桌面安装包
```

<details>
<summary><strong>发布新版本</strong></summary>

在 GitHub Actions 中手动运行 **Release**，选择 `patch`、`minor` 或 `major`。工作流会自动计算版本号并发布 Windows 与 macOS 安装包。

</details>

## License

[Apache License 2.0](LICENSE)
