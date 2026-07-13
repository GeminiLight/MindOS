import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/agent-runs/reattach/route';
import {
  appendAgentRunEvent,
  completeAgentRun,
  resetAgentRunsForTest,
  startAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';

type MindosEvent = { type: string; [key: string]: unknown };

class MindosSseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private readonly queue: MindosEvent[] = [];

  constructor(response: Response) {
    if (!response.body) throw new Error('missing stream body');
    this.reader = response.body.getReader();
  }

  async nextMatching(predicate: (event: MindosEvent) => boolean): Promise<MindosEvent> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const queued = this.shiftMatching(predicate);
      if (queued) return queued;

      const result = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error('timed out waiting for SSE event')), 1000);
        }),
      ]);
      if (result.done) break;
      this.buffer += this.decoder.decode(result.value, { stream: true });
      this.drainBuffer();
    }
    throw new Error('matching SSE event was not emitted');
  }

  async readAll(): Promise<MindosEvent[]> {
    while (true) {
      const result = await this.reader.read();
      if (result.done) break;
      this.buffer += this.decoder.decode(result.value, { stream: true });
      this.drainBuffer();
    }
    return [...this.queue];
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }

  private shiftMatching(predicate: (event: MindosEvent) => boolean): MindosEvent | undefined {
    const index = this.queue.findIndex(predicate);
    if (index < 0) return undefined;
    const [event] = this.queue.splice(index, 1);
    return event;
  }

  private drainBuffer(): void {
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n');
      if (data) this.queue.push(JSON.parse(data) as MindosEvent);
      boundary = this.buffer.indexOf('\n\n');
    }
  }
}

describe('/api/agent-runs/reattach', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('replays existing assistant text and closes completed runs with done', async () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      chatSessionId: 'chat-reattach',
      permissionMode: 'ask',
      inputSummary: 'Recover',
    });
    appendAgentRunEvent(run.id, {
      type: 'text',
      category: 'text',
      data: { kind: 'text', channel: 'assistant', text: 'hello ' },
      visibility: 'debug',
    });
    appendAgentRunEvent(run.id, {
      type: 'text',
      category: 'text',
      data: { kind: 'text', channel: 'assistant', text: 'again' },
      visibility: 'debug',
    });
    completeAgentRun(run.id, { outputSummary: 'hello again' });

    const response = await GET(new Request(`http://localhost/api/agent-runs/reattach?chatSessionId=chat-reattach&rootRunId=${run.id}`));
    const events = await new MindosSseReader(response).readAll();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(events).toEqual([
      expect.objectContaining({ type: 'agent_run_context', rootRunId: run.id }),
      { type: 'text_delta', delta: 'hello ' },
      { type: 'text_delta', delta: 'again' },
      { type: 'done' },
    ]);
  });

  it('replays the terminal output summary when no text events survived', async () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      chatSessionId: 'chat-summary-reattach',
      permissionMode: 'full',
      inputSummary: 'Long running task',
    });
    completeAgentRun(run.id, { outputSummary: 'The background task completed successfully.' });

    const response = await GET(new Request(`http://localhost/api/agent-runs/reattach?chatSessionId=chat-summary-reattach&rootRunId=${run.id}`));
    const events = await new MindosSseReader(response).readAll();

    expect(events).toEqual([
      expect.objectContaining({ type: 'agent_run_context', rootRunId: run.id }),
      { type: 'text_delta', delta: 'The background task completed successfully.' },
      { type: 'done' },
    ]);
  });

  it('streams live ledger events for a running run until it reaches a terminal state', async () => {
    const abort = new AbortController();
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      chatSessionId: 'chat-live-reattach',
      permissionMode: 'ask',
      inputSummary: 'Keep going',
    });

    const response = await GET(new Request(`http://localhost/api/agent-runs/reattach?chatSessionId=chat-live-reattach&rootRunId=${run.id}`, { signal: abort.signal }));
    const stream = new MindosSseReader(response);
    await stream.nextMatching((event) => event.type === 'agent_run_context');

    appendAgentRunEvent(run.id, {
      type: 'text',
      category: 'text',
      data: { kind: 'text', channel: 'assistant', text: 'live chunk' },
      visibility: 'debug',
    });
    const textEvent = await stream.nextMatching((event) => event.type === 'text_delta');
    completeAgentRun(run.id, { outputSummary: 'live chunk' });
    const doneEvent = await stream.nextMatching((event) => event.type === 'done');
    abort.abort();
    await stream.cancel().catch(() => undefined);

    expect(textEvent).toEqual({ type: 'text_delta', delta: 'live chunk' });
    expect(doneEvent).toEqual({ type: 'done' });
  });

  it('replays bridge run ids for pending runtime permission events', async () => {
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      chatSessionId: 'chat-permission-reattach',
      permissionMode: 'ask',
      inputSummary: 'Needs approval',
    });
    appendAgentRunEvent(run.id, {
      type: 'permission_requested',
      category: 'permission',
      runtime: 'codex',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      metadata: {
        bridgeRunId: 'bridge-run-1',
        requestId: 'perm-1',
      },
      data: {
        kind: 'permission',
        action: 'command',
        status: 'requested',
        requestId: 'perm-1',
        resource: 'npm test',
        options: [{ id: 'accept', label: 'Allow once', intent: 'allow', scope: 'once' }],
      },
    });
    completeAgentRun(run.id);

    const response = await GET(new Request(`http://localhost/api/agent-runs/reattach?chatSessionId=chat-permission-reattach&rootRunId=${run.id}`));
    const events = await new MindosSseReader(response).readAll();

    expect(events).toContainEqual(expect.objectContaining({
      type: 'runtime_permission_request',
      runId: 'bridge-run-1',
      requestId: 'perm-1',
      toolCallId: 'tool-1',
    }));
  });
});
