import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_ASK_USER_QUESTION_TOOL,
  CLAUDE_PERMISSION_PROMPT_SERVER,
  CLAUDE_PERMISSION_PROMPT_TOOL,
  CLAUDE_PERMISSION_PROMPT_TOOL_REF,
  createClaudePermissionPromptConfig,
  resolveRuntimePermissionBaseUrl,
} from '@/lib/agent/claude-permission-prompt';

let child: ReturnType<typeof spawn> | null = null;

afterEach(() => {
  child?.kill();
  child = null;
});

function withRuntimeBaseUrlEnv<T>(
  env: Partial<Record<'MINDOS_INTERNAL_URL' | 'MINDOS_URL' | 'MINDOS_WEB_PORT', string>>,
  run: () => T,
): T {
  const previous = {
    MINDOS_INTERNAL_URL: process.env.MINDOS_INTERNAL_URL,
    MINDOS_URL: process.env.MINDOS_URL,
    MINDOS_WEB_PORT: process.env.MINDOS_WEB_PORT,
  };
  try {
    for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
      const next = env[key];
      if (next === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = next;
      }
    }
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof previous];
      } else {
        process.env[key as keyof typeof previous] = value;
      }
    }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

async function startBridgeServer(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Bridge test server did not expose a TCP address.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function readJsonLine(lines: ReturnType<typeof createInterface>): Promise<Record<string, unknown>> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Timed out waiting for MCP response.')), 5000);
  });
  return await Promise.race([
    (async () => {
      while (true) {
        const [line] = await once(lines, 'line') as [string];
        if (!line.trim()) continue;
        return JSON.parse(line) as Record<string, unknown>;
      }
    })(),
    timeout,
  ]);
}

describe('Claude Code permission prompt MCP config', () => {
  it('creates a per-run stdio MCP server that lists the permission tool', async () => {
    const prompt = createClaudePermissionPromptConfig({
      runId: 'run-mcp',
      baseUrl: 'http://127.0.0.1:4567',
    });
    expect(prompt.toolName).toBe(CLAUDE_PERMISSION_PROMPT_TOOL_REF);
    expect(prompt.toolName).not.toBe(CLAUDE_PERMISSION_PROMPT_TOOL);
    const mcpConfig = prompt.mcpConfig as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(Object.keys(mcpConfig.mcpServers)).toContain(CLAUDE_PERMISSION_PROMPT_SERVER);
    const server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];

    child = spawn(server.command, server.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.env },
    });
    const lines = createInterface({ input: child.stdout });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    })}\n`);
    const init = await readJsonLine(lines);
    expect(init).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'mindos-runtime-permission' },
      },
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })}\n`);
    const tools = await readJsonLine(lines);
    expect(tools).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          { name: CLAUDE_PERMISSION_PROMPT_TOOL },
          { name: CLAUDE_ASK_USER_QUESTION_TOOL },
        ],
      },
    });
  });

  it('prefers MINDOS_INTERNAL_URL for server-to-self callbacks', () => {
    withRuntimeBaseUrlEnv({
      MINDOS_INTERNAL_URL: 'http://127.0.0.1:9999',
      MINDOS_URL: 'https://mindos.example.com',
      MINDOS_WEB_PORT: '4567',
    }, () => {
      expect(resolveRuntimePermissionBaseUrl(new Request('https://21.6.243.108/api/agent/sessions/test-session/turns'))).toBe('http://127.0.0.1:9999');
    });
  });

  it('keeps MINDOS_URL as the explicit fallback override', () => {
    withRuntimeBaseUrlEnv({
      MINDOS_URL: 'https://mindos.example.com',
    }, () => {
      expect(resolveRuntimePermissionBaseUrl(new Request('https://21.6.243.108:4567/api/agent/sessions/test-session/turns'))).toBe('https://mindos.example.com');
    });
  });

  it('uses an http loopback URL from MINDOS_WEB_PORT before the external request port', () => {
    withRuntimeBaseUrlEnv({
      MINDOS_WEB_PORT: '4567',
    }, () => {
      expect(resolveRuntimePermissionBaseUrl(new Request('https://21.6.243.108:443/api/agent/sessions/test-session/turns'))).toBe('http://127.0.0.1:4567');
    });
  });

  it('uses an http loopback URL when the request has a port', () => {
    withRuntimeBaseUrlEnv({}, () => {
      expect(resolveRuntimePermissionBaseUrl(new Request('https://21.6.243.108:4567/api/agent/sessions/test-session/turns'))).toBe('http://127.0.0.1:4567');
    });
  });

  it('does not use an arbitrary external request origin for runtime callbacks', () => {
    withRuntimeBaseUrlEnv({}, () => {
      expect(() => resolveRuntimePermissionBaseUrl(new Request('https://mindos.example.com/api/agent/sessions/test-session/turns'))).toThrow(
        'Claude Code permission callbacks require MINDOS_INTERNAL_URL',
      );
    });
  });

  it('returns a JSON-RPC error response when the permission bridge request fails', async () => {
    const prompt = createClaudePermissionPromptConfig({
      runId: 'run-mcp',
      baseUrl: 'http://127.0.0.1:9',
    });
    const mcpConfig = prompt.mcpConfig as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];

    child = spawn(server.command, server.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.env },
    });
    const lines = createInterface({ input: child.stdout });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: CLAUDE_PERMISSION_PROMPT_TOOL,
        arguments: { toolName: 'Bash', input: { command: 'rm note.md' } },
      },
    })}\n`);

    const response = await readJsonLine(lines);
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: -32000,
      },
    });
    expect((response.error as { message?: string }).message).toMatch(/fetch|connect|ECONNREFUSED|failed/i);
  });

  it('times out a hung permission bridge request instead of hanging forever', async () => {
    // A bridge that accepts the request but never responds — a wedged web
    // process must not leave the runtime blocked on the permission prompt.
    let hungResponse: ServerResponse | null = null;
    const bridge = await startBridgeServer((_req, res) => {
      hungResponse = res;
    });

    const previousTimeout = process.env.MINDOS_RUNTIME_PERMISSION_FETCH_TIMEOUT_MS;
    process.env.MINDOS_RUNTIME_PERMISSION_FETCH_TIMEOUT_MS = '500';
    let server: { command: string; args: string[]; env: Record<string, string> };
    try {
      const prompt = createClaudePermissionPromptConfig({
        runId: 'run-timeout',
        baseUrl: bridge.baseUrl,
      });
      const mcpConfig = prompt.mcpConfig as {
        mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
      };
      server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];
      expect(server.env.MINDOS_RUNTIME_PERMISSION_FETCH_TIMEOUT_MS).toBe('500');
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.MINDOS_RUNTIME_PERMISSION_FETCH_TIMEOUT_MS;
      } else {
        process.env.MINDOS_RUNTIME_PERMISSION_FETCH_TIMEOUT_MS = previousTimeout;
      }
    }

    try {
      child = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });
      const lines = createInterface({ input: child.stdout! });

      child.stdin!.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: CLAUDE_PERMISSION_PROMPT_TOOL,
          arguments: { toolName: 'Bash', input: { command: 'rm note.md' } },
        },
      })}\n`);

      // Must surface a JSON-RPC error well before the harness 5s deadline.
      const response = await readJsonLine(lines);
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 4,
        error: { code: -32000 },
      });
      expect((response.error as { message?: string }).message).toMatch(/timeout|timed out|abort/i);
    } finally {
      (hungResponse as ServerResponse | null)?.destroy();
      await bridge.close();
    }
  });

  it('bridges permission tool calls from stdio MCP to the MindOS runtime permission API', async () => {
    let capturedBody: unknown;
    const bridge = await startBridgeServer(async (req, res) => {
      expect(req.url).toBe('/api/agent/runtime-permission/request');
      capturedBody = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'accept', cancelled: false }));
    });

    try {
      const prompt = createClaudePermissionPromptConfig({
        runId: 'run-mcp-http',
        baseUrl: bridge.baseUrl,
      });
      const mcpConfig = prompt.mcpConfig as {
        mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
      };
      const server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];

      child = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });
      const lines = createInterface({ input: child.stdout });

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: CLAUDE_PERMISSION_PROMPT_TOOL,
          arguments: {
            toolUseId: 'toolu-bridge-1',
            toolName: 'Bash',
            input: { command: 'echo ok' },
            reason: 'Run a harmless command',
          },
        },
      })}\n`);

      const response = await readJsonLine(lines);
      expect(capturedBody).toMatchObject({
        runId: 'run-mcp-http',
        runtime: 'claude',
        toolCallId: 'toolu-bridge-1',
        toolName: 'Bash',
        input: { command: 'echo ok' },
        reason: 'Run a harmless command',
      });
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 10,
        result: {
          content: [
            { type: 'text' },
          ],
        },
      });
      const text = (response.result as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text)).toEqual({
        behavior: 'allow',
        updatedInput: { command: 'echo ok' },
      });
      expect(response.result).not.toHaveProperty('structuredContent');
    } finally {
      await bridge.close();
    }
  });

  it('passes the MindOS API bearer token from the per-run MCP bridge when AUTH_TOKEN is configured', async () => {
    const previousAuthToken = process.env.AUTH_TOKEN;
    process.env.AUTH_TOKEN = 'runtime-bridge-secret';
    let capturedAuthorization = '';
    const bridge = await startBridgeServer(async (req, res) => {
      expect(req.url).toBe('/api/agent/runtime-permission/request');
      capturedAuthorization = req.headers.authorization ?? '';
      await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'accept', cancelled: false }));
    });

    try {
      const prompt = createClaudePermissionPromptConfig({
        runId: 'run-mcp-auth-http',
        baseUrl: bridge.baseUrl,
      });
      const mcpConfig = prompt.mcpConfig as {
        mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
      };
      const server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];
      expect(server.env.MINDOS_RUNTIME_PERMISSION_AUTH_TOKEN).toBe('runtime-bridge-secret');

      child = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });
      const lines = createInterface({ input: child.stdout });

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: CLAUDE_PERMISSION_PROMPT_TOOL,
          arguments: {
            toolUseId: 'toolu-auth-bridge',
            toolName: 'Bash',
            input: { command: 'echo ok' },
          },
        },
      })}\n`);

      const response = await readJsonLine(lines);
      expect(capturedAuthorization).toBe('Bearer runtime-bridge-secret');
      expect(response).toMatchObject({ jsonrpc: '2.0', id: 13 });
    } finally {
      if (previousAuthToken === undefined) {
        delete process.env.AUTH_TOKEN;
      } else {
        process.env.AUTH_TOKEN = previousAuthToken;
      }
      await bridge.close();
    }
  });

  it('bridges AskUserQuestion tool calls from stdio MCP to the MindOS question API', async () => {
    let capturedBody: unknown;
    const bridge = await startBridgeServer(async (req, res) => {
      expect(req.url).toBe('/api/agent/user-question/request');
      capturedBody = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        cancelled: false,
        answers: [{ questionIndex: 0, question: 'Which path?', kind: 'option', answer: 'Bridge' }],
      }));
    });

    try {
      const prompt = createClaudePermissionPromptConfig({
        runId: 'run-question-http',
        baseUrl: bridge.baseUrl,
      });
      const mcpConfig = prompt.mcpConfig as {
        mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
      };
      const server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];

      child = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });
      const lines = createInterface({ input: child.stdout });

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: CLAUDE_ASK_USER_QUESTION_TOOL,
          arguments: {
            toolCallId: 'question-1',
            questions: [
              {
                question: 'Which path?',
                header: 'Path',
                options: [
                  { label: 'Bridge', description: 'Use the upstream tool through MindOS UI.' },
                  { label: 'Fork', description: 'Copy the tool locally.' },
                ],
              },
            ],
          },
        },
      })}\n`);

      const response = await readJsonLine(lines);
      expect(capturedBody).toMatchObject({
        runId: 'run-question-http',
        params: {
          questions: [
            {
              question: 'Which path?',
              header: 'Path',
            },
          ],
        },
      });
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 11,
        result: {
          content: [
            { type: 'text' },
          ],
        },
      });
      const text = (response.result as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text)).toEqual({
        cancelled: false,
        answers: [{ questionIndex: 0, question: 'Which path?', kind: 'option', answer: 'Bridge' }],
      });
      expect(response.result).not.toHaveProperty('structuredContent');
    } finally {
      await bridge.close();
    }
  });

  it('handles Claude Code AskUserQuestion permission prompts by returning answers in updatedInput', async () => {
    let capturedBody: unknown;
    const bridge = await startBridgeServer(async (req, res) => {
      expect(req.url).toBe('/api/agent/user-question/request');
      capturedBody = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        cancelled: false,
        answers: [{ questionIndex: 0, question: 'Pick response token', kind: 'option', answer: 'Beta' }],
      }));
    });

    try {
      const prompt = createClaudePermissionPromptConfig({
        runId: 'run-question-permission-http',
        baseUrl: bridge.baseUrl,
      });
      const mcpConfig = prompt.mcpConfig as {
        mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
      };
      const server = mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];

      child = spawn(server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...server.env },
      });
      const lines = createInterface({ input: child.stdout });

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: CLAUDE_PERMISSION_PROMPT_TOOL,
          arguments: {
            toolUseId: 'question-permission-1',
            toolName: CLAUDE_ASK_USER_QUESTION_TOOL,
            input: {
              questions: [
                {
                  question: 'Pick response token',
                  header: 'Token',
                  options: [
                    { label: 'Alpha', description: 'Reply Alpha' },
                    { label: 'Beta', description: 'Reply Beta' },
                  ],
                },
              ],
            },
          },
        },
      })}\n`);

      const response = await readJsonLine(lines);
      expect(capturedBody).toMatchObject({
        runId: 'run-question-permission-http',
        toolCallId: 'question-permission-1',
        params: {
          questions: [
            {
              question: 'Pick response token',
              header: 'Token',
            },
          ],
        },
      });
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 12,
        result: {
          content: [
            { type: 'text' },
          ],
        },
      });
      const text = (response.result as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text)).toEqual({
        behavior: 'allow',
        updatedInput: {
          questions: [
            {
              question: 'Pick response token',
              header: 'Token',
              options: [
                { label: 'Alpha', description: 'Reply Alpha' },
                { label: 'Beta', description: 'Reply Beta' },
              ],
            },
          ],
          answers: {
            'Pick response token': 'Beta',
          },
        },
      });
      expect(response.result).not.toHaveProperty('structuredContent');
    } finally {
      await bridge.close();
    }
  });
});

describe('Claude Code permission shim shared option shaping and acceptForSession', () => {
  function shimServer(input: { runId: string; baseUrl: string }) {
    const prompt = createClaudePermissionPromptConfig(input);
    const mcpConfig = prompt.mcpConfig as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    return mcpConfig.mcpServers[CLAUDE_PERMISSION_PROMPT_SERVER];
  }

  async function spawnShim(server: { command: string; args: string[]; env: Record<string, string> }) {
    child = spawn(server.command, server.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.env },
    });
    const lines = createInterface({ input: child.stdout! });
    let nextId = 100;
    return {
      async callTool(toolName: string, args: Record<string, unknown>) {
        const id = nextId++;
        child!.stdin!.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: CLAUDE_PERMISSION_PROMPT_TOOL, arguments: { toolName, ...args } },
        })}\n`);
        const response = await readJsonLine(lines);
        const text = (response.result as { content: Array<{ text: string }> }).content[0].text;
        return { id, response, value: JSON.parse(text) as Record<string, unknown> };
      },
    };
  }

  it('offers the shared three-option set including acceptForSession', async () => {
    let capturedBody: Record<string, any> | null = null;
    const bridge = await startBridgeServer(async (req, res) => {
      capturedBody = await readBody(req) as Record<string, any>;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'decline', cancelled: false, decisionIntent: 'deny' }));
    });
    try {
      const server = shimServer({ runId: 'run-options', baseUrl: bridge.baseUrl });
      expect(JSON.parse(server.env.MINDOS_RUNTIME_PERMISSION_OPTIONS)).toEqual([
        { id: 'accept', label: 'Allow once', description: 'Run this action one time.', intent: 'allow', scope: 'once' },
        { id: 'acceptForSession', label: 'Allow for session', description: 'Allow matching actions for the rest of this session.', intent: 'allow', scope: 'session' },
        { id: 'decline', label: 'Deny', description: 'Reject this action.', intent: 'deny' },
      ]);
      const shim = await spawnShim(server);
      const { value } = await shim.callTool('Bash', { toolUseId: 'toolu-opt-1', input: { command: 'ls' } });
      expect(capturedBody?.options).toEqual(JSON.parse(server.env.MINDOS_RUNTIME_PERMISSION_OPTIONS));
      expect(value).toEqual({ behavior: 'deny', message: 'Denied in MindOS.' });
    } finally {
      await bridge.close();
    }
  });

  it('treats an acceptForSession decision as allow and caches the tool for the shim session', async () => {
    let bridgeHits = 0;
    const bridge = await startBridgeServer(async (req, res) => {
      bridgeHits += 1;
      await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        decision: 'acceptForSession',
        cancelled: false,
        decisionLabel: 'Allow for session',
        decisionIntent: 'allow',
        decisionScope: 'session',
      }));
    });
    try {
      const shim = await spawnShim(shimServer({ runId: 'run-session-allow', baseUrl: bridge.baseUrl }));
      const first = await shim.callTool('Bash', { toolUseId: 'toolu-session-1', input: { command: 'ls' } });
      expect(first.value).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
      expect(bridgeHits).toBe(1);

      // Same tool: served from the shim's session cache, no bridge round-trip.
      const second = await shim.callTool('Bash', { toolUseId: 'toolu-session-2', input: { command: 'rm note.md' } });
      expect(second.value).toEqual({ behavior: 'allow', updatedInput: { command: 'rm note.md' } });
      expect(bridgeHits).toBe(1);

      // A different tool still asks.
      await shim.callTool('Write', { toolUseId: 'toolu-session-3', input: { path: 'a.md' } });
      expect(bridgeHits).toBe(2);
    } finally {
      await bridge.close();
    }
  });

  it('does not cache accept-once or deny decisions', async () => {
    const decisions = [
      { decision: 'accept', cancelled: false, decisionIntent: 'allow', decisionScope: 'once' },
      { decision: 'accept', cancelled: false, decisionIntent: 'allow', decisionScope: 'once' },
      { decision: 'decline', cancelled: false, decisionIntent: 'deny' },
      { decision: 'accept', cancelled: false, decisionIntent: 'allow', decisionScope: 'once' },
    ];
    let bridgeHits = 0;
    const bridge = await startBridgeServer(async (req, res) => {
      await readBody(req);
      const decision = decisions[Math.min(bridgeHits, decisions.length - 1)];
      bridgeHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(decision));
    });
    try {
      const shim = await spawnShim(shimServer({ runId: 'run-no-cache', baseUrl: bridge.baseUrl }));
      const first = await shim.callTool('Bash', { toolUseId: 'toolu-once-1', input: { command: 'ls' } });
      expect(first.value).toMatchObject({ behavior: 'allow' });
      const second = await shim.callTool('Bash', { toolUseId: 'toolu-once-2', input: { command: 'ls' } });
      expect(second.value).toMatchObject({ behavior: 'allow' });
      expect(bridgeHits).toBe(2);
      const third = await shim.callTool('Bash', { toolUseId: 'toolu-deny-1', input: { command: 'rm x' } });
      expect(third.value).toEqual({ behavior: 'deny', message: 'Denied in MindOS.' });
      const fourth = await shim.callTool('Bash', { toolUseId: 'toolu-after-deny', input: { command: 'ls' } });
      expect(fourth.value).toMatchObject({ behavior: 'allow' });
      expect(bridgeHits).toBe(4);
    } finally {
      await bridge.close();
    }
  });

  it('allows when the bridge answers with a bare allow intent (no decision id match)', async () => {
    const bridge = await startBridgeServer(async (req, res) => {
      await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'custom-allow', cancelled: false, decisionIntent: 'allow' }));
    });
    try {
      const shim = await spawnShim(shimServer({ runId: 'run-intent-allow', baseUrl: bridge.baseUrl }));
      const { value } = await shim.callTool('Bash', { toolUseId: 'toolu-intent-1', input: { command: 'ls' } });
      expect(value).toMatchObject({ behavior: 'allow' });
    } finally {
      await bridge.close();
    }
  });
});
