import { beforeEach, describe, expect, it } from 'vitest';
import { runWithAgentRunContext } from '../agent-run-context.js';
import {
  AgentFileWriteConflictError,
  resetAgentFileWriteLocksForTest,
  withAgentFileWriteLock,
  withAgentFileWriteLocks,
} from './file-write-lock.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('agent file write lock', () => {
  beforeEach(() => {
    resetAgentFileWriteLocksForTest();
  });

  it('reports conflict when two agent runs write the same file concurrently', async () => {
    const gate = deferred();
    const first = runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-a' }, () => (
      withAgentFileWriteLock({ operation: 'write_file', filePath: 'Notes/Today.md' }, async () => {
        await gate.promise;
        return 'written';
      })
    ));

    await Promise.resolve();

    await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-b' }, () => (
      withAgentFileWriteLock({ operation: 'write_file', filePath: 'Notes/Today.md' }, () => 'overwritten')
    ))).rejects.toMatchObject({
      code: 'AGENT_FILE_WRITE_CONFLICT',
      filePath: 'Notes/Today.md',
      activeOwner: 'subagent-a',
      requestedOwner: 'subagent-b',
    });

    gate.resolve();
    await expect(first).resolves.toBe('written');
  });

  it('normalizes equivalent paths and releases locks after failures', async () => {
    const gate = deferred();
    const first = runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-a' }, () => (
      withAgentFileWriteLock({ operation: 'append_to_file', filePath: './Notes//Today.md' }, async () => {
        await gate.promise;
        throw new Error('write failed');
      })
    ));
    await Promise.resolve();

    await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-b' }, () => (
      withAgentFileWriteLock({ operation: 'append_to_file', filePath: 'Notes/Today.md' }, () => 'second')
    ))).rejects.toBeInstanceOf(AgentFileWriteConflictError);

    gate.resolve();
    await expect(first).rejects.toThrow('write failed');

    await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-b' }, () => (
      withAgentFileWriteLock({ operation: 'append_to_file', filePath: 'Notes/Today.md' }, () => 'second')
    ))).resolves.toBe('second');
  });

  it('locks multi-path operations in a stable order', async () => {
    const gate = deferred();
    const first = runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-a' }, () => (
      withAgentFileWriteLocks([
        { operation: 'move_file', filePath: 'B.md' },
        { operation: 'move_file', filePath: 'A.md' },
      ], async () => {
        await gate.promise;
        return 'moved';
      })
    ));
    await Promise.resolve();

    await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-b' }, () => (
      withAgentFileWriteLocks([
        { operation: 'move_file', filePath: 'A.md' },
        { operation: 'move_file', filePath: 'C.md' },
      ], () => 'conflicting move')
    ))).rejects.toMatchObject({
      code: 'AGENT_FILE_WRITE_CONFLICT',
      filePath: 'A.md',
    });

    gate.resolve();
    await expect(first).resolves.toBe('moved');
  });

  it('allows the same owner to re-enter a lock it already holds', async () => {
    const result = await runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-a' }, () => (
      withAgentFileWriteLock({ operation: 'write_file', filePath: 'Notes/Today.md' }, () => (
        withAgentFileWriteLock({ operation: 'append_to_file', filePath: 'Notes/Today.md' }, () => 'nested')
      ))
    ));
    expect(result).toBe('nested');
  });

  it('keeps blocking other owners until the outermost re-entrant section finishes', async () => {
    const gate = deferred();
    const first = runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-a' }, () => (
      withAgentFileWriteLock({ operation: 'write_file', filePath: 'Notes/Today.md' }, async () => {
        await withAgentFileWriteLock({ operation: 'append_to_file', filePath: 'Notes/Today.md' }, () => 'inner');
        // Inner section released — the outer hold must still block other owners.
        await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-b' }, () => (
          withAgentFileWriteLock({ operation: 'write_file', filePath: 'Notes/Today.md' }, () => 'stolen')
        ))).rejects.toBeInstanceOf(AgentFileWriteConflictError);
        await gate.promise;
        return 'outer';
      })
    ));
    gate.resolve();
    await expect(first).resolves.toBe('outer');

    await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-b' }, () => (
      withAgentFileWriteLock({ operation: 'write_file', filePath: 'Notes/Today.md' }, () => 'after release')
    ))).resolves.toBe('after release');
  });

  it('locks multi-path operations that mention the same file twice', async () => {
    await expect(runWithAgentRunContext({ rootRunId: 'root', parentRunId: 'subagent-a' }, () => (
      withAgentFileWriteLocks([
        { operation: 'move_file', filePath: 'A.md' },
        { operation: 'move_file', filePath: 'a.md' },
      ], () => 'self overlap')
    ))).resolves.toBe('self overlap');
  });
});
