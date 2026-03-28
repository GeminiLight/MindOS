import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { analyzeMindOsLayout, isNextBuildValid } from './mindos-runtime-layout';

describe('analyzeMindOsLayout', () => {
  it('returns version and runnable when app/.next has BUILD_ID and mcp exist', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-test');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'app', '.next'), { recursive: true });
      writeFileSync(path.join(root, 'app', '.next', 'BUILD_ID'), 'test-build-id', 'utf-8');
      mkdirSync(path.join(root, 'mcp'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9-test' }), 'utf-8');
      const r = analyzeMindOsLayout(root);
      expect(r.version).toBe('9.9.9-test');
      expect(r.runnable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runnable with standalone server.js', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-standalone');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'app', '.next', 'standalone'), { recursive: true });
      writeFileSync(path.join(root, 'app', '.next', 'standalone', 'server.js'), '// server', 'utf-8');
      mkdirSync(path.join(root, 'mcp'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), '{}', 'utf-8');
      const r = analyzeMindOsLayout(root);
      expect(r.runnable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('not runnable when .next dir exists but has no BUILD_ID or standalone', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-empty-next');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'app', '.next'), { recursive: true });
      mkdirSync(path.join(root, 'mcp'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), '{}', 'utf-8');
      const r = analyzeMindOsLayout(root);
      expect(r.runnable).toBe(false);
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

describe('isNextBuildValid', () => {
  it('returns false when .next does not exist', () => {
    expect(isNextBuildValid('/tmp/nonexistent-mindos-test-xyz')).toBe(false);
  });

  it('returns false for empty .next directory', () => {
    const appDir = path.join(process.cwd(), 'tmp-next-valid-empty');
    try {
      rmSync(appDir, { recursive: true, force: true });
      mkdirSync(path.join(appDir, '.next'), { recursive: true });
      expect(isNextBuildValid(appDir)).toBe(false);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });

  it('returns true when BUILD_ID exists', () => {
    const appDir = path.join(process.cwd(), 'tmp-next-valid-buildid');
    try {
      rmSync(appDir, { recursive: true, force: true });
      mkdirSync(path.join(appDir, '.next'), { recursive: true });
      writeFileSync(path.join(appDir, '.next', 'BUILD_ID'), 'abc123', 'utf-8');
      expect(isNextBuildValid(appDir)).toBe(true);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });

  it('returns true when standalone/server.js exists', () => {
    const appDir = path.join(process.cwd(), 'tmp-next-valid-standalone');
    try {
      rmSync(appDir, { recursive: true, force: true });
      mkdirSync(path.join(appDir, '.next', 'standalone'), { recursive: true });
      writeFileSync(path.join(appDir, '.next', 'standalone', 'server.js'), '// server', 'utf-8');
      expect(isNextBuildValid(appDir)).toBe(true);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });
});
