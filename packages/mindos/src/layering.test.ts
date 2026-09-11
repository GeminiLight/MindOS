import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Package-wide import-direction contract (spec-knowledge-layering-and-export-surface).
 *
 * Dependency arrows inside `packages/mindos/src` must point one way:
 *
 *   foundation ← knowledge ← agent ← server
 *
 * with `retrieval` and `protocols` as low-level domains (CLAUDE.md「Package
 * 依赖边界」):
 *
 *   foundation → nothing internal
 *   retrieval  → foundation
 *   knowledge  → foundation, retrieval
 *   agent      → foundation, knowledge, protocols (only through the
 *                `agent/runtime/acp-types.ts` wire-type door, see
 *                `agent/runtime/layering.test.ts` and the protocols
 *                allowedImporters rule in `capabilities.ts`)
 *   server     → everything
 *   protocols  → foundation, agent (transport adapters drive agent turns; see
 *                the ALLOWED_IMPORTS note — tightening this is a follow-up)
 *
 * Root entry barrels and glue (`src/*.ts`, `intelligence/`, `plugin/`,
 * `tool/`, `setup/`) sit ABOVE the layers — they aggregate and wire them —
 * so they are out of scan scope. `src/knowledge.ts` uses that freedom to
 * side-effect-import the modules that install the knowledge ports.
 *
 * Test files (`*.test.ts`) and `__fixtures__` are excluded: tests may cross
 * layers to arrange fixtures (e.g. `agent/ledger/run-ledger.test.ts` reads
 * automation state through `server/automations/store.js`); the production
 * graph is what this contract constrains.
 */

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)));

type Layer = 'foundation' | 'retrieval' | 'knowledge' | 'agent' | 'server' | 'protocols';

const LAYERS: readonly Layer[] = ['foundation', 'retrieval', 'knowledge', 'agent', 'server', 'protocols'];

const ALLOWED_IMPORTS: Record<Layer, readonly Layer[]> = {
  foundation: [],
  retrieval: ['foundation'],
  knowledge: ['foundation', 'retrieval'],
  agent: ['foundation', 'knowledge'],
  server: ['foundation', 'retrieval', 'knowledge', 'agent', 'protocols'],
  // The ACP/MCP hosts drive agent turns and supervise agent runtime processes
  // (`protocols/acp/session.ts` → `agent/turn`, `subprocess.ts` →
  // `agent/runtime/process-supervisor`): that is what "transport host / SDK
  // adapter" means here (CLAUDE.md「Package 依赖边界」). The enforced direction
  // is on the other side: nothing below server imports protocols except the
  // acp-types wire-type door.
  protocols: ['foundation', 'agent'],
};

/**
 * The one door through which `agent` may reach `protocols`: the dependency-free
 * ACP wire types (capabilities.ts protocols allowedImporters = server + web
 * adapters + platform-runtime; inside the package only server and this door).
 */
const PROTOCOLS_IMPORTERS_OUTSIDE_SERVER: readonly string[] = ['agent/runtime/acp-types.ts'];

/**
 * Files allowed to keep an otherwise-illegal import, keyed by path relative to
 * `src/`, each listing the exact specifiers it may use. An entry whose file
 * disappears — or which stops importing its listed specifier — fails the suite,
 * so exceptions cannot outlive their reason.
 *
 * Currently empty: the knowledge/audit, run-ledger and capability-registry
 * inversions landed with this contract, and the `protocols/acp/session-registry`
 * bus default moved behind a process-global emitter that `server/events/bus.ts`
 * registers (spec-knowledge-layering-and-export-surface).
 */
const DOCUMENTED_EXCEPTIONS: Record<string, readonly string[]> = {};

/** Hard budget for the exception list; raising it is a conscious regression. */
const EXCEPTION_BUDGET = 0;

function listLayerSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listLayerSources(abs));
    else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(abs);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Static import/export-from, side-effect imports, dynamic import() and inline import types. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const cleaned = stripComments(source);
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /(?:^|[\s;])import\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function layerOfRelativePath(pathFromSrc: string): string {
  return pathFromSrc.split('/')[0];
}

function resolveSpecifierLayer(file: string, specifier: string): Layer | 'root' | 'external' {
  if (!specifier.startsWith('.')) return 'external';
  const target = resolve(dirname(file), specifier);
  const fromSrc = relative(srcDir, target);
  if (fromSrc.startsWith('..')) return 'external';
  const top = layerOfRelativePath(fromSrc.replace(/\.js$/, '.ts'));
  return (LAYERS as readonly string[]).includes(top) ? (top as Layer) : 'root';
}

function violationsForFile(file: string): string[] {
  const name = relative(srcDir, file).split('/').join('/');
  const layer = layerOfRelativePath(name) as Layer;
  const allowed = new Set<string>([layer, ...ALLOWED_IMPORTS[layer]]);
  const exceptions = DOCUMENTED_EXCEPTIONS[name] ?? [];
  const violations = new Set<string>();
  for (const specifier of importSpecifiers(readFileSync(file, 'utf-8'))) {
    if (!specifier.startsWith('.')) continue;
    if (exceptions.includes(specifier)) continue;
    const target = resolveSpecifierLayer(file, specifier);
    if (target === 'external') continue;
    if (target === 'root') {
      // Root barrels and glue dirs (setup/intelligence/plugin/tool) sit above
      // the layers; only server may reach them (server/services.ts,
      // server/handlers/setup.ts today).
      if (layer !== 'server') {
        violations.add(`${name} imports ${specifier} (root entry modules must not be imported from layer code)`);
      }
      continue;
    }
    if (target === 'protocols') {
      // capabilities.ts protocols allowedImporters: inside the package only the
      // server layer, plus the dependency-free wire-type door the runtime
      // layering test already polices (agent/runtime/layering.test.ts).
      if (layer !== 'server' && layer !== 'protocols' && !PROTOCOLS_IMPORTERS_OUTSIDE_SERVER.includes(name)) {
        violations.add(`${name} imports ${specifier} (protocols is server-only except the ${PROTOCOLS_IMPORTERS_OUTSIDE_SERVER.join(', ')} wire-type door)`);
      }
      continue;
    }
    if (!allowed.has(target)) {
      violations.add(`${name} (${layer}) imports ${specifier} (${target} is not below ${layer})`);
    }
  }
  return [...violations];
}

describe('package import direction', () => {
  const files = LAYERS.flatMap((layer) => listLayerSources(join(srcDir, layer))).sort();

  it('scans every layer directory', () => {
    for (const layer of LAYERS) {
      expect(files.some((file) => relative(srcDir, file).startsWith(`${layer}/`)), `${layer}/ has no scanned sources`).toBe(true);
    }
    expect(files.length).toBeGreaterThan(200);
  });

  it('keeps dependency arrows pointing foundation ← knowledge ← agent ← server', () => {
    const violations = files.flatMap(violationsForFile);
    expect(violations).toEqual([]);
  });

  it('drops documented exceptions as soon as they stop being needed', () => {
    for (const [name, specifiers] of Object.entries(DOCUMENTED_EXCEPTIONS)) {
      const file = join(srcDir, name);
      expect(existsSync(file), `${name} no longer exists; remove it from DOCUMENTED_EXCEPTIONS`).toBe(true);
      const imported = importSpecifiers(readFileSync(file, 'utf-8'));
      for (const specifier of specifiers) {
        expect(imported, `${name} no longer imports ${specifier}; remove it from DOCUMENTED_EXCEPTIONS`).toContain(specifier);
      }
    }
    expect(Object.keys(DOCUMENTED_EXCEPTIONS).length).toBeLessThanOrEqual(EXCEPTION_BUDGET);
  });

  it('would flag an upward import and a protocols reach-around', () => {
    const offending = [
      "import { listAgentRuns } from '../../agent/ledger/run-ledger.js';",
      "import { emitStudioAutomationEvent } from '../../server/automations/events.js';",
      "void import('../../protocols/acp/subprocess.js');",
      'export const x = 1;',
    ].join('\n');
    const specifiers = importSpecifiers(offending);
    expect(specifiers).toEqual([
      '../../agent/ledger/run-ledger.js',
      '../../server/automations/events.js',
      '../../protocols/acp/subprocess.js',
    ]);
  });

  it('ignores comments so doc references never count as edges', () => {
    const documented = "// imported from '../../server/automations/events.js' historically\nexport const y = 2;";
    expect(importSpecifiers(documented)).toEqual([]);
  });
});
