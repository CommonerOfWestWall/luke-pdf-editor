# Windows 中文外测安装包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成可交付给外部测试者的 Windows 10/11 x64 中文 NSIS 安装包，安全注册 PDF 打开能力，支持双击 PDF 启动，并提供独立的鲁科 PDF 文件图标。

**Architecture:** Tauri/Rust 负责解析进程启动参数并创建受限文档会话，React 复用现有多标签加载流程。NSIS 只在当前用户范围注册稳定 ProgID、Open With 和“默认应用”候选，不绕过 Windows 的用户确认机制。静态文件图标随安装包安装；真实第一页预览作为独立 Explorer 缩略图处理器验证，不把普通图标冒充为动态预览。

**Tech Stack:** Tauri 2、Rust、React/TypeScript、NSIS、Windows 文件关联注册、ImageGen、Pillow

---

## Task 1：发布基线与版本

- [x] 将应用版本统一提升到 `0.3.4`，增加 Windows NSIS 打包脚本。
- [x] 将本批次定义为“受控外测预览”，明确未签名安装包和未完成能力边界。
- [x] 检查许可证随附资源，确保 AGPL 正文和第三方声明进入安装目录。

## Task 2：双击 PDF 启动链路

- [x] 为启动参数增加最小解析测试：只接受存在的 `.pdf` 文件并忽略安装器/系统参数。
- [x] 在 Rust 中将合法启动路径注册为受限 `DocumentSession`，通过一次性命令返回会话。
- [x] 在 React 启动时读取会话并复用现有多标签加载逻辑。
- [x] 验证带空格和中文文件名的 PDF 可以通过命令行打开。

## Task 3：中文安装器与文件关联

- [x] 配置仅简体中文的当前用户 NSIS 安装包。
- [x] 注册 `LukePdfEditor.Document` ProgID、PDF 的 Open With 候选和 Windows 默认应用能力。
- [x] 使用新文件图标作为 ProgID 的 `DefaultIcon`。
- [x] 安装后引导用户进入 Windows 默认应用设置确认，不写入受保护的 `UserChoice`。
- [x] 卸载时只删除本应用创建的注册项，不覆盖或删除其他 PDF 阅读器设置。

## Task 4：PDF 文件图标

- [x] 用 ImageGen 生成像素风 PDF 文档图标源图。
- [x] 去除色键背景并检查透明边缘。
- [x] 生成包含 16、20、24、32、40、48、64、128、256 像素层级的 `.ico`。
- [x] 在 16、32、48 和 256 像素下目视检查辨识度。

## Task 5：第一页缩略图技术验证

- [x] 检查当前系统已有 `.pdf` 缩略图处理器和 Tauri/MuPDF 的进程边界。
- [x] 实现 `IThumbnailProvider + IInitializeWithStream` 的独立原生 Shell 扩展方案。
- [x] 仅在本应用 ProgID 下注册处理器，安装后通过 COM 直连和 Windows Shell 获取真实首页缩略图。

## Task 6：构建与验证

- [x] 运行前端单元测试和生产构建。
- [x] 运行 Rust 格式、Clippy 和单元测试。
- [x] 构建 release 二进制和中文 NSIS 安装包。
- [x] 安装后验证应用文件、许可证、ProgID、Open With、中文文件名启动和静态文件图标。
- [x] 验证卸载能清理本应用注册项且不改变用户原有默认 PDF 选择。
- [x] 记录安装包 SHA-256、体积、未签名状态和已知限制。

## Task 7：项目文档

- [x] 更新 `README.md` 当前状态和安装说明。
- [x] 更新 `docs/feature-matrix.md` 的安装、关联和 Explorer 缩略图状态。
- [x] 新增 `docs/validation/0.3.4-windows-installer.md`，记录真实构建与验证证据。
