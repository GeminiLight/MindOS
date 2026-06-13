import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/agent-runs/stream/route';
import {
  appendAgentRunEvent,
  completeAgentRun,
  resetAgentRunsForTest,
  startAgentRun,
} from '@geminilight/mindos/agent/run-ledger';

interface StreamPayload {
  runs?: Array<{ id: string; chatSessionId?: string; rootRunId?: string; status?: string }>;
  events?: Array<{ id: string; runId: string; type: string; category: string; data?: { kind?: string; name?: string; path?: string; text?: string } }>;
  event?: { runId: string; type: string; category: string };
}

class SsePayloadReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private readonly queue: StreamPayload[] = [];

  constructor(response: Response) {
    if (!response.body) throw new Error('missing stream body');
    this.reader = response.body.getReader();
  }

  async nextMatching(predicate: (payload: StreamPayload) => boolean): Promise<StreamPayload> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const queued = this.shiftMatching(predicate);
      if (queued) return queued;

      const result = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error('timed out waiting for SSE payload')), 1000);
        }),
      ]);
      if (result.done) break;
      this.buffer += this.decoder.decode(result.value, { stream: true });
      this.drainBuffer();
    }
    throw new Error('matching SSE payload was not emitted');
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }

  private shiftMatching(predicate: (payload: StreamPayload) => boolean): StreamPayload | undefined {
    const index = this.queue.findIndex(predicate);
    if (index < 0) return undefined;
    const [payload] = this.queue.splice(index, 1);
    return payload;
  }

  private drainBuffer(): void {
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');
      if (data) {
        this.queue.push(JSON.parse(data) as StreamPayload);
      }
      boundary = this.buffer.indexOf('\n\n');
    }
  }
}

describe('/api/agent-runs/stream', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('requires chatSessionId so stream consumers cannot subscribe to every session', async () => {
    const response = await GET(new Request('http://localhost/api/agent-runs/stream'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('chatSessionId is required');
  });

  it('sends an initial root-scoped snapshot for only the requested chat session', async () => {
    const root = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      chatSessionId: 'chat-stream',
      permissionMode: 'agent',
      inputSummary: 'Root task',
    });
    const child = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      rootRunId: root.id,
      parentRunId: root.id,
      chatSessionId: 'chat-stream',
      permissionMode: 'readonly',
      inputSummary: 'Review',
    });
    startAgentRun({
      agentKind: 'acp',
      runtimeId: 'other',
      displayName: 'Other ACP',
      chatSessionId: 'chat-other',
      permissionMode: 'agent',
      inputSummary: 'Other',
    });

    const abort = new AbortController();
    const response = await GET(new Request(`http://localhost/api/agent-runs/stream?chatSessionId=chat-stream&rootRunId=${root.id}`, { signal: abort.signal }));
    const stream = new SsePayloadReader(response);

    const payload = await stream.nextMatching((item) => Array.isArray(item.runs));
    abort.abort();
    await stream.cancel().catch(() => undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(payload.runs?.map((run) => run.id)).toEqual([child.id, root.id]);
    expect(payload.runs?.every((run) => run.chatSessionId === 'chat-stream')).toBe(true);
  });

  it('pushes a fresh snapshot when a matching run event is appended', async () => {
    const abort = new AbortController();
    const response = await GET(new Request('http://localhost/api/agent-runs/stream?chatSessionId=chat-live&startedAfter=100', { signal: abort.signal }));
    const stream = new SsePayloadReader(response);

    await stream.nextMatching((item) => Array.isArray(item.runs) && item.runs.length === 0);
    startAgentRun({
      agentKind: 'acp',
      runtimeId: 'other',
      displayName: 'Other Chat',
      chatSessionId: 'chat-other',
      permissionMode: 'agent',
      inputSummary: 'Other task',
    });
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      chatSessionId: 'chat-live',
      permissionMode: 'agent',
      inputSummary: 'Use Claude',
    });
    appendAgentRunEvent(run.id, {
      type: 'tool_started',
      category: 'tool',
      data: { kind: 'tool', name: 'Bash', status: 'started', inputSummary: 'echo ok' },
    });
    completeAgentRun(run.id, { outputSummary: 'Done.' });

    const payload = await stream.nextMatching((item) => item.event?.runId === run.id && item.event.type === 'run_completed');
    abort.abort();
    await stream.cancel().catch(() => undefined);

    expect(payload.runs).toEqual([
      expect.objectContaining({
        id: run.id,
        chatSessionId: 'chat-live',
        status: 'completed',
      }),
    ]);
    expect(payload.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: run.id,
        category: 'tool',
        data: expect.objectContaining({ kind: 'tool', name: 'Bash' }),
      }),
      expect.objectContaining({
        runId: run.id,
        category: 'status',
        type: 'run_completed',
      }),
    ]));
    expect(payload.events?.some((event) => event.data?.text === 'Other task')).toBe(false);
  });
});
