# 参与鲁科 PDF 编辑器

感谢你帮助改进鲁科 PDF 编辑器。项目欢迎代码、测试、文档、交互建议和跨阅读器兼容性验证，但 PDF 软件涉及数据安全，所有功能都必须带着可复现证据进入主分支。

参与前请先阅读[行为准则](CODE_OF_CONDUCT.md)和[公开路线图](docs/roadmap.md)。

## 从哪里开始

- 使用问题和方案讨论：GitHub Discussions。
- 可复现缺陷：Bug Issue 模板。
- 可独立验收的新能力：Feature Issue 模板。
- 文档错误：Documentation Issue 模板。
- 安全漏洞：按 [SECURITY.md](SECURITY.md) 使用私密漏洞报告，不要创建公开 Issue。

开始较大改动前请先创建 Issue，说明用户问题、可观察结果和验收方法，避免实现方向已经冲突后才开始讨论。

## 开发环境

- Windows 10/11 x64 与 WebView2 Runtime
- Node.js 24+
- npm 11+
- Rust 1.95+

```powershell
git clone https://github.com/CommonerOfWestWall/luke-pdf-editor.git
cd luke-pdf-editor
npm install
npm run tauri dev
```

项目使用 npm 和 Cargo。没有明确理由时，不要更换包管理器或批量升级生产依赖。

## 分支与提交

1. 从最新 `main` 创建 `feature/<简短描述>` 或 `fix/<简短描述>`。
2. 每个分支只解决一个可独立验收的问题。
3. 缺陷先写最小复现测试，再做最小修复。
4. 使用 Conventional Commits，例如：

```text
feat(annotation): add ink annotation
fix(save): preserve dirty state after external conflict
docs: clarify Windows installation
```

不要提交真实用户 PDF、文档正文、批注内容、完整本地路径、日志凭证、`work/` 测试语料或构建产物。

## PDF 兼容性规则

- PDF 操作只能通过 `src/pdf/pdf-client.ts` 进入 MuPDF Worker。
- 标准 PDF 批注是正式数据源，不增加只能由鲁科读取的私有批注格式。
- 坐标统一使用未旋转页面、PDF point、左下角原点。
- 新批注类型必须验证几何、保存、关闭、重开和跨阅读器显示。
- 不开启 PDF JavaScript，不绕过文档修改、复制或打印权限。
- 需要共享复现文件时，只提交有权公开且不含敏感信息的最小 fixture；否则提供生成脚本或结构描述。

架构边界见 `AGENTS.md` 和 `docs/adr/`。

## 本地验证

常规检查：

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/thumbnail-handler/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/thumbnail-handler/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/thumbnail-handler/Cargo.toml
```

桌面 WebView E2E 需要合法测试副本。长文档用例当前要求样本满足“380 页、253 条 Highlight、第 5 页存在批注”：

```powershell
$env:LUKE_E2E_PDF='C:\path\to\fixture.pdf'
npm run test:e2e
```

测试语料只能放在已忽略的 `work/` 中。测试结束后清理临时导出文件和恢复文件。

## Pull Request 门槛

PR 必须说明：

- 用户问题与行为变化；
- 实现范围和明确未覆盖的部分；
- 自动测试与手工验证证据；
- PDF 写回后的关闭、重开和兼容性结果；
- 数据丢失、安全、许可证和性能影响；
- 用户可见改动的截图或录屏。

CI 全绿后才进入合并审查。禁止绕过 hooks、使用 `--no-verify`、强推共享分支或把无关格式化混入功能提交。

## 文档同步

- 用户可见行为、安装方式或命令变化：更新 `README.md`。
- 功能状态变化：更新 `docs/feature-matrix.md`。
- 架构、坐标、存储、许可证或安全边界变化：新增 ADR。
- 发布行为变化：更新 `CHANGELOG.md` 与对应 `docs/validation/` 记录。
- 新依赖：更新 `THIRD_PARTY_NOTICES.md` 并运行 `npm run licenses`。
