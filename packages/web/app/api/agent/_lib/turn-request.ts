import type {
  MindosActiveAssistantPrompt,
} from '@geminilight/mindos/agent';
import type {
  AgentMode,
  AgentPermissionMode,
  AgentRuntimeIdentity,
  RuntimeSessionBinding,
  AcpRuntimeOptions,
  NativeRuntimeOptions,
  SessionContextSelection,
  SessionWorkDir,
  Message as FrontendMessage,
} from '@/lib/types';
import { apiError, ErrorCodes } from '@/lib/errors';
import type { MindosAgentOptions } from '@/lib/agent/thinking';
import type {
  AgentRunCapsuleRecoveryAction,
  AgentRunCapsuleRecoveryPlan,
} from '@geminilight/mindos/agent';
import {
  findUnknownMindosAgentTurnRequestFields,
  firstUnknownMindosTurnField,
  getLastMindosUserContent,
  getLastMindosUserImages,
  getLastMindosUserSkillName,
  mindosAgentRunCapsuleRecoveryPlanToTurnBody,
  normalizeMindosAcpRuntimeOptions,
  normalizeMindosAgentMode,
  normalizeMindosAgentOptions as normalizeMindosAgentOptionsCore,
  normalizeMindosAgentSessionTurnBody,
  normalizeMindosAssistantId,
  normalizeMindosNativeRuntimeOptions,
  normalizeMindosPermissionMode,
  validateMindosAgentModeField,
  validateMindosAgentOptionsObject,
  validateMindosPermissionModeField,
  MINDOS_ACP_RUNTIME_OPTION_FIELDS,
  MINDOS_NATIVE_RUNTIME_OPTION_FIELDS,
} from '@geminilight/mindos/agent/turn';

/**
 * Web-facing shapes and `apiError` wrappers over the shared turn-request
 * contract. The allowlists, normalisers and body parsers themselves live in
 * `@geminilight/mindos/agent/turn` (core `agent/turn/request.ts`) so the Next
 * host route and the Product Server handler cannot drift
 * (spec-runtime-lane-contract).
 */

export type AgentTurnRequestBody = {
  messages: FrontendMessage[];
  /** Per-turn agent behavior. Behavior defaults to the normal agent loop. */
  agentMode?: AgentMode;
  /** Per-turn permission policy compiled by each runtime adapter. */
  permissionMode?: AgentPermissionMode;
  currentFile?: string;
  attachedFiles?: string[];
  uploadedFiles?: Array<{
    name: string;
    content: string;
    mimeType?: string;
    size?: number;
    dataBase64?: string;
  }>;
  maxSteps?: number;
  /** Assistant binding. This is not an ask mode. */
  assistantId?: string;
  /** ACP agent selection: if present, route to ACP instead of MindOS */
  selectedAcpAgent?: { id: string; name: string } | null;
  /** Unified runtime selection. ACP values mirror selectedAcpAgent for compatibility. */
  selectedRuntime?: AgentRuntimeIdentity | null;
  /** Typed external runtime binding for native Codex/Claude resume. */
  runtimeBinding?: RuntimeSessionBinding | null;
  /** Session-bound execution cwd. */
  workDir?: SessionWorkDir;
  /** Dynamic selected Spaces / Assistants for this turn. */
  contextSelection?: SessionContextSelection;
  /** Per-request provider override from the chat panel capsule */
  providerOverride?: string;
  /** Per-request model override from the inline model picker */
  modelOverride?: string;
  /** Per-request native runtime controls for Codex / Claude Code. */
  runtimeOptions?: NativeRuntimeOptions;
  /** Per-request ACP runtime controls projected from the active ACP session. */
  acpRuntimeOptions?: AcpRuntimeOptions;
  /** Per-request MindOS PI agent controls. */
  agentOptions?: MindosAgentOptions;
  /** MindOS Chat Panel session id for run ledger correlation. */
  chatSessionId?: string;
};

export type AgentSessionTurnRouteContext = {
  params?: Promise<{ sessionId?: string }> | { sessionId?: string };
};

export type AgentTurnRequestContext = {
  headers?: Headers;
  signal?: AbortSignal;
  request?: Request;
  activeAssistant?: MindosActiveAssistantPrompt;
  /**
   * Reasoning-effort fallback note from `agent/turn/request.ts` normalisation;
   * the turn runner emits it as one visible SSE `status` event before the lane
   * starts (spec-knowledge-layering-and-export-surface follow-up).
   */
  effortNotice?: string;
  capsuleRecovery?: {
    planId: string;
    runId: string;
    sourceCapsuleId: string;
    action: AgentRunCapsuleRecoveryAction;
  };
};

export function agentRunCapsuleRecoveryPlanToTurnBody(
  plan: AgentRunCapsuleRecoveryPlan,
  chatSessionId: string,
): AgentTurnRequestBody {
  return mindosAgentRunCapsuleRecoveryPlanToTurnBody(plan, chatSessionId) as unknown as AgentTurnRequestBody;
}

export function normalizeNativeRuntimeOptions(value: unknown): NativeRuntimeOptions {
  return normalizeMindosNativeRuntimeOptions(value) as NativeRuntimeOptions;
}

export function validateNativeRuntimeOptions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const unknown = firstUnknownMindosTurnField(
    value as Record<string, unknown>,
    MINDOS_NATIVE_RUNTIME_OPTION_FIELDS,
    'runtimeOptions',
  );
  return unknown ? apiError(ErrorCodes.INVALID_REQUEST, unknown, 400) : null;
}

export function normalizeAcpRuntimeOptions(value: unknown): AcpRuntimeOptions {
  return normalizeMindosAcpRuntimeOptions(value) as AcpRuntimeOptions;
}

export function validateAcpRuntimeOptions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const unknown = firstUnknownMindosTurnField(
    value as Record<string, unknown>,
    MINDOS_ACP_RUNTIME_OPTION_FIELDS,
    'acpRuntimeOptions',
  );
  return unknown ? apiError(ErrorCodes.INVALID_REQUEST, unknown, 400) : null;
}

export function normalizeAgentMode(value: unknown): AgentMode | undefined {
  return normalizeMindosAgentMode(value) as AgentMode | undefined;
}

export function normalizeAgentPermissionMode(value: unknown): AgentPermissionMode | undefined {
  return normalizeMindosPermissionMode(value) as AgentPermissionMode | undefined;
}

export function validateAgentMode(value: unknown) {
  const message = validateMindosAgentModeField(value);
  return message ? apiError(ErrorCodes.INVALID_REQUEST, message, 400) : null;
}

export function validateAgentPermissionMode(value: unknown) {
  const message = validateMindosPermissionModeField(value);
  return message ? apiError(ErrorCodes.INVALID_REQUEST, message, 400) : null;
}

export function validateMindosAgentOptions(value: unknown) {
  const message = validateMindosAgentOptionsObject(value);
  return message ? apiError(ErrorCodes.INVALID_REQUEST, message, 400) : null;
}

export function normalizeMindosAgentOptions(value: unknown): MindosAgentOptions {
  return normalizeMindosAgentOptionsCore(value) as MindosAgentOptions;
}

export function normalizeAssistantId(value: unknown): string | undefined {
  return normalizeMindosAssistantId(value);
}

export function getLastUserContent(messages: FrontendMessage[]): string {
  return getLastMindosUserContent(messages);
}

export function getLastUserSkillName(messages: FrontendMessage[]): string | undefined {
  return getLastMindosUserSkillName(messages);
}

export function getLastUserImages(messages: FrontendMessage[]): unknown[] {
  return getLastMindosUserImages(messages);
}

export function normalizeAgentSessionTurnBody(
  rawBody: unknown,
  sessionId: string,
): { ok: true; body: AgentTurnRequestBody; effortNotice?: string } | { ok: false; message: string } {
  const normalized = normalizeMindosAgentSessionTurnBody(rawBody, sessionId);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    body: normalized.body as unknown as AgentTurnRequestBody,
    ...(normalized.effortNotice ? { effortNotice: normalized.effortNotice } : {}),
  };
}

export function validateAgentTurnRequestContract(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid agent session turn request body', 400);
  }
  const unknown = findUnknownMindosAgentTurnRequestFields(body as Record<string, unknown>);
  return unknown ? apiError(ErrorCodes.INVALID_REQUEST, unknown, 400) : null;
}
