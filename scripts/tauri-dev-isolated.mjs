#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const rootDir = process.cwd();
const baseName = basename(rootDir);
const hash = createHash("sha1").update(rootDir).digest("hex").slice(0, 6);

const explicitSuffix = process.env.D2_DESK_DEV_SUFFIX;
const printConfigOnly = process.argv.includes("--print-config");
const baseSuffix = sanitizeSuffix(explicitSuffix || `${baseName}-${hash}`);
const preferredPort = Number(process.env.D2_DESK_DEV_PORT) || stablePort(hash);
const port = Number(process.env.D2_DESK_DEV_PORT) || await findFreePort(preferredPort);
const usesPreferredIdentity = Boolean(explicitSuffix) || port === preferredPort;
const suffix = usesPreferredIdentity ? baseSuffix : `${baseSuffix}-${port}`;
const productName = process.env.D2_DESK_PRODUCT_NAME || `D2 Desk ${suffix}`;
const identifier = process.env.D2_DESK_IDENTIFIER || `app.d2desk.dev.${suffix}`;
const stateDir = join(tmpdir(), "d2-desk-dev", hash);
const configPath = join(stateDir, `tauri-dev-${suffix}.conf.json`);
const cargoTargetDir = join(stateDir, `tauri-target-${suffix}`);
const sidecarPath = join(
  stateDir,
  `d2-sidecar-${suffix}-${platformTarget()}`,
);

mkdirSync(stateDir, { recursive: true });
writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      productName,
      mainBinaryName: `d2-desk-${suffix}`,
      identifier,
      build: {
        beforeDevCommand: [
          `cd sidecar && go build -o ${shellQuote(sidecarPath)} .`,
          withDevPort("npm run dev"),
        ].join(" && "),
        devUrl: `http://localhost:${port}`,
      },
      bundle: {
        macOS: {
          bundleName: productName,
        },
      },
      app: {
        windows: [
          {
            title: productName,
          },
        ],
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Starting ${productName}`);
console.log(`  identifier: ${identifier}`);
console.log(`  devUrl: http://localhost:${port}`);
console.log(`  cargo target: ${cargoTargetDir}`);
console.log(`  sidecar: ${sidecarPath}`);
console.log(`  config: ${configPath}`);

if (printConfigOnly) {
  process.exit(0);
}

const child = spawn(
  "npm",
  ["run", "tauri", "--", "dev", "--config", configPath],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: cargoTargetDir,
      D2_DESK_SIDECAR_PATH: sidecarPath,
      D2_DESK_DEV_PORT: String(port),
    },
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function sanitizeSuffix(value) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");

  return sanitized || `dev-${hash}`;
}

function stablePort(hexHash) {
  return 1420 + (Number.parseInt(hexHash, 16) % 200);
}

async function findFreePort(startPort) {
  for (let offset = 0; offset < 200; offset += 1) {
    const candidate = 1420 + ((startPort - 1420 + offset) % 200);
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }
  throw new Error("No free dev port found in 1420-1619.");
}

function isPortFree(portNumber) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(portNumber, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function withDevPort(command) {
  return `D2_DESK_DEV_PORT=${port} ${command}`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function platformTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  if (process.platform === "win32") {
    return "x86_64-pc-windows-msvc.exe";
  }
  if (process.arch === "arm64") {
    return "aarch64-unknown-linux-gnu";
  }
  return "x86_64-unknown-linux-gnu";
}
