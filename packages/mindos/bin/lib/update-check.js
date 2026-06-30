import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PRODUCT_PACKAGE_JSON, UPDATE_CHECK_PATH } from './constants.js';
import { bold, dim, cyan, yellow } from './colors.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const REGISTRIES = [
  'https://registry.npmmirror.com/@geminilight/mindos/latest',
  'https://registry.npmjs.org/@geminilight/mindos/latest',
];

/** Simple semver comparison (major.minor.patch only). */
function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function semverGt(a, b) {
  return compareSemver(a, b) > 0;
}

function parseSemver(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function getCurrentVersion() {
  try {
    return JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version;
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
  const versions = [];
  for (const url of REGISTRIES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.version === 'string' && data.version) versions.push(data.version);
      }
    } catch {
      continue;
    }
  }

  let latest = null;
  for (const version of versions) {
    if (!latest || compareSemver(version, latest) > 0) latest = version;
  }
  return latest;
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
      if (cache.latestVersion && semverGt(cache.latestVersion, current)) return cache.latestVersion;
      if (cache.latestVersion && compareSemver(cache.latestVersion, current) === 0) return null;
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
