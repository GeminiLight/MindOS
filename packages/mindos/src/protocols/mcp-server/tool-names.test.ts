import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MINDOS_MCP_TOOL_COUNT, MINDOS_MCP_TOOL_NAMES } from './tool-names.js';

const here = dirname(fileURLToPath(import.meta.url));

function registeredToolNamesFromSource(): string[] {
  const source = readFileSync(resolve(here, 'tools.ts'), 'utf-8');
  return [...source.matchAll(/\bregisterTool\(\s*["']([^"']+)["']/g)].map((match) => match[1]!);
}

describe('MINDOS_MCP_TOOL_NAMES source contract', () => {
  it('matches every registerTool(...) call in tools.ts, in order', () => {
    const registered = registeredToolNamesFromSource();
    expect(registered.length).toBeGreaterThan(0);
    expect([...MINDOS_MCP_TOOL_NAMES]).toEqual(registered);
  });

  it('exposes a count equal to the number of registerTool(...) calls', () => {
    expect(MINDOS_MCP_TOOL_COUNT).toBe(registeredToolNamesFromSource().length);
    expect(MINDOS_MCP_TOOL_COUNT).toBe(MINDOS_MCP_TOOL_NAMES.length);
  });

  it('contains only unique, namespaced tool names', () => {
    expect(new Set(MINDOS_MCP_TOOL_NAMES).size).toBe(MINDOS_MCP_TOOL_NAMES.length);
    for (const name of MINDOS_MCP_TOOL_NAMES) expect(name).toMatch(/^mindos_[a-z_]+$/);
  });
});
