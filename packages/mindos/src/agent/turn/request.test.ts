import { describe, expect, it } from 'vitest';
import type { AgentRunCapsuleRecoveryPlan } from '../capsules/types.js';
import {
  MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES,
  MINDOS_AGENT_ATTACHMENT_MAX_FILE_COUNT,
  MINDOS_AGENT_ATTACHMENT_MAX_TOTAL_BYTES,
  findUnknownMindosAgentTurnRequestFields,
  findUnknownMindosSessionTurnContextFields,
  getLastMindosUserContent,
  getLastMindosUserImages,
  getLastMindosUserSkillName,
  mindosAgentRunCapsuleRecoveryPlanToTurnBody,
  normalizeMindosAcpRuntimeOptions,
  normalizeMindosAgentOptions,
  normalizeMindosAgentSessionTurnBody,
  normalizeMindosNativeRuntimeOptions,
  normalizeMindosNativeRuntimeOptionsForRuntime,
  normalizeMindosSelectedRuntime,
  normalizeMindosSessionContextSelection,
  normalizeMindosSessionWorkDir,
  parseMindosAgentTurnRequest,
  validateMindosAgentTurnAttachmentBudget,
  validateMindosAgentModeField,
  validateMindosAgentOptionsObject,
  validateMindosPermissionModeField,
  validateMindosRuntimeBindingMatchesRuntime,
} from './request.js';

describe('turn request option normalisers', () => {
  it('keeps a valid reasoning effort and model override', () => {
    expect(normalizeMindosNativeRuntimeOptions({ reasoningEffort: 'high', modelOverride: ' gpt-5 ' }))
      .toEqual({ reasoningEffort: 'high', modelOverride: 'gpt-5' });
  });

  it('drops malformed efforts and non-string models but keeps the other field', () => {
    expect(normalizeMindosNativeRuntimeOptions({ reasoningEffort: 'HIGH', modelOverride: 'm' }))
      .toEqual({ modelOverride: 'm' });
    expect(normalizeMindosNativeRuntimeOptions({ reasoningEffort: 'x'.repeat(40) }))
      .toEqual({});
  });

  it('caps a pathological model override at 240 chars (handler semantics, unified)', () => {
    const normalized = normalizeMindosNativeRuntimeOptions({ modelOverride: 'm'.repeat(500) });
    expect(normalized.modelOverride).toHaveLength(240);
  });

  it('handles empty, null, array and primitive inputs as no options', () => {
    for (const value of [undefined, null, {}, [], 'text', 42]) {
      expect(normalizeMindosNativeRuntimeOptions(value)).toEqual({});
      expect(normalizeMindosAcpRuntimeOptions(value)).toEqual({});
      expect(normalizeMindosAgentOptions(value)).toEqual({});
    }
  });

  it('normalises ACP mode id and config values, dropping blank entries and capping lengths', () => {
    expect(normalizeMindosAcpRuntimeOptions({
      modeId: ' plan ',
      configValues: { model: 'gemini', '': 'x', blank: '   ', long: 'v'.repeat(2000) },
    })).toEqual({
      modeId: 'plan',
      configValues: { model: 'gemini', long: 'v'.repeat(1000) },
    });
  });

  it('clamps the Pi thinking budget into [1000, 50000] and ignores invalid levels', () => {
    expect(normalizeMindosAgentOptions({ enableThinking: true, thinkingLevel: 'max', thinkingBudget: 10 }))
      .toEqual({ enableThinking: true, thinkingLevel: 'max', thinkingBudget: 1000 });
    expect(normalizeMindosAgentOptions({ thinkingLevel: 'ultra', thinkingBudget: 999999 }))
      .toEqual({ thinkingBudget: 50000 });
    expect(normalizeMindosAgentOptions({ thinkingBudget: NaN }))
      .toEqual({});
  });
});

describe('turn request validators', () => {
  it('accepts every valid mode and permission mode and rejects the rest with the contract message', () => {
    for (const mode of ['default', 'plan', 'goal']) expect(validateMindosAgentModeField(mode)).toBeNull();
    expect(validateMindosAgentModeField('organize')).toBe('agentMode must be default, plan, or goal');
    expect(validateMindosAgentModeField(undefined)).toBeNull();
    for (const mode of ['read', 'ask', 'auto', 'full']) expect(validateMindosPermissionModeField(mode)).toBeNull();
    expect(validateMindosPermissionModeField('yolo')).toBe('permissionMode must be read, ask, auto, or full');
  });

  it('validates agentOptions in order: shape, unknown field, then each value', () => {
    expect(validateMindosAgentOptionsObject(undefined)).toBeNull();
    expect(validateMindosAgentOptionsObject([])).toBe('agentOptions must be an object');
    expect(validateMindosAgentOptionsObject({ bogus: 1 })).toBe('Unknown field: agentOptions.bogus');
    expect(validateMindosAgentOptionsObject({ enableThinking: 'yes' }))
      .toBe('agentOptions.enableThinking must be a boolean');
    expect(validateMindosAgentOptionsObject({ thinkingLevel: 'ultra' }))
      .toBe('agentOptions.thinkingLevel must be off, minimal, low, medium, high, xhigh, or max');
    expect(validateMindosAgentOptionsObject({ thinkingBudget: Infinity }))
      .toBe('agentOptions.thinkingBudget must be a finite number');
    expect(validateMindosAgentOptionsObject({ enableThinking: false, thinkingLevel: 'low', thinkingBudget: 2000 }))
      .toBeNull();
  });

  it('sweeps nested option objects for unknown fields and reports the first offender with its prefix', () => {
    expect(findUnknownMindosAgentTurnRequestFields({ messages: [], runtimeOptions: { effort: 'x' } }))
      .toBe('Unknown field: runtimeOptions.effort');
    expect(findUnknownMindosAgentTurnRequestFields({ messages: [], runtimeBinding: { kind: 'codex-thread', note: 'x' } }))
      .toBe('Unknown field: runtimeBinding.note');
    expect(findUnknownMindosAgentTurnRequestFields({ mode: 'organize' })).toBe('Unknown field: mode');
    expect(findUnknownMindosAgentTurnRequestFields({
      messages: [], agentMode: 'plan', runtimeOptions: { reasoningEffort: 'high' },
    })).toBeNull();
    expect(findUnknownMindosSessionTurnContextFields({ context: { currentFile: 'a.md', bogus: 1 } }))
      .toBe('Unknown field: context.bogus');
    expect(findUnknownMindosSessionTurnContextFields({ message: { text: 'hi', role: 'user' } }))
      .toBe('Unknown field: message.role');
    expect(findUnknownMindosSessionTurnContextFields({})).toBeNull();
  });

  it('cross-checks a runtime binding against the selected runtime', () => {
    expect(validateMindosRuntimeBindingMatchesRuntime(null, null)).toBeNull();
    expect(validateMindosRuntimeBindingMatchesRuntime(null, {
      kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', updatedAt: 1,
    })).toBe('runtimeBinding requires selectedRuntime');
    expect(validateMindosRuntimeBindingMatchesRuntime(
      { id: 'mindos', name: 'MindOS', kind: 'mindos' },
      { kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', updatedAt: 1 },
    )).toBe('runtimeBinding is only valid for external runtimes');
    expect(validateMindosRuntimeBindingMatchesRuntime(
      { id: 'codex', name: 'Codex', kind: 'codex' },
      { kind: 'acp-session', runtime: 'codex', runtimeId: 'codex', updatedAt: 1 },
    )).toBe('runtimeBinding.kind must be codex-thread for Codex');
    expect(validateMindosRuntimeBindingMatchesRuntime(
      { id: 'codex', name: 'Codex', kind: 'codex' },
      { kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', updatedAt: 1 },
    )).toBeNull();
  });
});

describe('parseMindosAgentTurnRequest', () => {
  it('rejects non-object bodies and missing messages arrays', () => {
    expect(parseMindosAgentTurnRequest(null)).toEqual({ ok: false, message: 'Invalid agent turn request body' });
    expect(parseMindosAgentTurnRequest({})).toEqual({ ok: false, message: 'messages must be an array' });
  });

  it('normalises a full request and keeps only known fields', () => {
    const parsed = parseMindosAgentTurnRequest({
      messages: [{ role: 'user', content: 'hi' }, null, 'junk'],
      agentMode: 'plan',
      permissionMode: 'read',
      currentFile: 'a.md',
      attachedFiles: ['x.md', 42],
      uploadedFiles: [{ name: 'u.md', content: 'c', mimeType: ' text/markdown ', size: NaN, junk: true }],
      maxSteps: 12,
      assistantId: ' inbox ',
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: ' /bin/codex ' },
      runtimeBinding: { kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', externalSessionId: 'thr_1', updatedAt: 5 },
      workDir: { path: '/work', source: 'manual', label: 'L', updatedAt: 3 },
      contextSelection: { spaces: [{ path: 'Research\\Notes' }], assistants: [{ id: 'A1' }], updatedAt: 7 },
      runtimeOptions: { reasoningEffort: 'high' },
      acpRuntimeOptions: { modeId: 'plan' },
      agentOptions: { thinkingLevel: 'low' },
      chatSessionId: ' chat-1 ',
      providerOverride: 'openai',
      modelOverride: 'gpt-5',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.body).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      agentMode: 'plan',
      permissionMode: 'read',
      currentFile: 'a.md',
      attachedFiles: ['x.md'],
      uploadedFiles: [{ name: 'u.md', content: 'c', mimeType: ' text/markdown ' }],
      maxSteps: 12,
      assistantId: 'inbox',
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: ' /bin/codex ' },
      runtimeBinding: { kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', externalSessionId: 'thr_1', updatedAt: 5 },
      workDir: { path: '/work', source: 'manual', label: 'L', updatedAt: 3 },
      contextSelection: {
        version: 1,
        spaces: [{ path: 'Research/Notes' }],
        assistants: [{ id: 'a1' }],
        updatedAt: 7,
      },
      runtimeOptions: { reasoningEffort: 'high' },
      acpRuntimeOptions: { modeId: 'plan' },
      agentOptions: { thinkingLevel: 'low' },
      chatSessionId: 'chat-1',
      providerOverride: 'openai',
      modelOverride: 'gpt-5',
    });
  });

  it('lifts a legacy selectedAcpAgent into an ACP selectedRuntime and honours explicit null', () => {
    expect(normalizeMindosSelectedRuntime({ selectedAcpAgent: { id: 'claude', name: 'Claude ACP' } }))
      .toEqual({ id: 'claude', name: 'Claude ACP', kind: 'acp' });
    expect(normalizeMindosSelectedRuntime({ selectedRuntime: null, selectedAcpAgent: { id: 'c', name: 'C' } }))
      .toBeNull();
    expect(normalizeMindosSelectedRuntime({})).toBeUndefined();
  });
});

describe('normalizeMindosAgentSessionTurnBody', () => {
  it('requires a session id and an object body', () => {
    expect(normalizeMindosAgentSessionTurnBody({}, '  ')).toEqual({ ok: false, message: 'sessionId is required' });
    expect(normalizeMindosAgentSessionTurnBody([], 's1'))
      .toEqual({ ok: false, message: 'Invalid agent session turn request body' });
  });

  it('passes a messages[] body through with the path session id winning', () => {
    const normalized = normalizeMindosAgentSessionTurnBody(
      { messages: [{ role: 'user', content: 'hi' }], chatSessionId: 'body-should-not-win' },
      'session-from-path',
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.body.chatSessionId).toBe('session-from-path');
    expect(normalized.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('projects the message/prompt shorthand into one user message', () => {
    const normalized = normalizeMindosAgentSessionTurnBody({
      message: { text: 'do it', skillName: 'mindos', images: [{ type: 'image', data: 'x' }] },
      agentMode: 'goal',
      permissionMode: 'auto',
      context: { currentFile: 'a.md', attachedFiles: ['b.md'] },
      acpRuntimeOptions: { modeId: 'plan' },
    }, 's1');
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.body.chatSessionId).toBe('s1');
    expect(normalized.body.agentMode).toBe('goal');
    expect(normalized.body.permissionMode).toBe('auto');
    expect(normalized.body.currentFile).toBe('a.md');
    expect(normalized.body.attachedFiles).toEqual(['b.md']);
    expect(normalized.body.acpRuntimeOptions).toEqual({ modeId: 'plan' });
    const message = normalized.body.messages[0] as Record<string, unknown>;
    expect(message.role).toBe('user');
    expect(message.content).toBe('do it');
    expect(message.skillName).toBe('mindos');
    expect(message.images).toEqual([{ type: 'image', data: 'x' }]);
    expect(typeof message.timestamp).toBe('number');
  });

  it('rejects a shorthand body without text or images', () => {
    expect(normalizeMindosAgentSessionTurnBody({ message: {} }, 's1'))
      .toEqual({ ok: false, message: 'message.text is required' });
  });

  it('rejects unknown nested fields with the prefixed message', () => {
    expect(normalizeMindosAgentSessionTurnBody({ message: { text: 'x' }, context: { bogus: 1 } }, 's1'))
      .toEqual({ ok: false, message: 'Unknown field: context.bogus' });
  });
});

describe('reasoning effort normalisation at the request boundary', () => {
  it('folds case for a known codex effort and keeps model override', () => {
    expect(normalizeMindosNativeRuntimeOptionsForRuntime({ reasoningEffort: ' HIGH ', modelOverride: ' gpt-5 ' }, 'codex'))
      .toEqual({ options: { reasoningEffort: 'high', modelOverride: 'gpt-5' } });
  });

  it('drops an unsupported codex effort with a status-ready notice instead of forwarding it', () => {
    const result = normalizeMindosNativeRuntimeOptionsForRuntime({ reasoningEffort: 'turbo' }, 'codex');
    expect(result.options).toEqual({});
    expect(result.effortNotice).toMatch(/Reasoning effort "turbo" is not supported by Codex/);
    expect(result.effortNotice).toMatch(/using its default/);
  });

  it('drops minimal for claude (outside its vocabulary) with a notice', () => {
    const result = normalizeMindosNativeRuntimeOptionsForRuntime({ reasoningEffort: 'minimal' }, 'claude');
    expect(result.options).toEqual({});
    expect(result.effortNotice).toMatch(/not supported by Claude Code/);
  });

  it('keeps the legacy shape-only behaviour when no runtime kind is known', () => {
    expect(normalizeMindosNativeRuntimeOptionsForRuntime({ reasoningEffort: 'high' }, undefined))
      .toEqual({ options: { reasoningEffort: 'high' } });
    expect(normalizeMindosNativeRuntimeOptionsForRuntime({ reasoningEffort: 'HIGH' }, undefined))
      .toEqual({ options: {} });
    expect(normalizeMindosNativeRuntimeOptionsForRuntime({ reasoningEffort: 'custom_effort-1' }, undefined))
      .toEqual({ options: { reasoningEffort: 'custom_effort-1' } });
  });

  it('normalises effort in the strict parse and surfaces effortNotice', () => {
    const parsed = parseMindosAgentTurnRequest({
      messages: [{ role: 'user', content: 'hi' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeOptions: { reasoningEffort: 'turbo', modelOverride: 'gpt-5' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.body.runtimeOptions).toEqual({ modelOverride: 'gpt-5' });
    expect(parsed.effortNotice).toMatch(/not supported by Codex/);
  });

  it('normalises effort in the session-turn shorthand and messages[] passthrough', () => {
    const shorthand = normalizeMindosAgentSessionTurnBody({
      message: { text: 'hi' },
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeOptions: { reasoningEffort: 'XHIGH' },
    }, 's1');
    expect(shorthand.ok).toBe(true);
    if (shorthand.ok) {
      expect(shorthand.body.runtimeOptions).toEqual({ reasoningEffort: 'xhigh' });
      expect(shorthand.effortNotice).toBeUndefined();
    }

    const passthrough = normalizeMindosAgentSessionTurnBody({
      messages: [{ role: 'user', content: 'hi' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      runtimeOptions: { reasoningEffort: 'minimal' },
    }, 's2');
    expect(passthrough.ok).toBe(true);
    if (passthrough.ok) {
      expect(passthrough.body.runtimeOptions).toEqual({});
      expect(passthrough.effortNotice).toMatch(/not supported by Claude Code/);
    }
  });

  it('re-normalises a legacy capsule effort on recovery replay', () => {
    const body = mindosAgentRunCapsuleRecoveryPlanToTurnBody({
      schemaVersion: 1,
      id: 'recovery-1',
      sourceCapsuleId: 'capsule-1',
      action: 'retry',
      request: {
        messages: [{ role: 'user', content: 'hi' }],
        runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
        runtimeBinding: null,
        thinkingEffort: 'turbo',
        model: 'gpt-5',
        context: { attachedFiles: [], uploadedFiles: [], receiptIds: [], assetIds: [] },
        options: {},
      },
      createdAt: '2026-09-03T10:00:00.000Z',
    } as unknown as AgentRunCapsuleRecoveryPlan, 'chat-9');
    // 'turbo' is not a codex effort: replay omits it (runtime default) and keeps the model.
    expect(body.runtimeOptions).toEqual({ modelOverride: 'gpt-5' });
  });
});

describe('turn attachment budget', () => {
  // base64 string whose decoded estimate is `bytes` (estimate = floor(len*3/4))
  const b64 = (bytes: number): string => 'A'.repeat(Math.ceil((bytes * 4) / 3));
  const uploadedFile = (name: string, dataBase64?: string, content = '') => ({
    name,
    content,
    ...(dataBase64 ? { dataBase64 } : {}),
  });
  const image = (data: string) => ({ type: 'image', data, mimeType: 'image/png' });
  const strictBody = (overrides: Record<string, unknown>) => parseMindosAgentTurnRequest({
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  });

  it('exposes the documented budget constants derived from the client caps and capsule limit', () => {
    expect(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MINDOS_AGENT_ATTACHMENT_MAX_TOTAL_BYTES).toBe(5 * 1024 * 1024);
    expect(MINDOS_AGENT_ATTACHMENT_MAX_FILE_COUNT).toBe(16);
  });

  it('rejects an oversized uploadedFiles dataBase64 at strict parse', () => {
    const result = strictBody({
      uploadedFiles: [uploadedFile('movie.mp4', b64(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES + 4))],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/payload too large/i);
      expect(result.message).toContain('movie.mp4');
    }
  });

  it('rejects an oversized image inside message shorthand and messages[] history', () => {
    const shorthand = normalizeMindosAgentSessionTurnBody({
      message: { text: 'look', images: [image(b64(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES + 4))] },
    }, 's1');
    expect(shorthand.ok).toBe(false);

    const passthrough = normalizeMindosAgentSessionTurnBody({
      messages: [
        { role: 'user', content: 'earlier', images: [image(b64(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES + 4))] },
      ],
    }, 's1');
    expect(passthrough.ok).toBe(false);
  });

  it('rejects context.uploadedFiles that exceed the total per-turn budget', () => {
    const half = Math.floor(MINDOS_AGENT_ATTACHMENT_MAX_TOTAL_BYTES / 2) + 1024;
    const result = normalizeMindosAgentSessionTurnBody({
      message: { text: 'two files' },
      context: { uploadedFiles: [uploadedFile('a.pdf', b64(half)), uploadedFile('b.pdf', b64(half))] },
    }, 's1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/per-turn budget/i);
  });

  it('rejects more attachments than the per-turn count limit', () => {
    const images = Array.from({ length: MINDOS_AGENT_ATTACHMENT_MAX_FILE_COUNT + 1 }, () => image('QUJD'));
    const result = strictBody({ images });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/attachments exceed the 16 per-turn limit/i);
  });

  it('bounds a huge text-only upload through the per-file byte budget', () => {
    // The 20k char cap is enforced downstream (web host 413); the parser budget
    // bounds the same content by bytes so a multi-MiB text upload cannot slip
    // into the tmp decode / capsule clone path.
    const result = strictBody({
      uploadedFiles: [uploadedFile('huge.txt', undefined, 'x'.repeat(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES + 1))],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/per-file limit/i);
  });

  it('accepts payloads exactly at every limit', () => {
    expect(strictBody({
      uploadedFiles: [uploadedFile('edge.bin', b64(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES))],
    }).ok).toBe(true);
    expect(strictBody({
      images: Array.from({ length: MINDOS_AGENT_ATTACHMENT_MAX_FILE_COUNT }, () => image('QUJD')),
    }).ok).toBe(true);
  });

  it('counts data-URL-prefixed base64 by its decoded payload', () => {
    const prefixed = `data:image/png;base64,${b64(MINDOS_AGENT_ATTACHMENT_MAX_FILE_BYTES + 4)}`;
    const result = strictBody({ images: [image(prefixed)] });
    expect(result.ok).toBe(false);
  });

  it('leaves small legacy payloads untouched', () => {
    expect(validateMindosAgentTurnAttachmentBudget({})).toBeNull();
    expect(strictBody({
      uploadedFiles: [{ name: 'f.pdf', content: 'text', dataBase64: 'cGRmLWJ5dGVz' }],
      images: [image('aW1n')],
    }).ok).toBe(true);
    expect(strictBody({
      messages: [{ role: 'user', content: 'hi', images: [{ data: 'img' }] }],
    }).ok).toBe(true);
  });

  it('ignores malformed entries instead of throwing', () => {
    expect(validateMindosAgentTurnAttachmentBudget({
      uploadedFiles: [null, 'nope', { name: 42 }, { content: 7 }],
      images: [null, { data: 5 }],
      messages: [null, 'x', { images: 'not-an-array' }],
    })).toBeNull();
  });
});

describe('last-user-message accessors', () => {
  const messages = [
    { role: 'user', content: 'first', skillName: 'a' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second', images: [{ data: 'img' }], skillName: '  ' },
  ];

  it('reads the last user message content, images and skill name', () => {
    expect(getLastMindosUserContent(messages)).toBe('second');
    expect(getLastMindosUserImages(messages)).toEqual([{ data: 'img' }]);
    expect(getLastMindosUserSkillName(messages)).toBeUndefined();
    expect(getLastMindosUserSkillName(messages.slice(0, 1))).toBe('a');
  });

  it('falls back safely for empty lists and non-user tails', () => {
    expect(getLastMindosUserContent([])).toBe('');
    expect(getLastMindosUserImages([])).toEqual([]);
    expect(getLastMindosUserSkillName([{ role: 'assistant' }])).toBeUndefined();
    expect(getLastMindosUserContent([null, undefined, 'junk'])).toBe('');
  });
});

describe('mindosAgentRunCapsuleRecoveryPlanToTurnBody', () => {
  function plan(overrides: Partial<AgentRunCapsuleRecoveryPlan['request']> = {}): AgentRunCapsuleRecoveryPlan {
    return {
      schemaVersion: 1,
      id: 'plan-1',
      capsuleId: 'cap-1',
      runId: 'run-1',
      action: 'retry',
      idempotencyKey: 'k',
      claimed: false,
      createdAt: new Date(),
      request: {
        messages: [{ role: 'user', content: 'retry me' }],
        runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
        agentMode: 'plan',
        permissionMode: 'ask',
        model: 'gpt-5',
        thinkingEffort: 'high',
        context: { attachedFiles: ['a.md'], uploadedFiles: [], receiptIds: [], assetIds: [] },
        options: { maxSteps: 9, assistantId: 'inbox', runtimeOptions: { modelOverride: 'old' } },
        ...overrides,
      },
    } as unknown as AgentRunCapsuleRecoveryPlan;
  }

  it('replays a native plan through the canonical turn body', () => {
    const body = mindosAgentRunCapsuleRecoveryPlanToTurnBody(plan(), 'chat-9');
    expect(body.chatSessionId).toBe('chat-9');
    expect(body.selectedRuntime).toEqual({ kind: 'codex', id: 'codex', name: 'Codex' });
    expect(body.agentMode).toBe('plan');
    expect(body.permissionMode).toBe('ask');
    expect(body.runtimeOptions).toEqual({ modelOverride: 'gpt-5', reasoningEffort: 'high' });
    expect(body.attachedFiles).toEqual(['a.md']);
    expect(body.maxSteps).toBe(9);
    expect(body.assistantId).toBe('inbox');
    expect(body.modelOverride).toBeUndefined();
  });

  it('maps a mindos plan model onto modelOverride and an acp plan onto selectedAcpAgent', () => {
    const mindosBody = mindosAgentRunCapsuleRecoveryPlanToTurnBody(plan({
      runtime: { kind: 'mindos', id: 'mindos', name: 'MindOS' },
    }), 'chat-9');
    expect(mindosBody.modelOverride).toBe('gpt-5');
    expect(mindosBody.runtimeOptions).toBeUndefined();

    const acpBody = mindosAgentRunCapsuleRecoveryPlanToTurnBody(plan({
      runtime: { kind: 'acp', id: 'gemini', name: 'Gemini CLI' },
      runtimeBinding: {
        type: 'acp-session', runtime: 'acp', runtimeId: 'gemini',
        externalSessionId: 'ses_1', cwd: '/w', status: 'active', updatedAt: 11,
      },
    }), 'chat-9');
    expect(acpBody.selectedAcpAgent).toEqual({ id: 'gemini', name: 'Gemini CLI' });
    expect(acpBody.runtimeBinding).toEqual(expect.objectContaining({
      kind: 'acp-session', runtime: 'acp', runtimeId: 'gemini', externalSessionId: 'ses_1',
    }));
  });
});

describe('session work dir and context selection normalisers', () => {
  it('drops empty work dirs and caps long paths', () => {
    expect(normalizeMindosSessionWorkDir({})).toBeUndefined();
    expect(normalizeMindosSessionWorkDir({ path: 'p'.repeat(1300) })?.path).toHaveLength(1200);
    expect(normalizeMindosSessionWorkDir({ source: 'bogus', label: 'L' })).toEqual({ label: 'L' });
  });

  it('bounds the context selection lists and normalises space paths', () => {
    const selection = normalizeMindosSessionContextSelection({
      spaces: Array.from({ length: 12 }, (_v, i) => ({ path: `Research\\space-${i}` })),
      assistants: Array.from({ length: 9 }, (_v, i) => ({ id: `A-${i}` })),
    });
    expect(selection?.spaces).toHaveLength(8);
    expect(selection?.assistants).toHaveLength(6);
    expect(selection?.spaces[0]?.path).toBe('Research/space-0');
    expect(selection?.version).toBe(1);
  });
});
