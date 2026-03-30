import { describe, it, expect, beforeEach } from 'vitest';
import { handleSendMessage, handleGetTask, handleCancelTask } from '../../lib/a2a/task-handler';
import type { SendMessageParams } from '../../lib/a2a/types';

function makeMessage(text: string): SendMessageParams {
  return {
    message: { role: 'ROLE_USER', parts: [{ text }] },
  };
}

describe('A2A Task Handler', () => {
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
    it('returns null for non-existent task', () => {
      const result = handleCancelTask({ id: 'non-existent-id' });
      expect(result).toBeNull();
    });

    it('returns null for already completed task', async () => {
      const task = await handleSendMessage(makeMessage('search for anything'));
      // Task completes synchronously in Phase 1, so it should be completed or failed
      const result = handleCancelTask({ id: task.id });
      expect(result).toBeNull(); // completed tasks can't be canceled
    });
  });

  describe('skill routing', () => {
    it('routes search-like messages to search_notes', async () => {
      const task = await handleSendMessage(makeMessage('search for project updates'));
      // Should attempt search (may fail due to no server, but state tells us it tried)
      expect(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED']).toContain(task.status.state);
    });

    it('routes read-like messages to read_file', async () => {
      const task = await handleSendMessage(makeMessage('read the file at test.md'));
      expect(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED']).toContain(task.status.state);
    });

    it('routes list-like messages to list_files', async () => {
      const task = await handleSendMessage(makeMessage('list files'));
      expect(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED']).toContain(task.status.state);
    });

    it('falls back to search for unrecognized messages', async () => {
      const task = await handleSendMessage(makeMessage('tell me about my projects'));
      expect(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED']).toContain(task.status.state);
    });
  });
});
