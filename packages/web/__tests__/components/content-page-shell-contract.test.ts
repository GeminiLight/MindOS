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
    expect(source).toContain('data-content-page-shell="echo"');
    expect(source).toContain('const echoPageClass =');
    expect(source).toContain("'echo-content-page");
    expect(source).toContain('className={echoPageClass}');
    expect(source).not.toContain("'echo-content-page min-h-full bg-background'");
    expect(source).toContain('const echoBodyClass =');
    expect(source).toContain("'flex w-full flex-col gap-6'");
    expect(source).not.toContain('max-w-5xl');
    expect(source).not.toContain('EchoSegmentNav');
    expect(source).not.toContain('mx-auto max-w-3xl px-4 py-6');
    expect(source).not.toContain('bg-[radial-gradient');
    expect(source).not.toContain('color-mix');
    expect(source).not.toContain('function PrimaryButton');
    expect(source).not.toContain('function EchoIconButton');
    expect(source).not.toContain('text-3xl font-medium');
  });

  it('keeps Echo hero as a plain workbench header instead of a nested card', () => {
    const source = readSource('components/echo/EchoHero.tsx');
    const cssSource = readSource('app/globals.css');

    expect(source).toContain('<header className="echo-page-hero mb-6 min-w-0">');
    expect(source).toContain('className="echo-page-hero__row"');
    expect(source).toContain('className="echo-page-hero__copy"');
    expect(source).toContain('className="echo-page-hero__actions" data-echo-page-actions');
    expect(source).toContain('text-2xl font-semibold tracking-tight text-foreground');
    expect(source).toContain('mt-1 max-w-2xl text-sm leading-6 text-muted-foreground');
    expect(source).not.toContain('flex w-full shrink-0');
    expect(cssSource).not.toContain('.echo-content-page {');
    expect(cssSource).not.toContain('--main-body-content-max-width: min(1180px, 100%);');
    expect(cssSource).toContain('.echo-page-hero__actions');
    expect(cssSource).toContain('@container (min-width: 760px)');
    expect(cssSource).toContain('.echo-memory-reader-container');
    expect(cssSource).toContain('.echo-memory-reader-grid--with-detail');
    expect(cssSource).toContain('@container (min-width: 860px)');
    expect(source).not.toContain('rounded-xl border border-border bg-card');
    expect(source).not.toContain('shadow-sm');
    expect(source).not.toContain('absolute left-0');
  });

  it('allows shared content pages to choose semantic section elements', () => {
    const source = readSource('components/shared/ContentPageShell.tsx');

    expect(source).toContain("type ContentPageShellElement = 'div' | 'article' | 'section' | 'main'");
    expect(source).toContain('as: Component = ');
    expect(source).toContain('workbench-content-page');
    expect(source).toContain('export function WorkbenchPageShell');
    expect(source).toContain('export function ReadingPageShell');
    expect(source).toContain('export function NarrowPageShell');
    expect(source).toContain('export function LoadingPageShell');
    expect(source).toContain('aria-busy={ariaBusy ?? true}');
  });

  it('keeps Studio on the workbench shell instead of a page-local width wrapper', () => {
    const source = readSource('components/studio/StudioShell.tsx');

    expect(source).toContain("import { WorkbenchPageShell } from '@/components/shared/ContentPageShell'");
    expect(source).toContain('<WorkbenchPageShell');
    expect(source).toContain('data-content-page-shell="studio"');
  });
});
