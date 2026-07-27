import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const javascript = Object.entries(lock.packages)
  .filter(([path, metadata]) => path && !metadata.dev && metadata.version)
  .map(([path, metadata]) => ({
    ecosystem: "npm",
    name: path.replace(/^node_modules\//, ""),
    version: metadata.version,
    license: metadata.license ?? "未声明",
    source: metadata.resolved ?? "",
  }));

function cargoPackages(manifestPath) {
  const cargo = spawnSync(
    "cargo",
    ["metadata", "--format-version=1", "--locked", "--manifest-path", manifestPath],
    { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  if (cargo.status !== 0) {
    if (cargo.error) process.stderr.write(`${cargo.error.message}\n`);
    process.stderr.write(cargo.stderr);
    process.exit(cargo.status ?? 1);
  }
  const metadata = JSON.parse(cargo.stdout);
  const workspacePackages = new Set(metadata.workspace_members);
  return metadata.packages.filter((pkg) => !workspacePackages.has(pkg.id));
}

const rustById = new Map(
  [
    ...cargoPackages("src-tauri/Cargo.toml"),
    ...cargoPackages("src-tauri/thumbnail-handler/Cargo.toml"),
  ].map((pkg) => [pkg.id, pkg]),
);
const rust = [...rustById.values()]
  .map((pkg) => ({
    ecosystem: "Cargo",
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? (pkg.license_file ? `见 ${pkg.license_file}` : "未声明"),
    source: pkg.repository ?? pkg.source ?? "",
  }));

const entries = [...javascript, ...rust].sort((left, right) =>
  left.ecosystem.localeCompare(right.ecosystem) ||
  left.name.localeCompare(right.name) ||
  left.version.localeCompare(right.version),
);
const missing = entries.filter(({ license }) => license === "未声明");
const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = entries
  .map(({ ecosystem, name, version, license, source }) =>
    `| ${escapeCell(ecosystem)} | ${escapeCell(name)} | ${escapeCell(version)} | ${escapeCell(license)} | ${escapeCell(source)} |`,
  )
  .join("\n");

const report = `# 鲁科 PDF 编辑器第三方依赖许可证清单

本清单由锁文件生成，适用于鲁科 PDF 编辑器 ${lock.version}。它记录当前生产前端依赖和 Rust 构建解析到的依赖；项目许可证与主要组件用途另见 \`THIRD_PARTY_NOTICES.md\`。

- npm 生产依赖：${javascript.length} 项
- Cargo 解析依赖：${rust.length} 项
- 缺少许可证声明：${missing.length} 项

| 生态 | 包 | 版本 | 许可证声明 | 上游来源 |
|---|---|---:|---|---|
${rows}
`;

writeFileSync("docs/legal/THIRD_PARTY_LICENSES.md", report, "utf8");
if (missing.length) {
  process.stderr.write(`以下依赖缺少许可证声明：${missing.map(({ name, version }) => `${name}@${version}`).join(", ")}\n`);
  process.exit(1);
}
