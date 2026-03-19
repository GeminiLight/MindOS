import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Dependency safety tests — catch version-range vs actual-import mismatches
 * before they reach users.
 *
 * Motivation: @modelcontextprotocol/sdk declared ^1.6.1 but code imported
 * server/express.js which only exists since 1.25.0. The lockfile masked the
 * bug locally; fresh installs on new machines crashed at runtime.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const MCP_DIR = path.join(ROOT, 'mcp');
const MCP_SRC = path.join(MCP_DIR, 'src', 'index.ts');
const MCP_NODE_MODULES = path.join(MCP_DIR, 'node_modules');

const hasMcpSrc = fs.existsSync(MCP_SRC);
const hasMcpModules = fs.existsSync(MCP_NODE_MODULES);

describe.skipIf(!hasMcpSrc)('MCP dependency safety', () => {
  /** Extract all bare-specifier imports from a TS/JS file */
  function extractImports(filePath: string): string[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports: string[] = [];
    // Match: import ... from "pkg" / import ... from "pkg/sub/path.js"
    const re = /import\s+(?:[^'"]+)\s+from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      // Skip node: built-ins and relative imports
      if (!m[1].startsWith('.') && !m[1].startsWith('node:')) {
        imports.push(m[1]);
      }
    }
    return imports;
  }

  it('all MCP source imports resolve to existing files in node_modules', () => {
    if (!hasMcpModules) return; // skip if deps not installed

    const imports = extractImports(MCP_SRC);
    expect(imports.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const specifier of imports) {
      // e.g. "@modelcontextprotocol/sdk/server/express.js" or "zod"
      try {
        require.resolve(specifier, { paths: [MCP_DIR] });
      } catch {
        missing.push(specifier);
      }
    }

    expect(missing, `Imports not resolvable in node_modules: ${missing.join(', ')}`).toEqual([]);
  });

  it('package.json version range lower bound has required subpath exports', () => {
    // Read package.json to get declared deps
    const pkgPath = path.join(MCP_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const sdkRange = pkg.dependencies?.['@modelcontextprotocol/sdk'];
    if (!sdkRange) return;

    // Extract lower bound from semver range (^1.25.0 → 1.25.0)
    const lowerMatch = sdkRange.match(/(\d+\.\d+\.\d+)/);
    if (!lowerMatch) return;
    const lowerBound = lowerMatch[1];
    const [major, minor] = lowerBound.split('.').map(Number);

    // The express.js subpath was added in 1.25.0 — ensure our lower bound is >= 1.25.0
    // This is a specific guard for the known breaking change
    const imports = extractImports(MCP_SRC);
    const usesExpress = imports.some(i => i.includes('express'));
    if (usesExpress) {
      expect(
        major > 1 || (major === 1 && minor >= 25),
        `SDK version range "${sdkRange}" allows <1.25.0 which lacks server/express.js`,
      ).toBe(true);
    }
  });
});

describe('npm install patterns', () => {
  it('no raw --prefer-offline without fallback in CLI scripts', () => {
    // Scan bin/ for direct --prefer-offline usage that bypasses npmInstall()
    const binDir = path.join(ROOT, 'bin');
    const files = collectJsFiles(binDir);

    const violations: string[] = [];
    for (const file of files) {
      // utils.js defines npmInstall() which legitimately uses --prefer-offline
      if (path.basename(file) === 'utils.js') continue;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Flag: execSync/run with --prefer-offline (should use npmInstall instead)
        if (line.includes('--prefer-offline') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
          violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      violations,
      `Found raw --prefer-offline usage (use npmInstall() from utils.js instead):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

/** Collect .js files recursively */
function collectJsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}
