import { json, noContent, type MindosServerResponse } from '../response.js';

export type A2aJsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

export type A2aJsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type A2aPostInput = {
  contentLength?: number;
  body?: unknown;
  parseError?: boolean;
};

export type A2aServices = {
  handleSendMessage?(params: unknown): Promise<unknown>;
  handleGetTask?(params: unknown): unknown | null;
  handleCancelTask?(params: unknown): { task: unknown | null; reason: 'canceled' | 'not_found' | 'not_cancelable' };
  getDiscoveredAgents?(): unknown[];
  getDelegationHistory?(): unknown[];
  discoverAgent?(url: string): Promise<unknown | null>;
};

const MAX_REQUEST_BYTES = 100_000;

const A2A_ERRORS = {
  TASK_NOT_FOUND: { code: -32001, message: 'Task not found' },
  TASK_NOT_CANCELABLE: { code: -32002, message: 'Task not cancelable' },
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
} as const;

const A2A_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, A2A-Version',
};

const MAX_DISCOVERY_URL_LENGTH = 2048;

export async function handleA2aPost(
  input: A2aPostInput,
  services: A2aServices = {},
): Promise<MindosServerResponse<A2aJsonRpcResponse>> {
  if ((input.contentLength ?? 0) > MAX_REQUEST_BYTES) {
    return respond(jsonRpcError(null, { code: -32600, message: `Request too large (max ${MAX_REQUEST_BYTES} bytes)` }), 413);
  }

  if (input.parseError) {
    return respond(jsonRpcError(null, A2A_ERRORS.PARSE_ERROR), 400);
  }

  const rpc = input.body && typeof input.body === 'object' ? input.body as A2aJsonRpcRequest : {};
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.INVALID_REQUEST), 400);
  }

  try {
    switch (rpc.method) {
      case 'SendMessage': {
        if (!hasMessageParts(rpc.params)) {
          return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.INVALID_PARAMS));
        }
        const handleSendMessage = services.handleSendMessage ?? defaultHandleSendMessage;
        return respond(jsonRpcOk(getRpcId(rpc), await handleSendMessage(rpc.params)));
      }

      case 'GetTask': {
        if (!hasStringId(rpc.params)) {
          return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.INVALID_PARAMS));
        }
        const handleGetTask = services.handleGetTask ?? defaultHandleGetTask;
        const task = handleGetTask(rpc.params);
        if (!task) return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.TASK_NOT_FOUND));
        return respond(jsonRpcOk(getRpcId(rpc), task));
      }

      case 'CancelTask': {
        if (!hasStringId(rpc.params)) {
          return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.INVALID_PARAMS));
        }
        const handleCancelTask = services.handleCancelTask ?? defaultHandleCancelTask;
        const { task, reason } = handleCancelTask(rpc.params);
        if (reason === 'not_found') return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.TASK_NOT_FOUND));
        if (reason === 'not_cancelable') return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.TASK_NOT_CANCELABLE));
        return respond(jsonRpcOk(getRpcId(rpc), task));
      }

      default:
        return respond(jsonRpcError(getRpcId(rpc), A2A_ERRORS.METHOD_NOT_FOUND));
    }
  } catch (error) {
    return respond(jsonRpcError(getRpcId(rpc), {
      ...A2A_ERRORS.INTERNAL_ERROR,
      data: error instanceof Error ? error.message : String(error),
    }), 500);
  }
}

export function handleA2aOptions(): MindosServerResponse<undefined> {
  return noContent(A2A_CORS_HEADERS);
}

export function handleA2aAgentsGet(
  services: A2aServices = {},
): MindosServerResponse<{ agents: unknown[] }> {
  return json({ agents: services.getDiscoveredAgents?.() ?? [] });
}

export function handleA2aDelegationsGet(
  services: A2aServices = {},
): MindosServerResponse<{ delegations: unknown[] }> {
  return json({ delegations: services.getDelegationHistory?.() ?? [] });
}

export async function handleA2aDiscoverPost(
  body: unknown,
  services: A2aServices = {},
): Promise<MindosServerResponse<{ agent: unknown | null } | { error: string; agent?: null }>> {
  const payload = body && typeof body === 'object' ? body as { url?: unknown } : {};
  if (!payload.url || typeof payload.url !== 'string') {
    return json({ error: 'URL is required' }, { status: 400 });
  }
  const url = payload.url.trim();
  if (!isValidDiscoveryUrl(url)) {
    return json({ error: 'Invalid URL', agent: null }, { status: 400 });
  }

  const discoverAgent = services.discoverAgent ?? defaultDiscoverAgent;
  const agent = await discoverAgent(url);
  if (!agent) {
    return json({ error: 'No A2A agent found', agent: null });
  }
  return json({ agent });
}

function respond(body: A2aJsonRpcResponse, status = 200): MindosServerResponse<A2aJsonRpcResponse> {
  return json(body, { status, headers: A2A_CORS_HEADERS });
}

function jsonRpcOk(id: string | number | null, result: unknown): A2aJsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, error: { code: number; message: string; data?: unknown }): A2aJsonRpcResponse {
  return { jsonrpc: '2.0', id, error };
}

function getRpcId(rpc: A2aJsonRpcRequest): string | number | null {
  return typeof rpc.id === 'string' || typeof rpc.id === 'number' ? rpc.id : null;
}

function hasMessageParts(params: unknown): boolean {
  const message = params && typeof params === 'object' ? (params as { message?: { parts?: unknown[] } }).message : undefined;
  return Array.isArray(message?.parts) && message.parts.length > 0;
}

function hasStringId(params: unknown): boolean {
  return Boolean(params && typeof params === 'object' && typeof (params as { id?: unknown }).id === 'string' && (params as { id: string }).id);
}

async function defaultHandleSendMessage(): Promise<unknown> {
  throw new Error('A2A SendMessage service is not configured');
}

function defaultHandleGetTask(): null {
  return null;
}

function defaultHandleCancelTask(): { task: null; reason: 'not_found' } {
  return { task: null, reason: 'not_found' };
}

async function defaultDiscoverAgent(): Promise<null> {
  return null;
}

function isValidDiscoveryUrl(input: string): boolean {
  if (!input || input.length > MAX_DISCOVERY_URL_LENGTH) return false;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}
