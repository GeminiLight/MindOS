import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, UPDATE_CHECK_PATH } from './constants.js';
import { bold, dim, cyan, yellow } from './colors.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const REGISTRIES = [
  'https://registry.npmmirror.com/@geminilight/mindos/latest',
  'https://registry.npmjs.org/@geminilight/mindos/latest',
];

/** Simple semver "a > b" comparison (major.minor.patch only). */
function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function getCurrentVersion() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
  } catch {
    return '0.0.0';
  }
}

function readCache() {
  try {
    return JSON.parse(readFileSync(UPDATE_CHECK_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(latestVersion) {
  try {
    writeFileSync(UPDATE_CHECK_PATH, JSON.stringify({
      lastCheck: new Date().toISOString(),
      latestVersion,
    }), 'utf-8');
  } catch { /* best-effort */ }
}

async function fetchLatest() {
  for (const url of REGISTRIES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        return data.version;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Check for updates. Returns the latest version string if an update is
 * available, or null if up-to-date / check fails.
 */
export async function checkForUpdate() {
  if (process.env.MINDOS_NO_UPDATE_CHECK === '1') return null;

  const current = getCurrentVersion();
  const cache = readCache();

  // Cache hit — still fresh
  if (cache?.lastCheck) {
    const age = Date.now() - new Date(cache.lastCheck).getTime();
    if (age < TTL_MS) {
      return (cache.latestVersion && semverGt(cache.latestVersion, current))
        ? cache.latestVersion
        : null;
    }
  }

  // Cache miss or expired — fetch
  const latest = await fetchLatest();
  if (latest) writeCache(latest);
  return (latest && semverGt(latest, current)) ? latest : null;
}

/** Print update hint line if an update is available. */
export function printUpdateHint(latestVersion) {
  const current = getCurrentVersion();
  console.log(`\n  ${yellow('⬆')}  ${bold(`MindOS v${latestVersion}`)} available ${dim(`(current: v${current})`)}.  Run ${cyan('mindos update')} to upgrade.`);
}
