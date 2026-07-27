# ADR 0001：MuPDF.js Worker 作为首个 PDF 引擎

- 状态：已接受
- 日期：2026-07-22

## 背景

产品需要可靠查看和标准 PDF 批注写回，并计划逐步加入表单、脱敏和页面编辑。使用 PDF.js 显示、另一引擎写回会产生坐标、外观流和兼容性差异；直接维护原生 MuPDF FFI 又会显著增加首个里程碑风险。

## 决策

在 Tauri WebView 的专用 Web Worker 中使用官方 MuPDF.js/WASM 1.28。Rust 只负责桌面系统能力和安全文件会话。主线程通过类型化 RPC 与 Worker 通信，不直接持有 MuPDF 对象。

## 后果

- 应用整体采用 AGPL‑3.0-or-later。
- PDF 操作不会阻塞 React 主线程。
- WASM 体积约 10 MB，发布包和启动性能必须纳入基准。
- 若 1000 页基准无法达标，允许在保持同一 Worker 契约的前提下迁移到原生 MuPDF；禁止同时运行两个 PDF 引擎。
