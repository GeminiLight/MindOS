import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNodeVersionAcceptable, MIN_NODE_VERSION } from './node-version';

describe('Desktop Node.js runtime requirement', () => {
  it('matches the minimum version required by the Pi runtime', () => {
    expect(MIN_NODE_VERSION).toBe('22.19.0');
  });

  it('accepts only stable versions at or above the minimum', () => {
    expect(isNodeVersionAcceptable('v22.19.0')).toBe(true);
    expect(isNodeVersionAcceptable('v22.23.2')).toBe(true);
    expect(isNodeVersionAcceptable('v24.0.0')).toBe(true);
    expect(isNodeVersionAcceptable('v22.18.0')).toBe(false);
    expect(isNodeVersionAcceptable('v20.20.0')).toBe(false);
    expect(isNodeVersionAcceptable('v22.23.2-rc.1')).toBe(false);
    expect(isNodeVersionAcceptable('not-a-version')).toBe(false);
  });

  it('keeps Desktop validation and user-facing requirements on the same baseline', () => {
    const sources = [
      'main.ts',
      'connect-window.ts',
      path.join('i18n', 'en.ts'),
      path.join('i18n', 'zh.ts'),
    ].map((relativePath) => readFileSync(path.join(__dirname, relativePath), 'utf-8'));

    expect(sources[0]).toContain('isNodeVersionAcceptable(version)');
    for (const source of sources) {
      expect(source).not.toMatch(/Node\.js\s*[≥>]\s*18|below v18|< 18/);
    }
    expect(sources.slice(1).join('\n')).toContain('22.19');
  });
});
