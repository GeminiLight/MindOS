import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAutomationEventsGet, handleAutomationEventsPost } from './automation-events.js';

let mindRoot = '';

describe('automation event handlers', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-event-handler-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });
  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('accepts idempotent events and lists their durable delivery state', () => {
    const first = handleAutomationEventsPost({
      source: 'api', key: 'release-1', type: 'release.ready',
      occurredAt: '2026-09-03T12:00:00.000Z', payload: { tag: 'v1.2.3' },
    }, { mindRoot });
    const duplicate = handleAutomationEventsPost({
      source: 'api', key: 'release-1', type: 'release.ready', payload: {},
    }, { mindRoot });
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ created: false });

    const listed = handleAutomationEventsGet(new URLSearchParams('source=api&limit=10'), { mindRoot });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      schemaVersion: 1,
      events: [{ source: 'api', key: 'release-1', type: 'release.ready' }],
      summary: { total: 1 },
    });
  });

  it('rejects malformed timestamps, oversized keys, and non-object payloads', () => {
    expect(handleAutomationEventsPost({ source: 'api', key: 'x', type: 'release.ready', occurredAt: 'never' }, { mindRoot }).status).toBe(400);
    expect(handleAutomationEventsPost({ source: 'api', key: 'x'.repeat(501), type: 'release.ready' }, { mindRoot }).status).toBe(400);
    expect(handleAutomationEventsPost({ source: 'api', key: 'x', type: 'release.ready', payload: [] }, { mindRoot }).status).toBe(400);
  });
});
