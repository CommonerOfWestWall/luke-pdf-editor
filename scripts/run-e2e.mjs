import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";

const wdioCli = fileURLToPath(
  new URL("../node_modules/@wdio/cli/bin/wdio.js", import.meta.url),
);

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate an E2E WebDriver port")));
        return;
      }

      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const embeddedPort = await reserveFreePort();
const runId = randomUUID();
const child = spawn(process.execPath, [wdioCli, "run", "wdio.conf.ts", ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    LUKE_E2E_PORT: String(embeddedPort),
    LUKE_E2E_RUN_ID: runId,
  },
  stdio: "inherit",
});

child.once("error", (error) => {
  throw error;
});

const exitCode = await new Promise((resolve) => {
  child.once("exit", (code, signal) => {
    if (signal) {
      process.stderr.write(`E2E runner terminated by ${signal}\n`);
      resolve(1);
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
