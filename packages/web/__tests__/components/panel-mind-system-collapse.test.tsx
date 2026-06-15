// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Panel from '@/components/Panel';
import type { MindSystemSlot } from '@/lib/mind-system';
import type { FileNode } from '@/lib/types';

const mockPush = vi.fn();
const routeState = vi.hoisted(() => ({
  pathname: '/wiki',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/actions', () => ({
  listTrashAction: vi.fn(async () => []),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MIND_SYSTEM_COLLAPSED_KEY = 'mindos.sidebar.mindSystemCollapsed';
const SLOT_LIST_ID = 'mind-system-sidebar-slots';

const mindSystemSlots: MindSystemSlot[] = [
  {
    key: 'dao',
    systemId: 'MIND_DAO',
    label: '道',
    path: 'MIND_DAO',
    role: 'world-model',
    order: 10,
    enabled: true,
  },
  {
    key: 'fa',
    systemId: 'MIND_FA',
    label: '法',
    path: 'MIND_FA',
    role: 'principles',
    order: 20,
    enabled: true,
  },
  {
    key: 'shu',
    systemId: 'MIND_SHU',
    label: '术',
    path: 'MIND_SHU',
    role: 'methods',
    order: 30,
    enabled: true,
  },
  {
    key: 'qi',
    systemId: 'MIND_QI',
    label: '器',
    path: 'MIND_QI',
    role: 'tools',
    order: 40,
    enabled: true,
  },
];

const mindSystemFileTree: FileNode[] = [
  {
    type: 'directory',
    name: 'MIND_DAO',
    path: 'MIND_DAO',
    isSpace: true,
    children: [
      { type: 'file', name: 'README.md', path: 'MIND_DAO/README.md', extension: '.md' },
      { type: 'file', name: 'INSTRUCTION.md', path: 'MIND_DAO/INSTRUCTION.md', extension: '.md' },
    ],
  },
  {
    type: 'directory',
    name: 'MIND_FA',
    path: 'MIND_FA',
    isSpace: true,
    children: [
      { type: 'file', name: 'INSTRUCTION.md', path: 'MIND_FA/INSTRUCTION.md', extension: '.md' },
    ],
  },
  {
    type: 'directory',
    name: 'MIND_SHU',
    path: 'MIND_SHU',
    isSpace: true,
    children: [
      { type: 'file', name: 'INSTRUCTION.md', path: 'MIND_SHU/INSTRUCTION.md', extension: '.md' },
    ],
  },
  {
    type: 'directory',
    name: 'MIND_QI',
    path: 'MIND_QI',
    isSpace: true,
    children: [
      { type: 'file', name: 'INSTRUCTION.md', path: 'MIND_QI/INSTRUCTION.md', extension: '.md' },
    ],
  },
  {
    type: 'directory',
    name: 'Projects',
    path: 'Projects',
    children: [
      { type: 'file', name: 'plan.md', path: 'Projects/plan.md', extension: '.md' },
    ],
  },
];

function renderPanel(
  host: HTMLDivElement,
  options: { fileTree?: FileNode[]; slots?: MindSystemSlot[] } = {},
): Root {
  const root = createRoot(host);
  root.render(
    <Panel
      activePanel="files"
      fileTree={options.fileTree ?? []}
      mindSystemSlots={options.slots ?? mindSystemSlots}
      onOpenSyncSettings={() => {}}
    />,
  );
  return root;
}

function renderFilesPanel(host: HTMLDivElement): Root {
  return renderPanel(host);
}

function getMindSystemToggle(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-controls="${SLOT_LIST_ID}"]`);
  if (!button) throw new Error('Mind System toggle not found');
  return button;
}

describe('Panel Mind System collapse', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.clearAllMocks();
    routeState.pathname = '/wiki';
    localStorage.clear();
    root = null;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ files: [] }),
    })));
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('defaults collapsed and toggles the Mind System parent without navigating', async () => {
    await act(async () => {
      root = renderPanel(host);
    });

    const toggle = getMindSystemToggle(host);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('data-state')).toBe('collapsed');
    expect(host.querySelector(`#${SLOT_LIST_ID}`)).toBeNull();

    await act(async () => {
      toggle.click();
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('data-state')).toBe('expanded');
    expect(host.querySelector(`#${SLOT_LIST_ID}`)).not.toBeNull();
    expect(localStorage.getItem(MIND_SYSTEM_COLLAPSED_KEY)).toBe('0');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps the Mind System parent label inside the toggle row', async () => {
    await act(async () => {
      root = renderPanel(host);
    });

    const section = host.querySelector<HTMLElement>('section[aria-label="Mind System"]');
    const toggle = getMindSystemToggle(host);

    expect(section?.firstElementChild).toBe(toggle);
    expect(toggle.textContent).toContain('Mind System');
    expect(toggle.textContent).not.toContain('Dao / Fa / Shu / Qi');
    expect(toggle.textContent).not.toContain('道 / 法 / 术 / 器');
    expect(toggle.textContent).not.toContain('心');
    expect(toggle.querySelector('svg')).not.toBeNull();
  });

  it('restores the persisted collapsed state', async () => {
    localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, '1');

    await act(async () => {
      root = renderPanel(host);
    });

    expect(getMindSystemToggle(host).getAttribute('aria-expanded')).toBe('false');
    expect(getMindSystemToggle(host).getAttribute('data-state')).toBe('collapsed');
    expect(host.querySelector(`#${SLOT_LIST_ID}`)).toBeNull();
  });

  it('restores the persisted expanded state', async () => {
    localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, '0');

    await act(async () => {
      root = renderPanel(host);
    });

    expect(getMindSystemToggle(host).getAttribute('aria-expanded')).toBe('true');
    expect(getMindSystemToggle(host).getAttribute('data-state')).toBe('expanded');
    expect(host.querySelector(`#${SLOT_LIST_ID}`)).not.toBeNull();
  });

  it('does not duplicate visible Mind System slots in the ordinary file tree', async () => {
    await act(async () => {
      root = renderPanel(host, { fileTree: mindSystemFileTree });
    });

    expect(host.textContent).toContain('Projects');
    expect(host.textContent).not.toContain('MIND_DAO');
    expect(host.textContent).not.toContain('MIND_FA');
    expect(host.textContent).not.toContain('MIND_SHU');
    expect(host.textContent).not.toContain('MIND_QI');
  });

  it('keeps MIND folders in the ordinary file tree when Mind System slots are hidden', async () => {
    await act(async () => {
      root = renderPanel(host, { fileTree: mindSystemFileTree, slots: [] });
    });

    expect(host.textContent).toContain('MIND_DAO');
    expect(host.textContent).toContain('MIND_FA');
    expect(host.textContent).toContain('MIND_SHU');
    expect(host.textContent).toContain('MIND_QI');
    expect(host.textContent).toContain('Projects');
  });

  it('keeps Mind System sidebar rows focused on navigation only', async () => {
    localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, '0');

    await act(async () => {
      root = renderPanel(host);
    });

    const openButton = host.querySelector<HTMLButtonElement>('[data-mind-system-sidebar-open="dao"]');
    const runButton = host.querySelector<HTMLButtonElement>('[data-mind-system-sidebar-run-once="dao"]');

    expect(openButton).not.toBeNull();
    expect(openButton?.textContent).toContain('Values, direction, long-term judgment');
    expect(openButton?.textContent).not.toContain('Daily signal curator');
    expect(openButton?.textContent).not.toContain('+1 assistant');
    expect(runButton).toBeNull();

    await act(async () => {
      openButton?.click();
    });

    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(mockPush).toHaveBeenCalledWith('/view/MIND_DAO');
  });

  it('opens the top New menu toward the panel content and puts Import first', async () => {
    await act(async () => {
      root = renderPanel(host);
    });

    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Import file"]')).toBeNull();

    const newButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.getAttribute('aria-label') === 'New' || button.getAttribute('aria-label') === '新建');
    expect(newButton).not.toBeNull();

    await act(async () => {
      newButton?.click();
      await Promise.resolve();
    });

    const menu = host.querySelector<HTMLElement>('[data-panel-new-menu]');
    expect(menu).not.toBeNull();
    expect(menu?.className).toContain('left-0');
    expect(menu?.className).not.toContain('right-0');
    const items = Array.from(menu!.querySelectorAll<HTMLButtonElement>('button')).map(button => button.textContent?.trim());
    expect(items).toEqual(['Import file', 'New file', 'New Space']);
  });

  it('keeps Inbox out of the Files header More menu', async () => {
    await act(async () => {
      root = renderPanel(host);
    });

    const moreButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.getAttribute('aria-label') === 'More' || button.getAttribute('aria-label') === '更多');
    expect(moreButton).not.toBeNull();

    await act(async () => {
      moreButton?.click();
      await Promise.resolve();
    });

    const moreMenu = host.querySelector<HTMLElement>('.files-panel-header-more-action > div');
    expect(moreMenu).not.toBeNull();
    expect(moreMenu?.textContent).not.toContain('Inbox');
    expect(moreMenu?.textContent).toContain('Content changes');
    expect(moreMenu?.textContent).toContain('Trash');
  });

  it('uses rounded active states for Mind System instead of vertical bars', async () => {
    routeState.pathname = '/view/MIND_DAO';
    localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, '0');

    await act(async () => {
      root = renderPanel(host);
    });

    const toggle = getMindSystemToggle(host);
    expect(toggle.className).toContain('[--hit-target-radius:var(--radius-lg)]');
    expect(toggle.className).toContain('[--hit-target-active-bg:var(--amber-subtle)]');
    expect(toggle.className).toContain('[--hit-target-active-border:color-mix(in_srgb,var(--amber)_28%,transparent)]');
    expect(toggle.querySelector('[class*="rounded-r-full"]')).toBeNull();

    const openButton = host.querySelector<HTMLButtonElement>('[data-mind-system-sidebar-open="dao"]');
    expect(openButton).not.toBeNull();
    expect(openButton?.getAttribute('aria-current')).toBe('page');
    expect(openButton?.className).toContain('[--hit-target-radius:var(--radius-md)]');
    expect(openButton?.className).toContain('[--hit-target-active-bg:var(--amber-subtle)]');
    expect(openButton?.className).toContain('[--hit-target-active-border:color-mix(in_srgb,var(--amber)_24%,transparent)]');
    expect(openButton?.querySelector('[class*="rounded-r-full"]')).toBeNull();
  });

  it('loads the Inbox badge count through the normalized Inbox client contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        files: [
          { name: 'a.md', path: 'Inbox/a.md', size: 1, modifiedAt: new Date().toISOString(), isAging: false },
          { name: 'b.md', path: 'Inbox/b.md', size: 1, modifiedAt: new Date().toISOString(), isAging: false },
        ],
      }),
    })));

    await act(async () => {
      root = renderFilesPanel(host);
      await new Promise(r => setTimeout(r, 0));
    });

    const inboxButtons = Array.from(host.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('Inbox'));
    expect(inboxButtons.some(button => button.textContent?.includes('2'))).toBe(true);
  });

  it('clears the Inbox badge count when Inbox loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Inbox unavailable' }),
    })));

    await act(async () => {
      root = renderFilesPanel(host);
      await new Promise(r => setTimeout(r, 0));
    });

    const inboxButtons = Array.from(host.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('Inbox'));
    expect(inboxButtons.some(button => button.textContent?.includes('2'))).toBe(false);
  });
});
