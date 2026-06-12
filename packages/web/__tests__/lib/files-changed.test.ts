// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILES_CHANGED_EVENT,
  createTrailingCoalescer,
  getFilesChangedPaths,
  isAnyPathUnder,
  isPathAffected,
  subscribeFilesChanged,
} from '@/lib/files-changed';

function dispatchFilesChanged(paths?: string[]): void {
  if (paths) {
    window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT, { detail: { paths } }));
  } else {
    window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
  }
}

describe('getFilesChangedPaths', () => {
  it('returns paths from a CustomEvent detail', () => {
    const event = new CustomEvent(FILES_CHANGED_EVENT, { detail: { paths: ['a.md', 'b.md'] } });
    expect(getFilesChangedPaths(event)).toEqual(['a.md', 'b.md']);
  });

  it('returns undefined for a plain Event without detail (anything changed)', () => {
    expect(getFilesChangedPaths(new Event(FILES_CHANGED_EVENT))).toBeUndefined();
  });

  it('returns undefined for an empty paths array', () => {
    const event = new CustomEvent(FILES_CHANGED_EVENT, { detail: { paths: [] } });
    expect(getFilesChangedPaths(event)).toBeUndefined();
  });

  it('returns undefined when detail is malformed', () => {
    const event = new CustomEvent(FILES_CHANGED_EVENT, { detail: { paths: 'not-an-array' } });
    expect(getFilesChangedPaths(event)).toBeUndefined();
  });
});

describe('isPathAffected', () => {
  it('matches an exact vault-relative path', () => {
    expect(isPathAffected(['Notes/a.md'], 'Notes/a.md')).toBe(true);
  });

  it('tolerates leading ./ and / prefixes on either side', () => {
    expect(isPathAffected(['./Notes/a.md'], 'Notes/a.md')).toBe(true);
    expect(isPathAffected(['/Notes/a.md'], 'Notes/a.md')).toBe(true);
    expect(isPathAffected(['Notes/a.md'], '/Notes/a.md')).toBe(true);
  });

  it('returns false when no path matches', () => {
    expect(isPathAffected(['Notes/b.md'], 'Notes/a.md')).toBe(false);
    expect(isPathAffected([], 'Notes/a.md')).toBe(false);
  });

  it('handles unicode and spaces in paths', () => {
    expect(isPathAffected(['笔记/今日 计划.md'], '笔记/今日 计划.md')).toBe(true);
  });
});

describe('isAnyPathUnder', () => {
  it('matches files inside the directory', () => {
    expect(isAnyPathUnder(['Inbox/clip.md'], 'Inbox')).toBe(true);
    expect(isAnyPathUnder(['Inbox/sub/deep.md'], 'Inbox')).toBe(true);
  });

  it('matches the directory itself', () => {
    expect(isAnyPathUnder(['Inbox'], 'Inbox')).toBe(true);
  });

  it('is case-insensitive on the prefix', () => {
    expect(isAnyPathUnder(['inbox/clip.md'], 'Inbox')).toBe(true);
  });

  it('does not match sibling directories sharing a prefix', () => {
    expect(isAnyPathUnder(['Inbox2/clip.md'], 'Inbox')).toBe(false);
    expect(isAnyPathUnder(['Notes/a.md'], 'Inbox')).toBe(false);
  });
});

describe('subscribeFilesChanged', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of events into a single callback', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeFilesChanged(onChange, { debounceMs: 300 });

    dispatchFilesChanged(['a.md']);
    dispatchFilesChanged(['b.md']);
    dispatchFilesChanged(['c.md']);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(['a.md', 'b.md', 'c.md']));
    unsubscribe();
  });

  it('passes undefined when any event in the window lacked paths', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeFilesChanged(onChange, { debounceMs: 300 });

    dispatchFilesChanged(['a.md']);
    dispatchFilesChanged(); // no detail = anything changed
    vi.advanceTimersByTime(300);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });

  it('skips the callback when all paths are irrelevant', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeFilesChanged(onChange, {
      debounceMs: 300,
      isRelevant: (paths) => paths.some((p) => p.startsWith('Inbox/')),
    });

    dispatchFilesChanged(['Notes/a.md']);
    vi.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();

    dispatchFilesChanged(['Inbox/clip.md']);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('still fires for detail-less events even when isRelevant is provided', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeFilesChanged(onChange, {
      debounceMs: 300,
      isRelevant: () => false,
    });

    dispatchFilesChanged();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });

  it('stops delivering after unsubscribe and clears pending timers', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeFilesChanged(onChange, { debounceMs: 300 });

    dispatchFilesChanged(['a.md']);
    unsubscribe();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires again for a second burst after the first flush', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeFilesChanged(onChange, { debounceMs: 300 });

    dispatchFilesChanged(['a.md']);
    vi.advanceTimersByTime(300);
    dispatchFilesChanged(['b.md']);
    vi.advanceTimersByTime(300);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, ['a.md']);
    expect(onChange).toHaveBeenNthCalledWith(2, ['b.md']);
    unsubscribe();
  });
});

describe('createTrailingCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once on the trailing edge for a burst of schedules', () => {
    const fn = vi.fn();
    const coalescer = createTrailingCoalescer(fn, { delayMs: 1000 });

    coalescer.schedule();
    coalescer.schedule();
    coalescer.schedule();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('enforces minimum spacing between consecutive runs', () => {
    const fn = vi.fn();
    const coalescer = createTrailingCoalescer(fn, { delayMs: 1000, minSpacingMs: 5000 });

    coalescer.schedule();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Scheduled immediately after a run: must wait the remaining spacing, not just delayMs.
    coalescer.schedule();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000); // total 4000 since run
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); // total 5000 since run
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel discards a pending run', () => {
    const fn = vi.fn();
    const coalescer = createTrailingCoalescer(fn, { delayMs: 1000 });

    coalescer.schedule();
    coalescer.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
