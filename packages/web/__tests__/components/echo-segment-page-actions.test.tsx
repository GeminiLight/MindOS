// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EchoSegmentPageClient from '@/components/echo/EchoSegmentPageClient';
import { openAskModal } from '@/hooks/useAskModal';
import { messages } from '@/lib/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const consumeUIMessageStreamMock = vi.hoisted(() => vi.fn(async (_body, onUpdate: (message: { role: string; content: string }) => void) => {
  onUpdate({ role: 'assistant', content: '# 洞察\n\n## 模式\n\nGenerated insight.' });
  return { role: 'assistant', content: '# 洞察\n\n## 模式\n\nGenerated insight.' };
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'zh' as const, setLocale: () => {}, t: messages.zh }),
}));

vi.mock('@/lib/agent-session-store', () => ({
  resetAgentSessionStoreForTests: vi.fn(),
  useSessions: () => [],
}));

vi.mock('@/hooks/useAskModal', () => ({
  openAskModal: vi.fn(),
}));

vi.mock('@/hooks/useSettingsAiAvailable', () => ({
  useSettingsAiAvailable: () => ({ ready: true, loading: false }),
}));

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: consumeUIMessageStreamMock,
}));

describe('Echo segment page actions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/echo/imprints') {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) as { id?: unknown; schedule?: unknown } : {};
        if (method === 'PATCH' && body.schedule) {
          return jsonResponse({
            ok: true,
            state: imprintApiState('auto', 1, body.schedule),
            cards: imprintApiCards(),
          });
        }
        if (method === 'PATCH' || method === 'DELETE') {
          return jsonResponse({
            ok: true,
            state: imprintApiState(method === 'DELETE' ? 'manual' : 'auto', 2),
            cards: method === 'DELETE'
              ? imprintApiCards().filter((card) => card.id !== body.id)
              : imprintApiCards(),
          });
        }
        return jsonResponse({
          state: imprintApiState(method === 'POST' ? 'manual' : 'auto', method === 'POST' ? 2 : 1),
          cards: imprintApiCards(),
        });
      }
      if (url.startsWith('/api/echo?segment=imprint&path=')) {
        return jsonResponse({
          item: {
            type: 'echo.imprint',
            segment: 'imprint',
            title: '修复 sidebar 激活态抖动',
            path: 'Echo/Daily/2026/06/2026-06-23.md',
            date: '2026-06-23',
            updatedAt: '2026-06-23T00:00:00.000Z',
            excerpt: '点击 logo 后 rail 激活态短暂跳到 Wiki，最后修复为稳定 Home 状态。',
            markdown: [
              '# 修复 sidebar 激活态抖动',
              '',
              '## 现场',
              '',
              '点击 logo 后 rail 激活态短暂跳到 Wiki。',
              '',
              '## 结果',
              '',
              '- 稳定回到 Home。',
              '- 避免用户误以为进入 Wiki。',
              '',
              '## 关键片段',
              '',
              'Rail 状态来自路由切换。',
              '',
              '## 待梳理',
              '',
              '- 是否需要为 Home sidebar 补回归截图？',
            ].join('\n'),
            assistantId: 'echo-imprint',
          },
        });
      }
      if (url === '/api/echo?segment=imprint') {
        return jsonResponse({
          updatedAt: '2026-06-23T00:00:00.000Z',
          items: [
            {
              type: 'echo.imprint',
              segment: 'imprint',
              title: '修复 sidebar 激活态抖动',
              path: 'Echo/Daily/2026/06/2026-06-23.md',
              date: '2026-06-23',
              updatedAt: '2026-06-23T00:00:00.000Z',
              excerpt: '点击 logo 后 rail 激活态短暂跳到 Wiki，最后修复为稳定 Home 状态。',
              assistantId: 'echo-imprint',
            },
          ],
        });
      }
      if (url.startsWith('/api/echo?segment=growth&path=')) {
        return jsonResponse({
          item: {
            type: 'echo.insight',
            segment: 'growth',
            title: '洞察',
            path: 'Echo/Insights/洞察.md',
            date: '2026-06-22',
            updatedAt: '2026-06-22T00:00:00.000Z',
            excerpt: 'Generated insight.',
            markdown: '# 洞察\n\n## 模式\n\nGenerated insight.',
            assistantId: 'echo-insight',
          },
        });
      }
      if (url.startsWith('/api/echo') && (!init || init.method !== 'POST')) {
        return jsonResponse({ updatedAt: '2026-06-22T00:00:00.000Z', items: [] });
      }
      if (url === '/api/echo' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { op?: string };
        if (body.op === 'save') {
          return jsonResponse({
            ok: true,
            item: {
              type: 'echo.insight',
              segment: 'growth',
              title: '洞察',
              path: 'Echo/Insights/洞察.md',
              date: '2026-06-22',
              updatedAt: '2026-06-22T00:00:00.000Z',
              excerpt: 'Generated insight.',
              assistantId: 'echo-insight',
            },
          });
        }
        return jsonResponse({ ok: true, draft: { status: 'draft' } });
      }
      return new Response('event-stream', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    consumeUIMessageStreamMock.mockClear();
    vi.mocked(openAskModal).mockClear();
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('keeps assistant actions out of the breadcrumb area and returns Insight to Overview', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    const backLink = host.querySelector('a[href="/echo/overview"]');
    const insightBackLink = host.querySelector('a[href="/echo/growth"]');
    expect(backLink).not.toBeNull();
    expect(backLink?.textContent).toContain(messages.zh.echoPages.backToOverviewLabel);
    expect(backLink?.getAttribute('aria-label')).toBe(messages.zh.echoPages.backToOverviewAriaLabel);
    expect(insightBackLink).toBeNull();

    const actionButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-insight-generate-button"]');
    expect(actionButton).not.toBeNull();
    expect(actionButton?.getAttribute('aria-label')).toBe(messages.zh.echoPages.insightGenerateAriaLabel);

    await act(async () => {
      actionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant-runs', expect.objectContaining({
      method: 'POST',
    }));
    const assistantCall = fetchMock.mock.calls.find(([url]) => url === '/api/assistant-runs');
    expect(assistantCall).toBeTruthy();
    const [, init] = assistantCall!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      assistantId: 'echo-insight',
      permissionMode: 'read',
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('You are running the Echo Insight assistant inside MindOS Echo.'),
        },
      ],
    });
    expect(host.textContent).toContain('Generated insight.');
  });

  it('shows secondary Echo pages as support routes back to Insight', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="threads" />);
    });

    const backLink = host.querySelector('a[href="/echo/growth"]');
    expect(backLink).not.toBeNull();
    expect(backLink?.textContent).toContain(messages.zh.echoPages.backToInsightsLabel);
    expect(backLink?.getAttribute('aria-label')).toBe(messages.zh.echoPages.backToInsightsAriaLabel);
  });

  it('returns Imprint and Promotion to the Echo overview', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    let overviewBackLink = host.querySelector('a[href="/echo/overview"]');
    expect(overviewBackLink).not.toBeNull();
    expect(overviewBackLink?.textContent).toContain(messages.zh.echoPages.backToOverviewLabel);
    expect(overviewBackLink?.getAttribute('aria-label')).toBe(messages.zh.echoPages.backToOverviewAriaLabel);
    expect(host.querySelector('a[href="/echo/growth"]')).toBeNull();

    await act(async () => {
      root.render(<EchoSegmentPageClient segment="practice" />);
    });

    overviewBackLink = host.querySelector('a[href="/echo/overview"]');
    expect(overviewBackLink).not.toBeNull();
    expect(overviewBackLink?.textContent).toContain(messages.zh.echoPages.backToOverviewLabel);
    expect(overviewBackLink?.getAttribute('aria-label')).toBe(messages.zh.echoPages.backToOverviewAriaLabel);
    expect(host.querySelector('a[href="/echo/growth"]')).toBeNull();
  });

  it('renders Promotion as a playbook and practice surface', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="practice" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const promotion = host.querySelector('[data-testid="echo-promotion"]');
    expect(promotion).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-worktable"]')).toBeNull();
    expect(host.textContent).toContain(messages.zh.echoPages.promotionReviewTitle);
    expect(promotion?.textContent).toContain(messages.zh.echoPages.echoGeneratedStatusLine(
      messages.zh.echoPages.imprintCardsCheckpointLabel,
      messages.zh.echoPages.imprintScheduleDailyAt('20:00'),
    ));
    expect(promotion?.textContent).not.toContain('14:36 生成');
    expect(promotion?.textContent).not.toContain('个会话');
    expect(promotion?.textContent).not.toContain('2 条');
    expect(promotion?.textContent).toContain(messages.zh.echoPages.promotionPlaybooksLabel);
    expect(promotion?.textContent).toContain(messages.zh.echoPages.promotionPracticesLabel);
    expect(promotion?.textContent).toContain(messages.zh.echoPages.promotionPlaybookLabel);
    expect(promotion?.textContent).toContain(messages.zh.echoPages.promotionPracticeLabel);
    expect(promotion?.textContent).not.toContain('今天 · 14:36');
    expect(promotion?.textContent).not.toContain('来自最近 Agent 工作');
    expect(host.querySelector('[data-testid="echo-promotion-tab-recent"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-promotion-tabs"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="echo-promotion-candidate"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="echo-card-chat-button"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="echo-playbook-card"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="echo-promotion-practice-card"]')).toHaveLength(0);
    expect(host.querySelector('[data-testid="echo-ai-draft-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-memory-reader-layout"]')).toBeNull();
    expect(host.textContent).not.toContain(messages.zh.echoPages.practiceReaderSubtitle);
    expect(promotion?.textContent).not.toContain('去向');

    const firstPromotionChat = host.querySelector<HTMLButtonElement>('[data-testid="echo-card-chat-button"]');
    expect(firstPromotionChat).not.toBeNull();
    await act(async () => {
      firstPromotionChat?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openAskModal).toHaveBeenCalledWith(
      expect.stringContaining(messages.zh.echoPages.promotionCandidates[0]?.title ?? ''),
      'user',
      null,
      { newSession: true },
    );
    vi.mocked(openAskModal).mockClear();

    const scheduleButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-promotion-schedule-button"]');
    expect(scheduleButton).not.toBeNull();
    expect(scheduleButton?.getAttribute('aria-label')).toBe(messages.zh.echoPages.promotionScheduleAction);
    expect(scheduleButton?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="echo-promotion-schedule-panel"]')).toBeNull();

    await act(async () => {
      scheduleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(scheduleButton?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="echo-promotion-schedule-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-promotion-schedule-status"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleDailyAt('20:00'));

    const intervalMode = host.querySelector<HTMLButtonElement>('[data-testid="echo-promotion-schedule-mode-interval"]');
    expect(intervalMode).not.toBeNull();
    await act(async () => {
      intervalMode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(intervalMode?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="echo-promotion-schedule-status"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleIntervalHours(24));
    expect(promotion?.textContent).toContain(messages.zh.echoPages.echoGeneratedStatusLine(
      messages.zh.echoPages.imprintCardsCheckpointLabel,
      messages.zh.echoPages.imprintScheduleIntervalHours(24),
    ));

    const playbooksFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-promotion-filter-playbook"]');
    const practicesFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-promotion-filter-practice"]');
    expect(playbooksFilter).not.toBeNull();
    expect(practicesFilter).not.toBeNull();
    expect(playbooksFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(practicesFilter?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      practicesFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(practicesFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelectorAll('[data-testid="echo-promotion-candidate"]')).toHaveLength(1);
    expect(promotion?.textContent).toContain(messages.zh.echoPages.promotionCandidates[0]?.title);
    expect(promotion?.textContent).not.toContain(messages.zh.echoPages.promotionCandidates[1]?.title);

    await act(async () => {
      practicesFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(practicesFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid="echo-promotion-candidate"]')).toHaveLength(2);

    const draftButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.getAttribute('aria-label') === messages.zh.echoPages.promotionGenerateAriaLabel,
    );
    expect(draftButton).toBeTruthy();
    await act(async () => {
      draftButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const assistantCall = fetchMock.mock.calls.find(([url]) => url === '/api/assistant-runs');
    expect(assistantCall).toBeTruthy();
    const [, init] = assistantCall!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      assistantId: 'echo-promotion',
      permissionMode: 'read',
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('You are running the Echo Promotion assistant inside MindOS Echo.'),
        },
      ],
    });
  });

  it('keeps the Imprint header free of ambiguous generation actions', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    const backLink = host.querySelector('a[href="/echo/overview"]');
    expect(backLink).not.toBeNull();
    expect(backLink?.textContent).toContain(messages.zh.echoPages.backToOverviewLabel);
    expect(backLink?.getAttribute('aria-label')).toBe(messages.zh.echoPages.backToOverviewAriaLabel);

    const pageShell = host.querySelector('[data-content-page-shell="echo"]');
    expect(pageShell?.className).toContain('echo-content-page');

    expect(host.querySelector('[data-echo-page-actions]')).toBeNull();
    expect(host.querySelector('[data-echo-imprint-actions-menu-trigger]')).toBeNull();
    const buttonsText = Array.from(host.querySelectorAll('button')).map((button) => button.textContent ?? '').join(' ');
    expect(buttonsText).not.toContain(messages.zh.echoPages.assistantGenerateImprint);
    expect(buttonsText).not.toContain(messages.zh.echoPages.continueRecordLabel);
    expect(buttonsText).not.toContain(messages.zh.echoPages.dailyReportGenerate);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/assistant-runs')).toBe(false);
  });

  it('keeps Insight free of the legacy saved reader', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="echo-memory-reader-layout"]')).toBeNull();
    expect(host.querySelector('#echo-memory-reader-title')).toBeNull();
    expect(host.textContent).not.toContain(messages.zh.echoPages.growthReaderEmptyLabel);
    expect(host.textContent).not.toContain(messages.zh.echoPages.echoSavedListTitle);
    expect(host.textContent).not.toContain(messages.zh.echoPages.growthReaderSubtitle);
    expect(host.textContent).not.toContain(messages.zh.echoPages.echoReaderDetailEmptyLabel);
    expect(host.textContent).not.toContain(messages.zh.echoPages.growthReaderDetailEmptyLabel);
    expect(host.textContent).not.toContain('样例：从修复到脉络');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/echo?segment=growth')).toBe(false);
  });

  it('renders Insight as a quiet pattern and judgment surface', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const insight = host.querySelector('[data-testid="echo-insight"]');
    expect(insight).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-worktable"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-insight-control-row"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-insight-filters"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-insight-actions"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-insight-generate-button"]')).not.toBeNull();
    expect(insight?.textContent).toContain(messages.zh.echoPages.echoGeneratedStatusLine(
      messages.zh.echoPages.insightStatusSourceLabel,
      messages.zh.echoPages.imprintScheduleDailyAt('20:00'),
    ));
    expect(host.querySelector('[data-testid="echo-ai-draft-panel"]')).toBeNull();

    const scheduleButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-insight-schedule-button"]');
    expect(scheduleButton).not.toBeNull();
    expect(scheduleButton?.getAttribute('aria-label')).toBe(messages.zh.echoPages.insightScheduleAction);
    expect(scheduleButton?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="echo-insight-schedule-panel"]')).toBeNull();

    await act(async () => {
      scheduleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(scheduleButton?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="echo-insight-schedule-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-insight-schedule-status"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleDailyAt('20:00'));

    const intervalMode = host.querySelector<HTMLButtonElement>('[data-testid="echo-insight-schedule-mode-interval"]');
    expect(intervalMode).not.toBeNull();
    await act(async () => {
      intervalMode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(intervalMode?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="echo-insight-schedule-status"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleIntervalHours(24));
    expect(insight?.textContent).toContain(messages.zh.echoPages.echoGeneratedStatusLine(
      messages.zh.echoPages.insightStatusSourceLabel,
      messages.zh.echoPages.imprintScheduleIntervalHours(24),
    ));

    const patternFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-insight-filter-pattern"]');
    const judgmentFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-insight-filter-judgment"]');
    expect(patternFilter).not.toBeNull();
    expect(judgmentFilter).not.toBeNull();
    expect(patternFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(judgmentFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid="echo-insight-candidate"]')).toHaveLength(4);
    expect(host.querySelectorAll('[data-testid="echo-card-chat-button"]')).toHaveLength(4);
    expect(insight?.textContent).toContain(messages.zh.echoPages.insightPatternLabel);
    expect(insight?.textContent).toContain(messages.zh.echoPages.insightJudgmentLabel);
    expect(insight?.textContent).toContain(messages.zh.echoPages.insightCandidates[0]?.title);
    expect(insight?.textContent).toContain(messages.zh.echoPages.insightCandidates[1]?.title);

    const firstInsightChat = host.querySelector<HTMLButtonElement>('[data-testid="echo-card-chat-button"]');
    expect(firstInsightChat).not.toBeNull();
    await act(async () => {
      firstInsightChat?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openAskModal).toHaveBeenCalledWith(
      expect.stringContaining(messages.zh.echoPages.insightCandidates[0]?.title ?? ''),
      'user',
      null,
      { newSession: true },
    );
    vi.mocked(openAskModal).mockClear();

    await act(async () => {
      judgmentFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(judgmentFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelectorAll('[data-testid="echo-insight-candidate"]')).toHaveLength(2);
    expect(insight?.textContent).toContain(messages.zh.echoPages.insightCandidates[0]?.title);
    expect(insight?.textContent).not.toContain(messages.zh.echoPages.insightCandidates[1]?.title);

    await act(async () => {
      patternFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(patternFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid="echo-insight-candidate"]')).toHaveLength(2);

    await act(async () => {
      judgmentFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(judgmentFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid="echo-insight-candidate"]')).toHaveLength(4);

    expect(host.querySelector('[data-testid="echo-insight-support"]')).toBeNull();
    expect(host.textContent).not.toContain('证据与承接');
    expect(host.textContent).not.toContain('Evidence and promotion');
  });

  it('saves generated Echo markdown and displays the saved item on the page', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    const actionButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-insight-generate-button"]');
    await act(async () => {
      actionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const saveButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(messages.zh.echoPages.echoSaveLabel),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const saveCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/echo' && init?.method === 'POST' && String(init.body).includes('"op":"save"'));
    expect(saveCall).toBeTruthy();
    expect(host.textContent).toContain(messages.zh.echoPages.echoSavedLabel);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="echo-worktable"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-memory-reader-layout"]')).toBeNull();
    expect(host.querySelector('#echo-memory-reader-title')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/echo?segment=growth&path='))).toBe(false);
    expect(host.textContent).toContain('Generated insight.');
    expect(host.textContent).not.toContain('Echo/Insights/洞察.md');
    expect(host.querySelector('a[href="/view/Echo/Insights/%E6%B4%9E%E5%AF%9F.md"]')).toBeNull();
  });

  it('keeps the Imprint page focused on generated imprints without the legacy contract or event reader', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="echo-imprint-generated-list"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-page-contract"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-worktable"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-memory-reader-layout"]')).toBeNull();
    expect(host.textContent).not.toContain(messages.zh.echoPages.echoFlowTitle);
    expect(host.textContent).not.toContain('实践事件');
    expect(host.textContent).not.toContain('修复 sidebar 激活态抖动');
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/echo?segment=imprint'))).toBe(false);
  });

  it('renders generated imprints without forcing card type filters on the Imprint page', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const surface = host.querySelector('[data-testid="echo-imprint-generated-list"]');
    expect(surface).not.toBeNull();
    expect(surface?.textContent).toContain(messages.zh.echoPages.echoGeneratedStatusLine(
      messages.zh.echoPages.imprintCardsCheckpointLabel,
      messages.zh.echoPages.imprintScheduleDailyAt('20:00'),
    ));
    expect(surface?.textContent).not.toContain(`${messages.zh.echoPages.imprintCardsInitialUpdatedAt} 生成`);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsUpdateAction);
    expect(surface?.textContent).not.toContain(messages.zh.echoPages.imprintScheduleNextRun('20:00'));
    expect(surface?.textContent).not.toContain(messages.zh.echoPages.imprintDigestTitle);
    expect(surface?.textContent).not.toContain('最近协作已生成');
    expect(surface?.textContent).not.toContain(messages.zh.echoPages.imprintMomentsTitle);
    expect(surface?.textContent).toContain('Imprint 不再做分类系统');
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardCreatedLabel);
    expect(surface?.textContent).toContain('14:12');
    expect(surface?.textContent).toContain('Insight 承接模式和判断');
    expect(surface?.textContent).toContain('Promotion 承接方法卡和实践');
    expect(surface?.textContent).not.toContain('Event');
    expect(surface?.textContent).not.toContain('Signal');
    expect(surface?.textContent).not.toContain('Next');
    expect(surface?.textContent).not.toContain('生成的 Imprint');
    expect(surface?.textContent).not.toContain('从当前 session 窗口自动生成');
    expect(surface?.textContent).not.toContain('审阅队列');
    expect(surface?.textContent).not.toContain('先由人审阅');
    expect(surface?.textContent).not.toContain('保存');
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-all"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-event"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-signal"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-next"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-tabs"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-tab-digest"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-tab-moments"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-digest"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-moments"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="echo-imprint-card"]')).toHaveLength(5);
    expect(host.querySelectorAll('[data-testid="echo-imprint-created-at"]')).toHaveLength(5);
    expect(host.querySelectorAll('[data-testid="echo-card-chat-button"]')).toHaveLength(5);
    expect(host.querySelector('[data-testid="echo-imprint-generation-status"]')).not.toBeNull();

    const updateButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-update-button"]');
    expect(updateButton).not.toBeNull();
    await act(async () => {
      updateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/echo?segment=imprint'))).toBe(false);

    expect(host.querySelector('[data-testid="echo-imprint-moments"]')).not.toBeNull();
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardCreatedLabel);
    expect(surface?.textContent).toContain('14:12');
    expect(surface?.textContent).toContain('Insight 承接模式和判断');
    expect(surface?.textContent).toContain('Promotion 承接方法卡和实践');
    expect(host.querySelectorAll('[data-testid="echo-imprint-card"]')).toHaveLength(5);
    expect(host.querySelectorAll('[data-testid="echo-imprint-created-at"]')).toHaveLength(5);

    const surfaceButtons = () => Array.from(surface?.querySelectorAll('button') ?? []);
    const chatButton = surfaceButtons().find((button) =>
      button.textContent?.includes(messages.zh.echoPages.echoCardChatLabel),
    );
    expect(chatButton).toBeTruthy();

    await act(async () => {
      chatButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openAskModal).toHaveBeenCalledWith(
      expect.stringContaining('Imprint 不再做分类系统'),
      'user',
      null,
      { newSession: true },
    );
    vi.mocked(openAskModal).mockClear();

    const editButton = surfaceButtons().find((button) =>
      button.textContent?.includes(messages.zh.echoPages.imprintCardEditLabel),
    );
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(surface?.querySelector('textarea')).not.toBeNull();
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardDoneLabel);

    const deleteButton = surfaceButtons().find((button) =>
      button.textContent?.includes(messages.zh.echoPages.imprintCardDeleteLabel),
    );
    expect(deleteButton).toBeTruthy();

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(surface?.textContent).not.toContain('Imprint 不再做分类系统');
    expect(host.querySelector('[data-testid="echo-imprint-digest"]')).toBeNull();
    expect(surface?.textContent).not.toContain('最近协作已生成');
    expect(host.querySelectorAll('[data-testid="echo-imprint-card"]')).toHaveLength(4);
  });

  it('shows one unified empty state when no imprint cards are available', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/echo/imprints') {
        const method = init?.method ?? 'GET';
        return jsonResponse({
          state: imprintApiState(method === 'POST' ? 'manual' : 'auto', 1),
          cards: [],
        });
      }
      if (url.startsWith('/api/echo') && (!init || init.method !== 'POST')) {
        return jsonResponse({ updatedAt: '2026-06-22T00:00:00.000Z', items: [] });
      }
      return jsonResponse({ ok: true });
    });

    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const surface = host.querySelector('[data-testid="echo-imprint-generated-list"]');
    expect(surface).not.toBeNull();
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsEmptyLabel);
    expect(host.querySelectorAll('[data-testid="echo-imprint-empty"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="echo-imprint-digest"]')).toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-moments-empty"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="echo-imprint-card"]')).toHaveLength(0);
  });

  it('lets the user configure the Imprint generation schedule without auto-generating every minute', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter(([url, init]) => (
      url === '/api/echo/imprints' && init?.method === 'POST'
    ))).toHaveLength(0);

    const scheduleButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-schedule-button"]');
    expect(scheduleButton).not.toBeNull();
    await act(async () => {
      scheduleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const panel = host.querySelector('[data-testid="echo-imprint-schedule-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain(messages.zh.echoPages.imprintScheduleDailyLabel);
    expect(panel?.textContent).toContain(messages.zh.echoPages.imprintScheduleManualLabel);

    const modeGroup = host.querySelector('[data-testid="echo-imprint-schedule-mode"]');
    expect(modeGroup).not.toBeNull();
    const dailyMode = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-schedule-mode-daily"]');
    const intervalMode = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-schedule-mode-interval"]');
    const manualMode = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-schedule-mode-manual"]');
    expect(dailyMode?.getAttribute('aria-pressed')).toBe('true');
    expect(intervalMode).not.toBeNull();
    expect(manualMode).not.toBeNull();

    await act(async () => {
      intervalMode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const modePatchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/echo/imprints'
      && init?.method === 'PATCH'
      && String(init.body).includes('"mode":"interval"')
    ));
    expect(modePatchCall).toBeTruthy();
    expect(intervalMode?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="echo-imprint-schedule-save-state"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleIntervalHours(24));

    const intervalSelect = host.querySelector<HTMLSelectElement>('[data-testid="echo-imprint-schedule-interval"]');
    expect(intervalSelect).not.toBeNull();
    await act(async () => {
      if (intervalSelect) intervalSelect.value = '6';
      intervalSelect?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const intervalPatchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/echo/imprints'
      && init?.method === 'PATCH'
      && String(init.body).includes('"intervalHours":6')
    ));
    expect(intervalPatchCall).toBeTruthy();
    expect(host.querySelector('[data-testid="echo-imprint-schedule-save-state"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleIntervalHours(6));

    await act(async () => {
      manualMode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const manualPatchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/echo/imprints'
      && init?.method === 'PATCH'
      && String(init.body).includes('"mode":"manual"')
    ));
    expect(manualPatchCall).toBeTruthy();
    expect(manualMode?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="echo-imprint-schedule-save-state"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleManualOnly);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imprintApiState(trigger: 'auto' | 'manual', runCount: number, schedule?: unknown) {
  return {
    schemaVersion: 1,
    checkpointAt: '2026-06-29T06:36:00.000Z',
    lastGeneratedAt: '2026-06-29T06:36:00.000Z',
    lastTrigger: trigger,
    runCount,
    windowMinutes: 90,
    activeCount: 5,
    schedule: schedule ?? {
      mode: 'daily',
      dailyTime: '20:00',
      intervalHours: 24,
      due: false,
      nextRunAt: '2026-06-29T12:00:00.000Z',
    },
  };
}

function imprintApiCards() {
  return messages.zh.echoPages.imprintCardCandidates.map((card, index) => ({
    ...card,
    id: `imprint-api-${index}`,
    confidence: 0.72,
    source: {
      label: card.source,
      sessionIds: [`session-${index}`],
    },
    evidence: {
      label: card.evidence,
    },
    status: 'active',
    generatedAt: '2026-06-29T06:36:00.000Z',
    updatedAt: '2026-06-29T06:36:00.000Z',
  }));
}
