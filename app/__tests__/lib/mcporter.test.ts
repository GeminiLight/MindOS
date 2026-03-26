import { describe, expect, it } from 'vitest';

import { createMcporterAgentTools, extractJsonObject } from '@/lib/pi-integration/mcporter';

describe('mcporter integration helpers', () => {
  it('extracts JSON payload from noisy mcporter output', () => {
    const output = [
      'npm warn Unknown project config "shamefully-hoist".',
      '⠙⠹{',
      '  "mode": "list",',
      '  "servers": [',
      '    { "name": "context7", "status": "ok" }',
      '  ]',
      '}',
      '⠙',
    ].join('\n');

    expect(JSON.parse(extractJsonObject(output))).toEqual({
      mode: 'list',
      servers: [{ name: 'context7', status: 'ok' }],
    });
  });

  it('throws when no JSON object exists', () => {
    expect(() => extractJsonObject('plain text only')).toThrow(/Failed to parse mcporter output/);
  });

  it('creates dynamic agent tools only for healthy MCP servers', () => {
    const tools = createMcporterAgentTools([
      {
        name: 'context7',
        status: 'ok',
        tools: [
          {
            name: 'resolve-library-id',
            description: 'Resolve a library id',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        ],
      },
      {
        name: 'offline-server',
        status: 'offline',
        tools: [
          { name: 'ignored-tool', description: 'Should not load' },
        ],
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp__context7__resolve_library_id');
    expect(tools[0].label).toContain('context7');
    expect(tools[0].description).toContain('Resolve a library id');
  });
});
