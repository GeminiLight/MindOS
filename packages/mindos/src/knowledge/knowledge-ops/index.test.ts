import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createKnowledgeOperationActor,
  deriveKnowledgeOperationSource,
  executeKnowledgeOperation,
  type KnowledgeOperationResponses,
} from './index';

interface TestResponse {
  status: number;
  body: Record<string, unknown>;
}

const responses: KnowledgeOperationResponses<TestResponse> = {
  badRequest: (message) => ({ status: 400, body: { error: message } }),
  denied: (reason) => ({ status: 403, body: { error: reason } }),
  permissionRequired: ({ op, path, reason, requestId }) => ({
    status: 403,
    body: {
      error: 'permission_required',
      requestId,
      message: `${reason} (${op} ${path})`,
    },
  }),
};

describe('@mindos/knowledge-ops', () => {
  it('allows an operation, calls the injected handler, and marks tree-changing ops', async () => {
    const handler = vi.fn(async (filePath: string, params: Record<string, unknown>) => ({
      response: { status: 200, body: { ok: true, filePath, content: params.content } },
      changeEvent: { op: 'create_file', path: filePath, summary: 'Created file' },
    }));

    const result = await executeKnowledgeOperation({
      body: { op: 'create_file', path: 'notes/today.md', content: 'hello' },
      source: 'user',
      actor: { type: 'user' },
      handlers: { create_file: handler },
      responses,
    });

    expect(handler).toHaveBeenCalledWith('notes/today.md', { content: 'hello' });
    expect(result.response).toEqual({ status: 200, body: { ok: true, filePath: 'notes/today.md', content: 'hello' } });
    expect(result.changeEvent).toEqual({ op: 'create_file', path: 'notes/today.md', summary: 'Created file' });
    expect(result.source).toBe('user');
    expect(result.treeChanged).toBe(true);
  });

  it('keeps non-tree-changing operations from triggering tree refresh', async () => {
    const result = await executeKnowledgeOperation({
      body: { op: 'save_file', path: 'notes/today.md', content: 'hello' },
      source: 'user',
      actor: { type: 'user' },
      handlers: {
        save_file: async () => ({
          response: { status: 200, body: { ok: true } },
          changeEvent: { op: 'save_file', path: 'notes/today.md', summary: 'Updated file' },
        }),
      },
      responses,
    });

    expect(result.treeChanged).toBe(false);
  });

  it('rejects missing op without calling any handler', async () => {
    const handler = vi.fn();

    const result = await executeKnowledgeOperation({
      body: { path: 'notes/today.md' },
      source: 'user',
      actor: { type: 'user' },
      handlers: { save_file: handler },
      responses,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.response).toEqual({ status: 400, body: { error: 'missing op' } });
    expect(result.changeEvent).toBe(null);
    expect(result.treeChanged).toBe(false);
  });

  it('rejects missing path without calling the handler', async () => {
    const handler = vi.fn();

    const result = await executeKnowledgeOperation({
      body: { op: 'save_file' },
      source: 'user',
      actor: { type: 'user' },
      handlers: { save_file: handler },
      responses,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.response).toEqual({ status: 400, body: { error: 'missing path' } });
  });

  it('rejects unknown operations without calling another handler', async () => {
    const handler = vi.fn();

    const result = await executeKnowledgeOperation({
      body: { op: 'unknown_op', path: 'notes/today.md' },
      source: 'user',
      actor: { type: 'user' },
      handlers: { save_file: handler },
      responses,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.response).toEqual({ status: 400, body: { error: 'unknown op: unknown_op' } });
  });

  it('denies protected root file operations for agents before the handler runs', async () => {
    const handler = vi.fn();

    const result = await executeKnowledgeOperation({
      body: { op: 'save_file', path: 'README.md', content: 'nope' },
      source: 'agent',
      actor: { type: 'agent', agentName: 'Codex' },
      handlers: { save_file: handler },
      protectedRootFiles: new Set(['README.md']),
      responses,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.response.status).toBe(403);
    expect(result.response.body.error).toContain('README.md');
  });

  it('returns permission_required when a matching permission rule asks', async () => {
    const handler = vi.fn();

    const result = await executeKnowledgeOperation({
      body: { op: 'delete_file', path: 'notes/today.md' },
      source: 'agent',
      actor: { type: 'agent', agentName: 'Codex' },
      handlers: { delete_file: handler },
      permissionRules: [
        { actor: 'Codex', op: 'delete_file', path: '**', effect: 'ask', reason: 'Agent deletes require review' },
      ],
      responses,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.response.status).toBe(403);
    expect(result.response.body.error).toBe('permission_required');
    expect(result.response.body.message).toBe('Agent deletes require review (delete_file notes/today.md)');
    expect(String(result.response.body.requestId)).toMatch(/^perm_/);
  });

  it('derives source with agent header taking precedence over body and source header', () => {
    expect(deriveKnowledgeOperationSource({ hasAgentHeader: true, bodySource: 'user', headerSource: 'system' })).toBe('agent');
    expect(deriveKnowledgeOperationSource({ bodySource: 'system', headerSource: 'agent' })).toBe('system');
    expect(deriveKnowledgeOperationSource({ bodySource: 'bad', headerSource: 'agent' })).toBe('agent');
    expect(deriveKnowledgeOperationSource({ bodySource: 'bad', headerSource: 'bad' })).toBe('user');
  });

  it('cleans control characters and truncates agent names', () => {
    const actor = createKnowledgeOperationActor('agent', `Co\u0000dex${'x'.repeat(120)}`);

    expect(actor.type).toBe('agent');
    expect(actor.agentName).not.toContain('\u0000');
    expect(actor.agentName).toHaveLength(100);
  });

  it('does not import Web or Next.js modules from the package source', () => {
    const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf-8');

    expect(source).not.toMatch(/from ['"]next\//);
    expect(source).not.toMatch(/from ['"]@\//);
    expect(source).not.toMatch(/from ['"].*components/);
  });
});
