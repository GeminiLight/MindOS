import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Layering contract for `agent/runtime` → `protocols/acp`.
 *
 * The runtime layer is allowed to know the ACP *wire types* (they describe the
 * shape of `initialize` / `session/*` payloads that descriptors project), but it
 * must not reach into the protocol host (subprocess, session, registry fetch).
 * The only door is `acp-types.ts`, which re-exports from the dependency-free
 * `protocols/acp/types.ts`. Everything else in `agent/runtime/**` imports ACP
 * types from `./acp-types.js` (spec-runtime-descriptor-single-source).
 */

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(runtimeDir, '..', '..');

const WIRE_TYPES_MODULE = '../../protocols/acp/types.js';

/**
 * Files owned by other tasks that still import `protocols/acp` directly. Each
 * entry names the import it is allowed to keep; once the file stops importing
 * `protocols/`, the entry itself fails the test so the exception cannot linger.
 */
const DOCUMENTED_EXCEPTIONS: Record<string, string> = {
  // `parseAcpAgentOverrides` is now reachable without the protocol host, but the
  // manifest parser belongs to the extension-manifest owner; they only need to
  // repoint one import.
  'extension-manifest.ts': '../../protocols/acp/agent-descriptors.js',
};

function listRuntimeSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRuntimeSources(abs));
    else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(abs);
  }
  return out.sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;
  for (const match of stripComments(source).matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

function protocolImports(file: string): string[] {
  return importSpecifiers(readFileSync(file, 'utf-8')).filter((specifier) => specifier.includes('protocols/'));
}

describe('agent/runtime layering', () => {
  const files = listRuntimeSources(runtimeDir);

  it('only reaches protocols/acp through acp-types.ts (wire types) or a documented exception', () => {
    const violations: string[] = [];
    for (const file of files) {
      const name = relative(runtimeDir, file);
      const imports = protocolImports(file);
      if (imports.length === 0) continue;
      if (name === 'acp-types.ts') {
        for (const specifier of imports) {
          if (specifier !== WIRE_TYPES_MODULE) violations.push(`${name} imports ${specifier} (only ${WIRE_TYPES_MODULE} is allowed)`);
        }
        continue;
      }
      const allowed = DOCUMENTED_EXCEPTIONS[name];
      for (const specifier of imports) {
        if (specifier !== allowed) violations.push(`${name} imports ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('drops documented exceptions as soon as the file stops needing them', () => {
    for (const [name, specifier] of Object.entries(DOCUMENTED_EXCEPTIONS)) {
      const file = join(runtimeDir, name);
      expect(existsSync(file), `${name} no longer exists; remove it from DOCUMENTED_EXCEPTIONS`).toBe(true);
      expect(protocolImports(file), `${name} no longer imports ${specifier}; remove it from DOCUMENTED_EXCEPTIONS`).toContain(specifier);
    }
  });

  it('keeps acp-types.ts as a pure re-export barrel over the wire-type module', () => {
    const source = stripComments(readFileSync(join(runtimeDir, 'acp-types.ts'), 'utf-8'));
    const statements = source.split(/;\s*/).map((statement) => statement.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement, statement.slice(0, 80)).toMatch(/^export (?:type )?\{[\s\S]*\} from '\.\.\/\.\.\/protocols\/acp\/types\.js'$/);
    }
  });

  it('keeps protocols/acp/types.ts dependency-free so the wire-type door never drags the protocol host in', () => {
    const source = readFileSync(resolve(srcDir, 'protocols/acp/types.ts'), 'utf-8');
    expect(importSpecifiers(source)).toEqual([]);
  });

  it('would flag a runtime module that imports the protocol host directly', () => {
    const offending = "import { spawnAndConnect } from '../../protocols/acp/subprocess.js';\nexport const x = 1;";
    expect(importSpecifiers(offending).filter((specifier) => specifier.includes('protocols/'))).toEqual([
      '../../protocols/acp/subprocess.js',
    ]);
  });
});
