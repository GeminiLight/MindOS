import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { readFileSync } from 'fs';
import { hasBuildableWebSources } from './mindos-runtime-layout';

/**
 * Local-mode runtime detection used to exist twice: the real boot path
 * (mindos-runtime-resolve) and a simplified copy inside the connect window.
 * They disagreed, so the mode picker could block a machine where boot would
 * have succeeded. These pin the single-source behaviour.
 */

let root: string;

function make(rel: string, body = '{}'): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'mindos-detect-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.resetModules(); });

describe('hasBuildableWebSources', () => {
  it('accepts a monorepo-style checkout with Web sources', () => {
    make('packages/web/package.json');
    make('packages/web/app/layout.tsx', '');
    expect(hasBuildableWebSources(root)).toBe(true);
  });

  it('accepts the published app/ layout', () => {
    make('app/package.json');
    make('app/app/page.tsx', '');
    expect(hasBuildableWebSources(root)).toBe(true);
  });

  it('rejects a shim package that ships no Web sources', () => {
    // The real regression: a thin global install was reported as "installed
    // but not built", offering a Build button that could never succeed.
    make('package.json', '{"version":"1.1.67"}');
    make('bin/mindos-shim.cjs', '');
    make('dist/protocols/mcp-server/index.cjs', '');
    expect(hasBuildableWebSources(root)).toBe(false);
  });

  it('rejects an empty directory', () => {
    expect(hasBuildableWebSources(root)).toBe(false);
  });

  it('rejects a Web package with a manifest but no app directory', () => {
    make('packages/web/package.json');
    expect(hasBuildableWebSources(root)).toBe(false);
  });
});

describe('dev runtime auto-detection', () => {
  const source = readFileSync(path.join(__dirname, 'mindos-runtime-path.ts'), 'utf-8');

  it('resolves the monorepo root two levels up from packages/desktop', () => {
    // One level landed on `packages/`, so auto-detection could never match.
    expect(source).toContain("const MONOREPO_DEPTH_FROM_DESKTOP = ['..', '..']");
    expect(source).not.toMatch(/path\.resolve\(app\.getAppPath\(\),\s*'\.\.'\s*\)/);
  });

  it('asks the layout analyser instead of hand-rolled path checks', () => {
    // `packages/protocols/mcp-server` moved into packages/mindos/, so the old
    // existsSync pair could not match this repo at all.
    expect(source).not.toContain("'protocols', 'mcp-server'");
    expect(source).toContain('looksLikeMindOsRuntime');
    expect(source).toContain('analyzeMindOsLayout(root).runnable');
  });
});

describe('connect window status probe', () => {
  // Split out of connect-window.ts into its own module; same single resolver.
  const source = readFileSync(path.join(__dirname, 'connect-mode-handlers.ts'), 'utf-8');
  const probe = source.slice(
    source.indexOf("safeHandle('connect:check-mindos-status'"),
    source.indexOf("safeHandle('connect:build-mindos'"),
  );

  it('delegates to the resolver that actually boots local mode', () => {
    expect(probe).toContain('resolveLocalMindOsProjectRoot(config, nodePath');
    // No second implementation: these were the hand-rolled checks.
    expect(probe).not.toContain('analyzeMindOsLayout(');
    expect(probe).not.toContain("existsSync(path.join(bundledDir");
    expect(probe).not.toContain('getMindosInstallPath(');
  });

  it('only offers Build where Web sources exist', () => {
    expect(probe).toContain('hasBuildableWebSources(');
    expect(probe.split('hasBuildableWebSources(').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('surfaces the resolver reason rather than a generic message', () => {
    expect(probe).toContain('resolved.messageZh');
    expect(probe).toContain('resolved.messageEn');
    expect(probe).toContain('detail');
  });
});
