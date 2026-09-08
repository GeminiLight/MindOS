import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '@/lib/obsidian-compat/shims/obsidian';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('Obsidian debounce contract', () => {
  it('returns itself from scheduling and cancellation and returns the callback result from run', () => {
    const calls: string[] = []; const task = debounce((value: string) => { calls.push(value); return value.length; }, 100);
    expect(task('中文')).toBe(task); expect(task.run()).toBe(2); expect(task.run()).toBeUndefined();
    expect(task.cancel()).toBe(task); vi.runAllTimers(); expect(calls).toEqual(['中文']);
  });
  it('coalesces trailing calls with a resetting timer and the latest arguments', () => {
    const calls: string[] = []; const task = debounce((value: string) => calls.push(value), 100, true);
    task('a'); vi.advanceTimersByTime(70); task('b'); vi.advanceTimersByTime(99); expect(calls).toEqual([]);
    vi.advanceTimersByTime(1); expect(calls).toEqual(['b']);
  });
  it('keeps the first deadline without reset but still uses the most recent arguments', () => {
    const calls: string[] = []; const task = debounce((value: string) => calls.push(value), 100, false);
    task('a'); vi.advanceTimersByTime(70); task('b'); vi.advanceTimersByTime(30); expect(calls).toEqual(['b']);
  });
  it('cancels pending zero-argument callbacks and can be reused afterward', () => {
    let calls = 0; const task = debounce(() => ++calls);
    task(); task.cancel(); vi.runAllTimers(); expect(calls).toBe(0);
    task(); expect(task.run()).toBe(1); vi.runAllTimers(); expect(calls).toBe(1);
  });
  it('clears pending state before a throwing callback and allows a reentrant schedule', () => {
    let calls = 0; const task = debounce(() => { if (++calls === 1) throw new Error('callback failed'); return calls; });
    task(); expect(() => task.run()).toThrow('callback failed'); expect(task.run()).toBeUndefined();
    task(); expect(task.run()).toBe(2);
    const reentrant = debounce((value: number) => { if (value === 1) reentrant(2); return value; });
    reentrant(1); expect(reentrant.run()).toBe(1); expect(reentrant.run()).toBe(2);
  });
});
