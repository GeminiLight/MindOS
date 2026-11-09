// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionPanel } from '@/components/echo/EchoStructuredPanels';
import { normalizePromotionTarget, promotionTargetLabel } from '@/components/echo/echo-structured-cards';
import { messages } from '@/lib/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/useAskModal', () => ({ openAskModal: vi.fn() }));

const AGREEMENT_CARD = {
  id: 'echo-card-agreement-1',
  kind: 'agreement',
  title: '不要使用 any 类型',
  content: '写 TypeScript 时不要使用 any 类型。',
  createdAt: '2026-11-09T06:00:00.000Z',
  source: {
    label: '你在 2 次对话里说过 3 次',
    sessions: [{
      id: 'session-a',
      runtime: 'Claude Code',
      messageRefs: [{ messageIndex: 1, role: 'user', quote: '说了多少次，不要用 any 类型。' }],
    }],
  },
};

const PLAYBOOK_CARD = {
  id: 'echo-card-playbook-1',
  kind: 'playbook',
  title: '先定义输入输出',
  content: '先定义用户带来什么、离开时得到什么。',
  createdAt: '2026-11-09T06:00:00.000Z',
  source: { label: 'UI 优化会话', sessions: [] },
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('PromotionPanel agreement rendering', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      state: { segment: 'promotion', schedule: { mode: 'manual', dailyTime: '20:00', intervalHours: 6 } },
      cards: [AGREEMENT_CARD, PLAYBOOK_CARD],
    })));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function render(locale: 'zh' | 'en') {
    await act(async () => {
      root.render(<PromotionPanel p={messages[locale].echoPages} locale={locale} />);
    });
    await act(async () => { await Promise.resolve(); });
  }

  it('labels an agreement card with its own kind badge', async () => {
    await render('zh');

    const badges = [...host.querySelectorAll('[data-testid="echo-promotion-candidate"]')]
      .map((card) => card.textContent ?? '');
    expect(badges.some((text) => text.includes('约定'))).toBe(true);
    expect(badges.some((text) => text.includes('方法卡'))).toBe(true);
  });

  it('shows how often the user said it, directly under the title', async () => {
    await render('zh');

    const provenance = host.querySelector('[data-testid="echo-promotion-agreement-provenance"]');
    expect(provenance?.textContent).toBe('你在 2 次对话里说过 3 次');
  });

  it('does not show a provenance line on non-agreement cards', async () => {
    await render('zh');

    expect(host.querySelectorAll('[data-testid="echo-promotion-agreement-provenance"]')).toHaveLength(1);
  });

  it('tells the user where approving an agreement will write it', async () => {
    await render('zh');

    const agreementCard = [...host.querySelectorAll('[data-testid="echo-promotion-candidate"]')]
      .find((card) => card.textContent?.includes('约定'));
    const approve = agreementCard?.querySelector('[data-testid="echo-promotion-approve-button"]');
    expect(approve?.textContent).toContain('写入偏好');
  });

  it('keeps the generic promote wording on playbooks', async () => {
    await render('zh');

    const playbookCard = [...host.querySelectorAll('[data-testid="echo-promotion-candidate"]')]
      .find((card) => card.textContent?.includes('方法卡'));
    const approve = playbookCard?.querySelector('[data-testid="echo-promotion-approve-button"]');
    expect(approve?.textContent).toContain('批准并晋升');
  });

  it('offers an agreement filter alongside playbooks and practices', async () => {
    await render('zh');

    expect(host.querySelector('[data-testid="echo-promotion-filter-agreement"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-promotion-filter-playbook"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-promotion-filter-practice"]')).not.toBeNull();
  });

  it('hides agreements when their filter is switched off', async () => {
    await render('zh');
    const filter = host.querySelector<HTMLButtonElement>('[data-testid="echo-promotion-filter-agreement"]');

    await act(async () => { filter?.click(); });

    const titles = [...host.querySelectorAll('[data-testid="echo-promotion-candidate"]')]
      .map((card) => card.textContent ?? '');
    expect(titles.some((text) => text.includes('不要使用 any 类型'))).toBe(false);
    expect(titles.some((text) => text.includes('先定义输入输出'))).toBe(true);
  });

  it('renders the English labels for the same card', async () => {
    await render('en');

    const approve = [...host.querySelectorAll('[data-testid="echo-promotion-candidate"]')]
      .find((card) => card.textContent?.includes('Agreement'))
      ?.querySelector('[data-testid="echo-promotion-approve-button"]');
    expect(approve?.textContent).toContain('preferences');
  });
});

describe('promotion target helpers', () => {
  it('keeps agreement as its own target', () => {
    expect(normalizePromotionTarget('agreement')).toBe('agreement');
  });

  it('still falls back to playbook for unknown kinds', () => {
    expect(normalizePromotionTarget('mystery')).toBe('playbook');
    expect(normalizePromotionTarget('')).toBe('playbook');
  });

  it('labels agreements in both locales', () => {
    expect(promotionTargetLabel('agreement', messages.zh.echoPages)).toBe('约定');
    expect(promotionTargetLabel('agreement', messages.en.echoPages)).toBe('Agreement');
  });
});

describe('agreement source panel', () => {
  it('does not repeat the provenance sentence inside the expanded source', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      state: { segment: 'promotion', schedule: { mode: 'manual', dailyTime: '20:00', intervalHours: 6 } },
      cards: [AGREEMENT_CARD],
    })));

    await act(async () => { root.render(<PromotionPanel p={messages.zh.echoPages} locale="zh" />); });
    await act(async () => { await Promise.resolve(); });

    const card = host.querySelector('[data-echo-card-kind="agreement"]');
    const detail = card?.querySelector('[data-testid="echo-card-detail-markdown"]');
    const label = AGREEMENT_CARD.source.label;
    expect(card?.textContent).toContain(label);
    expect(detail?.textContent ?? '').not.toContain(label);
    expect(detail?.textContent ?? '').toContain('说了多少次');

    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
