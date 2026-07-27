# 第三方软件声明

## MuPDF.js 1.28.0

- 上游：https://github.com/ArtifexSoftware/mupdf.js
- 许可证：GNU AGPL v3 或商业许可证
- 用途：PDF 解析、渲染、文本提取、搜索、批注和写回

## Tauri 2

- 上游：https://github.com/tauri-apps/tauri
- 许可证：Apache‑2.0 / MIT
- 用途：Windows 桌面外壳、IPC、打包和系统集成

## React 19

- 上游：https://github.com/facebook/react
- 许可证：MIT
- 用途：界面组件与状态渲染

## Zustand 5

- 上游：https://github.com/pmndrs/zustand
- 许可证：MIT
- 用途：前端工作区状态管理

## Vite 8 / Vitest 4

- 上游：https://github.com/vitejs/vite、https://github.com/vitest-dev/vitest
- 许可证：MIT
- 用途：前端构建、开发服务器和单元测试

## Stirling-PDF Windows Thumbnail Handler（结构参考）

- 上游：https://github.com/Stirling-Tools/Stirling-PDF/tree/main/frontend/editor/src-tauri/thumbnail-handler
- 许可证：MIT
- 版权所有：Copyright (c) 2025 Stirling PDF Inc.
- 用途：参考 Windows `IThumbnailProvider`、`IInitializeWithStream`、Windows.Data.Pdf 与 WIC 的组合方式；鲁科实现使用独立 CLSID，并增加非 100% DPI 输出缩放和指针/尺寸校验

其余 JavaScript、主程序 Rust 依赖及精确版本分别记录在 `package-lock.json` 和 `src-tauri/Cargo.lock`；缩略图处理器依赖记录在 `src-tauri/thumbnail-handler/Cargo.lock`。发行清单由 `npm run licenses` 生成到 `docs/legal/THIRD_PARTY_LICENSES.md`。
