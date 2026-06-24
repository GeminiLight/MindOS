import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import McpMarketContent from '@/components/explore/McpMarketContent';
import { messages } from '@/lib/i18n';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('McpMarketContent', () => {
  it('keeps MCP server discovery separate from installed connection management', () => {
    const html = renderToStaticMarkup(<McpMarketContent />);

    expect(html).toContain('data-mcp-market-grid="true"');
    expect(html).toContain('MCP Servers');
    expect(html).toContain('Discovery only');
    expect(html).toContain('External tools');
    expect(html).toContain('Knowledge sources');
    expect(html).toContain('Runtime bridges');
    expect(html).toContain('href="/explore/capabilities"');
    expect(html).toContain('href="/settings?tab=mcp"');
    expect(html).not.toContain('Auth Token');
    expect(html).not.toContain('Reconnect all');
    expect(html).not.toContain('MCP Server Port');
  });
});
