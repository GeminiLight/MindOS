import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Client bundle boundary.
 *
 * Web code reaches `@geminilight/mindos` through narrow subpaths that are safe
 * to ship to the browser (`agent/turn/retry-policy`, `foundation/security/
 * redaction`, …). The package also has server-side barrels — `foundation`
 * pulls in the config loader and Node path utilities — and a single runtime
 * import of one from client code breaks the whole page: the bundler cannot
 * resolve `node:fs`, and the home route returns 500.
 *
 * That happened once already, through four files at the same time, and no
 * test noticed because the failure only shows up in a real browser build. This
 * test reproduces the bundler's view instead: start from every `'use client'`
 * module, follow runtime imports (type-only imports are erased; server actions
 * become RPC stubs), and require every package entrypoint reached that way to
 * be free of Node builtins all the way down.
 */

const WEB_ROOT = path.resolve(__dirname, '..');
const PKG_ROOT = path.resolve(WEB_ROOT, '..', 'mindos');
const PKG_NAME = '@geminilight/mindos';
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs'];
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', '_standalone', 'scripts']);

function readUtf8(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function hasDirective(source: string, directive: string): boolean {
  return new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n\\s*)*['"]${directive}['"]`).test(source);
}

function listClientRoots(): string[] {
  const roots: string[] = [];
  (function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && hasDirective(readUtf8(full), 'use client')) roots.push(full);
    }
  })(WEB_ROOT);
  return roots;
}

function resolveWebModule(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else return null;
  const candidates = [
    base,
    ...SOURCE_EXTS.map((ext) => base + ext),
    ...SOURCE_EXTS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

/** Specifiers this module imports at runtime. Type-only imports are erased by the compiler. */
function runtimeSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readUtf8(file), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const onlyTypeNames = !!clause && !clause.name && !!named && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
      if (onlyTypeNames) continue;
      specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.isTypeOnly) continue;
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

/** Every package entrypoint reachable at runtime from client code, with one path that reaches it. */
function clientReachableEntrypoints(): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const seen = new Set<string>();
  const stack: Array<{ file: string; trail: string[] }> = listClientRoots()
    .map((file) => ({ file, trail: [path.relative(WEB_ROOT, file)] }));

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    // A server action is replaced by an RPC stub in the client bundle, so nothing
    // it imports ships to the browser.
    if (hasDirective(readUtf8(file), 'use server')) continue;

    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier === PKG_NAME || specifier.startsWith(`${PKG_NAME}/`)) {
        if (!reached.has(specifier)) reached.set(specifier, trail);
        continue;
      }
      const next = resolveWebModule(file, specifier);
      if (next) stack.push({ file: next, trail: [...trail, path.relative(WEB_ROOT, next)] });
    }
  }
  return reached;
}

type ExportTarget = string | { import?: string; default?: string };

/** Resolve a package specifier through the `exports` map, including `*` patterns. */
function resolvePackageEntry(specifier: string): string | null {
  const exportsMap = JSON.parse(readUtf8(path.join(PKG_ROOT, 'package.json'))).exports as Record<string, ExportTarget>;
  const subpath = `.${specifier.slice(PKG_NAME.length)}` || '.';
  const pick = (target: ExportTarget) => (typeof target === 'string' ? target : target.import ?? target.default ?? null);

  const exact = exportsMap[subpath];
  if (exact) {
    const target = pick(exact);
    return target ? path.join(PKG_ROOT, target) : null;
  }
  for (const [pattern, target] of Object.entries(exportsMap)) {
    if (!pattern.includes('*')) continue;
    const [prefix, suffix] = pattern.split('*');
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const matched = subpath.slice(prefix.length, subpath.length - suffix.length);
    const resolved = pick(target);
    return resolved ? path.join(PKG_ROOT, resolved.replace('*', matched)) : null;
  }
  return null;
}

/** Node builtins imported anywhere below `entry`, as `file → builtin` strings. */
function builtinImportsBelow(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  (function visit(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    let source: string;
    try {
      source = readUtf8(file);
    } catch {
      return;
    }
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      if (BUILTINS.has(specifier)) found.push(`${path.relative(PKG_ROOT, file)} → ${specifier}`);
      else if (specifier.startsWith('.')) visit(path.resolve(path.dirname(file), specifier));
    }
  })(entry);
  return found;
}

describe('client bundle boundary', () => {
  const reached = clientReachableEntrypoints();

  it('finds client code that reaches the package, so the check is not vacuous', () => {
    expect(reached.size).toBeGreaterThan(0);
  });

  it('only reaches package entrypoints that exist in the exports map', () => {
    const missing = [...reached.keys()].filter((specifier) => resolvePackageEntry(specifier) === null);
    expect(missing, 'client code imports a subpath the package does not export').toEqual([]);
  });

  it('never ships a Node builtin to the browser through a package entrypoint', () => {
    const violations: string[] = [];
    for (const [specifier, trail] of reached) {
      const entry = resolvePackageEntry(specifier);
      if (!entry) continue;
      const builtins = builtinImportsBelow(entry);
      if (builtins.length === 0) continue;
      violations.push([
        `${specifier}`,
        `  imported from: ${trail.join(' → ')}`,
        `  pulls in:      ${builtins.slice(0, 3).join('; ')}`,
      ].join('\n'));
    }
    expect(
      violations,
      'Use a browser-safe subpath (e.g. @geminilight/mindos/foundation/markdown) instead of a server barrel:\n\n'
        + violations.join('\n\n'),
    ).toEqual([]);
  });
});
