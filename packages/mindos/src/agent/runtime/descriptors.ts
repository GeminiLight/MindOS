import {
  acpAdapterContract,
  mindosAdapterContract,
  nativeAdapterContract,
} from './adapter-contracts.js';
import {
  acpCapabilitiesFromHandshake,
  acpRuntimeCapabilitiesForAdapter,
  declaredAcpCapabilitiesFromHandshake,
  mergeAcpDeclaredCapabilities,
  mindosCapabilities,
  mindosHarnessCapabilities,
  type AcpDeclaredCapabilities,
  type AcpHandshakeFacts,
} from './capabilities.js';
import {
  acpRuntimeCompatibilityProfile,
  mindosRuntimeCompatibilityProfile,
  nativeRuntimeCompatibilityProfile,
} from './compatibility.js';
import {
  compactRuntimeHintsForDescriptor,
} from './detection.js';
import {
  acpRuntimeLifecycle,
  mindosRuntimeLifecycle,
  nativeRuntimeLifecycle,
} from './lifecycle.js';
import { nativeRuntimeDefinition } from './native-runtimes.js';
import {
  summarizeRuntimeFailure,
} from './runtime-errors.js';
import type {
  AgentRuntimeAdapterContract,
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
  const definition = nativeRuntimeDefinition(input.id);
  const hints: string[] = [];

  if (input.status === 'missing') {
    hints.push(`MindOS checked command "${definition.command}" on the server PATH.`);
    hints.push(input.installCmd
      ? `Install it or add it to the PATH used to start MindOS: ${input.installCmd}`
      : `Install ${input.name} or add it to the PATH used to start MindOS.`);
    return hints;
  }

  if (input.binaryPath) {
    hints.push(`MindOS detected ${input.name} at ${input.binaryPath}.`);
  }

  hints.push(input.status === 'signed-out' ? definition.diagnostics.signedOut : definition.diagnostics.health);

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
  const definition = nativeRuntimeDefinition(input.id);
  const status = input.source ? input.source.status ?? 'available' : input.missing?.status ?? 'missing';
  const runtimeBridge = input.source?.runtimeBridge;
  const bridgeKind = runtimeBridge?.kind ?? definition.defaultBridge;
  const capabilities = definition.capabilities;
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
  const harnessCapabilities = definition.harnessCapabilities;
  const lifecycle = nativeRuntimeLifecycle(input.id, capabilities);

  return {
    id: input.id,
    runtimeId: input.id,
    category: 'native',
    name: input.name,
    kind: input.id,
    adapter: bridgeKind,
    modelOwner: 'external',
    authOwner: 'external',
    permissionOwner: 'external',
    sessionOwner: 'external',
    status,
    capabilities,
    harnessCapabilities,
    lifecycle,
    compatibility: nativeRuntimeCompatibilityProfile(input.id, {
      capabilities,
      harnessCapabilities,
      lifecycle,
      status,
    }),
    adapterContract: nativeAdapterContract({
      id: input.id,
      command: input.source?.resolvedCommand?.cmd,
      commandSource: input.source?.resolvedCommand?.source,
      bridgeKind,
    }),
    ...(runtimeBridge ? { runtimeBridge } : {}),
    description: definition.description,
    aliases: [...definition.aliases],
    mcpAgentKey: definition.mcpAgentKey,
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
  const lifecycle = mindosRuntimeLifecycle(mindosCapabilities);
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
    lifecycle,
    compatibility: mindosRuntimeCompatibilityProfile({
      capabilities: mindosCapabilities,
      harnessCapabilities: mindosHarnessCapabilities,
      lifecycle,
      status: 'available',
    }),
    adapterContract: mindosAdapterContract(),
    description: 'MindOS internal agent using the selected provider and model.',
    availability: { checkedAt, sources: ['settings'] },
  };
}

/**
 * Descriptor-time ACP capabilities come from what the adapter declared
 * statically (descriptor / settings metadata). A cached handshake refines them
 * through `applyAcpHandshakeToRuntime` once the agent has answered `initialize`.
 */
export function acpRuntimeDescriptor(agent: DetectedRuntimeAgent, checkedAt: string): AgentRuntimeDescriptor {
  const status = agent.status ?? 'available';
  const { capabilities, harnessCapabilities } = acpRuntimeCapabilitiesForAdapter(agent.adapterMetadata);
  const lifecycle = acpRuntimeLifecycle(capabilities);
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
    status,
    capabilities,
    harnessCapabilities,
    lifecycle,
    compatibility: acpRuntimeCompatibilityProfile({
      capabilities,
      harnessCapabilities,
      lifecycle,
      status,
    }),
    adapterContract: acpAdapterContract(agent),
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

function declaredAcpCapabilitiesFromProtocolContract(
  protocol: AgentRuntimeAdapterContract['protocol'],
): AcpDeclaredCapabilities | undefined {
  const declared: AcpDeclaredCapabilities = {};
  if (protocol.sessionCapabilities) {
    declared.sessionCapabilities = protocol.sessionCapabilities;
    if (protocol.sessionCapabilities.loadSession !== undefined) declared.loadSession = protocol.sessionCapabilities.loadSession;
  }
  if (protocol.mcpCapabilities) declared.mcpCapabilities = protocol.mcpCapabilities;
  if (protocol.promptCapabilities) declared.promptCapabilities = protocol.promptCapabilities;
  return Object.keys(declared).length > 0 ? declared : undefined;
}

/**
 * Refine an ACP runtime descriptor with a cached `initialize` handshake: the
 * agent's live capability declaration replaces the static one, and a failed
 * `authenticate` stage turns an otherwise available runtime into `signed-out`
 * (the same status native runtimes report when their login check fails).
 * Non-ACP runtimes and missing handshakes pass through untouched, so this is
 * safe to apply to a whole runtime list and idempotent when applied twice.
 */
export function applyAcpHandshakeToRuntime(
  runtime: AgentRuntimeDescriptor,
  handshake: AcpHandshakeFacts | undefined,
): AgentRuntimeDescriptor {
  if (runtime.kind !== 'acp' || !handshake) return runtime;
  const declared = mergeAcpDeclaredCapabilities(
    declaredAcpCapabilitiesFromProtocolContract(runtime.adapterContract.protocol),
    declaredAcpCapabilitiesFromHandshake(handshake),
  );
  const derived = acpCapabilitiesFromHandshake(declared);
  const capabilities = derived.capabilities;
  const harnessCapabilities = {
    ...derived.harnessCapabilities,
    output: runtime.harnessCapabilities?.output ?? derived.harnessCapabilities.output,
  };
  const signedOut = handshake.status === 'failed' && handshake.stage === 'authenticate' && runtime.status === 'available';
  const status: AgentRuntimeStatus = signedOut ? 'signed-out' : runtime.status;
  const lifecycle = acpRuntimeLifecycle(capabilities);
  const protocol = runtime.adapterContract.protocol;
  const authRequired = protocol.authRequired ?? (declared?.authMethodCount !== undefined ? declared.authMethodCount > 0 : null);
  const sources = Array.from(new Set([...(runtime.availability?.sources ?? []), 'acp-session' as const]));

  return {
    ...runtime,
    status,
    capabilities,
    harnessCapabilities,
    lifecycle,
    compatibility: acpRuntimeCompatibilityProfile({ capabilities, harnessCapabilities, lifecycle, status }),
    adapterContract: {
      ...runtime.adapterContract,
      protocol: {
        ...protocol,
        authRequired,
        ...(declared?.promptCapabilities ? { promptCapabilities: declared.promptCapabilities } : {}),
        ...(declared?.mcpCapabilities ? { mcpCapabilities: declared.mcpCapabilities } : {}),
        ...(declared?.sessionCapabilities || declared?.loadSession !== undefined
          ? {
              sessionCapabilities: {
                ...declared?.sessionCapabilities,
                ...(declared?.loadSession !== undefined ? { loadSession: declared.loadSession } : {}),
              },
            }
          : {}),
      },
    },
    availability: {
      checkedAt: runtime.availability?.checkedAt ?? new Date(0).toISOString(),
      ...runtime.availability,
      sources,
      ...(signedOut
        ? { reason: handshake.message ?? `${runtime.name} is installed but not signed in for this MindOS server environment.` }
        : {}),
    },
  };
}
