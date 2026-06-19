#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const runtimeRoot = resolve(root, args.runtimeRoot ?? 'packages/desktop/resources/mindos-runtime');
const mainBundle = resolve(root, args.mainBundle ?? 'packages/desktop/dist-electron/main/main.js');

const requiredRuntimeFiles = [
  'package.json',
  'packages/web/.next/standalone/server.js',
  'packages/web/.next/standalone/node_modules/next/package.json',
  'packages/web/.next/standalone/node_modules/@sinclair/typebox/package.json',
  'packages/web/.next/standalone/node_modules/@earendil-works/pi-ai/package.json',
  'packages/web/.next/standalone/node_modules/@larksuiteoapi/node-sdk/package.json',
  'packages/web/.next/standalone/node_modules/@slack/web-api/package.json',
  'packages/web/.next/standalone/node_modules/discord.js/package.json',
  'packages/web/.next/standalone/node_modules/grammy/package.json',
  'packages/web/.next/standalone/node_modules/pi-web-access/index.ts',
  'packages/web/.next/standalone/node_modules/pi-subagents/src/extension/index.ts',
  'packages/web/.next/standalone/node_modules/pi-subagents/agents',
  'packages/web/.next/standalone/node_modules/pi-mcp-adapter/index.ts',
  'packages/web/.next/standalone/node_modules/pi-schedule-prompt/src/tool.ts',
  'packages/web/.next/standalone/node_modules/pi-schedule-prompt/src/storage.ts',
  'packages/web/.next/standalone/node_modules/pi-schedule-prompt/src/scheduler.ts',
  'packages/web/.next/standalone/node_modules/@juicesharp/rpiv-ask-user-question/index.ts',
  'packages/web/.next/standalone/lib/agent/kb-extension.ts',
  'packages/web/.next/standalone/lib/agent/ask-user-question-bridge-extension.ts',
  'packages/web/.next/standalone/lib/agent/mindos-mcp-adapter-extension.ts',
  'packages/web/.next/standalone/lib/agent/subagent-ledger-extension.ts',
  'packages/web/.next/standalone/lib/schedule-prompt/index.ts',
  'packages/web/.next/standalone/lib/im/index.ts',
  'dist/protocols/mcp-server/index.cjs',
  'bin/cli.js',
  'src/cli.js',
  'runtime-manifest.json',
];

const optionalLocalEmbeddingRuntimeFiles = [
  'packages/web/.next/standalone/node_modules/@huggingface/transformers/package.json',
  'packages/web/.next/standalone/node_modules/onnxruntime-node/package.json',
  'packages/web/.next/standalone/node_modules/onnxruntime-web/package.json',
];

const fatalMainPatterns = [
  /path\.join\(__dirname,\s*["']path\.txt["']\)/,
  /__vite-browser-external/,
  /mcp-server["']?\),\s*["']dist["'],\s*["']index\.cjs["']/,
];

const fatalRuntimeSourcePatterns = [
  {
    rel: 'src/session/index.ts',
    pattern: /session\.newSession\s*\(/,
    message: 'runtime session adapter still calls AgentSession.newSession; history must be appended to SessionManager before createAgentSession',
  },
  {
    rel: 'src/session/index.ts',
    pattern: /MindosPiAgentSessionWithHistory/,
    message: 'runtime session adapter still requires AgentSession.newSession in its type contract',
  },
];

const fatalLogPatterns = [
  'MCP bundle not found',
  'ERR_MODULE_NOT_FOUND',
  'Cannot find module',
  'Internal Error',
  'A JavaScript error occurred in the main process',
  'path.join is not a function',
];

const failures = [];

for (const rel of requiredRuntimeFiles) {
  if (!existsSync(join(runtimeRoot, rel))) failures.push(`missing runtime file: ${rel}`);
}

if (process.env.MINDOS_BUNDLE_LOCAL_EMBEDDING_RUNTIME !== '1') {
  for (const rel of optionalLocalEmbeddingRuntimeFiles) {
    if (existsSync(join(runtimeRoot, rel))) failures.push(`optional local embedding runtime should not be bundled by default: ${rel}`);
  }
}

for (const rel of findClaudeAgentSdkNativePackages(runtimeRoot)) {
  failures.push(`Claude Agent SDK native runtime must not be bundled: ${rel}`);
}

if (existsSync(mainBundle)) {
  const source = readFileSync(mainBundle, 'utf-8');
  for (const pattern of fatalMainPatterns) {
    if (pattern.test(source)) failures.push(`main bundle contains forbidden pattern: ${pattern}`);
  }
  if (!source.includes('resolveMcpBundlePath')) {
    failures.push('main bundle does not include resolveMcpBundlePath');
  }
}

for (const { rel, pattern, message } of fatalRuntimeSourcePatterns) {
  const file = join(runtimeRoot, rel);
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf-8');
  if (pattern.test(source)) failures.push(`${message}: ${rel}`);
}

const standaloneNodeModules = join(runtimeRoot, 'packages/web/.next/standalone/node_modules');
if (existsSync(standaloneNodeModules)) {
  failures.push(...findMissingDependencyClosure(standaloneNodeModules));
}

if (failures.length > 0) {
  console.error('[verify-desktop-runtime] FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const size = existsSync(runtimeRoot) ? formatBytes(dirSize(runtimeRoot)) : 'missing';
console.log(`[verify-desktop-runtime] OK ${runtimeRoot} (${size})`);
console.log(`[verify-desktop-runtime] fatal log patterns guarded: ${fatalLogPatterns.join(', ')}`);

function findMissingDependencyClosure(nodeModulesDir) {
  const missing = [];
  for (const packageName of listPackageNames(nodeModulesDir)) {
    const packageDir = join(nodeModulesDir, packageName);
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      continue;
    }

    for (const dependencyName of Object.keys(pkg.dependencies ?? {})) {
      if (dependencyName.startsWith('node:')) continue;
      const nested = join(packageDir, 'node_modules', dependencyName, 'package.json');
      const topLevel = join(nodeModulesDir, dependencyName, 'package.json');
      if (!existsSync(nested) && !existsSync(topLevel)) {
        missing.push(`missing dependency: ${packageName} -> ${dependencyName}`);
      }
    }
  }
  return missing;
}

function listPackageNames(nodeModulesDir) {
  const packageNames = [];
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const scopedEntry of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) packageNames.push(`${entry.name}/${scopedEntry.name}`);
      }
      continue;
    }
    packageNames.push(entry.name);
  }
  return packageNames;
}

function findClaudeAgentSdkNativePackages(rootDir) {
  const found = [];
  if (!existsSync(rootDir)) return found;
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const full = join(rootDir, entry.name);
    if (!entry.isDirectory()) continue;
    if (isClaudeAgentSdkNativePackageDir(full, entry.name)) {
      found.push(relative(runtimeRoot, full));
      continue;
    }
    found.push(...findClaudeAgentSdkNativePackages(full));
  }
  return found;
}

function isClaudeAgentSdkNativePackageDir(dir, name) {
  return (
    basename(dirname(dir)) === '@anthropic-ai'
    && name.startsWith('claude-agent-sdk-')
  ) || name.startsWith('@anthropic-ai+claude-agent-sdk-');
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += statSync(full).size;
  }
  return total;
}

function formatBytes(bytes) {
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(1)} MiB`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runtime-root') parsed.runtimeRoot = argv[++i];
    else if (arg === '--main-bundle') parsed.mainBundle = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
