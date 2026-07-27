import assert from "node:assert/strict";
import {
  chmodSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { browser, $ } from "@wdio/globals";

describe("Windows 文件关联启动", () => {
  it("从带空格和中文的命令行路径直接打开 PDF 内容", async () => {
    const startupPdf = process.env.LUKE_E2E_STARTUP_PDF;
    assert.ok(startupPdf, "必须通过 LUKE_E2E_STARTUP_PDF 提供启动 PDF");
    const expectedName = basename(resolve(startupPdf));

    await browser.setWindowSize(1280, 720);
    await browser.waitUntil(
      async () => await browser.execute((name) => Array.from(
        document.querySelectorAll<HTMLElement>(".document-tab"),
      ).some((tab) => tab.textContent?.includes(name)) || Boolean(
        document.querySelector(".error-banner"),
      ), expectedName),
      { timeout: 30_000, timeoutMsg: `命令行启动后既未出现文档标签也未报告错误：${expectedName}` },
    );

    const diagnostics = await browser.execute(() => ({
      tabs: Array.from(document.querySelectorAll<HTMLElement>(".document-tab"))
        .map((tab) => tab.textContent?.trim() ?? ""),
      error: document.querySelector(".error-banner")?.textContent?.trim() ?? null,
      busy: document.querySelector(".app-shell")?.getAttribute("aria-busy") ?? null,
      empty: Boolean(document.querySelector(".empty-workspace")),
    }));
    assert.ok(
      diagnostics.tabs.some((label) => label.includes(expectedName)),
      `命令行启动未打开文档：${JSON.stringify(diagnostics)}`,
    );
    assert.equal(await $(".empty-workspace").isExisting(), false, "命令行启动后仍停留在首页");
    await browser.waitUntil(
      async () => await browser.execute(() => Boolean(
        document.querySelector(".page-shadow canvas")
        || document.querySelector(".page-shadow img"),
      )),
      { timeout: 180_000, timeoutMsg: "命令行启动的 PDF 未渲染出页面内容" },
    );
    assert.equal(
      await browser.execute(() => document.querySelector(".error-banner")?.textContent ?? null),
      null,
      "命令行打开 PDF 时出现错误提示",
    );
  });

  it("保留未保存修改，并在外部文件冲突时明确阻止覆盖", async () => {
    const startupPdf = process.env.LUKE_E2E_STARTUP_PDF;
    assert.ok(startupPdf, "必须通过 LUKE_E2E_STARTUP_PDF 提供启动 PDF");
    const fixturePath = resolve(startupPdf);
    const workRelative = relative(resolve("work"), fixturePath);
    assert.ok(
      workRelative && !workRelative.startsWith("..") && !isAbsolute(workRelative),
      "保存冲突 E2E 只允许修改 work 目录中的可恢复副本",
    );
    const originalBytes = readFileSync(fixturePath);
    const originalMode = statSync(fixturePath).mode;
    const fixtureDirectory = dirname(fixturePath);
    const recoveryFilesBefore = new Set(readdirSync(fixtureDirectory).filter((name) => (
      name.startsWith(".luke-pdf-conflict-") || name.startsWith(".luke-pdf-backup-")
    )));
    chmodSync(fixturePath, 0o666);

    try {
      await $("//div[contains(@class, 'workspace-modes')]/button[normalize-space()='标注']").click();
      await $("button[aria-label='便签 (N)']").click();
      await browser.execute(() => {
        const page = document.querySelector<HTMLElement>(".page-shadow");
        if (!page) return;
        const bounds = page.getBoundingClientRect();
        page.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          clientX: bounds.left + Math.min(180, bounds.width / 2),
          clientY: bounds.top + Math.min(160, bounds.height / 2),
        }));
      });
      await expect($(".annotation-composer")).toBeDisplayed();
      await $(".annotation-composer textarea").setValue("未保存关闭与保存冲突回归");
      await $("//form[contains(@class, 'annotation-composer')]//button[normalize-space()='创建批注']").click();
      const saveButton = await $("button[aria-label='保存 (Ctrl+S)']");
      await browser.waitUntil(
        async () => await saveButton.isEnabled(),
        { timeoutMsg: "创建便签后保存按钮未进入可用状态" },
      );

      await browser.execute(() => {
        const scope = globalThis as typeof globalThis & {
          __lukeE2eConfirmMessage?: string;
          __lukeE2eOriginalConfirm?: typeof window.confirm;
          __TAURI_INTERNALS__?: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        };
        scope.__lukeE2eOriginalConfirm = window.confirm;
        window.confirm = (message) => {
          scope.__lukeE2eConfirmMessage = String(message);
          return false;
        };
        void scope.__TAURI_INTERNALS__?.invoke("e2e_request_close");
      });
      await browser.waitUntil(
        async () => Boolean(await browser.execute(() => (
          globalThis as typeof globalThis & { __lukeE2eConfirmMessage?: string }
        ).__lukeE2eConfirmMessage)),
        { timeout: 5_000, timeoutMsg: "存在未保存批注时关闭窗口未出现确认提示" },
      );
      assert.match(
        await browser.execute(() => (
          globalThis as typeof globalThis & { __lukeE2eConfirmMessage?: string }
        ).__lukeE2eConfirmMessage ?? ""),
        /尚未保存的批注/u,
      );
      await browser.execute(() => {
        const scope = globalThis as typeof globalThis & {
          __lukeE2eOriginalConfirm?: typeof window.confirm;
        };
        if (scope.__lukeE2eOriginalConfirm) window.confirm = scope.__lukeE2eOriginalConfirm;
      });
      assert.equal(await saveButton.isEnabled(), true, "取消关闭后未保存状态被错误清除");
      assert.equal(await $(".document-tab").isExisting(), true, "取消关闭后文档窗口被错误销毁");

      writeFileSync(
        fixturePath,
        Buffer.concat([originalBytes, Buffer.from("\n% external modification for e2e\n")]),
      );
      await saveButton.click();
      await browser.waitUntil(
        async () => Boolean(await browser.execute(() => (
          document.querySelector(".error-banner")?.textContent
        ))),
        { timeout: 10_000, timeoutMsg: "外部修改冲突没有显示任何可见错误" },
      );
      const conflictMessage = await browser.execute(() => (
        document.querySelector(".error-banner")?.textContent ?? ""
      ));
      assert.ok(
        conflictMessage.includes("被其他程序修改"),
        `外部修改冲突提示不准确：${conflictMessage}`,
      );
      assert.equal(await saveButton.isEnabled(), true, "保存冲突后脏状态被错误清除");

      writeFileSync(fixturePath, originalBytes);
      await saveButton.click();
      await browser.waitUntil(
        async () => !(await saveButton.isEnabled()),
        { timeout: 30_000, timeoutMsg: "恢复原文件后无法继续保存" },
      );
      assert.equal(
        await browser.execute(() => document.querySelector(".error-banner")?.textContent ?? null),
        null,
        "恢复原文件并保存成功后仍残留错误提示",
      );
    } finally {
      writeFileSync(fixturePath, originalBytes);
      chmodSync(fixturePath, originalMode);
      for (const name of readdirSync(fixtureDirectory)) {
        const isRecoveryFile = name.startsWith(".luke-pdf-conflict-")
          || name.startsWith(".luke-pdf-backup-");
        if (isRecoveryFile && !recoveryFilesBefore.has(name)) {
          unlinkSync(join(fixtureDirectory, name));
        }
      }
    }
  });
});
