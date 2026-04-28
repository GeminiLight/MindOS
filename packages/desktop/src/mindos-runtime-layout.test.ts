import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import {
  analyzeMindOsLayout,
  isBundledRuntimeIntact,
  isNextBuildValid,
  isNextBuildCurrent,
  BUILD_VERSION_FILE,
} from './mindos-runtime-layout';
import { getStandaloneAppRequiredEntries } from './runtime-health-contract';

function writeEntries(baseDir: string, omit: string[] = []) {
  for (const entry of getStandaloneAppRequiredEntries()) {
    if (omit.includes(entry.path)) continue;
    const target = path.join(baseDir, entry.path);
    if (entry.type === 'directory') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `// ${entry.path}`, 'utf-8');
    }
  }
}

function writeBundledCliEntries(root: string) {
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'bin', 'cli.js'), '// cli', 'utf-8');
  writeFileSync(path.join(root, 'src', 'cli.js'), '// cli helper', 'utf-8');
}

describe('analyzeMindOsLayout', () => {
  it('returns runnable for the v1 runtime layout packages/web plus packages/protocols/mcp-server', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-v1');
    try {
      rmSync(root, { recursive: true, force: true });
      writeEntries(path.join(root, 'packages', 'web'));
      mkdirSync(path.join(root, 'packages', 'protocols', 'mcp-server', 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'packages', 'protocols', 'mcp-server', 'dist', 'index.cjs'), '// mcp', 'utf-8');
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9-v1' }), 'utf-8');

      const r = analyzeMindOsLayout(root);

      expect(r.version).toBe('9.9.9-v1');
      expect(r.runnable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps legacy cached app/mcp runtimes runnable when app/.next has BUILD_ID and mcp has source', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-test');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'app', '.next'), { recursive: true });
      writeFileSync(path.join(root, 'app', '.next', 'BUILD_ID'), 'test-build-id', 'utf-8');
      mkdirSync(path.join(root, 'mcp', 'src'), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9-test' }), 'utf-8');
      const r = analyzeMindOsLayout(root);
      expect(r.version).toBe('9.9.9-test');
      expect(r.runnable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runnable with standalone server.js, pdf runtime files, and mcp dist', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-standalone');
    try {
      rmSync(root, { recursive: true, force: true });
      writeEntries(path.join(root, 'app'));
      mkdirSync(path.join(root, 'mcp', 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'mcp', 'dist', 'index.cjs'), '// mcp', 'utf-8');
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

  it('not runnable when mcp dir exists but has no dist or src', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-mcp-empty');
    try {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(path.join(root, 'app', '.next'), { recursive: true });
      writeFileSync(path.join(root, 'app', '.next', 'BUILD_ID'), 'test-id', 'utf-8');
      mkdirSync(path.join(root, 'mcp'), { recursive: true }); // empty mcp dir
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

describe('runtime completeness', () => {
  it('marks standalone runtime not runnable when pdfjs-dist is missing', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-layout-missing-pdfjs');
    try {
      rmSync(root, { recursive: true, force: true });
      writeEntries(path.join(root, 'app'), ['.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.mjs', '.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']);
      mkdirSync(path.join(root, 'mcp', 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'mcp', 'dist', 'index.cjs'), '// mcp', 'utf-8');
      writeFileSync(path.join(root, 'package.json'), '{}', 'utf-8');

      const r = analyzeMindOsLayout(root);
      expect(r.runnable).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects bundled runtime when pdf worker is missing', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-bundled-missing-worker');
    try {
      rmSync(root, { recursive: true, force: true });
      writeEntries(path.join(root, 'packages', 'web'), ['.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']);
      mkdirSync(path.join(root, 'packages', 'protocols', 'mcp-server', 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'packages', 'protocols', 'mcp-server', 'dist', 'index.cjs'), '// mcp', 'utf-8');

      expect(isBundledRuntimeIntact(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts bundled runtime when required pdf files exist', () => {
    const root = path.join(process.cwd(), 'tmp-mindos-bundled-complete');
    try {
      rmSync(root, { recursive: true, force: true });
      writeEntries(path.join(root, 'packages', 'web'));
      mkdirSync(path.join(root, 'packages', 'protocols', 'mcp-server', 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'packages', 'protocols', 'mcp-server', 'dist', 'index.cjs'), '// mcp', 'utf-8');
      writeBundledCliEntries(root);

      expect(isBundledRuntimeIntact(root)).toBe(true);
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

describe('isNextBuildCurrent', () => {
  const BASE = path.join(process.cwd(), 'tmp-next-current-test');
  const STAMP = BUILD_VERSION_FILE;

  function setup(opts: { buildId?: boolean; standalone?: boolean; stampVersion?: string; pkgVersion?: string }) {
    rmSync(BASE, { recursive: true, force: true });
    const appDir = path.join(BASE, 'app');
    const nextDir = path.join(appDir, '.next');
    mkdirSync(nextDir, { recursive: true });
    if (opts.buildId) writeFileSync(path.join(nextDir, 'BUILD_ID'), 'test-id', 'utf-8');
    if (opts.standalone) {
      mkdirSync(path.join(nextDir, 'standalone'), { recursive: true });
      writeFileSync(path.join(nextDir, 'standalone', 'server.js'), '// srv', 'utf-8');
    }
    if (opts.stampVersion !== undefined) writeFileSync(path.join(nextDir, STAMP), opts.stampVersion, 'utf-8');
    if (opts.pkgVersion !== undefined) writeFileSync(path.join(BASE, 'package.json'), JSON.stringify({ version: opts.pkgVersion }), 'utf-8');
    return { root: BASE, appDir };
  }

  function cleanup() { rmSync(BASE, { recursive: true, force: true }); }

  it('returns false when no build exists', () => {
    expect(isNextBuildCurrent('/tmp/nonexistent-xyz', '/tmp/nonexistent-xyz')).toBe(false);
  });

  it('returns true when build exists but no version stamp (external build)', () => {
    try {
      const { root, appDir } = setup({ buildId: true, pkgVersion: '1.0.0' });
      // No stamp = external build (CLI, npm run build, bundled runtime) — trust it
      expect(isNextBuildCurrent(appDir, root)).toBe(true);
    } finally { cleanup(); }
  });

  it('returns false when build version mismatches package version', () => {
    try {
      const { root, appDir } = setup({ buildId: true, stampVersion: '0.6.20', pkgVersion: '0.6.22' });
      expect(isNextBuildCurrent(appDir, root)).toBe(false);
    } finally { cleanup(); }
  });

  it('returns true when build version matches package version', () => {
    try {
      const { root, appDir } = setup({ buildId: true, stampVersion: '0.6.22', pkgVersion: '0.6.22' });
      expect(isNextBuildCurrent(appDir, root)).toBe(true);
    } finally { cleanup(); }
  });

  it('returns true with standalone build and matching version', () => {
    try {
      const { root, appDir } = setup({ standalone: true, stampVersion: '1.0.0', pkgVersion: '1.0.0' });
      expect(isNextBuildCurrent(appDir, root)).toBe(true);
    } finally { cleanup(); }
  });

  it('returns true when stamp is empty string (treat as missing)', () => {
    try {
      const { root, appDir } = setup({ buildId: true, stampVersion: '', pkgVersion: '1.0.0' });
      // Empty stamp = interrupted write, treat as missing → trust the valid build
      expect(isNextBuildCurrent(appDir, root)).toBe(true);
    } finally { cleanup(); }
  });

  it('returns true when stamp exists but no package.json', () => {
    try {
      const { root, appDir } = setup({ buildId: true, stampVersion: '1.0.0' });
      expect(isNextBuildCurrent(appDir, root)).toBe(true);
    } finally { cleanup(); }
  });
});
