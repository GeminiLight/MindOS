#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const installed = join(
  homedir(),
  ".mindos/plugin-runtime/node_modules/.bin/mindos",
);
const cli =
  process.env.MINDOS_VIEWS_CLI ||
  (existsSync(installed) ? installed : "mindos");
const child = spawn(cli, ["mcp"], { stdio: "inherit" });
child.on("error", () => {
  console.error("MindOS runtime is unavailable. Run the packaged setup skill.");
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
