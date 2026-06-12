// @vitest-environment jsdom
/**
 * files-changed-emitter — coalesced "mindos:files-changed" event contract.
 *
 * Contract (cross-agent): CustomEvent detail is `{ paths?: string[] }`.
 * Emitters include affected paths when known and MUST coalesce bursts:
 * multiple file writes during a streaming run become one event carrying all
 * paths. No detail/paths means "unknown, assume anything changed".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FILES_CHANGED_EVENT,
  queueFilesChanged,
  flushFilesChanged,
  resetFilesChangedEmitterForTests,
} from '@/lib/agent/files-changed-emitter';

type FilesChangedDetail = { paths?: string[] } | null | undefined;

function listen(): { events: FilesChangedDetail[]; dispose: () => void } {
  const events: FilesChangedDetail[] = [];
  const handler = (e: Event) => {
    events.push((e as CustomEvent<FilesChangedDetail>).detail);
  };
  window.addEventListener(FILES_CHANGED_EVENT, handler);
  return { events, dispose: () => window.removeEventListener(FILES_CHANGED_EVENT, handler) };
}

describe('files-changed emitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFilesChangedEmitterForTests();
  });

  afterEach(() => {
    resetFilesChangedEmitterForTests();
    vi.useRealTimers();
  });

  it('batches multiple queued paths into a single event after the debounce window', () => {
    const { events, dispose } = listen();
    try {
      queueFilesChanged(['a.md']);
      queueFilesChanged(['b.md', 'c.md']);
      queueFilesChanged(['a.md']); // duplicate — deduped
      expect(events).toHaveLength(0); // nothing before the window elapses

      vi.advanceTimersByTime(300);

      expect(events).toHaveLength(1);
      expect(events[0]?.paths?.slice().sort()).toEqual(['a.md', 'b.md', 'c.md']);
    } finally {
      dispose();
    }
  });

  it('flushFilesChanged emits pending paths immediately and cancels the timer', () => {
    const { events, dispose } = listen();
    try {
      queueFilesChanged(['note.md']);
      flushFilesChanged();
      expect(events).toHaveLength(1);
      expect(events[0]?.paths).toEqual(['note.md']);

      // The debounce timer must not fire a second event.
      vi.advanceTimersByTime(1000);
      expect(events).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it('emits without paths when any write in the batch had unknown paths', () => {
    const { events, dispose } = listen();
    try {
      queueFilesChanged(['known.md']);
      queueFilesChanged(); // unknown — poisons the batch
      queueFilesChanged(['other.md']);
      flushFilesChanged();

      expect(events).toHaveLength(1);
      expect(events[0]?.paths).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('treats an empty paths array as unknown', () => {
    const { events, dispose } = listen();
    try {
      queueFilesChanged([]);
      flushFilesChanged();
      expect(events).toHaveLength(1);
      expect(events[0]?.paths).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('flush without pending writes emits nothing', () => {
    const { events, dispose } = listen();
    try {
      flushFilesChanged();
      vi.advanceTimersByTime(1000);
      expect(events).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it('starts a fresh batch after each flush', () => {
    const { events, dispose } = listen();
    try {
      queueFilesChanged(['first.md']);
      flushFilesChanged();
      queueFilesChanged(['second.md']);
      flushFilesChanged();

      expect(events).toHaveLength(2);
      expect(events[0]?.paths).toEqual(['first.md']);
      expect(events[1]?.paths).toEqual(['second.md']);
    } finally {
      dispose();
    }
  });

  it('ignores blank path strings but keeps real ones', () => {
    const { events, dispose } = listen();
    try {
      queueFilesChanged(['', '  ', 'real.md']);
      flushFilesChanged();
      expect(events).toHaveLength(1);
      expect(events[0]?.paths).toEqual(['real.md']);
    } finally {
      dispose();
    }
  });
});
