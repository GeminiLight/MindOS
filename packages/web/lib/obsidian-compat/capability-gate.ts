import { createHash } from 'crypto';
import type { CompatibilityLevel, PluginCompatibilityReport } from './compatibility-report';
import type {
  ObsidianCapabilityCoverage,
  ObsidianCapabilitySurface,
  ObsidianCapabilitySupport,
} from './capability-matrix';

export type ObsidianCapabilityGateDecision =
  | 'granted'
  | 'limited'
  | 'snapshot-only'
  | 'catalog-only'
  | 'request-only'
  | 'requires-confirmation'
  | 'blocked';

export type ObsidianCapabilityGateRisk = 'low' | 'medium' | 'high';
export type ObsidianCapabilityGateStatus = 'ready' | 'limited' | 'review' | 'blocked';

export interface ObsidianCapabilityGateConfirmation {
  confirmedAt: string;
  fingerprint: string;
  surfaces: ObsidianCapabilitySurface[];
}

export interface ObsidianCapabilityGateItem {
  surface: ObsidianCapabilitySurface;
  decision: ObsidianCapabilityGateDecision;
  risk: ObsidianCapabilityGateRisk;
  apiCount: number;
  apis: string[];
  supportSummary: Record<ObsidianCapabilitySupport, number>;
  reason: string;
}

export interface ObsidianCapabilityGateReport {
  status: ObsidianCapabilityGateStatus;
  fingerprint: string;
  requiresConfirmation: boolean;
  confirmed: boolean;
  confirmedAt?: string;
  blocked: boolean;
  items: ObsidianCapabilityGateItem[];
  confirmReasons: string[];
  blockedReasons: string[];
}

export interface BuildObsidianCapabilityGateReportInput {
  manifest: { id: string; version?: string; minAppVersion?: string };
  compatibility: Pick<PluginCompatibilityReport, 'blockers' | 'unsupportedModules'>;
  compatibilityLevel: CompatibilityLevel;
  coverage: ObsidianCapabilityCoverage[];
  confirmation?: ObsidianCapabilityGateConfirmation;
}

export class ObsidianCapabilityGateConfirmationRequiredError extends Error {
  constructor(public readonly report: ObsidianCapabilityGateReport) {
    super('Obsidian plugin enable requires capability confirmation.');
    this.name = 'ObsidianCapabilityGateConfirmationRequiredError';
  }
}

const GATED_VAULT_APIS = new Set([
  'Vault.read',
  'Vault.readBinary',
  'Vault.cachedRead',
  'Vault.create',
  'Vault.createBinary',
  'Vault.modify',
  'Vault.modifyBinary',
  'Vault.append',
  'Vault.appendBinary',
  'Vault.process',
  'Vault.delete',
  'Vault.trash',
  'Vault.rename',
  'Vault.copy',
  'Vault.adapter',
  'Vault.getFiles',
  'Vault.getMarkdownFiles',
  'Vault.getAllLoadedFiles',
  'FileManager.processFrontMatter',
  'FileManager.renameFile',
  'FileManager.promptForDeletion',
  'FileManager.trashFile',
  'FileManager.getAvailablePathForAttachment',
]);

const SURFACE_ORDER: ObsidianCapabilitySurface[] = [
  'network',
  'secret',
  'vault',
  'metadata',
  'workspace',
  'editor',
  'settings',
  'views',
  'document',
  'entries',
  'styles',
  'commands',
  'core',
  'unsupported',
];

function emptySupportSummary(): Record<ObsidianCapabilitySupport, number> {
  return {
    full: 0,
    limited: 0,
    'snapshot-only': 0,
    'catalog-only': 0,
    'request-only': 0,
    unsupported: 0,
  };
}

function strongestDecision(items: ObsidianCapabilityCoverage[]): ObsidianCapabilityGateDecision {
  if (items.some((item) => item.support === 'unsupported' || item.surface === 'unsupported')) return 'blocked';
  if (items.some((item) => item.surface === 'network' || item.surface === 'secret')) return 'requires-confirmation';
  if (items.some((item) => item.surface === 'metadata')) return 'requires-confirmation';
  if (items.some((item) => item.surface === 'vault' && GATED_VAULT_APIS.has(item.api))) return 'requires-confirmation';
  if (items.some((item) => item.support === 'request-only')) return 'request-only';
  if (items.some((item) => item.support === 'catalog-only')) return 'catalog-only';
  if (items.some((item) => item.support === 'snapshot-only')) return 'snapshot-only';
  if (items.some((item) => item.support === 'limited')) return 'limited';
  return 'granted';
}

function riskForDecision(decision: ObsidianCapabilityGateDecision, surface: ObsidianCapabilitySurface): ObsidianCapabilityGateRisk {
  if (decision === 'blocked') return 'high';
  if (decision === 'requires-confirmation') return surface === 'network' || surface === 'secret' || surface === 'vault' ? 'high' : 'medium';
  if (decision === 'request-only' || decision === 'catalog-only') return 'medium';
  return 'low';
}

function reasonForItem(item: ObsidianCapabilityGateItem): string {
  if (item.decision === 'blocked') {
    return item.surface === 'unsupported'
      ? `Unsupported Obsidian APIs require a native or compatibility host before this plugin can run: ${item.apis.join(', ')}.`
      : `This surface includes unsupported Obsidian APIs: ${item.apis.join(', ')}.`;
  }
  if (item.decision === 'requires-confirmation') {
    if (item.surface === 'network') return 'Network APIs can contact external services; enable only after reviewing the plugin source and destination policy.';
    if (item.surface === 'secret') return 'Secret APIs can read and write plugin-scoped encrypted secrets.';
    if (item.surface === 'vault') return 'Vault APIs can read or change local MindOS files inside the vault boundary.';
    if (item.surface === 'metadata') return 'Metadata APIs can inspect note structure, links, frontmatter, and tags.';
    return `The ${item.surface} surface requires explicit user review before enabling.`;
  }
  if (item.decision === 'request-only') return 'Requests are recorded for a MindOS host to continue; the plugin does not receive native workspace control.';
  if (item.decision === 'catalog-only') return 'Registrations are kept as catalog metadata until a dedicated MindOS host exists.';
  if (item.decision === 'snapshot-only') return 'The host records safe snapshots instead of mounting native Obsidian UI.';
  if (item.decision === 'limited') return 'The API is available through a bounded MindOS compatibility host.';
  return 'The API is supported in the current MindOS compatibility host.';
}

function buildGateItems(coverage: ObsidianCapabilityCoverage[]): ObsidianCapabilityGateItem[] {
  const grouped = new Map<ObsidianCapabilitySurface, ObsidianCapabilityCoverage[]>();
  for (const item of coverage) {
    const items = grouped.get(item.surface) ?? [];
    items.push(item);
    grouped.set(item.surface, items);
  }

  return Array.from(grouped.entries())
    .map(([surface, items]) => {
      const supportSummary = emptySupportSummary();
      for (const item of items) {
        supportSummary[item.support] += 1;
      }
      const decision = strongestDecision(items);
      const gateItem: ObsidianCapabilityGateItem = {
        surface,
        decision,
        risk: riskForDecision(decision, surface),
        apiCount: items.length,
        apis: items.map((item) => item.api).sort((a, b) => a.localeCompare(b, 'en')),
        supportSummary,
        reason: '',
      };
      return {
        ...gateItem,
        reason: reasonForItem(gateItem),
      };
    })
    .sort((a, b) => {
      const orderA = SURFACE_ORDER.indexOf(a.surface);
      const orderB = SURFACE_ORDER.indexOf(b.surface);
      return (orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA)
        - (orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB)
        || a.surface.localeCompare(b.surface, 'en');
    });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprintFor(input: BuildObsidianCapabilityGateReportInput): string {
  const payload = {
    manifest: {
      id: input.manifest.id,
      version: input.manifest.version ?? '',
      minAppVersion: input.manifest.minAppVersion ?? '',
    },
    compatibilityLevel: input.compatibilityLevel,
    blockers: [...input.compatibility.blockers].sort((a, b) => a.localeCompare(b, 'en')),
    unsupportedModules: [...input.compatibility.unsupportedModules].sort((a, b) => a.localeCompare(b, 'en')),
    coverage: input.coverage
      .map((item) => ({
        api: item.api,
        surface: item.surface,
        support: item.support,
      }))
      .sort((a, b) => a.api.localeCompare(b.api, 'en')),
  };
  return createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 16);
}

export function buildObsidianCapabilityGateReport(
  input: BuildObsidianCapabilityGateReportInput,
): ObsidianCapabilityGateReport {
  const fingerprint = fingerprintFor(input);
  const items = buildGateItems(input.coverage);
  const blockedReasons = [
    ...input.compatibility.blockers,
    ...items.filter((item) => item.decision === 'blocked').map((item) => item.reason),
  ];
  const blocked = input.compatibilityLevel === 'blocked' || blockedReasons.length > 0;
  const confirmReasons = blocked
    ? []
    : items.filter((item) => item.decision === 'requires-confirmation').map((item) => item.reason);
  const requiresConfirmation = confirmReasons.length > 0;
  const confirmed = requiresConfirmation && input.confirmation?.fingerprint === fingerprint;
  const hasLimitedItems = items.some((item) => item.decision !== 'granted');
  const status: ObsidianCapabilityGateStatus = blocked
    ? 'blocked'
    : requiresConfirmation && !confirmed
      ? 'review'
      : hasLimitedItems
        ? 'limited'
        : 'ready';

  return {
    status,
    fingerprint,
    requiresConfirmation,
    confirmed,
    ...(confirmed && input.confirmation?.confirmedAt ? { confirmedAt: input.confirmation.confirmedAt } : {}),
    blocked,
    items,
    confirmReasons,
    blockedReasons,
  };
}

export function createObsidianCapabilityGateConfirmation(
  report: ObsidianCapabilityGateReport,
  confirmedAt = new Date().toISOString(),
): ObsidianCapabilityGateConfirmation {
  return {
    confirmedAt,
    fingerprint: report.fingerprint,
    surfaces: report.items
      .filter((item) => item.decision === 'requires-confirmation')
      .map((item) => item.surface)
      .sort((a, b) => a.localeCompare(b, 'en')),
  };
}

export function isObsidianCapabilityGateConfirmationRequiredError(
  error: unknown,
): error is ObsidianCapabilityGateConfirmationRequiredError {
  return error instanceof ObsidianCapabilityGateConfirmationRequiredError;
}
