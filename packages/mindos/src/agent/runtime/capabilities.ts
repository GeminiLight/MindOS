import type {
  AcpAgentCapabilities,
  AcpMcpCapabilities,
  AcpPromptCapabilities,
} from './acp-types.js';
import { isAcpCapabilitySupported } from './acp-types.js';
import type {
  AcpAgentAdapterMetadata,
  AcpAgentAdapterSessionCapabilities,
} from './adapter-metadata.js';
import { normalizeRuntimeOutputKinds } from './adapter-output.js';
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeHarnessCapabilities,
} from './registry.js';

export const mindosCapabilities: AgentRuntimeCapabilities = {
  agentModes: {
    plan: 'mindos-managed',
    goal: 'mindos-managed',
  },
  ownsModelSelection: true,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: true,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: true,
  supportsApprovals: false,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: true,
};

const nativeBaseCapabilities: AgentRuntimeCapabilities = {
  agentModes: {
    plan: 'runtime-native',
    goal: 'runtime-native',
  },
  ownsModelSelection: true,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: false,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: true,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: false,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: true,
};

export const codexCapabilities: AgentRuntimeCapabilities = {
  ...nativeBaseCapabilities,
  supportsListSessions: true,
  supportsAttachExisting: true,
  supportsFork: true,
  supportsArchive: true,
};

export const claudeCapabilities: AgentRuntimeCapabilities = {
  ...nativeBaseCapabilities,
  supportsListSessions: true,
  supportsAttachExisting: true,
};

export const mindosHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'local-id',
  eventStream: ['text', 'tool-events', 'runtime-status', 'user-input'],
  workspace: 'local-cwd',
  permissions: 'mindos-only',
  tools: ['file', 'mcp', 'skills'],
  output: ['text', 'artifact'],
};

export const codexHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'native-thread',
  eventStream: ['text', 'tool-events', 'thread-turn-item', 'runtime-status', 'permissions', 'user-input'],
  workspace: 'local-cwd',
  permissions: 'runtime-bridged',
  tools: ['shell', 'file', 'git', 'mcp'],
  output: ['text', 'diff', 'checkpoint', 'artifact', 'branch', 'pr'],
};

export const claudeHarnessCapabilities: AgentRuntimeHarnessCapabilities = {
  session: 'local-id',
  eventStream: ['text', 'tool-events', 'runtime-status', 'permissions', 'user-input'],
  workspace: 'local-cwd',
  permissions: 'runtime-bridged',
  tools: ['shell', 'file', 'git', 'mcp'],
  output: ['text', 'diff', 'artifact'],
};

/* ── ACP: declared × observed ──────────────────────────────────────────── */

/**
 * What an ACP agent says about itself. Comes from the `initialize` response
 * (cached by handshake health) or, before any handshake, from the adapter
 * metadata a descriptor / settings entry declared statically.
 */
export type AcpDeclaredCapabilities = {
  loadSession?: boolean;
  sessionCapabilities?: AcpAgentAdapterSessionCapabilities;
  mcpCapabilities?: AcpMcpCapabilities;
  promptCapabilities?: AcpPromptCapabilities;
  /** Number of `authMethods` offered in `initialize`, when a handshake recorded it. */
  authMethodCount?: number;
};

/**
 * What the MindOS ACP session layer (`protocols/acp/session*.ts`,
 * `subprocess.ts`) actually implements on the client side. A capability the
 * agent declares only counts when MindOS can drive it.
 * `protocols/acp/session-layer-support.test.ts` checks this table against the
 * exported session API so it cannot promise more than the code does.
 */
export type AcpSessionLayerSupport = {
  newSession: boolean;
  loadSession: boolean;
  listSessions: boolean;
  closeSession: boolean;
  cancelPrompt: boolean;
  /** `session/request_permission` is answered by the ACP client bridge and surfaced as permission events. */
  requestPermission: boolean;
  /** MindOS MCP servers are passed into `session/new` / `session/load`. */
  mcpInheritance: boolean;
  configOptions: boolean;
  userInput: boolean;
  fork: boolean;
  deleteSession: boolean;
};

export const ACP_SESSION_LAYER_SUPPORT: AcpSessionLayerSupport = {
  newSession: true,
  loadSession: true,
  listSessions: true,
  closeSession: true,
  cancelPrompt: true,
  requestPermission: true,
  mcpInheritance: true,
  configOptions: true,
  userInput: false,
  fork: false,
  deleteSession: false,
};

/** The subset of a handshake-health result the runtime layer reads; `AcpHandshakeHealthResult` is assignable. */
export type AcpHandshakeFacts = {
  status: 'ready' | 'failed';
  stage: string;
  message?: string;
  capabilities?: AcpAgentCapabilities;
  session?: {
    supportsLoadSession?: boolean;
    supportsListSessions?: boolean;
    authMethodCount?: number;
  };
};

export function declaredAcpCapabilitiesFromMetadata(
  metadata: Pick<AcpAgentAdapterMetadata, 'sessionCapabilities' | 'mcpCapabilities' | 'promptCapabilities'> | undefined,
): AcpDeclaredCapabilities | undefined {
  if (!metadata) return undefined;
  const declared: AcpDeclaredCapabilities = {};
  if (metadata.sessionCapabilities) {
    declared.sessionCapabilities = metadata.sessionCapabilities;
    if (metadata.sessionCapabilities.loadSession !== undefined) declared.loadSession = metadata.sessionCapabilities.loadSession;
  }
  if (metadata.mcpCapabilities) declared.mcpCapabilities = metadata.mcpCapabilities;
  if (metadata.promptCapabilities) declared.promptCapabilities = metadata.promptCapabilities;
  return Object.keys(declared).length > 0 ? declared : undefined;
}

export function declaredAcpCapabilitiesFromHandshake(
  handshake: AcpHandshakeFacts | undefined,
): AcpDeclaredCapabilities | undefined {
  if (!handshake) return undefined;
  const declared: AcpDeclaredCapabilities = {};
  const capabilities = handshake.capabilities;
  const loadSession = capabilities?.loadSession ?? handshake.session?.supportsLoadSession;
  if (loadSession !== undefined) declared.loadSession = loadSession;
  if (capabilities?.sessionCapabilities) declared.sessionCapabilities = capabilities.sessionCapabilities;
  else if (handshake.session?.supportsListSessions) declared.sessionCapabilities = { list: true };
  if (capabilities?.mcpCapabilities) declared.mcpCapabilities = capabilities.mcpCapabilities;
  if (capabilities?.promptCapabilities) declared.promptCapabilities = capabilities.promptCapabilities;
  if (handshake.session?.authMethodCount !== undefined) declared.authMethodCount = handshake.session.authMethodCount;
  return Object.keys(declared).length > 0 ? declared : undefined;
}

/** Later sources win per key (a live handshake over static metadata); nested flag objects merge shallowly. */
export function mergeAcpDeclaredCapabilities(
  base: AcpDeclaredCapabilities | undefined,
  override: AcpDeclaredCapabilities | undefined,
): AcpDeclaredCapabilities | undefined {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    ...(base.sessionCapabilities || override.sessionCapabilities
      ? { sessionCapabilities: { ...base.sessionCapabilities, ...override.sessionCapabilities } }
      : {}),
    ...(base.mcpCapabilities || override.mcpCapabilities
      ? { mcpCapabilities: { ...base.mcpCapabilities, ...override.mcpCapabilities } }
      : {}),
    ...(base.promptCapabilities || override.promptCapabilities
      ? { promptCapabilities: { ...base.promptCapabilities, ...override.promptCapabilities } }
      : {}),
  };
}

function declaresMcpTransport(mcp: AcpMcpCapabilities | undefined): boolean {
  return !!mcp && (mcp.stdio === true || mcp.http === true || mcp.sse === true || mcp.acp === true);
}

/**
 * Combine what the agent declared with what the session layer implements.
 * Nothing here is agent-specific: an agent that declares `loadSession` gets
 * `supportsResume`, one that does not stays at `false`, and approvals come
 * from MindOS answering `session/request_permission` regardless of agent.
 */
export function acpCapabilitiesFromHandshake(
  declared: AcpDeclaredCapabilities | undefined,
  observed: AcpSessionLayerSupport = ACP_SESSION_LAYER_SUPPORT,
): { capabilities: AgentRuntimeCapabilities; harnessCapabilities: AgentRuntimeHarnessCapabilities } {
  const loadSession = observed.loadSession && declared?.loadSession === true;
  const listSessions = observed.listSessions && isAcpCapabilitySupported(declared?.sessionCapabilities?.list);
  const fork = observed.fork && isAcpCapabilitySupported(declared?.sessionCapabilities?.fork);
  const archive = observed.deleteSession && isAcpCapabilitySupported(declared?.sessionCapabilities?.delete);
  const mcp = observed.mcpInheritance && declaresMcpTransport(declared?.mcpCapabilities);
  const approvals = observed.requestPermission;
  const userInput = observed.userInput;

  const capabilities: AgentRuntimeCapabilities = {
    agentModes: {
      plan: 'unsupported',
      goal: 'unsupported',
    },
    ownsModelSelection: true,
    supportsResume: loadSession,
    supportsFreshSession: observed.newSession,
    supportsListSessions: listSessions,
    supportsAttachExisting: loadSession && listSessions,
    supportsFork: fork,
    supportsArchive: archive,
    supportsInterrupt: observed.cancelPrompt,
    supportsModelList: false,
    supportsApprovals: approvals,
    supportsUserInput: userInput,
    supportsToolEvents: true,
    supportsRuntimeStatus: false,
    supportsDiffs: false,
    supportsCheckpoints: false,
    supportsBackgroundRuns: false,
    supportsMcpConfig: mcp,
  };

  const harnessCapabilities: AgentRuntimeHarnessCapabilities = {
    session: loadSession ? (listSessions ? 'native-thread' : 'local-id') : 'none',
    eventStream: [
      'text',
      'tool-events',
      ...(approvals ? ['permissions' as const] : []),
      ...(userInput ? ['user-input' as const] : []),
    ],
    workspace: 'local-cwd',
    permissions: approvals ? 'runtime-bridged' : 'none',
    tools: ['shell', 'file', ...(mcp ? ['mcp' as const] : [])],
    output: ['text'],
  };

  return { capabilities, harnessCapabilities };
}

/** Capabilities of an ACP agent that declared nothing; kept for callers that imported the old constants. */
const undeclaredAcp = acpCapabilitiesFromHandshake(undefined);
export const acpCapabilities: AgentRuntimeCapabilities = undeclaredAcp.capabilities;
export const acpHarnessCapabilities: AgentRuntimeHarnessCapabilities = undeclaredAcp.harnessCapabilities;

/** Descriptor-time view: static adapter metadata is the only declared source before a handshake. */
export function acpRuntimeCapabilitiesForAdapter(
  metadata?: AcpAgentAdapterMetadata,
): { capabilities: AgentRuntimeCapabilities; harnessCapabilities: AgentRuntimeHarnessCapabilities } {
  const derived = acpCapabilitiesFromHandshake(declaredAcpCapabilitiesFromMetadata(metadata));
  return {
    capabilities: derived.capabilities,
    harnessCapabilities: {
      ...derived.harnessCapabilities,
      output: normalizeRuntimeOutputKinds(metadata, derived.harnessCapabilities.output),
    },
  };
}

export function acpHarnessCapabilitiesForAdapter(
  metadata?: AcpAgentAdapterMetadata,
): AgentRuntimeHarnessCapabilities {
  return acpRuntimeCapabilitiesForAdapter(metadata).harnessCapabilities;
}
