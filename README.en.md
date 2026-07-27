# Luke PDF Editor

[![CI](https://github.com/CommonerOfWestWall/luke-pdf-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/CommonerOfWestWall/luke-pdf-editor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/CommonerOfWestWall/luke-pdf-editor?include_prereleases)](https://github.com/CommonerOfWestWall/luke-pdf-editor/releases)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

[简体中文](README.md) | English

Luke PDF Editor is a local-first Windows application for PDF review, annotation, and long-document workflows. Its first priority is reviewing structured PDF output produced by Luke Look, while the longer-term goal is a modern open-source PDF workstation.

> **Status: public preview.** v0.3.5 has passed the repository's current automated and desktop regression gates. OCR, form authoring, page organization, content-object editing, crash recovery, complete accessibility, and full cross-viewer compatibility are not finished. The project does not yet claim to replace PDF-XChange Editor.

![Luke PDF Editor review workspace](docs/design/audit-2026-07-27-self-check/02-review-workspace.png)

## Highlights

- Fully offline core workflow; no account or cloud service required.
- Standard PDF annotations remain the source of truth.
- Multi-document tabs, virtualized long documents, full-text search, real thumbnails, and common text markup.
- Structured Luke Look issue list with source-page navigation and an editable comments sidebar.
- Windows file association candidate and Explorer first-page thumbnail provider.
- Explicit feature matrix separating verified, partial, and planned capabilities.

## Download

Download the latest Windows x64 preview installer from [GitHub Releases](https://github.com/CommonerOfWestWall/luke-pdf-editor/releases).

The current installer is Simplified Chinese and unsigned, so Windows may show an unknown-publisher warning. It registers Luke as a PDF application candidate but does not bypass Windows user consent to force the default application.

## Build from source

Requirements:

- Windows 10/11 x64 and WebView2 Runtime
- Node.js 24+
- npm 11+
- Rust 1.95+

```powershell
git clone https://github.com/CommonerOfWestWall/luke-pdf-editor.git
cd luke-pdf-editor
npm install
npm run tauri dev
```

Run the primary checks:

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

See the Chinese [README](README.md), [feature matrix](docs/feature-matrix.md), [roadmap](docs/roadmap.md), and [contribution guide](CONTRIBUTING.md) for the complete project status.

## License

Luke PDF Editor is licensed under [GNU AGPL-3.0-or-later](LICENSE). MuPDF.js is dual-licensed; this project uses its AGPL option. See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution.
