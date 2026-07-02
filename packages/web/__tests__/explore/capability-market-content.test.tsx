import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import CapabilityMarketplaceContent from '@/components/explore/CapabilityMarketplaceContent';
import { messages } from '@/lib/i18n';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('CapabilityMarketplaceContent', () => {
  it('renders the Discover overview as an Explore-family hub', () => {
    const html = renderToStaticMarkup(<CapabilityMarketplaceContent />);

    expect(html).toContain('data-capability-market-grid="true"');
    expect(html).toContain('Overview');
    expect(html).not.toContain('Capability Marketplace');
    expect(html).toContain('Skill Market');
    expect(html).toContain('MCP Servers');
    expect(html).toContain('Plugin Market');
    expect(html).toContain('Use Cases');
    expect(html).toContain('href="/explore/skills"');
    expect(html).toContain('href="/explore/mcp"');
    expect(html).toContain('href="/explore/plugins"');
    expect(html).toContain('href="/explore"');
    expect(html).not.toContain('href="/settings?tab=mcp"');
    expect(html).not.toContain('href="/settings?tab=plugins"');
  });
});
