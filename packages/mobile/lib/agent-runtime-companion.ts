import type {
  AgentRuntimeDescriptor,
  AgentRuntimeIdentity,
  AgentRuntimeKind,
  AgentRuntimeStatus,
  AgentRuntimesResponse,
  AskMode,
} from './types';

export type RuntimeCompanionTone = 'success' | 'warning' | 'error' | 'muted';

export interface RuntimeCompanionItem {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
  status: AgentRuntimeStatus | 'unknown';
  statusLabel: string;
  tone: RuntimeCompanionTone;
  icon: 'sparkles-outline' | 'terminal-outline' | 'code-slash-outline' | 'git-network-outline';
  mobileRole: string;
  mobileHint: string;
  bridgeLabel?: string;
  diagnosticHint?: string;
  available: boolean;
  reported: boolean;
}

export interface RuntimeCompanionSummary {
  items: RuntimeCompanionItem[];
  availableCount: number;
  totalCount: number;
  statusLabel: string;
  headline: string;
  detail: string;
}

export interface RuntimeCompanionOption extends AgentRuntimeIdentity {
  status: AgentRuntimeStatus | 'unknown';
  statusLabel: string;
  tone: RuntimeCompanionTone;
  selectable: boolean;
  selectedRuntime: AgentRuntimeIdentity | null;
  subtitle: string;
  detail: string;
  bridgeLabel?: string;
}

export interface RuntimeComposerPresentation {
  placeholder: string;
  emptyTitle: string;
  emptySubtitle: string;
  modeHint: string;
  agentModeEnabled: boolean;
  suggestions: string[];
}

const RUNTIME_BLUEPRINTS: Array<{
  id: string;
  name: string;
  kind: AgentRuntimeKind;
  icon: RuntimeCompanionItem['icon'];
  mobileRole: string;
  mobileHint: string;
}> = [
  {
    id: 'mindos',
    name: 'MindOS Agent',
    kind: 'mindos',
    icon: 'sparkles-outline',
    mobileRole: 'Built-in assistant',
    mobileHint: 'Chat with your connected MindOS workspace from this phone.',
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'codex',
    icon: 'terminal-outline',
    mobileRole: 'Host coding agent',
    mobileHint: 'Runs through the connected MindOS host; mobile is the control surface.',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    kind: 'claude',
    icon: 'code-slash-outline',
    mobileRole: 'Claude Code Agent',
    mobileHint: 'Runs where Claude Code is installed or linked; mobile controls the turn through MindOS.',
  },
  {
    id: 'acp',
    name: 'Remote ACP',
    kind: 'acp',
    icon: 'git-network-outline',
    mobileRole: 'Remote agent protocol',
    mobileHint: 'Connects through the MindOS server when ACP agents are configured.',
  },
];

const RUNTIME_ORDER: Record<AgentRuntimeKind, number> = {
  mindos: 0,
  codex: 1,
  claude: 2,
  acp: 3,
};

const MINDOS_RUNTIME: AgentRuntimeDescriptor = {
  id: 'mindos',
  name: 'MindOS Agent',
  kind: 'mindos',
  adapter: 'mindos',
  status: 'available',
};

export function runtimeKey(runtime: AgentRuntimeIdentity | null): string {
  return runtime?.id || 'mindos';
}

export function selectedRuntimeForOption(option: RuntimeCompanionOption): AgentRuntimeIdentity | null {
  if (!option.selectable) return null;
  return option.kind === 'mindos'
    ? null
    : { id: option.id, name: option.name, kind: option.kind };
}

export function buildRuntimeCompanionOptions(
  response?: AgentRuntimesResponse | null,
): RuntimeCompanionOption[] {
  const runtimes = normalizeRuntimeDescriptors(response?.runtimes);
  const usedIds = new Set<string>();

  const blueprintOptions = RUNTIME_BLUEPRINTS.map((blueprint) => {
    const descriptor = findRuntimeDescriptor(runtimes, blueprint.kind, blueprint.id)
      ?? (blueprint.kind === 'mindos' ? MINDOS_RUNTIME : undefined);
    if (descriptor) usedIds.add(descriptor.id);
    return toRuntimeOption(blueprint, descriptor);
  });

  const extraOptions = runtimes
    .filter((runtime) => !usedIds.has(runtime.id))
    .sort((a, b) => {
      const order = RUNTIME_ORDER[a.kind] - RUNTIME_ORDER[b.kind];
      if (order !== 0) return order;
      return a.name.localeCompare(b.name);
    })
    .map((runtime) => toRuntimeOption(runtime, runtime));

  return [...blueprintOptions, ...extraOptions];
}

export function coerceSelectedRuntime(
  selectedRuntime: AgentRuntimeIdentity | null,
  response?: AgentRuntimesResponse | null,
): AgentRuntimeIdentity | null {
  const selectedKey = runtimeKey(selectedRuntime);
  const option = buildRuntimeCompanionOptions(response).find((item) => item.id === selectedKey);
  if (!option?.selectable) return null;
  return selectedRuntimeForOption(option);
}

export function buildRuntimeCompanionSummary(
  response?: AgentRuntimesResponse | null,
): RuntimeCompanionSummary {
  const runtimes = Array.isArray(response?.runtimes) ? response.runtimes : [];
  const items = RUNTIME_BLUEPRINTS.map((blueprint) => {
    const descriptor = findRuntimeDescriptor(runtimes, blueprint.kind, blueprint.id);
    return toCompanionItem(blueprint, descriptor);
  });
  const availableCount = items.filter((item) => item.available).length;
  const hasErrors = items.some((item) => item.tone === 'error');
  const hasWarnings = items.some((item) => item.tone === 'warning');
  const totalCount = items.length;

  return {
    items,
    availableCount,
    totalCount,
    statusLabel: `${availableCount}/${totalCount} ready`,
    headline: availableCount > 1
      ? 'Mobile companion is connected to agent runtimes.'
      : availableCount === 1
        ? 'MindOS chat is ready on mobile.'
        : 'Connect to MindOS to inspect agent runtimes.',
    detail: hasErrors
      ? 'One or more runtimes needs attention on the connected machine.'
      : hasWarnings
        ? 'Some runtimes need desktop sign-in or setup before mobile can use them.'
        : 'Local agents still run on the desktop or cloud host; this phone stays as the control surface.',
  };
}

export function compactRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return 'Unable to refresh agent runtimes.';
  if (/timed out|timeout/i.test(message)) return 'Runtime status check timed out. Pull to retry.';
  if (/network|failed to fetch|connection/i.test(message)) return 'MindOS server is unreachable. Check the connection.';
  if (/401|403|token|unauthorized|forbidden/i.test(message)) return 'Runtime status requires a valid access token.';
  return message.length > 96 ? `${message.slice(0, 93)}...` : message;
}

export function buildRuntimeComposerPresentation(
  option?: RuntimeCompanionOption | null,
  mode: AskMode = 'chat',
): RuntimeComposerPresentation {
  const runtime = option ?? toRuntimeOption(MINDOS_RUNTIME, MINDOS_RUNTIME);
  const kind = runtime.kind;
  const agentModeEnabled = runtime.selectable;
  const target = compactRuntimeName(runtime.name, kind);
  const suggestions = suggestionsForRuntime(kind, mode);
  const emptyTitle = mode === 'agent'
    ? agentTitleForRuntime(kind, target)
    : `Ask ${target}`;

  return {
    placeholder: mode === 'agent'
      ? `Ask ${target} to act...`
      : `Ask ${target}...`,
    emptyTitle,
    emptySubtitle: emptySubtitleForRuntime(kind, mode),
    modeHint: modeHintForRuntime(kind, mode),
    agentModeEnabled,
    suggestions,
  };
}

function normalizeRuntimeDescriptors(value: unknown): AgentRuntimeDescriptor[] {
  const input = Array.isArray(value) ? value : [];
  const byId = new Map<string, AgentRuntimeDescriptor>();
  byId.set(MINDOS_RUNTIME.id, MINDOS_RUNTIME);

  for (const item of input) {
    if (!isRuntimeDescriptor(item)) continue;
    byId.set(item.id, item);
  }

  return Array.from(byId.values());
}

function isRuntimeDescriptor(value: unknown): value is AgentRuntimeDescriptor {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AgentRuntimeDescriptor>;
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.name === 'string'
    && record.name.length > 0
    && isRuntimeKind(record.kind)
    && isRuntimeStatus(record.status);
}

function isRuntimeKind(value: unknown): value is AgentRuntimeKind {
  return value === 'mindos' || value === 'codex' || value === 'claude' || value === 'acp';
}

function isRuntimeStatus(value: unknown): value is AgentRuntimeStatus {
  return value === 'available' || value === 'missing' || value === 'signed-out' || value === 'error';
}

function findRuntimeDescriptor(
  runtimes: AgentRuntimeDescriptor[],
  kind: AgentRuntimeKind,
  id: string,
): AgentRuntimeDescriptor | undefined {
  return runtimes.find((runtime) => runtime.kind === kind)
    ?? runtimes.find((runtime) => runtime.id === id);
}

function toCompanionItem(
  blueprint: (typeof RUNTIME_BLUEPRINTS)[number],
  descriptor?: AgentRuntimeDescriptor,
): RuntimeCompanionItem {
  const status = descriptor?.status ?? 'unknown';
  const { statusLabel, tone } = statusPresentation(status);
  const diagnosticHint = descriptor?.availability?.diagnosticHints?.[0]
    ?? descriptor?.availability?.reason;

  return {
    id: descriptor?.id ?? blueprint.id,
    name: descriptor?.name ?? blueprint.name,
    kind: descriptor?.kind ?? blueprint.kind,
    status,
    statusLabel,
    tone,
    icon: blueprint.icon,
    mobileRole: blueprint.mobileRole,
    mobileHint: descriptor?.runtimeBridge?.reason ?? blueprint.mobileHint,
    bridgeLabel: descriptor?.runtimeBridge?.label,
    diagnosticHint,
    available: status === 'available',
    reported: Boolean(descriptor),
  };
}

function toRuntimeOption(
  runtimeOrBlueprint: AgentRuntimeDescriptor | (typeof RUNTIME_BLUEPRINTS)[number],
  descriptor?: AgentRuntimeDescriptor,
): RuntimeCompanionOption {
  const runtime = descriptor ?? runtimeOrBlueprint;
  const reportedDescriptor = descriptor
    ?? ('status' in runtimeOrBlueprint ? runtimeOrBlueprint : undefined);
  const status = reportedDescriptor?.status ?? (runtime.kind === 'mindos' ? 'available' : 'unknown');
  const { statusLabel, tone } = statusPresentation(status);
  const selectable = status === 'available';
  const option: RuntimeCompanionOption = {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    status,
    statusLabel,
    tone,
    selectable,
    selectedRuntime: null,
    subtitle: subtitleForRuntime(runtime),
    detail: detailForRuntime(runtime, reportedDescriptor),
    ...(reportedDescriptor?.runtimeBridge?.label ? { bridgeLabel: reportedDescriptor.runtimeBridge.label } : {}),
  };
  return {
    ...option,
    selectedRuntime: selectedRuntimeForOption(option),
  };
}

function subtitleForRuntime(runtime: Pick<AgentRuntimeDescriptor, 'kind'>): string {
  if (runtime.kind === 'mindos') return 'Built-in assistant';
  if (runtime.kind === 'codex') return 'Local Codex host';
  if (runtime.kind === 'claude') return 'Local Claude Code host';
  return 'External ACP runtime';
}

function detailForRuntime(
  runtime: AgentRuntimeDescriptor | (typeof RUNTIME_BLUEPRINTS)[number],
  descriptor?: AgentRuntimeDescriptor,
): string {
  const description = descriptor ? runtimeDescription(descriptor) : '';
  const status = descriptor?.status ?? (runtime.kind === 'mindos' ? 'available' : 'unknown');
  if (status === 'available') {
    return descriptor?.runtimeBridge?.label
      || description
      || 'Available from the connected MindOS server.';
  }
  const reason = firstSentence(descriptor?.availability?.reason || description);
  if (reason) return reason;
  if (descriptor?.installCmd) return `Install on the MindOS server: ${descriptor.installCmd}`;
  if (status === 'unknown') return 'Not reported by the connected MindOS server yet.';
  if (runtime.kind === 'codex') return 'Codex was not detected on the connected MindOS server.';
  if (runtime.kind === 'claude') return 'Claude Code was not detected on the connected MindOS server.';
  return 'This runtime is not available from the connected MindOS server.';
}

function runtimeDescription(runtime: AgentRuntimeDescriptor): string {
  const value = (runtime as { description?: unknown }).description;
  return typeof value === 'string' ? value : '';
}

function firstSentence(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const match = compact.match(/^(.{1,140}?[.!?])(?:\s|$)/);
  if (match?.[1]) return match[1];
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function statusPresentation(status: RuntimeCompanionItem['status']): {
  statusLabel: string;
  tone: RuntimeCompanionTone;
} {
  switch (status) {
    case 'available':
      return { statusLabel: 'Ready', tone: 'success' };
    case 'signed-out':
      return { statusLabel: 'Sign in', tone: 'warning' };
    case 'error':
      return { statusLabel: 'Needs attention', tone: 'error' };
    case 'missing':
      return { statusLabel: 'Not found', tone: 'muted' };
    case 'unknown':
    default:
      return { statusLabel: 'Not reported', tone: 'muted' };
  }
}

function compactRuntimeName(name: string, kind: AgentRuntimeKind): string {
  if (kind === 'mindos') return 'MindOS';
  if (kind === 'acp') return name === 'Remote ACP' ? 'Remote ACP' : name;
  return name;
}

function agentTitleForRuntime(kind: AgentRuntimeKind, target: string): string {
  if (kind === 'mindos') return 'Run MindOS Agent';
  if (kind === 'codex') return 'Run Codex on host';
  if (kind === 'claude') return 'Run Claude Code on host';
  if (kind === 'acp') return `Run ${target} on host`;
  return `Run ${target}`;
}

function emptySubtitleForRuntime(kind: AgentRuntimeKind, mode: AskMode): string {
  if (mode === 'chat') {
    if (kind === 'mindos') return 'Read, search, and reason over your connected workspace.';
    if (kind === 'codex') return 'Route this conversation to the connected Codex host.';
    if (kind === 'claude') return 'Route this conversation to the connected Claude Code host.';
    return 'Route this conversation to the configured ACP runtime.';
  }

  if (kind === 'mindos') return 'Use host tools, KB actions, subagents, and MCP through MindOS.';
  if (kind === 'codex') return 'Let Codex operate on the connected host workspace.';
  if (kind === 'claude') return 'Let Claude Code operate on the connected host workspace.';
  return 'Let the remote ACP runtime operate with its host-side tools.';
}

function modeHintForRuntime(kind: AgentRuntimeKind, mode: AskMode): string {
  if (mode === 'chat') {
    if (kind === 'mindos') return 'Chat mode uses read/search tools and avoids workspace edits.';
    if (kind === 'codex') return 'Chat mode routes to Codex with the host permission profile kept conservative.';
    if (kind === 'claude') return 'Chat mode routes to Claude Code with the host permission profile kept conservative.';
    return 'Chat mode routes to the ACP runtime without escalating host permissions.';
  }

  if (kind === 'mindos') {
    return 'Agent mode can use MindOS tools, subagents, MCP, and KB writes on the connected host.';
  }
  if (kind === 'codex') {
    return 'Agent mode lets Codex use host-side coding tools. Mobile approval sheets need the pending-request bridge.';
  }
  if (kind === 'claude') {
    return 'Agent mode lets Claude Code use host-side coding tools. Mobile approval sheets need the pending-request bridge.';
  }
  return 'Agent mode lets the ACP runtime use its host-side capabilities; permission UX depends on that runtime.';
}

function suggestionsForRuntime(kind: AgentRuntimeKind, mode: AskMode): string[] {
  if (kind === 'codex') {
    return mode === 'agent'
      ? ['Review the connected repo', 'Fix the failing test', 'Implement the next task', 'Summarize the diff']
      : ['Explain this code path', 'Review a proposed change', 'Plan a bug fix', 'Find risky files'];
  }

  if (kind === 'claude') {
    return mode === 'agent'
      ? ['Edit the connected workspace', 'Run a careful code review', 'Debug the current issue', 'Prepare a patch plan']
      : ['Explain the repository', 'Trace this behavior', 'Review the architecture', 'Summarize the session'];
  }

  if (kind === 'acp') {
    return mode === 'agent'
      ? ['Run the agent workflow', 'Inspect the connected project', 'Delegate this task', 'Report next actions']
      : ['Ask the remote agent', 'Summarize its context', 'Check available tools', 'Explain the next step'];
  }

  return mode === 'agent'
    ? ['Organize my notes', 'Use subagents to research', 'Create a follow-up plan', 'Update the workspace']
    : ['Summarize my recent notes', 'What did I write this week?', 'Find my TODO items', 'Help me brainstorm'];
}
