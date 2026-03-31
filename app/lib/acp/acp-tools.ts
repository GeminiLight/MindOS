/**
 * ACP Agent Tools — Expose ACP capabilities as tools
 * for the MindOS built-in agent to discover and invoke ACP agents.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { getAcpAgents, findAcpAgent } from './registry';
import { createSessionFromEntry, prompt, closeSession } from './session';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: {} };
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
export const acpTools: AgentTool<any>[] = [
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
    execute: async (_id: string, params: Static<typeof CallAcpAgentParams>) => {
      try {
        const entry = await findAcpAgent(params.agent_id);
        if (!entry) {
          return textResult(`ACP agent not found: ${params.agent_id}. Use list_acp_agents to see available agents.`);
        }

        const session = await createSessionFromEntry(entry);

        try {
          const response = await prompt(session.id, params.message);
          return textResult(
            `**${entry.name}** responded:\n\n${response.text || '(empty response)'}`
          );
        } finally {
          await closeSession(session.id).catch(() => {});
        }
      } catch (err) {
        return textResult(`ACP call failed: ${(err as Error).message}`);
      }
    },
  },
];
