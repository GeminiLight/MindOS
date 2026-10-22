#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve, join, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const directory = join(homedir(), ".mindos"),
  configPath = join(directory, "config.json"),
  runtime = join(directory, "plugin-runtime");
let cli = process.env.MINDOS_VIEWS_CLI || "mindos";
function run(args, timeout = 16000) {
  return execFileSync(cli, args, {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function doctor() {
  const data = JSON.parse(run(["views", "doctor"]));
  if (data.capabilityVersion !== 1)
    throw Error("Runtime must support views capability 1");
  return data;
}
try {
  if (!["darwin", "linux"].includes(process.platform))
    throw Error("This MVP setup supports macOS and Linux");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19))
    throw Error("Node 22.19 or later is required");
  const artifact = option("--runtime-package"),
    root = option("--root");
  let config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : undefined;
  if (root && config?.mindRoot && resolve(root) !== resolve(config.mindRoot))
    throw Error(
      "An existing library is configured; setup will not switch or replace it",
    );
  if (artifact) {
    if (
      !/^@geminilight\/mindos@\d+\.\d+\.\d+$/.test(artifact) &&
      !(
        isAbsolute(artifact) &&
        artifact.endsWith(".tgz") &&
        existsSync(artifact)
      )
    )
      throw Error(
        "Provide an exact published version or an absolute tested .tgz artifact",
      );
    console.error("Installing the specified runtime artifact…");
    mkdirSync(runtime, { recursive: true });
    execFileSync(
      "npm",
      ["install", "--prefix", runtime, "--no-audit", "--no-fund", artifact],
      { stdio: "inherit", timeout: 120000 },
    );
    cli = join(runtime, "node_modules", ".bin", "mindos");
  } else if (
    cli === "mindos" &&
    existsSync(join(runtime, "node_modules", ".bin", "mindos"))
  )
    cli = join(runtime, "node_modules", ".bin", "mindos");
  if (!config) {
    if (!root)
      throw Error(
        "Choose an absolute library folder with --root; existing data will be preserved",
      );
    if (!isAbsolute(root)) throw Error("The library folder must be absolute");
    mkdirSync(root, { recursive: true });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    config = {
      mindRoot: resolve(root),
      port: 3456,
      authToken: randomBytes(32).toString("hex"),
      setupPending: false,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  console.error("Checking the shared MindOS service…");
  let info;
  try {
    info = doctor();
  } catch (error) {
    if (!args.includes("--start")) throw error;
    // A reachable older runtime is never replaced or restarted behind the user's back.
    const origin =
      process.env.MINDOS_URL ||
      config.url ||
      `http://localhost:${config.port || 3456}`;
    try {
      const health = await fetch(new URL("/api/health", origin), {
        signal: AbortSignal.timeout(2000),
      });
      if (health.status)
        throw Error(
          "A service is already listening. Upgrade/repair it explicitly; no duplicate was started",
        );
    } catch (e) {
      if (e.message.startsWith("A service")) throw e;
    }
    console.error("Starting the configured runtime…");
    const log = join(directory, "views-start.log"),
      fd = openSync(log, "a", 0o600);
    const child = spawn(cli, ["start"], {
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.on("error", (e) => console.error(e.message));
    child.unref();
    closeSync(fd);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        info = doctor();
        break;
      } catch {
        /* Readiness is bounded; logs retain the startup error. */
      }
    }
    if (!info)
      throw Error("Runtime was not ready within 60 seconds. Inspect " + log);
  }
  console.log(
    JSON.stringify({
      ok: true,
      capabilityVersion: info.capabilityVersion,
      rootId: info.rootId,
      cli,
      url:
        (process.env.MINDOS_URL ||
          config.url ||
          `http://localhost:${config.port || 3456}`) + "/studio/views",
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exitCode = 1;
}
