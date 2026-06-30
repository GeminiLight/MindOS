// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioContent from '@/components/studio/StudioContent';
import StudioAppsContent from '@/components/studio/StudioAppsContent';
import StudioAutomationContent from '@/components/studio/StudioAutomationContent';
import StudioPanel from '@/components/panels/StudioPanel';

const push = vi.fn();
let mockPathname = '/studio';

vi.mock('@/hooks/useSmoothRouterPush', () => ({
  useSmoothRouterPush: () => push,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

type TestAutomation = {
  id: string;
  title: string;
  prompt: string;
  scope: 'worktree' | 'project' | 'mind';
  projectId?: string;
  schedule: 'daily-0900' | 'every-4-hours' | 'weekdays-0900' | 'weekly-review';
  model: 'mindos-auto' | 'claude-code';
  effort: 'normal' | 'high';
  status: 'active' | 'paused';
  updated: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  lastStatus: 'pending' | 'running' | 'success' | 'error';
  runtime: 'mindos-pi';
  source: 'schedule-prompt';
  controlPlaneScheduleId: string;
};

const seedAutomations = (): TestAutomation[] => [
  {
    id: 'daily-research-radar',
    title: 'Daily research radar',
    prompt: 'Scan tracked research directions, select the strongest papers, and write the daily Chinese radar reports.',
    scope: 'mind',
    schedule: 'daily-0900',
    model: 'mindos-auto',
    effort: 'high',
    status: 'active',
    updated: '2026-06-30T09:04:00.000Z',
    lastRun: '2026-06-30T09:04:00.000Z',
    nextRun: '2026-07-01T09:00:00.000Z',
    runCount: 18,
    lastStatus: 'success',
    runtime: 'mindos-pi',
    source: 'schedule-prompt',
    controlPlaneScheduleId: 'studio-daily-research-radar',
  },
  {
    id: 'inbox-cleanup-review',
    title: 'Inbox cleanup review',
    prompt: 'Group new captures, flag duplicates, and propose the safest promotion target before writing anything.',
    scope: 'project',
    projectId: 'inbox-practice',
    schedule: 'weekdays-0900',
    model: 'mindos-auto',
    effort: 'normal',
    status: 'paused',
    updated: '2026-06-29T09:12:00.000Z',
    lastRun: '2026-06-29T09:12:00.000Z',
    nextRun: 'Paused',
    runCount: 7,
    lastStatus: 'success',
    runtime: 'mindos-pi',
    source: 'schedule-prompt',
    controlPlaneScheduleId: 'studio-inbox-cleanup-review',
  },
  {
    id: 'release-note-sweep',
    title: 'Release note sweep',
    prompt: 'Check completed work, collect user-facing changes, and draft a compact release note.',
    scope: 'worktree',
    schedule: 'weekly-review',
    model: 'claude-code',
    effort: 'high',
    status: 'active',
    updated: '2026-06-28T17:30:00.000Z',
    lastRun: '2026-06-26T17:30:00.000Z',
    nextRun: '2026-07-03T17:30:00.000Z',
    runCount: 4,
    lastStatus: 'pending',
    runtime: 'mindos-pi',
    source: 'schedule-prompt',
    controlPlaneScheduleId: 'studio-release-note-sweep',
  },
];

function automationPayload(automations: TestAutomation[]) {
  const enabled = automations.filter((automation) => automation.status === 'active').length;
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-30T12:00:00.000Z',
    automations,
    summary: {
      total: automations.length,
      enabled,
      paused: automations.length - enabled,
      externalSchedulePromptJobs: 0,
      scheduleStorePath: '/tmp/.mindos/schedule-prompts.json',
      controlPlaneScheduleCount: automations.length,
    },
  };
}

function setupAutomationFetch(initial: TestAutomation[] = seedAutomations()) {
  let automations = initial.map((automation) => ({ ...automation }));
  const fetchMock = vi.fn(async (href: string | URL | Request, init?: RequestInit) => {
    const url = typeof href === 'string' ? href : href instanceof Request ? href.url : href.toString();
    if (!url.endsWith('/api/studio/automations')) {
      return Response.json({ error: `Unexpected request: ${url}` }, { status: 404 });
    }
    if (!init || init.method === 'GET') {
      return Response.json(automationPayload(automations));
    }
    const body = JSON.parse(String(init.body ?? '{}')) as {
      action?: string;
      id?: string;
      status?: 'active' | 'paused';
      draft?: Partial<TestAutomation>;
    };
    if (body.action === 'create' && body.draft) {
      const id = `studio-${String(body.draft.title || 'automation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      automations = [{
        id,
        title: body.draft.title || 'Untitled automation',
        prompt: body.draft.prompt || '',
        scope: body.draft.scope || 'worktree',
        projectId: body.draft.projectId,
        schedule: body.draft.schedule || 'daily-0900',
        model: body.draft.model || 'mindos-auto',
        effort: body.draft.effort || 'high',
        status: 'active',
        updated: '2026-06-30T12:01:00.000Z',
        runCount: 0,
        lastStatus: 'pending',
        runtime: 'mindos-pi',
        source: 'schedule-prompt',
        controlPlaneScheduleId: `studio-${id}`,
      }, ...automations];
      return Response.json(automationPayload(automations), { status: 201 });
    }
    if (body.action === 'update' && body.id && body.draft) {
      automations = automations.map((automation) => automation.id === body.id
        ? { ...automation, ...body.draft, updated: '2026-06-30T12:02:00.000Z' }
        : automation);
      return Response.json(automationPayload(automations));
    }
    if (body.action === 'set-status' && body.id && body.status) {
      automations = automations.map((automation) => automation.id === body.id
        ? { ...automation, status: body.status!, nextRun: body.status === 'paused' ? 'Paused' : automation.nextRun }
        : automation);
      return Response.json(automationPayload(automations));
    }
    if (body.action === 'delete' && body.id) {
      automations = automations.filter((automation) => automation.id !== body.id);
      return Response.json(automationPayload(automations));
    }
    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderStudio() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<StudioContent />);
  });
}

async function renderStudioAutomation() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<StudioAutomationContent />);
  });
  await flushAsync();
}

async function renderStudioApps() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<StudioAppsContent />);
  });
}

async function setInputValue(selector: string, value: string) {
  const input = document.body.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input!), 'value');
    descriptor?.set?.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('StudioContent', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    mockPathname = '/studio';
    setupAutomationFetch();
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      root = null;
      await act(async () => {
        current.unmount();
      });
    }
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('renders Studio as a Project-first surface', async () => {
    await renderStudio();

    expect(host.textContent).toContain('New Project');
    expect(host.textContent).toContain('Projects');
    expect(host.textContent).not.toContain('Automation');
    expect(host.textContent).not.toContain('Create automation');
    expect(host.textContent).not.toContain('Project practice');
    expect(host.textContent).not.toContain('Recent Projects');
    expect(host.textContent).not.toContain('New session');
    expect(host.textContent).not.toContain('Long-running work with memory and review.');
    expect(host.querySelector('a[href="/studio/launch-practice"]')).not.toBeNull();
    expect(host.querySelector('[data-content-page-shell="studio"]')?.className).toContain('workbench-content-page');
    expect(host.querySelector('aside[aria-label="Studio"]')).toBeNull();

    const projectsSurface = host.querySelector('[data-studio-projects-surface]');
    expect(projectsSurface).not.toBeNull();
    expect(projectsSurface?.className).toContain('space-y-3');
    expect(projectsSurface?.className).not.toContain('rounded-xl');
    expect(projectsSurface?.className).not.toContain('bg-card/45');
    expect(projectsSurface?.textContent).toContain('All Projects');
    expect(projectsSurface?.textContent).toContain('List');
    expect(projectsSurface?.textContent).toContain('Grouped');
    expect(projectsSurface?.textContent).toContain('Stats');

    const continuePanel = host.querySelector('[data-studio-continue-panel]');
    expect(continuePanel).not.toBeNull();
    expect(continuePanel?.className).toContain('border-y');
    expect(continuePanel?.className).not.toContain('rounded-xl');
    expect(continuePanel?.className).not.toContain('bg-card/45');
  });

  it('uses shared Project items with value-only context text', async () => {
    await renderStudio();

    const items = host.querySelectorAll('[data-studio-project-item="default"]');
    expect(items.length).toBeGreaterThan(0);
    const itemClasses = items[0].getAttribute('class')?.split(/\s+/) ?? [];
    expect(itemClasses.some(className => className.startsWith('xl:grid-cols-'))).toBe(true);
    expect(itemClasses.some(className => className.startsWith('md:grid-cols-'))).toBe(false);

    const firstContext = items[0].querySelector('[data-studio-context-braid]');
    expect(firstContext).not.toBeNull();
    expect(firstContext?.textContent).toContain('Product Strategy');
    expect(firstContext?.textContent).toContain('Research Kit');
    expect(firstContext?.textContent).toContain('Mind');
    expect(firstContext?.textContent).toContain('+');
    expect(firstContext?.textContent).not.toContain('Launch Writing Kit');
    expect(firstContext?.textContent).not.toContain('Work dir');
    expect(firstContext?.textContent).not.toContain('Mind Space');
    expect(firstContext?.textContent).not.toContain('AI Kit');
    expect(firstContext?.querySelector('[title="Work dir"]')).not.toBeNull();
    expect(firstContext?.querySelector('[title="Mind Space"]')).not.toBeNull();
    expect(firstContext?.querySelector('[title="AI Kit"]')).not.toBeNull();
    expect(firstContext?.querySelectorAll('[data-studio-context-chip]')).toHaveLength(3);
    expect(firstContext?.querySelector('[data-studio-context-overflow]')).not.toBeNull();
    expect(firstContext?.querySelector('.border-l')).toBeNull();
    expect(firstContext?.querySelector('[data-studio-context-chip]')?.className).toContain('bg-muted/35');
    expect(firstContext?.querySelector('[data-studio-context-chip]')?.className).not.toContain('border-border');
    expect(items[0].textContent).not.toContain('Next move');
    expect(items[0].textContent).not.toContain('Draft launch brief from accepted evidence.');
  });

  it('switches Studio overview between grouped and stats views', async () => {
    await renderStudio();

    const groupedTab = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Grouped')
    ));
    expect(groupedTab).not.toBeNull();

    await act(async () => {
      groupedTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('Needs attention');
    expect(host.textContent).toContain('In motion');
    expect(host.textContent).toContain('Drafts');
    expect(host.querySelectorAll('[data-studio-project-item="default"]').length).toBeGreaterThan(0);

    const statsTab = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Stats')
    ));
    expect(statsTab).not.toBeNull();

    await act(async () => {
      statsTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('Project health');
    expect(host.textContent).toContain('Context coverage');
    expect(host.textContent).toContain('Projects needing attention');
    expect(host.querySelectorAll('[data-studio-project-item="compact"]').length).toBeGreaterThan(0);
  });

  it('renders the unified Studio panel with Overview, Apps, Automation and Projects', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(<StudioPanel active />);
    });

    expect(host.textContent).toContain('Overview');
    expect(host.textContent).toContain('Apps');
    expect(host.textContent).toContain('Automation');
    expect(host.textContent).toContain('Projects');
    const overview = host.querySelector('a[href="/studio"]');
    const apps = host.querySelector('a[href="/studio/apps"]');
    const automation = host.querySelector('a[href="/studio/automation"]');
    expect(overview).not.toBeNull();
    expect(apps).not.toBeNull();
    expect(automation).not.toBeNull();
    expect(overview?.className).toContain('gap-3');
    expect(overview?.className).toContain('px-4');
    expect(overview?.className).toContain('py-2.5');
    expect(host.querySelector('a[href="/studio/launch-practice"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Research Kit');
    expect(host.textContent).not.toContain('2 Sessions');
  });

  it('selects the Apps sidebar route without treating it as a Project', async () => {
    mockPathname = '/studio/apps';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(<StudioPanel active />);
    });

    const overview = host.querySelector('a[href="/studio"]');
    const apps = host.querySelector('a[href="/studio/apps"]');
    const automation = host.querySelector('a[href="/studio/automation"]');
    const launchProject = host.querySelector('a[href="/studio/launch-practice"]');
    expect(overview?.getAttribute('aria-current')).toBeNull();
    expect(apps?.getAttribute('aria-current')).toBe('page');
    expect(automation?.getAttribute('aria-current')).toBeNull();
    expect(launchProject?.getAttribute('aria-current')).toBeNull();
  });

  it('selects the Automation sidebar route without treating it as a Project', async () => {
    mockPathname = '/studio/automation';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(<StudioPanel active />);
    });

    const overview = host.querySelector('a[href="/studio"]');
    const automation = host.querySelector('a[href="/studio/automation"]');
    const launchProject = host.querySelector('a[href="/studio/launch-practice"]');
    expect(overview?.getAttribute('aria-current')).toBeNull();
    expect(automation?.getAttribute('aria-current')).toBe('page');
    expect(launchProject?.getAttribute('aria-current')).toBeNull();
  });

  it('renders Studio Apps as a Studio subpage with an Overview return link', async () => {
    await renderStudioApps();

    expect(host.querySelector('[data-content-page-shell="studio"]')).not.toBeNull();
    const backLink = host.querySelector('header a[data-studio-back-overview]');
    expect(backLink).not.toBeNull();
    expect(backLink?.getAttribute('href')).toBe('/studio');
    expect(backLink?.textContent).toContain('Overview');
    expect(host.textContent).toContain('Apps');
    expect(host.textContent).not.toContain('Scene apps');
    expect(host.textContent).not.toContain('First scene');
    expect(host.textContent).toContain('Relationships');
    expect(host.textContent).toContain('Relationship Memory');
    expect(host.textContent).toContain('Learning Practice');
    expect(host.textContent).toContain('Record touchpoint');
    expect(host.querySelector('a[href="/capture"]')).not.toBeNull();
    expect(host.querySelector('a[href="/echo/growth"]')).not.toBeNull();
  });

  it('renders Studio Automation as a Studio subpage with an Overview return link', async () => {
    await renderStudioAutomation();

    const backLink = host.querySelector('header a[data-studio-back-overview]');
    expect(backLink).not.toBeNull();
    expect(backLink?.getAttribute('href')).toBe('/studio');
    expect(backLink?.textContent).toContain('Overview');
    expect(host.textContent).toContain('Automation');
  });

  it('keeps Studio panel Project rows flat without expandable Sessions', async () => {
    mockPathname = '/studio/launch-practice';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(<StudioPanel active />);
    });

    const sidebarSessions = host.querySelector('[aria-label="Launch Practice Sessions"]');
    expect(sidebarSessions).toBeNull();
    expect(host.textContent).toContain('Launch Practice');
    expect(host.textContent).not.toContain('Launch brief review');
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('keeps Continue pinned to the last opened Project when hovering other Projects', async () => {
    localStorage.setItem('mindos:studio-last-opened-project-id', 'research-practice');
    await renderStudio();

    const readContinueText = () => {
      const panel = host.querySelector('[data-studio-continue-panel]');
      expect(panel).not.toBeNull();
      return panel!.textContent ?? '';
    };

    expect(readContinueText()).toContain('Research Practice');
    expect(readContinueText()).toContain('Promote reusable reading rubric to Space.');

    const launchLink = host.querySelector<HTMLAnchorElement>('a[href="/studio/launch-practice"]');
    expect(launchLink).not.toBeNull();
    await act(async () => {
      launchLink!.dispatchEvent(new Event('pointerenter', { bubbles: true }));
      launchLink!.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    });

    expect(readContinueText()).toContain('Research Practice');
    expect(readContinueText()).toContain('Promote reusable reading rubric to Space.');
    expect(readContinueText()).not.toContain('Draft launch brief from accepted evidence.');
  });

  it('creates a Project and navigates to its detail page', async () => {
    await renderStudio();

    const newProjectButton = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('New Project')
    ));
    expect(newProjectButton).not.toBeNull();

    await act(async () => {
      newProjectButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await setInputValue('input[placeholder="Launch practice"]', 'Growth Room');
    await setInputValue('textarea[placeholder="Turn product evidence into launch decisions"]', 'Train launch review habits');

    const form = host.querySelector('form[role="dialog"]') as HTMLFormElement | null;
    expect(form).not.toBeNull();

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(push).toHaveBeenCalledWith('/studio/growth-room');
  });

  it('allows an optional goal and falls back to the WorkDir folder when the Project name is blank', async () => {
    await renderStudio();

    const newProjectButton = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('New Project')
    ));
    expect(newProjectButton).not.toBeNull();

    await act(async () => {
      newProjectButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const form = host.querySelector('form[role="dialog"]') as HTMLFormElement | null;
    expect(form).not.toBeNull();
    const workDir = form!.querySelector('input[aria-label="WorkDir"]') as HTMLInputElement | null;
    expect(workDir).not.toBeNull();

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(workDir!), 'value');
      descriptor?.set?.call(workDir!, '/Users/moonshot/projects/product/mindos-dev');
      workDir!.dispatchEvent(new Event('input', { bubbles: true }));
      workDir!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(host.textContent).not.toContain('Name and goal are required.');
    expect(push).toHaveBeenCalledWith('/studio/mindos-dev');
  });

  it('uses WorkDir input and searchable chip pickers for Project setup', async () => {
    await renderStudio();

    const newProjectButton = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('New Project')
    ));
    expect(newProjectButton).not.toBeNull();

    await act(async () => {
      newProjectButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const form = host.querySelector('form[role="dialog"]') as HTMLFormElement | null;
    expect(form).not.toBeNull();

    const text = form!.textContent ?? '';
    expect(text.indexOf('WorkDir')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('WorkDir')).toBeLessThan(text.indexOf('Mind Space'));
    expect(text.indexOf('Mind Space')).toBeLessThan(text.indexOf('AI Kit'));

    const workDir = form!.querySelector('input[aria-label="WorkDir"]') as HTMLInputElement | null;
    expect(workDir).not.toBeNull();

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(workDir!), 'value');
      descriptor?.set?.call(workDir!, '/Users/moonshot/projects/product/mindos-dev');
      workDir!.dispatchEvent(new Event('input', { bubbles: true }));
      workDir!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const addSpace = form!.querySelector('button[aria-label="Add Space"]') as HTMLButtonElement | null;
    expect(addSpace).not.toBeNull();
    await act(async () => {
      addSpace!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await setInputValue('input[aria-label="Search Spaces"]', 'Product');
    const productStrategy = Array.from(form!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Product Strategy')
    ));
    expect(productStrategy).not.toBeNull();
    await act(async () => {
      productStrategy!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addKit = form!.querySelector('button[aria-label="Add AI Kit"]') as HTMLButtonElement | null;
    expect(addKit).not.toBeNull();
    await act(async () => {
      addKit!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await setInputValue('input[aria-label="Search AI Kit"]', 'Review');
    const reviewKit = Array.from(form!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Review Kit')
    ));
    expect(reviewKit).not.toBeNull();
    await act(async () => {
      reviewKit!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(workDir!.value).toBe('/Users/moonshot/projects/product/mindos-dev');
    expect(form!.textContent).toContain('Product Strategy');
    expect(form!.textContent).toContain('Review Kit');
  });

  it('creates, edits, and pauses Studio automations from the Automation page', async () => {
    await renderStudioAutomation();

    expect(host.textContent).toContain('Automation');
    expect(host.textContent).toContain('Create automation');
    expect(host.textContent).not.toContain('Local plans');
    expect(host.textContent).not.toContain('Runtime execution is not connected yet.');
    expect(host.textContent).not.toContain('Plans');
    expect(host.textContent).toContain('Daily research radar');

    const automationSection = host.querySelector('[data-studio-automation-section]');
    const automationContent = host.querySelector('[data-studio-automation-content]');
    const studioShell = host.querySelector('[data-content-page-shell="studio"]');
    const toolbar = host.querySelector('[data-studio-automation-toolbar]');
    const summaryRail = host.querySelector('[data-studio-automation-summary]');
    const createButton = host.querySelector('[data-studio-automation-create]');
    const automationList = host.querySelector('[data-studio-automation-list]');
    const seededCard = host.querySelector('[data-studio-automation-card]');
    expect(automationSection).not.toBeNull();
    expect(automationContent?.className).toContain('max-w-6xl');
    expect(studioShell?.className).not.toContain('[--main-body-content-max-width:100%]');
    expect(summaryRail).toBeNull();
    expect(toolbar).not.toBeNull();
    expect(toolbar?.textContent).toContain('All');
    expect(toolbar?.textContent).toContain('3');
    expect(toolbar?.textContent).toContain('Enabled');
    expect(toolbar?.textContent).toContain('2');
    expect(toolbar?.textContent).toContain('Paused');
    expect(toolbar?.textContent).toContain('1');
    expect(host.querySelector('input[aria-label="Search automations"]')).not.toBeNull();
    const allFilter = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('All'));
    const enabledFilter = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Enabled'));
    const pausedFilter = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Paused'));
    expect(allFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(enabledFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(pausedFilter?.getAttribute('aria-pressed')).toBe('false');
    expect(createButton).not.toBeNull();
    expect(document.body.querySelector('[data-studio-automation-drawer]')).toBeNull();
    expect(document.body.querySelector('[data-studio-automation-composer]')).toBeNull();
    expect(automationList).not.toBeNull();
    expect(seededCard?.className).toContain('group relative grid');
    expect(seededCard?.className).toContain('border-t');
    expect(seededCard?.className).toContain('lg:grid-cols-');
    expect(seededCard?.className).not.toContain('rounded-xl');
    expect(seededCard?.className).not.toContain('bg-card/45');
    expect(seededCard?.textContent).toContain('Pi schedule');
    expect(seededCard?.textContent).not.toContain('Local plan');

    await act(async () => {
      enabledFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(enabledFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('Daily research radar');
    expect(host.textContent).not.toContain('Inbox cleanup review');
    expect(host.textContent).toContain('Release note sweep');

    await act(async () => {
      pausedFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(pausedFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).not.toContain('Daily research radar');
    expect(host.textContent).toContain('Inbox cleanup review');
    expect(host.textContent).not.toContain('Release note sweep');

    await act(async () => {
      allFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(allFilter?.getAttribute('aria-pressed')).toBe('true');

    await setInputValue('input[aria-label="Search automations"]', 'inbox');
    expect(toolbar?.textContent).toContain('All1');
    expect(toolbar?.textContent).toContain('Enabled0');
    expect(toolbar?.textContent).toContain('Paused1');
    expect(host.textContent).not.toContain('Daily research radar');
    expect(host.textContent).toContain('Inbox cleanup review');
    expect(host.textContent).not.toContain('Release note sweep');

    await act(async () => {
      enabledFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('No enabled automations match this search.');
    expect(host.querySelector('[data-studio-automation-card]')).toBeNull();

    await act(async () => {
      allFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await setInputValue('input[aria-label="Search automations"]', 'claude');
    expect(host.textContent).not.toContain('Daily research radar');
    expect(host.textContent).not.toContain('Inbox cleanup review');
    expect(host.textContent).toContain('Release note sweep');

    await setInputValue('input[aria-label="Search automations"]', 'no matching automation');
    expect(host.textContent).toContain('No automations match this search.');
    expect(host.querySelector('[data-studio-automation-card]')).toBeNull();

    await setInputValue('input[aria-label="Search automations"]', '');
    expect(host.textContent).toContain('Daily research radar');
    expect(host.textContent).toContain('Inbox cleanup review');
    expect(host.textContent).toContain('Release note sweep');

    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const composer = document.body.querySelector('[data-studio-automation-composer]');
    expect(document.body.querySelector('[data-studio-automation-drawer]')).not.toBeNull();
    expect(host.querySelector('[data-studio-automation-drawer]')).toBeNull();
    expect(composer).not.toBeNull();
    expect(composer?.className).toContain('fixed bottom-0 right-0 top-[calc(var(--app-titlebar-h)+52px)]');
    expect(composer?.className).toContain('md:top-[var(--app-titlebar-h)]');
    expect(composer?.textContent).toContain('Repeats');
    expect(composer?.textContent).toContain('Every day 9:00 AM');
    expect(composer?.textContent).toContain('Interval');
    expect(composer?.textContent).toContain('Advanced settings');
    expect(document.body.querySelector('[data-studio-automation-advanced]')).not.toBeNull();

    const everyFourHours = composer!.querySelector('[data-studio-automation-repeat-option="every-4-hours"]');
    expect(everyFourHours).toBeNull();

    const intervalTab = Array.from(composer!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Interval')
    ));
    expect(intervalTab).not.toBeNull();
    await act(async () => {
      intervalTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const everyFourHoursOption = document.body.querySelector('[data-studio-automation-repeat-option="every-4-hours"]');
    expect(everyFourHoursOption).not.toBeNull();
    await act(async () => {
      everyFourHoursOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await setInputValue('input[aria-label="Automation title"]', 'Release readiness sweep');
    await setInputValue(
      'textarea[aria-label="Automation prompt"]',
      'Every morning, review open release notes and summarize blockers.',
    );

    const createAutomationButton = Array.from(composer!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Create automation')
    ));
    expect(createAutomationButton).not.toBeNull();

    await act(async () => {
      createAutomationButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(host.textContent).toContain('Release readiness sweep');
    expect(host.textContent).toContain('Every morning, review open release notes and summarize blockers.');
    expect(host.textContent).toContain('Every 4 hours');
    expect(document.body.querySelector('[data-studio-automation-drawer]')).toBeNull();

    const releaseCard = Array.from(host.querySelectorAll('[data-studio-automation-card]')).find((card) => (
      card.textContent?.includes('Release readiness sweep')
    ));
    expect(releaseCard).not.toBeNull();

    const editButton = Array.from(releaseCard!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Edit')
    ));
    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.querySelector('[data-studio-automation-drawer]')).not.toBeNull();
    await setInputValue('input[aria-label="Automation title"]', 'Release signal sweep');

    const saveButton = Array.from(document.body.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Save changes')
    ));
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(host.textContent).toContain('Release signal sweep');
    expect(host.textContent).not.toContain('Release readiness sweep');
    expect(document.body.querySelector('[data-studio-automation-drawer]')).toBeNull();

    const updatedCard = Array.from(host.querySelectorAll('[data-studio-automation-card]')).find((card) => (
      card.textContent?.includes('Release signal sweep')
    ));
    expect(updatedCard).not.toBeNull();

    const pauseButton = Array.from(updatedCard!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Pause')
    ));
    expect(pauseButton).not.toBeNull();

    await act(async () => {
      pauseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(updatedCard!.textContent).toContain('Paused');
    expect(Array.from(updatedCard!.querySelectorAll('button')).some((button) => button.textContent?.includes('Resume'))).toBe(true);
  });

  it('prevents creating an automation without a prompt', async () => {
    await renderStudioAutomation();

    const createButton = host.querySelector('[data-studio-automation-create]');
    expect(createButton).not.toBeNull();
    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await setInputValue('input[aria-label="Automation title"]', 'Empty automation');

    const composer = document.body.querySelector('[data-studio-automation-composer]');
    expect(composer).not.toBeNull();

    const createAutomationButton = Array.from(composer!.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Create automation')
    ));
    expect(createAutomationButton).not.toBeNull();

    await act(async () => {
      createAutomationButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).toContain('Add a prompt before creating an automation.');
    expect(host.textContent).not.toContain('Empty automationActive');
  });
});
