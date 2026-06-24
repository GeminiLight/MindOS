import { beforeEach, describe, expect, it, vi } from 'vitest';

const piState = vi.hoisted(() => ({
  bashRoot: '',
  nextSessionId: 'pi-session-1',
  continuedEntries: [] as unknown[],
  continuedContextMessages: [] as unknown[],
  managers: [] as Array<{
    kind: 'memory' | 'continued';
    cwd?: string;
    sessionDir?: string;
    appended: unknown[];
  }>,
  continueRecentCalls: [] as Array<{ cwd: string; sessionDir?: string }>,
  inMemoryCalls: [] as Array<{ cwd?: string }>,
}));

vi.mock('../../foundation/native-import.js', () => ({
  nativeImport: async () => ({
    createBashToolDefinition: (root: string) => {
      piState.bashRoot = root;
      return { name: 'bash' };
    },
    AuthStorage: {
      create: () => ({ setRuntimeApiKey: () => {} }),
    },
    ModelRegistry: {
      create: () => ({ registry: true }),
    },
    SettingsManager: {
      inMemory: (settings: unknown) => ({ settings }),
    },
    SessionManager: {
      inMemory: (cwd?: string) => {
        piState.inMemoryCalls.push({ cwd });
        const state = { kind: 'memory' as const, cwd, appended: [] as unknown[] };
        piState.managers.push(state);
        return {
          appendMessage: (message: unknown) => { state.appended.push(message); },
          buildSessionContext: () => ({ messages: [...state.appended] }),
          getEntries: () => [...state.appended],
          getSessionId: () => 'memory-session',
          getSessionDir: () => '',
          getSessionFile: () => undefined,
          isPersisted: () => false,
        };
      },
      continueRecent: (cwd: string, sessionDir?: string) => {
        piState.continueRecentCalls.push({ cwd, sessionDir });
        const state = {
          kind: 'continued' as const,
          cwd,
          sessionDir,
          appended: [] as unknown[],
        };
        piState.managers.push(state);
        return {
          appendMessage: (message: unknown) => { state.appended.push(message); },
          buildSessionContext: () => ({
            messages: piState.continuedContextMessages.length > 0
              ? [...piState.continuedContextMessages]
              : [...state.appended],
          }),
          getEntries: () => piState.continuedEntries.length > 0 ? [...piState.continuedEntries] : [...state.appended],
          getSessionId: () => piState.nextSessionId,
          getSessionDir: () => sessionDir,
          getSessionFile: () => sessionDir ? `${sessionDir}/session.jsonl` : undefined,
          isPersisted: () => true,
        };
      },
    },
    DefaultResourceLoader: class {
      async reload() {}
      getSkills() { return { skills: [] }; }
      getExtensions() { return { extensions: [], errors: [] }; }
    },
    createAgentSession: async () => ({
      session: {
        subscribe: () => {},
        prompt: async () => {},
        steer: async () => {},
        abort: async () => {},
      },
    }),
    convertToLlm: (messages: unknown[]) => messages,
  }),
}));

import { createMindosPiCodingAgentRuntime } from './runtime.js';

describe('MindOS Pi coding agent runtime', () => {
  beforeEach(() => {
    piState.bashRoot = '';
    piState.nextSessionId = 'pi-session-1';
    piState.continuedEntries = [];
    piState.continuedContextMessages = [];
    piState.managers = [];
    piState.continueRecentCalls = [];
    piState.inMemoryCalls = [];
  });

  it('creates the bash tool against the session workDir', async () => {
    await createMindosPiCodingAgentRuntime({
      messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      workDir: '/repo/app',
      agentConfig: {},
      serverSettings: {},
      allowProjectBash: true,
      hostServices: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
      },
    });

    expect(piState.bashRoot).toBe('/repo/app');
  });

  it('resumes a persisted Pi session without replaying UI transcript history', async () => {
    const compactedMessages = [{ role: 'user', content: 'runtime-owned compacted history' }];
    piState.continuedEntries = [{ type: 'compaction', id: 'cmp_1' }];
    piState.continuedContextMessages = compactedMessages;

    const runtime = await createMindosPiCodingAgentRuntime({
      messages: [
        { role: 'user', content: 'old user', timestamp: 1 },
        { role: 'assistant', content: 'old assistant', timestamp: 2 },
        { role: 'user', content: 'current user', timestamp: 3 },
      ],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      workDir: '/repo/app',
      runtimeSession: { sessionDir: '/home/test/.mindos/sessions/chat-1' },
      agentConfig: {},
      serverSettings: {},
      allowProjectBash: true,
      hostServices: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
      },
    });

    expect(piState.continueRecentCalls).toEqual([
      { cwd: '/repo/app', sessionDir: '/home/test/.mindos/sessions/chat-1' },
    ]);
    expect(piState.managers[0]?.appended).toEqual([]);
    expect(runtime.llmHistoryMessages).toEqual(compactedMessages);
    expect(runtime.runtimeSession).toMatchObject({
      externalSessionId: 'pi-session-1',
      sessionDir: '/home/test/.mindos/sessions/chat-1',
      resumed: true,
    });
  });

  it('bootstraps UI transcript history when the bound Pi session is empty', async () => {
    const runtime = await createMindosPiCodingAgentRuntime({
      messages: [
        { role: 'user', content: 'old user', timestamp: 1 },
        { role: 'assistant', content: 'old assistant', timestamp: 2 },
        { role: 'user', content: 'current user', timestamp: 3 },
      ],
      systemPrompt: 'prompt',
      projectRoot: '/repo',
      agentDir: '/home/test/.pi',
      mindRoot: '/mind',
      workDir: '/repo/app',
      runtimeSession: { sessionDir: '/home/test/.mindos/sessions/chat-1' },
      agentConfig: {},
      serverSettings: {},
      allowProjectBash: true,
      hostServices: {
        resolveModelConfig: () => ({
          model: { id: 'model-object' },
          modelName: 'gpt-test',
          apiKey: 'key',
          provider: 'openai',
        }),
        toRuntimeProvider: (provider) => provider,
      },
    });

    const appended = piState.managers[0]?.appended ?? [];
    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({ role: 'user', content: 'old user' });
    expect(appended[1]).toMatchObject({ role: 'assistant' });
    expect(JSON.stringify(appended[1])).toContain('old assistant');
    expect(JSON.stringify(appended)).not.toContain('current user');
    expect(runtime.llmHistoryMessages).toEqual(appended);
    expect(runtime.runtimeSession).toMatchObject({
      externalSessionId: 'pi-session-1',
      resumed: false,
    });
  });
});
