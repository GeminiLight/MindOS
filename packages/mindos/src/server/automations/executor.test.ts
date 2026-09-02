import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStudioAutomationsPost } from '../handlers/studio-automations.js';
import { createStudioAutomationExecutor } from './executor.js';
import { runStandaloneMindosPiAutomation } from './pi-executor.js';
import { readStudioAutomationState } from './store.js';

describe('Studio automation runtime executor', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('routes MindOS Pi jobs through the standalone Pi runner', async () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-executor-'));
    roots.push(mindRoot);
    const runMindosPi = vi.fn(async () => ({ text: 'pi result', thinking: 'pi thought', toolCalls: [] }));
    const executor = createStudioAutomationExecutor({ mindRoot, runMindosPi });
    const job = createJob(mindRoot, 'mindos-auto');
    const controller = new AbortController();

    await expect(executor(job, { runId: 'run-pi', attempt: 1, signal: controller.signal }))
      .resolves.toMatchObject({ text: 'pi result' });
    expect(runMindosPi).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'mindos-pi', model: 'mindos-auto' }),
      expect.objectContaining({ runId: 'run-pi', signal: controller.signal }),
    );
  });

  it('maps native Codex output and durable permission callbacks without a Web session', async () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-native-'));
    roots.push(mindRoot);
    const job = createJob(mindRoot, 'codex', 'ask');
    const runNative = vi.fn(async (options: any) => {
      options.send({ type: 'text_delta', delta: 'native result' });
      options.send({ type: 'thinking_delta', delta: 'native thought' });
      const decision = await options.services.requestRuntimePermission({
        runtime: 'codex',
        toolCallId: 'tool-1',
        toolName: 'apply_patch',
        input: { path: 'Notes/a.md' },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow', scope: 'once' },
          { id: 'decline', label: 'Deny', intent: 'deny', scope: 'once' },
        ],
      });
      return { permissionDecision: decision };
    });
    const notifyApproval = vi.fn(async () => ({ status: 'sent' as const, messageId: 'om_1' }));
    const executor = createStudioAutomationExecutor({
      mindRoot,
      runNative: runNative as never,
      notifyApproval,
    });

    await expect(executor(job, {
      runId: 'run-native', attempt: 1, signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: 'StudioAutomationApprovalRequiredError' });
    expect(runNative).toHaveBeenCalledWith(expect.objectContaining({
      runtime: expect.objectContaining({ kind: 'codex', id: 'codex' }),
      cwd: mindRoot,
      prompt: job.prompt,
      permissionMode: 'ask',
      reasoningEffort: 'high',
      services: expect.objectContaining({ requestRuntimePermission: expect.any(Function) }),
    }));
    expect(readStudioAutomationState(mindRoot).approvals).toEqual([
      expect.objectContaining({ jobId: job.id, runtime: 'codex', status: 'pending' }),
    ]);
    expect(notifyApproval).toHaveBeenCalledWith(expect.objectContaining({
      mindRoot,
      approvalId: expect.stringMatching(/^approval-/),
    }));
  });

  it('builds a product-owned Pi session with the packaged KB extension and collects output', async () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-pi-host-'));
    roots.push(mindRoot);
    const job = createJob(mindRoot, 'mindos-auto');
    let subscriber: ((event: unknown) => void) | undefined;
    const prompt = vi.fn(async () => {
      subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'standalone result' } });
      subscriber?.({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'standalone thought' } });
    });
    const createRuntime = vi.fn(async (options: any) => ({
      session: {
        subscribe(callback: (event: unknown) => void) { subscriber = callback; },
        prompt,
        steer: vi.fn(),
        abort: vi.fn(),
      },
      turnPrompt: options.turnPrompt,
      agentRunContextResource: {},
      llmHistoryMessages: [],
      fallbackTools: [],
      systemPrompt: options.systemPrompt,
      model: {},
      modelName: 'test',
      apiKey: 'test',
      provider: 'test',
      lastUserContent: job.prompt,
      extensionLoadErrors: [],
    }));

    await expect(runStandaloneMindosPiAutomation({
      mindRoot,
      job,
      context: { runId: 'run-standalone-pi', attempt: 1, signal: new AbortController().signal },
      runtimeRoot: '/opt/mindos-package',
      homeDir: mindRoot,
      readSettings: () => ({ ai: { activeProvider: '', providers: [] } }),
      createRuntime: createRuntime as never,
    })).resolves.toMatchObject({ text: 'standalone result', thinking: 'standalone thought' });

    const runtimeOptions = createRuntime.mock.calls[0]![0];
    expect(runtimeOptions.additionalExtensionPaths).toEqual([
      expect.stringMatching(/mindos-pi\/extension\/kb-extension-entry\.js$/),
    ]);
    expect(runtimeOptions.additionalExtensionPaths.join('\n')).not.toContain('packages/web');
    expect(runtimeOptions.permissionMode).toBe('read');
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining(job.prompt));
  });
});

function createJob(
  mindRoot: string,
  model: 'mindos-auto' | 'codex',
  permissionMode: 'read' | 'ask' = 'read',
) {
  const response = handleStudioAutomationsPost({
    action: 'create',
    draft: {
      title: `${model} job`,
      prompt: 'Do the work.',
      scope: 'mind',
      schedule: 'manual',
      model,
      effort: 'high',
      permissionMode,
    },
  }, { mindRoot, now: () => new Date('2026-09-03T00:00:00.000Z') });
  const id = 'automations' in response.body ? response.body.automations[0]!.id : '';
  return readStudioAutomationState(mindRoot).automations.find((job) => job.id === id)!;
}
