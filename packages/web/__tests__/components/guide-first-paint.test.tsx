import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import GuideCard from '@/components/GuideCard';
import { en } from '@/lib/i18n/messages-en';

vi.mock('@/hooks/useSmoothRouterPush', () => ({ useSmoothRouterPush: () => vi.fn() }));

const guide = {
  active: true, dismissed: false, step1Done: true, askedAI: false,
  agentPromptDone: false, nextStepIndex: 0, template: 'empty' as const,
};

it('renders the active guide and its current panel in server HTML before setup responds', () => {
  const html = renderToStaticMarkup(<GuideCard initialGuide={{ guideState: guide, aiConfigured: false }} hasExistingFiles />);
  expect(html).toContain(en.guide.title);
  expect(html).toContain(en.guide.ai.configureDesc);
  expect(html).toContain('aria-hidden="false"');
});

it('shows the next stage on the first frame when knowledge already exists', () => {
  const html = renderToStaticMarkup(<GuideCard initialGuide={{ guideState: { ...guide, step1Done: false }, aiConfigured: false }} hasExistingFiles />);
  expect(html).toContain(en.guide.ai.configureDesc);
  expect(html).toContain('aria-hidden="false"');
});

it('does not show a dismissed guide in the server HTML', () => {
  const html = renderToStaticMarkup(<GuideCard initialGuide={{ guideState: { ...guide, dismissed: true }, aiConfigured: false }} hasExistingFiles />);
  expect(html).not.toContain(en.guide.title);
});
