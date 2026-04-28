import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendContentChange,
  listContentChanges,
  appendAgentAuditEvent,
  listAgentAuditEvents
} from './index';
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
});
