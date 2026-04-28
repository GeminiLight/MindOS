import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import nextConfig from '../next.config';

describe('next config warning hygiene', () => {
  it('keeps tracing and Turbopack roots aligned with the app standalone layout', () => {
    const appRoot = resolve(__dirname, '..');

    expect(nextConfig.outputFileTracingRoot).toBe(appRoot);
    expect(nextConfig.turbopack?.root).toBe(appRoot);
  });

  it('runs local dev with webpack to preserve the app-root standalone tracing layout under pnpm', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.dev).toContain('next dev --webpack');
    expect(pkg.scripts?.dev).not.toContain('npx tsx');
    expect(pkg.scripts?.generate).toBe('tsx scripts/generate-explore.ts');
    expect(pkg.scripts?.prebuild).toContain('tsx scripts/generate-explore.ts');
  });

  it('suppresses only the known pi-ai dynamic dependency webpack warning', () => {
    const config: { ignoreWarnings?: unknown[]; resolve?: { alias?: Record<string, string> } } = {};
    const webpack = nextConfig.webpack;
    expect(typeof webpack).toBe('function');
    if (typeof webpack !== 'function') return;

    const result = webpack(config, {
      buildId: 'test',
      dev: false,
      isServer: true,
      defaultLoaders: {},
      nextRuntime: 'nodejs',
      webpack: {},
    } as never);

    const ignoreWarning = result.ignoreWarnings?.find((entry): entry is (warning: unknown) => boolean => {
      return typeof entry === 'function';
    });
    expect(ignoreWarning).toBeTypeOf('function');
    if (!ignoreWarning) return;

    expect(ignoreWarning({
      message: 'Critical dependency: the request of a dependency is an expression',
      module: { resource: '/repo/node_modules/@mariozechner/pi-ai/dist/providers/openai-codex-responses.js' },
    })).toBe(true);
    expect(ignoreWarning({
      message: 'Critical dependency: the request of a dependency is an expression',
      module: { resource: '/repo/node_modules/some-other-package/index.js' },
    })).toBe(false);
  });
});
