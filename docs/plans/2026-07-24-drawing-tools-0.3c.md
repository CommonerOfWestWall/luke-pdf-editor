# 绘图与自由批注 0.3c Implementation Plan

> **执行规则：** 按 `executing-plans` 逐任务实施；每个任务先写最小失败测试，再实现、内测和更新功能矩阵。Critical/Important 审查问题未关闭前不得进入下一任务。

**Goal:** 在不阻塞页面滚动和渲染的前提下，完成墨迹、直线、箭头、矩形、椭圆、多边形、折线、自由文本和标准印章的创建闭环，并把每种工具的默认样式持久保存为本地设置。

**Architecture:** DOM/Pointer 坐标只存在于 `DocumentViewport` 的页面交互边界；输入点立即转成 MuPDF 页面空间，再转成项目统一的未旋转、Crop-relative PDF 坐标。拖动期间只在前端覆盖层预览，`pointerup`/确认时才提交一个 `AnnotationCommand.create`。Worker 继续通过 `annotation-write.ts` 写入标准批注字典并生成 appearance stream。

**技术事实与边界：**

- MuPDF 1.28 的标准 Ink 接口把几何保存为 `InkList`（笔画与顶点），线宽来自统一 Border；它没有逐顶点压力字段。
- 第一阶段用 `PointerEvent.pressure` 驱动实时预览，并把标准 `InkList` + 统一线宽作为跨阅读器正式数据。不得把“预览有压感”描述为“压力曲线已跨阅读器保存”。
- 若要永久保留变宽笔迹，必须另做“标准 InkList 回退 + 自定义 appearance stream”的兼容性验证；PDF-XChange、Adobe Reader、Edge 和本应用均通过前，不升级为 ✅。
- 不引入第二 PDF 引擎；只参考 PDF.js annotation editor、Xournal++ 等项目的输入组织和测试方法，不复制其源码或界面。

---

## 文件结构

- `src/pdf/drawing-tools.ts`：工具类型、压力归一、点采样、矩形/端点/顶点几何和最小尺寸校验的纯函数。
- `src/pdf/drawing-tools.test.ts`：鼠标/触笔压力、退化几何、反向拖动、旋转页/CropBox 坐标和取消行为测试。
- `src/app/DocumentViewport.tsx`：Pointer 捕获、合并事件读取、页面边界转换、前端预览层和提交回调。
- `src/app/App.tsx`：工具栏、创建命令、样式上下文栏和权限/忙碌状态门控。
- `src/app/store.ts`：仅保存当前工具；进行中的笔画保留在页面组件局部状态，切文档/切工具时丢弃。
- `src/app/annotation-tool-defaults.ts`：按工具读取、校验和保存默认样式；使用版本化本地 schema。
- `src/pdf/annotation-write.ts`：只扩展已验证的标准字典写入，不接收 DOM 坐标。
- `test/e2e/drawing-tools.e2e.ts`：真实 Tauri WebView 创建、取消、撤销/重做、导出重开。
- `docs/validation/0.3c.md`、`docs/feature-matrix.md`：每批证据与未通过边界。

### Task 1：绘图输入与几何内核

- [x] **Step 1：写失败测试**

覆盖：

- 鼠标 `pressure=0` 使用固定压力，触笔压力钳制到 `[0, 1]`。
- 相邻同坐标事件去重，但保留首尾点；小幅抖动不能产生数千顶点。
- 任意方向拖动都生成归一矩形；直线/箭头保留起止方向。
- Ink 至少两个不同点，矩形/椭圆至少达到可见尺寸，多边形至少 3 点，折线至少 2 点。
- `/Rotate 90` 与非零 CropBox 原点页面中，页面点转内部坐标后仍保持同一视觉位置。

- [x] **Step 2：实现纯函数**

实现最小数据模型：

```ts
interface PointerSample {
  point: PdfPoint;
  pressure: number;
}

type DrawingTool = "ink" | "line" | "arrow" | "rectangle" | "ellipse" | "polygon" | "polyline";
```

不在本任务引入 UI、存储或第三方依赖。

- [x] **Step 3：相关验证**

Run:

```powershell
npm test -- src/pdf/drawing-tools.test.ts src/pdf/coordinates.test.ts src/pdf/annotation-write.test.ts
```

Expected: 新增测试与现有坐标/字典测试全部通过。

结果：3 个测试文件、18 项测试通过；其中 `drawing-tools` 新增 6 项。证据见 `docs/validation/0.3c.md`。

### Task 2：墨迹实时预览与单命令提交

- [ ] **Step 1：页面 Pointer 状态机**

只在 `ink` 工具激活、文档允许批注且页面可交互时响应主指针。使用 `setPointerCapture`；优先读取 `getCoalescedEvents()`，无支持时退回当前事件。`pointercancel`、`Esc`、切页、切文档、切工具只清预览，不写 PDF。

- [ ] **Step 2：前端即时预览**

用独立覆盖层绘制笔画；预览不能等待 Worker。鼠标使用固定宽度；触笔按归一压力调整预览段宽。页面缩放/旋转后预览仍与底图对齐。

- [ ] **Step 3：创建标准 Ink**

`pointerup` 时把整条笔画作为一个 `AnnotationCommand.create` 提交，几何写入 `InkList`，统一 Border 宽度来自工具样式。命令成功前保留可见预览，失败则清除并显示错误；成功后刷新页面和全文评论。

- [ ] **Step 4：交互测试**

覆盖鼠标、模拟触笔、取消、快速切工具、撤销/重做和只读权限。确认每条笔画只产生一个 journal operation。

### Task 3：拖拽图形（直线、箭头、矩形、椭圆）

- [ ] **Step 1：统一拖拽状态机**

直线/箭头输出两个有方向端点；矩形/椭圆输出归一 `rect`。`Shift` 约束水平/垂直/45° 线段或正方形/正圆；小于最小尺寸的拖动视为取消。

- [ ] **Step 2：样式与标准字典**

支持描边色、填充色/无填充、透明度、线宽、虚线和箭头端点。若 MuPDF 当前 JS 接口不能稳定写入某项，先保持控件禁用并在矩阵中记录，不直接改原始字典猜测格式。

- [ ] **Step 3：往返测试**

每种类型执行创建 → 撤销 → 重做 → 导出 → 重开，比较类型、端点/矩形、颜色、填充、线宽和 appearance stream 可渲染性。

### Task 4：多边形、折线、自由文本和标准印章

- [ ] **Step 1：多点工具**

单击追加顶点，双击或 `Enter` 完成，`Backspace` 删除最后一点，`Esc` 取消。多边形自动闭合，折线不闭合；不得把未完成草图写入恢复日志。

- [ ] **Step 2：自由文本**

拖出矩形后显示就地文本编辑器；`Ctrl+Enter` 提交、`Esc` 取消。保存字体族、字号、文本色、边框和填充；首批只承诺 MuPDF 可嵌入/稳定合成的字体策略。

- [ ] **Step 3：标准印章**

先支持 MuPDF 能稳定重建 appearance 的标准印章名称；自定义图片印章单独验证图片格式、尺寸上限、透明度、许可和保存体积后再开放。

### Task 5：工具默认样式与属性栏

- [ ] **Step 1：版本化 schema**

每种工具独立保存颜色、透明度、线宽、填充、线型、端点、字体和字号。读取时逐字段校验并回退默认值；损坏的本地设置不能阻止应用启动。

- [ ] **Step 2：科学的上下文交互**

只显示当前工具适用的属性；“设为此工具默认样式”必须显式触发。创建中的草图锁定起笔时样式，修改工具栏不能改变已经提交的批注。

- [ ] **Step 3：键盘和无障碍**

工具可经命令搜索激活；`Esc` 退出或取消，空格临时抓手不丢草图；控件具备名称、焦点顺序和高对比度状态。

### Task 6：0.3c 内测与外测门禁

- [ ] **Step 1：自动门禁**

Run:

```powershell
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug --no-bundle
```

- [ ] **Step 2：Tauri E2E**

对所有工具至少各一条用例；特别覆盖旋转页、非零 CropBox、高 DPI、快速笔迹、取消、撤销/重做、导出重开和切换文档。测试仅使用运行时语料或合法副本，不修改用户原件。

- [ ] **Step 3：跨阅读器外测**

在 PDF-XChange、Adobe Reader、Edge 和本应用交叉打开；比较位置、线宽、填充、端点、文本、印章、评论元数据和打印效果。由第三方创建的同类批注也要在本应用读取。

- [ ] **Step 4：状态更新**

只有对应工具的自动测试、Tauri 内测和跨阅读器外测都有证据，才把功能矩阵从 🟡 升为 ✅；压感 appearance 未完成前单独标为部分支持。

## 0.3c 非目标

- 本批不实现对象级文本/图片/矢量内容编辑。
- 本批不实现批注选择框、移动、缩放、复制粘贴和多选；这些进入紧随其后的 0.3c.1 编辑手柄批次，不能用“可以创建”替代“可编辑”。
- 本批不生成 MSI、NSIS 或便携包。
