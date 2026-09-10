import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerAcpShutdownHooks } from './shutdown.js';

type FakeProcess = EventEmitter & { platform: NodeJS.Platform };

function fakeProcess(platform: NodeJS.Platform = 'darwin'): FakeProcess {
  return Object.assign(new EventEmitter(), { platform });
}

describe('registerAcpShutdownHooks', () => {
  it('kills every ACP agent synchronously on exit and registers only once per target', () => {
    const target = fakeProcess();
    const killAll = vi.fn();
    const killSelf = vi.fn();

    registerAcpShutdownHooks({ target, killAll, killSelf });
    registerAcpShutdownHooks({ target, killAll, killSelf });

    expect(target.listenerCount('exit')).toBe(1);
    target.emit('exit', 0);
    expect(killAll).toHaveBeenCalledTimes(1);
  });

  it('kills agents on SIGTERM and re-raises the signal when it is the only listener', () => {
    const target = fakeProcess();
    const killAll = vi.fn();
    const killSelf = vi.fn();
    registerAcpShutdownHooks({ target, killAll, killSelf });

    target.emit('SIGTERM', 'SIGTERM');

    expect(killAll).toHaveBeenCalledTimes(1);
    expect(killSelf).toHaveBeenCalledWith('SIGTERM');
    // The hook is one-shot: the default handler must own the second delivery.
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('leaves exiting to another SIGINT listener when one exists', () => {
    const target = fakeProcess();
    const killAll = vi.fn();
    const killSelf = vi.fn();
    target.on('SIGINT', () => {});
    registerAcpShutdownHooks({ target, killAll, killSelf });

    target.emit('SIGINT', 'SIGINT');

    expect(killAll).toHaveBeenCalledTimes(1);
    expect(killSelf).not.toHaveBeenCalled();
  });

  it('never throws out of the hook when killing fails', () => {
    const target = fakeProcess();
    const killAll = vi.fn(() => { throw new Error('boom'); });
    const killSelf = vi.fn();
    registerAcpShutdownHooks({ target, killAll, killSelf });

    expect(() => target.emit('exit', 1)).not.toThrow();
    expect(() => target.emit('SIGTERM', 'SIGTERM')).not.toThrow();
    expect(killSelf).toHaveBeenCalledWith('SIGTERM');
  });
});
