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
        const body = init?.body ? JSON.parse(String(init.body)) as { schedule?: unknown } : {};
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
            cards: imprintApiCards().slice(method === 'DELETE' ? 1 : 0),
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

  it('keeps assistant actions out of the breadcrumb area and runs the right-side Echo assistant CTA', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    const backLink = host.querySelector('a[href="/echo/overview"]');
    expect(backLink).not.toBeNull();
    expect(backLink?.parentElement?.textContent).toBe(messages.zh.echoPages.backToOverviewLabel);
    expect(backLink?.parentElement?.textContent).not.toContain(messages.zh.echoPages.assistantGenerateGrowth);
    expect(backLink?.parentElement?.textContent).not.toContain(messages.zh.echoPages.growthChatLabel);

    const actionButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(messages.zh.echoPages.growthChatLabel),
    );
    expect(actionButton).toBeTruthy();

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

  it('keeps the Imprint header free of ambiguous generation actions', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    const backLink = host.querySelector('a[href="/echo/overview"]');
    expect(backLink?.parentElement?.textContent).not.toContain(messages.zh.echoPages.assistantGenerateImprint);

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

  it('keeps empty saved Echo sections focused on the list empty state only', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain(messages.zh.echoPages.growthReaderEmptyLabel);
    expect(host.textContent).toContain(messages.zh.echoPages.growthReaderSubtitle);
    expect(host.textContent).not.toContain(messages.zh.echoPages.echoReaderDetailEmptyLabel);
    expect(host.textContent).not.toContain(messages.zh.echoPages.growthReaderDetailEmptyLabel);
  });

  it('shows each Echo segment as an input-output AI worktable', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const worktable = host.querySelector('[data-testid="echo-worktable"]');
    expect(worktable).not.toBeNull();
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowTitle);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowSourceLabel);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowGenerateLabel);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowSaveLabel);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowConsumeLabel);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.growthFlowSource);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.growthFlowGenerate);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.growthFlowSave);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.growthFlowConsume);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowNoSelection);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoWorktableSavedCount(0));
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoWorktableRecentCount(0));
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoWorktableAiBoundary);
    expect(worktable?.textContent).toContain(messages.zh.echoPages.growthChatLabel);
  });

  it('saves generated Echo markdown and displays the saved item on the page', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    const actionButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(messages.zh.echoPages.growthChatLabel),
    );
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

    const worktable = host.querySelector('[data-testid="echo-worktable"]');
    expect(worktable?.textContent).toContain(messages.zh.echoPages.echoFlowSelectedItem('洞察', 'Echo/Insights/洞察.md'));
    expect(fetchMock).toHaveBeenCalledWith('/api/echo?segment=growth&path=Echo%2FInsights%2F%E6%B4%9E%E5%AF%9F.md', expect.any(Object));
    expect(host.querySelector('#echo-memory-reader-title')?.textContent).toBe(messages.zh.panels.echo.growthTitle);
    expect(host.textContent).toContain('Generated insight.');
    expect(host.textContent).toContain('Echo/Insights/洞察.md');
    expect(host.querySelector('a[href="/view/Echo/Insights/%E6%B4%9E%E5%AF%9F.md"]')).not.toBeNull();
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
    expect(host.textContent).not.toContain(messages.zh.echoPages.imprintEventBookTitle);
    expect(host.textContent).not.toContain('修复 sidebar 激活态抖动');
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/echo?segment=imprint'))).toBe(false);
  });

  it('renders generated Event Signal Next imprints on the Imprint page', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const surface = host.querySelector('[data-testid="echo-imprint-generated-list"]');
    expect(surface).not.toBeNull();
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsEyebrow);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsWindow);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsCheckpointLabel);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsAutoLabel);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsUpdatedAt(messages.zh.echoPages.imprintCardsInitialUpdatedAt));
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsUpdateAction);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintScheduleNextRun('20:00'));
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardTypeEventLabel);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardTypeSignalLabel);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardTypeNextLabel);
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardCreatedLabel);
    expect(surface?.textContent).toContain('14:12');
    expect(surface?.textContent).toContain('卡片类型被收敛');
    expect(surface?.textContent).toContain('不要过早泛化');
    expect(surface?.textContent).toContain('先做生成内容面，再接抽取');
    expect(surface?.textContent).not.toContain('生成的 Imprint');
    expect(surface?.textContent).not.toContain('从当前 session 窗口自动生成');
    expect(surface?.textContent).not.toContain('审阅队列');
    expect(surface?.textContent).not.toContain('先由人审阅');
    expect(surface?.textContent).not.toContain('保存');
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-all"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-event"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-signal"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-card-lane-next"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="echo-imprint-created-at"]')).toHaveLength(5);
    expect(host.querySelector('[data-testid="echo-imprint-checkpoint"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-imprint-generation-status"]')).not.toBeNull();

    const allFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-card-lane-all"]');
    const eventFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-card-lane-event"]');
    const signalFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-card-lane-signal"]');
    const nextFilter = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-card-lane-next"]');
    expect(allFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(eventFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(signalFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(nextFilter?.getAttribute('aria-pressed')).toBe('true');

    const updateButton = host.querySelector<HTMLButtonElement>('[data-testid="echo-imprint-update-button"]');
    expect(updateButton).not.toBeNull();
    await act(async () => {
      updateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(surface?.textContent).toContain(messages.zh.echoPages.imprintCardsManualLabel);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/echo?segment=imprint'))).toBe(false);

    await act(async () => {
      allFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(allFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(eventFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(signalFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(nextFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelectorAll('[data-testid^="echo-imprint-card-"]:not([data-testid^="echo-imprint-card-lane-"])')).toHaveLength(0);

    await act(async () => {
      allFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(allFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(eventFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(signalFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(nextFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid^="echo-imprint-card-"]:not([data-testid^="echo-imprint-card-lane-"])')).toHaveLength(5);

    await act(async () => {
      signalFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(allFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(eventFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(signalFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(nextFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid="echo-imprint-card-event"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="echo-imprint-card-signal"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="echo-imprint-card-next"]')).toHaveLength(1);
    expect(surface?.textContent).toContain('卡片类型被收敛');
    expect(surface?.textContent).not.toContain('不要过早泛化');

    await act(async () => {
      allFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(allFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(eventFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(signalFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(nextFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[data-testid^="echo-imprint-card-"]:not([data-testid^="echo-imprint-card-lane-"])')).toHaveLength(5);

    const surfaceButtons = () => Array.from(surface?.querySelectorAll('button') ?? []);
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
    expect(surface?.textContent).not.toContain('卡片类型被收敛');
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

    const modeSelect = host.querySelector<HTMLSelectElement>('[data-testid="echo-imprint-schedule-mode"]');
    expect(modeSelect).not.toBeNull();
    await act(async () => {
      if (modeSelect) modeSelect.value = 'interval';
      modeSelect?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const modePatchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/echo/imprints'
      && init?.method === 'PATCH'
      && String(init.body).includes('"mode":"interval"')
    ));
    expect(modePatchCall).toBeTruthy();
    expect(host.querySelector('[data-testid="echo-imprint-schedule-status"]')?.textContent)
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
    expect(host.querySelector('[data-testid="echo-imprint-schedule-status"]')?.textContent)
      .toContain(messages.zh.echoPages.imprintScheduleIntervalHours(6));

    await act(async () => {
      if (modeSelect) modeSelect.value = 'manual';
      modeSelect?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    const manualPatchCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/echo/imprints'
      && init?.method === 'PATCH'
      && String(init.body).includes('"mode":"manual"')
    ));
    expect(manualPatchCall).toBeTruthy();
    expect(host.querySelector('[data-testid="echo-imprint-schedule-status"]')?.textContent)
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
    id: `${card.type}-api-${index}`,
    confidence: 0.72,
    sourceSessionIds: [`session-${index}`],
    status: 'active',
    generatedAt: '2026-06-29T06:36:00.000Z',
    updatedAt: '2026-06-29T06:36:00.000Z',
  }));
}
