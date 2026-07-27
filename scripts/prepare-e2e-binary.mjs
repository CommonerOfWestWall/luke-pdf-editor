import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const targetDirectory = resolve("src-tauri", "target", "debug");
await copyFile(
  resolve(targetDirectory, "luke-pdf-editor.exe"),
  resolve(targetDirectory, "鲁科 PDF 编辑器.exe"),
);
