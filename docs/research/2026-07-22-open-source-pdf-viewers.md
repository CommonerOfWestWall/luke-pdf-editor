# 开源 PDF 阅读器代码研究（2026-07-22）

## 目的与边界

本轮直接检查成熟开源项目的实际源码，不只看功能宣传。研究用于确定可复用依赖、交互模式和测试策略；本项目继续以 MuPDF.js 为唯一 PDF 内核，不引入第二渲染引擎，也不直接复制上游 UI、图标或文案。

## 固定研究版本

| 项目 | 检查提交 | 重点源码 | 结论 |
|---|---|---|---|
| [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) | `f97c0a0a` | `examples/simple-viewer/worker.js`、`viewer.js` | Worker 隔离方向正确；可见页观察、进行中请求合并和迟到结果丢弃值得纳入统一调度器 |
| [PDF.js](https://github.com/mozilla/pdf.js) | `0c8f6705` | `web/pdf_rendering_queue.js`、`pdf_thumbnail_view.js`、`pdf_thumbnail_viewer.js` | 正文/缩略图共享优先级队列；非最高优先级任务可暂停；已有正文画布可降采样复用为缩略图 |
| [SumatraPDF](https://github.com/sumatrapdfreader/sumatrapdf) | `1d6244a2` | `src/RenderCache.h`、`RenderCache.cpp` | 请求队列有硬上限、支持当前任务中止，并用文档/页码/旋转/缩放/渲染代次隔离缓存；调试视图可解释缓存行为 |
| [Okular](https://github.com/KDE/okular) | `d1687b9a` | `part/thumbnaillist.cpp`、`core/documentcommands.cpp` | 只请求可见缩略图；缩略图可显示正文当前可见区域；连续拖动/文字编辑命令可合并，签名后需特殊处理撤销历史 |
| [Sioyek](https://github.com/ahrm/sioyek) | `5a262027` | `pdf_viewer/pdf_renderer.cpp`、`document_view.cpp` | 缩放变化会淘汰过时待处理请求；新分辨率未就绪时可暂用最接近缩放的旧纹理，避免缩放白屏；研究阅读的 portal/overview 可形成差异化功能 |

## 对鲁科 PDF 编辑器的直接决策

1. **保留单内核、单 Worker。** MuPDF.js 同时承担渲染、文本、批注和写回；PDF.js 只作 UI、可访问性和调度参考。
2. **当前缩略图采用有界虚拟窗口。** 仅挂载视口与缓冲项，低分辨率请求延迟、错峰提交，并由独立 24 MiB LRU 缓存约束内存。
3. **新增统一渲染调度器任务。** 下一轮把正文、缩略图、搜索/文字层请求纳入显式优先级；支持队列去重、尚未开始任务取消、在途结果代次丢弃和可观察统计。
4. **新增正文结果复用任务。** 页面正文已有同代次渲染结果时，优先降采样生成缩略图，减少重复 MuPDF 渲染；没有结果再发缩略图请求。
5. **新增缩略图视口指示。** 在当前页缩略图上绘制正文可见区域，宽页、工程图和高倍缩放时比单纯页码选中更有用。
6. **批注命令支持合并。** 墨迹连续采样、拖动、缩放和文本连续输入需要合并成用户语义上的一次撤销；签名、永久脱敏等不可逆/破坏签名的操作使用独立历史策略。
7. **提供渲染诊断面板。** 开发模式记录队列长度、缓存字节、命中率、迟到结果、页面耗时和取消延迟，作为 200/1000 页性能门禁的证据。

## 许可证结论

- MuPDF.js 为 AGPL-3.0，本项目整体采用 AGPL-3.0-or-later，与当前集成一致。
- PDF.js 为 Apache-2.0，可兼容参考或复用，但实际复制仍需保留版权与 NOTICE。
- SumatraPDF 与 Sioyek 仓库主许可证为 GPL-3.0；Okular 本轮检查文件标记 GPL-2.0-or-later。它们与 AGPL 项目并不意味着可不经审查直接复制，任何复用仍须逐文件登记来源和修改。
- Stirling PDF 当前为 open-core，只用于功能覆盖、批处理和工具编排研究，不作为本地查看器源码来源。

## 未采用的路线

- 不把 PDF.js 与 MuPDF.js 并列为两个渲染/写回内核，避免坐标、字体、批注 appearance 和保存语义分裂。
- 不直接嵌入完整上游 viewer；鲁科需要 Windows 桌面文件安全边界、专业批注工作区和统一设计系统。
- 不以 GitHub star 数或仓库宣传替代代码、许可证、性能和真实 PDF 往返验证。
