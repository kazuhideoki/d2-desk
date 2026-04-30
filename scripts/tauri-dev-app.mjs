#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const rootDir = process.cwd();
const baseName = basename(rootDir);
const hash = createHash("sha1").update(rootDir).digest("hex").slice(0, 6);

const explicitSuffix = process.env.D2_DESK_DEV_SUFFIX;
const printConfigOnly = process.argv.includes("--print-config");
const noOpen = process.argv.includes("--no-open");
const suffix = sanitizeSuffix(explicitSuffix || `${baseName}-${hash}`);
const productName = process.env.D2_DESK_PRODUCT_NAME || `D2 Desk ${suffix}`;
const identifier = process.env.D2_DESK_IDENTIFIER || `app.d2desk.dev.${suffix}`;
const stateDir = join(tmpdir(), "d2-desk-dev-app", hash);
const configPath = join(stateDir, `tauri-dev-app-${suffix}.conf.json`);
const cargoTargetDir = join(stateDir, `tauri-target-${suffix}`);
const appPath = join(
  cargoTargetDir,
  "debug",
  "bundle",
  "macos",
  `${productName}.app`,
);
const registeredAppsDir = join(rootDir, ".tmp", "apps");
const registeredAppPath = join(registeredAppsDir, `${productName}.app`);
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

mkdirSync(stateDir, { recursive: true });
writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      productName,
      mainBinaryName: `d2-desk-${suffix}`,
      identifier,
      build: {
        beforeBuildCommand: "npm run build:app",
        frontendDist: "../dist",
      },
      bundle: {
        targets: ["app"],
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

console.log(`Building ${productName}`);
console.log(`  identifier: ${identifier}`);
console.log(`  cargo target: ${cargoTargetDir}`);
console.log(`  config: ${configPath}`);
console.log(`  app: ${appPath}`);
console.log(`  registered app: ${registeredAppPath}`);

if (printConfigOnly) {
  process.exit(0);
}

const startedAt = performance.now();
const tauriCommand =
  process.env.D2_DESK_TAURI_CLI === "cargo"
    ? ["cargo", ["tauri"]]
    : ["npm", ["run", "tauri", "--"]];
await run(tauriCommand[0], [
  ...tauriCommand[1],
  "build",
  "--debug",
  "--bundles",
  "app",
  "--config",
  configPath,
  "--no-sign",
]);

const builtAt = performance.now();
if (!existsSync(appPath)) {
  console.error(`Expected app bundle was not created: ${appPath}`);
  process.exit(1);
}

console.log(`Built ${productName} in ${formatSeconds(builtAt - startedAt)}.`);

mkdirSync(registeredAppsDir, { recursive: true });
await run("ditto", [appPath, registeredAppPath]);
await run(lsregister, ["-f", registeredAppPath]);
console.log(`Registered ${identifier} at ${registeredAppPath}.`);

if (!noOpen) {
  await run("open", ["-b", identifier]);
  console.log(`Opened ${productName} in ${formatSeconds(performance.now() - startedAt)} total.`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: cargoTargetDir,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

function sanitizeSuffix(value) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");

  return sanitized || `dev-${hash}`;
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}
