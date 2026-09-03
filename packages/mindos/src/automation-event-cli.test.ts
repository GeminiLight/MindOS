import { describe, expect, it } from 'vitest';

import { parseAutomationEmitRequest } from '../bin/commands/automation.js';

describe('automation event CLI', () => {
  it('parses an event with a structured payload and stable source key', () => {
    expect(parseAutomationEmitRequest(
      ['knowledge.changed'],
      {
        source: 'knowledge',
        key: 'change-42',
        payload: '{"path":"notes/计划.md","operation":"update"}',
        'occurred-at': '2026-09-03T09:00:00.000Z',
      },
    )).toEqual({
      source: 'knowledge',
      key: 'change-42',
      type: 'knowledge.changed',
      payload: { path: 'notes/计划.md', operation: 'update' },
      occurredAt: new Date('2026-09-03T09:00:00.000Z'),
    });
  });

  it('rejects missing identity fields, arrays, malformed JSON, and invalid timestamps', () => {
    expect(() => parseAutomationEmitRequest([], { source: 'api', key: '1' })).toThrow(/event type/i);
    expect(() => parseAutomationEmitRequest(['custom.event'], { key: '1' })).toThrow(/source/i);
    expect(() => parseAutomationEmitRequest(['custom.event'], { source: 'api' })).toThrow(/key/i);
    expect(() => parseAutomationEmitRequest(['custom.event'], { source: 'api', key: '1', payload: '[]' })).toThrow(/JSON object/i);
    expect(() => parseAutomationEmitRequest(['custom.event'], { source: 'api', key: '1', payload: '{' })).toThrow(/valid JSON/i);
    expect(() => parseAutomationEmitRequest(['custom.event'], { source: 'api', key: '1', 'occurred-at': 'tomorrow' })).toThrow(/ISO timestamp/i);
  });
});
