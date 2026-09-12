// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeSessionAction } from '@/hooks/useRuntimeSessionAction';
let current: ReturnType<typeof useRuntimeSessionAction>;
let root: ReturnType<typeof createRoot>;
function Harness({ owner }: { owner: string }) { current = useRuntimeSessionAction(owner); return null; }
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(document.createElement('div')); act(() => root.render(<Harness owner="claude:chat-1" />)); });
afterEach(() => act(() => root.unmount()));
describe('runtime history action ownership', () => {
  it.each(['codex:chat-2', 'claude:chat-1:hidden'])('does not attach or clear a draft after the owner changes to %s', async (owner) => {
    let finish!: (value: string) => void;
    const apply = vi.fn(); const failure = vi.fn();
    let task!: Promise<void>;
    act(() => { task = current.execute('old', () => new Promise<string>(resolve => { finish = resolve; }), apply, failure); });
    act(() => root.render(<Harness owner={owner} />));
    await act(async () => { finish('late history'); await task; });
    expect(apply).not.toHaveBeenCalled(); expect(failure).not.toHaveBeenCalled(); expect(current.actionId).toBeNull();
  });
  it('locks duplicate clicks synchronously and unlocks after a failure', async () => {
    let fail!: (reason: Error) => void;
    const operation = vi.fn(() => new Promise<string>((_resolve, reject) => { fail = reject; }));
    const apply = vi.fn(); const failure = vi.fn(); let task!: Promise<void>;
    act(() => { task = current.execute('one', operation, apply, failure); void current.execute('two', operation, apply, failure); });
    expect(operation).toHaveBeenCalledOnce();
    await act(async () => { fail(new Error('gone')); await task; });
    expect(failure).toHaveBeenCalledWith('gone'); expect(current.actionId).toBeNull();
    await act(async () => current.execute('retry', async () => 'original', apply, failure));
    expect(apply).toHaveBeenCalledWith('original');
  });
});
