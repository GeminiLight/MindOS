import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import CapabilityMarketplaceContent from '@/components/explore/CapabilityMarketplaceContent';
import { messages } from '@/lib/i18n';

const localeState = vi.hoisted(() => ({ current: 'en' as 'en' | 'zh' }));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: localeState.current, setLocale: () => {}, t: messages[localeState.current] }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('CapabilityMarketplaceContent', () => {
  beforeEach(() => { localeState.current = 'en'; });

  it('renders the Discover overview as an Explore-family hub', () => {
    const html = renderToStaticMarkup(<CapabilityMarketplaceContent />);

    expect(html).toContain('data-capability-market-grid="true"');
    expect(html).toContain('Overview');
    expect(html).not.toContain('Capability Marketplace');
    expect(html).toContain('Skill Market');
    expect(html).toContain('MCP Servers');
    expect(html).toContain('Plugin Market');
    expect(html).toContain('Task starters');
    expect(html).toContain('href="/explore/skills"');
    expect(html).toContain('href="/explore/mcp"');
    expect(html).toContain('href="/explore/plugins"');
    expect(html).toContain('href="/explore"');
    expect(html).not.toContain('href="/settings?tab=mcp"');
    expect(html).not.toContain('href="/settings?tab=plugins"');
  });

  it('uses Chinese titles and descriptions throughout the overview cards', () => {
    localeState.current = 'zh';
    const html = renderToStaticMarkup(<CapabilityMarketplaceContent />);

    expect(html).toContain('任务入口');
    expect(html).toContain('技能市场');
    expect(html).toContain('MCP 服务器');
    expect(html).not.toContain('Reusable agent skills');
    expect(html).not.toContain('Scenario library');
  });
});
