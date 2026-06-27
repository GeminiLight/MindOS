#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OBSIDIAN_COMMUNITY_PLUGINS_URL,
  fetchObsidianCommunityPluginPackage,
  githubUrlForRepo,
  parseObsidianCommunityCatalog,
} from '@/lib/obsidian-compat/community-catalog';
import { buildObsidianCapabilityGateReport } from '@/lib/obsidian-compat/capability-gate';
import {
  buildObsidianRealPluginMatrix,
  renderObsidianRealPluginMatrixMarkdown,
  summarizeObsidianWorkflowProbeResults,
  type ObsidianRealPluginMatrixFailure,
  type ObsidianRealPluginMatrixInputItem,
  type ObsidianRealPluginSmokeResult,
  type ObsidianRealPluginTarget,
} from '@/lib/obsidian-compat/real-plugin-matrix';
import {
  buildObsidianRealPluginPolicyAudit,
  renderObsidianRealPluginPolicyAuditMarkdown,
} from '@/lib/obsidian-compat/real-plugin-policy-audit';
import {
  buildObsidianRealPluginAdapterPriorityReport,
  renderObsidianRealPluginAdapterPriorityMarkdown,
} from '@/lib/obsidian-compat/real-plugin-adapter-priority';
import {
  QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE,
  buildQuickAddWorkflowProbeDataJson,
} from '@/lib/obsidian-compat/quickadd-workflow-fixture';
import {
  RECENT_FILES_WORKFLOW_PROBE_FIXTURE,
  buildRecentFilesWorkflowProbeDataJson,
} from '@/lib/obsidian-compat/recent-files-workflow-fixture';
import {
  PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE,
  buildPeriodicNotesWorkflowProbeDataJson,
} from '@/lib/obsidian-compat/periodic-notes-workflow-fixture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');
const DEFAULT_TARGETS_PATH = path.join(repoRoot, 'scripts/obsidian-real-plugin-p0-targets.json');
const DEFAULT_OUT_JSON = path.join(repoRoot, 'wiki/reviews/obsidian-p0-plugin-compatibility-matrix-2026-06-24.json');
const DEFAULT_OUT_MD = path.join(repoRoot, 'wiki/reviews/obsidian-p0-plugin-compatibility-matrix-2026-06-24.md');
const OBSIDIAN_COMMUNITY_STATS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAIN_JS_MAX_MB = 12;

interface TargetConfig {
  targetSet?: string;
  sourcePolicy?: string;
  plugins?: ObsidianRealPluginTarget[];
}

interface CliOptions {
  targetsPath: string;
  outJson: string;
  outMarkdown: string;
  outPolicyAuditJson?: string;
  outPolicyAuditMarkdown?: string;
  outAdapterPriorityJson?: string;
  outAdapterPriorityMarkdown?: string;
  communityIndexPath?: string;
  communityStatsPath?: string;
  skipSmoke: boolean;
  runWorkflowProbes: boolean;
  timeoutMs: number;
  mainJsMaxChars: number;
}

interface CommunityStatsRecord {
  downloads?: number;
  updated?: number;
}

interface CommunityStatsById {
  [pluginId: string]: CommunityStatsRecord | undefined;
}

interface RuntimeSummarySource {
  runtime?: ObsidianRealPluginSmokeResult['runtime'] | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    targetsPath: DEFAULT_TARGETS_PATH,
    outJson: DEFAULT_OUT_JSON,
    outMarkdown: DEFAULT_OUT_MD,
    skipSmoke: false,
    runWorkflowProbes: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    mainJsMaxChars: DEFAULT_MAIN_JS_MAX_MB * 1024 * 1024,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--targets') {
      options.targetsPath = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--out-json') {
      options.outJson = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--out-md') {
      options.outMarkdown = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--out-policy-audit-json') {
      options.outPolicyAuditJson = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--out-policy-audit-md') {
      options.outPolicyAuditMarkdown = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--out-adapter-priority-json') {
      options.outAdapterPriorityJson = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--out-adapter-priority-md') {
      options.outAdapterPriorityMarkdown = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--community-index-file') {
      options.communityIndexPath = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--community-stats-file') {
      options.communityStatsPath = resolveRequiredValue(argv, index);
      index += 1;
    } else if (arg === '--skip-smoke') {
      options.skipSmoke = true;
    } else if (arg === '--run-workflow-probes') {
      options.runWorkflowProbes = true;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(resolveRequiredValue(argv, index), '--timeout-ms');
      index += 1;
    } else if (arg === '--main-js-max-mb') {
      options.mainJsMaxChars = parsePositiveInteger(resolveRequiredValue(argv, index), '--main-js-max-mb') * 1024 * 1024;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    ...options,
    targetsPath: path.resolve(repoRoot, options.targetsPath),
    outJson: path.resolve(repoRoot, options.outJson),
    outMarkdown: path.resolve(repoRoot, options.outMarkdown),
    ...(options.outPolicyAuditJson ? { outPolicyAuditJson: path.resolve(repoRoot, options.outPolicyAuditJson) } : {}),
    ...(options.outPolicyAuditMarkdown ? { outPolicyAuditMarkdown: path.resolve(repoRoot, options.outPolicyAuditMarkdown) } : {}),
    ...(options.outAdapterPriorityJson ? { outAdapterPriorityJson: path.resolve(repoRoot, options.outAdapterPriorityJson) } : {}),
    ...(options.outAdapterPriorityMarkdown ? { outAdapterPriorityMarkdown: path.resolve(repoRoot, options.outAdapterPriorityMarkdown) } : {}),
    ...(options.communityIndexPath ? { communityIndexPath: path.resolve(repoRoot, options.communityIndexPath) } : {}),
    ...(options.communityStatsPath ? { communityStatsPath: path.resolve(repoRoot, options.communityStatsPath) } : {}),
  };
}

function resolveRequiredValue(argv: string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return value;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage: pnpm run obsidian:matrix -- [options]

Options:
  --targets <path>      Target JSON path. Default: scripts/obsidian-real-plugin-p0-targets.json
  --out-json <path>     Output matrix JSON path.
  --out-md <path>       Output Markdown report path.
  --out-policy-audit-json <path>
                        Optional policy audit JSON output path.
  --out-policy-audit-md <path>
                        Optional policy audit Markdown output path.
  --out-adapter-priority-json <path>
                        Optional adapter priority JSON output path.
  --out-adapter-priority-md <path>
                        Optional adapter priority Markdown output path.
  --community-index-file <path>
                        Read community-plugins.json from a local official snapshot.
  --community-stats-file <path>
                        Read community-plugin-stats.json from a local official snapshot.
  --skip-smoke          Generate preflight matrix without loading plugins in a temp Mind root.
  --run-workflow-probes Run explicit workflow probes after successful load smoke.
  --timeout-ms <ms>     Network asset timeout passed to preflight fetches. Default: ${DEFAULT_TIMEOUT_MS}
  --main-js-max-mb <mb> Max plugin main.js size for this offline matrix harness. Default: ${DEFAULT_MAIN_JS_MAX_MB}
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targetConfig = readJson<TargetConfig>(options.targetsPath);
  const targets = normalizeTargets(targetConfig);
  const targetSet = targetConfig.targetSet ?? 'obsidian-p0-ecosystem-sample';
  const sourcePolicy = targetConfig.sourcePolicy ?? 'obsidian-community-index+github-release-assets';

  console.log(`[obsidian-matrix] Targets: ${targets.length}`);
  const catalogRaw = await readJsonOrFetch({
    label: 'community index',
    localPath: options.communityIndexPath,
    url: OBSIDIAN_COMMUNITY_PLUGINS_URL,
    timeoutMs: options.timeoutMs,
  });
  const parsedCatalog = parseObsidianCommunityCatalog(catalogRaw);
  const catalogById = new Map(parsedCatalog.items.map((item) => [item.id, item]));

  const statsById = await readJsonOrFetch({
    label: 'community stats',
    localPath: options.communityStatsPath,
    url: OBSIDIAN_COMMUNITY_STATS_URL,
    timeoutMs: options.timeoutMs,
  }) as CommunityStatsById;

  const plugins: ObsidianRealPluginMatrixInputItem[] = [];
  const failures: ObsidianRealPluginMatrixFailure[] = [];

  for (const target of targets) {
    const catalog = catalogById.get(target.id);
    if (!catalog) {
      failures.push({ id: target.id, stage: 'catalog', error: 'Plugin id was not found in the Obsidian community index.' });
      console.warn(`[obsidian-matrix] ! ${target.id}: not found in community index`);
      continue;
    }

    try {
      console.log(`[obsidian-matrix] Preflight ${catalog.name} (${catalog.repo})`);
      const fetched = await fetchObsidianCommunityPluginPackage({
        repo: catalog.repo,
        pluginId: catalog.id,
        timeoutMs: options.timeoutMs,
        mainJsMaxChars: options.mainJsMaxChars,
      });
      const capabilityGate = buildObsidianCapabilityGateReport({
        manifest: fetched.preflight.package.manifest,
        compatibility: fetched.preflight.compatibility.report,
        compatibilityLevel: fetched.preflight.compatibility.level,
        coverage: fetched.preflight.derivedCapabilities.coverage,
      });
      const smoke = options.skipSmoke
        ? notRunSmoke('Smoke harness was skipped by --skip-smoke.')
        : await runPluginSmoke(catalog.id, fetched.files, capabilityGate.blocked, options.runWorkflowProbes).catch((error) => failedSmoke(
          'load',
          error instanceof Error ? error.message : String(error),
        ));
      plugins.push({
        target,
        catalog: {
          id: catalog.id,
          name: catalog.name,
          description: catalog.description,
          author: catalog.author,
          repo: catalog.repo,
          ...(catalog.githubUrl ?? githubUrlForRepo(catalog.repo) ? { githubUrl: catalog.githubUrl ?? githubUrlForRepo(catalog.repo) } : {}),
        },
        stats: statsFor(statsById[catalog.id]),
        preflight: fetched.preflight,
        capabilityGate,
        smoke,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: target.id, stage: 'preflight', error: message });
      console.warn(`[obsidian-matrix] ! ${target.id}: ${message}`);
    }
  }

  const matrix = buildObsidianRealPluginMatrix({
    generatedAt: new Date().toISOString(),
    targetSet,
    sourcePolicy,
    sources: {
      communityPlugins: OBSIDIAN_COMMUNITY_PLUGINS_URL,
      communityStats: OBSIDIAN_COMMUNITY_STATS_URL,
      releaseAssets: 'https://github.com/<owner>/<repo>/releases/download/<manifest.version>/{manifest.json,main.js,styles.css}',
    },
    plugins,
    failures,
  });

  writeText(options.outJson, `${JSON.stringify(matrix, null, 2)}\n`);
  writeText(options.outMarkdown, renderObsidianRealPluginMatrixMarkdown(matrix));

  console.log(`[obsidian-matrix] Wrote ${path.relative(repoRoot, options.outJson)}`);
  console.log(`[obsidian-matrix] Wrote ${path.relative(repoRoot, options.outMarkdown)}`);
  if (options.outPolicyAuditJson || options.outPolicyAuditMarkdown) {
    const audit = buildObsidianRealPluginPolicyAudit(matrix);
    if (options.outPolicyAuditJson) {
      writeText(options.outPolicyAuditJson, `${JSON.stringify(audit, null, 2)}\n`);
      console.log(`[obsidian-matrix] Wrote ${path.relative(repoRoot, options.outPolicyAuditJson)}`);
    }
    if (options.outPolicyAuditMarkdown) {
      writeText(options.outPolicyAuditMarkdown, renderObsidianRealPluginPolicyAuditMarkdown(audit));
      console.log(`[obsidian-matrix] Wrote ${path.relative(repoRoot, options.outPolicyAuditMarkdown)}`);
    }
  }
  if (options.outAdapterPriorityJson || options.outAdapterPriorityMarkdown) {
    const adapterPriority = buildObsidianRealPluginAdapterPriorityReport(matrix);
    if (options.outAdapterPriorityJson) {
      writeText(options.outAdapterPriorityJson, `${JSON.stringify(adapterPriority, null, 2)}\n`);
      console.log(`[obsidian-matrix] Wrote ${path.relative(repoRoot, options.outAdapterPriorityJson)}`);
    }
    if (options.outAdapterPriorityMarkdown) {
      writeText(options.outAdapterPriorityMarkdown, renderObsidianRealPluginAdapterPriorityMarkdown(adapterPriority));
      console.log(`[obsidian-matrix] Wrote ${path.relative(repoRoot, options.outAdapterPriorityMarkdown)}`);
    }
  }
  if (failures.length > 0) {
    console.warn(`[obsidian-matrix] Completed with ${failures.length} recorded failure(s). See the report for details.`);
  }
}

function normalizeTargets(config: TargetConfig): ObsidianRealPluginTarget[] {
  if (!Array.isArray(config.plugins) || config.plugins.length === 0) {
    throw new Error('Target config must include a non-empty plugins array.');
  }
  const seen = new Set<string>();
  return config.plugins.map((plugin, index) => {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error(`Invalid target at index ${index}.`);
    }
    const id = normalizeRequiredString(plugin.id, `plugins[${index}].id`);
    if (seen.has(id)) throw new Error(`Duplicate plugin target id: ${id}`);
    seen.add(id);
    return {
      id,
      priority: plugin.priority,
      category: normalizeRequiredString(plugin.category, `plugins[${index}].category`),
      reason: normalizeRequiredString(plugin.reason, `plugins[${index}].reason`),
    };
  });
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonOrFetch(options: {
  label: string;
  localPath?: string;
  url: string;
  timeoutMs: number;
}): Promise<unknown> {
  if (options.localPath) {
    console.log(`[obsidian-matrix] Reading ${options.label}: ${path.relative(repoRoot, options.localPath)}`);
    return readJson<unknown>(options.localPath);
  }
  console.log(`[obsidian-matrix] Fetching ${options.label}: ${options.url}`);
  return fetchJson(options.url, options.timeoutMs);
}

async function runPluginSmoke(
  pluginId: string,
  files: { manifestJson: string; mainJs: string; stylesCss?: string },
  gateBlocked: boolean,
  runWorkflowProbes: boolean,
): Promise<ObsidianRealPluginSmokeResult> {
  const mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-p0-smoke-'));
  try {
    const { PluginManager } = await import('@/lib/obsidian-compat/plugin-manager');
    writePluginPackage(mindRoot, pluginId, files);
    if (runWorkflowProbes) {
      writeWorkflowProbeFixture(mindRoot, pluginId, files);
    }
    const manager = new PluginManager(mindRoot);
    await manager.discover();
    const discovered = manager.list().find((plugin) => plugin.id === pluginId);
    if (!discovered) {
      return { outcome: 'failed', stage: 'load', reason: 'Plugin package was not discovered after writing release assets.' };
    }
    if (gateBlocked) {
      return {
        outcome: 'skipped',
        stage: 'capability-gate',
        reason: discovered.capabilityGate.blockedReasons[0] ?? discovered.compatibility.blockers[0] ?? 'Blocked by capability gate.',
      };
    }

    try {
      await manager.enable(pluginId, { confirmCapabilityGate: true });
    } catch (error) {
      return {
        outcome: 'failed',
        stage: 'enable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const load = await manager.loadEnabledPlugins();
    const afterLoad = manager.list().find((plugin) => plugin.id === pluginId);
    if (load.loaded.includes(pluginId)) {
      const workflowProbes = runWorkflowProbes
        ? summarizeObsidianWorkflowProbeResults(await manager.runWorkflowProbes(pluginId))
        : undefined;
      return {
        outcome: 'loaded',
        stage: 'load',
        loaded: load.loaded,
        failed: load.failed,
        skipped: load.skipped,
        ...(afterLoad ? { runtime: runtimeSummary(afterLoad) } : {}),
        ...(workflowProbes ? { workflowProbes } : {}),
      };
    }
    if (load.skipped.includes(pluginId)) {
      return {
        outcome: 'skipped',
        stage: 'load',
        reason: afterLoad?.capabilityGate.blockedReasons[0] ?? afterLoad?.lastError ?? 'Skipped by loadEnabledPlugins().',
        loaded: load.loaded,
        failed: load.failed,
        skipped: load.skipped,
      };
    }
    return {
      outcome: 'failed',
      stage: 'load',
      reason: afterLoad?.lastError ?? 'Plugin did not load and no runtime error was recorded.',
      loaded: load.loaded,
      failed: load.failed,
      skipped: load.skipped,
      ...(afterLoad ? { runtime: runtimeSummary(afterLoad) } : {}),
    };
  } finally {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  }
}

function writePluginPackage(
  mindRoot: string,
  pluginId: string,
  files: { manifestJson: string; mainJs: string; stylesCss?: string },
): void {
  const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), files.manifestJson, 'utf-8');
  fs.writeFileSync(path.join(pluginDir, 'main.js'), files.mainJs, 'utf-8');
  if (typeof files.stylesCss === 'string') {
    fs.writeFileSync(path.join(pluginDir, 'styles.css'), files.stylesCss, 'utf-8');
  }
}

function writeWorkflowProbeFixture(
  mindRoot: string,
  pluginId: string,
  files: { manifestJson: string },
): void {
  const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
  if (pluginId === 'recent-files-obsidian') {
    fs.writeFileSync(
      path.join(pluginDir, 'data.json'),
      `${JSON.stringify(buildRecentFilesWorkflowProbeDataJson(), null, 2)}\n`,
      'utf-8',
    );
    for (const row of RECENT_FILES_WORKFLOW_PROBE_FIXTURE.rows) {
      const notePath = path.join(mindRoot, row.path);
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.writeFileSync(notePath, row.content, 'utf-8');
    }
    return;
  }
  if (pluginId === 'periodic-notes') {
    fs.writeFileSync(
      path.join(pluginDir, 'data.json'),
      `${JSON.stringify(buildPeriodicNotesWorkflowProbeDataJson(), null, 2)}\n`,
      'utf-8',
    );
    fs.mkdirSync(path.join(mindRoot, PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.folder), { recursive: true });
    const templatePath = path.join(mindRoot, PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.templatePath);
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, PERIODIC_NOTES_WORKFLOW_PROBE_FIXTURE.templateContent, 'utf-8');
    return;
  }
  if (pluginId !== 'quickadd') return;
  const manifest = parseJsonObject(files.manifestJson);
  const version = typeof manifest?.version === 'string' ? manifest.version : undefined;
  fs.writeFileSync(
    path.join(pluginDir, 'data.json'),
    `${JSON.stringify(buildQuickAddWorkflowProbeDataJson(version), null, 2)}\n`,
    'utf-8',
  );
  const templatePath = path.join(mindRoot, QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.templatePath);
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  fs.writeFileSync(templatePath, QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.templateContent, 'utf-8');
}

function runtimeSummary(plugin: RuntimeSummarySource): NonNullable<ObsidianRealPluginSmokeResult['runtime']> {
  const runtime = plugin.runtime;
  return {
    commands: runtime?.commands ?? 0,
    settingTabs: runtime?.settingTabs ?? 0,
    views: runtime?.views ?? 0,
    markdownPostProcessors: runtime?.markdownPostProcessors ?? 0,
    markdownCodeBlockProcessors: runtime?.markdownCodeBlockProcessors ?? 0,
    ribbonIcons: runtime?.ribbonIcons ?? 0,
    statusBarItems: runtime?.statusBarItems ?? 0,
    styleSheets: runtime?.styleSheets ?? 0,
    editorExtensions: runtime?.editorExtensions ?? 0,
  };
}

function notRunSmoke(reason: string): ObsidianRealPluginSmokeResult {
  return { outcome: 'not-run', stage: 'not-run', reason };
}

function failedSmoke(stage: ObsidianRealPluginSmokeResult['stage'], reason: string): ObsidianRealPluginSmokeResult {
  return { outcome: 'failed', stage, reason };
}

function statsFor(stats: CommunityStatsRecord | undefined): { downloads?: number; updated?: string } | undefined {
  if (!stats) return undefined;
  return {
    ...(typeof stats.downloads === 'number' ? { downloads: stats.downloads } : {}),
    ...(typeof stats.updated === 'number' ? { updated: new Date(stats.updated).toISOString() } : {}),
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
