# 鲁科 PDF 编辑器开发说明

## 技术栈与边界

- 前端使用 React、TypeScript、Vite、Zustand；PDF 操作只能通过 `src/pdf/pdf-client.ts` 进入 Worker。
- 桌面层使用 Tauri 2；任意文件路径必须先在 Rust 中注册为会话，保存时只接受会话令牌和原始 PDF 字节。
- MuPDF JavaScript 必须保持禁用文档 JavaScript；不要为了兼容文件而开启不受信任脚本。
- PDF 内部坐标统一为未旋转页面、point、左下角原点；DOM 坐标只能在坐标转换模块边界出现。
- 批注字典写入集中在 `src/pdf/annotation-write.ts`：
  - 文字标记、墨迹、直线/箭头、多边形/折线等类型禁止 `setRect`（MuPDF 直接抛错）；它们的 `/Rect` 由 `update()` 从 QuadPoints/InkList/Line/Vertices 自动推导。
  - `hasRect()`、`hasQuadPoints()` 等探测是类型门控，不代表字典中是否已有该条目。
  - 新建批注必须先过 `assertAnnotationCreatable` 几何校验；缺少几何时 `update()` 会推导出 INT_MAX/INT_MIN 的损坏矩形。
- 文字标记选区几何在 `src/pdf/text-markup.ts`：StructuredText 字符 quad（页面空间，y 向下）按行合并后统一转入内部 PDF 坐标。

## 常用检查

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 变更规则

- 新增或修改功能时同步更新 `docs/feature-matrix.md`。
- 修改引擎、坐标、存储、许可或安全边界前新增 ADR。
- 每个缺陷先写最小复现测试；PDF 兼容问题应增加可合法提交的最小 PDF fixture。
- 不复制 PDF‑XChange 的代码、图标、文案、商标或像素级界面。
- 不在日志中记录文档内容、批注正文或完整本地路径。
