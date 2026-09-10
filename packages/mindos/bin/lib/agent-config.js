/**
 * Loader for the generated agent-config bundle.
 *
 * `bin/lib/generated/agent-config.mjs` is built from `src/agent/config/index.ts`
 * by `scripts/build-cli-bundles.mjs` (esbuild; `jsonc-parser` inlined, only
 * `node:*` imports remain, so the Bun single binary can load it). The mirrors
 * in this directory (`toml.js`, `yaml.js`, `jsonc.js`, `path-expand.js`,
 * `mcp-agents.js`, ...) take their functions from here instead of hand-copying
 * the core implementations.
 *
 * Rebuild policy mirrors `mcp-build.js#ensureMcpBundle`: a monorepo checkout
 * rebuilds on demand when the bundle is missing or older than the sources;
 * packaged runtimes (npm platform packages, Bun binaries, Desktop) ship the
 * bundle next to this file and have no sources or builder, so it is trusted
 * as-is. All rebuild output goes to stderr — stdout must stay clean for
 * MCP_TRANSPORT=stdio JSON-RPC.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = resolve(here, '..', '..');
export const AGENT_CONFIG_BUNDLE = resolve(here, 'generated', 'agent-config.mjs');

// Everything the bundle is generated from; a change here makes it stale.
const AGENT_CONFIG_SRC_DIRS = [
  resolve(PACKAGE_ROOT, 'src', 'agent', 'config'),
  resolve(PACKAGE_ROOT, 'src', 'foundation', 'shared', 'utils'),
];
// `node ../../scripts/build-cli-bundles.mjs` only exists in a monorepo checkout.
const MONOREPO_BUILDER = resolve(PACKAGE_ROOT, '..', '..', 'scripts', 'build-cli-bundles.mjs');

function safeMtime(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function latestTreeMtime(dirPath) {
  if (!existsSync(dirPath)) return 0;
  let latest = safeMtime(dirPath);
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = resolve(dirPath, entry.name);
    latest = entry.isDirectory()
      ? Math.max(latest, latestTreeMtime(fullPath))
      : Math.max(latest, safeMtime(fullPath));
  }
  return latest;
}

function hasAgentConfigSources() {
  return AGENT_CONFIG_SRC_DIRS.some((dir) => existsSync(dir));
}

export function needsAgentConfigBuild() {
  if (!existsSync(AGENT_CONFIG_BUNDLE)) return true;
  // Packaged runtimes ship the bundle without sources or builder: trust it.
  if (!hasAgentConfigSources() || !existsSync(MONOREPO_BUILDER)) return false;
  const sourceMtime = Math.max(...AGENT_CONFIG_SRC_DIRS.map((dir) => latestTreeMtime(dir)));
  return sourceMtime > safeMtime(AGENT_CONFIG_BUNDLE);
}

export function ensureAgentConfigBundle() {
  if (!needsAgentConfigBuild()) return;

  const hadBundle = existsSync(AGENT_CONFIG_BUNDLE);
  if (!hasAgentConfigSources() || !existsSync(MONOREPO_BUILDER)) {
    if (hadBundle) return;
    throw new Error(`agent-config bundle not found and cannot be rebuilt (missing ${MONOREPO_BUILDER} or src/agent/config): ${AGENT_CONFIG_BUNDLE}`);
  }

  console.error(`[mindos] ${hadBundle ? 'Rebuilding' : 'Building'} agent-config bundle (first run or source changed)...`);
  // spawnSync (not execFileSync) with the node binary directly: no shell, no
  // npm wrapper, and stdout of the builder is folded into stderr so an MCP
  // stdio stream can never be corrupted by build output.
  const result = spawnSync(process.execPath, [MONOREPO_BUILDER], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.stdout && result.stdout.length > 0) process.stderr.write(result.stdout);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`agent-config bundle build failed (exit ${result.status})`);
  if (!existsSync(AGENT_CONFIG_BUNDLE)) {
    throw new Error(`agent-config bundle build did not produce ${AGENT_CONFIG_BUNDLE}`);
  }
}

let cachedBundle;

/**
 * The generated agent-config exports. Relative specifier on purpose: inside
 * vitest the bundle then stays in the module graph (mocks of `node:fs` /
 * `node:child_process` keep working), and inside the Bun single binary the
 * extracted relative file loads without bare-specifier resolution.
 */
export async function loadAgentConfigBundle() {
  if (cachedBundle) return cachedBundle;
  ensureAgentConfigBundle();
  cachedBundle = await import('./generated/agent-config.mjs');
  return cachedBundle;
}
