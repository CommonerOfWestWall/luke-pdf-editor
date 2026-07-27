# GitHub 开源发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前鲁科 PDF 编辑器工作树整理为可公开审阅、可复现构建、可参与贡献的 GitHub 开源仓库，并发布 v0.3.5 受控外测预发行版。

**Architecture:** 保留现有 Rust/Tauri/React/MuPDF 边界，不改产品功能；本批只整理公开文档、社区健康文件、CI 和发布元数据。历史计划与验证记录保留原始版本事实，项目入口文档统一指向当前 v0.3.5 状态。公开前对待提交文件、忽略规则、敏感信息和大文件进行检查，公开后再设置仓库描述、主题、安全能力和预发行版。

**Tech Stack:** Markdown、Git、GitHub CLI、GitHub Actions、npm、Cargo、NSIS

---

### Task 1：公开文档入口

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SUPPORT.md`
- Create: `docs/roadmap.md`

- [ ] **Step 1: 重写 README 信息架构**

加入项目定位、截图、能力状态、下载、安装、快捷键、开发、架构、路线图、贡献、许可证和项目边界；禁止宣称已完整替代 PDF-XChange。

- [ ] **Step 2: 对齐贡献与安全说明**

把版本支持范围更新为 `0.3.x`，写明私密漏洞报告入口、测试文件隐私要求、分支/测试/PR 门槛。

- [ ] **Step 3: 增加社区健康文档**

新增变更日志、行为准则、支持渠道和面向贡献者的公开路线图。

- [ ] **Step 4: 扫描失效链接和本机路径**

Run:

```powershell
rg -n --glob '*.md' 'C:\\Users|E:\\|file://|TODO|TBD' .
```

Expected: 公开入口文档无本机路径和占位内容；历史验证记录中的版本号保持原样。

### Task 2：GitHub 自动化与仓库健康

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/ISSUE_TEMPLATE/documentation.yml`

- [ ] **Step 1: 扩充 CI**

在 Windows CI 中检查前端测试/构建、主程序 Rust fmt/clippy/test、缩略图处理器 fmt/clippy/test。

- [ ] **Step 2: 完善贡献入口**

缺陷模板要求版本、复现步骤、脱敏日志和可合法分享的最小 PDF；新增文档问题模板，PR 模板覆盖测试、数据丢失、许可证和截图。

- [ ] **Step 3: 配置依赖更新**

为 npm、Cargo、缩略图 Cargo 和 GitHub Actions 配置每周 Dependabot。

### Task 3：公开前仓库审计

**Files:**
- Verify: all files selected by `git status --short`

- [ ] **Step 1: 检查忽略与大文件**

Run:

```powershell
git check-ignore -v work src-tauri/target node_modules dist
```

Expected: 测试语料、构建产物和依赖目录全部被忽略。

- [ ] **Step 2: 检查密钥和本机数据**

Run:

```powershell
rg -n --hidden -g '!node_modules/**' -g '!src-tauri/target/**' -g '!work/**' '(gho_|github_pat_|BEGIN .*PRIVATE KEY|api[_-]?key|C:\\Users\\|E:\\)'
```

Expected: 无凭证、私钥或真实用户 PDF 路径进入提交。

- [ ] **Step 3: 运行完整质量门禁**

Run:

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/thumbnail-handler/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/thumbnail-handler/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/thumbnail-handler/Cargo.toml
```

Expected: 所有命令退出码为 0。

### Task 4：创建并发布 GitHub 仓库

**Files:**
- Stage: entire audited project worktree

- [ ] **Step 1: 创建初始提交**

将当前无提交分支重命名为 `main`，显式检查 staged diff 和大文件后提交：

```powershell
git branch -M main
git add -A
git diff --cached --check
git commit -m "feat: publish Luke PDF Editor"
```

- [ ] **Step 2: 创建公开仓库并推送**

Run:

```powershell
gh repo create CommonerOfWestWall/luke-pdf-editor --public --source . --remote origin --push
```

Expected: `main` 推送成功，仓库可公开访问。

- [ ] **Step 3: 设置仓库元数据与安全能力**

设置中英文描述、主页、topics、Issues、Discussions、私密漏洞报告和默认分支保护；仓库未支持的设置必须记录而不能假装成功。

- [ ] **Step 4: 发布 v0.3.5 预发行版**

创建 `v0.3.5` tag 和 GitHub prerelease，上传本轮已验证的中文 NSIS 安装包，发行说明明确未签名、Windows 范围和已知限制。

- [ ] **Step 5: 验证远端**

检查仓库公开性、默认分支、CI、Release 资源、LICENSE 检测、README 链接和安装包 SHA-256，并记录最终 URL。
