import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBuilder, streamChat } from '@/lib/sse-client';

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  responseText = '';
  status = 200;
  timeout = 0;
  headers: Record<string, string> = {};
  method = '';
  url = '';
  body = '';
  aborted = false;

  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: string) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
  }
}

describe('streamChat', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  });

  it('sends JSON body and optional bearer token to the agent turn endpoint', () => {
    streamChat(
      'http://127.0.0.1:4567',
      {
        messages: [],
        sessionId: 'session-1',
        chatSessionId: 'session-1',
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      },
      { onEvent: vi.fn(), onError: vi.fn(), onComplete: vi.fn() },
      { authToken: 'secret-token' },
    );

    const xhr = FakeXMLHttpRequest.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://127.0.0.1:4567/api/agent/sessions/session-1/turns');
    expect(xhr.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(xhr.body)).toEqual({
      messages: [],
      chatSessionId: 'session-1',
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    });
  });

  it('completes exactly once after a terminal error event', () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    streamChat(
      'http://127.0.0.1:4567',
      { sessionId: 'session-1' },
      { onEvent, onError, onComplete },
    );

    const xhr = FakeXMLHttpRequest.instances[0];
    xhr.responseText = 'data:{"type":"error","message":"bad token"}\n\n';
    xhr.onprogress?.();
    xhr.onload?.();

    expect(onEvent).toHaveBeenCalledWith({ type: 'error', message: 'bad token' });
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('maps non-2xx JSON responses to onError instead of an empty completion', () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    streamChat(
      'http://127.0.0.1:4567',
      { sessionId: 'session-1' },
      { onEvent, onError, onComplete },
    );

    const xhr = FakeXMLHttpRequest.instances[0];
    xhr.status = 401;
    xhr.responseText = '{"error":"Unauthorized"}';
    xhr.onload?.();

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unauthorized' }));
    expect(onComplete).not.toHaveBeenCalled();
  });
});

function startStream() {
  const onEvent = vi.fn();
  const onError = vi.fn();
  const onComplete = vi.fn();
  streamChat('http://127.0.0.1:4567', { sessionId: 'session-1' }, { onEvent, onError, onComplete });
  const xhr = FakeXMLHttpRequest.instances[FakeXMLHttpRequest.instances.length - 1];
  return { xhr, onEvent, onError, onComplete };
}

/** Simulate the network delivering `chunk`: XHR appends to responseText, then fires onprogress. */
function feed(xhr: FakeXMLHttpRequest, chunk: string) {
  xhr.responseText += chunk;
  xhr.onprogress?.();
}

describe('streamChat frame parsing', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  });

  it('reassembles a JSON payload split across two progress chunks into one event', () => {
    const { xhr, onEvent } = startStream();

    feed(xhr, 'data:{"type":"text_de');
    expect(onEvent).not.toHaveBeenCalled();
    feed(xhr, 'lta","delta":"hi"}\n\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'hi' });
  });

  it('dispatches once, on the second chunk, when the blank-line separator is split across chunks', () => {
    const { xhr, onEvent } = startStream();

    feed(xhr, 'data:{"type":"text_delta","delta":"hi"}\n');
    expect(onEvent).not.toHaveBeenCalled();
    feed(xhr, '\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'hi' });
  });

  it('joins multi-line data with newlines so the JSON payload stays valid', () => {
    const { xhr, onEvent } = startStream();

    feed(xhr, 'data:{"type":"text_delta",\ndata:"delta":"hi"}\n\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'hi' });
  });

  it('parses CRLF line endings as soon as they arrive', () => {
    const { xhr, onEvent } = startStream();

    feed(xhr, 'data:{"type":"text_delta","delta":"a"}\r\n\r\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'a' });
  });

  it('accepts a single space after the data field name', () => {
    const { xhr, onEvent } = startStream();

    feed(xhr, 'data: {"type":"text_delta","delta":"spaced"}\n\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'spaced' });
  });

  it('ignores comment lines without breaking the following frame', () => {
    const { xhr, onEvent } = startStream();

    feed(xhr, ':keep-alive\n\n');
    expect(onEvent).not.toHaveBeenCalled();
    feed(xhr, 'data:{"type":"text_delta","delta":"after"}\n\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'after' });
  });

  it('flushes a final done frame with no trailing blank line when the response loads', () => {
    const { xhr, onEvent, onError, onComplete } = startStream();

    feed(xhr, 'data:{"type":"text_delta","delta":"x"}\n\n');
    feed(xhr, 'data:{"type":"done"}');
    expect(onComplete).not.toHaveBeenCalled();
    xhr.onload?.();

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'done' });
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('drains bytes that arrived without a progress event before completing', () => {
    const { xhr, onEvent, onError, onComplete } = startStream();

    feed(xhr, 'data:{"type":"text_delta","delta":"x"}\n\n');
    // The last chunk lands in responseText but XHR fires onload without onprogress.
    xhr.responseText += 'data:{"type":"done"}\n\n';
    xhr.onload?.();

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'done' });
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('ignores frames that arrive after a done event', () => {
    const { xhr, onEvent, onComplete } = startStream();

    feed(xhr, 'data:{"type":"done"}\n\ndata:{"type":"text_delta","delta":"late"}\n\n');
    feed(xhr, 'data:{"type":"text_delta","delta":"later"}\n\n');
    xhr.onload?.();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'done' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('skips a frame whose payload is not valid JSON and keeps parsing', () => {
    const { xhr, onEvent, onError } = startStream();

    feed(xhr, 'data:not json\n\ndata:{"type":"text_delta","delta":"ok"}\n\n');

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'ok' });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('MessageBuilder', () => {
  it('appends tool_delta output to the running tool call', () => {
    const builder = new MessageBuilder();

    builder.addToolStart('tool-1', 'read_file', { path: 'a.md' });
    builder.addToolDelta('tool-1', 'hello');
    builder.addToolDelta('tool-1', ' world');
    builder.addToolEnd('tool-1', 'hello world', false);

    expect(builder.finalize().parts).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'tool-1',
        output: 'hello world',
        state: 'done',
      }),
    ]);
  });

  it('renders native runtime permission requests and resolved decisions as tool parts', () => {
    const builder = new MessageBuilder();

    builder.addRuntimePermissionRequest({
      type: 'runtime_permission_request',
      runId: 'run-1',
      requestId: 'perm-1',
      runtime: 'claude',
      toolCallId: 'approval-1',
      toolName: 'Bash',
      input: { command: 'mindos file delete a.md' },
      reason: 'Delete a file',
      options: [
        { id: 'accept', label: 'Allow once', intent: 'allow', scope: 'once' },
        { id: 'decline', label: 'Deny', intent: 'deny' },
      ],
    });

    expect(builder.build().parts).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'approval-1',
        toolName: 'Bash',
        runtime: 'claude',
        input: { command: 'mindos file delete a.md' },
        state: 'running',
        runtimePermission: expect.objectContaining({
          status: 'waiting',
          requestId: 'perm-1',
          options: [
            expect.objectContaining({ id: 'accept', label: 'Allow once', intent: 'allow' }),
            expect.objectContaining({ id: 'decline', label: 'Deny', intent: 'deny' }),
          ],
        }),
      }),
    ]);

    builder.addRuntimePermissionResolved({
      type: 'runtime_permission_resolved',
      runId: 'run-1',
      requestId: 'perm-1',
      runtime: 'claude',
      toolCallId: 'approval-1',
      decision: 'accept',
      decisionIntent: 'allow',
      decisionLabel: 'Allow once',
    });

    expect(builder.build().parts?.[0]).toEqual(expect.objectContaining({
      state: 'running',
      runtimePermission: expect.objectContaining({
        status: 'approved',
        decision: 'accept',
        decisionLabel: 'Allow once',
      }),
    }));
  });
});
