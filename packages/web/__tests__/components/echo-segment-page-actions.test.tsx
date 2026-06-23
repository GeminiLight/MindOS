// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EchoSegmentPageClient from '@/components/echo/EchoSegmentPageClient';
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

  it('runs the Imprint page primary assistant CTA through the shared assistant runner', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    const backLink = host.querySelector('a[href="/echo/overview"]');
    expect(backLink?.parentElement?.textContent).not.toContain(messages.zh.echoPages.assistantGenerateImprint);

    const assistantButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(messages.zh.echoPages.assistantGenerateImprint),
    );
    expect(assistantButton).toBeTruthy();

    await act(async () => {
      assistantButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const assistantCall = fetchMock.mock.calls.find(([url]) => url === '/api/assistant-runs');
    expect(assistantCall).toBeTruthy();
    const [, init] = assistantCall!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      assistantId: 'echo-imprint',
      permissionMode: 'read',
      maxSteps: 10,
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('You are running the Echo Imprint assistant inside MindOS Echo.'),
        },
      ],
    });
    expect(String(init.body)).toContain('## 现场');
    expect(String(init.body)).toContain('Visible log entries');
  });

  it('keeps empty saved Echo sections focused on the list empty state only', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="growth" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain(messages.zh.echoPages.echoReaderEmptyLabel);
    expect(host.textContent).not.toContain(messages.zh.echoPages.echoReaderDetailEmptyLabel);
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

    expect(fetchMock).toHaveBeenCalledWith('/api/echo?segment=growth&path=Echo%2FInsights%2F%E6%B4%9E%E5%AF%9F.md', expect.any(Object));
    expect(host.querySelector('#echo-memory-reader-title')?.textContent).toBe(messages.zh.panels.echo.growthTitle);
    expect(host.textContent).toContain('Generated insight.');
    expect(host.textContent).toContain('Echo/Insights/洞察.md');
    expect(host.querySelector('a[href="/view/Echo/Insights/%E6%B4%9E%E5%AF%9F.md"]')).not.toBeNull();
  });

  it('renders imprint as a practice event book with scene, evidence, and next-step actions', async () => {
    await act(async () => {
      root.render(<EchoSegmentPageClient segment="imprint" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('#echo-memory-reader-title')?.textContent).toBe(messages.zh.echoPages.imprintEventBookTitle);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintEventBookSubtitle);
    expect(host.textContent).toContain('修复 sidebar 激活态抖动');
    expect(host.textContent).toContain(messages.zh.echoPages.imprintSourceAssistant);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintStatusCaptured);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintDetailSceneTitle);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintDetailResultTitle);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintDetailEvidenceTitle);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintDetailQuestionsTitle);
    expect(host.textContent).toContain(messages.zh.echoPages.imprintDetailOpenThread);
    expect(host.querySelector('a[href="/echo/threads"]')).not.toBeNull();
    expect(host.querySelector('a[href="/echo/growth"]')).not.toBeNull();
    expect(host.querySelector('a[href="/echo/practice"]')).not.toBeNull();

    const layout = host.querySelector('[data-testid="echo-memory-reader-layout"]');
    expect(layout?.className).toContain('lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]');

    const detailBody = host.querySelector('[data-testid="echo-imprint-detail-body"]');
    expect(detailBody?.className).not.toContain('grid-cols');

    const sceneCard = host.querySelector('[data-testid="echo-imprint-scene-card"]');
    expect(sceneCard?.textContent).toContain('点击 logo 后 rail 激活态短暂跳到 Wiki。');
    expect(sceneCard?.textContent).not.toContain('稳定回到 Home。');
    expect(sceneCard?.textContent).not.toContain(messages.zh.echoPages.imprintDetailEvidenceTitle);

    const resultCard = host.querySelector('[data-testid="echo-imprint-result-card"]');
    expect(resultCard?.textContent).toContain('稳定回到 Home。');
    expect(resultCard?.textContent).toContain('避免用户误以为进入 Wiki。');

    const evidenceCard = host.querySelector('[data-testid="echo-imprint-evidence-card"]');
    expect(evidenceCard?.textContent).toContain('Echo/Daily/2026/06/2026-06-23.md');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/echo?segment=imprint&path=Echo%2FDaily%2F2026%2F06%2F2026-06-23.md',
      expect.any(Object),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
