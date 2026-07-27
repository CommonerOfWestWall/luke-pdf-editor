import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { browser, $, $$ } from "@wdio/globals";
import mupdf, { type PDFPage } from "mupdf";
import type { PdfQuad, PdfRect } from "../../src/pdf/contracts";
import { derivePageCoordinateSpace, pagePointToPdf } from "../../src/pdf/coordinates";
import { quadsForMarkupSelection, rectForQuads, type MarkupCharacter } from "../../src/pdf/text-markup";

function assertNumbersClose(actual: readonly number[], expected: readonly number[], message: string): void {
  assert.equal(actual.length, expected.length, `${message}：数值数量不同`);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 0.001, `${message}：索引 ${index}，实际 ${value}，预期 ${expected[index]}`);
  });
}

function assertMarkupRectContains(actual: readonly number[], expected: readonly number[]): void {
  assert.ok(actual.every(Number.isFinite), "导出重开后的 Highlight Rect 包含非有限数");
  assert.ok(actual[0] <= expected[0] && actual[1] <= expected[1], "Highlight Rect 未覆盖 QuadPoints 左下边界");
  assert.ok(actual[2] >= expected[2] && actual[3] >= expected[3], "Highlight Rect 未覆盖 QuadPoints 右上边界");
  const quadHeight = Math.max(1, expected[3] - expected[1]);
  const padding = [
    expected[0] - actual[0],
    expected[1] - actual[1],
    actual[2] - expected[2],
    actual[3] - expected[3],
  ];
  assert.ok(padding.every((value) => value <= quadHeight), "MuPDF 推导的 Highlight Rect 异常膨胀");
}

function mapPageQuadToPdf(quad: readonly number[], page: PDFPage): PdfQuad {
  const space = derivePageCoordinateSpace(page.getBounds(), page.getTransform()).space;
  const mapped = [...quad];
  for (let index = 0; index < mapped.length; index += 2) {
    const point = pagePointToPdf([mapped[index], mapped[index + 1]], space);
    mapped[index] = point[0];
    mapped[index + 1] = point[1];
  }
  return mapped as unknown as PdfQuad;
}

function expectedSelectionQuads(bytes: Uint8Array, start: number, end: number): PdfQuad[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0) as PDFPage;
  try {
    const text = page.toStructuredText("preserve-whitespace");
    try {
      const characters: MarkupCharacter[] = [];
      let line = -1;
      let index = 0;
      text.walk({
        beginLine: () => {
          line += 1;
          index = 0;
        },
        onChar: (character, _origin, _font, _size, quad) => {
          characters.push({ line, index, text: character, quad: [...quad] as PdfQuad });
          index += 1;
        },
      });
      return quadsForMarkupSelection(characters.slice(start, end))
        .map((quad) => mapPageQuadToPdf(quad, page));
    } finally {
      text.destroy();
    }
  } finally {
    page.destroy();
    doc.destroy();
  }
}

function inspectExportedHighlight(bytes: Uint8Array): { quadPoints: PdfQuad[]; rect: readonly number[] } {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
  assert.ok(doc, "导出结果不是可重开的 PDF");
  const page = doc.loadPage(0) as PDFPage;
  try {
    const derived = derivePageCoordinateSpace(page.getBounds(), page.getTransform());
    assertNumbersClose(derived.space.pdfOrigin, [40, 80], "导出后 CropBox 原点漂移");
    assertNumbersClose([derived.width, derived.height], [500, 600], "导出后 CropBox 尺寸漂移");
    const pageObject = page.getObject();
    try {
      const rotate = pageObject.get("Rotate");
      try {
        assert.equal(rotate.asNumber(), 90, "导出后页面旋转值漂移");
      } finally {
        rotate.destroy();
      }
    } finally {
      pageObject.destroy();
    }

    const annotations = page.getAnnotations();
    try {
      const highlight = annotations.find((annotation) => annotation.getType() === "Highlight");
      assert.ok(highlight, "导出重开后缺少 Highlight 批注");
      const annotationObject = highlight.getObject();
      let rect: PdfRect;
      try {
        const dictionaryRect = annotationObject.get("Rect");
        try {
          const raw = Array.from({ length: 4 }, (_, index) => {
            const value = dictionaryRect.get(index);
            try {
              return value.asNumber();
            } finally {
              value.destroy();
            }
          });
          rect = [
            raw[0] - derived.space.pdfOrigin[0],
            raw[1] - derived.space.pdfOrigin[1],
            raw[2] - derived.space.pdfOrigin[0],
            raw[3] - derived.space.pdfOrigin[1],
          ];
        } finally {
          dictionaryRect.destroy();
        }
      } finally {
        annotationObject.destroy();
      }
      return {
        quadPoints: highlight.getQuadPoints().map((quad) => mapPageQuadToPdf(quad, page)),
        rect,
      };
    } finally {
      annotations.forEach((annotation) => annotation.destroy());
    }
  } finally {
    page.destroy();
    doc.destroy();
  }
}

async function restoreDownloadInterception(): Promise<void> {
  await browser.execute(() => {
    const scope = globalThis as typeof globalThis & {
      __lukeE2eCapturedPdf?: Blob;
      __lukeE2eCreateObjectUrl?: typeof URL.createObjectURL;
      __lukeE2eAnchorClick?: typeof HTMLAnchorElement.prototype.click;
    };
    if (scope.__lukeE2eCreateObjectUrl) URL.createObjectURL = scope.__lukeE2eCreateObjectUrl;
    if (scope.__lukeE2eAnchorClick) HTMLAnchorElement.prototype.click = scope.__lukeE2eAnchorClick;
    delete scope.__lukeE2eCapturedPdf;
    delete scope.__lukeE2eCreateObjectUrl;
    delete scope.__lukeE2eAnchorClick;
  });
}

function createRotatedMarkupFixture(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  try {
    const contents = [
      "BT /F1 22 Tf 100 600 Td (The quick brown fox jumps over the lazy dog) Tj ET",
      "BT /F1 22 Tf 100 560 Td (Luke PDF rotated crop markup validation) Tj ET",
    ].join("\n");
    const page = doc.addPage([0, 0, 612, 792], 90, {
      Font: { F1: { Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" } },
    }, contents);
    page.put("CropBox", [40, 80, 540, 680]);
    doc.insertPage(0, page);
    page.destroy();
    const buffer = doc.saveToBuffer("garbage=0,compress=no");
    try {
      return new Uint8Array(buffer.asUint8Array());
    } finally {
      buffer.destroy();
    }
  } finally {
    doc.destroy();
  }
}

async function injectPdf(fileName: string, bytes: Uint8Array): Promise<void> {
  const fixtureBase64 = Buffer.from(bytes).toString("base64");
  await browser.execute(() => {
    (globalThis as typeof globalThis & { __lukeE2ePdfChunks?: string[] }).__lukeE2ePdfChunks = [];
  });
  for (let offset = 0; offset < fixtureBase64.length; offset += 512 * 1024) {
    await browser.execute((chunk) => {
      (globalThis as typeof globalThis & { __lukeE2ePdfChunks?: string[] }).__lukeE2ePdfChunks?.push(chunk);
    }, fixtureBase64.slice(offset, offset + 512 * 1024));
  }
  const injectedName = await browser.execute((name) => {
    const scope = globalThis as typeof globalThis & { __lukeE2ePdfChunks?: string[] };
    const base64 = scope.__lukeE2ePdfChunks?.join("") ?? "";
    delete scope.__lukeE2ePdfChunks;
    const binary = atob(base64);
    const content = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) content[index] = binary.charCodeAt(index);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) return null;
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], name, { type: "application/pdf" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input.files?.[0]?.name ?? null;
  }, fileName);
  assert.equal(injectedName, fileName, "测试样本未成功注入浏览器文件输入");
}

async function waitForDocument(fileName: string): Promise<void> {
  let openState: { busy: string | null; error: string | null; fileInputName: string | null; tab: string | null } = {
    busy: null,
    error: null,
    fileInputName: null,
    tab: null,
  };
  try {
    await browser.waitUntil(
      async () => {
        openState = await browser.execute(() => ({
          busy: document.querySelector(".app-shell")?.getAttribute("aria-busy") ?? null,
          error: document.querySelector(".error-banner span")?.textContent ?? null,
          fileInputName: document.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]?.name ?? null,
          tab: document.querySelector(".document-tab.is-active")?.textContent ?? null,
        }));
        return Boolean(openState.error) || Boolean(openState.tab?.includes(fileName));
      },
      { timeout: 180_000, timeoutMsg: "文档标签未显示指定测试样本，且应用未报告错误" },
    );
  } catch {
    assert.fail(
      `打开状态超时：忙碌=${openState.busy ?? "未知"}；文件输入=${openState.fileInputName ?? "空"}；标签=${openState.tab ?? "空"}；应用错误=${openState.error ?? "无"}`,
    );
  }
  assert.equal(openState.error, null, `应用打开样本失败：${openState.error}`);
  assert.ok(openState.tab?.includes(fileName), "文档标签未显示指定测试样本");
}

async function waitForAnnotationCount(count: number, timeout = 180_000): Promise<void> {
  let observed: { count: string | null; busy: string | null; error: string | null } = {
    count: null,
    busy: null,
    error: null,
  };
  try {
    await browser.waitUntil(
      async () => {
        observed = await browser.execute(() => ({
          count: document.querySelector(".comments-panel")?.getAttribute("data-annotation-count") ?? null,
          busy: document.querySelector(".app-shell")?.getAttribute("aria-busy") ?? null,
          error: document.querySelector(".error-banner span")?.textContent ?? null,
        }));
        return observed.count === String(count);
      },
      { timeout, timeoutMsg: `全文批注数量未变为 ${count}` },
    );
  } catch {
    assert.fail(`全文批注数量未变为 ${count}：${JSON.stringify(observed)}`);
  }
}

async function waitForRenderedPage(activeTabLabel: string, message: string): Promise<void> {
  const normalizedLabel = activeTabLabel.replaceAll("×", "").trim();
  let observed: {
    activeTab: string | null;
    imageWidths: number[];
    loadingCount: number;
    error: string | null;
    busy: string | null;
  } | null = null;
  try {
    await browser.waitUntil(
      async () => {
        observed = await browser.execute(() => ({
          activeTab: document.querySelector(".document-tab.is-active")?.textContent?.trim() ?? null,
          imageWidths: Array.from(document.querySelectorAll<HTMLImageElement>(".page-shadow img"))
            .map((image) => image.naturalWidth),
          loadingCount: document.querySelectorAll(".page-loading").length,
          error: document.querySelector(".error-banner")?.textContent?.trim() ?? null,
          busy: document.querySelector(".app-shell")?.getAttribute("aria-busy") ?? null,
        }));
        return Boolean(
          observed.activeTab?.includes(normalizedLabel)
          && observed.imageWidths.some((width) => width > 0),
        );
      },
      { timeout: 20_000, timeoutMsg: message },
    );
  } catch {
    assert.fail(`${message}：${JSON.stringify(observed)}`);
  }
}

describe("鲁科 PDF 编辑器桌面批注审阅", () => {
  before(async () => {
    await browser.setWindowSize(1280, 720);
  });

  it("在 Tauri WebView 中读取长文档并定位第 5 页批注", async () => {
    const expectedRunId = process.env.LUKE_E2E_RUN_ID;
    assert.ok(expectedRunId, "E2E runner 必须提供本次运行标识");
    const identity = await browser.executeAsync((done) => {
      const internals = (globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<string> };
      }).__TAURI_INTERNALS__;
      if (!internals) {
        done({ error: "Tauri internals unavailable", value: null });
        return;
      }
      internals.invoke("e2e_run_id").then(
        (value) => done({ error: null, value }),
        (error) => done({ error: String(error), value: null }),
      );
    });
    assert.equal(identity.error, null, `无法验证 E2E 进程身份：${identity.error}`);
    assert.equal(identity.value, expectedRunId, "WebDriver 连接的不是本次启动的应用进程");

    const fixture = process.env.LUKE_E2E_PDF;
    assert.ok(fixture, "必须通过 LUKE_E2E_PDF 提供合法 PDF 测试副本");
    const fixtureName = basename(fixture);
    await injectPdf(fixtureName, readFileSync(resolve(fixture)));
    await waitForDocument(fixtureName);

    await waitForAnnotationCount(253);
    assert.equal(
      await browser.execute(() => document.querySelector(".statusbar span:first-child")?.textContent ?? null),
      "380 页",
    );
    const categoryFilter = await $("select[aria-label='问题分类']");
    assert.equal(await categoryFilter.getValue(), "all");

    await browser.waitUntil(
      async () => await browser.execute(() => {
        const count = document.querySelectorAll(".comment-card").length;
        return count > 0 && count < 40;
      }),
      { timeout: 180_000, timeoutMsg: "真实样本意见列表未进入窗口化渲染" },
    );
    const cards = await $$(".comment-card");
    assert.ok(cards.length < 40, `窗口化意见列表常驻卡片过多：${cards.length}`);
    assert.equal(
      await $(".virtual-review-row").getAttribute("aria-setsize"),
      "253",
      "窗口化意见列表必须向辅助技术暴露完整意见总数",
    );
    assert.equal((await $$(".severity-badge")).length, cards.length, "可见鲁科 Look 意见均应完成结构化解析");
    const initialVirtualText = await $(".comment-card").getText();
    await browser.execute(() => {
      const list = document.querySelector<HTMLElement>(".comment-list");
      if (list) list.scrollTop = list.scrollHeight;
    });
    await browser.waitUntil(
      async () => await browser.execute((initialText) => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>(".comment-card"));
        return cards.length > 0
          && cards.length < 40
          && cards[0].innerText !== initialText;
      }, initialVirtualText),
      { timeoutMsg: "窗口化意见列表滚动到底部后未替换可见卡片" },
    );
    await browser.execute(() => {
      const list = document.querySelector<HTMLElement>(".comment-list");
      if (list) list.scrollTop = 0;
    });
    const undersizedControls = await browser.execute(() => Array.from(
      document.querySelectorAll<HTMLElement>(".comments-panel button, .comments-panel input, .comments-panel select"),
    ).filter((element) => element.getClientRects().length && element.getBoundingClientRect().height < 32)
      .map((element) => `${element.tagName.toLowerCase()}:${element.getAttribute("aria-label") || element.textContent?.trim()}`));
    assert.deepEqual(undersizedControls, [], "右侧意见栏存在低于 32px 的可见交互控件");
    const undersizedWorkspaceControls = await browser.execute(() => Array.from(
      document.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled):not([type='checkbox']):not([type='radio']), select:not(:disabled)",
      ),
    ).filter((element) => {
      const bounds = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && (bounds.width < 32 || bounds.height < 32);
    }).map((element) => {
      const bounds = element.getBoundingClientRect();
      return `${element.tagName.toLowerCase()}:${element.getAttribute("aria-label") || element.textContent?.trim()}:${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
    }));
    assert.deepEqual(undersizedWorkspaceControls, [], "工作区存在低于 32px 的可见交互控件");
    await browser.setWindowSize(860, 600);
    try {
      const compactWorkspace = await browser.execute(() => ({
        commentsVisible: Boolean(document.querySelector(".comments-panel")?.getClientRects().length),
        stageVisible: Boolean(document.querySelector(".document-stage")?.getClientRects().length),
        horizontalOverflow: document.body.scrollWidth - document.body.clientWidth,
        clippedControls: Array.from(document.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        )).filter((element) => {
          const bounds = element.getBoundingClientRect();
          const intersectsViewport = bounds.bottom > 0 && bounds.top < window.innerHeight;
          return element.getClientRects().length > 0
            && intersectsViewport
            && (bounds.left < -1 || bounds.right > window.innerWidth + 1);
        }).map((element) => element.getAttribute("aria-label") || element.textContent?.trim()),
      }));
      assert.equal(compactWorkspace.commentsVisible, true, "紧凑窗口仍应显示审读意见");
      assert.ok(compactWorkspace.horizontalOverflow <= 1, "紧凑窗口出现页面级横向滚动");
      assert.deepEqual(compactWorkspace.clippedControls, [], "紧凑窗口存在无法触达的控件");
      await browser.execute(() => {
        document.querySelector<HTMLSelectElement>("select[aria-label='问题分类']")?.focus();
      });
      assert.notEqual(
        await browser.execute(() => getComputedStyle(
          document.querySelector<HTMLSelectElement>("select[aria-label='问题分类']")!,
        ).outlineWidth),
        "0px",
        "键盘聚焦下拉框时缺少可见焦点",
      );
      if (!compactWorkspace.stageVisible) {
        const commentsToggle = await $("button[aria-label='显示或隐藏审读意见']");
        await commentsToggle.click();
        await browser.waitUntil(
          async () => await browser.execute(() => Boolean(
            document.querySelector(".document-stage")?.getClientRects().length,
          )),
          { timeoutMsg: "紧凑窗口无法从意见面板切回正文" },
        );
        await commentsToggle.click();
      }
    } finally {
      await browser.setWindowSize(1280, 720);
    }
    await browser.saveScreenshot(resolve("docs/design/audit-2026-07-24-print-tabs/03-after-workspace.png"));
    const pageInput = await $("input[aria-label='跳转到页码']");
    await pageInput.setValue("5");
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => await browser.execute(() => document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "5"),
      { timeoutMsg: "打印预览前未定位到含批注的第 5 页" },
    );
    await $("button[aria-label='打印预览 (Ctrl+P)']").click();
    await expect($(".print-preview-dialog")).toBeDisplayed();
    await browser.waitUntil(
      async () => await browser.execute(() => Boolean(document.querySelector(".print-preview-canvas .print-sheet"))),
      { timeout: 180_000, timeoutMsg: "真实样本打印预览未完成" },
    );
    const printAnnotations = await $(".print-annotation-toggle input");
    assert.equal(await printAnnotations.isSelected(), true, "打印预览应默认包含批注");
    await browser.saveScreenshot(resolve("docs/design/audit-2026-07-24-print-tabs/04-after-print-preview.png"));
    await printAnnotations.click();
    await browser.waitUntil(
      async () => await browser.execute(() => !document.querySelector(".print-preview-canvas .print-sheet")?.classList.contains("has-comments")),
      { timeoutMsg: "关闭打印批注后预览未更新" },
    );
    await $("button[aria-label='关闭打印预览']").click();
    await expect($(".print-preview-dialog")).not.toBeDisplayed();

    const commentsToggle = await $("button[aria-label='显示或隐藏审读意见']");
    await commentsToggle.click();
    await expect($(".comments-panel")).not.toBeDisplayed();
    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () => await browser.execute(() => document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "6"),
      { timeoutMsg: "审读意见栏关闭后 ArrowDown 未跳到下一页" },
    );
    await browser.keys("ArrowUp");
    await browser.waitUntil(
      async () => await browser.execute(() => document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "5"),
      { timeoutMsg: "审读意见栏关闭后 ArrowUp 未返回上一页" },
    );
    await commentsToggle.click();
    await expect($(".comments-panel")).toBeDisplayed();

    const pageFiveCard = await $("//button[contains(@class, 'comment-card')][.//footer/span[contains(., '第 5 页')]]");
    assert.ok(await pageFiveCard.isDisplayed(), "真实样本应存在第 5 页批注");
    assert.ok((await pageFiveCard.getText()).includes("错别字"));
    assert.ok((await pageFiveCard.getText()).includes("洁本"));
    assert.ok((await pageFiveCard.getText()).includes("节本"));

    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () => await browser.execute(() => {
        const pageInput = document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']");
        const cursor = document.querySelector<HTMLElement>(".comment-card.is-cursor");
        return pageInput?.value === "5"
          && cursor?.textContent?.includes("洁本")
          && !document.querySelector(".review-detail");
      }),
      { timeoutMsg: "列表中的 ArrowDown 未停留在第一条意见" },
    );
    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () => await browser.execute(() => (
        document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "14"
        && Boolean(document.querySelector(".comment-card.is-cursor"))
        && !document.querySelector(".review-detail")
      )),
      { timeoutMsg: "列表中的第二次 ArrowDown 未移动到下一条意见" },
    );
    await browser.keys("ArrowUp");
    await browser.waitUntil(
      async () => await browser.execute(() => (
        document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "5"
        && !document.querySelector(".review-detail")
      )),
      { timeoutMsg: "列表中的 ArrowUp 未返回上一条意见" },
    );
    await browser.keys("Enter");
    await expect($(".review-detail")).toBeDisplayed();
    assert.equal(
      await browser.execute(() => document.activeElement?.textContent?.trim() ?? null),
      "返回意见列表",
      "按 Enter 打开意见详情后焦点应进入详情",
    );
    assert.ok((await $(".review-detail").getText()).includes("修改建议"));
    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () => await browser.execute(() => (
        document.querySelector(".review-detail-topbar span")?.textContent?.trim() === "2 / 253"
        && document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "14"
      )),
      { timeout: 5_000, timeoutMsg: "详情中的 ArrowDown 未跳到下一条审读意见" },
    );
    await browser.keys("ArrowUp");
    await browser.waitUntil(
      async () => await browser.execute(() => (
        document.querySelector(".review-detail-topbar span")?.textContent?.trim() === "1 / 253"
        && document.querySelector<HTMLInputElement>("input[aria-label='跳转到页码']")?.value === "5"
      )),
      { timeout: 5_000, timeoutMsg: "详情中的 ArrowUp 未返回上一条审读意见" },
    );
    assert.equal((await $$(".annotation-editor")).length, 0);
    await $("button=编辑原始批注").click();
    await expect($(".annotation-editor textarea")).toBeDisplayed();
    await $("button=返回意见列表").click();
    assert.ok(
      (await browser.execute(() => document.activeElement?.classList.contains("comment-card") ?? false)),
      "返回列表后焦点应回到原意见卡片",
    );
  });

  it("在旋转且带 CropBox 的页面创建文字高亮并撤销重做", async () => {
    if ((await $$(".document-tab")).length === 0) {
      const samplePath = process.env.LUKE_E2E_PDF;
      assert.ok(samplePath, "独立运行文字标记用例时必须提供 LUKE_E2E_PDF");
      const sampleName = basename(samplePath);
      await injectPdf(sampleName, new Uint8Array(readFileSync(samplePath)));
      await waitForDocument(sampleName);
    }
    const fixtureName = "markup-rotate-crop.pdf";
    const fixtureBytes = createRotatedMarkupFixture();
    const expectedQuads = expectedSelectionQuads(fixtureBytes, 4, 16);
    await injectPdf(fixtureName, fixtureBytes);
    await waitForDocument(fixtureName);
    await waitForAnnotationCount(0);
    assert.equal((await $$(".document-tab")).length, 2, "打开第二份 PDF 后应保留第一份文档标签");
    await browser.saveScreenshot(resolve("docs/design/audit-2026-07-24-print-tabs/06-after-multi-tabs.png"));
    const tabLabels = await browser.execute(() => Array.from(
      document.querySelectorAll<HTMLElement>(".document-tab"),
    ).map((tab) => tab.textContent?.replaceAll("×", "").trim() ?? ""));
    const firstTabLabel = tabLabels.find((label) => label && label !== fixtureName);
    assert.ok(firstTabLabel, "未找到第一份真实样本文档标签");
    await browser.execute((label) => {
      Array.from(document.querySelectorAll<HTMLButtonElement>(".document-tab-main"))
        .find((tab) => tab.textContent?.includes(label))
        ?.click();
    }, firstTabLabel);
    await waitForRenderedPage(firstTabLabel, "切回第一份 PDF 后页面位图未恢复");
    await browser.execute((label) => {
      Array.from(document.querySelectorAll<HTMLButtonElement>(".document-tab-main"))
        .find((tab) => tab.textContent?.includes(label))
        ?.click();
    }, fixtureName);
    await waitForRenderedPage(fixtureName, "再次切回第二份 PDF 后页面位图未恢复");

    await $("//div[contains(@class, 'workspace-modes')]/button[normalize-space()='标注']").click();
    const highlightTool = $("button[aria-label='高亮 (H)']");
    await highlightTool.click();
    await browser.waitUntil(
      async () => (
        await highlightTool.getAttribute("aria-pressed") === "true"
        && await $(".page-shadow.is-active").getAttribute("data-markup-tool") === "highlight"
      ),
      { timeout: 5_000, timeoutMsg: "高亮工具未同步到当前页面" },
    );
    await browser.waitUntil(
      async () => await browser.execute(() => document.querySelectorAll(".text-character").length >= 12),
      { timeout: 180_000, timeoutMsg: "旋转页文本层未准备完成" },
    );

    const selectionState = await browser.execute(() => {
      const characters = Array.from(document.querySelectorAll<HTMLElement>(".text-character")).slice(4, 16);
      const first = characters[0]?.firstChild;
      const last = characters.at(-1)?.firstChild;
      const page = characters[0]?.closest<HTMLElement>(".page-shadow");
      if (!first || !last || !page) return null;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.textContent?.length ?? 0);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const before = selection?.toString() ?? "";
      page.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return { before, after: selection?.toString() ?? "" };
    });
    assert.ok(selectionState?.before && selectionState.before.length >= 12, "未能在旋转页建立文字选区");
    assert.equal(selectionState.after, "", "mouseup 后文字选区未被批注工具消费");
    await waitForAnnotationCount(1, 10_000);
    assert.equal((await $$(".annotation-composer-backdrop")).length, 0, "文字标记不应打开阻塞式弹窗");
    await expect($(".review-detail .annotation-editor textarea")).toBeDisplayed();
    await $(".review-detail .annotation-editor textarea").setValue("核对术语并确认修改依据");
    await $("button=应用修改").click();
    await $("button=返回意见列表").click();

    const createdCard = await $(".comment-card");
    assert.ok((await createdCard.getText()).includes("高亮"));
    assert.ok((await createdCard.getText()).includes("核对术语并确认修改依据"));
    assert.ok((await createdCard.getText()).includes("第 1 页"));

    const shortcutSelectedText = await browser.execute(() => {
      const characters = Array.from(document.querySelectorAll<HTMLElement>(".text-character")).slice(16, 24);
      const first = characters[0]?.firstChild;
      const last = characters.at(-1)?.firstChild;
      if (!first || !last) return null;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.textContent?.length ?? 0);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    });
    assert.ok(shortcutSelectedText, "未能为先选后按快捷键建立文字选区");
    await browser.keys("u");
    await waitForAnnotationCount(2, 10_000);
    assert.equal((await $$(".annotation-composer-backdrop")).length, 0, "快捷键文字标记不应打开阻塞式弹窗");
    assert.ok(
      await browser.execute(() => document.querySelector(".review-detail")?.textContent?.includes("下划线") ?? false),
      "先选文字再按 U 未创建下划线批注",
    );
    await $("button=返回意见列表").click();

    await browser.keys("t");
    assert.equal(await $("button[aria-label='文本框 (T)']").getAttribute("aria-pressed"), "true");
    await browser.execute(() => {
      const page = document.querySelector<HTMLElement>(".page-shadow");
      if (!page) return;
      const bounds = page.getBoundingClientRect();
      page.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: bounds.left + Math.min(220, bounds.width / 2),
        clientY: bounds.top + Math.min(180, bounds.height / 2),
      }));
    });
    await expect($(".annotation-composer")).toBeDisplayed();
    assert.equal((await $$(".annotation-composer-backdrop")).length, 0, "文本框编辑器必须位于侧栏而非弹窗");
    await $(".annotation-composer textarea").setValue("自由文本框批注");
    await $("//form[contains(@class, 'annotation-composer')]//button[normalize-space()='创建批注']").click();
    await waitForAnnotationCount(3, 10_000);
    await $("button=返回意见列表").click();
    assert.ok(
      await browser.execute(() => Array.from(document.querySelectorAll(".comment-card"))
        .some((card) => card.textContent?.includes("自由文本框批注"))),
      "自由文本框批注未进入批注列表",
    );

    await $("button[aria-label='撤销 (Ctrl+Z)']").click();
    await waitForAnnotationCount(2, 10_000);
    await $("button[aria-label='重做 (Ctrl+Y)']").click();
    await waitForAnnotationCount(3, 10_000);
    assert.equal(
      await browser.execute(() => document.querySelector(".error-banner span")?.textContent ?? null),
      null,
    );

    await browser.execute(() => {
      const scope = globalThis as typeof globalThis & {
        __lukeE2eCapturedPdf?: Blob;
        __lukeE2eCreateObjectUrl?: typeof URL.createObjectURL;
        __lukeE2eAnchorClick?: typeof HTMLAnchorElement.prototype.click;
      };
      scope.__lukeE2eCreateObjectUrl = URL.createObjectURL.bind(URL);
      scope.__lukeE2eAnchorClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (object) => {
        if (object instanceof Blob && object.type === "application/pdf") scope.__lukeE2eCapturedPdf = object;
        return scope.__lukeE2eCreateObjectUrl!(object);
      };
      HTMLAnchorElement.prototype.click = function click() {
        if (this.download && this.href.startsWith("blob:")) return;
        scope.__lukeE2eAnchorClick!.call(this);
      };
    });
    let exported: { bytes: number[] | null; error: string | null };
    try {
      await $("button[aria-label='保存 (Ctrl+S)']").click();
      await browser.waitUntil(
        async () => await browser.execute(() => {
          const scope = globalThis as typeof globalThis & { __lukeE2eCapturedPdf?: Blob };
          const save = document.querySelector<HTMLButtonElement>("button[aria-label='保存 (Ctrl+S)']");
          return Boolean(scope.__lukeE2eCapturedPdf?.size) && save?.disabled === true;
        }),
        { timeout: 180_000, timeoutMsg: "文字标记 PDF 未完成导出" },
      );
      exported = await browser.executeAsync((done) => {
        const captured = (globalThis as typeof globalThis & { __lukeE2eCapturedPdf?: Blob }).__lukeE2eCapturedPdf;
        if (!captured) {
          done({ bytes: null, error: "没有捕获到导出的 PDF" });
          return;
        }
        captured.arrayBuffer().then(
          (buffer) => done({ bytes: Array.from(new Uint8Array(buffer)), error: null }),
          (error) => done({ bytes: null, error: String(error) }),
        );
      });
    } finally {
      await restoreDownloadInterception();
    }
    assert.equal(exported.error, null, `无法读取导出的 PDF：${exported.error}`);
    assert.ok(exported.bytes && exported.bytes.length > 0, "导出的 PDF 为空");

    const exportedBytes = new Uint8Array(exported.bytes);
    const exportedGeometry = inspectExportedHighlight(exportedBytes);
    assert.equal(exportedGeometry.quadPoints.length, expectedQuads.length, "导出重开后 QuadPoints 行数漂移");
    exportedGeometry.quadPoints.forEach((quad, index) => {
      assertNumbersClose(quad, expectedQuads[index], `导出重开后第 ${index + 1} 行 QuadPoints 漂移`);
    });
    assertMarkupRectContains(exportedGeometry.rect, rectForQuads(expectedQuads));

    const reopenedName = "markup-rotate-crop-reopened.pdf";
    await injectPdf(reopenedName, exportedBytes);
    await waitForDocument(reopenedName);
    await waitForAnnotationCount(3, 10_000);
    assert.ok(
      await browser.execute(() => Array.from(document.querySelectorAll(".comment-card"))
        .some((card) => card.textContent?.includes("高亮"))),
      "导出重开后缺少高亮批注",
    );
    assert.ok(
      await browser.execute(() => Array.from(document.querySelectorAll(".comment-card"))
        .some((card) => card.textContent?.includes("下划线"))),
      "导出重开后缺少快捷键创建的下划线批注",
    );
    assert.ok(
      await browser.execute(() => document.querySelector(".document-stage")?.classList.contains("tool-select") ?? false),
      "打开另一份 PDF 后必须退出之前的文字标记创建工具",
    );
  });
});
