import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { runMindosPiAgentTurnSession } from './session.js';
import { installMindosProxyTransport } from './proxy-transport.js';

vi.mock('../../foundation/native-import.js', () => ({ nativeImport: () => import('@earendil-works/pi-ai/api/openai-completions') }));

afterEach(() => vi.unstubAllGlobals());

it.each([1, 8])('keeps tools, history and budget %i inside the real Pi session', async stepLimit => {
  const root = mkdtempSync(join(tmpdir(), 'mindos-proxy-session-'));
  let dispose: (() => void) | undefined;
  try {
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    let tools = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(_input, init);
      requests.push(await request.json());
      return new Response(JSON.stringify({ id: 'fake', object: 'chat.completion', created: 1, model: 'fake', choices: [{ index: 0,
        message: requests.length === 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'read_note', arguments: '{}' } }] }
          : { role: 'assistant', content: requests.length === 2 ? 'First answer.' : 'Second answer.' },
        finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }));
    }));
    const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    await modelRuntime.setRuntimeApiKey('openai', 'fake');
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
    await resourceLoader.reload();
    const sessionManager = SessionManager.create(root, join(root, 'sessions'));
    const { session } = await createAgentSession({ cwd: root, modelRuntime, settingsManager, resourceLoader, sessionManager, noTools: 'builtin',
      model: { id: 'fake', name: 'fake', api: 'openai-completions', provider: 'openai', baseUrl: 'https://proxy.invalid/v1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 },
      customTools: [{ name: 'read_note', label: 'Read note', description: 'Read', parameters: Type.Object({}), async execute() { tools++; return { content: [{ type: 'text', text: 'note contents' }], details: {} }; } }],
    });
    dispose = () => session.dispose();
    await installMindosProxyTransport(session);
    const events: string[] = [];
    session.subscribe(event => events.push(event.type));
    const result = await runMindosPiAgentTurnSession({ session, prompt: 'First question.', provider: 'openai', stepLimit, send: () => {} });
    if (stepLimit === 1) {
      expect(result.status).toBe('error'); expect(result.message).toMatch(/step limit/);
      expect(requests).toHaveLength(1); expect(tools).toBe(1);
      expect(JSON.stringify(sessionManager.buildSessionContext().messages)).toContain('note contents');
      return;
    }
    expect(result.status).toBe('completed');
    await session.prompt('Second question.');
    expect(tools).toBe(1);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[2]!.messages)).toContain('First answer.');
    expect(JSON.stringify(sessionManager.buildSessionContext().messages)).toContain('Second answer.');
    expect(events).toContain('tool_execution_start');
    expect(events).toContain('tool_execution_end');
  } finally { dispose?.(); rmSync(root, { recursive: true, force: true }); }
});
