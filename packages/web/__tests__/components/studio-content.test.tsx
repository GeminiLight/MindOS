// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioContent from '@/components/studio/StudioContent';
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

async function renderStudio() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<StudioContent />);
  });
}

async function setInputValue(selector: string, value: string) {
  const input = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
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
  });

  it('renders Studio as a Project-first surface', async () => {
    await renderStudio();

    expect(host.textContent).toContain('New Project');
    expect(host.textContent).toContain('Projects');
    expect(host.textContent).not.toContain('Project practice');
    expect(host.textContent).not.toContain('Recent Projects');
    expect(host.textContent).not.toContain('New session');
    expect(host.querySelector('a[href="/studio/launch-practice"]')).not.toBeNull();
    expect(host.querySelector('[data-content-page-shell="studio"]')?.className).toContain('workbench-content-page');
    expect(host.querySelector('aside[aria-label="Studio"]')).toBeNull();
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
    expect(firstContext?.textContent).not.toContain('Work dir');
    expect(firstContext?.textContent).not.toContain('Mind Space');
    expect(firstContext?.textContent).not.toContain('AI Kit');
    expect(firstContext?.querySelector('[title="Work dir"]')).not.toBeNull();
    expect(firstContext?.querySelector('[title="Mind Space"]')).not.toBeNull();
    expect(firstContext?.querySelector('[title="AI Kit"]')).not.toBeNull();
    expect(firstContext?.querySelectorAll('[data-studio-context-chip]').length).toBeGreaterThanOrEqual(3);
    expect(firstContext?.querySelector('.border-l')).toBeNull();
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

  it('renders the unified Studio panel with Overview and Projects', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(<StudioPanel active />);
    });

    expect(host.textContent).toContain('Overview');
    expect(host.textContent).toContain('Projects');
    const overview = host.querySelector('a[href="/studio"]');
    expect(overview).not.toBeNull();
    expect(overview?.className).toContain('gap-3');
    expect(overview?.className).toContain('px-4');
    expect(overview?.className).toContain('py-2.5');
    expect(host.querySelector('a[href="/studio/launch-practice"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Research Kit');
    expect(host.textContent).not.toContain('2 Sessions');
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
});
