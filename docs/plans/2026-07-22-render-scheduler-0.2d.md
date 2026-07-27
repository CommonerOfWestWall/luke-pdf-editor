# 统一页面渲染调度 0.2d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让正文可见页、正文缓冲页和缩略图通过同一个有界调度器进入 MuPDF Worker，支持优先级、重复请求合并、排队任务取消和可观察统计。

**Architecture:** 保持现有单 MuPDF Worker 和 RPC 契约不变，在 `PdfClient` 调用 Worker 前增加纯 TypeScript 调度层。Worker 同一时刻只接收一个页面光栅任务；每个请求携带文档/修订作用域。文档打开、关闭或修改时进入事务式生命周期闸门：成功后退休旧作用域，失败或无变化则恢复原请求；在途同步 MuPDF 调用不强行中断。React 页面和缩略图 effect 使用 `AbortController`，组件卸载时取消尚未执行的订阅。

**Tech Stack:** TypeScript、Vitest、React、MuPDF.js Worker。

---

## 文件结构

- `src/pdf/render-scheduler.ts`：优先级队列、订阅去重、排队取消、统计快照。
- `src/pdf/render-scheduler.test.ts`：顺序、提升、去重、取消、失效测试。
- `src/pdf/pdf-client.ts`：把 `renderTile` 接入调度器，并在文档生命周期与编辑命令处失效旧任务。
- `src/app/DocumentViewport.tsx`：正文使用可见/缓冲优先级与 AbortSignal；按完整身份显示渲染结果。
- `src/app/ThumbnailList.tsx`：缩略图使用最低优先级与 AbortSignal，保留错峰提交。
- `docs/feature-matrix.md`、`docs/validation/0.2d.md`：状态和门禁记录。

### Task 1: 调度器纯逻辑

- [x] **Step 1: 写失败测试**

在 `src/pdf/render-scheduler.test.ts` 覆盖：运行中任务结束前不启动第二项；`visible < buffer < thumbnail`；同 key 返回同一次 `run`；高优先级订阅提升排队任务；最后一个订阅取消后排队任务不执行；`cancelAll` 拒绝排队和在途订阅。

- [x] **Step 2: 确认测试失败**

Run: `npm test -- src/pdf/render-scheduler.test.ts`

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现最小调度器**

固定公开接口：

```ts
export type RenderPriority = "visible" | "buffer" | "thumbnail";
export interface RenderSchedulerStats {
  queued: number;
  active: number;
  completed: number;
  merged: number;
  cancelled: number;
}
export class RenderScheduler<T> {
  schedule(scope: string, key: string, priority: RenderPriority, run: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  beginTransition(reason?: Error): { complete(committed: boolean): void };
  cancelAll(reason?: Error): void;
  snapshot(): RenderSchedulerStats;
}
```

队列同一时刻只运行一项；相同 key 共享任务但每个调用拥有独立订阅；稳定序号保证同优先级先进先出。

- [x] **Step 4: 运行目标测试**

Run: `npm test -- src/pdf/render-scheduler.test.ts`

Expected: PASS。

### Task 2: PdfClient 生命周期接线

- [x] **Step 1: 增加调度选项**

`renderPage` 改为：

```ts
renderPage(
  request: RenderPageRequest,
  options: { scope: string; key: string; priority: RenderPriority; signal?: AbortSignal },
): Promise<RenderedPage>
```

内部通过调度器执行 `call("renderTile", request)`，并提供只读 `renderSchedulerStats()`。

- [x] **Step 2: 隔离文档和编辑代次**

`open`、`close`、`applyCommand`、`undo`、`redo` 使用事务式闸门：RPC 成功且实际改变文档才退休旧作用域；打开失败、编辑失败或撤销/重做无变化时恢复原渲染请求。`terminate` 永久失效当前作用域。

- [x] **Step 3: 运行 TypeScript 构建**

Run: `npm run build`

Expected: 调用点因缺少 options 暂时失败，证明公开接口已收紧。

### Task 3: 正文与缩略图接线

- [x] **Step 1: 正文优先级与同步身份隔离**

`PageSurface` 创建 `AbortController`；活动页传 `visible`，相邻缓冲页传 `buffer`。cleanup 先标记取消再 abort。渲染 state 保存 `{ key, value }`，图片 URL 也保存 key，只有与当前 `cacheKey` 相等才显示。

- [x] **Step 2: 缩略图最低优先级**

缩略图错峰计时结束后调用：

```ts
client.renderPage(request, {
  scope: `${documentEpoch}:${renderRevision}`,
  key: cacheKey,
  priority: "thumbnail",
  signal: controller.signal,
});
```

cleanup 同时清计时器和 abort，单页取消不显示“预览失败”。

- [x] **Step 3: 运行目标与全量前端检查**

Run: `npm run check`

Expected: 所有 Vitest、TypeScript 和 Vite 构建通过。

### Task 4: 内测、审查与文档

- [x] **Step 1: 浏览器内测**

使用合法长 PDF 验证首屏正文先出现；快速跳页后旧缓冲和缩略图不报错；缩略图仍只挂载虚拟窗口；旋转后不闪旧图。

- [x] **Step 2: 桌面无打包构建**

Run: `npm run tauri -- build --debug --no-bundle`

Expected: 调试可执行文件成功，不生成安装包。

- [x] **Step 3: 更新状态并独立审查**

更新功能矩阵与 `docs/validation/0.2d.md`，记录队列顺序、合并、取消、真实样本和已知限制；独立审查发现的跨文档/修订竞态与失败恢复问题均以作用域闸门回归测试封闭。

## 门禁

- 任意时刻最多向 Worker 提交一个页面光栅任务。
- 已排队的缩略图不能阻止后到达的正文可见页成为下一任务。
- 相同 key 的并发请求只执行一次底层 `renderTile`。
- 取消最后一个订阅后，未开始的任务永不执行。
- 文档打开、关闭和批注修改后，旧排队任务不能在新状态执行。
- 本批不声称能中断已经进入同步 MuPDF WASM 的光栅调用；只立即丢弃其订阅结果。
