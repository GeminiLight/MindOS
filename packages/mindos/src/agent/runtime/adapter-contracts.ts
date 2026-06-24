import type {
  AgentRuntimeAdapterContract,
  AgentRuntimeAdapterDeclaredCommand,
  AgentRuntimeAdapterMetadata,
  AgentRuntimeResolvedCommandSource,
  DetectedRuntimeAgent,
  NativeRuntimeId,
} from './registry.js';

function declaredCommands(
  metadata: AgentRuntimeAdapterMetadata | undefined,
): AgentRuntimeAdapterDeclaredCommand[] {
  return (metadata?.commands ?? []).map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    source: 'adapter-declared',
  }));
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
  };
}

export function acpAdapterContract(agent: DetectedRuntimeAgent): AgentRuntimeAdapterContract {
  const metadata = agent.adapterMetadata;
  const commands = declaredCommands(metadata);
  const resolvedCommand = agent.resolvedCommand?.cmd;
  const healthCommand = metadata?.healthCheck?.command;
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
  };
}
