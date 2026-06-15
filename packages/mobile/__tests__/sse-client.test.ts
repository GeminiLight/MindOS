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

  it('sends JSON body and optional bearer token to /api/ask', () => {
    streamChat(
      'http://127.0.0.1:4567',
      {
        messages: [],
        mode: 'chat',
        chatSessionId: 'session-1',
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      },
      { onEvent: vi.fn(), onError: vi.fn(), onComplete: vi.fn() },
      { authToken: 'secret-token' },
    );

    const xhr = FakeXMLHttpRequest.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://127.0.0.1:4567/api/ask');
    expect(xhr.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(xhr.body)).toEqual({
      messages: [],
      mode: 'chat',
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
      {},
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
      {},
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
});
