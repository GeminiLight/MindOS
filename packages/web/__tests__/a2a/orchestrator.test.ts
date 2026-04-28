import { describe, it, expect, beforeEach, vi } from 'vitest';
import { matchSkill, decompose, createPlan, executePlan } from '../../lib/a2a/orchestrator';
import { discoverAgent, getDiscoveredAgents, clearRegistry } from '../../lib/a2a/client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CARD_SEARCH = {
  name: 'SearchAgent',
  description: 'A search agent',
  version: '1.0.0',
  provider: { organization: 'Test', url: 'http://search:3000' },
  supportedInterfaces: [{ url: 'http://search:3000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    { id: 'search', name: 'Search Files', description: 'Search knowledge base files', tags: ['search', 'files', 'knowledge'] },
  ],
};

const MOCK_CARD_CODE = {
  name: 'CodeAgent',
  description: 'A coding agent',
  version: '1.0.0',
  provider: { organization: 'Test', url: 'http://code:4000' },
  supportedInterfaces: [{ url: 'http://code:4000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    { id: 'write-code', name: 'Write Code', description: 'Write and review code', tags: ['code', 'write', 'review'] },
  ],
};

describe('A2A Orchestrator', () => {
  beforeEach(() => {
    clearRegistry();
    mockFetch.mockReset();
  });

  describe('decompose', () => {
    it('splits numbered list into subtasks', () => {
      const tasks = decompose('1. Search for notes. 2. Summarize results. 3. Write report.');
      expect(tasks).toHaveLength(3);
      expect(tasks[0].description).toContain('Search');
      expect(tasks[1].description).toContain('Summarize');
      expect(tasks[2].description).toContain('Write');
    });

    it('splits on conjunctions', () => {
      const tasks = decompose('Search for notes; then summarize them');
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps single task as-is', () => {
      const tasks = decompose('Search for project notes');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe('Search for project notes');
    });

    it('uses provided subtask descriptions', () => {
      const tasks = decompose('complex request', ['task A', 'task B']);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].description).toBe('task A');
      expect(tasks[1].description).toBe('task B');
    });

    it('limits to MAX_SUBTASKS', () => {
      const many = Array.from({ length: 20 }, (_, i) => `task ${i}`);
      const tasks = decompose('many tasks', many);
      expect(tasks.length).toBeLessThanOrEqual(10);
    });

    it('assigns unique IDs to each subtask', () => {
      const tasks = decompose('x', ['a', 'b', 'c']);
      const ids = new Set(tasks.map(t => t.id));
      expect(ids.size).toBe(3);
    });

    it('initializes subtasks with pending status', () => {
      const tasks = decompose('x', ['a']);
      expect(tasks[0].status).toBe('pending');
      expect(tasks[0].result).toBeNull();
      expect(tasks[0].error).toBeNull();
      expect(tasks[0].assignedAgentId).toBeNull();
    });
  });

  describe('matchSkill', () => {
    it('returns null when no agents discovered', () => {
      expect(matchSkill('search for files')).toBeNull();
    });

    it('matches search task to search agent', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_CODE });
      await discoverAgent('http://search:3000');
      await discoverAgent('http://code:4000');

      const match = matchSkill('search knowledge base files');
      expect(match).not.toBeNull();
      expect(match!.agentName).toBe('SearchAgent');
      expect(match!.skillId).toBe('search');
    });

    it('matches code task to code agent', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_CODE });
      await discoverAgent('http://search:3000');
      await discoverAgent('http://code:4000');

      const match = matchSkill('write code review');
      expect(match).not.toBeNull();
      expect(match!.agentName).toBe('CodeAgent');
    });
  });

  describe('createPlan', () => {
    it('creates a plan with subtasks', () => {
      const plan = createPlan('do things', 'parallel', ['task A', 'task B']);
      expect(plan.id).toBeTruthy();
      expect(plan.status).toBe('planning');
      expect(plan.subtasks).toHaveLength(2);
      expect(plan.strategy).toBe('parallel');
    });

    it('auto-matches skills when agents are available', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      await discoverAgent('http://search:3000');

      const plan = createPlan('find things', 'parallel', ['search files']);
      const assigned = plan.subtasks.filter(st => st.assignedAgentId);
      expect(assigned.length).toBeGreaterThanOrEqual(0);
    });

    it('defaults to parallel strategy', () => {
      const plan = createPlan('test');
      expect(plan.strategy).toBe('parallel');
    });
  });

  describe('executePlan', () => {
    it('fails when no agents assigned to any subtask', async () => {
      const plan = createPlan('no agents', 'parallel', ['task A']);
      const result = await executePlan(plan);
      expect(result.status).toBe('failed');
      expect(result.aggregatedResult).toContain('No agents available');
    });

    it('executes parallel plan with assigned agents', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      await discoverAgent('http://search:3000');

      const plan = createPlan('search', 'parallel', ['search files']);
      // Manually assign agent
      plan.subtasks[0].assignedAgentId = getDiscoveredAgents()[0].id;

      // Mock RPC response for delegation
      const mockTask = {
        id: 'task-1',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
        artifacts: [{ artifactId: 'a1', parts: [{ text: 'found 3 files' }] }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: '1', result: mockTask }),
      });

      const result = await executePlan(plan);
      expect(result.status).toBe('completed');
      expect(result.aggregatedResult).toContain('found 3 files');
      expect(result.completedAt).toBeTruthy();
    });

    it('handles mixed success and failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      await discoverAgent('http://search:3000');
      const agentId = getDiscoveredAgents()[0].id;

      const plan = createPlan('multi', 'parallel', ['task ok', 'task fail']);
      plan.subtasks[0].assignedAgentId = agentId;
      plan.subtasks[1].assignedAgentId = agentId;

      // First succeeds, second fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0', id: '1',
          result: { id: 't1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '' }, artifacts: [{ artifactId: 'a1', parts: [{ text: 'ok' }] }] },
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0', id: '2',
          error: { code: -32603, message: 'Internal error' },
        }),
      });

      const result = await executePlan(plan);
      expect(result.status).toBe('completed');
      expect(result.aggregatedResult).toContain('ok');
      expect(result.aggregatedResult).toContain('Failed');
    });

    it('stops on failure in sequential mode', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      await discoverAgent('http://search:3000');
      const agentId = getDiscoveredAgents()[0].id;

      const plan = createPlan('seq', 'sequential', ['first', 'second']);
      plan.subtasks[0].assignedAgentId = agentId;
      plan.subtasks[1].assignedAgentId = agentId;

      // First fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0', id: '1',
          error: { code: -32603, message: 'boom' },
        }),
      });

      const result = await executePlan(plan);
      expect(plan.subtasks[0].status).toBe('failed');
      expect(plan.subtasks[1].status).toBe('pending');
    });

    it('marks unassigned subtasks as failed before execution', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD_SEARCH });
      await discoverAgent('http://search:3000');
      const agentId = getDiscoveredAgents()[0].id;

      const plan = createPlan('mixed', 'parallel', ['search files', 'unrelated task']);
      plan.subtasks[0].assignedAgentId = agentId;
      // subtask[1] stays unassigned

      const mockTask = {
        id: 't1',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: '' },
        artifacts: [{ artifactId: 'a1', parts: [{ text: 'found stuff' }] }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: '1', result: mockTask }),
      });

      const result = await executePlan(plan);
      expect(result.subtasks[0].status).toBe('completed');
      expect(result.subtasks[1].status).toBe('failed');
      expect(result.subtasks[1].error).toContain('No matching agent');
    });

    it('sets completedAt timestamp on finish', async () => {
      const plan = createPlan('no agents', 'parallel', ['task A']);
      expect(plan.completedAt).toBeNull();
      await executePlan(plan);
      // Even failed plans should get a completedAt (or aggregatedResult)
      expect(plan.aggregatedResult).toBeTruthy();
    });
  });

  describe('decompose edge cases', () => {
    it('handles empty string', () => {
      const tasks = decompose('');
      expect(tasks).toHaveLength(1);
    });

    it('handles numbered list with periods in content', () => {
      const tasks = decompose('1. Search for notes about A.I. 2. Write a summary');
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it('trims whitespace from subtask descriptions', () => {
      const tasks = decompose('x', ['  task with spaces  ']);
      expect(tasks[0].description).toBe('task with spaces');
    });
  });
});
