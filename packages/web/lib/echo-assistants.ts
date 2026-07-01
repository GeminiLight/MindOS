import type { ChatSession } from './types';
import type { EchoSegment } from './echo-segments';
import { getAssistantMarkdownPath } from './mind-system-assistant-paths';

export const ECHO_IMPRINT_ASSISTANT_ID = 'echo-imprint';
export const ECHO_THREADER_ASSISTANT_ID = 'echo-threader';
export const ECHO_INSIGHT_ASSISTANT_ID = 'echo-insight';
export const ECHO_PROMOTION_ASSISTANT_ID = 'echo-promotion';

export const ECHO_ASSISTANT_IDS = [
  ECHO_IMPRINT_ASSISTANT_ID,
  ECHO_THREADER_ASSISTANT_ID,
  ECHO_INSIGHT_ASSISTANT_ID,
  ECHO_PROMOTION_ASSISTANT_ID,
] as const;

export type EchoAssistantId = (typeof ECHO_ASSISTANT_IDS)[number];
export type EchoAssistantSegment = Exclude<EchoSegment, 'overview'>;

type EchoPromptLanguage = 'zh' | 'en';

export type EchoPromptFact = {
  label: string;
  value?: string | number | boolean | null;
};

export type EchoRecentSessionSummary = {
  title: string;
  lastUserMessage?: string;
  runtime?: string;
  messageCount: number;
  updatedAt?: number;
};

export type EchoAssistantRunPromptOptions = {
  locale: EchoPromptLanguage;
  segment: EchoAssistantSegment;
  segmentTitle: string;
  lead: string;
  snapshotTitle: string;
  snapshotBody: string;
  facts?: EchoPromptFact[];
  recentSessions?: EchoRecentSessionSummary[];
};

type EchoAssistantDefinition = {
  id: EchoAssistantId;
  name: string;
  description: string;
  color: string;
  steps: number;
  body: string;
};

const ECHO_ASSISTANT_DEFINITIONS: Record<EchoAssistantId, EchoAssistantDefinition> = {
  [ECHO_IMPRINT_ASSISTANT_ID]: {
    id: ECHO_IMPRINT_ASSISTANT_ID,
    name: 'Echo Imprint',
    description: 'Turn recent AI-coding context into a concise Digest or Moment imprint without inventing facts.',
    color: 'amber',
    steps: 10,
    body: `# Echo Imprint

## Role

Turn recent AI-coding context into a concise, reviewable imprint card.

## Inputs

- The current Echo Imprint page context
- The user's daily line, if present
- Recent session summaries when the app provides them

## Output

Return Markdown only. Choose kind: Digest when summarizing the whole provided window, or Moment when capturing one concrete collaboration trace. Keep the card body in Content and keep provenance in Source.

## Boundaries

- Do not invent files, sessions, moods, outcomes, or hidden activity.
- If the provided context is thin, say what is missing and offer precise reflection prompts.
- Do not write, rename, delete, or reorganize knowledge-base files.
- Keep the tone warm, restrained, and concrete.`,
  },
  [ECHO_THREADER_ASSISTANT_ID]: {
    id: ECHO_THREADER_ASSISTANT_ID,
    name: 'Echo Threader',
    description: 'Connect recurring sessions, choices, and questions into a clear Markdown thread.',
    color: 'graphite',
    steps: 12,
    body: `# Echo Threader

## Role

Help the user see the thread behind repeated questions, decisions, and tradeoffs.

## Inputs

- The current Echo Thread page context
- Selected thread details visible on the page
- Recent session summaries when the app provides them

## Output

Return Markdown only. Explain what the thread is, why it keeps returning, and what remains uncertain.

## Boundaries

- Do not invent facts, files, sessions, outcomes, or hidden activity.
- Do not expose private chain-of-thought. Summarize observable context and user-facing rationale.
- Do not claim to have read the whole knowledge base unless the context explicitly says so.
- Separate source from interpretation.
- Do not write, rename, delete, or reorganize knowledge-base files.`,
  },
  [ECHO_INSIGHT_ASSISTANT_ID]: {
    id: ECHO_INSIGHT_ASSISTANT_ID,
    name: 'Echo Insight',
    description: 'Distill visible Echo context into a reusable Pattern or Judgment insight.',
    color: 'sage',
    steps: 12,
    body: `# Echo Insight

## Role

Distill recurring patterns into reusable insight the user can apply next time.

## Inputs

- The current Echo Insight page context
- The user's current intent, if present
- Recent session summaries when the app provides them

## Output

Return Markdown only. Choose kind: Pattern for a recurring shape, or Judgment for a decision rule. Keep interpretation in Content and keep provenance in Source.

## Boundaries

- Do not invent facts, files, sessions, outcomes, or hidden activity.
- Do not turn a weak signal into a certainty.
- Preserve uncertainty and name missing source.
- Avoid motivational filler.
- Do not write, rename, delete, or reorganize knowledge-base files.`,
  },
  [ECHO_PROMOTION_ASSISTANT_ID]: {
    id: ECHO_PROMOTION_ASSISTANT_ID,
    name: 'Echo Promotion',
    description: 'Turn useful agent work traces into a Promotion card: Playbook or Practice.',
    color: 'amber',
    steps: 12,
    body: `# Echo Promotion

## Role

Turn useful traces of agent work into one Promotion card.

## Inputs

- The current Echo Promotion page context
- Visible Promotion candidates
- The current insight or saved Echo item when provided
- Recent session summaries when the app provides them

## Output

Return Markdown only. Choose kind: Playbook if the trace should become a reusable method, or Practice if it should become a small action to verify. Keep the reusable method or action in Content and keep provenance in Source.

## Boundaries

- Do not invent facts, files, sessions, outcomes, or hidden activity.
- Do not expose private chain-of-thought. Summarize the observable work trace and user-facing method.
- Keep practices small enough to run in a real day.
- Keep playbooks concrete enough to reuse on a similar task.
- Do not pretend a promotion has already been accepted or inherited by the user.
- Do not write, rename, delete, or reorganize knowledge-base files.`,
  },
};

export const ECHO_ASSISTANT_BY_SEGMENT: Record<EchoAssistantSegment, EchoAssistantId> = {
  imprint: ECHO_IMPRINT_ASSISTANT_ID,
  threads: ECHO_THREADER_ASSISTANT_ID,
  growth: ECHO_INSIGHT_ASSISTANT_ID,
  practice: ECHO_PROMOTION_ASSISTANT_ID,
};

export const ECHO_ASSISTANT_DEFAULT_PROMPTS: Record<EchoAssistantId, string> = Object.fromEntries(
  ECHO_ASSISTANT_IDS.map((assistantId) => {
    const definition = ECHO_ASSISTANT_DEFINITIONS[assistantId];
    return [assistantId, serializeEchoAssistantMarkdown(definition)];
  }),
) as Record<EchoAssistantId, string>;

export function getEchoAssistantIdForSegment(segment: EchoSegment): EchoAssistantId | undefined {
  return segment === 'overview' ? undefined : ECHO_ASSISTANT_BY_SEGMENT[segment];
}

export function getEchoAssistantMaxSteps(assistantId: EchoAssistantId): number {
  return ECHO_ASSISTANT_DEFINITIONS[assistantId].steps;
}

export function getBuiltinEchoAssistantMarkdownFiles(): Array<{ assistantId: EchoAssistantId; path: string; content: string }> {
  return ECHO_ASSISTANT_IDS.map((assistantId) => ({
    assistantId,
    path: getAssistantMarkdownPath(assistantId),
    content: ECHO_ASSISTANT_DEFAULT_PROMPTS[assistantId],
  }));
}

export function buildEchoAssistantRunPrompt({
  locale,
  segment,
  segmentTitle,
  lead,
  snapshotTitle,
  snapshotBody,
  facts = [],
  recentSessions = [],
}: EchoAssistantRunPromptOptions): string {
  const lang = locale === 'zh' ? 'Simplified Chinese' : 'English';
  const output = outputContractForSegment(segment, locale);
  const visibleFacts = [
    { label: 'Section', value: segmentTitle },
    { label: 'Lead', value: lead },
    { label: 'Snapshot title', value: snapshotTitle },
    { label: 'Snapshot body', value: snapshotBody },
    ...facts,
  ];

  return [
    `You are running the ${ECHO_ASSISTANT_DEFINITIONS[ECHO_ASSISTANT_BY_SEGMENT[segment]].name} assistant inside MindOS Echo.`,
    '',
    `Write in ${lang}. Return Markdown only. Do not wrap the answer in a code block.`,
    '',
    '--- Visible Echo context ---',
    formatPromptFacts(visibleFacts),
    '---',
    '',
    '--- Recent session context ---',
    formatRecentSessions(recentSessions),
    '---',
    '',
    'Output contract:',
    output,
    '',
    'Rules:',
    '- Use only the provided visible context and recent session summaries.',
    '- If context is generic or too thin, say what is missing and offer useful reflection prompts instead of inventing facts.',
    '- Separate facts from interpretation.',
    '- Keep it concise, reviewable, and suitable to save as a Markdown note.',
    '- Do not use tools unless the user explicitly asks for deeper inspection.',
  ].join('\n').trim();
}

export function buildEchoRecentSessionSummaries(
  sessions: ChatSession[],
  limit = 4,
): EchoRecentSessionSummary[] {
  return [...sessions]
    .filter((session) => session.messages.some((message) => message.role === 'user' && message.content.trim()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit))
    .map((session) => {
      const lastUserMessage = [...session.messages]
        .reverse()
        .find((message) => message.role === 'user' && message.content.trim());
      return {
        title: summarizeSessionTitle(session),
        ...(lastUserMessage ? { lastUserMessage: truncateForPrompt(lastUserMessage.content, 220) } : {}),
        ...(sessionRuntimeLabel(session) ? { runtime: sessionRuntimeLabel(session) } : {}),
        messageCount: session.messages.length,
        updatedAt: session.updatedAt,
      };
    });
}

function serializeEchoAssistantMarkdown(definition: EchoAssistantDefinition): string {
  return `---
name: ${definition.name}
description: ${definition.description}
version: 1
mode: subagent
runtime: mindos
model: default
permissionMode: read
hidden: true
color: ${definition.color}
steps: ${definition.steps}
---

${definition.body}
`;
}

function outputContractForSegment(segment: EchoAssistantSegment, locale: EchoPromptLanguage): string {
  if (locale === 'zh') {
    switch (segment) {
      case 'imprint':
        return '- `# 印迹`\n- `kind: digest | moment`\n- `## 内容`\n- `## 来源`';
      case 'threads':
        return '- `# 脉络`\n- `## 现象`\n- `## 为什么会反复出现`\n- `## 可能的形成过程`\n- `## 仍不确定`';
      case 'growth':
        return '- `# 洞察`\n- `kind: pattern | judgment`\n- `## 内容`\n- `## 来源`';
      case 'practice':
        return '- `# 承接`\n- `kind: playbook | practice`\n- `## 内容`\n- `## 来源`\n- `## 人工确认`';
    }
  }

  switch (segment) {
    case 'imprint':
      return '- `# Imprint`\n- `kind: digest | moment`\n- `## Content`\n- `## Source`';
    case 'threads':
      return '- `# Thread`\n- `## Pattern`\n- `## Why It Returns`\n- `## How It May Have Formed`\n- `## Still Uncertain`';
    case 'growth':
      return '- `# Insight`\n- `kind: pattern | judgment`\n- `## Content`\n- `## Source`';
    case 'practice':
      return '- `# Promotion`\n- `kind: playbook | practice`\n- `## Content`\n- `## Source`\n- `## Human Check`';
  }
}

function formatPromptFacts(facts: EchoPromptFact[]): string {
  const lines = facts
    .map(({ label, value }) => {
      const normalized = normalizePromptValue(value);
      return normalized ? `- ${label}: ${normalized}` : null;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : '- No visible context.';
}

function formatRecentSessions(sessions: EchoRecentSessionSummary[]): string {
  if (sessions.length === 0) return '- No recent sessions were provided.';
  return sessions.map((session, index) => {
    const parts = [
      `${index + 1}. ${session.title}`,
      session.runtime ? `runtime: ${session.runtime}` : null,
      `messages: ${session.messageCount}`,
      session.lastUserMessage ? `last user message: ${session.lastUserMessage}` : null,
    ].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');
}

function normalizePromptValue(value: EchoPromptFact['value']): string {
  if (value === undefined || value === null) return '';
  return truncateForPrompt(String(value).replace(/\s+/g, ' ').trim(), 360);
}

function summarizeSessionTitle(session: ChatSession): string {
  if (session.title?.trim()) return truncateForPrompt(session.title, 80);
  const firstUser = session.messages.find((message) => message.role === 'user' && message.content.trim());
  return truncateForPrompt(firstUser?.content ?? '(untitled session)', 80);
}

function sessionRuntimeLabel(session: ChatSession): string | undefined {
  if (session.defaultAgentRuntime?.name) return session.defaultAgentRuntime.name;
  if (session.runtimeSessionBinding?.runtime) return session.runtimeSessionBinding.runtime;
  if (session.externalAgentBinding?.runtime) return session.externalAgentBinding.runtime;
  if (session.defaultAcpAgent?.name) return session.defaultAcpAgent.name;
  return undefined;
}

function truncateForPrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
