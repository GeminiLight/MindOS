/**
 * ACP Agent Tools — Expose ACP capabilities as tools
 * for the MindOS built-in agent to discover and invoke ACP agents.
 */

import { Type, type Static } from '@sinclair/typebox';
import { getAcpAgents, findAcpAgent } from './registry';
import { createSessionFromEntry, prompt, closeSession, cancelPrompt } from './session';
import { getMindRoot } from '../fs';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
  updateAgentRun,
  type AgentRunPermissionMode,
} from '@geminilight/mindos/agent/run-ledger';
import { createMindosAgentPermissionPolicyFromContext } from '@geminilight/mindos/agent/permission-policy';
import {
  abortErrorFromSignal,
  isAbortLikeError,
  linkAbortSignalToAgentRun,
  registerAgentRunCancelHandler,
} from '@geminilight/mindos/agent/run-cancellation';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: {} };
}

type MindosAgentTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (...args: any[]) => Promise<ReturnType<typeof textResult>>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function permissionModeFromContext(ctx: unknown): AgentRunPermissionMode {
  return createMindosAgentPermissionPolicyFromContext(ctx, 'agent').acpPermissionMode;
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortErrorFromSignal(signal, 'ACP run was canceled.');

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(abortErrorFromSignal(signal, 'ACP run was canceled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    removeAbortListener?.();
  }
}

/* ── Parameter Schemas ─────────────────────────────────────────────────── */

const ListAcpAgentsParams = Type.Object({
  tag: Type.Optional(Type.String({ description: 'Optional tag to filter agents by (e.g. "coding", "search")' })),
});

const CallAcpAgentParams = Type.Object({
  agent_id: Type.String({ description: 'ID of the ACP agent from the registry (from list_acp_agents)' }),
  message: Type.String({ description: 'Natural language message to send to the ACP agent' }),
});

/* ── Tool Implementations ──────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const acpTools: MindosAgentTool[] = [
  {
    name: 'list_acp_agents',
    label: 'List ACP Agents',
    description: 'List available ACP (Agent Client Protocol) agents from the public registry. These are local subprocess-based agents like Gemini CLI, Claude, Copilot, etc. Optionally filter by tag.',
    parameters: ListAcpAgentsParams,
    execute: async (_id: string, params: Static<typeof ListAcpAgentsParams>) => {
      try {
        let agents = await getAcpAgents();

        if (params.tag) {
          const tag = params.tag.toLowerCase();
          agents = agents.filter(a =>
            a.tags?.some(t => t.toLowerCase().includes(tag))
          );
        }

        if (agents.length === 0) {
          return textResult(
            params.tag
              ? `No ACP agents found with tag "${params.tag}". Try list_acp_agents without a tag filter.`
              : 'No ACP agents found in the registry. The registry may be unavailable.'
          );
        }

        const lines = agents.map(a => {
          const tags = a.tags?.join(', ') || 'none';
          return `- **${a.name}** (id: \`${a.id}\`, transport: ${a.transport})\n  ${a.description}\n  Tags: ${tags}`;
        });

        return textResult(`Available ACP agents (${agents.length}):\n\n${lines.join('\n\n')}`);
      } catch (err) {
        return textResult(`Failed to list ACP agents: ${(err as Error).message}`);
      }
    },
  },

  {
    name: 'call_acp_agent',
    label: 'Call ACP Agent',
    description: 'Spawn an ACP agent, send it a message, and return the result. The agent runs as a local subprocess. Use list_acp_agents first to see available agents.',
    parameters: CallAcpAgentParams,
    execute: async (_id: string, params: Static<typeof CallAcpAgentParams>, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: unknown) => {
      const cwd = getMindRoot();
      const permissionMode = permissionModeFromContext(ctx);
      const run = startAgentRun({
        agentKind: 'acp',
        runtimeId: params.agent_id,
        displayName: params.agent_id,
        cwd,
        permissionMode,
        inputSummary: params.message,
        metadata: {
          toolCallId: _id,
          phase: 'resolve_agent',
        },
      });
      let session: { id: string } | undefined;
      const unlinkAbortLedger = linkAbortSignalToAgentRun(run.id, _signal, {
        reason: 'ACP run was canceled.',
        metadata: { aborted: true },
      });
      const unregisterCancelHandler = registerAgentRunCancelHandler(run.id, async () => {
        if (session?.id) await cancelPrompt(session.id).catch(() => {});
      });
      try {
        const entry = await findAcpAgent(params.agent_id);
        if (!entry) {
          failAgentRun(run.id, {
            error: `ACP agent not found: ${params.agent_id}.`,
            metadata: { phase: 'resolve_agent' },
          });
          return textResult(`ACP agent not found: ${params.agent_id}. Use list_acp_agents to see available agents.`);
        }

        updateAgentRun(run.id, {
          runtimeId: entry.id,
          displayName: entry.name,
          metadata: { phase: 'create_session' },
        });
        session = await createSessionFromEntry(entry, { cwd, permissionMode: permissionMode === 'readonly' ? 'readonly' : 'agent' });
        updateAgentRun(run.id, {
          archive: { sessionId: session.id },
          metadata: {
            phase: 'prompt',
            sessionId: session.id,
          },
        });

        try {
          const response = await raceWithAbort(prompt(session.id, params.message), _signal);
          completeAgentRun(run.id, {
            outputSummary: response.text || '(empty response)',
            metadata: {
              sessionId: session.id,
              outputChars: response.text?.length ?? 0,
            },
          });
          return textResult(
            `**${entry.name}** responded:\n\n${response.text || '(empty response)'}`
          );
        } finally {
          await closeSession(session.id).catch(() => {});
        }
      } catch (err) {
        if (isAbortLikeError(err) || _signal?.aborted) {
          failAgentRun(run.id, {
            status: 'canceled',
            error: 'ACP run was canceled.',
            metadata: {
              ...(session?.id ? { sessionId: session.id } : {}),
              aborted: true,
            },
          });
          return textResult('ACP call canceled.');
        }
        failAgentRun(run.id, {
          error: err,
          metadata: {
            ...(session?.id ? { sessionId: session.id } : {}),
          },
        });
        return textResult(`ACP call failed: ${errorMessage(err)}`);
      } finally {
        unlinkAbortLedger();
        unregisterCancelHandler();
      }
    },
  },
];
