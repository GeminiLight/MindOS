import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function listSourceFiles(relativeDir: string): string[] {
  const start = resolve(root, relativeDir);
  if (!existsSync(start)) return [];
  const out: string[] = [];
  const ignored = new Set(['node_modules', 'dist', 'dist-electron', '.next', '.expo', '.turbo', 'extension']);

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        out.push(abs);
      }
    }
  }

  if (statSync(start).isDirectory()) walk(start);
  return out.sort();
}

describe('OpenCode client and runtime boundary contract', () => {
  it('documents the difference between package flattening and product-runtime ownership', () => {
    const auditPath = 'wiki/reviews/opencode-architecture-boundary-audit-2026-05-09.md';
    expect(existsSync(resolve(root, auditPath))).toBe(true);

    const audit = read(auditPath);
    for (const required of [
      'OpenCode-style boundary is semantic, not just directory flattening',
      'Client packages are shells',
      'Product runtime owner',
      'Generated runtime artifacts',
      'Current gaps',
      'Migration rules',
    ]) {
      expect(audit).toContain(required);
    }

    expect(audit).toContain('packages/mindos/src/{server,session,agent,tool,plugin,protocols}');
    expect(audit).toContain('packages/desktop/resources/mindos-runtime');
    expect(audit).toContain('ignored generated artifact');
  });

  it('keeps committed Desktop runtime resources as documentation, not a second product source tree', () => {
    const tracked = execFileSync('git', ['ls-files', 'packages/desktop/resources/mindos-runtime'], {
      cwd: root,
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);

    expect(tracked).toEqual(['packages/desktop/resources/mindos-runtime/README.md']);
    expect(read('.gitignore')).toContain('packages/desktop/resources/mindos-runtime/*');
    expect(read('.gitignore')).toContain('!packages/desktop/resources/mindos-runtime/README.md');
  });

  it('keeps client package dependencies free of product-engine packages', () => {
    const clientPackages = [
      'packages/desktop/package.json',
      'packages/mobile/package.json',
      'packages/browser-extension/package.json',
      'packages/desktop-tauri/package.json',
    ];

    for (const manifest of clientPackages) {
      const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(manifest);
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      expect(deps, manifest).not.toHaveProperty('@mariozechner/pi-coding-agent');
      expect(deps, manifest).not.toHaveProperty('@mindos/search');
      expect(deps, manifest).not.toHaveProperty('@mindos/vector');
      expect(deps, manifest).not.toHaveProperty('@mindos/indexer');
      expect(deps, manifest).not.toHaveProperty('@mindos/api');
    }
  });

  it('keeps client source from importing product internals directly', () => {
    const forbidden = [
      /@mariozechner\/pi-coding-agent/,
      /@geminilight\/mindos\/protocols/,
      /@geminilight\/mindos\/session(\/|['"])/,
      /@geminilight\/mindos\/agent(\/|['"])/,
      /@geminilight\/mindos\/server(\/|['"])/,
      /@mindos\/(?:search|vector|indexer|api)/,
      /packages\/mindos\/src/,
    ];

    for (const dir of [
      'packages/desktop/src',
      'packages/mobile/app',
      'packages/mobile/lib',
      'packages/browser-extension/src',
      'packages/desktop-tauri/src',
    ]) {
      for (const file of listSourceFiles(dir)) {
        const source = readFileSync(file, 'utf-8');
        for (const pattern of forbidden) {
          expect(source, file.slice(root.length + 1)).not.toMatch(pattern);
        }
      }
    }
  });
});
