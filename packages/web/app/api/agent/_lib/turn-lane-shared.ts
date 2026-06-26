import type {
  MindosAgentRuntimeSelection,
  MindosRuntimeAttachment,
} from '@geminilight/mindos/agent/runtime';
import type { MindosSelectedSkill } from '@geminilight/mindos/agent';
import type { createMindosAgentPermissionPolicy } from '@geminilight/mindos/agent/mindos-pi/permission';
import type {
  AcpRuntimeOptions,
  AgentPermissionMode,
  NativeRuntimeOptions,
  SessionContextSelection,
  SessionWorkDir,
} from '@/lib/types';
import type { AgentTurnRequestContext } from './turn-request';

export type RuntimeLanePermissionPolicy = ReturnType<typeof createMindosAgentPermissionPolicy>;

export type RuntimeLaneLocalization = { agentTimeout: string };

export type RuntimeLaneBaseInput = {
  externalPrompt: string;
  chatSessionId?: string;
  executionCwd: string;
  permissionPolicy: RuntimeLanePermissionPolicy;
  agentMode: string;
  sessionContextMetadata: Record<string, unknown>;
  fileContextMetadata: Record<string, unknown>;
  sessionWorkDir: SessionWorkDir & { path: string };
  sessionContextSelection: SessionContextSelection;
  assistantId?: string;
  runtimeAttachments: MindosRuntimeAttachment[];
  selectedSkills: MindosSelectedSkill[];
  requestSignal: AbortSignal;
  t: RuntimeLaneLocalization;
};

export type NativeRuntimeLaneTurnInput = RuntimeLaneBaseInput & {
  nativePermissionMode: AgentPermissionMode;
  nativeRuntimeOptions: NativeRuntimeOptions;
  nativeRuntimeEnv?: NodeJS.ProcessEnv;
  requestContext: AgentTurnRequestContext;
};

export type AcpRuntimeLaneTurnInput = RuntimeLaneBaseInput & {
  acpRuntimeOptions: AcpRuntimeOptions;
  acpRuntimeEnvOverlay?: Record<string, string | undefined>;
};

export type RunNativeRuntimeLaneTurnInput = NativeRuntimeLaneTurnInput & {
  nativeRuntime: MindosAgentRuntimeSelection;
};

export type RunAcpRuntimeLaneTurnInput = AcpRuntimeLaneTurnInput & {
  acpAgent: { id: string; name: string };
};
