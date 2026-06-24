import type { ObsidianCapabilityGateReport } from './capability-gate';
import type { ObsidianCommunityPluginPreflight } from './community-catalog';
import type {
  ObsidianCommunityPreflightSupportLevel,
  ObsidianCommunitySurfacePreview,
} from './community-support';
import type { CompatibilityLevel } from './compatibility-report';

export type ObsidianRealPluginPriority = 'P0' | 'P1' | 'P2';
export type ObsidianRealPluginSmokeOutcome = 'loaded' | 'skipped' | 'failed' | 'not-run';
export type ObsidianRealPluginRecommendation =
  | 'runtime-candidate'
  | 'review-before-enable'
  | 'catalog-or-native'
  | 'blocked'
  | 'investigate';

export interface ObsidianRealPluginTarget {
  id: string;
  priority: ObsidianRealPluginPriority;
  category: string;
  reason: string;
}

export interface ObsidianRealPluginCatalogInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  repo: string;
  githubUrl?: string;
}

export interface ObsidianRealPluginStats {
  downloads?: number;
  updated?: string;
}

export interface ObsidianRealPluginSmokeResult {
  outcome: ObsidianRealPluginSmokeOutcome;
  stage: 'not-run' | 'capability-gate' | 'enable' | 'load';
  reason?: string;
  loaded?: string[];
  failed?: string[];
  skipped?: string[];
  runtime?: {
    commands: number;
    settingTabs: number;
    views: number;
    markdownPostProcessors: number;
    markdownCodeBlockProcessors: number;
    ribbonIcons: number;
    statusBarItems: number;
    styleSheets: number;
    editorExtensions: number;
  };
}

export interface ObsidianRealPluginMatrixInputItem {
  target: ObsidianRealPluginTarget;
  catalog: ObsidianRealPluginCatalogInfo;
  stats?: ObsidianRealPluginStats;
  preflight: ObsidianCommunityPluginPreflight;
  capabilityGate: ObsidianCapabilityGateReport;
  smoke: ObsidianRealPluginSmokeResult;
}

export interface ObsidianRealPluginMatrixFailure {
  id: string;
  stage: 'catalog' | 'fetch' | 'preflight' | 'smoke';
  error: string;
}

export interface ObsidianRealPluginMatrixRow {
  id: string;
  name: string;
  priority: ObsidianRealPluginPriority;
  category: string;
  reason: string;
  author: string;
  repo: string;
  githubUrl?: string;
  description: string;
  downloads?: number;
  updated?: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    minAppVersion?: string;
    isDesktopOnly?: boolean;
  };
  package: {
    resolvedVersion: string;
    latestVersion: string;
    strategy: string;
    digest: string;
    hasStyles: boolean;
  };
  compatibility: {
    level: CompatibilityLevel;
    supportedApis: number;
    partialApis: number;
    unsupportedApis: number;
    blockers: string[];
    unsupportedModules: string[];
  };
  capabilityGate: {
    status: ObsidianCapabilityGateReport['status'];
    requiresConfirmation: boolean;
    confirmed: boolean;
    blocked: boolean;
    fingerprint: string;
    confirmReasons: string[];
    blockedReasons: string[];
  };
  support: {
    kind: ObsidianCommunityPreflightSupportLevel;
    label: string;
    reason: string;
    installable: boolean;
  };
  surfaces: ObsidianCommunitySurfacePreview[];
  smoke: ObsidianRealPluginSmokeResult;
  recommendation: ObsidianRealPluginRecommendation;
}

export interface ObsidianRealPluginMatrixSummary {
  total: number;
  byCompatibilityLevel: Record<CompatibilityLevel, number>;
  byGateStatus: Record<ObsidianCapabilityGateReport['status'], number>;
  bySmokeOutcome: Record<ObsidianRealPluginSmokeOutcome, number>;
  byRecommendation: Record<ObsidianRealPluginRecommendation, number>;
  totalDownloads: number;
}

export interface ObsidianRealPluginMatrix {
  schemaVersion: 1;
  generatedAt: string;
  targetSet: string;
  sourcePolicy: string;
  sources: {
    communityPlugins: string;
    communityStats: string;
    releaseAssets: string;
  };
  summary: ObsidianRealPluginMatrixSummary;
  plugins: ObsidianRealPluginMatrixRow[];
  failures: ObsidianRealPluginMatrixFailure[];
}

export interface BuildObsidianRealPluginMatrixInput {
  generatedAt: string;
  targetSet: string;
  sourcePolicy: string;
  sources: ObsidianRealPluginMatrix['sources'];
  plugins: ObsidianRealPluginMatrixInputItem[];
  failures?: ObsidianRealPluginMatrixFailure[];
}

export function buildObsidianRealPluginMatrix(
  input: BuildObsidianRealPluginMatrixInput,
): ObsidianRealPluginMatrix {
  const plugins = input.plugins.map(toMatrixRow);
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    targetSet: input.targetSet,
    sourcePolicy: input.sourcePolicy,
    sources: input.sources,
    summary: summarizeRows(plugins),
    plugins,
    failures: input.failures ?? [],
  };
}

export function renderObsidianRealPluginMatrixMarkdown(matrix: ObsidianRealPluginMatrix): string {
  const lines: string[] = [
    '# Obsidian P0 Real Plugin Compatibility Matrix',
    '',
    `> Generated: ${matrix.generatedAt}`,
    `> Target set: ${matrix.targetSet}`,
    `> Source policy: ${matrix.sourcePolicy}`,
    '',
    '## Sources',
    '',
    `- Community plugin index: ${matrix.sources.communityPlugins}`,
    `- Community plugin stats: ${matrix.sources.communityStats}`,
    `- Plugin package assets: ${matrix.sources.releaseAssets}`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Plugins analyzed | ${matrix.summary.total} |`,
    `| Total downloads represented | ${formatNumber(matrix.summary.totalDownloads)} |`,
    `| Runtime candidates | ${matrix.summary.byRecommendation['runtime-candidate']} |`,
    `| Review before enable | ${matrix.summary.byRecommendation['review-before-enable']} |`,
    `| Catalog or native replacement | ${matrix.summary.byRecommendation['catalog-or-native']} |`,
    `| Blocked | ${matrix.summary.byRecommendation.blocked} |`,
    `| Investigate | ${matrix.summary.byRecommendation.investigate} |`,
    '',
    '## Matrix',
    '',
    '| Plugin | Category | Downloads | Compat | Gate | Smoke | Surfaces | Recommendation |',
    '|---|---|---:|---|---|---|---|---|',
    ...matrix.plugins.map((plugin) => `| ${[
      `${markdownLink(plugin.name, plugin.githubUrl)} (${inlineCode(plugin.id)})`,
      plugin.category,
      formatNumber(plugin.downloads ?? 0),
      plugin.compatibility.level,
      gateLabel(plugin),
      smokeLabel(plugin.smoke),
      surfaceLabel(plugin.surfaces),
      recommendationLabel(plugin.recommendation),
    ].join(' | ')} |`),
    '',
    '## Blockers And Review Reasons',
    '',
  ];

  for (const plugin of matrix.plugins) {
    const reasons = [
      ...plugin.capabilityGate.blockedReasons,
      ...plugin.capabilityGate.confirmReasons,
      ...(plugin.smoke.reason ? [`Smoke: ${plugin.smoke.reason}`] : []),
    ];
    if (reasons.length === 0) continue;
    lines.push(`### ${plugin.name}`);
    lines.push('');
    for (const reason of reasons.slice(0, 8)) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  if (matrix.failures.length > 0) {
    lines.push('## Harness Failures');
    lines.push('');
    lines.push('| Plugin | Stage | Error |');
    lines.push('|---|---|---|');
    for (const failure of matrix.failures) {
      lines.push(`| ${inlineCode(failure.id)} | ${failure.stage} | ${escapeTable(failure.error)} |`);
    }
    lines.push('');
  }

  lines.push('## Reading The Result');
  lines.push('');
  lines.push('- `runtime-candidate` means the plugin reached a loadable MindOS runtime state in the smoke harness.');
  lines.push('- `review-before-enable` means MindOS can install/analyze it, but enable/load requires explicit capability confirmation.');
  lines.push('- `catalog-or-native` means MindOS should expose catalog/surface metadata or build a native MindOS feature instead of running the plugin as-is.');
  lines.push('- `blocked` means the compatibility gate found hard blockers such as unsupported native modules or unsupported Obsidian APIs.');
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function toMatrixRow(input: ObsidianRealPluginMatrixInputItem): ObsidianRealPluginMatrixRow {
  const report = input.preflight.compatibility.report;
  return {
    id: input.catalog.id,
    name: input.catalog.name,
    priority: input.target.priority,
    category: input.target.category,
    reason: input.target.reason,
    author: input.catalog.author,
    repo: input.catalog.repo,
    ...(input.catalog.githubUrl ? { githubUrl: input.catalog.githubUrl } : {}),
    description: input.catalog.description,
    ...(typeof input.stats?.downloads === 'number' ? { downloads: input.stats.downloads } : {}),
    ...(input.stats?.updated ? { updated: input.stats.updated } : {}),
    manifest: {
      id: input.preflight.package.manifest.id,
      name: input.preflight.package.manifest.name,
      version: input.preflight.package.manifest.version,
      ...(input.preflight.package.manifest.minAppVersion ? { minAppVersion: input.preflight.package.manifest.minAppVersion } : {}),
      ...(input.preflight.package.manifest.isDesktopOnly === true ? { isDesktopOnly: true } : {}),
    },
    package: {
      resolvedVersion: input.preflight.package.source.resolvedVersion,
      latestVersion: input.preflight.package.source.latestVersion,
      strategy: input.preflight.package.source.strategy,
      digest: input.preflight.package.digest.package,
      hasStyles: input.preflight.package.assets.stylesCss,
    },
    compatibility: {
      level: input.preflight.compatibility.level,
      supportedApis: report.supportedApis.length,
      partialApis: report.partialApis.length,
      unsupportedApis: report.unsupportedApis.length,
      blockers: report.blockers,
      unsupportedModules: report.unsupportedModules,
    },
    capabilityGate: {
      status: input.capabilityGate.status,
      requiresConfirmation: input.capabilityGate.requiresConfirmation,
      confirmed: input.capabilityGate.confirmed,
      blocked: input.capabilityGate.blocked,
      fingerprint: input.capabilityGate.fingerprint,
      confirmReasons: input.capabilityGate.confirmReasons,
      blockedReasons: input.capabilityGate.blockedReasons,
    },
    support: input.preflight.support,
    surfaces: input.preflight.surfacePreview,
    smoke: input.smoke,
    recommendation: recommendationFor(input),
  };
}

function recommendationFor(input: ObsidianRealPluginMatrixInputItem): ObsidianRealPluginRecommendation {
  if (input.preflight.support.kind === 'native') return 'catalog-or-native';
  if (input.capabilityGate.blocked || input.preflight.compatibility.level === 'blocked') return 'blocked';
  if (input.smoke.outcome === 'loaded') return 'runtime-candidate';
  if (input.capabilityGate.requiresConfirmation || input.preflight.support.kind === 'review') return 'review-before-enable';
  if (input.smoke.outcome === 'skipped') return 'catalog-or-native';
  if (input.smoke.outcome === 'failed') return 'investigate';
  if (input.preflight.support.kind === 'ready' || input.preflight.support.kind === 'limited') return 'review-before-enable';
  return 'investigate';
}

function summarizeRows(rows: ObsidianRealPluginMatrixRow[]): ObsidianRealPluginMatrixSummary {
  const byCompatibilityLevel = emptyCompatibilityCounts();
  const byGateStatus = emptyGateCounts();
  const bySmokeOutcome = emptySmokeCounts();
  const byRecommendation = emptyRecommendationCounts();
  let totalDownloads = 0;

  for (const row of rows) {
    byCompatibilityLevel[row.compatibility.level] += 1;
    byGateStatus[row.capabilityGate.status] += 1;
    bySmokeOutcome[row.smoke.outcome] += 1;
    byRecommendation[row.recommendation] += 1;
    totalDownloads += row.downloads ?? 0;
  }

  return {
    total: rows.length,
    byCompatibilityLevel,
    byGateStatus,
    bySmokeOutcome,
    byRecommendation,
    totalDownloads,
  };
}

function emptyCompatibilityCounts(): Record<CompatibilityLevel, number> {
  return { compatible: 0, partial: 0, blocked: 0 };
}

function emptyGateCounts(): Record<ObsidianCapabilityGateReport['status'], number> {
  return { ready: 0, limited: 0, review: 0, blocked: 0 };
}

function emptySmokeCounts(): Record<ObsidianRealPluginSmokeOutcome, number> {
  return { loaded: 0, skipped: 0, failed: 0, 'not-run': 0 };
}

function emptyRecommendationCounts(): Record<ObsidianRealPluginRecommendation, number> {
  return {
    'runtime-candidate': 0,
    'review-before-enable': 0,
    'catalog-or-native': 0,
    blocked: 0,
    investigate: 0,
  };
}

function gateLabel(plugin: ObsidianRealPluginMatrixRow): string {
  const suffix = plugin.capabilityGate.requiresConfirmation ? ' (confirmation)' : '';
  return `${plugin.capabilityGate.status}${suffix}`;
}

function smokeLabel(smoke: ObsidianRealPluginSmokeResult): string {
  return smoke.outcome === 'not-run' ? 'not run' : `${smoke.outcome} (${smoke.stage})`;
}

function surfaceLabel(surfaces: ObsidianCommunitySurfacePreview[]): string {
  if (surfaces.length === 0) return '-';
  return surfaces
    .map((surface) => `${surface.id}:${surface.state}${surface.count > 1 ? `x${surface.count}` : ''}`)
    .join(', ');
}

function recommendationLabel(recommendation: ObsidianRealPluginRecommendation): string {
  return recommendation.replaceAll('-', ' ');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function markdownLink(label: string, url: string | undefined): string {
  return url ? `[${escapeMarkdown(label)}](${url})` : escapeMarkdown(label);
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('|', '\\|');
}

function escapeTable(value: string): string {
  return escapeMarkdown(value).replaceAll('\n', '<br>');
}
