export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { JsonRpcRequest, JsonRpcResponse, SendMessageParams, GetTaskParams, CancelTaskParams } from '@/lib/a2a/types';
import { A2A_ERRORS } from '@/lib/a2a/types';
import { handleSendMessage, handleGetTask, handleCancelTask } from '@/lib/a2a/task-handler';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, A2A-Version',
};

function jsonRpcOk(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, error: { code: number; message: string; data?: unknown }): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error };
}

function respond(body: JsonRpcResponse, status = 200) {
  const res = NextResponse.json(body, { status });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

const MAX_REQUEST_BYTES = 100_000; // 100KB max request body

export async function POST(req: NextRequest) {
  // Check content length to prevent OOM from oversized payloads
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return respond(jsonRpcError(null, { code: -32600, message: `Request too large (max ${MAX_REQUEST_BYTES} bytes)` }), 413);
  }

  // Parse JSON-RPC request
  let rpc: JsonRpcRequest;
  try {
    rpc = await req.json();
  } catch {
    return respond(jsonRpcError(null, A2A_ERRORS.PARSE_ERROR), 400);
  }

  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
    return respond(jsonRpcError(rpc.id ?? null, A2A_ERRORS.INVALID_REQUEST), 400);
  }

  try {
    switch (rpc.method) {
      case 'SendMessage': {
        const params = rpc.params as unknown as SendMessageParams;
        if (!params?.message?.parts?.length) {
          return respond(jsonRpcError(rpc.id, A2A_ERRORS.INVALID_PARAMS));
        }
        const task = await handleSendMessage(params);
        return respond(jsonRpcOk(rpc.id, task));
      }

      case 'GetTask': {
        const params = rpc.params as unknown as GetTaskParams;
        if (!params?.id) {
          return respond(jsonRpcError(rpc.id, A2A_ERRORS.INVALID_PARAMS));
        }
        const task = handleGetTask(params);
        if (!task) {
          return respond(jsonRpcError(rpc.id, A2A_ERRORS.TASK_NOT_FOUND));
        }
        return respond(jsonRpcOk(rpc.id, task));
      }

      case 'CancelTask': {
        const params = rpc.params as unknown as CancelTaskParams;
        if (!params?.id) {
          return respond(jsonRpcError(rpc.id, A2A_ERRORS.INVALID_PARAMS));
        }
        const task = handleCancelTask(params);
        if (!task) {
          return respond(jsonRpcError(rpc.id, {
            ...A2A_ERRORS.TASK_NOT_FOUND,
            message: 'Task not found or not cancelable',
          }));
        }
        return respond(jsonRpcOk(rpc.id, task));
      }

      default:
        return respond(jsonRpcError(rpc.id, A2A_ERRORS.METHOD_NOT_FOUND));
    }
  } catch (err) {
    return respond(jsonRpcError(rpc.id, {
      ...A2A_ERRORS.INTERNAL_ERROR,
      data: (err as Error).message,
    }), 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
