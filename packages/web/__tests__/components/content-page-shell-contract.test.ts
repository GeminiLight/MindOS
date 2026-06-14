import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('Content page shell contract', () => {
  it('keeps Echo segment pages on the shared content shell', () => {
    const source = readSource('components/echo/EchoSegmentPageClient.tsx');

    expect(source).toContain("import { ContentPageShell } from '@/components/shared/ContentPageShell'");
    expect(source).toContain('<ContentPageShell');
    expect(source).toContain('as="article"');
    expect(source).toContain('className="echo-content-page"');
    expect(source).not.toContain('mx-auto max-w-3xl px-4 py-6');
  });

  it('keeps Echo hero as a plain workbench header instead of a nested card', () => {
    const source = readSource('components/echo/EchoHero.tsx');

    expect(source).toContain('<header className="mb-6">');
    expect(source).toContain('text-2xl font-semibold tracking-tight text-foreground');
    expect(source).toContain('mt-1 max-w-2xl text-sm leading-6 text-muted-foreground');
    expect(source).not.toContain('rounded-xl border border-border bg-card');
    expect(source).not.toContain('shadow-sm');
    expect(source).not.toContain('absolute left-0');
  });

  it('allows shared content pages to choose semantic section elements', () => {
    const source = readSource('components/shared/ContentPageShell.tsx');

    expect(source).toContain("type ContentPageShellElement = 'div' | 'article' | 'section' | 'main'");
    expect(source).toContain('as: Component = ');
    expect(source).toContain('workbench-content-page');
  });
});
