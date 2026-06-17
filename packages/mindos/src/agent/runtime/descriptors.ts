import {
  acpCapabilities,
  acpHarnessCapabilities,
  claudeCapabilities,
  claudeHarnessCapabilities,
  codexCapabilities,
  codexHarnessCapabilities,
  mindosCapabilities,
  mindosHarnessCapabilities,
} from './capabilities.js';
import {
  compactRuntimeHintsForDescriptor,
} from './detection.js';
import {
  summarizeRuntimeFailure,
} from './runtime-errors.js';
import type {
  AgentRuntimeDescriptor,
  AgentRuntimeStatus,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
  NativeRuntimeId,
} from './registry.js';

export function nativeRuntimeDiagnosticHints(input: {
  id: NativeRuntimeId;
  name: string;
  status: AgentRuntimeStatus;
  reason?: string;
  binaryPath?: string;
  installCmd?: string;
}): string[] {
  if (input.status === 'available') return [];
  const command = input.id === 'codex' ? 'codex' : 'claude';
  const hints: string[] = [];

  if (input.status === 'missing') {
    hints.push(`MindOS checked command "${command}" on the server PATH.`);
    hints.push(input.installCmd
      ? `Install it or add it to the PATH used to start MindOS: ${input.installCmd}`
      : `Install ${input.name} or add it to the PATH used to start MindOS.`);
    return hints;
  }

  if (input.binaryPath) {
    hints.push(`MindOS detected ${input.name} at ${input.binaryPath}.`);
  }

  if (input.status === 'signed-out') {
    hints.push(input.id === 'codex'
      ? 'Run "codex login status" from the same environment that starts MindOS.'
      : 'Run Claude Code once from the same environment that starts MindOS.');
  } else {
    hints.push(input.id === 'codex'
      ? 'Run "codex app-server --help" from the MindOS server environment.'
      : 'Run "claude --version" from the MindOS server environment.');
  }

  if (input.reason && /(environment variable|cannot see|env)/i.test(input.reason)) {
    hints.push('Restart MindOS after exporting the required environment variable so the server process inherits it.');
  }

  return hints;
}

export function nativeDescriptor(input: {
  id: NativeRuntimeId;
  name: string;
  checkedAt: string;
  source?: DetectedRuntimeAgent;
  missing?: MissingRuntimeAgent;
}): AgentRuntimeDescriptor {
  const status = input.source ? input.source.status ?? 'available' : input.missing?.status ?? 'missing';
  const runtimeBridge = input.source?.runtimeBridge;
  const rawReason = input.source?.reason ?? input.missing?.reason;
  const reasonSummary = rawReason ? summarizeRuntimeFailure(rawReason, { runtime: input.id }) : null;
  const reason = reasonSummary?.reason;
  const sourceDiagnosticHints = compactRuntimeHintsForDescriptor(
    input.source?.diagnosticHints ?? input.missing?.diagnosticHints,
    input.id,
    reason,
  );
  const diagnosticHints = Array.from(new Set([
    ...sourceDiagnosticHints,
    ...(reasonSummary?.diagnosticHints ?? []),
    ...nativeRuntimeDiagnosticHints({
      id: input.id,
      name: input.name,
      status,
      reason,
      binaryPath: input.source?.binaryPath,
      installCmd: input.missing?.installCmd,
    }),
  ]));

  return {
    id: input.id,
    runtimeId: input.id,
    category: 'native',
    name: input.name,
    kind: input.id,
    adapter: input.id === 'codex' ? 'codex-app-server' : runtimeBridge?.kind === 'claude-cli' ? 'claude-cli' : 'claude-sdk',
    modelOwner: 'external',
    authOwner: 'external',
    permissionOwner: 'external',
    sessionOwner: 'external',
    status,
    capabilities: input.id === 'codex' ? codexCapabilities : claudeCapabilities,
    harnessCapabilities: input.id === 'codex' ? codexHarnessCapabilities : claudeHarnessCapabilities,
    ...(runtimeBridge ? { runtimeBridge } : {}),
    description: input.id === 'codex'
      ? 'Local Codex app-server runtime. Model, approval, and thread behavior are owned by Codex.'
      : 'Local Claude Code runtime. Model, permission, and session behavior are owned by Claude Code.',
    aliases: input.id === 'codex' ? ['codex-acp'] : ['claude-code', 'claude'],
    ...(input.id === 'codex' ? { mcpAgentKey: 'codex' } : { mcpAgentKey: 'claude-code' }),
    ...(input.source ? {
      sourceAgentId: input.source.id,
      canonicalAgentId: input.source.id,
      binaryPath: input.source.binaryPath,
      ...(input.source.resolvedCommand ? { resolvedCommand: input.source.resolvedCommand } : {}),
    } : {}),
    ...(!input.source && input.missing ? {
      sourceAgentId: input.missing.id,
      canonicalAgentId: input.missing.id,
      installCmd: input.missing.installCmd,
      ...(input.missing.packageName ? { packageName: input.missing.packageName } : {}),
    } : {}),
    availability: {
      checkedAt: input.checkedAt,
      sources: ['native-health'],
      ...(reason
        ? { reason }
        : !input.source
          ? { reason: `${input.name} executable was not detected.` }
          : {}),
      ...(diagnosticHints.length > 0 ? { diagnosticHints } : {}),
    },
  };
}

export function mindosRuntimeDescriptor(checkedAt: string): AgentRuntimeDescriptor {
  return {
    id: 'mindos',
    runtimeId: 'mindos',
    category: 'mindos',
    name: 'MindOS',
    kind: 'mindos',
    adapter: 'mindos',
    modelOwner: 'mindos',
    authOwner: 'mindos',
    permissionOwner: 'mindos',
    sessionOwner: 'mindos',
    status: 'available',
    capabilities: mindosCapabilities,
    harnessCapabilities: mindosHarnessCapabilities,
    description: 'MindOS internal agent using the selected provider and model.',
    availability: { checkedAt, sources: ['settings'] },
  };
}

export function acpRuntimeDescriptor(agent: DetectedRuntimeAgent, checkedAt: string): AgentRuntimeDescriptor {
  return {
    id: agent.id,
    runtimeId: agent.id,
    category: 'acp',
    name: agent.name,
    kind: 'acp',
    adapter: 'acp',
    modelOwner: 'external',
    authOwner: 'external',
    permissionOwner: 'external',
    sessionOwner: 'external',
    status: agent.status ?? 'available',
    capabilities: acpCapabilities,
    harnessCapabilities: acpHarnessCapabilities,
    description: 'ACP agent selected as the Chat Panel runtime.',
    sourceAgentId: agent.id,
    canonicalAgentId: agent.id,
    binaryPath: agent.binaryPath,
    ...(agent.resolvedCommand ? { resolvedCommand: agent.resolvedCommand } : {}),
    availability: {
      checkedAt,
      sources: agent.status && agent.status !== 'available' ? ['acp-detect', 'native-health'] : ['acp-detect'],
      ...(agent.reason ? { reason: agent.reason } : {}),
    },
  };
}
