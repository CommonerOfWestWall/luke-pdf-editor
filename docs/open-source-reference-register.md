# 开源参考与复用登记

本表记录鲁科 PDF 编辑器可借鉴或复用的开源项目。登记不等于引入依赖；任何源码复制、二进制集成或新增运行时依赖都必须另行完成许可证、维护性、安全和体积评审，并更新第三方声明。

更新时间：2026-07-27。

| 项目 | 许可证/边界 | 可借鉴或复用的能力 | 当前决策 |
|---|---|---|---|
| [MuPDF](https://github.com/ArtifexSoftware/mupdf) | AGPL-3.0 或商业许可 | PDF 渲染、文本、标准批注、表单、文档写回 | 已采用 MuPDF.js 作为唯一 PDF 内核；应用整体 AGPL-3.0-or-later |
| [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | 虚拟页面、文本层、可访问性、键盘导航、评论侧栏与 annotation editor 的 Ink/FreeText 输入、序列化和视觉回归思路 | 参考交互和测试思路；不引入第二渲染引擎。0.3c 仅研究行为与测试，不复制实现；复用代码前逐文件确认 NOTICE |
| [Okular](https://github.com/KDE/okular) | 仓库按文件使用 GPL/LGPL/BSD/MIT 等 SPDX 标识 | 批注工具组织、目录/附件、演示、打印和多格式查看工作流 | 只作产品与测试参考；混合许可证使整段复制风险较高 |
| [Xournal++](https://github.com/xournalpp/xournalpp) | GitHub 标识 GPL-2.0；实际复用前逐文件核对 SPDX | 笔迹延迟、压感、橡皮擦、套索、多设备输入体验 | 现阶段只参考行为与测试场景；完成 AGPLv3 兼容性确认前不复制代码 |
| [Sioyek](https://github.com/ahrm/sioyek) | 引入前逐文件复核 | 研究论文快速打开、标记、概览、智能跳转、双显示器阅读 | 参考研究阅读工作流，不作为 PDF 写回内核 |
| [SumatraPDF](https://github.com/sumatrapdfreader/sumatrapdf) | GPL-3.0；部分第三方文件另有许可证 | 有界渲染队列、瓦片缓存、任务取消、渲染代次与诊断视图 | 参考渲染调度和性能诊断；不引入其 Windows UI/第二内核 |
| [qpdf](https://github.com/qpdf/qpdf) | Apache-2.0 | 内容保持型结构变换、加密、拆分合并、线性化和结构检查 | 页面组织与发布验证阶段评估原生库/命令行边界；不替代 MuPDF 渲染 |
| [PDF Arranger](https://github.com/pdfarranger/pdfarranger) | GPL-3.0 | 页面多选、拖放重排、裁剪、拆分合并交互 | 参考页面整理交互；底层能力优先由 MuPDF/qpdf 提供 |
| [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) | MPL-2.0；组件另有许可证 | Tesseract 流水线、自动旋转/纠偏、可搜索文本层、OCR 质量控制 | OCR 阶段优先评估隔离子进程集成，并完整登记其外部依赖 |
| [Stirling PDF](https://github.com/Stirling-Tools/Stirling-PDF) | 当前为 open-core，功能与版本边界需逐项复核 | 批处理、转换、OCR、脱敏和工具编排的产品覆盖 | 仅作功能发现和流程参考，不直接依赖其服务端架构 |

## 开源仓库说明参考

| 参考 | 借鉴内容 | 鲁科采用方式 |
|---|---|---|
| [GitHub README 指南](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) | README 优先回答用途、价值、开始方式、帮助渠道和维护信息；长文档下沉 | 根 README 聚焦定位、能力、下载、运行、架构和参与入口，详细证据保留在 `docs/` |
| [GitHub 健康贡献指南](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions) | LICENSE、CONTRIBUTING、行为准则、安全策略、Issue/PR 模板 | 补齐社区健康文件、私密漏洞报告入口和结构化模板 |
| [PDF.js](https://github.com/mozilla/pdf.js) | 简洁说明项目目标、快速开始、构建和贡献路径 | README 首屏先说明项目边界，源码运行与贡献独立成节 |
| [Okular](https://github.com/KDE/okular) | 下载、手册、缺陷、源码、贡献和构建入口分明 | 将 Releases、Issues、Discussions、贡献与支持渠道明确分流 |

## 复用决策规则

1. 先确认用户工作流与可观察验收，再决定自研、库集成、子进程或只参考交互。
2. 同一职责只保留一个权威实现；PDF 页面渲染和批注写回不得再引入并行引擎。
3. 许可证结论精确到实际版本和文件，不根据 GitHub 仓库标签替代法律文本。
4. 依赖必须可离线工作、可固定版本、可生成 SBOM，并有维护停止后的替换方案。
5. 复用代码必须保留版权与许可证声明；参考 UI 时不得复制商标、图标、文案或像素级布局。
6. 外部命令行工具只通过受限参数、临时目录和明确资源上限调用，文档内容不得上传网络。

本轮逐文件研究结论与固定提交见 [`docs/research/2026-07-22-open-source-pdf-viewers.md`](research/2026-07-22-open-source-pdf-viewers.md)。
