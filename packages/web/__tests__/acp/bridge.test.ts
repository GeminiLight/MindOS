import { describe, it, expect, vi } from 'vitest';
import type { A2AMessage } from '../../lib/a2a/types';
import type { AcpPromptResponse, AcpSessionUpdate } from '../../lib/acp/types';
import { bridgeAcpResponseToA2a, bridgeAcpUpdatesToA2a } from '../../lib/acp/bridge';

// Mock session module for bridgeA2aToAcp
vi.mock('../../lib/acp/session', () => ({
  createSession: vi.fn(),
  prompt: vi.fn(),
  closeSession: vi.fn(),
}));

import { bridgeA2aToAcp } from '../../lib/acp/bridge';
import { createSession, prompt, closeSession } from '../../lib/acp/session';

describe('A2A-ACP Bridge', () => {
  describe('bridgeA2aToAcp', () => {
    it('bridges A2A message to ACP and returns completed task', async () => {
      vi.mocked(createSession).mockResolvedValueOnce({
        id: 'ses-1',
        agentId: 'test',
        state: 'idle',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      });
      vi.mocked(prompt).mockResolvedValueOnce({
        sessionId: 'ses-1',
        text: 'Agent response',
        done: true,
      });
      vi.mocked(closeSession).mockResolvedValueOnce(undefined);

      const a2aMsg: A2AMessage = {
        role: 'ROLE_USER',
        parts: [{ text: 'Hello ACP agent' }],
      };

      const task = await bridgeA2aToAcp(a2aMsg, 'test-agent');

      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(task.artifacts?.[0]?.parts[0]?.text).toBe('Agent response');
    });

    it('returns failed task for empty message', async () => {
      const a2aMsg: A2AMessage = {
        role: 'ROLE_USER',
        parts: [{ data: { binary: true } }],
      };

      const task = await bridgeA2aToAcp(a2aMsg, 'test-agent');

      expect(task.status.state).toBe('TASK_STATE_FAILED');
      expect(task.status.message?.parts[0]?.text).toContain('No text content');
    });

    it('returns failed task when session creation fails', async () => {
      vi.mocked(createSession).mockRejectedValueOnce(new Error('Agent not found'));

      const a2aMsg: A2AMessage = {
        role: 'ROLE_USER',
        parts: [{ text: 'test' }],
      };

      const task = await bridgeA2aToAcp(a2aMsg, 'nonexistent');

      expect(task.status.state).toBe('TASK_STATE_FAILED');
      expect(task.status.message?.parts[0]?.text).toContain('Failed to create ACP session');
    });

    it('returns failed task when prompt fails', async () => {
      vi.mocked(createSession).mockResolvedValueOnce({
        id: 'ses-1',
        agentId: 'test',
        state: 'idle',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      });
      vi.mocked(prompt).mockRejectedValueOnce(new Error('Agent crashed'));
      vi.mocked(closeSession).mockResolvedValueOnce(undefined);

      const a2aMsg: A2AMessage = {
        role: 'ROLE_USER',
        parts: [{ text: 'crash me' }],
      };

      const task = await bridgeA2aToAcp(a2aMsg, 'test-agent');

      expect(task.status.state).toBe('TASK_STATE_FAILED');
      expect(task.status.message?.parts[0]?.text).toContain('ACP prompt failed');
    });

    it('closes session even on prompt failure', async () => {
      vi.mocked(createSession).mockResolvedValueOnce({
        id: 'ses-1',
        agentId: 'test',
        state: 'idle',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      });
      vi.mocked(prompt).mockRejectedValueOnce(new Error('fail'));
      vi.mocked(closeSession).mockResolvedValueOnce(undefined);

      const a2aMsg: A2AMessage = {
        role: 'ROLE_USER',
        parts: [{ text: 'test' }],
      };

      await bridgeA2aToAcp(a2aMsg, 'test');

      expect(closeSession).toHaveBeenCalledWith('ses-1');
    });
  });

  describe('bridgeAcpResponseToA2a', () => {
    it('converts a prompt response to A2A task', () => {
      const response: AcpPromptResponse = {
        sessionId: 'ses-1',
        text: 'Hello from ACP',
        done: true,
      };

      const task = bridgeAcpResponseToA2a('task-1', response);

      expect(task.id).toBe('task-1');
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(task.status.message?.role).toBe('ROLE_AGENT');
      expect(task.status.message?.parts[0]?.text).toBe('Hello from ACP');
      expect(task.artifacts?.[0]?.parts[0]?.text).toBe('Hello from ACP');
    });

    it('creates task without artifacts for empty response', () => {
      const response: AcpPromptResponse = {
        sessionId: 'ses-1',
        text: '',
        done: true,
      };

      const task = bridgeAcpResponseToA2a('task-1', response);

      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(task.artifacts).toBeUndefined();
    });
  });

  describe('bridgeAcpUpdatesToA2a', () => {
    it('aggregates text updates into completed task', () => {
      const updates: AcpSessionUpdate[] = [
        { sessionId: 'ses-1', type: 'text', text: 'Hello ' },
        { sessionId: 'ses-1', type: 'text', text: 'world' },
        { sessionId: 'ses-1', type: 'done' },
      ];

      const task = bridgeAcpUpdatesToA2a('task-1', updates);

      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(task.status.message?.parts[0]?.text).toBe('Hello world');
    });

    it('returns working state for incomplete updates', () => {
      const updates: AcpSessionUpdate[] = [
        { sessionId: 'ses-1', type: 'text', text: 'partial' },
      ];

      const task = bridgeAcpUpdatesToA2a('task-1', updates);

      expect(task.status.state).toBe('TASK_STATE_WORKING');
    });

    it('returns failed state for error update', () => {
      const updates: AcpSessionUpdate[] = [
        { sessionId: 'ses-1', type: 'text', text: 'start...' },
        { sessionId: 'ses-1', type: 'error', error: 'Agent died' },
      ];

      const task = bridgeAcpUpdatesToA2a('task-1', updates);

      expect(task.status.state).toBe('TASK_STATE_FAILED');
      expect(task.status.message?.parts[0]?.text).toBe('Agent died');
    });

    it('handles empty updates', () => {
      const task = bridgeAcpUpdatesToA2a('task-1', []);

      expect(task.status.state).toBe('TASK_STATE_WORKING');
      expect(task.artifacts).toBeUndefined();
    });
  });
});
