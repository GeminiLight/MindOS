import { json, type MindosServerResponse } from '../response.js';
import { redactSensitiveObject, redactSensitiveText } from '../../session/redaction.js';

export type AgentCapabilityMode = 'organize' | 'agent';

export type AgentCapabilityKind =
  | 'kb-tool'
  | 'pi-subagent'
  | 'acp-agent'
  | 'native-runtime'
  | 'mcp-tool'
  | 'a2a-agent'
  | 'mindos-headless';

export type AgentCapabilitySource =
  | 'mindos'
  | 'pi-subagents'
  | 'acp'
  | 'native'
  | 'mcp'
  | 'a2a';

export type AgentCapabilityStatus = 'available' | 'missing' | 'disabled' | 'cached' | 'error';
export type AgentCapabilityPermissionRequired = 'readonly' | 'organize' | 'agent';

export type AgentCapabilityInput = {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  description?: unknown;
  source?: unknown;
  status?: unknown;
  permissionRequired?: unknown;
  availableInModes?: unknown;
  inputKinds?: unknown;
  outputKinds?: unknown;
  supportsStreaming?: unknown;
  supportsCancel?: unknown;
  supportsBackgroundRuns?: unknown;
  supportsApprovals?: unknown;
  supportsUserInput?: unknown;
  defaultTimeoutMs?: unknown;
  metadata?: unknown;
};

export type AgentCapability = {
  id: string;
  kind: AgentCapabilityKind;
  name: string;
  description: string;
  source: AgentCapabilitySource;
  status: AgentCapabilityStatus;
  permissionRequired: AgentCapabilityPermissionRequired;
  availableInModes: AgentCapabilityMode[];
  inputKinds: string[];
  outputKinds: string[];
  supportsStreaming: boolean;
  supportsCancel: boolean;
  supportsBackgroundRuns: boolean;
  supportsApprovals: boolean;
  supportsUserInput: boolean;
  defaultTimeoutMs: number;
  metadata?: Record<string, unknown>;
};

export type AgentCapabilitySourceKey = 'kb' | 'subagents' | 'acp' | 'native' | 'mcp' | 'a2a';

export type AgentCapabilitySourceStatus = {
  id: AgentCapabilitySourceKey;
  status: 'ok' | 'error';
  count: number;
  error?: string;
};

export type AgentCapabilitiesPayload = {
  mode: AgentCapabilityMode;
  include: AgentCapabilitySourceKey[];
  capabilities: AgentCapability[];
  sources: AgentCapabilitySourceStatus[];
};

export type AgentCapabilitiesServices = Partial<Record<
  AgentCapabilitySourceKey,
  () => AgentCapabilityInput[] | Promise<AgentCapabilityInput[]>
>>;

const SOURCE_ORDER = ['kb', 'subagents', 'acp', 'native', 'mcp', 'a2a'] as const satisfies readonly AgentCapabilitySourceKey[];
const MODE_ORDER = ['organize', 'agent'] as const satisfies readonly AgentCapabilityMode[];
const KIND_SET = new Set<AgentCapabilityKind>([
  'kb-tool',
  'pi-subagent',
  'acp-agent',
  'native-runtime',
  'mcp-tool',
  'a2a-agent',
  'mindos-headless',
]);
const SOURCE_SET = new Set<AgentCapabilitySource>(['mindos', 'pi-subagents', 'acp', 'native', 'mcp', 'a2a']);
const STATUS_SET = new Set<AgentCapabilityStatus>(['available', 'missing', 'disabled', 'cached', 'error']);
const PERMISSION_SET = new Set<AgentCapabilityPermissionRequired>(['readonly', 'organize', 'agent']);

export async function handleAgentCapabilitiesGet(
  searchParams: URLSearchParams,
  services: AgentCapabilitiesServices = {},
): Promise<MindosServerResponse<AgentCapabilitiesPayload>> {
  const mode = normalizeMode(searchParams.get('mode'));
  const include = normalizeInclude(searchParams.get('include'));
  const sources: AgentCapabilitySourceStatus[] = [];
  const capabilities: AgentCapability[] = [];

  for (const sourceId of SOURCE_ORDER) {
    if (!include.includes(sourceId)) continue;
    const loader = services[sourceId];
    if (!loader) {
      sources.push({ id: sourceId, status: 'ok', count: 0 });
      continue;
    }

    try {
      const loaded = await loader();
      const normalized = loaded
        .map((item) => normalizeCapability(item))
        .filter((item): item is AgentCapability => Boolean(item))
        .filter((item) => item.availableInModes.includes(mode));
      capabilities.push(...normalized);
      sources.push({ id: sourceId, status: 'ok', count: normalized.length });
    } catch (error) {
      sources.push({
        id: sourceId,
        status: 'error',
        count: 0,
        error: redactSensitiveText(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return json({
    mode,
    include,
    capabilities: sortCapabilities(capabilities),
    sources,
  });
}

function normalizeMode(value: string | null): AgentCapabilityMode {
  return value === 'organize' || value === 'agent' ? value : 'agent';
}

function normalizeInclude(value: string | null): AgentCapabilitySourceKey[] {
  if (!value) return [...SOURCE_ORDER];
  const requested = new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is AgentCapabilitySourceKey => SOURCE_ORDER.includes(item as AgentCapabilitySourceKey)),
  );
  return SOURCE_ORDER.filter((source) => requested.has(source));
}

function normalizeCapability(input: AgentCapabilityInput): AgentCapability | null {
  const kind = typeof input.kind === 'string' && KIND_SET.has(input.kind as AgentCapabilityKind)
    ? input.kind as AgentCapabilityKind
    : null;
  const source = typeof input.source === 'string' && SOURCE_SET.has(input.source as AgentCapabilitySource)
    ? input.source as AgentCapabilitySource
    : null;
  const name = typeof input.name === 'string' && input.name.trim()
    ? redactSensitiveText(input.name.trim())
    : null;
  if (!kind || !source || !name) return null;

  const permissionRequired = typeof input.permissionRequired === 'string' && PERMISSION_SET.has(input.permissionRequired as AgentCapabilityPermissionRequired)
    ? input.permissionRequired as AgentCapabilityPermissionRequired
    : 'agent';
  const availableInModes = normalizeModes(input.availableInModes, permissionRequired);
  if (availableInModes.length === 0) return null;

  const status = typeof input.status === 'string' && STATUS_SET.has(input.status as AgentCapabilityStatus)
    ? input.status as AgentCapabilityStatus
    : 'available';
  const id = typeof input.id === 'string' && input.id.trim()
    ? redactSensitiveText(input.id.trim())
    : `${kind}:${source}:${name}`;
  const defaultTimeoutMs = typeof input.defaultTimeoutMs === 'number' && Number.isFinite(input.defaultTimeoutMs) && input.defaultTimeoutMs > 0
    ? Math.floor(input.defaultTimeoutMs)
    : 30_000;

  const metadata = sanitizeMetadata(input.metadata);

  return {
    id,
    kind,
    name,
    description: typeof input.description === 'string' ? redactSensitiveText(input.description) : '',
    source,
    status,
    permissionRequired,
    availableInModes,
    inputKinds: normalizeStringArray(input.inputKinds),
    outputKinds: normalizeStringArray(input.outputKinds),
    supportsStreaming: input.supportsStreaming === true,
    supportsCancel: input.supportsCancel === true,
    supportsBackgroundRuns: input.supportsBackgroundRuns === true,
    supportsApprovals: input.supportsApprovals === true,
    supportsUserInput: input.supportsUserInput === true,
    defaultTimeoutMs,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function normalizeModes(
  value: unknown,
  permissionRequired: AgentCapabilityPermissionRequired,
): AgentCapabilityMode[] {
  const fallback: AgentCapabilityMode[] = permissionRequired === 'readonly'
    ? ['organize', 'agent']
    : permissionRequired === 'organize'
      ? ['organize', 'agent']
      : ['agent'];
  if (!Array.isArray(value)) return fallback;
  const requested = new Set(value.filter((item): item is AgentCapabilityMode => MODE_ORDER.includes(item as AgentCapabilityMode)));
  return MODE_ORDER.filter((mode) => requested.has(mode));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => redactSensitiveText(item.trim()));
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const redacted = redactSensitiveObject(value);
  const jsonSafe = toJsonSafe(redacted, 0);
  return jsonSafe && typeof jsonSafe === 'object' && !Array.isArray(jsonSafe)
    ? jsonSafe as Record<string, unknown>
    : undefined;
}

function toJsonSafe(value: unknown, depth: number): unknown {
  if (depth > 8) return '[max-depth]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonSafe(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const safeNested = toJsonSafe(nested, depth + 1);
      if (safeNested !== undefined) output[redactSensitiveText(key)] = safeNested;
    }
    return output;
  }
  return undefined;
}

function sortCapabilities(capabilities: AgentCapability[]): AgentCapability[] {
  return [...capabilities].sort((a, b) => (
    SOURCE_ORDER.indexOf(sourceKeyForCapability(a)) - SOURCE_ORDER.indexOf(sourceKeyForCapability(b))
    || a.kind.localeCompare(b.kind)
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id)
  ));
}

function sourceKeyForCapability(capability: AgentCapability): AgentCapabilitySourceKey {
  if (capability.source === 'mindos') return 'kb';
  if (capability.source === 'pi-subagents') return 'subagents';
  return capability.source;
}
