// Workflow step execution logic — fetches skills, resolves agents, constructs prompts, streams AI responses

import type { WorkflowYaml, WorkflowStepRuntime } from './types';

// ─── Skill Fetching ───────────────────────────────────────────────────────

/** Cache skill content for the duration of a workflow run to avoid redundant fetches */
const skillCache = new Map<string, string | null>();

export function clearSkillCache() {
  skillCache.clear();
}

/**
 * Fetch skill content from /api/skills. Returns the full SKILL.md content,
 * or null if the skill doesn't exist. Results are cached per skill name.
 */
async function fetchSkillContent(name: string, signal: AbortSignal): Promise<string | null> {
  if (skillCache.has(name)) return skillCache.get(name)!;

  try {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', name }),
      signal,
    });
    if (!res.ok) {
      skillCache.set(name, null);
      return null;
    }
    const data = await res.json();
    const content = data.content as string | undefined;
    skillCache.set(name, content ?? null);
    return content ?? null;
  } catch {
    // Network error or abort — don't cache failures
    return null;
  }
}

/**
 * Collect all unique skill names referenced by a step (step-level + workflow-level).
 * Handles both legacy `skill` (singular) and new `skills` (array) fields.
 */
function collectSkillNames(step: WorkflowStepRuntime, workflow: WorkflowYaml): string[] {
  const names: string[] = [];
  // Step-level skills (new array format takes priority)
  if (step.skills?.length) {
    for (const s of step.skills) {
      if (!names.includes(s)) names.push(s);
    }
  } else if (step.skill) {
    names.push(step.skill);
  }
  // Workflow-level skills
  for (const s of workflow.skills ?? []) {
    if (!names.includes(s)) names.push(s);
  }
  return names;
}

// ─── ACP Agent Resolution ────────────────────────────────────────────────

/** Resolve an agent name/id to an ACP agent selection { id, name } */
async function resolveAcpAgent(
  agentId: string,
  signal: AbortSignal,
): Promise<{ id: string; name: string } | null> {
  try {
    const res = await fetch(`/api/acp/registry?agent=${encodeURIComponent(agentId)}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.agent?.id) {
      return { id: data.agent.id, name: data.agent.name || agentId };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Prompt Construction ──────────────────────────────────────────────────

function buildPrompt(
  step: WorkflowStepRuntime,
  workflow: WorkflowYaml,
  skillContents: Map<string, string>,
): string {
  const allStepsSummary = workflow.steps.map((s, i) => `${i + 1}. ${s.name}`).join('\n');

  // Determine primary skill name for labeling
  const primarySkill = step.skills?.length ? step.skills[0] : step.skill;

  // Build skill context block
  let skillBlock = '';
  if (skillContents.size > 0) {
    const sections: string[] = [];
    for (const [name, content] of skillContents) {
      const isPrimary = name === primarySkill;
      sections.push(
        `### ${isPrimary ? '[Primary] ' : ''}Skill: ${name}\n\n${content}`
      );
    }
    skillBlock = `\n\n---\n## Skill Reference\n\nFollow the guidelines from these skills when executing this step:\n\n${sections.join('\n\n---\n\n')}`;
  }

  return `You are executing step ${step.index + 1} of a workflow: "${step.name}".

Context of the full workflow "${workflow.title}":
${allStepsSummary}

Current step instructions:
${step.prompt || '(No specific instructions — use common sense.)'}${skillBlock}

Execute concisely. Provide:
1. What you did / what the output is
2. Any decisions made
3. What the next step should watch out for

Be specific and actionable. Format in Markdown.`;
}

// ─── Streaming Execution ──────────────────────────────────────────────────

/**
 * Execute a workflow step with AI:
 * 1. Fetch referenced skill(s) content
 * 2. Resolve ACP agent (if step.agent is set)
 * 3. Build prompt with injected skill context
 * 4. Stream response from /api/ask (routed to ACP agent if resolved)
 */
export async function runStepWithAI(
  step: WorkflowStepRuntime,
  workflow: WorkflowYaml,
  filePath: string,
  onChunk: (accumulated: string) => void,
  signal: AbortSignal,
): Promise<void> {
  // 1. Fetch skill content
  const skillNames = collectSkillNames(step, workflow);
  const skillContents = new Map<string, string>();

  if (skillNames.length > 0) {
    const results = await Promise.all(
      skillNames.map(async (name) => {
        const content = await fetchSkillContent(name, signal);
        return [name, content] as const;
      })
    );
    for (const [name, content] of results) {
      if (content) skillContents.set(name, content);
    }
  }

  // 2. Resolve ACP agent
  let selectedAcpAgent: { id: string; name: string } | null = null;
  if (step.agent) {
    selectedAcpAgent = await resolveAcpAgent(step.agent, signal);
    // If agent name doesn't resolve in ACP registry, skip silently
    // (the step will run with the default MindOS agent)
  }

  // 3. Build prompt
  const prompt = buildPrompt(step, workflow, skillContents);

  // 4. Stream from /api/ask
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: prompt }],
    currentFile: filePath,
  };
  if (selectedAcpAgent) {
    body.selectedAcpAgent = selectedAcpAgent;
  }

  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    for (const line of raw.split('\n')) {
      // SSE format: data:{"type":"text_delta","delta":"..."}
      const sseMatch = line.match(/^data:(.+)$/);
      if (sseMatch) {
        try {
          const event = JSON.parse(sseMatch[1]);
          if (event.type === 'text_delta' && typeof event.delta === 'string') {
            acc += event.delta;
            onChunk(acc);
          } else if (event.type === 'thinking_delta' && typeof event.delta === 'string') {
            // Show agent thinking as dimmed text
            acc += event.delta;
            onChunk(acc);
          } else if (event.type === 'error' && event.message) {
            // ACP agent error — throw so WorkflowRunner shows it in step error state
            throw new Error(event.message);
          }
        } catch {
          // Not valid JSON — try legacy Vercel AI SDK format: 0:"..."
          const legacyMatch = line.match(/^0:"((?:[^"\\]|\\.)*)"$/);
          if (legacyMatch) {
            acc += legacyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            onChunk(acc);
          }
        }
        continue;
      }
      // Legacy Vercel AI SDK format (without SSE prefix)
      const legacyMatch = line.match(/^0:"((?:[^"\\]|\\.)*)"$/);
      if (legacyMatch) {
        acc += legacyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        onChunk(acc);
      }
    }
  }
}
