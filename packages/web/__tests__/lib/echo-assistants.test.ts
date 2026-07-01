import { describe, expect, it } from 'vitest';
import {
  ECHO_ASSISTANT_DEFAULT_PROMPTS,
  ECHO_ASSISTANT_IDS,
  ECHO_IMPRINT_ASSISTANT_ID,
  ECHO_INSIGHT_ASSISTANT_ID,
  ECHO_PROMOTION_ASSISTANT_ID,
  ECHO_THREADER_ASSISTANT_ID,
  buildEchoAssistantRunPrompt,
  buildEchoRecentSessionSummaries,
  getBuiltinEchoAssistantMarkdownFiles,
  getEchoAssistantMaxSteps,
  getEchoAssistantIdForSegment,
} from '@/lib/echo-assistants';
import type { ChatSession } from '@/lib/types';

describe('echo assistants', () => {
  it('defines one read-only built-in assistant for each Echo module', () => {
    expect(ECHO_ASSISTANT_IDS).toEqual([
      ECHO_IMPRINT_ASSISTANT_ID,
      ECHO_THREADER_ASSISTANT_ID,
      ECHO_INSIGHT_ASSISTANT_ID,
      ECHO_PROMOTION_ASSISTANT_ID,
    ]);

    expect(getEchoAssistantIdForSegment('overview')).toBeUndefined();
    expect(getEchoAssistantIdForSegment('imprint')).toBe('echo-imprint');
    expect(getEchoAssistantIdForSegment('threads')).toBe('echo-threader');
    expect(getEchoAssistantIdForSegment('growth')).toBe('echo-insight');
    expect(getEchoAssistantIdForSegment('practice')).toBe('echo-promotion');
    expect(ECHO_ASSISTANT_IDS).not.toContain('echo-practice');
    expect(getEchoAssistantMaxSteps(ECHO_IMPRINT_ASSISTANT_ID)).toBe(10);
    expect(getEchoAssistantMaxSteps(ECHO_THREADER_ASSISTANT_ID)).toBe(12);
    expect(getEchoAssistantMaxSteps(ECHO_INSIGHT_ASSISTANT_ID)).toBe(12);
    expect(getEchoAssistantMaxSteps(ECHO_PROMOTION_ASSISTANT_ID)).toBe(12);

    for (const assistantId of ECHO_ASSISTANT_IDS) {
      const prompt = ECHO_ASSISTANT_DEFAULT_PROMPTS[assistantId];
      expect(prompt).toContain('version: 1');
      expect(prompt).toContain('mode: subagent');
      expect(prompt).toContain('permissionMode: read');
      expect(prompt).toContain('hidden: true');
      expect(prompt).toContain('Return Markdown only');
      expect(prompt).toContain('Do not invent');
      expect(prompt).not.toContain('assistantId:');
    }
  });

  it('exposes built-in Markdown files under the unified assistant path', () => {
    expect(getBuiltinEchoAssistantMarkdownFiles().map((item) => item.path)).toEqual([
      '.mindos/assistants/echo-imprint.md',
      '.mindos/assistants/echo-threader.md',
      '.mindos/assistants/echo-insight.md',
      '.mindos/assistants/echo-promotion.md',
    ]);
    expect(getBuiltinEchoAssistantMarkdownFiles().map((item) => item.path)).not.toContain('.mindos/assistants/echo-practice.md');
  });

  it('builds localized Markdown output contracts from visible Echo context', () => {
    const prompt = buildEchoAssistantRunPrompt({
      locale: 'zh',
      segment: 'practice',
      segmentTitle: '承接',
      lead: '把 Agent 工作中的有效思路承接成方法卡或可验证实践。',
      snapshotTitle: '把值得延续的东西承接下来',
      snapshotBody: '把有效思路提升为方法或实践。',
      facts: [
        { label: '待承接', value: '先写验收标准，再动代码。' },
      ],
      recentSessions: [
        {
          title: '修复 Echo 页面',
          lastUserMessage: '这里为什么会丢失脉络？',
          runtime: 'Codex',
          messageCount: 8,
        },
      ],
    });

    expect(prompt).toContain('Write in Simplified Chinese');
    expect(prompt).toContain('# 承接');
    expect(prompt).toContain('kind: playbook | practice');
    expect(prompt).toContain('## 内容');
    expect(prompt).toContain('## 来源');
    expect(prompt).toContain('## 人工确认');
    expect(prompt).not.toContain('## 去向');
    expect(prompt).not.toContain('## 为什么承接');
    expect(prompt).not.toContain('## 边界');
    expect(prompt).toContain('待承接: 先写验收标准，再动代码。');
    expect(prompt).toContain('修复 Echo 页面');
    expect(prompt).toContain('Do not use tools unless the user explicitly asks');
  });

  it('frames imprint output as a concrete practice event', () => {
    const prompt = buildEchoAssistantRunPrompt({
      locale: 'zh',
      segment: 'imprint',
      segmentTitle: '印迹',
      lead: '保存一次真实 AI 协作现场。',
      snapshotTitle: '从一行开始',
      snapshotBody: '先留下发生了什么。',
      facts: [
        { label: '当前会话', value: '用户指出 sidebar 激活态抖动，最后修复为稳定 Home 状态。' },
      ],
    });

    expect(prompt).toContain('# 印迹');
    expect(prompt).toContain('kind: digest | moment');
    expect(prompt).toContain('## 内容');
    expect(prompt).toContain('## 来源');
    expect(prompt).not.toContain('## 下一步');
    expect(prompt).toContain('当前会话: 用户指出 sidebar 激活态抖动');
  });

  it('summarizes recent sessions without carrying the full conversation', () => {
    const sessions: ChatSession[] = [
      makeSession({
        id: 'old',
        updatedAt: 1,
        messages: [{ role: 'user', content: 'old session content' }],
      }),
      makeSession({
        id: 'new',
        title: 'Echo polish',
        updatedAt: 3,
        runtime: { id: 'codex', name: 'Codex', kind: 'codex' },
        messages: [
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'please explain the why and how'.repeat(20) },
        ],
      }),
      makeSession({
        id: 'empty',
        updatedAt: 4,
        messages: [{ role: 'assistant', content: 'no user input' }],
      }),
    ];

    const summaries = buildEchoRecentSessionSummaries(sessions, 2);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      title: 'Echo polish',
      runtime: 'Codex',
      messageCount: 2,
    });
    expect(summaries[0].lastUserMessage?.length).toBeLessThanOrEqual(220);
    expect(summaries[1]).toMatchObject({
      title: 'old session content',
      messageCount: 1,
    });
  });
});

function makeSession(input: {
  id: string;
  title?: string;
  updatedAt: number;
  runtime?: ChatSession['defaultAgentRuntime'];
  messages: ChatSession['messages'];
}): ChatSession {
  return {
    id: input.id,
    ...(input.title ? { title: input.title } : {}),
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    messages: input.messages,
    ...(input.runtime ? { defaultAgentRuntime: input.runtime } : {}),
  };
}
