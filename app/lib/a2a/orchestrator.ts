/**
 * A2A Orchestrator — Multi-agent task decomposition and execution.
 * Phase 3: Breaks complex requests into sub-tasks, matches to agents, executes, aggregates.
 */

import { randomUUID } from 'crypto';
import type {
  RemoteAgent,
  SubTask,
  OrchestrationPlan,
  ExecutionStrategy,
  SkillMatch,
  AgentSkill,
} from './types';
import { getDiscoveredAgents, delegateTask } from './client';

/* ── Constants ─────────────────────────────────────────────────────────── */

const MAX_SUBTASKS = 10;

/* ── Skill Matcher ─────────────────────────────────────────────────────── */

/** Score how well a skill matches a task description (keyword overlap, deduplicated) */
function scoreSkillMatch(taskDesc: string, skill: AgentSkill): number {
  const taskWords = new Set(taskDesc.toLowerCase().split(/\s+/));
  // Deduplicate skill words to avoid double-counting from name + description overlap
  const skillWords = new Set([
    ...skill.name.toLowerCase().split(/\s+/),
    ...skill.description.toLowerCase().split(/\s+/),
    ...(skill.tags ?? []).map(t => t.toLowerCase()),
  ]);
  let matches = 0;
  for (const w of skillWords) {
    if (w.length > 2 && taskWords.has(w)) matches++;
  }
  return matches;
}

/**
 * Find the best agent+skill match for a sub-task description.
 * Returns null if no agent has a relevant skill.
 */
export function matchSkill(taskDescription: string): SkillMatch | null {
  const agents = getDiscoveredAgents().filter(a => a.reachable);
  if (agents.length === 0) return null;

  let best: SkillMatch | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    for (const skill of agent.card.skills) {
      const score = scoreSkillMatch(taskDescription, skill);
      if (score > bestScore) {
        bestScore = score;
        best = {
          agentId: agent.id,
          agentName: agent.card.name,
          skillId: skill.id,
          skillName: skill.name,
          confidence: Math.min(score / 3, 1),
        };
      }
    }
  }

  return best;
}

/* ── Task Decomposer ───────────────────────────────────────────────────── */

/**
 * Decompose a complex request into sub-tasks.
 * Uses simple heuristics: split on sentence boundaries and conjunctions.
 * For LLM-based decomposition, the agent tool can call this with pre-decomposed parts.
 */
export function decompose(request: string, subtaskDescriptions?: string[]): SubTask[] {
  let descriptions: string[];

  if (subtaskDescriptions && subtaskDescriptions.length > 0) {
    descriptions = subtaskDescriptions;
  } else {
    descriptions = splitIntoSubtasks(request);
  }

  return descriptions.slice(0, MAX_SUBTASKS).map((desc, i) => ({
    id: `st-${randomUUID().slice(0, 8)}`,
    description: desc.trim(),
    assignedAgentId: null,
    matchedSkillId: null,
    status: 'pending' as const,
    result: null,
    error: null,
    dependsOn: [],
  }));
}

/** Simple heuristic: split on "and then", "then", "also", numbered lists, semicolons */
function splitIntoSubtasks(text: string): string[] {
  // Try numbered list first: split on "N. " pattern at boundaries
  const numbered = text.split(/(?:^|\s)(?=\d+\.\s)/m).map(s => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
  if (numbered.length >= 2) return numbered;

  // Try splitting on conjunctions/semicolons
  const parts = text.split(/;\s*|\.\s+(?:then|and then|also|next|finally)\s+/i).filter(Boolean);
  if (parts.length >= 2) return parts;

  // Fallback: treat as single task
  return [text];
}

/* ── Execution Engine ──────────────────────────────────────────────────── */

/**
 * Create an orchestration plan from a request.
 */
export function createPlan(
  request: string,
  strategy: ExecutionStrategy = 'parallel',
  subtaskDescriptions?: string[],
): OrchestrationPlan {
  const subtasks = decompose(request, subtaskDescriptions);

  // Auto-match skills to agents
  for (const st of subtasks) {
    const match = matchSkill(st.description);
    if (match) {
      st.assignedAgentId = match.agentId;
      st.matchedSkillId = match.skillId;
    }
  }

  return {
    id: `plan-${randomUUID().slice(0, 8)}`,
    originalRequest: request,
    strategy,
    subtasks,
    createdAt: new Date().toISOString(),
    completedAt: null,
    status: 'planning',
    aggregatedResult: null,
  };
}

/**
 * Execute a single sub-task by delegating to its assigned agent.
 */
async function executeSubtask(subtask: SubTask, token?: string): Promise<void> {
  if (!subtask.assignedAgentId) {
    subtask.status = 'failed';
    subtask.error = 'No agent assigned to this subtask';
    return;
  }

  subtask.status = 'running';

  try {
    // delegateTask has its own 30s RPC timeout via fetchWithTimeout in client.ts
    const task = await delegateTask(subtask.assignedAgentId, subtask.description, token);

    if (task.status.state === 'TASK_STATE_COMPLETED') {
      subtask.status = 'completed';
      subtask.result = task.artifacts?.[0]?.parts?.[0]?.text
        ?? task.history?.find(m => m.role === 'ROLE_AGENT')?.parts?.[0]?.text
        ?? 'Completed (no text result)';
    } else if (task.status.state === 'TASK_STATE_FAILED') {
      subtask.status = 'failed';
      subtask.error = task.status.message?.parts?.[0]?.text ?? 'Agent reported failure';
    } else {
      subtask.status = 'completed';
      subtask.result = `Task in progress (state: ${task.status.state})`;
    }
  } catch (err) {
    subtask.status = 'failed';
    subtask.error = (err as Error).message;
  }
}

/**
 * Execute all sub-tasks in an orchestration plan.
 */
export async function executePlan(plan: OrchestrationPlan, token?: string): Promise<OrchestrationPlan> {
  plan.status = 'executing';

  const unassigned = plan.subtasks.filter(st => !st.assignedAgentId);
  if (unassigned.length === plan.subtasks.length) {
    plan.status = 'failed';
    plan.aggregatedResult = 'No agents available for any subtask. Discover agents first using discover_agent.';
    return plan;
  }

  // Mark unassigned subtasks as failed before execution
  for (const st of plan.subtasks) {
    if (!st.assignedAgentId) {
      st.status = 'failed';
      st.error = 'No matching agent found for this subtask';
    }
  }

  const assignedTasks = plan.subtasks.filter(st => st.assignedAgentId);

  if (plan.strategy === 'parallel') {
    await Promise.allSettled(
      assignedTasks.map(st => executeSubtask(st, token))
    );
  } else {
    // Sequential or dependency-based
    for (const st of plan.subtasks) {
      if (!st.assignedAgentId) {
        st.status = 'failed';
        st.error = 'No agent assigned';
        continue;
      }

      // Check dependencies
      if (st.dependsOn.length > 0) {
        const deps = st.dependsOn.map(id => plan.subtasks.find(s => s.id === id));
        const allDone = deps.every(d => d?.status === 'completed');
        if (!allDone) {
          st.status = 'failed';
          st.error = 'Dependencies not met';
          continue;
        }
      }

      await executeSubtask(st, token);

      // Stop on failure in sequential mode
      if (plan.strategy === 'sequential' && st.status === 'failed') break;
    }
  }

  // Aggregate results
  const completed = plan.subtasks.filter(st => st.status === 'completed');
  const failed = plan.subtasks.filter(st => st.status === 'failed');

  if (failed.length === plan.subtasks.length) {
    plan.status = 'failed';
    plan.aggregatedResult = `All ${failed.length} subtasks failed:\n` +
      failed.map(st => `- ${st.description}: ${st.error}`).join('\n');
  } else {
    plan.status = 'completed';
    const parts: string[] = [];
    for (const st of plan.subtasks) {
      if (st.status === 'completed' && st.result) {
        parts.push(`## ${st.description}\n\n${st.result}`);
      } else if (st.status === 'failed') {
        parts.push(`## ${st.description}\n\n[Failed: ${st.error}]`);
      }
    }
    plan.aggregatedResult = parts.join('\n\n---\n\n');
  }

  plan.completedAt = new Date().toISOString();
  return plan;
}
