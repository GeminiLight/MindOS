/**
 * Obsidian Plugin Compatibility - API miss histogram
 *
 * Turns a real-plugin matrix (any size, including the download-weighted top-N
 * corpus) into "what is missing, how many plugins want it, how many downloads
 * ride on it". It is the data behind implementation ordering: each entry is a
 * module, an Obsidian API, or a structural blocker, tagged with the runtime tier
 * that would satisfy it.
 */

import {
  classifyRuntimeModuleTier,
  type ObsidianRuntimeTier,
} from './compatibility-report';
import type { ObsidianRealPluginMatrix, ObsidianRealPluginMatrixRow } from './real-plugin-matrix';

export const OBSIDIAN_API_MISS_HISTOGRAM_SCHEMA_VERSION = 1;

export type ObsidianApiMissKind = 'module' | 'api' | 'blocker';
/** `server-shim` means the gap can be closed inside the existing server tier shim. */
export type ObsidianApiMissTier = ObsidianRuntimeTier | 'server-shim' | 'unknown';

export interface ObsidianApiMissEntry {
  key: string;
  kind: ObsidianApiMissKind;
  tier: ObsidianApiMissTier;
  plugins: number;
  downloads: number;
  /** Highest-download plugin ids first, capped for readability. */
  pluginIds: string[];
}

export interface ObsidianApiMissTierBucket {
  plugins: number;
  downloads: number;
  pluginIds: string[];
}

export interface ObsidianApiMissUnlockStep {
  tier: ObsidianRuntimeTier;
  label: string;
  /** Plugins whose required tier is exactly this one (cumulative unlock = previous steps + this). */
  unlocks: ObsidianApiMissTierBucket;
  /** Highest-impact missing keys that belong to this tier. */
  keys: string[];
}

export interface ObsidianApiMissHistogram {
  schemaVersion: typeof OBSIDIAN_API_MISS_HISTOGRAM_SCHEMA_VERSION;
  generatedAt: string;
  targetSet: string;
  pluginCount: number;
  totalDownloads: number;
  /** Plugins that load in the server tier without blockers (features may be catalog-only). */
  loadsInServerTier: ObsidianApiMissTierBucket;
  byRequiredTier: Record<ObsidianRuntimeTier, ObsidianApiMissTierBucket>;
  entries: ObsidianApiMissEntry[];
  unlockPlan: ObsidianApiMissUnlockStep[];
}

export interface BuildObsidianApiMissHistogramOptions {
  maxPluginIdsPerEntry?: number;
  maxKeysPerStep?: number;
}

type MatrixLike = Pick<ObsidianRealPluginMatrix, 'generatedAt' | 'targetSet'> & { plugins: ObsidianRealPluginMatrixRow[] };

const MODULE_BLOCKER_PREFIX = 'Requires unsupported runtime module: ';
const TIER_ORDER: ObsidianRuntimeTier[] = ['server', 'browser', 'native'];
const TIER_LABELS: Record<ObsidianRuntimeTier, string> = {
  server: 'Server snapshot tier (already shipping)',
  browser: 'Browser tier: isolated realm, real DOM, shared CodeMirror 6',
  native: 'Desktop native broker tier: per-plugin Node / Electron capabilities',
};

function emptyBucket(): ObsidianApiMissTierBucket {
  return { plugins: 0, downloads: 0, pluginIds: [] };
}

function downloadsOf(row: ObsidianRealPluginMatrixRow): number {
  return typeof row.downloads === 'number' && Number.isFinite(row.downloads) && row.downloads > 0 ? row.downloads : 0;
}

function compareByImpact(a: { downloads: number; plugins: number; key: string }, b: { downloads: number; plugins: number; key: string }): number {
  if (b.downloads !== a.downloads) return b.downloads - a.downloads;
  if (b.plugins !== a.plugins) return b.plugins - a.plugins;
  return a.key.localeCompare(b.key, 'en');
}

function blockerTier(blocker: string): ObsidianApiMissTier {
  // Dynamic module resolution is only safe once a tier owns a real module graph.
  if (/dynamic require\(\)|dynamic import\(\)/i.test(blocker)) return 'browser';
  return 'unknown';
}

export function buildObsidianApiMissHistogram(
  matrix: MatrixLike,
  options: BuildObsidianApiMissHistogramOptions = {},
): ObsidianApiMissHistogram {
  const maxPluginIds = Math.max(1, options.maxPluginIdsPerEntry ?? 12);
  const maxKeys = Math.max(1, options.maxKeysPerStep ?? 15);
  const rows = [...matrix.plugins].sort((a, b) => downloadsOf(b) - downloadsOf(a) || a.id.localeCompare(b.id, 'en'));

  const accumulator = new Map<string, { kind: ObsidianApiMissKind; tier: ObsidianApiMissTier; pluginIds: string[]; downloads: number }>();
  const add = (key: string, kind: ObsidianApiMissKind, tier: ObsidianApiMissTier, row: ObsidianRealPluginMatrixRow) => {
    const id = `${kind}:${key}`;
    const entry = accumulator.get(id) ?? { kind, tier, pluginIds: [], downloads: 0 };
    if (entry.pluginIds.includes(row.id)) return;
    entry.pluginIds.push(row.id);
    entry.downloads += downloadsOf(row);
    accumulator.set(id, entry);
  };

  const byRequiredTier: Record<ObsidianRuntimeTier, ObsidianApiMissTierBucket> = {
    server: emptyBucket(),
    browser: emptyBucket(),
    native: emptyBucket(),
  };
  const loadsInServerTier = emptyBucket();
  let totalDownloads = 0;

  for (const row of rows) {
    const downloads = downloadsOf(row);
    totalDownloads += downloads;
    const tier = row.compatibility.runtimeTier;

    const bucket = byRequiredTier[tier.required];
    bucket.plugins += 1;
    bucket.downloads += downloads;
    bucket.pluginIds.push(row.id);
    if (tier.loadsInServerTier) {
      loadsInServerTier.plugins += 1;
      loadsInServerTier.downloads += downloads;
      loadsInServerTier.pluginIds.push(row.id);
    }

    for (const moduleName of row.compatibility.unsupportedModules) {
      const moduleTier = classifyRuntimeModuleTier(moduleName);
      add(moduleName, 'module', moduleTier === 'supported' ? 'server' : moduleTier, row);
    }
    for (const api of row.compatibility.unsupportedApiList) {
      add(api, 'api', tier.browserApis.includes(api) ? 'browser' : 'server-shim', row);
    }
    for (const api of tier.browserApis) {
      if (!row.compatibility.unsupportedApiList.includes(api)) add(api, 'api', 'browser', row);
    }
    for (const blocker of row.compatibility.blockers) {
      if (blocker.startsWith(MODULE_BLOCKER_PREFIX)) continue;
      add(blocker, 'blocker', blockerTier(blocker), row);
    }
  }

  const entries: ObsidianApiMissEntry[] = [...accumulator.entries()]
    .map(([id, value]) => ({
      key: id.slice(id.indexOf(':') + 1),
      kind: value.kind,
      tier: value.tier,
      plugins: value.pluginIds.length,
      downloads: value.downloads,
      pluginIds: value.pluginIds.slice(0, maxPluginIds),
    }))
    .sort(compareByImpact);

  const unlockPlan: ObsidianApiMissUnlockStep[] = TIER_ORDER.map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    unlocks: {
      ...byRequiredTier[tier],
      pluginIds: byRequiredTier[tier].pluginIds.slice(0, maxPluginIds),
    },
    keys: entries
      .filter((entry) => entry.tier === tier || (tier === 'server' && entry.tier === 'server-shim'))
      .slice(0, maxKeys)
      .map((entry) => entry.key),
  }));

  return {
    schemaVersion: OBSIDIAN_API_MISS_HISTOGRAM_SCHEMA_VERSION,
    generatedAt: matrix.generatedAt,
    targetSet: matrix.targetSet,
    pluginCount: rows.length,
    totalDownloads,
    loadsInServerTier: { ...loadsInServerTier, pluginIds: loadsInServerTier.pluginIds.slice(0, maxPluginIds) },
    byRequiredTier: Object.fromEntries(
      TIER_ORDER.map((tier) => [tier, { ...byRequiredTier[tier], pluginIds: byRequiredTier[tier].pluginIds.slice(0, maxPluginIds) }]),
    ) as Record<ObsidianRuntimeTier, ObsidianApiMissTierBucket>,
    entries,
    unlockPlan,
  };
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export function renderObsidianApiMissHistogramMarkdown(histogram: ObsidianApiMissHistogram, options: { maxEntries?: number } = {}): string {
  const maxEntries = Math.max(1, options.maxEntries ?? 60);
  const lines: string[] = [
    '# Obsidian API Miss Histogram',
    '',
    `> Generated: ${histogram.generatedAt}`,
    `> Target set: ${histogram.targetSet}`,
    `> Plugins: ${formatCount(histogram.pluginCount)} · Downloads represented: ${formatCount(histogram.totalDownloads)}`,
    '',
    '## Required runtime tier',
    '',
    '| Tier | Plugins | Downloads | Share of downloads |',
    '|---|---:|---:|---:|',
  ];
  for (const tier of TIER_ORDER) {
    const bucket = histogram.byRequiredTier[tier];
    lines.push(`| ${tier} | ${formatCount(bucket.plugins)} | ${formatCount(bucket.downloads)} | ${percent(bucket.downloads, histogram.totalDownloads)} |`);
  }
  lines.push(
    `| no static server module blockers | ${formatCount(histogram.loadsInServerTier.plugins)} | ${formatCount(histogram.loadsInServerTier.downloads)} | ${percent(histogram.loadsInServerTier.downloads, histogram.totalDownloads)} |`,
    '',
    '## Top misses by downloads',
    '',
    '| Key | Kind | Tier | Plugins | Downloads | Examples |',
    '|---|---|---|---:|---:|---|',
  );
  for (const entry of histogram.entries.slice(0, maxEntries)) {
    lines.push(`| \`${entry.key}\` | ${entry.kind} | ${entry.tier} | ${formatCount(entry.plugins)} | ${formatCount(entry.downloads)} | ${entry.pluginIds.slice(0, 4).join(', ')} |`);
  }
  if (histogram.entries.length > maxEntries) {
    lines.push('', `_${formatCount(histogram.entries.length - maxEntries)} more entries in the JSON report._`);
  }
  lines.push('', '## Unlock plan', '');
  for (const step of histogram.unlockPlan) {
    lines.push(
      `### ${step.tier}: ${step.label}`,
      '',
      `- Plugins requiring exactly this tier: ${formatCount(step.unlocks.plugins)} (${formatCount(step.unlocks.downloads)} downloads, ${percent(step.unlocks.downloads, histogram.totalDownloads)})`,
      `- Examples: ${step.unlocks.pluginIds.slice(0, 8).join(', ') || 'none'}`,
      `- Highest-impact keys: ${step.keys.map((key) => `\`${key}\``).join(', ') || 'none'}`,
      '',
    );
  }
  lines.push(
    '## Notes',
    '',
    '- `module` keys come from `require()`/`import` of packages the current tier cannot resolve.',
    '- `api` keys are Obsidian APIs detected statically; `server-shim` means the gap can be closed in the existing shim, `browser` means the feature needs a real DOM or the live editor.',
    '- `blocker` keys are structural (dynamic module resolution) and are attributed to the browser tier because only a real module graph can resolve them safely.',
    '- Download counts are the official community stats at generation time; a plugin is counted once per key.',
  );
  return `${lines.join('\n').trimEnd()}\n`;
}
