import type { MindosPermissionMode } from './permission/index.js';
import type { AgentRunStatus } from './ledger/run-ledger-types.js';

export type MindosAgentMode = 'default' | 'plan' | 'goal';

export type MindosAgentModeDirective = {
  mode: Exclude<MindosAgentMode, 'default'>;
  command: '/plan' | '/goal';
  prompt: string;
};

export type MindosAgentModeContract = {
  schemaVersion: 1;
  mode: MindosAgentMode;
  objective?: string;
  directive?: MindosAgentModeDirective['command'];
  requestedPermissionMode?: MindosPermissionMode;
  effectivePermissionMode?: MindosPermissionMode;
  behavior:
    | 'normal'
    | 'read_only_plan'
    | 'goal_until_done_blocked_or_needs_user';
};

export type MindosPlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export type MindosPlanArtifact = {
  schemaVersion: 1;
  mode: 'plan';
  objective?: string;
  summary: string;
  steps: Array<{
    title: string;
    status: MindosPlanStepStatus;
  }>;
  risks: string[];
  source: 'assistant' | 'fallback';
  generatedAt: number;
};

export type MindosGoalEvaluationStatus = 'completed' | 'blocked' | 'needs_user';
export type MindosGoalEvaluationConfidence = 'low' | 'medium' | 'high';

export type MindosGoalEvaluation = {
  schemaVersion: 1;
  mode: 'goal';
  objective: string;
  status: MindosGoalEvaluationStatus;
  confidence: MindosGoalEvaluationConfidence;
  summary: string;
  evidence: string[];
  nextAction?: string;
  evaluatedAt: number;
};

export type ResolvedMindosAgentModeRequest = {
  mode: MindosAgentMode;
  prompt: string;
  directive?: MindosAgentModeDirective;
};

const DIRECTIVE_RE = /^\/(plan|goal)(?:\s+|$)/i;
const MAX_SUMMARY_CHARS = 280;
const MAX_STEP_CHARS = 180;
const MAX_RISK_CHARS = 180;

export function normalizeMindosAgentMode(value: unknown): MindosAgentMode | undefined {
  return value === 'default' || value === 'plan' || value === 'goal'
    ? value
    : undefined;
}

export function parseMindosAgentModeDirective(input: string): MindosAgentModeDirective | undefined {
  const match = DIRECTIVE_RE.exec(input.trimStart());
  if (!match) return undefined;
  const command = `/${match[1]!.toLowerCase()}` as MindosAgentModeDirective['command'];
  const prompt = input.trimStart().slice(match[0].length).trimStart()
    || (command === '/goal'
      ? 'Complete the current user goal and report whether it is complete, blocked, or needs user input.'
      : 'Inspect the current context and produce a reviewable plan.');
  return {
    command,
    mode: command === '/goal' ? 'goal' : 'plan',
    prompt,
  };
}

export function resolveMindosAgentModeRequest(input: {
  requestedMode?: MindosAgentMode;
  prompt: string;
}): ResolvedMindosAgentModeRequest {
  const directive = parseMindosAgentModeDirective(input.prompt);
  if (directive) {
    return {
      mode: directive.mode,
      prompt: directive.prompt,
      directive,
    };
  }
  return {
    mode: input.requestedMode ?? 'default',
    prompt: input.prompt,
  };
}

export function resolveMindosAgentModePermissionMode(
  mode: MindosAgentMode,
  requestedPermissionMode: MindosPermissionMode,
): MindosPermissionMode {
  return mode === 'plan' ? 'read' : requestedPermissionMode;
}

export function createMindosAgentModeContract(input: {
  mode: MindosAgentMode;
  prompt: string;
  directive?: MindosAgentModeDirective;
  requestedPermissionMode?: MindosPermissionMode;
  effectivePermissionMode?: MindosPermissionMode;
}): MindosAgentModeContract {
  const objective = summarizeObjective(input.prompt);
  return {
    schemaVersion: 1,
    mode: input.mode,
    ...(objective && input.mode !== 'default' ? { objective } : {}),
    ...(input.directive ? { directive: input.directive.command } : {}),
    ...(input.requestedPermissionMode ? { requestedPermissionMode: input.requestedPermissionMode } : {}),
    ...(input.effectivePermissionMode ? { effectivePermissionMode: input.effectivePermissionMode } : {}),
    behavior: input.mode === 'plan'
      ? 'read_only_plan'
      : input.mode === 'goal'
        ? 'goal_until_done_blocked_or_needs_user'
        : 'normal',
  };
}

export function renderMindosAgentModePrompt(contract: MindosAgentModeContract): string {
  if (contract.mode === 'default') return '';
  if (contract.mode === 'plan') {
    return [
      '## Agent Mode: Plan',
      '',
      'You are in Plan mode for this turn.',
      '- Work read-only: inspect, search, and reason, but do not write files, mutate the knowledge base, run destructive shell commands, or perform side-effect actions.',
      '- Produce a reviewable plan artifact before implementation. Use concise sections: Goal, Assumptions, Steps, Risks, and Ready to Execute.',
      '- If implementation or external side effects are needed, stop after the plan and ask for explicit approval to switch back to Build mode.',
      contract.objective ? `- Objective: ${contract.objective}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    '## Agent Mode: Goal',
    '',
    'You are in Goal mode for this turn.',
    '- Treat the objective as a stop-condition contract: continue until it is completed, blocked, or needs user input within the current permissions and step budget.',
    '- Do not bypass permission policy, safety checks, context limits, or user approval requirements.',
    '- Before the final answer, state a short goal result using exactly one of: `Goal status: complete`, `Goal status: blocked`, or `Goal status: needs_user`, then cite the evidence.',
    contract.objective ? `- Objective: ${contract.objective}` : '',
  ].filter(Boolean).join('\n');
}

export function prependMindosAgentModePrompt(prompt: string, contract: MindosAgentModeContract): string {
  const modePrompt = renderMindosAgentModePrompt(contract);
  if (!modePrompt) return prompt;
  return [modePrompt, prompt.trimStart()].filter(Boolean).join('\n\n---\n\n');
}

export function createMindosPlanArtifact(input: {
  objective?: string;
  output: string;
  generatedAt?: number;
}): MindosPlanArtifact {
  const output = normalizeMultiline(input.output);
  const steps = extractPlanSteps(output);
  const summary = firstMeaningfulLine(output)
    ?? input.objective
    ?? 'Reviewable plan produced by the agent.';
  return {
    schemaVersion: 1,
    mode: 'plan',
    ...(input.objective ? { objective: input.objective } : {}),
    summary: clampText(summary, MAX_SUMMARY_CHARS),
    steps: steps.length > 0
      ? steps
      : [{ title: clampText(input.objective ?? summary, MAX_STEP_CHARS), status: 'pending' }],
    risks: extractPlanRisks(output),
    source: steps.length > 0 ? 'assistant' : 'fallback',
    generatedAt: input.generatedAt ?? Date.now(),
  };
}

export function evaluateMindosGoalCompletion(input: {
  objective?: string;
  output: string;
  runStatus: AgentRunStatus;
  evaluatedAt?: number;
}): MindosGoalEvaluation {
  const output = normalizeMultiline(input.output);
  const objective = input.objective?.trim() || 'Complete the requested goal.';
  const explicit = parseExplicitGoalStatus(output);
  const status = input.runStatus === 'failed' || input.runStatus === 'timed_out' || input.runStatus === 'canceled'
    ? 'blocked'
    : explicit ?? inferGoalStatus(output);
  const confidence: MindosGoalEvaluationConfidence = explicit
    ? 'high'
    : status === 'completed' && output.trim()
      ? 'medium'
      : 'low';
  const summary = firstMeaningfulLine(output)
    ?? (status === 'completed' ? 'The agent reported a completed goal.' : 'The agent could not finish the goal.');
  const nextAction = status === 'completed'
    ? undefined
    : status === 'needs_user'
      ? 'User input is required before the goal can continue.'
      : 'Resolve the blocker, then rerun Goal mode.';

  return {
    schemaVersion: 1,
    mode: 'goal',
    objective,
    status,
    confidence,
    summary: clampText(summary, MAX_SUMMARY_CHARS),
    evidence: extractGoalEvidence(output),
    ...(nextAction ? { nextAction } : {}),
    evaluatedAt: input.evaluatedAt ?? Date.now(),
  };
}

function summarizeObjective(prompt: string): string | undefined {
  return firstMeaningfulLine(prompt)?.replace(/^#+\s*/, '').slice(0, MAX_SUMMARY_CHARS);
}

function normalizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function firstMeaningfulLine(value: string): string | undefined {
  for (const raw of value.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = stripListMarker(line);
    if (stripped) return stripped;
  }
  return undefined;
}

function stripListMarker(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+\[[ xX~-]\]\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function clampText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function extractPlanSteps(output: string): MindosPlanArtifact['steps'] {
  const steps: MindosPlanArtifact['steps'] = [];
  let inRiskSection = false;
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (isPlanRiskHeading(line)) {
      inRiskSection = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(line) && inRiskSection) {
      inRiskSection = false;
    }
    if (inRiskSection) continue;
    const match = /^(?:[-*]\s+\[([ xX~-])\]\s+|(?:[-*]|\d+[.)])\s+)(.+)$/.exec(line);
    if (!match) continue;
    const body = stripListMarker(line);
    if (!body || /^risk/i.test(body)) continue;
    const marker = match[1];
    const status: MindosPlanStepStatus = marker && /x/i.test(marker)
      ? 'completed'
      : marker === '~' || marker === '-'
        ? 'in_progress'
        : 'pending';
    steps.push({ title: clampText(body, MAX_STEP_CHARS), status });
    if (steps.length >= 12) break;
  }
  return steps;
}

function extractPlanRisks(output: string): string[] {
  const risks: string[] = [];
  let inRiskSection = false;
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (isPlanRiskHeading(line)) {
      inRiskSection = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(line) && inRiskSection) break;
    if (!inRiskSection && !/\brisk\b/i.test(line) && !/风险|阻塞|不确定/.test(line)) continue;
    if (/^[-*]\s+/.test(line) || inRiskSection) {
      const risk = stripListMarker(line);
      if (risk) risks.push(clampText(risk, MAX_RISK_CHARS));
    }
    if (risks.length >= 6) break;
  }
  return [...new Set(risks)];
}

function isPlanRiskHeading(line: string): boolean {
  return /^(#{1,6}\s*)?(risks?|risk|known risks?|边界|风险)[:\s]*$/i.test(line);
}

function parseExplicitGoalStatus(output: string): MindosGoalEvaluationStatus | undefined {
  const match = /goal\s*status\s*[:：]\s*(complete|completed|done|blocked|needs[_\s-]*user|need[_\s-]*user)/i.exec(output);
  if (match) {
    const value = match[1]!.toLowerCase().replace(/[\s_-]+/g, '_');
    if (value === 'blocked') return 'blocked';
    if (value === 'needs_user' || value === 'need_user') return 'needs_user';
    return 'completed';
  }
  if (/目标状态\s*[:：]\s*(完成|已完成)/.test(output)) return 'completed';
  if (/目标状态\s*[:：]\s*(阻塞|被阻塞)/.test(output)) return 'blocked';
  if (/目标状态\s*[:：]\s*(需要用户|需要输入|等待用户)/.test(output)) return 'needs_user';
  return undefined;
}

function inferGoalStatus(output: string): MindosGoalEvaluationStatus {
  const lower = output.toLowerCase();
  if (/(blocked|cannot continue|unable to continue|failed because|阻塞|无法继续)/.test(lower)) return 'blocked';
  if (/(need your|please provide|can you provide|could you clarify|needs user|需要你|请提供|需要确认|等待你)/.test(lower)) return 'needs_user';
  return output.trim() ? 'completed' : 'blocked';
}

function extractGoalEvidence(output: string): string[] {
  const evidence: string[] = [];
  for (const raw of output.split('\n')) {
    const line = stripListMarker(raw.trim());
    if (!line) continue;
    if (
      /goal\s*status|completed|done|verified|created|updated|changed|fixed|tested|passed|blocked|needs/i.test(line)
      || /完成|验证|创建|更新|修改|修复|测试|通过|阻塞|需要/.test(line)
    ) {
      evidence.push(clampText(line, MAX_SUMMARY_CHARS));
    }
    if (evidence.length >= 6) break;
  }
  if (evidence.length > 0) return [...new Set(evidence)];
  const fallback = firstMeaningfulLine(output);
  return fallback ? [clampText(fallback, MAX_SUMMARY_CHARS)] : [];
}
