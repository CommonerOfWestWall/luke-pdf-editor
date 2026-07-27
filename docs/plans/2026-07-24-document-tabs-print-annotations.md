# 多文档、文字批注与打印预览实施计划

## 目标

本批修复当前工作区中四个可观察缺口：

1. 每个已打开 PDF 拥有独立 Worker、撤销栈、脏状态和视图状态，可通过标签切换与关闭。
2. 标题栏显示应用版本号，不再用“本地离线”占用产品状态位。
3. 文字标记立即创建且不打断连续标注，评论可在右侧栏现在或以后填写；便签与自由文本选择页面位置后在右侧栏输入正文。
4. 打印预览支持页范围和“打印批注”开关；打印批注时，正文页面保持原尺寸，批注正文排在页外侧栏，并用半透明虚线连接到对应位置。

## 假设与边界

- 多文档标签采用“一文档一 `PdfClient`”模型，不在切换时重复导出/打开 PDF，确保未保存修改和撤销历史不丢失。
- 正式 PDF 批注仍是唯一数据源；评论写入标准批注 `/Contents`，自由文本使用标准 `FreeText`。
- MuPDF `Page.toPixmap(..., showExtras)` 的最后一个参数用于控制批注/表单等页面附加内容；普通查看保持 `true`，无批注打印使用 `false`。
- 打印预览先渲染当前预览页；实际打印会为所选页生成独立打印页面。大量页码会显示准备进度，不预先渲染整份文档。
- 首批打印输出使用 WebView2/浏览器系统打印对话框；Windows 原生打印参数深度集成留待打印兼容矩阵完成后单独立项。

## 受影响文件

- `src/app/App.tsx`
- `src/app/DocumentViewport.tsx`
- `src/app/store.ts`
- `src/app/PrintPreviewDialog.tsx`（新增）
- `src/app/AnnotationComposer.tsx`（新增）
- `src/app/document-tabs.ts`（新增）
- `src/app/print-layout.ts`（新增）
- `src/pdf/contracts.ts`
- `src/pdf/pdf-client.ts`
- `src/pdf/pdf.worker.ts`
- `src/pdf/coordinates.ts`
- `src/styles.css`
- `docs/feature-matrix.md`

## 里程碑与验收

### M1 多文档会话

- 连续打开两个 PDF 后显示两个标签。
- 切换标签恢复页码、缩放、旋转、批注列表和未保存状态。
- 激活标签前退役该文档的旧渲染作用域，防止新的页面任务被调度器误判为过期；双向切换后至少一张当前页位图必须满足 `naturalWidth > 0`。
- 关闭脏标签时明确确认；关闭活动标签后选择相邻标签。
- `Ctrl+O` 新增标签，不替换当前文档。

### M2 批注输入

- [x] 高亮/下划线/删除线/波浪线支持 `H/U/S/W`；既可先激活工具后拖选，也可先选中文字再按快捷键。
- [x] 文字标记生成真实 QuadPoints 后立即创建，工具保持激活；不弹出阻断窗口，`/Contents` 可在右侧栏现在或以后填写。
- [x] 便签和文本框可用 `N/T` 进入放置态，点击页面后在右侧栏输入正文；取消不创建 PDF 对象。
- [x] 新批注创建后在右侧列表可见、可定位、可继续编辑，撤销/重做有效。

### M3 打印预览

- `Ctrl+P` 和命令栏标准打印图标打开预览；图标提供可访问名称和快捷键提示。
- 支持当前页、全部页、自定义页码范围。
- 关闭“打印批注”时以 `showExtras=false` 渲染。
- 打开“打印批注”时，页面内容区不覆盖评论；页外批注条与原位置用半透明虚线连接。
- 打印前完整准备所选页面，准备中可取消关闭；随后进入系统打印对话框。

### M4 验证

- 新增单元测试覆盖标签快照、页码范围、批注侧栏防重叠、旋转页面点击坐标。
- 新增回归覆盖双 PDF 双向切换后的实际位图、审读详情方向键前后跳转与页码同步。
- `npm run check`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- 使用鲁科 Look 真实审读样本完成多标签、文字批注、打印预览的浏览器内测并保存前后截图。
