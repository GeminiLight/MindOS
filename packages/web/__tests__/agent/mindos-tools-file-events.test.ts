import { beforeEach, describe, expect, it } from 'vitest';
import { seedFile } from '../setup';
import { runWithAgentRunContext } from '@geminilight/mindos/agent/agent-run-context';
import {
  listAgentEvents,
  resetAgentRunsForTest,
  startAgentRun,
  type AgentEvent,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import { knowledgeBaseTools } from '@/lib/agent/tools';

function getTool(name: string) {
  const tool = knowledgeBaseTools.find((item) => item.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

async function callTool(name: string, params: Record<string, unknown>): Promise<string> {
  const result = await getTool(name).execute('test-tool-call', params);
  const textPart = result.content?.find((part: any) => part.type === 'text');
  return textPart?.text ?? JSON.stringify(result);
}

function startTestRun(id = 'agent-run-file-events') {
  return startAgentRun({
    id,
    agentKind: 'mindos-main',
    runtimeId: 'mindos',
    displayName: 'MindOS Agent',
    permissionMode: 'agent',
    inputSummary: 'Test KB file event wiring.',
  });
}

async function callToolInRun(runId: string, name: string, params: Record<string, unknown>): Promise<string> {
  return runWithAgentRunContext({ rootRunId: runId, parentRunId: runId }, () => callTool(name, params));
}

function fileEventsFor(runId: string): AgentEvent[] {
  return listAgentEvents({ runId, category: 'file' }).reverse();
}

describe('MindOS KB tools file timeline events', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('records file_changed events for successful write, create, rename, and delete tools', async () => {
    seedFile('Existing.md', '# Old');
    seedFile('Delete.md', '# Delete me');
    const run = startTestRun();

    await callToolInRun(run.id, 'write_file', { path: 'Existing.md', content: '# New' });
    await callToolInRun(run.id, 'create_file', { path: 'Created.md', content: '# Created' });
    await callToolInRun(run.id, 'rename_file', { path: 'Created.md', new_name: 'Renamed.md' });
    await callToolInRun(run.id, 'delete_file', { path: 'Delete.md' });

    expect(fileEventsFor(run.id).map((event) => ({
      type: event.type,
      filePath: event.filePath,
      data: event.data,
    }))).toEqual([
      expect.objectContaining({
        type: 'file_changed',
        filePath: 'Existing.md',
        data: expect.objectContaining({ kind: 'file', action: 'updated', path: 'Existing.md' }),
      }),
      expect.objectContaining({
        type: 'file_changed',
        filePath: 'Created.md',
        data: expect.objectContaining({ kind: 'file', action: 'created', path: 'Created.md' }),
      }),
      expect.objectContaining({
        type: 'file_changed',
        filePath: 'Renamed.md',
        data: expect.objectContaining({
          kind: 'file',
          action: 'renamed',
          path: 'Renamed.md',
          summary: expect.stringContaining('Created.md'),
        }),
      }),
      expect.objectContaining({
        type: 'file_changed',
        filePath: 'Delete.md',
        data: expect.objectContaining({ kind: 'file', action: 'deleted', path: 'Delete.md' }),
      }),
    ]);
  });

  it('records batch_create_files events only for files that were created', async () => {
    seedFile('Already.md', '# Existing');
    const run = startTestRun('agent-run-batch-events');

    const result = await callToolInRun(run.id, 'batch_create_files', {
      files: [
        { path: 'Already.md', content: '# Duplicate' },
        { path: 'Fresh.md', content: '# Fresh' },
      ],
    });

    expect(result).toContain('Created 1 files: Fresh.md');
    expect(result).toContain('Already.md:');
    expect(fileEventsFor(run.id).map((event) => ({
      filePath: event.filePath,
      action: event.data?.kind === 'file' ? event.data.action : undefined,
    }))).toEqual([
      { filePath: 'Fresh.md', action: 'created' },
    ]);
  });

  it('does not record file_changed events for failed mutations or calls outside an agent run context', async () => {
    const run = startTestRun('agent-run-error-events');

    const failedDelete = await callToolInRun(run.id, 'delete_file', { path: 'Missing.md' });
    expect(failedDelete).toContain('Error:');
    expect(fileEventsFor(run.id)).toEqual([]);

    await callTool('create_file', { path: 'NoContext.md', content: '# No context' });
    expect(listAgentEvents({ category: 'file' })).toEqual([]);
  });
});
