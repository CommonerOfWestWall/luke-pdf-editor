# Tauri WebDriver 桌面内测 Implementation Plan

**Goal:** 用可重复的 WebDriver 测试替代当前不可用的 Windows 截图自动化，验证真实 Tauri WebView 中打开长 PDF、读取全文批注、定位和编辑控件的主流程，同时保证测试服务器不进入发布构建。

**Architecture:** 采用 Tauri/WebdriverIO 官方推荐的 embedded provider。`tauri-plugin-wdio-webdriver` 只在 debug + Cargo `e2e` feature 下编译和注册，release + `e2e` 在编译期拒绝；普通调试、发布与安装包均不暴露 WebDriver 服务。首条测试把合法样本分块传入 WebView，构造成浏览器 `File` 后交给现有文件输入与真实 `PdfClient`/Worker；原生文件会话和原子保存继续由 Rust 测试覆盖，系统文件对话框保留为独立人工门禁。

**Dependencies:** `@wdio/cli`、`@wdio/local-runner`、`@wdio/mocha-framework`、`@wdio/spec-reporter`、`@wdio/tauri-service`（仅开发依赖）；`tauri-plugin-wdio-webdriver`（可选 Cargo feature）。

## Task 1: 测试边界

- [x] 增加 `e2e` Cargo feature，普通构建不含 embedded WebDriver；release + `e2e` 由 `compile_error!` 拒绝。
- [x] E2E build 仅公开一个返回随机运行标识的测试命令，用于确认 WebDriver 所连进程身份；不增加文件或系统权限，Cargo 默认依赖树不含插件。
- [x] 新增 `wdio.conf.ts`，固定单实例和 Windows 调试二进制；每次测试由启动脚本选择新的空闲本地端口，并用随机运行标识验证所连进程身份。

## Task 2: 桌面 WebView 冒烟

- [x] 分块注入浏览器 `File` 并通过隐藏文件输入只读加载用户样本；不建立原生保存会话，不写用户原件，也不把样本打入构建产物。
- [x] 断言文档标题、380 页和全文 253 条批注出现在真实 Tauri WebView。
- [x] 点击第 5 页批注并断言页码定位与属性编辑器出现。

## Task 3: 门禁

- [x] `npm run test:e2e:build` 生成无安装包的 E2E 调试二进制。
- [x] `npm run test:e2e` 强制先重建二进制，随后通过并自动结束应用进程。
- [x] 普通 `npm run tauri -- build --debug --no-bundle`、Rust 与前端全量检查保持通过。
- [x] 更新 0.3a 验证记录；明确系统文件对话框和外部阅读器交叉验证仍为独立未完成项。

## 工具链限制

- `@wdio/tauri-service` 固定为 `1.0.0`：`1.2.0` 当前发布包导入了 `@wdio/native-utils` 不存在的导出，无法启动。
- 该版本会在 embedded provider 下多余检查 EdgeDriver；中文用户目录使自动下载脚本报编码错误，但 embedded 会话不依赖该下载，测试仍通过。
- 服务按 `productName` 推导调试可执行文件名；`scripts/prepare-e2e-binary.mjs` 只在被忽略的 `target/debug` 中生成测试别名，不进入源码或发行包。
- embedded driver 的本地文件上传在当前环境不稳定；用例改为分块传入测试字节并在 WebView 内构造标准 `File`，随后仍调用正式文件输入、Worker 和界面交互链路。
