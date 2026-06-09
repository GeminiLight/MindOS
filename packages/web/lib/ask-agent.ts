import type { AgentIdentity, AgentRuntimeIdentity, ChatSession, ExternalAgentBinding, Message, RuntimeSessionBinding, RuntimeSessionKind } from '@/lib/types';

export const MINDOS_AGENT: AgentIdentity = {
  id: 'mindos',
  name: 'MindOS',
};

export function resolveMessageAgent(agent: AgentIdentity | null | undefined): AgentIdentity {
  return agent ?? MINDOS_AGENT;
}

export function annotateMessageWithAgent(message: Message, agent: AgentIdentity | null | undefined): Message {
  const resolved = resolveMessageAgent(agent);
  return {
    ...message,
    agentId: resolved.id,
    agentName: resolved.name,
  };
}

export function annotateMessageWithAgentRuntime(
  message: Message,
  runtime: AgentRuntimeIdentity | null | undefined,
): Message {
  const resolved = runtime ?? { ...MINDOS_AGENT, kind: 'mindos' as const };
  return {
    ...message,
    agentId: resolved.id,
    agentName: resolved.name,
    agentKind: resolved.kind,
  };
}

export function resolveComposerAgent({
  sessionAgent,
  initialAgent,
}: {
  sessionAgent?: AgentIdentity | null;
  initialAgent?: AgentIdentity | null;
}): AgentIdentity | null {
  return sessionAgent ?? initialAgent ?? null;
}

export function getSelectedAcpAgentFromMessage(message: Pick<Message, 'agentId' | 'agentName' | 'agentKind'>): AgentIdentity | null {
  if (!message.agentId || !message.agentName || message.agentId === MINDOS_AGENT.id || message.agentKind) {
    return null;
  }
  return {
    id: message.agentId,
    name: message.agentName,
  };
}

export function getMessageAgentRuntime(
  message: Pick<Message, 'agentId' | 'agentName' | 'agentKind'>,
): AgentRuntimeIdentity | null {
  if (!message.agentId || !message.agentName || message.agentId === MINDOS_AGENT.id) {
    return null;
  }
  return {
    id: message.agentId,
    name: message.agentName,
    kind: message.agentKind ?? 'acp',
  };
}

export function toAgentRuntime(agent: AgentIdentity | null | undefined): AgentRuntimeIdentity | null {
  return agent ? { ...agent, kind: 'acp' } : null;
}

export function getSessionAgentRuntime(
  session: Pick<ChatSession, 'defaultAgentRuntime' | 'defaultAcpAgent'> | null | undefined,
): AgentRuntimeIdentity | null {
  return session?.defaultAgentRuntime ?? toAgentRuntime(session?.defaultAcpAgent);
}

function isNativeRuntimeKind(kind: string | null | undefined): kind is 'codex' | 'claude' {
  return kind === 'codex' || kind === 'claude';
}

function getSessionNativeRuntimeKind(
  session: Pick<ChatSession, 'defaultAgentRuntime' | 'defaultAcpAgent' | 'runtimeSessionBinding' | 'externalAgentBinding'>,
): 'codex' | 'claude' | null {
  const runtime = getSessionAgentRuntime(session);
  if (isNativeRuntimeKind(runtime?.kind)) return runtime.kind;
  const boundRuntime = session.runtimeSessionBinding?.runtime ?? session.externalAgentBinding?.runtime;
  return isNativeRuntimeKind(boundRuntime) ? boundRuntime : null;
}

export function isSessionInRuntimeLane(
  session: Pick<ChatSession, 'defaultAgentRuntime' | 'defaultAcpAgent' | 'runtimeSessionBinding' | 'externalAgentBinding'>,
  runtime: AgentRuntimeIdentity | null | undefined,
): boolean {
  const nativeKind = getSessionNativeRuntimeKind(session);

  // The MindOS lane owns MindOS sessions plus ACP-routed sessions. Native runtime
  // sessions get their own lanes because Codex/Claude own model and resume state.
  if (!runtime || runtime.kind === 'mindos' || runtime.kind === 'acp') {
    return nativeKind === null;
  }

  if (!isNativeRuntimeKind(runtime.kind)) return nativeKind === null;
  if (nativeKind !== runtime.kind) return false;

  const selected = getSessionAgentRuntime(session);
  if (selected?.kind === runtime.kind) return selected.id === runtime.id;

  const bindingRuntimeId = session.runtimeSessionBinding?.runtimeId;
  return !bindingRuntimeId || bindingRuntimeId === runtime.id;
}

export function filterSessionsByRuntimeLane(
  sessions: ChatSession[],
  runtime: AgentRuntimeIdentity | null | undefined,
): ChatSession[] {
  return sessions.filter((session) => isSessionInRuntimeLane(session, runtime));
}

export function bindSessionAgent(session: ChatSession, agent: AgentIdentity | null): ChatSession {
  return {
    ...session,
    defaultAcpAgent: agent,
    defaultAgentRuntime: toAgentRuntime(agent),
    externalAgentBinding: null,
    runtimeSessionBinding: null,
  };
}

function runtimeSessionKind(runtime: AgentRuntimeIdentity): RuntimeSessionKind | null {
  if (runtime.kind === 'codex') return 'codex-thread';
  if (runtime.kind === 'claude') return 'claude-session';
  return null;
}

export function getMatchingRuntimeSessionBinding(
  session: Pick<ChatSession, 'runtimeSessionBinding' | 'externalAgentBinding'> | null | undefined,
  runtime: AgentRuntimeIdentity | null | undefined,
): RuntimeSessionBinding | null {
  if (!session || !runtime || runtime.kind === 'mindos') return null;

  const typed = session.runtimeSessionBinding;
  if (typed?.runtime === runtime.kind && typed.runtimeId === runtime.id) {
    return typed;
  }

  const kind = runtimeSessionKind(runtime);
  const legacy = session.externalAgentBinding;
  if (!kind || legacy?.runtime !== runtime.kind) return null;

  return {
    kind,
    runtime: runtime.kind,
    runtimeId: runtime.id,
    ...(legacy.externalSessionId ? { externalSessionId: legacy.externalSessionId } : {}),
    ...(legacy.cwd ? { cwd: legacy.cwd } : {}),
    status: legacy.status ?? 'active',
    updatedAt: legacy.updatedAt,
  };
}

export function bindSessionAgentRuntime(
  session: ChatSession,
  runtime: AgentRuntimeIdentity | null,
  binding?: {
    externalSessionId?: string;
    cwd?: string;
    status?: ExternalAgentBinding['status'];
    updatedAt?: number;
  },
): ChatSession {
  const externalAgentBinding = runtime && runtime.kind !== 'mindos'
    ? {
        runtime: runtime.kind,
        ...(binding?.externalSessionId ? { externalSessionId: binding.externalSessionId } : {}),
        ...(binding?.cwd ? { cwd: binding.cwd } : {}),
        status: binding?.status ?? 'active',
        updatedAt: binding?.updatedAt ?? Date.now(),
      } satisfies ExternalAgentBinding
    : null;
  const kind = runtime ? runtimeSessionKind(runtime) : null;
  const runtimeSessionBinding = runtime && runtime.kind !== 'mindos' && kind
    ? {
        kind,
        runtime: runtime.kind,
        runtimeId: runtime.id,
        ...(binding?.externalSessionId ? { externalSessionId: binding.externalSessionId } : {}),
        ...(binding?.cwd ? { cwd: binding.cwd } : {}),
        status: binding?.status ?? 'active',
        updatedAt: binding?.updatedAt ?? Date.now(),
      } satisfies RuntimeSessionBinding
    : null;

  return {
    ...session,
    defaultAcpAgent: runtime?.kind === 'acp' ? { id: runtime.id, name: runtime.name } : null,
    defaultAgentRuntime: runtime,
    externalAgentBinding,
    runtimeSessionBinding,
  };
}
