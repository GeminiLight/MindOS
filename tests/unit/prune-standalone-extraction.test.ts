import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertExtractionRuntime,
  bundleDocxExtractor,
  pruneStandaloneToExtractionRuntime,
} from '../../scripts/prune-standalone-extraction.mjs';

/**
 * v1.1.7 shipped binary platform packages whose embedded runtime.tar.gz
 * excluded _standalone entirely, so hasDocumentExtractionRuntime() was false
 * in every fresh install and `mindos start` crashed in the source-build path.
 * The fix prunes _standalone down to the document-extraction runtime instead
 * of dropping it. These tests pin the prune + assert behavior.
 */

let fixtureRoot: string;
let standaloneDir: string;

function writePkg(nodeModules: string, name: string, deps: Record<string, string> = {}) {
  const dir = resolve(nodeModules, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies: deps }));
  writeFileSync(resolve(dir, 'index.js'), 'module.exports = {};');
}

function buildFixture({ nodeModulesName = '__node_modules' } = {}) {
  standaloneDir = resolve(fixtureRoot, '_standalone');
  const nm = resolve(standaloneDir, nodeModulesName);

  // Full Next standalone server payload that must NOT survive the prune
  mkdirSync(resolve(standaloneDir, '__next', 'server'), { recursive: true });
  writeFileSync(resolve(standaloneDir, '__next', 'server', 'app-paths-manifest.json'), '{}');
  writeFileSync(resolve(standaloneDir, 'server.js'), '// next server');
  mkdirSync(resolve(standaloneDir, 'public'), { recursive: true });
  writeFileSync(resolve(standaloneDir, 'public', 'favicon.ico'), '');

  // Extraction runtime that MUST survive
  mkdirSync(resolve(standaloneDir, 'scripts'), { recursive: true });
  writeFileSync(resolve(standaloneDir, 'scripts', 'extract-pdf.cjs'), '// pdf');
  writeFileSync(resolve(standaloneDir, 'scripts', 'extract-docx.cjs'), '// docx');

  // pdfjs-dist: legacy build is required, the rest is dead weight.
  // prepare-standalone already strips its package.json — the closure walk
  // must keep root packages by directory presence, not by package.json.
  mkdirSync(resolve(nm, 'pdfjs-dist', 'legacy', 'build'), { recursive: true });
  writeFileSync(resolve(nm, 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'), '');
  writeFileSync(resolve(nm, 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'), '');
  mkdirSync(resolve(nm, 'pdfjs-dist', 'web'), { recursive: true });
  writeFileSync(resolve(nm, 'pdfjs-dist', 'web', 'viewer.js'), '');
  mkdirSync(resolve(nm, 'pdfjs-dist', 'build'), { recursive: true });
  writeFileSync(resolve(nm, 'pdfjs-dist', 'build', 'pdf.mjs'), '');

  // mammoth + transitive closure, including a scoped dependency
  writePkg(nm, 'mammoth', { jszip: '^3.0.0', '@xmldom/xmldom': '^0.8.0' });
  writePkg(nm, 'jszip');
  writePkg(nm, '@xmldom/xmldom');
  writePkg(nm, 'word-extractor', { saxes: '^5.0.0', 'left-pad': '^1.0.0' });
  writePkg(nm, 'saxes');
  // left-pad is declared but not installed — closure walk must tolerate it

  // Server-only packages that must NOT survive
  writePkg(nm, 'next');
  writePkg(nm, 'react');
  writePkg(nm, 'koffi');
  writePkg(nm, '@mariozechner/clipboard');

  return nm;
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'mindos-prune-test-'));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('pruneStandaloneToExtractionRuntime', () => {
  it('keeps only the extraction scripts and the dependency closure of the extractor packages', () => {
    buildFixture();

    const result = pruneStandaloneToExtractionRuntime(standaloneDir);
    expect(result.pruned).toBe(true);

    // The pruned runtime only lives inside the binary's tar archive (never
    // npm-packed), so it must use the live node_modules name: Bun does not
    // honor NODE_PATH for package-style requires, only standard walk-up
    // resolution from scripts/ — with __node_modules, mammoth/word-extractor
    // would be unresolvable and DOCX extraction silently degrades.
    const nm = resolve(standaloneDir, 'node_modules');
    expect(existsSync(nm)).toBe(true);
    expect(existsSync(resolve(standaloneDir, '__node_modules'))).toBe(false);

    // Server payload gone
    expect(existsSync(resolve(standaloneDir, 'server.js'))).toBe(false);
    expect(existsSync(resolve(standaloneDir, '__next'))).toBe(false);
    expect(existsSync(resolve(standaloneDir, 'public'))).toBe(false);

    // Extraction scripts survive
    expect(existsSync(resolve(standaloneDir, 'scripts', 'extract-pdf.cjs'))).toBe(true);
    expect(existsSync(resolve(standaloneDir, 'scripts', 'extract-docx.cjs'))).toBe(true);

    // Dependency closure survives (incl. scoped + transitive)
    for (const kept of ['mammoth', 'jszip', '@xmldom/xmldom', 'word-extractor', 'saxes']) {
      expect(existsSync(resolve(nm, kept, 'package.json')), `${kept} must be kept`).toBe(true);
    }
    // pdfjs-dist has no package.json after prepare-standalone pruning, but the
    // directory (and its legacy build) must survive anyway.
    expect(existsSync(resolve(nm, 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))).toBe(true);

    // Unrelated packages removed
    for (const removed of ['next', 'react', 'koffi', '@mariozechner/clipboard', '@mariozechner']) {
      expect(existsSync(resolve(nm, removed)), `${removed} must be removed`).toBe(false);
    }
  });

  it('trims pdfjs-dist to its legacy build (the only part extract-pdf.cjs loads)', () => {
    buildFixture();

    pruneStandaloneToExtractionRuntime(standaloneDir);

    const nm = resolve(standaloneDir, 'node_modules');
    expect(existsSync(resolve(nm, 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))).toBe(true);
    expect(existsSync(resolve(nm, 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'))).toBe(true);
    expect(existsSync(resolve(nm, 'pdfjs-dist', 'web'))).toBe(false);
    expect(existsSync(resolve(nm, 'pdfjs-dist', 'build'))).toBe(false);
  });

  it('supports the runtime node_modules layout name as well as __node_modules', () => {
    const nm = buildFixture({ nodeModulesName: 'node_modules' });

    const result = pruneStandaloneToExtractionRuntime(standaloneDir);
    expect(result.pruned).toBe(true);
    expect(existsSync(resolve(nm, 'mammoth', 'package.json'))).toBe(true);
    expect(existsSync(resolve(nm, 'next'))).toBe(false);
  });

  it('is a no-op when _standalone does not exist', () => {
    const result = pruneStandaloneToExtractionRuntime(resolve(fixtureRoot, 'missing'));
    expect(result.pruned).toBe(false);
  });
});

describe('bundleDocxExtractor', () => {
  it('inlines the docx extractor dependencies into a self-contained script before pruning', () => {
    // Bun compiled binaries cannot resolve package.json-main requires from
    // external node_modules (only direct file subpaths), so mammoth's deep
    // require chain breaks at runtime unless the extractor ships bundled.
    // Bundling must run on the raw staged tree (here: __node_modules, full
    // closure) because the pruned closure misses nested node_modules deps.
    buildFixture();
    const script = resolve(standaloneDir, 'scripts', 'extract-docx.cjs');
    writeFileSync(script, "const m = require('mammoth');\nconsole.log(m.MAGIC);\n");
    writeFileSync(
      resolve(standaloneDir, '__node_modules', 'mammoth', 'index.js'),
      "module.exports = { MAGIC: 'BUNDLED_MAGIC_42' };",
    );

    const result = bundleDocxExtractor(standaloneDir);
    expect(result.bundled).toBe(true);

    const bundled = readFileSync(script, 'utf-8');
    expect(bundled).toContain('BUNDLED_MAGIC_42');
    expect(bundled).not.toContain("require('mammoth')");

    // Prune afterwards must keep the bundled script intact and still satisfy
    // the install-time gate.
    pruneStandaloneToExtractionRuntime(standaloneDir);
    expect(readFileSync(script, 'utf-8')).toContain('BUNDLED_MAGIC_42');
    expect(() => assertExtractionRuntime(standaloneDir)).not.toThrow();
  });

  it('is a no-op when the extractor script is missing', () => {
    const result = bundleDocxExtractor(resolve(fixtureRoot, 'missing'));
    expect(result.bundled).toBe(false);
  });
});

describe('assertExtractionRuntime', () => {
  it('passes on a pruned standalone dir', () => {
    buildFixture();
    pruneStandaloneToExtractionRuntime(standaloneDir);
    expect(() => assertExtractionRuntime(standaloneDir)).not.toThrow();
  });

  it('throws and names the missing files when the extraction runtime is incomplete', () => {
    buildFixture();
    pruneStandaloneToExtractionRuntime(standaloneDir);
    rmSync(resolve(standaloneDir, 'scripts', 'extract-pdf.cjs'));
    expect(() => assertExtractionRuntime(standaloneDir)).toThrow(/extract-pdf\.cjs/);
  });

  it('throws when _standalone is missing entirely (the v1.1.7 regression shape)', () => {
    expect(() => assertExtractionRuntime(resolve(fixtureRoot, 'missing'))).toThrow(/document extraction/i);
  });
});
