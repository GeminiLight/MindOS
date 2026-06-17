/**
 * A2A Agent Tools — Expose A2A client capabilities as tools
 * for the MindOS built-in agent to discover and delegate to external agents.
 */

import { Type, type Static } from '@sinclair/typebox';
import {
  discoverAgent,
  discoverAgents,
  delegateTask,
  checkRemoteTaskStatus,
  getDiscoveredAgents,
} from './client';
import { createPlan, executePlan } from './orchestrator';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
  type AgentRunPermissionMode,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  linkAbortSignalToAgentRun,
} from '@geminilight/mindos/agent/ledger/run-cancellation';
import { createMindosAgentPermissionPolicyFromContext } from '@geminilight/mindos/agent/tool/permission-policy';

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

function permissionModeFromContext(ctx: unknown): AgentRunPermissionMode {
  return createMindosAgentPermissionPolicyFromContext(ctx, 'agent').permissionMode;
}

function textFromTask(task: Awaited<ReturnType<typeof delegateTask>>): string {
  return task.artifacts?.[0]?.parts?.[0]?.text
    ?? task.history?.find(m => m.role === 'ROLE_AGENT')?.parts?.[0]?.text
    ?? '';
}

/* ── Parameter Schemas ─────────────────────────────────────────────────── */

const DiscoverAgentParams = Type.Object({
  url: Type.String({ description: 'Base URL of the agent to discover (e.g. http://localhost:3456)' }),
});

const DiscoverMultipleParams = Type.Object({
  urls: Type.Array(Type.String(), { description: 'List of base URLs to discover agents from' }),
});

const DelegateParams = Type.Object({
  agent_id: Type.String({ description: 'ID of the target agent (from list_remote_agents)' }),
  message: Type.String({ description: 'Natural language message to send to the agent' }),
});

const CheckStatusParams = Type.Object({
  agent_id: Type.String({ description: 'ID of the agent that owns the task' }),
  task_id: Type.String({ description: 'Task ID returned by delegate_to_agent' }),
});

const OrchestrateParams = Type.Object({
  request: Type.String({ description: 'The complex request to decompose and execute across multiple agents' }),
  subtasks: Type.Optional(Type.Array(Type.String(), { description: 'Pre-decomposed subtask descriptions. If omitted, auto-decomposition is used.' })),
  strategy: Type.Optional(Type.Union([
    Type.Literal('parallel'),
    Type.Literal('sequential'),
  ], { description: 'Execution strategy: parallel (default) or sequential', default: 'parallel' })),
});

/* ── Tool Implementations ──────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const a2aTools: MindosAgentTool[] = [
  {
    name: 'list_remote_agents',
    label: 'List Remote Agents',
    description: 'List all discovered remote A2A agents and their capabilities. Shows agent ID, name, skills, and reachability status. Call discover_agent first to add agents.',
    parameters: Type.Object({}),
    execute: async (_id: string) => {
      const agents = getDiscoveredAgents();
      if (agents.length === 0) {
        return textResult('No remote agents discovered yet. Use discover_agent with a URL to find agents.');
      }
      const lines = agents.map(a => {
        const skills = a.card.skills.map(s => s.name).join(', ');
        const status = a.reachable ? 'reachable' : 'unreachable';
        return `- **${a.card.name}** (id: ${a.id}, ${status})\n  Skills: ${skills || 'none declared'}`;
      });
      return textResult(`Discovered agents:\n\n${lines.join('\n\n')}`);
    },
  },

  {
    name: 'discover_agent',
    label: 'Discover Remote Agent',
    description: 'Discover a remote A2A agent by fetching its agent card from the given URL. The agent card describes the agent\'s capabilities and skills.',
    parameters: DiscoverAgentParams,
    execute: async (_id: string, params: Static<typeof DiscoverAgentParams>) => {
      try {
        const agent = await discoverAgent(params.url);
        if (!agent) {
          return textResult(`No A2A agent found at ${params.url}. The server may not support the A2A protocol.`);
        }
        const skills = agent.card.skills.map(s => `  - ${s.name}: ${s.description}`).join('\n');
        return textResult(
          `Discovered agent: **${agent.card.name}** (v${agent.card.version})\n` +
          `ID: ${agent.id}\n` +
          `Description: ${agent.card.description}\n` +
          `Endpoint: ${agent.endpoint}\n` +
          `Skills:\n${skills || '  (none declared)'}`
        );
      } catch (err) {
        return textResult(`Failed to discover agent at ${params.url}: ${(err as Error).message}`);
      }
    },
  },

  {
    name: 'discover_agents',
    label: 'Discover Multiple Agents',
    description: 'Discover multiple remote A2A agents by fetching their agent cards concurrently. Returns all successfully discovered agents.',
    parameters: DiscoverMultipleParams,
    execute: async (_id: string, params: Static<typeof DiscoverMultipleParams>) => {
      try {
        const agents = await discoverAgents(params.urls);
        if (agents.length === 0) {
          return textResult(`No A2A agents found at any of the ${params.urls.length} URLs.`);
        }
        const lines = agents.map(a =>
          `- **${a.card.name}** (id: ${a.id}) — ${a.card.skills.length} skills`
        );
        return textResult(`Discovered ${agents.length}/${params.urls.length} agents:\n\n${lines.join('\n')}`);
      } catch (err) {
        return textResult(`Discovery failed: ${(err as Error).message}`);
      }
    },
  },

  {
    name: 'delegate_to_agent',
    label: 'Delegate Task to Agent',
    description: 'Send a task to a remote A2A agent. The agent will process the message and return a result. Use list_remote_agents to see available agents and their skills first.',
    parameters: DelegateParams,
    execute: async (_id: string, params: Static<typeof DelegateParams>, signal?: AbortSignal, _onUpdate?: unknown, ctx?: unknown) => {
      const run = startAgentRun({
        agentKind: 'a2a',
        runtimeId: params.agent_id,
        displayName: params.agent_id,
        permissionMode: permissionModeFromContext(ctx),
        inputSummary: params.message,
        metadata: {
          toolCallId: _id,
          source: 'a2a',
        },
      });
      const unlinkAbortLedger = linkAbortSignalToAgentRun(run.id, signal, {
        reason: 'A2A delegation canceled.',
        metadata: { aborted: true },
      });
      try {
        const task = await delegateTask(params.agent_id, params.message, undefined, { signal });
        const taskText = textFromTask(task);

        if (task.status.state === 'TASK_STATE_COMPLETED') {
          const result = taskText || 'Task completed (no text result)';
          completeAgentRun(run.id, {
            outputSummary: result,
            metadata: { taskId: task.id, taskState: task.status.state },
          });
          return textResult(`Agent completed task (id: ${task.id}):\n\n${result}`);
        }

        if (task.status.state === 'TASK_STATE_FAILED') {
          const errMsg = task.status.message?.parts?.[0]?.text ?? 'Unknown error';
          failAgentRun(run.id, {
            error: errMsg,
            metadata: { taskId: task.id, taskState: task.status.state },
          });
          return textResult(`Agent failed task (id: ${task.id}): ${errMsg}`);
        }

        if (task.status.state === 'TASK_STATE_CANCELED') {
          failAgentRun(run.id, {
            status: 'canceled',
            error: 'A2A task was canceled.',
            metadata: { taskId: task.id, taskState: task.status.state },
          });
          return textResult(`Agent canceled task (id: ${task.id}).`);
        }

        // Task is still in progress (non-blocking)
        completeAgentRun(run.id, {
          outputSummary: `Task in progress (state: ${task.status.state}).`,
          metadata: { taskId: task.id, taskState: task.status.state },
        });
        return textResult(
          `Task submitted (id: ${task.id}, state: ${task.status.state}).\n` +
          `Use check_task_status to poll for completion.`
        );
      } catch (err) {
        failAgentRun(run.id, {
          status: signal?.aborted ? 'canceled' : 'failed',
          error: signal?.aborted ? 'A2A delegation canceled.' : err,
          metadata: signal?.aborted ? { aborted: true } : undefined,
        });
        return textResult(`Delegation failed: ${(err as Error).message}`);
      } finally {
        unlinkAbortLedger();
      }
    },
  },

  {
    name: 'check_task_status',
    label: 'Check Remote Task Status',
    description: 'Check the status of a task previously delegated to a remote agent. Returns the current state, any results, or error information.',
    parameters: CheckStatusParams,
    execute: async (_id: string, params: Static<typeof CheckStatusParams>) => {
      try {
        const task = await checkRemoteTaskStatus(params.agent_id, params.task_id);

        const state = task.status.state;
        if (state === 'TASK_STATE_COMPLETED') {
          const result = task.artifacts?.[0]?.parts?.[0]?.text ?? 'Completed (no text)';
          return textResult(`Task ${params.task_id} completed:\n\n${result}`);
        }
        if (state === 'TASK_STATE_FAILED') {
          const errMsg = task.status.message?.parts?.[0]?.text ?? 'Unknown error';
          return textResult(`Task ${params.task_id} failed: ${errMsg}`);
        }

        return textResult(`Task ${params.task_id} state: ${state}`);
      } catch (err) {
        return textResult(`Status check failed: ${(err as Error).message}`);
      }
    },
  },

  {
    name: 'orchestrate',
    label: 'Orchestrate Multi-Agent Task',
    description: 'Decompose a complex request into subtasks and execute them across multiple remote agents. Auto-matches subtasks to the best available agent based on skills. Use discover_agent first to register agents.',
    parameters: OrchestrateParams,
    execute: async (_id: string, params: Static<typeof OrchestrateParams>, signal?: AbortSignal) => {
      try {
        const strategy = params.strategy ?? 'parallel';
        const plan = createPlan(params.request, strategy, params.subtasks);

        const assigned = plan.subtasks.filter(st => st.assignedAgentId);
        if (assigned.length === 0) {
          return textResult(
            `Created plan with ${plan.subtasks.length} subtasks but no agents matched any skill.\n` +
            `Subtasks: ${plan.subtasks.map(st => st.description).join(', ')}\n\n` +
            'Discover agents first using discover_agent, then retry.'
          );
        }

        const result = await executePlan(plan, undefined, { signal });

        const summary = plan.subtasks.map(st => {
          const icon = st.status === 'completed'
            ? '[OK]'
            : st.status === 'failed'
              ? '[FAIL]'
              : st.status === 'canceled'
                ? '[CANCEL]'
                : '[?]';
          return `${icon} ${st.description}`;
        }).join('\n');

        return textResult(
          `Orchestration ${result.status} (${strategy}, ${plan.subtasks.length} subtasks):\n\n` +
          `${summary}\n\n---\n\n${result.aggregatedResult ?? '(no result)'}`
        );
      } catch (err) {
        return textResult(`Orchestration failed: ${(err as Error).message}`);
      }
    },
  },
];
