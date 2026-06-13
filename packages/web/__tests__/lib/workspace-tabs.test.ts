// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MAX_TABS,
  closeByKey,
  closeTab,
  getTabs,
  initWorkspaceTabs,
  keepTab,
  moveTab,
  openTab,
  readDomRootId,
  reconcileChatTabs,
  renameByKey,
  resetWorkspaceTabsForTests,
  tabId,
  useWorkspaceTabs,
  type WorkspaceTab,
} from '@/lib/workspace-tabs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_PREFIX = 'mindos.workspaceTabs.v1';
const DEBOUNCE_MS = 300;

function storageKeyFor(rootId: string): string {
  return `${STORAGE_PREFIX}:${rootId}`;
}

function readStored(rootId: string): unknown {
  const raw = localStorage.getItem(storageKeyFor(rootId));
  return raw === null ? null : JSON.parse(raw);
}

// setup.ts clears localStorage in beforeEach and calls resetWorkspaceTabsForTests()
// in afterEach; tests below only add what they need on top of that.
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-mind-root-id');
});

describe('tabId', () => {
  it('formats identity as `${kind}:${key}`', () => {
    expect(tabId('doc', 'notes/a.md')).toBe('doc:notes/a.md');
    expect(tabId('chat', 's-123')).toBe('chat:s-123');
  });
});

describe('openTab', () => {
  it('opens a tab with id `${kind}:${key}` and appends in order', () => {
    const a = openTab('doc', 'notes/a.md', 'A');
    const b = openTab('chat', 's-1', 'Chat 1');

    expect(a).toEqual({ id: 'doc:notes/a.md', kind: 'doc', key: 'notes/a.md', title: 'A' });
    expect(b).toEqual({ id: 'chat:s-1', kind: 'chat', key: 's-1', title: 'Chat 1' });
    expect(getTabs().map((t) => t.id)).toEqual(['doc:notes/a.md', 'chat:s-1']);
  });

  it('returns the same existing tab object on dedup without reordering or duplicating', () => {
    const first = openTab('doc', 'notes/a.md', 'A');
    openTab('doc', 'notes/b.md', 'B');
    const before = getTabs();

    const again = openTab('doc', 'notes/a.md', 'A (different title ignored)');

    expect(again).toBe(first);
    expect(getTabs()).toBe(before); // no emit → same array reference
    expect(getTabs().map((t) => t.id)).toEqual(['doc:notes/a.md', 'doc:notes/b.md']);
    expect(getTabs()[0].title).toBe('A'); // dedup does not rename
  });

  it('treats doc and chat tabs with the same key as distinct tabs', () => {
    const doc = openTab('doc', 'shared-key', 'Doc');
    const chat = openTab('chat', 'shared-key', 'Chat');

    expect(doc).not.toBeNull();
    expect(chat).not.toBeNull();
    expect(doc!.id).toBe('doc:shared-key');
    expect(chat!.id).toBe('chat:shared-key');
    expect(getTabs()).toHaveLength(2);
  });

  it('opens casual doc routes as one replaceable preview tab when requested', () => {
    const first = openTab('doc', 'notes/a.md', 'A', { pinned: false });
    const second = openTab('doc', 'notes/b.md', 'B', { pinned: false });

    expect(first).toMatchObject({ id: 'doc:notes/a.md', pinned: false });
    expect(second).toMatchObject({ id: 'doc:notes/b.md', pinned: false });
    expect(getTabs()).toEqual([
      { id: 'doc:notes/b.md', kind: 'doc', key: 'notes/b.md', title: 'B', pinned: false },
    ]);
  });

  it('upgrades an existing preview when the same doc is opened as kept', () => {
    openTab('doc', 'notes/a.md', 'A', { pinned: false });

    const kept = openTab('doc', 'notes/a.md', 'A');

    expect(kept).toEqual({ id: 'doc:notes/a.md', kind: 'doc', key: 'notes/a.md', title: 'A' });
    expect(getTabs()).toEqual([{ id: 'doc:notes/a.md', kind: 'doc', key: 'notes/a.md', title: 'A' }]);
  });
});

describe('keepTab', () => {
  it('turns a preview tab into a kept tab without reordering it', () => {
    openTab('doc', 'kept.md', 'Kept');
    openTab('doc', 'preview.md', 'Preview', { pinned: false });

    const kept = keepTab('doc:preview.md');

    expect(kept).toEqual({ id: 'doc:preview.md', kind: 'doc', key: 'preview.md', title: 'Preview' });
    expect(getTabs()).toEqual([
      { id: 'doc:kept.md', kind: 'doc', key: 'kept.md', title: 'Kept' },
      { id: 'doc:preview.md', kind: 'doc', key: 'preview.md', title: 'Preview' },
    ]);
  });

  it('is a no-op for already kept or missing tabs', () => {
    const original = openTab('doc', 'kept.md', 'Kept');
    const before = getTabs();

    expect(keepTab('doc:kept.md')).toBe(original);
    expect(keepTab('doc:missing.md')).toBeNull();
    expect(getTabs()).toBe(before);
  });
});

describe('MAX_TABS limit', () => {
  function fillToMax(): void {
    for (let i = 0; i < MAX_TABS; i++) {
      expect(openTab('doc', `notes/${i}.md`, `Note ${i}`)).not.toBeNull();
    }
  }

  it('opens the 50th tab but returns null for the 51st and leaves tabs unchanged', () => {
    fillToMax();
    expect(getTabs()).toHaveLength(MAX_TABS);
    const before = getTabs();

    const overflow = openTab('doc', 'notes/overflow.md', 'Overflow');

    expect(overflow).toBeNull();
    expect(getTabs()).toBe(before);
    expect(getTabs()).toHaveLength(MAX_TABS);
  });

  it('still returns an existing tab at the limit instead of null', () => {
    fillToMax();
    const existing = openTab('doc', 'notes/0.md', 'Note 0');
    expect(existing).not.toBeNull();
    expect(existing!.id).toBe('doc:notes/0.md');
  });

  it('allows opening a new tab again after closing one at the limit', () => {
    fillToMax();
    closeTab('doc:notes/0.md');

    const reopened = openTab('doc', 'notes/overflow.md', 'Overflow');

    expect(reopened).not.toBeNull();
    expect(getTabs()).toHaveLength(MAX_TABS);
    expect(getTabs().at(-1)!.id).toBe('doc:notes/overflow.md');
  });
});

describe('closeTab / closeByKey', () => {
  it('closeTab removes the matching tab and keeps the rest in order', () => {
    openTab('doc', 'a.md', 'A');
    openTab('chat', 's-1', 'Chat');
    openTab('doc', 'b.md', 'B');

    closeTab('chat:s-1');

    expect(getTabs().map((t) => t.id)).toEqual(['doc:a.md', 'doc:b.md']);
  });

  it('closeByKey removes the tab addressed by (kind, key)', () => {
    openTab('doc', 'a.md', 'A');
    openTab('chat', 'a.md', 'Chat with doc-shaped key');

    closeByKey('chat', 'a.md');

    expect(getTabs().map((t) => t.id)).toEqual(['doc:a.md']);
  });

  it('closing an unknown id is a silent no-op that does not notify or rewrite state', () => {
    openTab('doc', 'a.md', 'A');
    const before = getTabs();

    closeTab('doc:missing.md');
    closeByKey('chat', 'missing');

    expect(getTabs()).toBe(before); // emit always allocates a new array; same ref ⇒ no emit
  });
});

describe('renameByKey', () => {
  it('renames the tab title in place preserving order and other tabs', () => {
    openTab('doc', 'a.md', 'Old');
    openTab('doc', 'b.md', 'B');

    renameByKey('doc', 'a.md', 'New');

    expect(getTabs().map((t) => t.title)).toEqual(['New', 'B']);
    expect(getTabs().map((t) => t.id)).toEqual(['doc:a.md', 'doc:b.md']);
  });

  it('is a no-op for an identical title: no state change and no persist scheduled', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-rename');
    openTab('doc', 'a.md', 'Same');
    vi.advanceTimersByTime(DEBOUNCE_MS); // flush the openTab write
    const setItem = vi.spyOn(localStorage, 'setItem');
    const before = getTabs();

    renameByKey('doc', 'a.md', 'Same');
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);

    expect(getTabs()).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown (kind, key)', () => {
    openTab('doc', 'a.md', 'A');
    const before = getTabs();

    renameByKey('doc', 'missing.md', 'New');
    renameByKey('chat', 'a.md', 'New'); // same key, wrong kind

    expect(getTabs()).toBe(before);
  });
});

describe('moveTab', () => {
  function seedFour(): void {
    openTab('doc', 'a.md', 'A');
    openTab('doc', 'b.md', 'B');
    openTab('doc', 'c.md', 'C');
    openTab('doc', 'd.md', 'D');
  }
  const ids = () => getTabs().map((t) => t.key);

  it('moves a tab forward to the target index', () => {
    seedFour();
    moveTab('doc:a.md', 2);
    expect(ids()).toEqual(['b.md', 'c.md', 'a.md', 'd.md']);
  });

  it('moves a tab backward to the target index', () => {
    seedFour();
    moveTab('doc:d.md', 1);
    expect(ids()).toEqual(['a.md', 'd.md', 'b.md', 'c.md']);
  });

  it('clamps a negative index to the start', () => {
    seedFour();
    moveTab('doc:c.md', -5);
    expect(ids()).toEqual(['c.md', 'a.md', 'b.md', 'd.md']);
  });

  it('clamps a beyond-end index to the last position', () => {
    seedFour();
    moveTab('doc:a.md', 999);
    expect(ids()).toEqual(['b.md', 'c.md', 'd.md', 'a.md']);
  });

  it('is a no-op when the clamped target equals the current position', () => {
    seedFour();
    const before = getTabs();
    moveTab('doc:b.md', 1);
    moveTab('doc:d.md', 999); // clamps onto its own index
    expect(getTabs()).toBe(before);
  });

  it('is a no-op for an unknown id', () => {
    seedFour();
    const before = getTabs();
    moveTab('doc:missing.md', 0);
    expect(getTabs()).toBe(before);
  });
});

describe('reconcileChatTabs', () => {
  it('closes chat tabs that are neither live nor running', () => {
    openTab('chat', 's-live', 'Live');
    openTab('chat', 's-dead', 'Evicted');
    openTab('chat', 's-running', 'Running');

    reconcileChatTabs(new Set(['s-live']), new Set(['s-running']));

    expect(getTabs().map((t) => t.key)).toEqual(['s-live', 's-running']);
  });

  it('keeps a chat tab that only appears in runningSessionIds (run in flight for an evicted session)', () => {
    openTab('chat', 's-evicted-but-running', 'Running');

    reconcileChatTabs(new Set<string>(), new Set(['s-evicted-but-running']));

    expect(getTabs().map((t) => t.key)).toEqual(['s-evicted-but-running']);
  });

  it('never closes doc tabs even when both session sets are empty', () => {
    openTab('doc', 'a.md', 'A');
    openTab('chat', 's-dead', 'Dead');
    openTab('doc', 'b.md', 'B');

    reconcileChatTabs(new Set<string>(), new Set<string>());

    expect(getTabs().map((t) => t.id)).toEqual(['doc:a.md', 'doc:b.md']);
  });

  it('emits nothing when nothing changes', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-reconcile');
    openTab('doc', 'a.md', 'A');
    openTab('chat', 's-1', 'Chat');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const setItem = vi.spyOn(localStorage, 'setItem');
    const before = getTabs();

    reconcileChatTabs(new Set(['s-1']), new Set<string>());
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);

    expect(getTabs()).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('persistence', () => {
  it('writes to `mindos.workspaceTabs.v1:<rootId>` only after the 300ms debounce', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'a.md', 'A');

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(localStorage.getItem(storageKeyFor('root-a'))).toBeNull();

    vi.advanceTimersByTime(1);
    expect(readStored('root-a')).toEqual([
      { id: 'doc:a.md', kind: 'doc', key: 'a.md', title: 'A' },
    ]);
  });

  it('does not persist preview tabs until they are kept', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'preview.md', 'Preview', { pinned: false });

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(readStored('root-a')).toEqual([]);

    keepTab('doc:preview.md');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(readStored('root-a')).toEqual([
      { id: 'doc:preview.md', kind: 'doc', key: 'preview.md', title: 'Preview' },
    ]);
  });

  it('coalesces rapid successive mutations into a single write of the final state', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    const setItem = vi.spyOn(localStorage, 'setItem');

    openTab('doc', 'a.md', 'A');
    vi.advanceTimersByTime(100);
    openTab('doc', 'b.md', 'B');
    vi.advanceTimersByTime(100);
    renameByKey('doc', 'a.md', 'A2');
    closeByKey('doc', 'b.md');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readStored('root-a')).toEqual([
      { id: 'doc:a.md', kind: 'doc', key: 'a.md', title: 'A2' },
    ]);
  });

  it('does not persist anything before initWorkspaceTabs binds a root', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(localStorage, 'setItem');

    openTab('doc', 'a.md', 'A');
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);

    expect(setItem).not.toHaveBeenCalled();
  });

  it('round-trips: persist, reset, re-init the same root restores tabs in order', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'first.md', 'First');
    openTab('chat', 's-1', 'Chat');
    openTab('doc', 'second.md', 'Second');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    resetWorkspaceTabsForTests();
    expect(getTabs()).toEqual([]);

    initWorkspaceTabs('root-a');
    expect(getTabs()).toEqual([
      { id: 'doc:first.md', kind: 'doc', key: 'first.md', title: 'First' },
      { id: 'chat:s-1', kind: 'chat', key: 's-1', title: 'Chat' },
      { id: 'doc:second.md', kind: 'doc', key: 'second.md', title: 'Second' },
    ]);
  });

  it('survives localStorage.setItem throwing (quota / private mode) without crashing', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    openTab('doc', 'a.md', 'A');
    expect(() => vi.advanceTimersByTime(DEBOUNCE_MS)).not.toThrow();
    expect(getTabs()).toHaveLength(1); // in-memory state unaffected
  });
});

describe('corrupt storage recovery', () => {
  it('recovers to an empty set from invalid JSON', () => {
    localStorage.setItem(storageKeyFor('root-a'), '{not json[');
    initWorkspaceTabs('root-a');
    expect(getTabs()).toEqual([]);
  });

  it('recovers to an empty set from valid JSON that is not an array', () => {
    localStorage.setItem(storageKeyFor('root-a'), JSON.stringify({ tabs: [] }));
    initWorkspaceTabs('root-a');
    expect(getTabs()).toEqual([]);

    resetWorkspaceTabsForTests();
    localStorage.setItem(storageKeyFor('root-a'), JSON.stringify('hello'));
    initWorkspaceTabs('root-a');
    expect(getTabs()).toEqual([]);
  });

  it('drops items with an invalid kind, empty key, or non-string title and keeps valid ones', () => {
    localStorage.setItem(storageKeyFor('root-a'), JSON.stringify([
      { kind: 'doc', key: 'good.md', title: 'Good' },
      { kind: 'folder', key: 'bad-kind', title: 'X' },
      { kind: 'doc', key: '', title: 'empty key' },
      { kind: 'doc', key: 42, title: 'numeric key' },
      { kind: 'chat', key: 's-1', title: 7 },
      { kind: 'chat', key: 's-2' },
      null,
      'string item',
      { kind: 'chat', key: 's-ok', title: '' }, // empty title is a valid string
      { kind: 'doc', key: 'preview.md', title: 'Preview', pinned: false },
    ]));

    initWorkspaceTabs('root-a');

    expect(getTabs()).toEqual([
      { id: 'doc:good.md', kind: 'doc', key: 'good.md', title: 'Good' },
      { id: 'chat:s-ok', kind: 'chat', key: 's-ok', title: '' },
    ]);
  });

  it('dedups duplicate (kind, key) entries from storage keeping the first', () => {
    localStorage.setItem(storageKeyFor('root-a'), JSON.stringify([
      { kind: 'doc', key: 'a.md', title: 'First' },
      { kind: 'doc', key: 'a.md', title: 'Duplicate' },
      { kind: 'chat', key: 'a.md', title: 'Different kind ok' },
    ]));

    initWorkspaceTabs('root-a');

    expect(getTabs().map((t) => t.id)).toEqual(['doc:a.md', 'chat:a.md']);
    expect(getTabs()[0].title).toBe('First');
  });

  it('truncates a stored payload with more than 50 items to MAX_TABS', () => {
    const oversized = Array.from({ length: MAX_TABS + 10 }, (_, i) => ({
      kind: 'doc', key: `n/${i}.md`, title: `N${i}`,
    }));
    localStorage.setItem(storageKeyFor('root-a'), JSON.stringify(oversized));

    initWorkspaceTabs('root-a');

    expect(getTabs()).toHaveLength(MAX_TABS);
    expect(getTabs().at(-1)!.key).toBe(`n/${MAX_TABS - 1}.md`);
  });

  it('starts empty when localStorage.getItem throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => initWorkspaceTabs('root-a')).not.toThrow();
    expect(getTabs()).toEqual([]);
  });
});

describe('root switching', () => {
  it('switching to a root with no stored tabs starts an empty working set', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'a.md', 'A');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    initWorkspaceTabs('root-b');

    expect(getTabs()).toEqual([]);
    expect(readStored('root-a')).toEqual([
      { id: 'doc:a.md', kind: 'doc', key: 'a.md', title: 'A' },
    ]);
  });

  it('a pending debounced write for root a never lands in root b storage after a switch', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'flushed.md', 'Flushed');
    vi.advanceTimersByTime(DEBOUNCE_MS); // flushed snapshot for root-a
    openTab('doc', 'pending.md', 'Pending'); // schedules a write that must not leak

    initWorkspaceTabs('root-b'); // switch while the root-a write is pending
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);

    expect(localStorage.getItem(storageKeyFor('root-b'))).toBeNull();
    // root-a keeps its last flushed snapshot, not root-b's (empty) tabs
    expect(readStored('root-a')).toEqual([
      { id: 'doc:flushed.md', kind: 'doc', key: 'flushed.md', title: 'Flushed' },
    ]);
  });

  it('mutations after a root switch persist only under the new root key', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'a.md', 'A');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    initWorkspaceTabs('root-b');
    openTab('doc', 'b-only.md', 'B');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(readStored('root-b')).toEqual([
      { id: 'doc:b-only.md', kind: 'doc', key: 'b-only.md', title: 'B' },
    ]);
    expect(readStored('root-a')).toEqual([
      { id: 'doc:a.md', kind: 'doc', key: 'a.md', title: 'A' },
    ]);
  });

  it('re-initializing the same root is idempotent and does not clobber in-memory state', () => {
    initWorkspaceTabs('root-a');
    openTab('doc', 'a.md', 'A'); // not yet persisted (debounce pending)
    const before = getTabs();

    initWorkspaceTabs('root-a');

    expect(getTabs()).toBe(before); // not reloaded from (stale, empty) storage
    expect(getTabs()).toHaveLength(1);
  });

  it('each root keeps an isolated tab set across alternating switches', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', 'a.md', 'A');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    initWorkspaceTabs('root-b');
    openTab('doc', 'b.md', 'B');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    initWorkspaceTabs('root-a');
    expect(getTabs().map((t) => t.key)).toEqual(['a.md']);

    initWorkspaceTabs('root-b');
    expect(getTabs().map((t) => t.key)).toEqual(['b.md']);
  });
});

describe('unicode keys', () => {
  it('round-trips a Chinese doc path through persist and restore', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', '笔记/想法.md', '想法');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    resetWorkspaceTabsForTests();
    initWorkspaceTabs('root-a');

    expect(getTabs()).toEqual([
      { id: 'doc:笔记/想法.md', kind: 'doc', key: '笔记/想法.md', title: '想法' },
    ]);
    expect(openTab('doc', '笔记/想法.md', '想法')).toBe(getTabs()[0]); // dedup still matches
  });

  it('round-trips an emoji doc path through persist and restore', () => {
    vi.useFakeTimers();
    initWorkspaceTabs('root-a');
    openTab('doc', '📓/notes.md', '📓 Notes');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    resetWorkspaceTabsForTests();
    initWorkspaceTabs('root-a');

    expect(getTabs()).toEqual([
      { id: 'doc:📓/notes.md', kind: 'doc', key: '📓/notes.md', title: '📓 Notes' },
    ]);
  });
});

describe('readDomRootId', () => {
  it('returns the data-mind-root-id attribute from the document element when set', () => {
    document.documentElement.setAttribute('data-mind-root-id', 'vault-42');
    expect(readDomRootId()).toBe('vault-42');
  });

  it('falls back to "default" when the attribute is absent or empty', () => {
    document.documentElement.removeAttribute('data-mind-root-id');
    expect(readDomRootId()).toBe('default');

    document.documentElement.setAttribute('data-mind-root-id', '');
    expect(readDomRootId()).toBe('default');
  });
});

describe('useWorkspaceTabs hook', () => {
  function mountProbe() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state: { root: Root | null; current: WorkspaceTab[]; renders: number } = {
      root: null,
      current: [],
      renders: 0,
    };
    function Probe(): null {
      state.current = useWorkspaceTabs();
      state.renders += 1;
      return null;
    }
    act(() => {
      state.root = createRoot(container);
      state.root.render(React.createElement(Probe));
    });
    return {
      get current() { return state.current; },
      get renders() { return state.renders; },
      unmount() {
        act(() => state.root?.unmount());
        container.remove();
      },
    };
  }

  it('re-renders with the new tab list on openTab and closeTab', () => {
    const probe = mountProbe();
    try {
      expect(probe.current).toEqual([]);

      act(() => { openTab('doc', 'a.md', 'A'); });
      expect(probe.current.map((t) => t.id)).toEqual(['doc:a.md']);

      act(() => { openTab('chat', 's-1', 'Chat'); });
      expect(probe.current.map((t) => t.id)).toEqual(['doc:a.md', 'chat:s-1']);

      act(() => { closeTab('doc:a.md'); });
      expect(probe.current.map((t) => t.id)).toEqual(['chat:s-1']);
    } finally {
      probe.unmount();
    }
  });

  it('keeps the snapshot referentially stable across unrelated no-op calls', () => {
    const probe = mountProbe();
    try {
      act(() => { openTab('doc', 'a.md', 'A'); });
      const snapshot = probe.current;
      const rendersAfterOpen = probe.renders;

      act(() => {
        openTab('doc', 'a.md', 'A'); // dedup
        closeTab('doc:missing.md'); // unknown id
        renameByKey('doc', 'a.md', 'A'); // same title
        moveTab('doc:a.md', 0); // same position
        reconcileChatTabs(new Set<string>(), new Set<string>()); // no chat tabs
      });

      expect(probe.current).toBe(snapshot);
      expect(probe.renders).toBe(rendersAfterOpen);
    } finally {
      probe.unmount();
    }
  });

  it('reflects an init-driven root switch in subscribed components', () => {
    const probe = mountProbe();
    try {
      act(() => {
        initWorkspaceTabs('root-a');
        openTab('doc', 'a.md', 'A');
      });
      expect(probe.current).toHaveLength(1);

      act(() => { initWorkspaceTabs('root-b'); });
      expect(probe.current).toEqual([]);
    } finally {
      probe.unmount();
    }
  });
});
