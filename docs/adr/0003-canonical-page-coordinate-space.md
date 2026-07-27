# ADR 0003：规范 PDF 页面坐标与显示坐标分离

- 状态：已接受
- 日期：2026-07-22

## 背景

PDF 页面可能具有非零 MediaBox/CropBox 原点和内建 `/Rotate`。MuPDF 的页面边界、文本、链接及批注使用经过页面变换后的显示坐标；批注命令需要一个不随显示旋转和缩放变化的稳定坐标域。仅按页面高度翻转 Y 轴会使旋转页上的搜索高亮、链接和保存后的批注漂移。

## 决策

- `AnnotationRecord`、搜索结果与链接统一使用 CropBox 相对、未旋转、左下角原点、单位为 PDF point 的规范坐标。
- Worker 读取 `PDFPage.getTransform()`，求逆后从 `getBounds()` 推导原始 PDF 页面原点及规范宽高。
- `PageInfo` 分别保存规范 `width/height`、MuPDF 显示空间 `displayWidth/displayHeight` 和可序列化的坐标矩阵。
- Worker 在 PDF 边界转换批注、搜索结果与链接；React 只在绘制覆盖层时转换回 MuPDF 显示坐标。
- StructuredText 只用于当前页面显示与选择，保持 MuPDF 显示坐标，不进入批注的规范坐标域。

## 后果

- 非零页面框和内建旋转不会改变批注持久化坐标。
- 用户临时旋转只作用于页面与覆盖层合成，不会修改 PDF 数据。
- 坐标测试必须包含非零原点和 `/Rotate=90`，并验证点、矩形双向往返。
