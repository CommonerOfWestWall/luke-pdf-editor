# 批注审阅 0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可处理整篇长文档的标准 PDF 批注审阅闭环，并逐批补齐文字标记、墨迹、图形、印章与评论协作能力。

**Architecture:** MuPDF Worker 仍是批注唯一读写边界；界面通过稳定 RPC 获取整篇批注快照，并用可逆 `AnnotationCommand` 修改。列表筛选和编辑草稿是纯前端逻辑，PDF 几何、元数据和 appearance stream 由 Worker 维护。

**Tech Stack:** React 19、TypeScript、Zustand、MuPDF.js 1.28 Worker、Vitest、Tauri 2/Rust。

---

## 文件结构

- `src/app/annotation-panel.ts`：批注筛选、排序、显示名称、编辑草稿与颜色转换的纯函数。
- `src/app/annotation-panel.test.ts`：筛选、顺序、不可解析日期、字段保留和颜色转换测试。
- `src/app/App.tsx`：全文批注加载、选择定位、编辑、删除及撤销/重做刷新。
- `src/app/store.ts`：保存全文批注快照和选择状态。
- `src/pdf/contracts.ts`：增加 `listAllAnnotations` Worker 方法。
- `src/pdf/pdf-client.ts`：公开全文批注 RPC。
- `src/pdf/pdf.worker.ts`：逐页读取批注，及时释放页面与批注包装对象。
- `src/styles.css`：批注筛选、选中态、编辑器和窄窗口布局。
- `docs/feature-matrix.md`、`README.md`、`docs/validation/0.3a.md`：状态与验证证据。

### Task 1: 0.3a 全文批注查询契约

- [x] **Step 1: 写失败测试**

在 `src/app/annotation-panel.test.ts` 构造跨页批注，断言默认按页码、页内纵向位置和稳定 ID 排序；当前页、类型、作者关键字可以组合筛选，缺失日期不影响排序。

- [x] **Step 2: 运行失败测试**

Run: `npm test -- src/app/annotation-panel.test.ts`

Expected: FAIL，因为 `filterAndSortAnnotations` 尚不存在。

- [x] **Step 3: 实现纯函数与 Worker RPC**

`filterAndSortAnnotations(records, { scope, pageIndex, kind, query })` 不修改输入；`listAllAnnotations` 在 Worker 中逐页调用与单页接口相同的坐标和元数据转换，并在 `finally` 中释放资源。

- [x] **Step 4: 运行相关检查**

Run: `npm test -- src/app/annotation-panel.test.ts src/pdf/annotation-identity.test.ts`

Expected: PASS，且现有身份稳定性测试保持通过。

### Task 2: 0.3a 评论面板与定位

- [x] **Step 1: 增加状态测试**

在 `src/app/store.test.ts` 断言打开新文档会清空全文批注与当前选择，删除后选择不存在的 ID 会自动清空。

- [x] **Step 2: 接入全文批注快照**

文档打开或 `renderRevision` 变化时调用 `listAllAnnotations`；使用请求序号丢弃旧文档或旧修订的迟到结果。加载批注不能阻塞页面滚动和渲染。

- [x] **Step 3: 实现筛选和定位**

面板提供“全文/当前页”、类型和作者/内容搜索。点击批注调用 `setPageIndex(annotation.pageIndex)`，并以 `aria-selected` 和明显选中态反馈。

- [x] **Step 4: 构建验证**

Run: `npm test && npm run build`

Expected: 全部测试通过，TypeScript 无错误。

### Task 3: 0.3a 编辑、删除和撤销联动

- [x] **Step 1: 写编辑命令测试**

断言 `createAnnotationUpdate(before, draft, now)` 只修改内容、作者、主题、颜色、透明度和修改时间，保留页码、类型、几何、PDF 身份、创建时间、标志和回复关系。

- [x] **Step 2: 实现属性编辑器**

选中批注后显示内容、作者、主题、颜色和透明度。提交生成单个 `update` 命令；未发生变化时禁用提交。只读或无批注权限时控件只读。

- [x] **Step 3: 实现可逆删除**

删除前明确确认，执行 `delete` 命令后刷新全文批注和页面；撤销/重做后同样刷新，并恢复或清除选择。

- [x] **Step 4: 自动验证**

Run: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 前端和 Rust 全部通过。

### Task 4: 0.3a 真实文档内部验收

- [x] **Step 1: 密集批注读取**

通过 embedded WebDriver 驱动真实 Tauri WebView 打开用户提供的 380 页样本，断言全文总数为 253 条 Highlight，点击第 5 页批注可定位并显示属性编辑器；稳定用例约 7 秒通过。

- [x] **Step 2: 更新往返**

只在临时副本更新一条批注的内容、作者、主题、颜色和透明度；导出、关闭、重开，断言批注总数、几何、创建时间和其余 252 条批注保持一致。

- [x] **Step 3: 删除与撤销/重做**

在临时副本删除目标批注，断言数量减少；撤销恢复、重做再次删除；保存重开后状态与最后一次操作一致。证据见 `docs/validation/0.3a.md` 应用 Worker 往返（252 → 253 → 252，导出最终删除状态重开仍为 252）。

- [x] **Step 4: 更新验证记录**

在 `docs/validation/0.3a.md` 记录环境、样本指纹、可观察结果、自动检查和未覆盖项；清理所有临时导出文件，不修改用户原件。

### Task 5: 0.3b–0.3d 后续批次

- [x] **0.3b 文字标记**：从 StructuredText 选区生成真实 QuadPoints，支持高亮、下划线、删除线和波浪线；跨行选区按行生成四边形。实现与验证见 `src/pdf/text-markup.ts`、`src/pdf/annotation-write.ts` 与 `docs/validation/0.3b.md`；旋转页与 CropBox 偏移已通过引擎回归测试和 Tauri WebView 创建/撤销/重做/导出重开内测，仍待第三方复杂语料与 PDF-XChange/Adobe Reader 外部交叉验证。
- [ ] **0.3c 绘图工具**：墨迹实时预览及压感、直线/箭头/矩形/椭圆/多边形/折线、自由文本和印章；样式默认按工具保存。
- [ ] **0.3d 专业审阅**：回复关系、接受/拒绝/已解决状态、FDF/XFDF 导入导出、评论汇总、扁平化和批注比较。

## 0.3a 门禁

- 全文批注列表不能只显示当前页，也不能把页面渲染结果当作批注数据源。
- 编辑不得改变未编辑几何、批注类型、创建时间或 PDF 对象身份；保存后由 MuPDF 更新 appearance stream。
- 只读文档不能绕过权限；日期缺失不得伪造为 1970 年。
- 380 页/253 条真实样本完成读取、定位、更新、删除、撤销/重做和保存重开。
- 不生成安装包；所有阻断级和重要级审查问题关闭后，才进入 0.3b。
