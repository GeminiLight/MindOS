import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti/static';
import {
  completeAgentRun,
  failAgentRun,
  listAgentRuns,
  startAgentRun,
  updateAgentRun,
} from './run-ledger';
import { createMindosAgentPermissionPolicyFromContext } from './permission-policy';

type ToolWithRuntimeContext = ToolDefinition & {
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: Record<string, any>,
  ) => Promise<any> | any;
};

type RegisterSubagentExtension = (pi: ExtensionAPI) => void | Promise<void>;

const SUBAGENT_ASYNC_COMPLETE_EVENT = 'subagent:async-complete';

async function loadUpstreamSubagentExtension(): Promise<RegisterSubagentExtension> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webAppDir = path.resolve(currentDir, '..', '..');
  const upstreamPath = path.join(webAppDir, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
  const upstreamRealPath = fs.realpathSync(upstreamPath);
  const jiti = createJiti(upstreamRealPath, {
    moduleCache: false,
    tryNative: false,
  });
  const register = await jiti.import(upstreamRealPath, { default: true });
  if (typeof register !== 'function') {
    throw new Error('pi-subagents did not export an extension factory.');
  }
  return register as RegisterSubagentExtension;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function outputSummary(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
            return (item as { text: string }).text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (text.trim()) return text;
    }
  }
  return safeStringify(result);
}

function hasAsyncStartDetails(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const details = (result as { details?: unknown; isError?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  const record = details as Record<string, unknown>;
  return typeof record.asyncId === 'string' && Boolean(record.asyncId);
}

function resultIsError(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { isError?: unknown }).isError);
}

function resultMetadata(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return {};
  const record = details as Record<string, unknown>;
  return {
    ...(typeof record.runId === 'string' ? { upstreamRunId: record.runId } : {}),
    ...(typeof record.asyncId === 'string' ? { asyncId: record.asyncId } : {}),
    ...(typeof record.asyncDir === 'string' ? { asyncDir: record.asyncDir } : {}),
    ...(typeof record.mode === 'string' ? { mode: record.mode } : {}),
  };
}

function textFromAsyncCompletePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return safeStringify(payload);
  const record = payload as Record<string, unknown>;
  if (typeof record.summary === 'string') return record.summary;
  if (typeof record.resultPreview === 'string') return record.resultPreview;
  if (Array.isArray(record.results)) {
    const text = record.results
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const child = item as Record<string, unknown>;
        if (typeof child.summary === 'string') return child.summary;
        if (typeof child.output === 'string') return child.output;
        if (typeof child.text === 'string') return child.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text.trim()) return text;
  }
  return safeStringify(payload);
}

function statusFromAsyncCompletePayload(payload: unknown): 'completed' | 'failed' | 'canceled' | 'timed_out' {
  if (!payload || typeof payload !== 'object') return 'completed';
  const record = payload as Record<string, unknown>;
  const state = record.state ?? record.status;
  if (state === 'failed' || state === 'error') return 'failed';
  if (state === 'timed-out' || state === 'timed_out') return 'timed_out';
  if (state === 'canceled' || state === 'cancelled') return 'canceled';
  if (Array.isArray(record.results) && record.results.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const status = (item as Record<string, unknown>).status;
    return status === 'failed' || status === 'timed-out' || status === 'timed_out';
  })) return 'failed';
  return 'completed';
}

function asyncIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['id', 'asyncId', 'runId']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return undefined;
}

export function finalizeSubagentAsyncRunFromEvent(payload: unknown): boolean {
  const asyncId = asyncIdFromPayload(payload);
  if (!asyncId) return false;
  const run = listAgentRuns({ kind: 'pi-subagent', limit: 500 })
    .find((candidate) => candidate.status === 'streaming' && candidate.metadata?.asyncId === asyncId);
  if (!run) return false;

  const status = statusFromAsyncCompletePayload(payload);
  const output = textFromAsyncCompletePayload(payload);
  const metadata = { asyncId, asyncComplete: true };
  if (status === 'completed') {
    completeAgentRun(run.id, { outputSummary: output, metadata });
  } else {
    failAgentRun(run.id, { status, error: output || `Subagent async run ${status}.`, metadata });
  }
  return true;
}

function subagentDisplayName(params: unknown): string {
  if (!params || typeof params !== 'object') return 'Subagent';
  const input = params as Record<string, unknown>;
  if (typeof input.action === 'string' && input.action) return `Subagent ${input.action}`;
  if (typeof input.agent === 'string' && input.agent) return input.agent;
  if (Array.isArray(input.tasks)) return `Parallel subagents (${input.tasks.length})`;
  if (Array.isArray(input.chain)) return `Subagent chain (${input.chain.length})`;
  return 'Subagent';
}

function subagentRuntimeId(params: unknown): string {
  if (!params || typeof params !== 'object') return 'subagent';
  const input = params as Record<string, unknown>;
  if (typeof input.agent === 'string' && input.agent) return input.agent;
  if (typeof input.action === 'string' && input.action) return `subagent:${input.action}`;
  if (Array.isArray(input.tasks)) return 'subagent:parallel';
  if (Array.isArray(input.chain)) return 'subagent:chain';
  return 'subagent';
}

function subagentCwd(params: unknown, ctx?: Record<string, any>): string | undefined {
  if (params && typeof params === 'object') {
    const input = params as Record<string, unknown>;
    if (typeof input.cwd === 'string' && input.cwd.trim()) return input.cwd;
  }
  return typeof ctx?.cwd === 'string' && ctx.cwd.trim() ? ctx.cwd : undefined;
}

function subagentPermissionMode(ctx?: Record<string, any>) {
  return createMindosAgentPermissionPolicyFromContext(ctx, 'agent').permissionMode;
}

export function wrapSubagentToolForLedger(tool: ToolWithRuntimeContext): ToolWithRuntimeContext {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const run = startAgentRun({
        agentKind: 'pi-subagent',
        runtimeId: subagentRuntimeId(params),
        displayName: subagentDisplayName(params),
        cwd: subagentCwd(params, ctx),
        permissionMode: subagentPermissionMode(ctx),
        inputSummary: safeStringify(params),
        metadata: {
          toolCallId,
          source: 'pi-subagents',
        },
      });

      const handleAbort = () => {
        failAgentRun(run.id, {
          status: 'canceled',
          error: 'Subagent run was canceled.',
          metadata: { aborted: true },
        });
      };
      signal?.addEventListener('abort', handleAbort, { once: true });

      try {
        const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
        if (hasAsyncStartDetails(result) && !resultIsError(result)) {
          updateAgentRun(run.id, {
            status: 'streaming',
            outputSummary: outputSummary(result),
            metadata: {
              ...resultMetadata(result),
              detached: true,
            },
          });
          return result;
        }
        if (resultIsError(result)) {
          failAgentRun(run.id, {
            error: outputSummary(result) || 'Subagent run failed.',
            metadata: resultMetadata(result),
          });
          return result;
        }
        completeAgentRun(run.id, {
          outputSummary: outputSummary(result),
          metadata: resultMetadata(result),
        });
        return result;
      } catch (error) {
        failAgentRun(run.id, { error });
        throw error;
      } finally {
        signal?.removeEventListener('abort', handleAbort);
      }
    },
  };
}

export default async function mindosSubagentLedgerExtension(pi: ExtensionAPI): Promise<void> {
  const events = pi.events as unknown as { on?: (event: string, handler: (payload: unknown) => void) => (() => void) | void };
  const globalStore = globalThis as Record<string, unknown>;
  const unsubscribeStoreKey = '__mindosSubagentLedgerEventUnsubscribe';
  const previousUnsubscribe = globalStore[unsubscribeStoreKey];
  if (typeof previousUnsubscribe === 'function') {
    try {
      previousUnsubscribe();
    } catch {
      // Best-effort cleanup across extension reloads.
    }
  }
  const unsubscribe = events.on?.(SUBAGENT_ASYNC_COMPLETE_EVENT, finalizeSubagentAsyncRunFromEvent);
  if (typeof unsubscribe === 'function') {
    globalStore[unsubscribeStoreKey] = unsubscribe;
  }

  const proxyPi = {
    ...pi,
    registerTool(tool: ToolDefinition) {
      if (tool.name === 'subagent') {
        pi.registerTool(wrapSubagentToolForLedger(tool as ToolWithRuntimeContext) as ToolDefinition);
        return;
      }
      pi.registerTool(tool);
    },
  } as ExtensionAPI;

  const registerSubagentExtension = await loadUpstreamSubagentExtension();
  await registerSubagentExtension(proxyPi);
}
