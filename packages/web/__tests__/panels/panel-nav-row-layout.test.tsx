import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bot } from 'lucide-react';
import { PanelNavRow } from '@/components/panels/PanelNavRow';

function htmlFor(active: boolean): string {
  const html = renderToStaticMarkup(
    <PanelNavRow
      icon={<Bot size={14} />}
      title={active ? 'Active' : 'Inactive'}
      href="/agents?tab=agent"
      active={active}
    />,
  );
  return html;
}

function classNameFor(active: boolean): string {
  const html = htmlFor(active);
  const match = html.match(/class="([^"]+)"/);
  return match?.[1] ?? '';
}

describe('PanelNavRow layout stability', () => {
  it('keeps active and inactive rows on the same horizontal grid', () => {
    const activeClassName = classNameFor(true);
    const inactiveClassName = classNameFor(false);

    expect(activeClassName).toContain('px-4');
    expect(inactiveClassName).toContain('px-4');
    expect(activeClassName).toContain('py-2.5');
    expect(inactiveClassName).toContain('py-2.5');
    expect(activeClassName).not.toContain('pl-3.5');
    expect(activeClassName).not.toContain('pr-4');
  });

  it('uses a stable active background and icon tile instead of a left rail', () => {
    const activeHtml = htmlFor(true);
    const inactiveHtml = htmlFor(false);
    const activeClassName = classNameFor(true);

    expect(activeClassName).toContain('rounded-md');
    expect(activeHtml).toContain('border-[var(--amber)]/35');
    expect(activeHtml).toContain('bg-[var(--amber-dim)]/45');
    expect(activeHtml).toContain('bg-[var(--amber)]/10');
    expect(activeHtml).not.toContain('rounded-r-full');
    expect(inactiveHtml).toContain('border-transparent');
    expect(activeHtml).toContain('aria-current="page"');
  });
});
