import type { Options } from "@wdio/types";

const embeddedPort = Number(process.env.LUKE_E2E_PORT);
const startupPdf = process.env.LUKE_E2E_STARTUP_PDF;

if (!Number.isInteger(embeddedPort) || embeddedPort < 1024 || embeddedPort > 65_535) {
  throw new Error("LUKE_E2E_PORT must be an available TCP port selected by scripts/run-e2e.mjs");
}

export const config: Options.Testrunner = {
  runner: "local",
  specs: startupPdf
    ? ["./test/e2e/startup-open.e2e.ts"]
    : ["./test/e2e/annotation-review.e2e.ts"],
  maxInstances: 1,
  capabilities: [{
    browserName: "tauri",
    "tauri:options": {
      application: ".\\src-tauri\\target\\debug\\鲁科 PDF 编辑器.exe",
      ...(startupPdf ? { args: [startupPdf] } : {}),
    },
  }],
  services: [["tauri", {
    appBinaryPath: "./src-tauri/target/debug/luke-pdf-editor.exe",
    ...(startupPdf ? { appArgs: [startupPdf] } : {}),
    ...(startupPdf ? { captureBackendLogs: true } : {}),
    driverProvider: "embedded",
    embeddedPort,
    startTimeout: 120_000,
    commandTimeout: 120_000,
    logLevel: "error",
  }]],
  logLevel: "error",
  bail: 0,
  waitforTimeout: 180_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 1,
  outputDir: "./work/wdio-logs",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 240_000,
  },
};
