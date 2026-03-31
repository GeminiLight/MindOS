// Workflow step execution logic — fetches skills, constructs prompts, streams AI responses

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
 * Step-level skill takes priority; workflow-level skills provide additional context.
 */
function collectSkillNames(step: WorkflowStepRuntime, workflow: WorkflowYaml): string[] {
  const names: string[] = [];
  if (step.skill) names.push(step.skill);
  for (const s of workflow.skills ?? []) {
    if (!names.includes(s)) names.push(s);
  }
  return names;
}

// ─── Prompt Construction ──────────────────────────────────────────────────

function buildPrompt(
  step: WorkflowStepRuntime,
  workflow: WorkflowYaml,
  skillContents: Map<string, string>,
): string {
  const allStepsSummary = workflow.steps.map((s, i) => `${i + 1}. ${s.name}`).join('\n');

  // Build skill context block
  let skillBlock = '';
  if (skillContents.size > 0) {
    const sections: string[] = [];
    for (const [name, content] of skillContents) {
      const isPrimary = name === step.skill;
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
 * 2. Build prompt with injected skill context
 * 3. Stream response from /api/ask
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

  // 2. Build prompt
  const prompt = buildPrompt(step, workflow, skillContents);

  // 3. Stream from /api/ask
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      currentFile: filePath,
    }),
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
      const m = line.match(/^0:"((?:[^"\\]|\\.)*)"$/);
      if (m) {
        acc += m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        onChunk(acc);
      }
    }
  }
}
