export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  handleAgentRuntimesGet,
  type AgentRuntimeDescriptor,
  type AgentRuntimePayload,
  type AgentRuntimesPayload,
  type AgentRuntimesServices,
} from '@geminilight/mindos/server';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../_mindos-adapter';
import { rememberAvailableNativeRuntimeDescriptorsFromPayload } from '@/lib/agent/native-runtime-descriptor-cache';
import { compactRuntimeDisplayHints, compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';

const services: AgentRuntimesServices = {
  readSettings: readSettings as AgentRuntimesServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
  resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
  resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
  checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
};

type NativeRuntimeBridge = {
  kind: 'codex-app-server' | 'claude-sdk' | 'claude-cli';
  label: string;
  fallback?: boolean;
  reason?: string;
};

type AgentRuntimeDescriptorWithBridge = AgentRuntimeDescriptor & {
  runtimeBridge?: NativeRuntimeBridge;
};

export async function GET(req: Request) {
  const response = await handleAgentRuntimesGet(new URL(req.url).searchParams, services);
  if (response.status === 200 && response.body) {
    const body = compactNativeRuntimePayload(response.body);
    rememberAvailableNativeRuntimeDescriptorsFromPayload(body);
    return toNextResponse({ ...response, body });
  }
  return toNextResponse(response);
}

function isNativeRuntimeKind(kind: AgentRuntimeDescriptor['kind']): kind is 'codex' | 'claude' {
  return kind === 'codex' || kind === 'claude';
}

function compactNativeRuntimeDescriptor(runtime: AgentRuntimeDescriptor): AgentRuntimeDescriptor {
  if (!isNativeRuntimeKind(runtime.kind) || !runtime.availability) return runtime;
  const reason = runtime.availability.reason
    ? compactRuntimeDisplayReason(runtime.availability.reason, { runtime: runtime.kind })
    : undefined;
  const diagnosticHints = compactRuntimeDisplayHints(runtime.availability.diagnosticHints, { runtime: runtime.kind })
    .filter((hint) => hint !== reason);
  const inferredRuntimeBridge = inferNativeRuntimeBridge(runtime, diagnosticHints);
  const runtimeBridge = inferredRuntimeBridge?.reason
    ? {
      ...inferredRuntimeBridge,
      reason: compactRuntimeDisplayReason(inferredRuntimeBridge.reason, { runtime: runtime.kind }),
    }
    : inferredRuntimeBridge;
  const adapterContract = runtime.kind === 'claude' && runtimeBridge?.kind === 'claude-cli'
    ? {
      ...runtime.adapterContract,
      connection: {
        ...runtime.adapterContract.connection,
        kind: 'cli' as const,
        summary: 'MindOS uses the Claude Code CLI fallback when the SDK bridge is unavailable.',
      },
    }
    : runtime.adapterContract;
  return {
    ...runtime,
    ...(runtime.kind === 'claude' && runtimeBridge?.kind === 'claude-cli' ? { adapter: 'claude-cli' as const } : {}),
    adapterContract,
    ...(runtimeBridge ? { runtimeBridge } : {}),
    availability: {
      ...runtime.availability,
      ...(reason ? { reason } : {}),
      diagnosticHints: diagnosticHints.length > 0 ? diagnosticHints : undefined,
    },
  };
}

function inferNativeRuntimeBridge(
  runtime: AgentRuntimeDescriptor,
  diagnosticHints: string[],
): NativeRuntimeBridge | undefined {
  const runtimeWithBridge = runtime as AgentRuntimeDescriptorWithBridge;
  if (runtimeWithBridge.runtimeBridge) return runtimeWithBridge.runtimeBridge;
  if (runtime.kind === 'codex' && runtime.status === 'available') {
    return { kind: 'codex-app-server', label: 'App server active' };
  }
  if (runtime.kind !== 'claude' || runtime.status !== 'available') return undefined;

  const joinedHints = diagnosticHints.join(' ');
  if (/Claude Agent SDK bridge is available/i.test(joinedHints)) {
    return { kind: 'claude-sdk', label: 'SDK bridge active' };
  }
  if (/CLI fallback|will use CLI fallback|SDK bridge is unavailable|did not expose query/i.test(joinedHints)) {
    const reasonMatch = joinedHints.match(/fallback\.\s*(.+)$/i);
    return {
      kind: 'claude-cli',
      label: 'CLI fallback active',
      fallback: true,
      ...(reasonMatch?.[1] ? { reason: reasonMatch[1] } : {}),
    };
  }
  return undefined;
}

function compactNativeRuntimePayload<T extends AgentRuntimesPayload | AgentRuntimePayload | { error: string }>(body: T): T {
  if ('runtime' in body) {
    return {
      ...body,
      runtime: compactNativeRuntimeDescriptor(body.runtime),
    };
  }
  if ('runtimes' in body) {
    return {
      ...body,
      runtimes: body.runtimes.map(compactNativeRuntimeDescriptor),
    };
  }
  return body;
}
