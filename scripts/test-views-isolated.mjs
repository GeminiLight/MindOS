#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { viewsFixtureIdentity } from "../tests/helpers/views-fixture.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(repo, "packages/web/.next/standalone/server.js");
if (!existsSync(runtime))
  throw new Error(
    "Build and materialize the Web standalone runtime before running isolated Views tests.",
  );
const base = mkdtempSync(join(tmpdir(), "mindos-views-e2e-")),
  root = join(base, "knowledge"),
  home = join(base, "home"),
  config = join(home, ".mindos/config.json");
const token = randomUUID();
const realAI = process.argv.includes("--real-ai");
// Explicit opt-in only: reuse the configured provider with synthetic disposable data.
// Secrets stay in a private temporary config and are removed by this runner.
let ai;
if (realAI) {
  const current = JSON.parse(
    readFileSync(join(process.env.HOME, ".mindos/config.json"), "utf8"),
  );
  ai = current.ai;
  if (!ai?.providers?.length)
    throw new Error(
      "No configured AI provider is available for this opt-in test.",
    );
}
mkdirSync(root, { recursive: true });
mkdirSync(dirname(config), { recursive: true });
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolvePort(value));
  });
});
writeFileSync(
  config,
  JSON.stringify({
    mindRoot: root,
    port,
    setupPending: false,
    ...(ai ? { ai } : {}),
  }),
  { mode: 0o600 },
);
writeFileSync(
  join(base, "fixture.json"),
  JSON.stringify({
    purpose: "disposable-views-e2e",
    root,
    token,
    createdAt: Date.now(),
  }),
);
const bin = join(home, ".mindos/plugin-runtime/node_modules/.bin");
mkdirSync(bin, { recursive: true });
symlinkSync(join(repo, "packages/mindos/bin/cli.js"), join(bin, "mindos"));
const env = {
  ...process.env,
  HOME: home,
  MINDOS_WEB_PORT: String(port),
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
  MINDOS_URL: `http://127.0.0.1:${port}`,
  MINDOS_VIEWS_ISOLATED: "1",
  MINDOS_VIEWS_REAL_AI: realAI ? "1" : "0",
  MINDOS_VIEWS_TEST_ROOT: root,
  MINDOS_VIEWS_TEST_CONFIG: config,
  MINDOS_VIEWS_FIXTURE_TOKEN: token,
  MINDOS_TEST_HOME: home,
  MINDOS_VIEWS_CLI: join(repo, "packages/mindos/bin/cli.js"),
};
// Parent host config and auth must never bleed into this disposable server.
delete env.MINDOS_HOME;
delete env.MINDOS_CONFIG_PATH;
delete env.MINDOS_ROOT;
delete env.MIND_ROOT;
const log = openSync(join(base, "server.log"), "a");
const server = spawn(process.execPath, [runtime], {
  cwd: dirname(runtime),
  env,
  detached: process.platform !== "win32",
  stdio: ["ignore", log, log],
});
let child,
  stopping = false,
  serverError;
server.once("error", (error) => {
  serverError = error;
});
const run = (args) =>
  new Promise((resolveRun, reject) => {
    // Test tools reuse the host's installed browsers/package manager. MindOS
    // servers and MCP transports still use the explicit disposable home.
    child = spawn("pnpm", args, {
      cwd: repo,
      detached: process.platform !== "win32",
      env: { ...env, HOME: process.env.HOME },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      child = undefined;
      code === 0
        ? resolveRun()
        : reject(new Error(`Views validation exited ${code}`));
    });
  });
function signalOwnedProcess(processChild, signal) {
  if (!processChild?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-processChild.pid, signal);
    else processChild.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  const owned = [child, server].filter(Boolean);
  for (const processChild of owned) signalOwnedProcess(processChild, "SIGTERM");
  for (
    let i = 0;
    i < 30 && owned.some((p) => p.exitCode === null && p.signalCode === null);
    i++
  )
    await delay(100);
  for (const processChild of owned) signalOwnedProcess(processChild, "SIGKILL");
  closeSync(log);
  rmSync(base, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
try {
  const expected = viewsFixtureIdentity(env);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null)
      throw new Error("Disposable server exited before becoming ready.");
    try {
      const response = await fetch(
        `${env.MINDOS_URL}/api/views/v2?op=describe`,
        { signal: AbortSignal.timeout(1000) },
      );
      const body = await response.json();
      if (body.rootId !== expected)
        throw new Error("Unexpected server identity");
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error("Disposable server did not become ready.");
  console.log(
    `Isolated Views fixture: ${env.MINDOS_URL} (removed after this run)`,
  );
  const args = process.argv.slice(2).filter((arg) => arg !== "--"),
    mcp = args.includes("--mcp"),
    specs = args.filter((a) => a !== "--mcp" && a !== "--real-ai");
  if (specs.some((s) => !/^([a-z0-9-]+\.spec\.ts)$/.test(s)))
    throw new Error("Pass only test filenames, not server or root overrides.");
  await run([
    "exec",
    "playwright",
    "test",
    "-c",
    "tests/e2e/playwright.config.ts",
    ...(specs.length
      ? specs
      : [
          "generative-views-ux.spec.ts",
          "generative-views.spec.ts",
          "studio-views.spec.ts",
          "view-workspaces.spec.ts",
          "views-daily-actions.spec.ts",
          "views-person-project-links.spec.ts",
          "generative-pages.spec.ts",
          "project-work-pages.spec.ts",
        ]),
    "--workers=1",
  ]);
  if (mcp)
    await run([
      "exec",
      "vitest",
      "run",
      "tests/integration/generative-views-mcp.test.ts",
    ]);
} catch (error) {
  console.error(error.message);
  console.error(readFileSync(join(base, "server.log"), "utf8").slice(-4000));
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log(
    "Disposable Views server and library removed; preview library untouched.",
  );
}
