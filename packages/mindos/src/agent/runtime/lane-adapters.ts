import path from 'node:path';
import {
  runMindosAcpAgentTurn,
  type MindosAcpAgentTurnCloseOptions,
  type MindosAcpAgentTurnOptions,
  type MindosAcpAgentTurnPromptOptions,
  type MindosAcpAgentTurnResult,
  type MindosAcpAgentTurnSession,
  type MindosAcpAgentTurnSessionOptions,
  type MindosAcpSessionPoolKey,
  type MindosAcpSessionUpdate,
} from '../turn/acp-lane.js';
import {
  runMindosNonStreamingFallback,
  type MindosNonStreamingFallbackOptions,
} from '../turn/openai-compat-fallback.js';
import {
  runMindosPiAgentTurnSession,
  type MindosPiAgentRuntime,
  type MindosPiAgentTurnProxyFallbackMessages,
  type MindosPiAgentTurnSessionOptions,
  type MindosPiAgentTurnSessionResult,
} from '../mindos-pi/session.js';
import type { AcpPermissionEvent } from './acp-types.js';
import {
  appendMindosRuntimeAttachmentPathContext,
  materializeMindosRuntimeAttachments,
  type MindosRuntimeAttachment,
  type MindosRuntimeMaterializedAttachments,
} from './attachments.js';
import { runMindosNativeAgentTurn } from './run.js';
import type {
  MindosNativeAgentTurnOptions,
  MindosNativeAgentTurnResult,
  MindosNativeAgentTurnServices,
  MindosRuntimePermissionOption,
  MindosRuntimePermissionResult,
} from './run-lane-shared.js';
import type { AgentRunCapsuleRuntimeBinding } from '../capsules/types.js';
import {
  laneCapsuleRuntimeBinding,
  type LaneOpenInput,
  type LaneRunResult,
  type LaneSession,
  type LaneSink,
  type LaneTurnRequest,
  type RuntimeLane,
  type RuntimeLaneKind,
} from './lane-runner.js';

/**
 * The four lane adapters over the EXISTING core protocol functions
 * (spec-runtime-lane-contract 方案 1): zero protocol logic is rewritten here —
 * each factory only assembles `runMindosNativeAgentTurn` / `runMindosAcpAgentTurn`
 * / `runMindosPiAgentTurnSession` into the `RuntimeLane` contract.
 *
 * Every runner function is an injectable dep whose default binds the LEAF
 * module. Host tests mock the package barrels (see lane-runner.ts header and
 * wiki/known-pitfalls/02); hosts must pass the barrel-imported references so
 * their mocks keep intercepting. The defaults exist for hosts that do not
 * mock (standalone Product Server).
 */

// ─── Shared helpers ─────────────────────────────────────────────────────────

export function compactStringEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const compact: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') compact[key] = value;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function formatMindosPiExtensionLoadStatus(
  errors: Array<{ path: string; error: string }> | undefined,
): string | null {
  if (!errors?.length) return null;
  const names = [...new Set(errors.map((entry) => path.basename(entry.path || 'extension')).filter(Boolean))].slice(0, 5);
  const hasWebAccessError = errors.some((entry) => entry.path.includes('pi-web-access'));
  const suffix = hasWebAccessError
    ? ' pi-web-access is unavailable or incomplete, so web_search/fetch_content may be unavailable.'
    : ' Some extension tools may be unavailable.';
  return `MindOS detected ${errors.length} extension issue${errors.length === 1 ? '' : 's'}${names.length ? ` (${names.join(', ')})` : ''}.${suffix}`;
}

// ─── Native lane (codex / claude) ──────────────────────────────────────────

export type NativeRuntimeLaneConfig = Omit<
  MindosNativeAgentTurnOptions,
  'signal' | 'send' | 'timeoutMs' | 'services'
> & {
  services?: MindosNativeAgentTurnServices;
  /**
   * Claude CLI shim factory. Called at run time with the caller-generated
   * bridge run id so the embedded MCP source posts permission decisions to
   * the right run (the shim path bypasses the in-process bridge).
   */
  createClaudePermissionPrompt?: (context: { permissionRunId: string }) => MindosNativeAgentTurnServices['createClaudePermissionPrompt'];
};

export type NativeRuntimeLaneDeps = {
  /** Defaults to the leaf `./run.js`; hosts pass the barrel-imported reference. */
  runTurn?(options: MindosNativeAgentTurnOptions): Promise<MindosNativeAgentTurnResult>;
};

export function createNativeRuntimeLane(
  config: NativeRuntimeLaneConfig,
  deps: NativeRuntimeLaneDeps = {},
): RuntimeLane {
  const runTurn = deps.runTurn ?? runMindosNativeAgentTurn;
  const kind: RuntimeLaneKind = config.runtime.kind;

  return {
    kind,
    async open(_input: LaneOpenInput): Promise<LaneSession> {
      return {
        kind,
        runtimeId: config.runtime.id,
        cwd: config.cwd,
        metadata: { runtimeKind: config.runtime.kind },
      };
    },
    async run(session: LaneSession, turn: LaneTurnRequest, sink: LaneSink): Promise<LaneRunResult> {
      const { createClaudePermissionPrompt, ...turnConfig } = config;
      const promptFactory = kind === 'claude' && createClaudePermissionPrompt
        ? createClaudePermissionPrompt({ permissionRunId: sink.permissionRunId })
        : undefined;
      const result = await runTurn({
        ...turnConfig,
        timeoutMs: turn.timeoutMs,
        signal: turn.signal,
        send: sink.send,
        services: {
          ...(config.services ?? {}),
          ...(promptFactory ? { createClaudePermissionPrompt: promptFactory } : {}),
          requestRuntimePermission: (request, options) => sink.requestPermission(request, options),
          requestUserQuestion: (request, options) => sink.askUser(request, options),
        },
      });
      if (result.externalSessionId) {
        session.externalSessionId = result.externalSessionId;
        session.archive = { sessionId: result.externalSessionId };
        session.metadata = { ...session.metadata, externalSessionId: result.externalSessionId };
        session.capsuleBinding = laneCapsuleRuntimeBinding({
          kind,
          runtimeId: config.runtime.id,
          externalSessionId: result.externalSessionId,
          cwd: config.cwd,
        });
      }
      return {
        ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    },
    async interrupt(_session: LaneSession): Promise<void> {
      // The caller-owned abort signal (cancel handler / disconnect grace)
      // already terminates native runtime processes; nothing extra to do.
    },
    async close(_session: LaneSession, _opts: { keepExternalSession: boolean }): Promise<void> {
      // Native runtimes are turn-scoped inside runMindosNativeAgentTurn.
    },
  };
}

// ─── ACP lane ───────────────────────────────────────────────────────────────

/**
 * Structural mirror of `AcpClientCallbacks['resolvePermissionRequest']`
 * (protocols/acp/subprocess.ts). The callback type itself lives in the
 * protocol host, which agent/runtime must not import (layering.test); the
 * wire event type comes through acp-types.ts.
 */
export type AcpLanePermissionResolver = (input: {
  event: AcpPermissionEvent;
  params: { toolCall?: unknown };
}) => Promise<{ outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } }>;

export type AcpLaneSessionOpenOptions = MindosAcpAgentTurnSessionOptions & {
  env?: Record<string, string>;
  resolvePermissionRequest?: AcpLanePermissionResolver;
};

export type AcpRuntimeLaneConfig = {
  agent: { id: string; name: string };
  cwd: string;
  /** The external prompt; attachments are materialized in open() and appended. */
  prompt: string;
  attachments: MindosRuntimeAttachment[];
  /** Seed capsule binding (`capsule.request.runtimeBinding`); finalized as-is until onSessionReady replaces it. */
  initialCapsuleBinding?: AgentRunCapsuleRuntimeBinding | null;
  resumeExternalSessionId?: string;
  acpPermissionMode: 'readonly' | 'ask' | 'auto' | 'full';
  envOverlay?: Record<string, string | undefined>;
  runtimeOptions: { modeId?: string; configValues?: Record<string, string> };
  errorMessage?: (error: Error) => string;
};

export type AcpRuntimeLaneDeps = {
  /** Defaults to the leaf `../turn/acp-lane.js`; hosts pass the barrel reference. */
  runAcpTurn?(options: MindosAcpAgentTurnOptions): Promise<MindosAcpAgentTurnResult>;
  createSession(agentId: string, options: AcpLaneSessionOpenOptions): Promise<MindosAcpAgentTurnSession>;
  loadSession(agentId: string, externalSessionId: string, options: AcpLaneSessionOpenOptions): Promise<MindosAcpAgentTurnSession>;
  promptStream(
    sessionId: string,
    prompt: string,
    onUpdate: (update: MindosAcpSessionUpdate) => void,
    options?: MindosAcpAgentTurnPromptOptions,
  ): Promise<void>;
  cancelPrompt?(sessionId: string): Promise<void>;
  closeSession(sessionId: string, options?: MindosAcpAgentTurnCloseOptions): Promise<void>;
  setMode?(sessionId: string, modeId: string): Promise<void>;
  setConfigOption?(sessionId: string, configId: string, value: string): Promise<void>;
  takePooledSession?(key: MindosAcpSessionPoolKey): MindosAcpAgentTurnSession | undefined;
  parkPooledSession?(sessionId: string, key: MindosAcpSessionPoolKey): Promise<boolean> | boolean;
};

export function acpPermissionEventOptionsToRuntimeOptions(
  event: AcpPermissionEvent,
): MindosRuntimePermissionOption[] {
  if (event.options.length === 0) {
    return [{ id: 'cancel', label: 'Cancel', intent: 'cancel', scope: 'once' }];
  }
  return event.options.map((option) => ({
    id: option.id,
    label: option.label,
    intent: option.kind.startsWith('reject') ? 'deny' as const : 'allow' as const,
    scope: option.kind.endsWith('_always') ? 'session' as const : 'once' as const,
  }));
}

export function acpPermissionResponseFromRuntimeResult(
  event: AcpPermissionEvent,
  result: MindosRuntimePermissionResult,
): { outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } } {
  if (result.cancelled || result.decisionIntent === 'cancel') {
    return { outcome: { outcome: 'cancelled' } };
  }
  const exact = event.options.find((option) => option.id === result.decision);
  if (exact) return { outcome: { outcome: 'selected', optionId: exact.id } };
  const wantsDeny = result.decisionIntent === 'deny';
  const wantsAlways = result.decisionScope === 'always' || result.decisionScope === 'session';
  const selected = wantsDeny
    ? event.options.find((option) => option.kind === (wantsAlways ? 'reject_always' : 'reject_once')) ??
      event.options.find((option) => option.kind.startsWith('reject'))
    : event.options.find((option) => option.kind === (wantsAlways ? 'allow_always' : 'allow_once')) ??
      event.options.find((option) => option.kind.startsWith('allow'));
  return selected
    ? { outcome: { outcome: 'selected', optionId: selected.id } }
    : { outcome: { outcome: 'cancelled' } };
}

type AcpLaneHandle = {
  materialized: MindosRuntimeMaterializedAttachments;
  prompt: string;
};

export function createAcpRuntimeLane(
  config: AcpRuntimeLaneConfig,
  deps: AcpRuntimeLaneDeps,
): RuntimeLane {
  const runAcpTurn = deps.runAcpTurn ?? runMindosAcpAgentTurn;

  return {
    kind: 'acp',
    async open(_input: LaneOpenInput): Promise<LaneSession> {
      const materialized = await materializeMindosRuntimeAttachments(config.attachments);
      const prompt = appendMindosRuntimeAttachmentPathContext(
        config.prompt,
        materialized.attachments,
        { includeImages: true },
      );
      const handle: AcpLaneHandle = { materialized, prompt };
      return {
        kind: 'acp',
        runtimeId: config.agent.id,
        cwd: config.cwd,
        capsuleBinding: config.initialCapsuleBinding,
        handle,
      };
    },
    async run(session: LaneSession, turn: LaneTurnRequest, sink: LaneSink): Promise<LaneRunResult> {
      const handle = session.handle as AcpLaneHandle;
      let hasContent = false;

      const applyRuntimeOptions = async (sessionId: string): Promise<void> => {
        if (config.runtimeOptions.modeId && deps.setMode) {
          await deps.setMode(sessionId, config.runtimeOptions.modeId);
        }
        const configValues = config.runtimeOptions.configValues ?? {};
        for (const [configId, value] of Object.entries(configValues)) {
          if (!configId.trim() || !value.trim()) continue;
          await deps.setConfigOption?.(sessionId, configId, value);
        }
      };
      const createAcpPermissionResolver = (): AcpLanePermissionResolver => (
        async ({ event, params }) => {
          const result = await sink.requestPermission({
            runtime: 'acp',
            toolCallId: event.toolCallId || event.requestId,
            toolName: event.toolName || 'ACP tool',
            input: params.toolCall ?? {},
            options: acpPermissionEventOptionsToRuntimeOptions(event),
            reason: 'ACP adapter requested permission for a tool call.',
          }, {
            signal: turn.signal,
            requestId: event.requestId,
            emitRequest: false,
            emitResolved: false,
          });
          return acpPermissionResponseFromRuntimeResult(event, result);
        }
      );
      const openOptions = (options: MindosAcpAgentTurnSessionOptions): AcpLaneSessionOpenOptions => {
        const { env: optionRawEnv, ...baseOptions } = options as MindosAcpAgentTurnSessionOptions & { env?: Record<string, string | undefined> };
        const optionEnv = compactStringEnv(optionRawEnv);
        const mergedEnv = compactStringEnv({ ...(config.envOverlay ?? {}), ...(optionEnv ?? {}) });
        return {
          ...baseOptions,
          ...(mergedEnv ? { env: mergedEnv } : {}),
          permissionMode: config.acpPermissionMode,
          resolvePermissionRequest: createAcpPermissionResolver(),
        };
      };

      const result = await runAcpTurn({
        agentId: config.agent.id,
        cwd: config.cwd,
        prompt: handle.prompt,
        signal: turn.signal,
        permissionRunId: sink.permissionRunId,
        createSession: async (agentId, options) => {
          const created = await deps.createSession(agentId, openOptions(options));
          await applyRuntimeOptions(created.id);
          return created;
        },
        loadSession: async (agentId, existingSessionId, options) => {
          const loaded = await deps.loadSession(agentId, existingSessionId, openOptions(options));
          await applyRuntimeOptions(loaded.id);
          return loaded;
        },
        // Reuse a live session parked by a previous turn (skips the agent spawn
        // + handshake); apply this turn's runtime options to it. If the options
        // cannot be applied, close it and let the lane resume fresh.
        acquireSession: async (key) => {
          if (!deps.takePooledSession) return undefined;
          const pooled = deps.takePooledSession(key);
          if (!pooled) return undefined;
          try {
            await applyRuntimeOptions(pooled.id);
            return pooled;
          } catch {
            await deps.closeSession(pooled.id, { closeAgentSession: false }).catch(() => {});
            return undefined;
          }
        },
        // Park the session after a clean finish so the next turn with the same
        // (agentId, cwd, externalSessionId) reuses the same live agent process.
        ...(deps.parkPooledSession
          ? { releaseSession: (session2: MindosAcpAgentTurnSession, key: MindosAcpSessionPoolKey) => deps.parkPooledSession!(session2.id, key) }
          : {}),
        ...(config.resumeExternalSessionId ? { externalSessionId: config.resumeExternalSessionId } : {}),
        onSessionReady: (readySession, details) => {
          session.capsuleBinding = laneCapsuleRuntimeBinding({
            kind: 'acp',
            runtimeId: config.agent.id,
            externalSessionId: details.externalSessionId,
            cwd: config.cwd,
          });
          if (details.externalSessionId) session.externalSessionId = details.externalSessionId;
          sink.updateRun({
            archive: { sessionId: details.externalSessionId ?? readySession.id },
            metadata: {
              phase: 'prompt',
              sessionId: readySession.id,
              resumed: details.resumed,
              ...(details.externalSessionId ? { externalSessionId: details.externalSessionId } : {}),
            },
          });
        },
        timeoutMs: turn.timeoutMs,
        hasContent: () => hasContent,
        onVisibleContent: () => { hasContent = true; },
        send: sink.send,
        promptStream: async (sessionId, prompt, onUpdate, options) => {
          await deps.promptStream(sessionId, prompt, onUpdate, options);
        },
        ...(deps.cancelPrompt ? { cancelPrompt: deps.cancelPrompt } : {}),
        closeSession: deps.closeSession,
        ...(config.errorMessage ? { errorMessage: config.errorMessage } : {}),
      });
      return { ...(result.error ? { error: result.error } : {}) };
    },
    async interrupt(_session: LaneSession): Promise<void> {
      // runMindosAcpAgentTurn cancels the in-flight prompt through the
      // caller-owned abort signal; there is no session handle outside run().
    },
    async close(session: LaneSession, _opts: { keepExternalSession: boolean }): Promise<void> {
      const handle = session.handle as AcpLaneHandle | undefined;
      await handle?.materialized.cleanup();
    },
  };
}

// ─── Embedded Pi lane (mindos) ──────────────────────────────────────────────

export type MindosPiRuntimeLaneConfig = {
  /** The pre-created runtime; the host creates it before the SSE shell so init failures stay JSON. */
  runtime: MindosPiAgentRuntime;
  /**
   * The turn prompt to run. Hosts pass the runtime's post-compaction
   * `turnPrompt`; defaults to `runtime.turnPrompt` when omitted.
   */
  prompt?: string;
  cwd: string;
  stepLimit: number;
  thinkingLevel: string;
  proxyMessages: MindosPiAgentTurnProxyFallbackMessages;
};

export type MindosPiRuntimeLaneDeps = {
  /** Defaults to the leaf `../mindos-pi/session.js`; hosts pass the barrel reference. */
  runPiSession?(options: MindosPiAgentTurnSessionOptions): Promise<MindosPiAgentTurnSessionResult>;
  /** Defaults to the leaf `../turn/openai-compat-fallback.js`; hosts pass the barrel reference. */
  runNonStreamingFallback?(options: MindosNonStreamingFallbackOptions): Promise<void>;
  readCompatCache(): Record<string, string>;
  resolveCompatMode(input: { provider: string; baseUrl?: string; cachedMode?: string }): string | undefined;
  writeCompat(key: string, mode: 'non-streaming'): void;
  recordToolExecution?(): void;
  recordTokens?(inputTokens: number, outputTokens: number): void;
  onStep?(step: number, maxSteps: number): void;
};

export function createMindosPiRuntimeLane(
  config: MindosPiRuntimeLaneConfig,
  deps: MindosPiRuntimeLaneDeps,
): RuntimeLane {
  const runPiSession = deps.runPiSession ?? runMindosPiAgentTurnSession;
  const runNonStreamingFallback = deps.runNonStreamingFallback ?? runMindosNonStreamingFallback;

  return {
    kind: 'mindos',
    async open(_input: LaneOpenInput): Promise<LaneSession> {
      const runtime = config.runtime;
      const runtimeSession = runtime.runtimeSession;
      const embeddedRuntimeBinding = runtimeSession
        ? laneCapsuleRuntimeBinding({
          kind: 'mindos',
          runtimeId: 'mindos',
          externalSessionId: runtimeSession.externalSessionId,
          cwd: config.cwd,
        })
        : undefined;
      return {
        kind: 'mindos',
        runtimeId: 'mindos',
        cwd: config.cwd,
        ...(runtimeSession ? { externalSessionId: runtimeSession.externalSessionId } : {}),
        ...(embeddedRuntimeBinding ? { capsuleBinding: embeddedRuntimeBinding } : {}),
        capsulePatch: {
          model: runtime.modelName,
          thinkingEffort: config.thinkingLevel,
          ...(embeddedRuntimeBinding ? { runtimeBinding: embeddedRuntimeBinding } : {}),
        },
        ...(runtimeSession ? {
          archive: {
            sessionId: runtimeSession.externalSessionId,
            path: runtimeSession.sessionFile,
          },
          metadata: {
            externalSessionId: runtimeSession.externalSessionId,
            runtimeSessionDir: runtimeSession.sessionDir,
            runtimeSessionResumed: runtimeSession.resumed,
          },
        } : {}),
        ...(runtime.agentRunContextResource ? { agentRunContextResource: runtime.agentRunContextResource } : {}),
        handle: runtime,
      };
    },
    async run(session: LaneSession, turn: LaneTurnRequest, sink: LaneSink): Promise<LaneRunResult> {
      const runtime = session.handle as MindosPiAgentRuntime;
      const runtimeSession = runtime.runtimeSession;
      const turnPrompt = config.prompt ?? runtime.turnPrompt;

      if (runtimeSession) {
        sink.send({
          type: 'runtime_binding',
          runtime: 'mindos',
          externalSessionId: runtimeSession.externalSessionId,
          cwd: config.cwd,
        });
      }
      if (runtime.contextUsage) {
        sink.send(runtime.contextUsage);
        if (runtime.contextUsage.action !== 'none' && runtime.contextUsage.message) {
          sink.send({
            type: 'status',
            runtime: 'mindos',
            visible: true,
            message: runtime.contextUsage.message,
          });
        }
      }
      const extensionLoadStatus = formatMindosPiExtensionLoadStatus(runtime.extensionLoadErrors);
      if (extensionLoadStatus) {
        sink.send({
          type: 'status',
          runtime: 'mindos',
          visible: true,
          message: extensionLoadStatus,
        });
      }

      const compatCache = deps.readCompatCache();
      const effectiveBaseUrlKey = runtime.baseUrl || 'default';
      const compatMode = deps.resolveCompatMode({
        provider: runtime.provider,
        baseUrl: runtime.baseUrl,
        cachedMode: compatCache[effectiveBaseUrlKey],
      });
      const runProxyFallback = () => runNonStreamingFallback({
        baseUrl: runtime.baseUrl ?? '',
        apiKey: runtime.apiKey,
        model: runtime.modelName,
        systemPrompt: runtime.systemPrompt,
        historyMessages: runtime.llmHistoryMessages,
        userContent: turnPrompt,
        tools: runtime.fallbackTools,
        send: sink.send,
        signal: turn.signal,
        maxSteps: config.stepLimit,
      });

      const piSession = runtime.session;
      const sessionResult = await runPiSession({
        session: {
          subscribe: (callback) => piSession.subscribe(callback),
          prompt: async (prompt, options) => { await piSession.prompt(prompt, options); },
          steer: (message) => piSession.steer(message),
          abort: () => piSession.abort(),
        },
        prompt: turnPrompt,
        ...(runtime.lastUserImages ? { promptOptions: { images: runtime.lastUserImages } } : {}),
        stepLimit: config.stepLimit,
        timeoutMs: turn.timeoutMs,
        signal: turn.signal,
        provider: runtime.provider,
        baseUrl: runtime.baseUrl,
        effectiveBaseUrlKey,
        compatMode,
        send: sink.send,
        runFallback: runProxyFallback,
        proxyMessages: config.proxyMessages,
        ...(deps.recordToolExecution ? { onToolExecution: () => deps.recordToolExecution!() } : {}),
        ...(deps.recordTokens ? { onTokens: (inputTokens: number, outputTokens: number) => deps.recordTokens!(inputTokens, outputTokens) } : {}),
        ...(deps.onStep ? { onStep: deps.onStep } : {}),
        writeCompat: (key, mode) => deps.writeCompat(key, mode),
      });

      if (sessionResult.status === 'error') {
        // The session already sent the SSE error frame (and no `done`): the
        // caller records the failure without re-throwing.
        return { error: new Error(sessionResult.message ?? 'MindOS agent turn failed.') };
      }
      return {};
    },
    async interrupt(session: LaneSession): Promise<void> {
      const runtime = session.handle as MindosPiAgentRuntime | undefined;
      await runtime?.session.abort();
    },
    async close(session: LaneSession, _opts: { keepExternalSession: boolean }): Promise<void> {
      // The pi AgentSession is turn-scoped here: release its listeners and
      // agent connection so a long-lived host does not accumulate them.
      const runtime = session.handle as MindosPiAgentRuntime | undefined;
      runtime?.session.dispose?.();
    },
  };
}
