import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAcpAgentOverrides } from './acp-overrides.js';
import { parseAcpAgentOverrides as reexported } from '../../protocols/acp/agent-descriptors.js';

describe('parseAcpAgentOverrides (runtime layer)', () => {
  it('parses settings-style override records', () => {
    const parsed = parseAcpAgentOverrides({
      'ext-buddy': {
        name: 'External Buddy',
        command: 'codebuddy',
        args: ['--acp'],
        env: { BUDDY_TOKEN: 'secret', 'bad key': 'x', __proto__: 'y' },
        enabled: true,
      },
    });
    expect(parsed?.['ext-buddy']).toMatchObject({
      name: 'External Buddy',
      command: 'codebuddy',
      args: ['--acp'],
      enabled: true,
    });
    expect(parsed?.['ext-buddy'].env).toEqual({ BUDDY_TOKEN: 'secret' });
  });

  it('parses extension-manifest contributes.acpAdapters arrays', () => {
    const parsed = parseAcpAgentOverrides({
      contributes: {
        acpAdapters: [
          { id: 'ext-buddy', cliCommand: 'codebuddy', acpArgs: ['--acp'], supportsStreaming: true },
        ],
      },
    });
    expect(parsed?.['ext-buddy']).toMatchObject({
      command: 'codebuddy',
      args: ['--acp'],
      adapterMetadata: expect.objectContaining({ supportsStreaming: true }),
    });
  });

  it('drops unsafe agent ids and prototype keys', () => {
    const parsed = parseAcpAgentOverrides({
      '../escape': { command: 'evil' },
      '__proto__': { command: 'evil' },
      'constructor': { command: 'evil' },
      'ok-agent': { command: 'good' },
    });
    expect(Object.keys(parsed ?? {})).toEqual(['ok-agent']);
    expect(({} as Record<string, unknown>).command).toBeUndefined();
  });

  it('returns undefined for empty or non-record input', () => {
    expect(parseAcpAgentOverrides(undefined)).toBeUndefined();
    expect(parseAcpAgentOverrides({})).toBeUndefined();
    expect(parseAcpAgentOverrides([])).toBeUndefined();
    expect(parseAcpAgentOverrides('nope')).toBeUndefined();
    expect(parseAcpAgentOverrides({ agent: { command: '' } })).toBeUndefined();
  });

  it('stays reachable through the protocols/acp re-export shell', () => {
    expect(reexported).toBe(parseAcpAgentOverrides);
  });

  it('keeps the runtime module free of protocols imports', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'acp-overrides.ts'), 'utf-8');
    expect(source).not.toMatch(/from '[^']*protocols\//);
  });
});
