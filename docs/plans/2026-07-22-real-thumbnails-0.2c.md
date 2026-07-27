# 真实页面缩略图 0.2c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将左侧数字占位符替换为清晰、可旋转、受内存限制且不会预渲染整篇文档的真实 PDF 页面缩略图。

**Architecture:** 继续复用唯一的 `PdfClient`/MuPDF Worker，不引入第二 PDF 引擎。缩略图列表保持虚拟化；每个可见项延迟提交低分辨率渲染，使正文首屏请求先进入 Worker。结果按文档、修订、页面、比例和旋转进入独立的小容量 LRU 缓存，组件卸载后只丢弃迟到结果并释放对象 URL。

**Tech Stack:** React 19、TypeScript、MuPDF.js Worker、Vitest、CSS。

---

## 文件结构

- `src/app/thumbnail-render.ts`：计算缩略图适配尺寸、显示比例和受限 DPR 栅格比例。
- `src/app/thumbnail-render.test.ts`：纵向、横向、旋转和 DPR 上限测试。
- `src/app/ThumbnailList.tsx`：虚拟缩略图窗口、延迟渲染、LRU 缓存、对象 URL 生命周期和失败状态。
- `src/app/App.tsx`：向缩略图传入 Worker、文档代次、修订号与旋转状态。
- `src/styles.css`：单列大预览、骨架屏、页码和选中态。
- `docs/feature-matrix.md`、`docs/validation/0.2c.md`：修正功能状态并记录门禁。

### Task 1: 缩略图几何契约

- [x] **Step 1: 写失败测试**

在 `src/app/thumbnail-render.test.ts` 断言：612×792 页面在 144×126 容器内得到不超过边界的尺寸；90° 旋转交换长宽；输出比例最多使用 2 倍 DPR。

```ts
expect(thumbnailRenderPlan(612, 792, 0, 144, 126, 3)).toEqual({
  width: 97,
  height: 126,
  rasterScale: expect.closeTo((126 / 792) * 2),
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- src/app/thumbnail-render.test.ts`

Expected: FAIL，因为 `thumbnailRenderPlan` 尚不存在。

- [x] **Step 3: 实现最小纯函数**

```ts
const visualScale = Math.min(maxWidth / rotatedWidth, maxHeight / rotatedHeight);
return {
  width: Math.max(1, Math.round(rotatedWidth * visualScale)),
  height: Math.max(1, Math.round(rotatedHeight * visualScale)),
  rasterScale: visualScale * Math.min(2, Math.max(1, outputScale)),
};
```

- [x] **Step 4: 运行目标测试**

Run: `npm test -- src/app/thumbnail-render.test.ts`

Expected: PASS。

### Task 2: 真实缩略图渲染与资源生命周期

- [x] **Step 1: 保持虚拟窗口并改为单列**

将 `COLUMNS` 改为 1、`ROW_HEIGHT` 改为 164；1000 页、600px 高列表的挂载节点必须保持在 12 个以内。

- [x] **Step 2: 为可见项接入 Worker**

新增 `ThumbnailPreview`，先读取 `ByteLruCache<RenderedPage>`；未命中时在 80ms 后调用：

```ts
client.renderPage({ pageIndex: page.index, scale: plan.rasterScale, rotation });
```

每个后续可见项再增加少量错峰延迟。清理 effect 时取消尚未提交的计时器，并丢弃已提交请求的迟到结果。

- [x] **Step 3: 管理缓存和对象 URL**

缓存预算固定为 24MiB，key 使用 `pageRenderKey(documentEpoch, renderRevision, page.index, plan.rasterScale, rotation)` 并增加缩略图前缀。文档代次变化后旧条目不可命中并由有界 LRU 淘汰；每次 PNG 变化创建对象 URL，卸载时必须 `URL.revokeObjectURL`。

- [x] **Step 4: 增加可观察状态**

加载中显示按页面比例占位的骨架；失败显示“预览失败”和页码；成功图片 `alt=""`，按钮使用 `aria-label="第 N 页"`。

### Task 3: 工作区接线与视觉验收

- [x] **Step 1: 接入应用状态**

从 `App.tsx` 向 `ThumbnailList` 传入 `pdfClient`、`documentEpoch`、`renderRevision` 和 `rotation`。批注修改或旋转后必须生成新缓存 key。

- [x] **Step 2: 更新样式**

左栏调整为约 220px，单列预览最大 144×126；保持页面比例、白色纸面和清晰选中边框，不拉伸图片。

- [x] **Step 3: 浏览器内测**

打开合法 PDF，检查首屏缩略图是真实页面而非数字占位；滚动缩略图列表时只挂载窗口项；点击缩略图定位正文；旋转和批注修订后预览刷新。

### Task 4: 门禁与文档

- [x] **Step 1: 自动检查**

Run: `npm run check`

Expected: 全部测试通过，TypeScript 与 Vite 构建成功。

- [x] **Step 2: 桌面无打包构建**

Run: `npm run tauri -- build --debug --no-bundle`

Expected: 调试可执行文件成功，且不生成 MSI/NSIS。

- [x] **Step 3: 更新矩阵和验证记录**

把“虚拟缩略图”说明改为“真实页面预览 + 有界虚拟窗口”，并在 `docs/validation/0.2c.md` 记录节点数、缓存预算、真实样本结果和未覆盖项。

## 门禁

- 1000 页文档不得预渲染全部页面，600px 高面板最多挂载 12 个缩略图按钮。
- 正文首屏渲染必须先于缩略图批量请求；缩略图请求采用延迟与错峰提交。
- 页面不能被拉伸；90°/270° 旋转必须交换预览宽高。
- 文档切换、修订和旋转后，旧结果不得覆盖当前缩略图。
- 本批不生成安装包，不宣称页面组织或基础内容编辑已经完成。
