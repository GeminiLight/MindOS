import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendContentChange,
  listContentChanges,
  appendAgentAuditEvent,
  listAgentAuditEvents
} from './index';
import { LocalFileSystem } from '../storage/local.js';
import type { IFileSystem, Result, FileEntry } from '../storage/index.js';

class MockFileSystem implements IFileSystem {
  private files = new Map<string, string>();

  async readFile(path: string): Promise<Result<string>> {
    const content = this.files.get(path);
    if (!content) {
      return { ok: false, error: new Error('File not found') };
    }
    return { ok: true, value: content };
  }

  async writeFile(path: string, content: string): Promise<Result<void>> {
    this.files.set(path, content);
    return { ok: true, value: undefined };
  }

  async appendFile(path: string, content: string): Promise<Result<void>> {
    const existing = this.files.get(path) || '';
    this.files.set(path, existing + content);
    return { ok: true, value: undefined };
  }

  async exists(path: string): Promise<Result<boolean>> {
    return { ok: true, value: this.files.has(path) };
  }

  async mkdir(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }

  async readdir(): Promise<Result<FileEntry[]>> {
    return { ok: true, value: [] };
  }

  async remove(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }

  async stat() {
    return { ok: false, error: new Error('Not implemented') };
  }

  async copy() {
    return { ok: false, error: new Error('Not implemented') };
  }

  async move() {
    return { ok: false, error: new Error('Not implemented') };
  }
}

describe('Content Change Log', () => {
  let fs: MockFileSystem;
  const mindRoot = '/test/root';

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('should append a change entry', async () => {
    const result = await appendContentChange(fs, mindRoot, {
      op: 'create',
      path: 'test.md',
      source: 'agent',
      summary: 'Created file'
    });
    expect(result.ok).toBe(true);

    const queryResult = await listContentChanges(fs, mindRoot, { path: 'test.md' });
    expect(queryResult.ok).toBe(true);
    if (queryResult.ok) {
      expect(queryResult.value.length).toBeGreaterThan(0);
      expect(queryResult.value[0].path).toBe('test.md');
      expect(queryResult.value[0].op).toBe('create');
    }
  });

  it('should list all changes', async () => {
    await appendContentChange(fs, mindRoot, {
      op: 'create',
      path: 'file1.md',
      source: 'user',
      summary: 'Created'
    });
    await appendContentChange(fs, mindRoot, {
      op: 'update',
      path: 'file2.md',
      source: 'agent',
      summary: 'Updated'
    });

    const result = await listContentChanges(fs, mindRoot, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
    }
  });

  it('should reject change log writes through symlinked .mindos directories outside the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-knowledge-change-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-knowledge-change-outside-'));
    try {
      symlinkSync(outside, join(root, '.mindos'), 'dir');

      const result = await appendContentChange(new LocalFileSystem(), root, {
        op: 'create',
        path: 'note.md',
        source: 'agent',
        summary: 'Created file',
      });

      expect(result.ok).toBe(false);
      expect(existsSync(join(outside, 'change-log.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('Agent Audit Log', () => {
  let fs: MockFileSystem;
  const mindRoot = '/test/root';

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('should append an audit entry', async () => {
    const result = await appendAgentAuditEvent(fs, mindRoot, {
      ts: new Date().toISOString(),
      tool: 'file_create',
      params: { path: 'test.md' },
      result: 'ok',
      agentName: 'test-agent'
    });
    expect(result.ok).toBe(true);

    const queryResult = await listAgentAuditEvents(fs, mindRoot);
    expect(queryResult.ok).toBe(true);
    if (queryResult.ok) {
      expect(queryResult.value.length).toBeGreaterThan(0);
      const event = queryResult.value.find(e => e.agentName === 'test-agent');
      expect(event).toBeDefined();
      if (event) {
        expect(event.tool).toBe('file_create');
      }
    }
  });

  it('redacts audit params and stores raw debug only as redacted opt-in data', async () => {
    const result = await appendAgentAuditEvent(fs, mindRoot, {
      ts: '2026-03-25T00:00:00.000Z',
      tool: 'user_extension_run',
      params: {
        path: 'Daily.md',
        content: 'Authorization: Bearer sk-product-audit-secret-1234567890',
        nested: { apiKey: 'sk-product-audit-secret-abcdefghijkl' },
      },
      result: 'ok',
      message: 'token=abc123secret',
      debugCapture: 'redacted_raw',
      agentName: 'schedule-agent',
    });

    expect(result.ok).toBe(true);
    const queryResult = await listAgentAuditEvents(fs, mindRoot);
    expect(queryResult.ok).toBe(true);
    if (!queryResult.ok) return;
    const event = queryResult.value[0];
    expect(event.actionSummary).toContain('user_extension_run ok target=Daily.md');
    expect(event.params).toMatchObject({
      path: 'Daily.md',
      content: expect.stringMatching(/^\[\d+ chars\]$/),
      nested: { apiKey: '[redacted]' },
    });
    expect(event.message).toBe('token=[redacted]');
    expect(JSON.stringify(event.rawDebug)).toContain('[redacted]');
    expect(JSON.stringify(event)).not.toContain('sk-product-audit-secret');
    expect(JSON.stringify(event)).not.toContain('abc123secret');
  });

  it('should list all audit events', async () => {
    await appendAgentAuditEvent(fs, mindRoot, {
      ts: new Date().toISOString(),
      tool: 'action1',
      params: {},
      result: 'ok',
      agentName: 'agent1'
    });
    await appendAgentAuditEvent(fs, mindRoot, {
      ts: new Date().toISOString(),
      tool: 'action2',
      params: {},
      result: 'ok',
      agentName: 'agent2'
    });

    const result = await listAgentAuditEvents(fs, mindRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
      const agent1Events = result.value.filter(e => e.agentName === 'agent1');
      expect(agent1Events.length).toBe(1);
    }
  });

  it('redacts secrets from existing persisted audit logs before listing', async () => {
    await fs.writeFile(join(mindRoot, '.mindos', 'agent-audit-log.json'), JSON.stringify({
      version: 1,
      events: [{
        id: 'persisted-1',
        ts: '2026-03-25T00:00:00.000Z',
        tool: 'persisted_tool',
        params: {
          Authorization: 'Bearer sk-persisted-secret-1234567890',
          content: 'raw text',
        },
        result: 'ok',
        message: 'apiKey=sk-persisted-secret-abcdefghijkl',
      }],
    }));

    const result = await listAgentAuditEvents(fs, mindRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain('sk-persisted-secret');
    expect(result.value[0].params).toMatchObject({
      Authorization: '[redacted]',
      content: '[8 chars]',
    });
    expect(result.value[0].message).toBe('apiKey=[redacted]');
    expect(result.value[0].actionSummary).toContain('persisted_tool ok');
  });

  it('should reject audit log writes through symlinked .mindos directories outside the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-knowledge-audit-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-knowledge-audit-outside-'));
    try {
      symlinkSync(outside, join(root, '.mindos'), 'dir');

      const result = await appendAgentAuditEvent(new LocalFileSystem(), root, {
        ts: new Date().toISOString(),
        tool: 'file_create',
        params: { path: 'note.md' },
        result: 'ok',
        agentName: 'test-agent',
      });

      expect(result.ok).toBe(false);
      expect(existsSync(join(outside, 'agent-audit-log.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
