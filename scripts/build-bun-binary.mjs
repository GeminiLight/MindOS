#!/usr/bin/env node
/**
 * Build a Bun-compiled MindOS runtime envelope.
 *
 * The binary embeds runtime.tar.gz and extracts it to a versioned cache before
 * dispatching CLI commands or JS child entrypoints through the same executable.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const STATIC_WEB_INDEX = 'static-web/index.html';

export function binaryName(target = {}) {
  return target.os === 'win32' || target.os === 'windows' || target.key?.startsWith('windows-')
    ? 'mindos.exe'
    : 'mindos';
}

export function bunCompileTarget(target = {}) {
  const os = target.os === 'win32' ? 'windows' : target.os;
  const cpu = target.cpu;
  if (!os || !cpu) return undefined;
  return `bun-${os}-${cpu}${target.key?.endsWith('-musl') ? '-musl' : ''}`;
}

export function buildBunBinary(options) {
  const runtimeRoot = resolve(options.runtimeRoot);
  const target = options.target ?? {};
  const outFile = resolve(options.outFile ?? runtimeRoot, options.outFile ? '' : `bin/${binaryName(target)}`);
  const packageJsonPath = resolve(runtimeRoot, 'package.json');
  if (!existsSync(packageJsonPath)) throw new Error(`package.json not found under runtime root: ${runtimeRoot}`);
  if (!existsSync(resolve(runtimeRoot, STATIC_WEB_INDEX))
    && !existsSync(resolve(runtimeRoot, '_standalone', 'server.js'))) {
    throw new Error(`Web runtime artifact not found under runtime root: ${runtimeRoot}`);
  }
  if (!existsSync(resolve(runtimeRoot, 'src', 'cli-runtime.js'))) {
    throw new Error(`CLI runtime not found under runtime root: ${runtimeRoot}`);
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const buildDir = resolve(runtimeRoot, '.mindos-binary-build');
  const archivePath = resolve(buildDir, 'runtime.tar.gz');
  const entryPath = resolve(buildDir, 'entry.ts');
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(dirname(outFile), { recursive: true });

  createRuntimeArchive(runtimeRoot, archivePath, {
    excludeStandalone: existsSync(resolve(runtimeRoot, STATIC_WEB_INDEX)),
  });
  writeFileSync(entryPath, createEntrySource({
    productName: pkg.name,
    version: pkg.version,
    platform: target.key ?? `${process.platform}-${process.arch}`,
  }), 'utf-8');

  const args = ['build', '--compile', entryPath, '--outfile', outFile];
  const targetName = bunCompileTarget(target);
  if (targetName) args.push('--target', targetName);

  const result = spawnSync('bun', args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`bun build --compile failed with exit code ${result.status}`);

  return { outFile, archivePath };
}

function createRuntimeArchive(runtimeRoot, archivePath, options = {}) {
  const args = [
    '--exclude',
    './.mindos-binary-build',
    '--exclude',
    './bin/mindos',
    '--exclude',
    './bin/mindos.exe',
  ];
  if (options.excludeStandalone) {
    args.push('--exclude', './_standalone');
  }
  args.push('-czf', archivePath, '.');

  const result = spawnSync('tar', args, {
    cwd: runtimeRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`runtime.tar.gz creation failed with exit code ${result.status}`);
}

function createEntrySource({ productName, version, platform }) {
  return `import runtimeArchivePath from "./runtime.tar.gz" with { type: "file" };
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PRODUCT_NAME = ${JSON.stringify(productName)};
const PRODUCT_VERSION = ${JSON.stringify(version)};
const PLATFORM = ${JSON.stringify(platform)};

function cacheBase() {
  return process.env.MINDOS_BINARY_CACHE_DIR
    || resolve(homedir(), ".mindos", "runtime-cache");
}

function runtimeRoot() {
  return resolve(cacheBase(), PRODUCT_VERSION, PLATFORM);
}

function manifestMatches(root) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, "runtime-manifest.json"), "utf-8"));
    return manifest?.product?.version === PRODUCT_VERSION;
  } catch {
    return false;
  }
}

async function extractRuntime() {
  const root = runtimeRoot();
  if (manifestMatches(root) && existsSync(resolve(root, "src", "cli-runtime.js"))) return root;

  const parent = dirname(root);
  mkdirSync(parent, { recursive: true });
  const lockDir = resolve(parent, \`.\${PLATFORM}.extract.lock\`);
  await acquireExtractLock(lockDir);
  try {
    if (manifestMatches(root) && existsSync(resolve(root, "src", "cli-runtime.js"))) return root;

  const tempRoot = resolve(tmpdir(), \`mindos-runtime-\${PRODUCT_VERSION}-\${PLATFORM}-\${process.pid}\`);
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  const tempArchive = resolve(tempRoot, "runtime.tar.gz");
  await Bun.write(tempArchive, Bun.file(runtimeArchivePath));

  const result = spawnSync("tar", ["-xzf", tempArchive, "-C", tempRoot], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(\`Failed to extract embedded runtime.tar.gz for \${PRODUCT_NAME}\`);
  rmSync(tempArchive, { force: true });

  rmSync(root, { recursive: true, force: true });
  renameSync(tempRoot, root);
  return root;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

async function acquireExtractLock(lockDir) {
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      mkdirSync(lockDir);
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
}

function mapRuntimeJsPath(root, candidate) {
  const absolute = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
  if (existsSync(absolute)) return absolute;

  const marker = "/packages/mindos/";
  const normalized = absolute.replaceAll("\\\\", "/");
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) {
    const rel = normalized.slice(idx + marker.length);
    const mapped = resolve(root, rel);
    if (existsSync(mapped)) return mapped;
  }

  return absolute;
}

async function runJs(root, args) {
  const target = mapRuntimeJsPath(root, args[0]);
  process.argv = [process.execPath, target, ...args.slice(1)];
  await import(pathToFileURL(target).href);
}

async function runCli(root, args) {
  const cliRuntime = resolve(root, "src", "cli-runtime.js");
  const mod = await import(pathToFileURL(cliRuntime).href);
  await mod.runMindosCli(args);
}

function isJavaScriptEntrypoint(candidate) {
  return candidate.endsWith(".js") || candidate.endsWith(".mjs") || candidate.endsWith(".cjs");
}

const root = await extractRuntime();
process.env.MINDOS_BINARY_RUNTIME_ROOT = root;
process.env.MINDOS_RUNTIME_PACKAGE_PATH = root;
process.env.MINDOS_BINARY_EXECUTOR = process.execPath;
process.env.MINDOS_NODE_BIN = process.execPath;

const args = process.argv.slice(2);
if (args[0] && isJavaScriptEntrypoint(args[0])) {
  await runJs(root, args);
} else {
  await runCli(root, args);
}
`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runtime-root') parsed.runtimeRoot = argv[++i];
    else if (arg === '--out') parsed.outFile = argv[++i];
    else if (arg === '--platform') parsed.platform = argv[++i];
    else if (arg === '--os') parsed.os = argv[++i];
    else if (arg === '--cpu') parsed.cpu = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runtimeRoot) throw new Error('--runtime-root is required');
  const target = {
    key: args.platform,
    os: args.os,
    cpu: args.cpu,
  };
  const result = buildBunBinary({
    runtimeRoot: args.runtimeRoot,
    outFile: args.outFile,
    target,
  });
  console.log(`[build-bun-binary] ${result.outFile}`);
}
