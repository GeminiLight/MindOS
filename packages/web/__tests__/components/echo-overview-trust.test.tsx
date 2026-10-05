// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPanel } from '@/components/echo/EchoOverviewPanels';
import { messages } from '@/lib/i18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); });

describe('Echo overview trust and hierarchy', () => {
  it.each(['en', 'zh'] as const)('leads to existing imprints without claiming that the library is empty in %s', async locale => {
    const p = messages[locale].echoPages;
    const onContinue = vi.fn();
    await act(async () => root.render(<OverviewPanel p={p} dailyLine="  " onContinue={onContinue} />));
    expect(host.textContent).not.toContain(locale === 'zh' ? '还没有写下记录' : 'No reflection written yet');
    expect(host.textContent).not.toContain(locale === 'zh' ? '专注推进了重要事项' : 'moved important work forward');
    const primary = host.querySelector('section a');
    expect(primary?.getAttribute('href')).toBe('/echo/imprint');
    expect(primary?.textContent).toBe(locale === 'zh' ? '查看印迹' : 'View imprints');
    expect(onContinue).not.toHaveBeenCalled();
    for (const metric of p.overviewMetrics) expect(host.textContent).not.toContain(metric.value);
  });

  it.each(['en', 'zh'] as const)('keeps the guide available without repeating page navigation in %s', async locale => {
    const p = messages[locale].echoPages;
    await act(async () => root.render(<OverviewPanel p={p} dailyLine="" onContinue={() => {}} />));
    const guide = host.querySelector('details');
    expect(guide).not.toBeNull();
    expect(guide?.open).toBe(false);
    expect(guide?.querySelector('summary')?.textContent).toContain(locale === 'zh' ? '回响如何使用' : 'How Echo works');
    for (const title of [p.overviewTodayTitle, p.overviewGrowthTitle, p.overviewPracticeTitle]) {
      expect(guide?.textContent).toContain(title);
    }
    expect(host.querySelector('nav')).toBeNull();
    expect(guide?.querySelector('a')).toBeNull();
  });

  it('shows the actual user reflection without presenting it as a generated daily summary', async () => {
    const onContinue = vi.fn();
    const text = '昨天的决定：保留耐心 🌱 <script>alert(1)</script>';
    await act(async () => root.render(<OverviewPanel p={messages.zh.echoPages} dailyLine={text} onContinue={onContinue} />));
    expect(host.textContent).toContain(text);
    expect(host.textContent).toContain('你的记录');
    expect(host.textContent).not.toContain('今日叙述');
    expect(host.querySelector('script')).toBeNull();
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('与 AI 一起复盘');
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
