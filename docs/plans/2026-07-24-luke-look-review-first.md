# 鲁科 Look 审读优先与 UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把项目早期目标改为鲁科 Look 审读产物的专用查看与复核工作站，并重构首页、工作区层级和右侧意见交互。

**Architecture:** 标准 PDF 批注继续是唯一正式数据源。新增纯前端 `luke-look-review.ts` 只解析鲁科 Look 写入的批注正文用于展示和筛选；解析失败时完整回退到通用 PDF 批注视图，不改变 PDF 字典或保存格式。意见列表与单条详情共享现有 `AnnotationRecord`，不新增云服务、账户或私有旁路数据。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest、现有 CSS 设计令牌、Tauri 2、MuPDF.js。

---

## 文件结构

- `src/app/luke-look-review.ts`：解析鲁科 Look 审读正文、分类和卡片摘要的纯函数。
- `src/app/luke-look-review.test.ts`：真实格式、缺字段、普通批注和筛选测试。
- `src/app/App.tsx`：首页、审读/标注模式、面板按钮、列表/详情两级交互和连续导航。
- `src/styles.css`：空状态层级、审读栏尺寸、结构化卡片和详情视图。
- `src/app/annotation-panel.ts`：保留通用 PDF 批注筛选，不承载鲁科 Look 专用解析。
- `docs/design/audit-2026-07-24/`：改造前截图与审计证据。
- `docs/feature-matrix.md`、`README.md`、`docs/plans/2026-07-22-pdf-xchange-replacement-program.md`：产品优先级和状态。
- `docs/validation/luke-look-review-first.md`：自动检查、真实样本与截图结果。

### Task 1：产品方向与验收优先级

- [x] 在产品工程文档增加“鲁科 Look 伴生工作站”阶段，并明确该阶段门禁优先于通用 PDF-XChange 追平。
- [x] 在功能矩阵增加鲁科 Look 产物识别、结构化意见、意见定位和长文档复核条目。
- [x] 重写 README 开场，首先说明与鲁科 Look 的关系，保留长期通用编辑路线作为后续目标。

### Task 2：鲁科 Look 批注解析模型

- [x] 写失败测试：解析 `【[硬伤]】[硬伤]错别字 问题片段：洁本 建议改为：节本 依据：… 提示：… 说明：…`。
- [x] 写失败测试：字段缺失、重复标签、多行内容和普通 PDF 批注必须安全回退。
- [x] 实现 `parseLukeLookReview(contents)`，返回 `severity`、`category`、`problem`、`suggestion`、`reason`、`hint`、`note` 与 `isLukeLook`。
- [x] 实现 `filterLukeLookAnnotations`，按问题分类筛选且不修改输入。
- [x] 运行 `npm test -- src/app/luke-look-review.test.ts src/app/annotation-panel.test.ts`。

### Task 3：首页与工作区层级

- [x] 空文档时隐藏模式栏和命令栏。
- [x] 首页标题改为“查看鲁科 Look 审读结果”，CTA 改为“打开审读 PDF”。
- [x] 首页说明“逐条定位问题、核对原文与修改建议；文件只在本机处理”。
- [x] 把一级模式改为“审读 / 标注”，移除尚不可用的页面、表单一级入口。
- [x] 审读模式默认打开意见栏并退出创建工具；标注模式显示现有文字标记工具。

### Task 4：右侧意见列表与详情

- [x] 右侧标题改为“审读意见”，审读模式不显示突兀的加号；添加便签保留在标注模式。
- [x] 工具栏的导航/意见开关改为 32px 高的图标+文字按钮，选中态使用弱背景而非高亮边框。
- [x] 列表卡片展示严重级别、问题分类、`问题片段 → 修改建议` 和 PDF 页码/页签；普通批注回退到作者+内容摘要。
- [x] 点击卡片切换为单条详情视图，提供“返回意见列表”、上一条、下一条和当前位置。
- [x] 详情按“问题片段、修改建议、依据、提示”分区；通用属性编辑放入次级“编辑原始批注”区域，不能抢占首屏。
- [x] 卡片和详情的主要正文不小于 12px，交互按钮可见高度不小于 32px。

### Task 5：视觉与交互验证

- [x] 运行 `npm run check`。
- [x] 用用户合法样本确认 380 页、253 条意见读取不回退，点击卡片定位第 5 页。
- [x] 在同一浏览器尺寸重新截取首页、意见列表、单条详情，并与审计截图逐项比较。
- [ ] 检查键盘焦点、可访问名称、长文本溢出、浅色/深色主题和 200% UI 缩放的可见布局。
- [x] 更新功能矩阵和验证记录；不生成安装包。

## 完成边界

- 本计划完成代表“鲁科 Look 审读查看第一轮 UI 闭环”完成，不代表完全替代 PDF-XChange。
- 接受/拒绝/已解决状态需要标准 PDF 状态写回和鲁科 Look 工作流定义，单独进入下一批，不在本轮伪造按钮。
- 不修改用户原始 PDF；浏览器内测只读打开，桌面保存测试继续使用副本或内存导出。
