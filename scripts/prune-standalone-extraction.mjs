#!/usr/bin/env node
/**
 * Prune a staged Next standalone dir (_standalone) down to the document
 * extraction runtime.
 *
 * Binary platform packages serve the prebuilt static web (static-web/) and
 * never run the standalone Next server, but the product server's PDF/DOCX
 * extraction handlers — and the useProductServer() gate in
 * packages/mindos/bin/commands/start.js — require the extractor scripts and
 * their node_modules closure under _standalone. v1.1.7 excluded _standalone
 * from the embedded runtime archive wholesale, which flipped the gate to the
 * source-build path and crashed every fresh `mindos start`.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Packages whose require() closure the extractor scripts need at runtime. */
const EXTRACTION_ROOT_PACKAGES = ['pdfjs-dist', 'mammoth', 'word-extractor'];

const EXTRACTION_SCRIPTS = ['extract-pdf.cjs', 'extract-docx.cjs'];

function nodeModulesDir(standaloneDir) {
  const runtime = resolve(standaloneDir, 'node_modules');
  const publishable = resolve(standaloneDir, '__node_modules');
  if (existsSync(runtime)) return runtime;
  if (existsSync(publishable)) return publishable;
  return null;
}

/**
 * Restore the live node_modules name. The pruned runtime ships inside the
 * binary's tar archive (never through npm pack), and Bun does not honor
 * NODE_PATH for package-style requires — the extractor scripts can only
 * resolve packages via standard walk-up resolution.
 */
function ensureLiveNodeModules(standaloneDir) {
  const nodeModules = nodeModulesDir(standaloneDir);
  if (!nodeModules) return null;
  const live = resolve(standaloneDir, 'node_modules');
  if (nodeModules !== live) renameSync(nodeModules, live);
  return live;
}

/** Walk package.json dependencies inside one node_modules dir (flat layout). */
function collectDependencyClosure(nodeModules, rootPackages) {
  const keep = new Set();
  const queue = [...rootPackages];
  while (queue.length > 0) {
    const name = queue.shift();
    if (keep.has(name)) continue;
    const pkgDir = resolve(nodeModules, name);
    if (!existsSync(pkgDir)) continue; // declared but not installed (e.g. optional)
    keep.add(name);
    // prepare-standalone strips some packages' package.json (pdfjs-dist ships
    // only legacy/) — keep the directory, just skip walking its dependencies.
    const pkgJsonPath = resolve(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
      continue;
    }
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push(dep);
  }
  return keep;
}

function prunePackages(nodeModules, keep) {
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('@')) {
      const scopeDir = resolve(nodeModules, entry.name);
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        const name = `${entry.name}/${scoped.name}`;
        if (!keep.has(name)) rmSync(resolve(scopeDir, scoped.name), { recursive: true, force: true });
      }
      if (readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true });
    } else if (!keep.has(entry.name)) {
      rmSync(resolve(nodeModules, entry.name), { recursive: true, force: true });
    }
  }
}

/** extract-pdf.cjs loads only pdfjs-dist/legacy/build/* — drop the rest (~30 MB). */
function trimPdfjsDist(nodeModules) {
  const pdfjsDir = resolve(nodeModules, 'pdfjs-dist');
  if (!existsSync(pdfjsDir)) return;
  for (const entry of readdirSync(pdfjsDir)) {
    if (entry !== 'package.json' && entry !== 'legacy' && entry !== 'LICENSE') {
      rmSync(resolve(pdfjsDir, entry), { recursive: true, force: true });
    }
  }
}

export function pruneStandaloneToExtractionRuntime(standaloneDir) {
  if (!existsSync(standaloneDir)) return { pruned: false };
  const nodeModules = ensureLiveNodeModules(standaloneDir);
  if (!nodeModules) return { pruned: false };

  const keep = collectDependencyClosure(nodeModules, EXTRACTION_ROOT_PACKAGES);
  prunePackages(nodeModules, keep);
  trimPdfjsDist(nodeModules);

  // Drop everything else (Next server payload) — only the extractor scripts
  // and their node_modules closure stay.
  for (const entry of readdirSync(standaloneDir)) {
    if (entry !== 'scripts' && entry !== 'node_modules') {
      rmSync(resolve(standaloneDir, entry), { recursive: true, force: true });
    }
  }

  return { pruned: true, kept: [...keep].sort() };
}

/**
 * Bundle extract-docx.cjs into a self-contained script (deps inlined).
 *
 * Bun compiled binaries resolve direct file subpaths from external
 * node_modules but NOT package.json-main requires, so mammoth's deep require
 * chain (underscore, jszip, …) breaks at runtime inside the shipped binary.
 * extract-pdf.cjs is unaffected: it only requires pdfjs file subpaths.
 *
 * Must run BEFORE pruneStandaloneToExtractionRuntime: bundling resolves the
 * full original tree (incl. nested node_modules like jszip/node_modules/
 * readable-stream), which the pruned closure does not fully preserve.
 */
export function bundleDocxExtractor(standaloneDir) {
  const script = resolve(standaloneDir, 'scripts', 'extract-docx.cjs');
  if (!existsSync(script)) return { bundled: false };
  if (!ensureLiveNodeModules(standaloneDir)) return { bundled: false };
  const outFile = resolve(standaloneDir, 'scripts', '.extract-docx.bundled.cjs');
  const result = spawnSync(
    'bun',
    ['build', '--target=node', '--format=cjs', script, '--outfile', outFile],
    { encoding: 'utf-8' },
  );
  if (result.status !== 0 || !existsSync(outFile)) {
    throw new Error(`bun build failed for extract-docx.cjs:\n${result.stderr || result.stdout || result.error}`);
  }
  renameSync(outFile, script);
  return { bundled: true };
}

/**
 * Mirror of hasPrebuiltDocumentExtractionRuntime() in
 * packages/mindos/bin/lib/build.js — fail the build instead of shipping a
 * runtime whose start gate flips to the source-build crash path.
 */
export function assertExtractionRuntime(standaloneDir) {
  const nodeModules = nodeModulesDir(standaloneDir) ?? resolve(standaloneDir, '__node_modules');
  const required = [
    ...EXTRACTION_SCRIPTS.map((script) => resolve(standaloneDir, 'scripts', script)),
    resolve(nodeModules, 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'),
    resolve(nodeModules, 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
    resolve(nodeModules, 'mammoth', 'package.json'),
    resolve(nodeModules, 'word-extractor', 'package.json'),
  ];
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      'Document extraction runtime is incomplete in the staged platform package '
      + '(hasDocumentExtractionRuntime() would be false at install time):\n'
      + missing.map((file) => `  missing ${file}`).join('\n'),
    );
  }
}
