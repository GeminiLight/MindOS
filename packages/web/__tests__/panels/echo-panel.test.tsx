import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EchoPanel from '@/components/panels/EchoPanel';
import { messages } from '@/lib/i18n';

const routeState = vi.hoisted(() => ({
  pathname: '/echo/imprint',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

vi.mock('@/components/panels/EchoSidebarStats', () => ({
  default: () => <div data-testid="echo-sidebar-stats" />,
}));

describe('EchoPanel sidebar navigation', () => {
  it('marks the active Echo segment with the lightweight rectangular row style', () => {
    routeState.pathname = '/echo/imprint';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} />);

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/echo\/imprint"/);
    expect(html).toContain('rounded-md');
    expect(html).toContain('border-[var(--amber)]/35');
    expect(html).toContain('bg-[var(--amber-dim)]/45');
    expect(html).toContain('bg-[var(--amber)]/10');
    expect(html).not.toContain('rounded-r-full');
    expect(html).not.toContain('ring-2 ring-ring/50');
  });

  it('keeps inactive Echo segments out of the active/current state', () => {
    routeState.pathname = '/echo/growth';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} />);

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/echo\/growth"/);
    expect(html).toMatch(/<a(?![^>]*aria-current="page")[^>]*href="\/echo\/imprint"/);
    expect(html).toMatch(/<a(?![^>]*aria-current="page")[^>]*href="\/echo\/self"/);
  });
});
