import type {
  AgentRuntimeCapabilities,
  AgentRuntimeLifecycle,
  AgentRuntimeLifecycleStage,
  AgentRuntimeLifecycleStageDescriptor,
  NativeRuntimeId,
} from './registry.js';

export const agentRuntimeLifecycleStages: AgentRuntimeLifecycleStage[] = [
  'detect',
  'health',
  'configure',
  'launch',
  'session',
  'context',
  'execute',
  'interrupt',
  'archive',
  'remote',
  'coordinate',
];

function buildStages(
  overrides: Record<AgentRuntimeLifecycleStage, AgentRuntimeLifecycleStageDescriptor>,
): Record<AgentRuntimeLifecycleStage, AgentRuntimeLifecycleStageDescriptor> {
  return Object.fromEntries(
    agentRuntimeLifecycleStages.map((stage) => [stage, overrides[stage]]),
  ) as Record<AgentRuntimeLifecycleStage, AgentRuntimeLifecycleStageDescriptor>;
}

function unsupported(summary: string): AgentRuntimeLifecycleStageDescriptor {
  return { support: 'unsupported', owner: 'mindos', summary };
}

export function mindosRuntimeLifecycle(capabilities: AgentRuntimeCapabilities): AgentRuntimeLifecycle {
  return {
    schemaVersion: 1,
    stages: buildStages({
      detect: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['settings', 'runtime-registry'],
        summary: 'MindOS Pi is bundled with the MindOS runtime and is always registered by the local server.',
      },
      health: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['runtime-registry'],
        summary: 'MindOS reports the internal Pi lane as available when the product server is running.',
      },
      configure: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['settings'],
        summary: 'Provider, model, MCP, skill, and permission defaults are configured by MindOS.',
      },
      launch: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['turn-runner', 'mindos-pi-session'],
        summary: 'The MindOS Pi lane creates and restores the Pi runtime inside the MindOS server process.',
      },
      session: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['mindos-pi-session'],
        summary: 'Pi SessionManager owns persisted JSONL history and compaction entries; MindOS stores only session metadata and runtime bindings.',
      },
      context: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['turn-runner', 'mindos-pi-session', 'run-ledger'],
        summary: 'MindOS builds turn context and lets the Pi context extension own compaction before provider execution.',
      },
      execute: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['turn-runner', 'mindos-pi-session'],
        summary: 'MindOS streams the internal Pi run through the canonical turn runner.',
      },
      interrupt: capabilities.supportsInterrupt
        ? {
            support: 'owned',
            owner: 'mindos',
            sources: ['turn-runner'],
            summary: 'MindOS can interrupt active Pi runs through the product turn lane.',
          }
        : unsupported('MindOS Pi interruption is not exposed for this descriptor.'),
      archive: unsupported('MindOS Pi archive pointers are not exposed as a user-facing archive lifecycle yet.'),
      remote: {
        support: 'owned',
        owner: 'mindos',
        sources: ['runtime-registry'],
        summary: 'MindOS Pi can run wherever the MindOS server runs, but 24/7 scheduling still requires a separate scheduler and approval policy.',
      },
      coordinate: {
        support: 'owned',
        owner: 'mindos',
        sources: ['runtime-registry'],
        summary: 'MindOS can act as the primary runtime for shared context; a durable mailbox/task-board substrate is not implemented yet.',
      },
    }),
    remote: {
      supported: true,
      mode: 'server-runnable',
      unattended: capabilities.supportsBackgroundRuns ? 'supported' : 'limited',
      summary: 'Internal Pi runs are server-runnable, but autonomous 24/7 work is limited until background scheduling, approvals, and wake/resume policy are first-class.',
    },
    coordination: {
      role: 'primary',
      supportsSharedContext: true,
      supportsMailbox: false,
      supportsTaskBoard: false,
      summary: 'MindOS owns the shared context surface and can later coordinate workers, but it does not yet expose Team Mode mailbox or task-board primitives.',
    },
  };
}

export function nativeRuntimeLifecycle(
  runtime: NativeRuntimeId,
  capabilities: AgentRuntimeCapabilities,
): AgentRuntimeLifecycle {
  const name = runtime === 'codex' ? 'Codex' : 'Claude Code';
  const sessionSummary = runtime === 'codex'
    ? 'Codex owns its thread store; MindOS records only the runtime binding and archive pointer needed to resume.'
    : 'Claude Code owns its local session semantics; MindOS records only the runtime binding needed to resume.';
  const bridgeSource = runtime === 'codex' ? 'codex-app-server' : 'claude-bridge';

  return {
    schemaVersion: 1,
    stages: buildStages({
      detect: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['settings', 'native-health'],
        summary: `MindOS resolves the local ${name} command from settings, runtime PATH, and platform fallbacks.`,
      },
      health: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['native-health'],
        summary: `MindOS probes ${name} before marking the runtime available, then preserves the native diagnostic state.`,
      },
      configure: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['settings'],
        summary: `${name} owns model, auth, and native configuration; MindOS may provide command and environment overrides.`,
      },
      launch: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', bridgeSource],
        summary: `MindOS launches or attaches to the ${name} bridge, while the external runtime owns process behavior.`,
      },
      session: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', bridgeSource, 'run-ledger'],
        summary: sessionSummary,
      },
      context: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', bridgeSource],
        summary: `MindOS prepends active assistant and file context, but ${name} owns native history, compaction, and model-specific context handling.`,
      },
      execute: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', bridgeSource],
        summary: `${name} executes the turn through its native CLI/SDK bridge; MindOS normalizes the stream into product events.`,
      },
      interrupt: capabilities.supportsInterrupt
        ? {
            support: 'delegated',
            owner: 'external',
            sources: ['turn-runner', bridgeSource],
            summary: `${name} handles cancellation through its native bridge when the MindOS turn lane interrupts the run.`,
          }
        : unsupported(`${name} interruption is not exposed through the current bridge.`),
      archive: capabilities.supportsArchive
        ? {
            support: 'delegated',
            owner: 'external',
            sources: ['codex-app-server', 'run-ledger'],
            summary: `${name} owns archive state; MindOS stores the archive pointer and calls the native archive API.`,
          }
        : {
            support: 'unsupported',
            owner: 'external',
            sources: ['run-ledger'],
            summary: `${name} archive operations are not exposed through the current MindOS bridge.`,
          },
      remote: {
        support: 'delegated',
        owner: 'external',
        sources: ['native-health', 'turn-runner'],
        summary: `${name} can run remotely only when the MindOS server host has the CLI installed, authenticated, and permission flow reachable.`,
      },
      coordinate: {
        support: 'delegated',
        owner: 'external',
        sources: ['turn-runner', 'run-ledger'],
        summary: `${name} can act as an external worker through prompt/context bridging; MindOS has not added a mailbox contract for it yet.`,
      },
    }),
    remote: {
      supported: true,
      mode: 'server-runnable',
      unattended: capabilities.supportsBackgroundRuns ? 'supported' : 'limited',
      summary: `${name} is server-runnable through MindOS only on hosts where the native runtime is installed, signed in, and allowed to satisfy approval prompts.`,
    },
    coordination: {
      role: 'external-worker',
      supportsSharedContext: true,
      supportsMailbox: false,
      supportsTaskBoard: false,
      summary: `${name} can consume shared MindOS context as an external worker, but durable Team Mode mailbox/task-board primitives are not implemented yet.`,
    },
  };
}

export function acpRuntimeLifecycle(capabilities: AgentRuntimeCapabilities): AgentRuntimeLifecycle {
  return {
    schemaVersion: 1,
    stages: buildStages({
      detect: {
        support: 'owned',
        owner: 'mindos',
        required: true,
        sources: ['settings', 'acp-detect', 'acp-registry'],
        summary: 'MindOS detects ACP agents from built-in registry entries, custom settings, and local command presence.',
      },
      health: {
        support: 'unknown',
        owner: 'external',
        sources: ['acp-detect'],
        summary: 'ACP detection may surface status, but MindOS does not yet have a shared ACP health probe contract.',
      },
      configure: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['settings', 'acp-registry'],
        summary: 'The ACP adapter owns its command, arguments, environment, model, and auth setup; MindOS stores launch metadata.',
      },
      launch: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', 'acp-session'],
        summary: 'MindOS starts the ACP subprocess/session from descriptor metadata while the adapter owns protocol behavior.',
      },
      session: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['acp-session', 'run-ledger'],
        summary: 'ACP session identity belongs to the adapter/protocol; MindOS records only the binding and run index.',
      },
      context: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', 'acp-session'],
        summary: 'MindOS provides prompt/context text, while ACP adapters own their native history and context-window behavior.',
      },
      execute: {
        support: 'delegated',
        owner: 'external',
        required: true,
        sources: ['turn-runner', 'acp-session'],
        summary: 'ACP adapters execute turns through the protocol stream; MindOS normalizes text and tool events.',
      },
      interrupt: capabilities.supportsInterrupt
        ? {
            support: 'delegated',
            owner: 'external',
            sources: ['acp-session'],
            summary: 'MindOS can request interruption when the ACP session exposes an interruptible process boundary.',
          }
        : unsupported('ACP interruption is not exposed for this descriptor.'),
      archive: {
        support: 'unsupported',
        owner: 'external',
        sources: ['run-ledger'],
        summary: 'ACP archive/list/fork lifecycle is not part of the current MindOS ACP adapter contract.',
      },
      remote: {
        support: 'delegated',
        owner: 'external',
        sources: ['acp-detect', 'turn-runner'],
        summary: 'ACP agents can run remotely only when their command and dependencies are available on the MindOS server host.',
      },
      coordinate: {
        support: 'delegated',
        owner: 'external',
        sources: ['turn-runner', 'run-ledger'],
        summary: 'ACP agents can receive shared MindOS context as external workers, but mailbox/task-board coordination is not implemented yet.',
      },
    }),
    remote: {
      supported: true,
      mode: 'server-runnable',
      unattended: capabilities.supportsBackgroundRuns ? 'supported' : 'limited',
      summary: 'ACP runtimes are server-runnable when installed on the host, but 24/7 operation depends on adapter auth, subprocess health, and approval behavior.',
    },
    coordination: {
      role: 'external-worker',
      supportsSharedContext: true,
      supportsMailbox: false,
      supportsTaskBoard: false,
      summary: 'ACP runtimes can participate through shared prompt context; MindOS has not promoted them into durable Team Mode participants yet.',
    },
  };
}
