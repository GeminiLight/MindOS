import {
  buildCodexTurnInput,
  mapCodexAppServerNotificationToSseEvents,
  type CodexAppServerClient,
  type CodexAppServerServerRequest,
} from './codex-app-server.js';
import { acquireCodexAppServerForTurn } from './codex-app-server-pool.js';
import {
  appendMindosRuntimeAttachmentPathContext,
  materializeMindosRuntimeAttachments,
} from './attachments.js';
import {
  errorFromRuntimeFailure,
  isRuntimeReportedError,
  isUserCancel,
  iterateWithNativeRuntimeAbort,
  sendNativeRuntimeStatus,
  throwIfLaneReportedError,
  throwIfNativeRuntimeTimedOut,
  trackLaneTerminalEvent,
  type LaneTerminalState,
  type MindosNativeAgentTurnOptions,
  type MindosNativeAgentTurnResult,
  type MindosRuntimePermissionOption,
  type MindosRuntimePermissionRequest,
  type MindosRuntimePermissionResult,
  type MindosRuntimeUserQuestion,
  type MindosRuntimeUserQuestionOption,
  type MindosRuntimeUserQuestionRequest,
} from './run-lane-shared.js';

/**
 * Codex native lane. Unless the host injects `services.createCodexClient`
 * (one client per turn, host-owned), turns lease an already-initialized
 * `codex app-server` from the supervisor pool keyed by (command, cwd, env):
 * the process survives across turns and user cancels, `thread/resume` is the
 * only per-turn handshake, and a transport failure evicts the process so the
 * next turn respawns it transparently.
 */

type CodexPendingServerRequestKind = 'permission' | 'question';

type CodexPendingServerRequest = {
  requestId: number;
  toolCallId: string;
  kind: CodexPendingServerRequestKind;
  abortController: AbortController;
  cleanup(): void;
};

type CodexPendingServerRequests = Map<string, CodexPendingServerRequest>;

/** A client the lane may use for one turn, plus how to give it back. */
type ResolvedCodexClient = {
  client: CodexAppServerClient;
  /** Host-owned clients are initialized and closed by the lane, pooled ones by the pool. */
  owned: boolean;
  release(options: { failed: boolean }): Promise<void>;
};

export async function runCodexNativeAgentTurn(options: MindosNativeAgentTurnOptions): Promise<MindosNativeAgentTurnResult> {
  let resolved: ResolvedCodexClient | undefined;
  let threadId = options.runtime.externalSessionId;
  const pendingServerRequests: CodexPendingServerRequests = new Map();
  // A transport or process failure (including a timeout, after which the
  // app-server may be wedged mid-turn) must not return the process to the
  // pool; user cancels and runtime-reported turn failures leave it healthy.
  let failed = false;

  try {
    sendNativeRuntimeStatus(options, 'codex', threadId
      ? 'Resuming Codex locally.'
      : 'Starting Codex locally.');
    resolved = await resolveCodexClient(options, async (request) => {
      return handleCodexServerRequest(request, options, pendingServerRequests);
    });
    const client = resolved.client;
    if (resolved.owned) await client.initialize({ signal: options.signal });
    const thread = threadId
      ? await client.resumeThread({ threadId }, { signal: options.signal })
      : await client.startThread({
        cwd: options.cwd,
        ...(options.modelOverride ? { model: options.modelOverride } : {}),
      }, { signal: options.signal });
    threadId = thread.threadId;
    options.send({
      type: 'runtime_binding',
      runtime: 'codex',
      externalSessionId: threadId,
      cwd: options.cwd,
    });
    sendNativeRuntimeStatus(options, 'codex', 'Codex is connected and working in this chat.');

    const abortListener = () => {
      if (threadId) void client.interruptTurn?.({ threadId }).catch(() => {});
    };
    options.signal?.addEventListener('abort', abortListener, { once: true });
    let materialized: Awaited<ReturnType<typeof materializeMindosRuntimeAttachments>> | undefined;
    try {
      materialized = await materializeMindosRuntimeAttachments(options.attachments);
      const prompt = appendMindosRuntimeAttachmentPathContext(
        options.prompt,
        materialized.attachments,
        { includeImages: true },
      );
      const turnNotifications = client.startTurn({
        threadId,
        cwd: options.cwd,
        input: buildCodexTurnInput({
          prompt,
          selectedSkills: options.selectedSkills,
          attachments: materialized.attachments,
        }),
        ...(options.modelOverride ? { model: options.modelOverride } : {}),
        ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
        ...codexPermissionOptionsForMindosMode(options.permissionMode),
        signal: options.signal,
      });
      const terminal: LaneTerminalState = { sawDone: false };
      for await (const notification of iterateWithNativeRuntimeAbort(turnNotifications, options.signal)) {
        if (notification.method === 'serverRequest/resolved') {
          abortCodexPendingServerRequest(notification.params, pendingServerRequests);
        }
        for (const event of mapCodexAppServerNotificationToSseEvents(notification)) {
          trackLaneTerminalEvent(terminal, event);
          options.send(event);
        }
      }
      throwIfLaneReportedError(terminal);
    } finally {
      await materialized?.cleanup();
      options.signal?.removeEventListener('abort', abortListener);
    }
    throwIfNativeRuntimeTimedOut(options.signal);

    return { externalSessionId: threadId };
  } catch (error) {
    const err = errorFromRuntimeFailure(error, options.signal, 'codex');
    if (isUserCancel(options.signal)) {
      // See the Claude lane: a user cancel leaves the thread resumable and
      // must not surface as a stream error.
      sendNativeRuntimeStatus(options, 'codex', 'Canceled by user.');
    } else if (!isRuntimeReportedError(err)) {
      failed = true;
      if (threadId) {
        options.send({
          type: 'runtime_binding',
          runtime: 'codex',
          externalSessionId: threadId,
          cwd: options.cwd,
          status: 'failed',
          reason: err.message,
        });
      }
      options.send({ type: 'error', message: `Codex native runtime error: ${err.message}` });
    }
    return { error: err, ...(threadId ? { externalSessionId: threadId } : {}) };
  } finally {
    abortAllCodexPendingServerRequests(pendingServerRequests);
    await resolved?.release({ failed });
  }
}

async function resolveCodexClient(
  options: MindosNativeAgentTurnOptions,
  handleServerRequest: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown,
): Promise<ResolvedCodexClient> {
  if (options.services?.createCodexClient) {
    const client = await options.services.createCodexClient({ cwd: options.cwd, signal: options.signal, handleServerRequest });
    return {
      client,
      owned: true,
      release: async () => {
        await client.close?.();
      },
    };
  }

  const lease = await acquireCodexAppServerForTurn({
    command: options.runtime.binaryPath ?? 'codex',
    cwd: options.cwd,
    ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
    signal: options.signal,
  });
  const client = lease.resource;
  client.setServerRequestHandler?.(handleServerRequest);
  return {
    client,
    owned: false,
    release: async ({ failed }) => {
      client.setServerRequestHandler?.(undefined);
      lease.release({ failed });
    },
  };
}

function codexPermissionOptionsForMindosMode(
  mode: MindosNativeAgentTurnOptions['permissionMode'],
): { approvalPolicy?: string; sandbox?: Record<string, unknown> } {
  switch (mode ?? 'ask') {
    case 'read':
      return {
        approvalPolicy: 'never',
        sandbox: { mode: 'read-only' },
      };
    case 'ask':
      return {
        approvalPolicy: 'untrusted',
        sandbox: { mode: 'workspace-write' },
      };
    case 'auto':
      return {
        approvalPolicy: 'on-request',
        sandbox: { mode: 'workspace-write' },
      };
    case 'full':
      return {
        approvalPolicy: 'never',
        sandbox: { mode: 'danger-full-access' },
      };
  }
}
async function handleCodexServerRequest(
  request: CodexAppServerServerRequest,
  options: MindosNativeAgentTurnOptions,
  pendingServerRequests?: CodexPendingServerRequests,
): Promise<unknown> {
  if (isCodexUserInputRequest(request)) {
    return handleCodexUserInputRequest(request, options, pendingServerRequests);
  }

  if (!isCodexApprovalRequest(request)) {
    throw new Error(`Unhandled Codex app-server request: ${request.method}`);
  }

  const permissionRequest = buildCodexPermissionRequest(request);
  const result = await withCodexPendingServerRequest(
    request,
    {
      kind: 'permission',
      toolCallId: permissionRequest.toolCallId,
      signal: options.signal,
      pendingServerRequests,
    },
    async (signal) => (
      options.services?.requestRuntimePermission
        ? await options.services.requestRuntimePermission(permissionRequest, { signal })
        : { decision: 'cancel', cancelled: true }
    ),
  );

  if (request.method === 'item/permissions/requestApproval') {
    return codexPermissionsApprovalResult(request, result);
  }

  return {
    decision: result.cancelled ? 'cancel' : normalizeCodexApprovalDecision(result.decision),
  };
}

async function handleCodexUserInputRequest(
  request: CodexAppServerServerRequest,
  options: MindosNativeAgentTurnOptions,
  pendingServerRequests?: CodexPendingServerRequests,
): Promise<unknown> {
  const questionRequest = buildCodexUserQuestionRequest(request);
  const result = await withCodexPendingServerRequest(
    request,
    {
      kind: 'question',
      toolCallId: questionRequest.toolCallId,
      signal: options.signal,
      pendingServerRequests,
    },
    async (signal) => (
      options.services?.requestUserQuestion
        ? await options.services.requestUserQuestion(questionRequest, { signal })
        : { answers: [], cancelled: true, error: 'no_bridge' }
    ),
  );

  if (result.cancelled) {
    return { cancelled: true, answers: [], error: result.error ?? 'cancelled' };
  }

  return {
    answers: result.answers.map((answer) => ({
      questionIndex: answer.questionIndex,
      question: answer.question,
      answer: answer.answer,
      ...(answer.selected ? { selected: answer.selected } : {}),
      ...(answer.kind ? { kind: answer.kind } : {}),
    })),
  };
}

function isCodexUserInputRequest(request: CodexAppServerServerRequest): boolean {
  return request.method === 'item/tool/requestUserInput'
    || request.method === 'tool/requestUserInput';
}

function isCodexApprovalRequest(request: CodexAppServerServerRequest): boolean {
  return request.method === 'item/commandExecution/requestApproval'
    || request.method === 'item/fileChange/requestApproval'
    || request.method === 'item/permissions/requestApproval'
    || /approval|permission/i.test(request.method);
}

async function withCodexPendingServerRequest<T>(
  request: CodexAppServerServerRequest,
  input: {
    kind: CodexPendingServerRequestKind;
    toolCallId: string;
    signal?: AbortSignal;
    pendingServerRequests?: CodexPendingServerRequests;
  },
  callback: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!input.pendingServerRequests) return callback(input.signal);

  const abortController = new AbortController();
  const abortFromParent = () => abortController.abort();
  if (input.signal?.aborted) {
    abortController.abort();
  } else {
    input.signal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const keys = codexServerRequestKeys(request);
  const pending: CodexPendingServerRequest = {
    requestId: request.id,
    toolCallId: input.toolCallId,
    kind: input.kind,
    abortController,
    cleanup: () => {
      input.signal?.removeEventListener('abort', abortFromParent);
      for (const key of keys) {
        if (input.pendingServerRequests?.get(key) === pending) {
          input.pendingServerRequests.delete(key);
        }
      }
    },
  };

  for (const key of keys) input.pendingServerRequests.set(key, pending);

  try {
    return await callback(abortController.signal);
  } finally {
    pending.cleanup();
  }
}

function abortCodexPendingServerRequest(
  params: Record<string, unknown> | undefined,
  pendingServerRequests: CodexPendingServerRequests,
): boolean {
  const keys = codexServerRequestResolvedKeys(params);
  for (const key of keys) {
    const pending = pendingServerRequests.get(key);
    if (!pending) continue;
    pending.abortController.abort();
    pending.cleanup();
    return true;
  }
  return false;
}

function abortAllCodexPendingServerRequests(pendingServerRequests: CodexPendingServerRequests): void {
  const pending = new Set(pendingServerRequests.values());
  pendingServerRequests.clear();
  for (const request of pending) {
    request.abortController.abort();
    request.cleanup();
  }
}

function codexServerRequestKeys(request: CodexAppServerServerRequest): string[] {
  const params = request.params ?? {};
  return uniqueStrings([
    String(request.id),
    getIdLike(params, 'requestId'),
    getIdLike(params, 'serverRequestId'),
    getIdLike(params, 'jsonrpcId'),
    getIdLike(params, 'itemId'),
    getIdLike(params, 'callId'),
    getIdLike(params, 'id'),
  ]);
}

function codexServerRequestResolvedKeys(params: Record<string, unknown> | undefined): string[] {
  return uniqueStrings([
    getIdLike(params, 'requestId'),
    getIdLike(params, 'serverRequestId'),
    getIdLike(params, 'jsonrpcId'),
    getIdLike(params, 'itemId'),
    getIdLike(params, 'callId'),
    getIdLike(params, 'id'),
  ]);
}

function buildCodexPermissionRequest(request: CodexAppServerServerRequest): MindosRuntimePermissionRequest {
  const params = request.params ?? {};
  const toolCallId = getString(params, 'itemId')
    ?? getString(params, 'requestId')
    ?? getString(params, 'callId')
    ?? getString(params, 'id')
    ?? `codex-approval-${request.id}`;
  const command = getString(params, 'command')
    ?? getString(params, 'cmd')
    ?? getString(params, 'shellCommand');
  const filePath = getString(params, 'path')
    ?? getString(params, 'filePath')
    ?? getString(params, 'targetPath');
  const toolName = request.method === 'item/fileChange/requestApproval'
    ? 'file_change_approval'
    : command
      ? 'Bash'
      : 'approval_request';
  const action = request.method === 'item/fileChange/requestApproval'
    ? 'file-change'
    : command
      ? 'command'
      : 'tool-call';

  return {
    runtime: 'codex',
    toolCallId,
    toolName,
    input: {
      method: request.method,
      ...params,
    },
    options: getCodexPermissionOptions(params, request.method),
    action,
    ...(command || filePath ? { resource: command ?? filePath } : {}),
    ...(getString(params, 'reason') ?? getString(params, 'message') ? {
      reason: getString(params, 'reason') ?? getString(params, 'message'),
    } : {}),
  };
}

function buildCodexUserQuestionRequest(request: CodexAppServerServerRequest): MindosRuntimeUserQuestionRequest {
  const params = request.params ?? {};
  const toolCallId = getString(params, 'itemId')
    ?? getString(params, 'requestId')
    ?? getString(params, 'callId')
    ?? getString(params, 'id')
    ?? `codex-question-${request.id}`;
  const questions = normalizeCodexUserQuestions(params);

  return {
    runtime: 'codex',
    toolCallId,
    questions: questions.length > 0 ? questions : [{
      question: getString(params, 'message') ?? getString(params, 'reason') ?? 'Codex needs your input to continue.',
      header: getString(params, 'title') ?? 'Codex input',
      options: [
        { label: 'Continue', description: 'Allow Codex to continue with this request.' },
        { label: 'Cancel', description: 'Cancel this request.' },
      ],
    }],
  };
}

function normalizeCodexUserQuestions(params: Record<string, unknown>): MindosRuntimeUserQuestion[] {
  const rawQuestions = Array.isArray(params.questions)
    ? params.questions
    : isRecord(params.input) && Array.isArray(params.input.questions)
      ? params.input.questions
      : [];
  return rawQuestions
    .filter(isRecord)
    .map((question, index) => ({
      question: getString(question, 'question') ?? getString(question, 'text') ?? getString(question, 'message') ?? `Question ${index + 1}`,
      header: getString(question, 'header') ?? getString(question, 'title') ?? `Question ${index + 1}`,
      multiSelect: question.multiSelect === true || question.multiselect === true,
      options: normalizeCodexUserQuestionOptions(question.options),
    }));
}

function normalizeCodexUserQuestionOptions(value: unknown): MindosRuntimeUserQuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option): MindosRuntimeUserQuestionOption[] => {
    if (typeof option === 'string' && option.trim()) {
      return [{ label: option, description: option }];
    }
    if (!isRecord(option)) return [];
    const label = getString(option, 'label')
      ?? getString(option, 'value')
      ?? getString(option, 'title')
      ?? (option.isOther === true ? 'Other' : undefined);
    if (!label) return [];
    return [{
      label,
      description: getString(option, 'description') ?? getString(option, 'hint') ?? label,
      ...(getString(option, 'preview') ? { preview: getString(option, 'preview') } : {}),
    }];
  });
}

function getCodexPermissionOptions(params: Record<string, unknown>, method: string): MindosRuntimePermissionOption[] {
  const fromParams = [
    ...stringArray(params.availableDecisions),
    ...stringArray(params.decisions),
    ...stringArray(params.options),
  ].map(decisionOption);
  if (fromParams.length > 0) return dedupeOptions(fromParams);

  const defaults = method === 'item/permissions/requestApproval'
    ? ['accept', 'acceptForSession', 'decline']
    : ['accept', 'acceptForSession', 'decline'];
  return defaults.map(decisionOption);
}

function decisionOption(id: string): MindosRuntimePermissionOption {
  const labels: Record<string, string> = {
    accept: 'Allow once',
    acceptForSession: 'Allow session',
    decline: 'Deny',
    cancel: 'Cancel',
    deny: 'Deny',
  };
  const descriptions: Record<string, string> = {
    accept: 'Run this action one time.',
    acceptForSession: 'Run this action and remember the same rule for this Codex session.',
    decline: 'Reject this action.',
    cancel: 'Cancel the pending action.',
  };
  return {
    id,
    label: labels[id] ?? id,
    ...(descriptions[id] ? { description: descriptions[id] } : {}),
    intent: id === 'accept' || id === 'acceptForSession' ? 'allow' : id === 'decline' || id === 'deny' ? 'deny' : 'cancel',
    ...(id === 'accept' ? { scope: 'once' as const } : {}),
    ...(id === 'acceptForSession' ? { scope: 'session' as const } : {}),
  };
}

function dedupeOptions(options: MindosRuntimePermissionOption[]): MindosRuntimePermissionOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.id || seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function normalizeCodexApprovalDecision(decision: string): string {
  if (decision === 'accept' || decision === 'acceptForSession' || decision === 'decline' || decision === 'cancel') {
    return decision;
  }
  if (decision === 'deny' || decision === 'denied') return 'decline';
  return 'cancel';
}

function codexPermissionsApprovalResult(
  request: CodexAppServerServerRequest,
  result: MindosRuntimePermissionResult,
): Record<string, unknown> {
  const decision = result.cancelled ? 'cancel' : normalizeCodexApprovalDecision(result.decision);
  if (decision === 'decline' || decision === 'cancel') return { permissions: {} };
  const requestedPermissions = request.params?.permissions && typeof request.params.permissions === 'object'
    ? request.params.permissions
    : {};
  return {
    permissions: requestedPermissions,
    ...(decision === 'acceptForSession' ? { scope: 'session' } : {}),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getIdLike(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
