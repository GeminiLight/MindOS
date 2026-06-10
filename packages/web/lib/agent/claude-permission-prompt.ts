import type { ClaudeCodeCliPermissionPrompt } from '@geminilight/mindos/agent-runtime';

export const CLAUDE_PERMISSION_PROMPT_SERVER = 'mindos_runtime_permission';
export const CLAUDE_PERMISSION_PROMPT_TOOL = 'mindos_runtime_permission';
export const CLAUDE_PERMISSION_PROMPT_TOOL_REF = `mcp__${CLAUDE_PERMISSION_PROMPT_SERVER}__${CLAUDE_PERMISSION_PROMPT_TOOL}`;
export const CLAUDE_ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

export function createClaudePermissionPromptConfig(input: {
  runId: string;
  baseUrl: string;
}): ClaudeCodeCliPermissionPrompt {
  return {
    toolName: CLAUDE_PERMISSION_PROMPT_TOOL_REF,
    mcpConfig: {
      mcpServers: {
        [CLAUDE_PERMISSION_PROMPT_SERVER]: {
          type: 'stdio',
          command: process.execPath,
          args: ['-e', CLAUDE_PERMISSION_PROMPT_MCP_SOURCE],
          env: {
            MINDOS_RUNTIME_PERMISSION_BASE_URL: input.baseUrl,
            MINDOS_RUNTIME_PERMISSION_RUN_ID: input.runId,
            MINDOS_RUNTIME_PERMISSION_TOOL: CLAUDE_PERMISSION_PROMPT_TOOL,
            MINDOS_ASK_USER_QUESTION_TOOL: CLAUDE_ASK_USER_QUESTION_TOOL,
            ...(process.env.AUTH_TOKEN ? { MINDOS_RUNTIME_PERMISSION_AUTH_TOKEN: process.env.AUTH_TOKEN } : {}),
          },
        },
      },
    },
  };
}

export function resolveRuntimePermissionBaseUrl(req: Request): string {
  if (process.env.MINDOS_INTERNAL_URL) return process.env.MINDOS_INTERNAL_URL;
  if (process.env.MINDOS_URL) return process.env.MINDOS_URL;
  const url = new URL(req.url);
  if (process.env.MINDOS_WEB_PORT) return `http://127.0.0.1:${process.env.MINDOS_WEB_PORT}`;
  if (url.port) return `http://127.0.0.1:${url.port}`;
  if (!isTrustedRuntimePermissionOrigin(url)) {
    throw new Error('Claude Code permission callbacks require MINDOS_INTERNAL_URL, MINDOS_URL, MINDOS_WEB_PORT, or a loopback/private request origin.');
  }
  return url.origin;
}

function isTrustedRuntimePermissionOrigin(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 169 && second === 254) return true;
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

const CLAUDE_PERMISSION_PROMPT_MCP_SOURCE = String.raw`
const baseUrl = process.env.MINDOS_RUNTIME_PERMISSION_BASE_URL;
const runId = process.env.MINDOS_RUNTIME_PERMISSION_RUN_ID;
const authToken = process.env.MINDOS_RUNTIME_PERMISSION_AUTH_TOKEN;
const permissionToolName = process.env.MINDOS_RUNTIME_PERMISSION_TOOL || 'mindos_runtime_permission';
const askUserQuestionToolName = process.env.MINDOS_ASK_USER_QUESTION_TOOL || 'AskUserQuestion';
let buffer = '';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendError(id, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (id === undefined || id === null) {
    process.stderr.write(message + '\n');
    return;
  }
  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32000, message },
  });
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function getNestedRecord(record, key) {
  return isRecord(record[key]) ? record[key] : undefined;
}

function extractToolInput(args) {
  if (!isRecord(args)) return {};
  return args.input
    ?? args.tool_input
    ?? args.toolInput
    ?? args.parameters
    ?? getNestedRecord(args, 'tool')?.input
    ?? args;
}

function extractQuestionsInput(args) {
  if (!isRecord(args)) return { questions: [] };
  if (Array.isArray(args.questions)) return { questions: args.questions };
  if (isRecord(args.input) && Array.isArray(args.input.questions)) return { questions: args.input.questions };
  if (isRecord(args.params) && Array.isArray(args.params.questions)) return { questions: args.params.questions };
  if (isRecord(args.arguments) && Array.isArray(args.arguments.questions)) return { questions: args.arguments.questions };
  return args;
}

function shortToolName(name) {
  if (typeof name !== 'string') return '';
  const parts = name.split('__');
  return parts[parts.length - 1] || name;
}

function extractToolName(args) {
  if (!isRecord(args)) return 'approval_request';
  return firstString(
    args.toolName,
    args.tool_name,
    args.name,
    getNestedRecord(args, 'tool')?.name,
    getNestedRecord(args, 'tool')?.toolName,
  ) || 'approval_request';
}

function fallbackToolCallId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function extractToolCallId(args, prefix) {
  if (!isRecord(args)) return fallbackToolCallId(prefix);
  return firstString(
    args.toolUseId,
    args.tool_use_id,
    args.tool_call_id,
    args.toolCallId,
    args.id,
    getNestedRecord(args, 'tool')?.id,
  ) || fallbackToolCallId(prefix);
}

function extractReason(args) {
  if (!isRecord(args)) return undefined;
  return firstString(args.reason, args.message, args.description, args.decision_reason, args.decisionReason);
}

async function requestDecision(args) {
  if (!baseUrl || !runId) return { decision: 'cancel', cancelled: true };
  const input = extractToolInput(args);
  const response = await fetch(new URL('/api/ask/runtime-permission/request', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}),
    },
    body: JSON.stringify({
      runId,
      runtime: 'claude',
      toolCallId: extractToolCallId(args, 'claude-permission'),
      toolName: extractToolName(args),
      input,
      reason: extractReason(args),
      options: [
        { id: 'accept', label: 'Allow once', description: 'Run this action one time.', intent: 'allow' },
        { id: 'decline', label: 'Deny', description: 'Reject this action.', intent: 'deny' },
      ],
    }),
  });
  if (!response.ok) return { decision: 'cancel', cancelled: true };
  return await response.json();
}

async function requestUserQuestion(args, requestId) {
  if (!baseUrl || !runId) return { answers: [], cancelled: true, error: 'no_bridge' };
  const response = await fetch(new URL('/api/ask/user-question/request', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}),
    },
    body: JSON.stringify({
      runId,
      toolCallId: extractToolCallId(args, 'claude-question-' + String(requestId ?? Date.now())),
      params: extractQuestionsInput(args),
    }),
  });
  if (!response.ok) return { answers: [], cancelled: true, error: 'request_failed' };
  return await response.json();
}

function answerValue(answer) {
  if (!isRecord(answer)) return undefined;
  if (Array.isArray(answer.selected) && answer.selected.length > 0) {
    const selected = answer.selected.filter((item) => typeof item === 'string' && item.trim());
    if (selected.length > 0) return selected;
  }
  if (typeof answer.answer === 'string' && answer.answer.trim()) return answer.answer;
  if (typeof answer.notes === 'string' && answer.notes.trim()) return answer.notes;
  return undefined;
}

function askUserQuestionPermissionResult(args, result) {
  const params = extractQuestionsInput(args);
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const answers = {};

  if (isRecord(result) && Array.isArray(result.answers)) {
    for (const answer of result.answers) {
      if (!isRecord(answer)) continue;
      const index = typeof answer.questionIndex === 'number' ? answer.questionIndex : -1;
      const question = firstString(
        answer.question,
        isRecord(questions[index]) ? questions[index].question : undefined,
      );
      const value = answerValue(answer);
      if (question && value !== undefined) answers[question] = value;
    }
  }

  if (isRecord(result) && result.cancelled === true) {
    return { behavior: 'deny', message: 'The user did not answer the questions.' };
  }
  if (Object.keys(answers).length === 0) {
    return { behavior: 'deny', message: 'The user did not answer the questions.' };
  }

  return {
    behavior: 'allow',
    updatedInput: {
      questions,
      answers,
    },
  };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mindos-runtime-permission', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: permissionToolName,
            title: 'MindOS Runtime Permission',
            description: 'Ask the MindOS Chat Panel user to approve or deny this Claude Code tool call.',
            inputSchema: { type: 'object', additionalProperties: true },
          },
          {
            name: askUserQuestionToolName,
            title: 'Ask User Question',
            description: 'Ask the MindOS Chat Panel user one or more structured questions and wait for the answer.',
            inputSchema: {
              type: 'object',
              additionalProperties: true,
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      question: { type: 'string' },
                      header: { type: 'string' },
                      multiSelect: { type: 'boolean' },
                      options: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: true,
                          properties: {
                            label: { type: 'string' },
                            description: { type: 'string' },
                            preview: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
    return;
  }
  if (method === 'tools/call') {
    const name = typeof params?.name === 'string' ? params.name : '';
    const args = params?.arguments ?? {};
    if (shortToolName(name) === askUserQuestionToolName) {
      const value = await requestUserQuestion(args, id);
      send({ jsonrpc: '2.0', id, result: textResult(value) });
      return;
    }

    const toolName = extractToolName(args);
    if (shortToolName(toolName) === askUserQuestionToolName) {
      const questionResult = await requestUserQuestion(args, id);
      send({ jsonrpc: '2.0', id, result: textResult(askUserQuestionPermissionResult(args, questionResult)) });
      return;
    }

    const decision = await requestDecision(args);
    const allow = decision && !decision.cancelled && decision.decision === 'accept';
    const value = allow
      ? { behavior: 'allow', updatedInput: extractToolInput(args) }
      : { behavior: 'deny', message: 'Denied in MindOS.' };
    send({ jsonrpc: '2.0', id, result: textResult(value) });
    return;
  }
  if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found: ' + method },
    });
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (line.trim()) {
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        sendError(undefined, error);
        index = buffer.indexOf('\n');
        continue;
      }
      Promise.resolve()
        .then(() => handleRequest(message))
        .catch((error) => {
          sendError(message?.id, error);
        });
    }
    index = buffer.indexOf('\n');
  }
});
`;
