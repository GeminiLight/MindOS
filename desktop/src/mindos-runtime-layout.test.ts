import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { analyzeMindOsLayout } from './mindos-runtime-layout';

describe('analyzeMindOsLayout', () => {
  it('returns version and runnable when app/.next and mcp exist', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-test');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'app', '.next'), { recursive: true });
      mkdirSync(path.join(root, 'mcp'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9-test' }), 'utf-8');
      const r = analyzeMindOsLayout(root);
      expect(r.version).toBe('9.9.9-test');
      expect(r.runnable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('not runnable without .next', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-test-2');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'mcp'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), '{}', 'utf-8');
      const r = analyzeMindOsLayout(root);
      expect(r.runnable).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
