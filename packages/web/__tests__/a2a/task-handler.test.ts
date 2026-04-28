import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleSendMessage, handleGetTask, handleCancelTask } from '../../lib/a2a/task-handler';
import type { SendMessageParams } from '../../lib/a2a/types';

function makeMessage(text: string): SendMessageParams {
  return {
    message: { role: 'ROLE_USER', parts: [{ text }] },
  };
}

/**
 * Mock global.fetch to simulate API responses.
 * executeTool calls fetch("http://localhost:.../api/...") which would time out
 * in test environments where no HTTP server is running.
 */
function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/search')) {
      return new Response(JSON.stringify({ results: [{ path: 'test.md', snippet: 'test result', score: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/file')) {
      return new Response(JSON.stringify({ content: '# Test file content' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/files')) {
      return new Response(JSON.stringify({ tree: [{ name: 'test.md', path: 'test.md', type: 'file' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  });
}

describe('A2A Task Handler', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = mockFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('handleSendMessage', () => {
    it('returns a task with an id and status', async () => {
      const task = await handleSendMessage(makeMessage('search for meeting notes'));
      expect(task.id).toBeTruthy();
      expect(task.status).toBeDefined();
      expect(task.status.timestamp).toBeTruthy();
    });

    it('fails gracefully for empty message', async () => {
      const task = await handleSendMessage({ message: { role: 'ROLE_USER', parts: [{ text: '' }] } });
      expect(task.status.state).toBe('TASK_STATE_FAILED');
    });

    it('stores task history', async () => {
      const task = await handleSendMessage(makeMessage('search for test'));
      // History should include at least the user message
      expect(task.history).toBeDefined();
      expect(task.history!.length).toBeGreaterThanOrEqual(1);
      expect(task.history![0].role).toBe('ROLE_USER');
    });
  });

  describe('handleGetTask', () => {
    it('returns null for non-existent task', () => {
      const result = handleGetTask({ id: 'non-existent-id' });
      expect(result).toBeNull();
    });

    it('retrieves a previously created task', async () => {
      const task = await handleSendMessage(makeMessage('list files'));
      const retrieved = handleGetTask({ id: task.id });
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(task.id);
    });
  });

  describe('handleCancelTask', () => {
    it('returns not_found for non-existent task', () => {
      const { task, reason } = handleCancelTask({ id: 'non-existent-id' });
      expect(task).toBeNull();
      expect(reason).toBe('not_found');
    });

    it('returns not_cancelable for already completed task', async () => {
      const task = await handleSendMessage(makeMessage('search for anything'));
      const { task: canceledTask, reason } = handleCancelTask({ id: task.id });
      expect(canceledTask).toBeNull();
      expect(reason).toBe('not_cancelable');
    });
  });

  describe('skill routing', () => {
    it('routes search-like messages to search_notes', async () => {
      const task = await handleSendMessage(makeMessage('search for project updates'));
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      // Verify fetch was called with search endpoint
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/search?q='),
        expect.anything(),
      );
    });

    it('routes read-like messages to read_file', async () => {
      const task = await handleSendMessage(makeMessage('read the file at test.md'));
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/file?path='),
        expect.anything(),
      );
    });

    it('routes list-like messages to list_files', async () => {
      const task = await handleSendMessage(makeMessage('list files'));
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/files'),
        expect.anything(),
      );
    });

    it('falls back to search for unrecognized messages', async () => {
      const task = await handleSendMessage(makeMessage('tell me about my projects'));
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      // Unrecognized → falls back to search_notes
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/search?q='),
        expect.anything(),
      );
    });
  });
});
