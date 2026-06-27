import type {
  AgentRuntimeAdapterContract,
  AgentRuntimeAdapterDeclaredCommand,
  AgentRuntimeAdapterMetadata,
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeResolvedCommandSource,
  DetectedRuntimeAgent,
  NativeRuntimeId,
} from './registry.js';
import {
  hasDeclaredRuntimeOutputContract,
  normalizeRuntimeOutputKinds,
  reviewableRuntimeOutputKinds,
} from './adapter-output.js';

function declaredCommands(
  metadata: AgentRuntimeAdapterMetadata | undefined,
): AgentRuntimeAdapterDeclaredCommand[] {
  return (metadata?.commands ?? []).map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    source: 'adapter-declared',
  }));
}

function protocolContract(input: {
  summary: string;
  metadata?: AgentRuntimeAdapterMetadata;
  supportsStreaming?: boolean | null;
  authRequired?: boolean | null;
}): AgentRuntimeAdapterContract['protocol'] {
  const metadata = input.metadata;
  const models = metadata?.models ?? [];
  return {
    ...(metadata?.connectionType ? { declaredConnectionType: metadata.connectionType } : {}),
    supportsStreaming: metadata?.supportsStreaming ?? input.supportsStreaming ?? null,
    authRequired: metadata?.authRequired ?? input.authRequired ?? null,
    modelCount: models.length,
    models,
    ...(metadata?.promptCapabilities ? { promptCapabilities: metadata.promptCapabilities } : {}),
    ...(metadata?.mcpCapabilities ? { mcpCapabilities: metadata.mcpCapabilities } : {}),
    ...(metadata?.sessionCapabilities ? { sessionCapabilities: metadata.sessionCapabilities } : {}),
    summary: input.summary,
  };
}

function outputContract(input: {
  summary: string;
  discovery: AgentRuntimeAdapterContract['output']['discovery'];
  metadata?: AgentRuntimeAdapterMetadata;
  fallback?: readonly AgentRuntimeHarnessCapabilities['output'][number][];
}): AgentRuntimeAdapterContract['output'] {
  const outputKinds = normalizeRuntimeOutputKinds(input.metadata, input.fallback ?? ['text']);
  const reviewableOutputKinds = reviewableRuntimeOutputKinds(outputKinds);
  return {
    discovery: input.discovery,
    outputKinds,
    reviewableOutputKinds,
    supportsFileChanges: outputKinds.includes('diff'),
    supportsArtifacts: outputKinds.includes('artifact'),
    supportsCheckpoints: outputKinds.includes('checkpoint'),
    supportsBranches: outputKinds.includes('branch'),
    supportsPullRequests: outputKinds.includes('pr'),
    summary: input.summary,
  };
}

export function mindosAdapterContract(): AgentRuntimeAdapterContract {
  return {
    schemaVersion: 1,
    connection: {
      kind: 'internal',
      owner: 'mindos',
      summary: 'MindOS Pi runs inside the MindOS runtime process.',
    },
    configuration: {
      modelSelection: 'mindos-session',
      credentials: 'mindos-settings',
      settings: 'mindos-settings',
      summary: 'MindOS owns provider, model, and permission controls for the built-in agent.',
    },
    health: {
      mode: 'mindos-native',
      owner: 'mindos',
      summary: 'MindOS health is derived from provider settings, model resolution, and runtime bootstrap.',
    },
    commands: {
      discovery: 'mindos-skills',
      commands: [],
      summary: 'MindOS slash commands are assembled from enabled MindOS skills; runtime-native command discovery is not needed.',
    },
    output: outputContract({
      discovery: 'mindos-default',
      fallback: ['text', 'artifact'],
      summary: 'MindOS emits text and pointer-backed artifacts through its internal runtime ledger.',
    }),
    protocol: protocolContract({
      supportsStreaming: true,
      authRequired: false,
      summary: 'MindOS is an internal runtime, so protocol capabilities are owned by the product runtime rather than an external ACP handshake.',
    }),
  };
}

export function nativeAdapterContract(input: {
  id: NativeRuntimeId;
  command?: string;
  commandSource?: AgentRuntimeResolvedCommandSource;
  bridgeKind?: 'codex-app-server' | 'claude-sdk' | 'claude-cli';
}): AgentRuntimeAdapterContract {
  const isCodex = input.id === 'codex';
  const isCliFallback = input.bridgeKind === 'claude-cli';
  return {
    schemaVersion: 1,
    connection: {
      kind: isCodex ? 'app-server' : isCliFallback ? 'cli' : 'sdk',
      owner: 'mindos',
      summary: isCodex
        ? 'MindOS connects to the local Codex app-server and lets Codex own execution semantics.'
        : isCliFallback
          ? 'MindOS uses the Claude Code CLI fallback when the SDK bridge is unavailable.'
          : 'MindOS uses the Claude Code SDK bridge and lets Claude own execution semantics.',
      ...(input.command ? { command: input.command } : {}),
      ...(input.command && input.commandSource ? { commandSource: input.commandSource } : {}),
    },
    configuration: {
      modelSelection: 'runtime-native',
      credentials: 'runtime-native',
      settings: 'runtime-native',
      summary: isCodex
        ? 'Codex owns model, auth, and local runtime settings; MindOS only selects the Codex runtime/session.'
        : 'Claude Code owns model, auth, and local runtime settings; MindOS only selects the Claude runtime/session.',
    },
    health: {
      mode: 'mindos-native',
      owner: 'mindos',
      summary: isCodex
        ? 'MindOS probes Codex app-server availability and provider/login environment before offering the runtime.'
        : 'MindOS probes Claude Code availability and bridge readiness before offering the runtime.',
      ...(input.command ? { command: input.command } : {}),
      timeoutMs: 20_000,
    },
    commands: {
      discovery: 'runtime-event',
      commands: [],
      summary: 'Runtime-native command discovery is delegated to the external coding runtime when it exposes command events.',
    },
    output: outputContract({
      discovery: 'runtime-native',
      fallback: isCodex
        ? ['text', 'diff', 'checkpoint', 'artifact', 'branch', 'pr']
        : ['text', 'diff', 'artifact'],
      summary: isCodex
        ? 'Codex owns reviewable runtime output including diffs, checkpoints, artifacts, branches, and PR references.'
        : 'Claude Code owns reviewable runtime output including text, diffs, and artifacts.',
    }),
    protocol: protocolContract({
      supportsStreaming: true,
      authRequired: true,
      summary: isCodex
        ? 'Codex exposes runtime-native streaming and auth through its app-server and CLI profile rather than generic ACP metadata.'
        : 'Claude Code exposes runtime-native streaming and auth through its SDK/CLI bridge rather than generic ACP metadata.',
    }),
  };
}

export function acpAdapterContract(agent: DetectedRuntimeAgent): AgentRuntimeAdapterContract {
  const metadata = agent.adapterMetadata;
  const commands = declaredCommands(metadata);
  const resolvedCommand = agent.resolvedCommand?.cmd;
  const healthCommand = metadata?.healthCheck?.command;
  const declaredOutput = hasDeclaredRuntimeOutputContract(metadata);
  return {
    schemaVersion: 1,
    connection: {
      kind: 'stdio',
      owner: 'mindos',
      summary: 'MindOS launches the ACP adapter over stdio and delegates agent semantics to that adapter.',
      ...(resolvedCommand ? { command: resolvedCommand } : {}),
      ...(agent.resolvedCommand?.source ? { commandSource: agent.resolvedCommand.source } : {}),
    },
    configuration: {
      modelSelection: 'adapter-declared',
      credentials: agent.resolvedCommand?.source === 'user-override' ? 'adapter-declared' : 'runtime-native',
      settings: agent.resolvedCommand?.source === 'user-override' ? 'adapter-declared' : 'runtime-native',
      summary: 'Generic ACP adapters own their model, auth, and settings semantics unless they declare a richer contract.',
    },
    health: {
      mode: metadata?.healthCheck ? 'adapter-declared' : 'unknown',
      owner: metadata?.healthCheck ? 'mindos' : 'external',
      summary: metadata?.healthCheck?.summary
        ?? 'MindOS can detect the ACP adapter process, but adapter-specific health semantics are not declared.',
      ...(healthCommand ? { command: healthCommand } : {}),
      ...(metadata?.healthCheck?.timeoutMs !== undefined ? { timeoutMs: metadata.healthCheck.timeoutMs } : {}),
    },
    commands: {
      discovery: commands.length > 0 ? 'adapter-declared' : 'unknown',
      commands,
      summary: commands.length > 0
        ? 'This ACP adapter declares static slash commands for MindOS to surface in command-aware UI.'
        : 'MindOS has no adapter-specific command declaration yet; runtime command discovery remains unknown.',
    },
    output: outputContract({
      discovery: declaredOutput ? 'adapter-declared' : 'unknown',
      metadata,
      summary: declaredOutput
        ? 'This ACP adapter declares durable output kinds that MindOS can project into artifact and file-change workflows.'
        : 'MindOS only knows this ACP adapter can return text; durable artifacts, file changes, checkpoints, branches, and PR outputs are not declared.',
    }),
    protocol: protocolContract({
      metadata,
      summary: metadata
        ? 'This ACP adapter declares protocol capabilities that MindOS can project into runtime diagnostics.'
        : 'This ACP adapter has not declared protocol capabilities yet; MindOS only knows it can launch a stdio ACP process.',
    }),
  };
}
