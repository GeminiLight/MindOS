import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EchoPanel from '@/components/panels/EchoPanel';
import { messages } from '@/lib/i18n';

const routeState = vi.hoisted(() => ({
  pathname: '/echo/overview',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

describe('EchoPanel sidebar navigation', () => {
  it('marks the active Echo segment with the primary sidebar rail style', () => {
    routeState.pathname = '/echo/overview';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} />);

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/echo\/overview"/);
    expect(html).toContain('w-[3px] rounded-r-full bg-[var(--amber)]');
    expect(html).toContain('bg-[var(--amber-subtle)]');
    expect(html).not.toContain('border-[var(--amber)]/35 bg-[var(--amber-dim)]/45');
    expect(html).not.toContain('ring-2 ring-ring/50');
  });

  it('uses the shared primary sidebar nav spacing under the panel header', () => {
    routeState.pathname = '/echo/overview';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} />);

    expect(html).toContain('flex flex-col gap-0.5 py-2');
    expect(html).not.toContain('py-1.5');
  });

  it('keeps inactive Echo segments out of the active/current state', () => {
    routeState.pathname = '/echo/growth';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} />);

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/echo\/growth"/);
    expect(html).toMatch(/<a(?![^>]*aria-current="page")[^>]*href="\/echo\/overview"/);
    expect(html).toMatch(/<a(?![^>]*aria-current="page")[^>]*href="\/echo\/imprint"/);
    expect(html).toMatch(/<a(?![^>]*aria-current="page")[^>]*href="\/echo\/threads"/);
  });

  it('does not expose a fullscreen control in the Echo sidebar header', () => {
    routeState.pathname = '/echo/overview';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} onMaximize={() => {}} />);

    expect(html).not.toContain('Maximize panel');
    expect(html).not.toContain('Restore panel');
  });

  it('does not render the legacy Recent stats section', () => {
    routeState.pathname = '/echo/overview';

    const html = renderToStaticMarkup(<EchoPanel active maximized={false} />);

    expect(html).not.toContain('data-testid="echo-sidebar-stats"');
    expect(html).not.toContain('Files');
    expect(html).not.toContain('Changes');
    expect(html).not.toContain('Chats');
  });
});
