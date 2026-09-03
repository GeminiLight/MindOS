import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createLarkCliEventClient } from '@/lib/im/lark-cli-event-client';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe('lark-cli event client', () => {
  it('becomes ready from stderr and streams split NDJSON events', async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const client = createLarkCliEventClient({
      executablePath: '/opt/lark-cli',
      profile: 'cli_existing',
      spawnProcess,
      onEvent,
    });

    const starting = client.start();
    expect(spawnProcess).toHaveBeenCalledWith('/opt/lark-cli', [
      '--profile', 'cli_existing', 'event', 'consume', 'im.message.receive_v1', '--as', 'bot',
    ]);
    expect(client.status().running).toBe(false);
    child.stderr.write('[event] ready event_key=im.message.receive_v1\n');
    await starting;
    expect(client.status().running).toBe(true);

    child.stdout.write('{"type":"im.message.receive_v1","message_id":"om_1",');
    child.stdout.write('"chat_id":"oc_1","sender_id":"ou_1","chat_type":"p2p","content":"hello"}\n');
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      message_id: 'om_1',
      content: 'hello',
    })));
  });

  it('rejects an early exit with a safe actionable error', async () => {
    const child = fakeChild();
    const client = createLarkCliEventClient({
      executablePath: '/opt/lark-cli',
      profile: 'cli_existing',
      spawnProcess: () => child,
      onEvent: vi.fn(),
    });
    const starting = client.start();
    child.stderr.write('{"ok":false,"error":{"message":"missing scope","hint":"grant im:message.p2p_msg:readonly","token":"do-not-copy"}}\n');
    child.emit('exit', 1, null);

    await expect(starting).rejects.toThrow(/missing scope.*im:message\.p2p_msg:readonly/i);
    await expect(starting).rejects.not.toThrow(/do-not-copy/);
    expect(client.status()).toMatchObject({ running: false, lastError: expect.stringContaining('missing scope') });
  });

  it('ends stdin first and escalates only if graceful shutdown does not exit', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const end = vi.spyOn(child.stdin, 'end');
      const client = createLarkCliEventClient({
        executablePath: '/opt/lark-cli',
        profile: 'cli_existing',
        spawnProcess: () => child,
        onEvent: vi.fn(),
      });
      const starting = client.start();
      child.stderr.write('[event] ready event_key=im.message.receive_v1\n');
      await starting;

      client.stop();
      expect(end).toHaveBeenCalledTimes(1);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an unexpected non-zero exit after becoming ready', async () => {
    const child = fakeChild();
    const client = createLarkCliEventClient({
      executablePath: '/opt/lark-cli', profile: 'cli_existing', spawnProcess: () => child, onEvent: vi.fn(),
    });
    const starting = client.start();
    child.stderr.write('[event] ready event_key=im.message.receive_v1\n');
    await starting;
    child.stderr.write('[event] failed: websocket disconnected\n');
    child.emit('exit', 2, null);

    expect(client.status()).toMatchObject({ running: false, lastError: expect.stringMatching(/disconnected|exited/i) });
  });
});
