// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { getActiveSessionId, resetSession } from '@/lib/agent-session-store';
import { setMessages } from '@/lib/agent-run-store';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const }),
}));

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return {
    host,
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Studio Project UI', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPush.mockClear();
  });

  it('renders the Studio page as a Project-first surface', async () => {
    const StudioContent = (await import('@/components/studio/StudioContent')).default;
    const view = await render(<StudioContent />);

    expect(view.host.textContent).toContain('New Project');
    expect(view.host.textContent).not.toContain('Recent Projects');
    expect(view.host.textContent).toContain('Projects carry context');
    expect(view.host.textContent).toContain('Launch Practice');
    expect(view.host.textContent).not.toContain('Start from a setup');
    expect(view.host.textContent).not.toContain('Suggested setup');
    expect(view.host.querySelector('[data-content-page-shell="studio"]')?.className).toContain('workbench-content-page');

    const launchLink = view.host.querySelector<HTMLAnchorElement>('a[href="/studio/launch-practice"]');
    expect(launchLink).not.toBeNull();
    expect(view.host.querySelector('a[href="/chat/new"]')).toBeNull();

    await view.cleanup();
  });

  it('renders Project detail with Goal and Project defaults without a redundant overview block', async () => {
    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const view = await render(<StudioProjectContent projectId="launch-practice" />);

    expect(localStorage.getItem('mindos:studio-last-opened-project-id')).toBe('launch-practice');
    expect(view.host.textContent).toContain('Launch Practice');
    expect(view.host.textContent).toContain('WorkDir');
    expect(view.host.textContent).toContain('Goal');
    expect(view.host.textContent).not.toContain('Overview');
    expect(view.host.textContent).not.toContain('Goal and context defaults');
    expect(view.host.textContent).not.toContain('Progress');
    expect(view.host.textContent).not.toContain('Cadence');
    expect(view.host.querySelector('[data-studio-project-overview-context]')).not.toBeNull();
    expect(view.host.textContent).toContain('Session history');
    expect(view.host.textContent).toContain('Launch brief review');
    expect(view.host.textContent).toContain('Product Strategy');
    expect(view.host.textContent).toContain('Research Kit');
    expect(view.host.textContent).toContain('Mind');
    expect(view.host.querySelector('input[placeholder="Search title, artifact, or summary"]')).not.toBeNull();
    expect(view.host.querySelector('select')).not.toBeNull();
    expect(view.host.querySelector('[data-stable-row-trailing]')).not.toBeNull();
    const sessionRow = view.host.querySelector('[data-studio-session-row]');
    const sessionRowClasses = sessionRow?.getAttribute('class')?.split(/\s+/) ?? [];
    expect(sessionRowClasses.some(className => className.startsWith('xl:grid-cols-'))).toBe(true);
    expect(sessionRowClasses.some(className => className.startsWith('md:grid-cols-'))).toBe(false);
    expect(view.host.querySelector<HTMLAnchorElement>('a[href*="title=Launch+brief+review"]')).not.toBeNull();

    const newSession = view.host.querySelector<HTMLAnchorElement>('a[href="/chat/new?projectId=launch-practice"]');
    expect(newSession).not.toBeNull();
    expect(view.host.querySelectorAll<HTMLAnchorElement>('a[href="/chat/new?projectId=launch-practice"]')).toHaveLength(1);

    await view.cleanup();
  });

  it('uses real workspace Spaces as Project defaults from the Project overview', async () => {
    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const { findStudioProject, getStudioProjectSpaceRefs, readStudioProjects } = await import('@/lib/studio-projects');
    const view = await render(
      <StudioProjectContent
        projectId="launch-practice"
        workspaceSpaces={[
          {
            name: 'Customer Research',
            path: 'Customer Research/',
            fileCount: 3,
            description: 'Interview notes',
          },
        ]}
      />,
    );

    const addSpace = view.host.querySelector<HTMLButtonElement>('button[aria-label="Add Space"]');
    expect(addSpace).not.toBeNull();

    await act(async () => {
      addSpace!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const search = view.host.querySelector<HTMLInputElement>('input[aria-label="Search Spaces"]');
    expect(search).not.toBeNull();
    await setInputValue(search!, 'Customer');

    const workspaceOption = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.includes('Customer Research')
    ));
    expect(workspaceOption).not.toBeNull();
    expect(workspaceOption?.textContent).toContain('Interview notes');

    await act(async () => {
      workspaceOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const updatedProject = findStudioProject(readStudioProjects(), 'launch-practice');
    expect(getStudioProjectSpaceRefs(updatedProject!, 'en')).toEqual([
      { path: 'Product Strategy', label: 'Product Strategy', source: 'project-default' },
      { path: 'Customer Research', label: 'Customer Research', icon: 'C', source: 'filesystem' },
    ]);

    await view.cleanup();
  });

  it('closes the context picker on outside click and keeps Create Space wired to the Space flow', async () => {
    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const createSpaceEvents: Event[] = [];
    const handler = (event: Event) => createSpaceEvents.push(event);
    window.addEventListener('mindos:create-space', handler);
    const view = await render(<StudioProjectContent projectId="launch-practice" />);

    const addSpace = view.host.querySelector<HTMLButtonElement>('button[aria-label="Add Space"]');
    expect(addSpace).not.toBeNull();

    await act(async () => {
      addSpace!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.host.querySelector('[data-context-token-picker="studio-project-spaces"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(view.host.querySelector('[data-context-token-picker="studio-project-spaces"]')).toBeNull();

    await act(async () => {
      addSpace!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const createSpace = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.includes('Create Space')
    ));
    expect(createSpace).not.toBeNull();

    await act(async () => {
      createSpace!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createSpaceEvents).toHaveLength(1);
    expect(view.host.querySelector('[data-context-token-picker="studio-project-spaces"]')).toBeNull();

    window.removeEventListener('mindos:create-space', handler);
    await view.cleanup();
  });

  it('edits Project Space defaults directly from the Project overview', async () => {
    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const { findStudioProject, getStudioProjectSpaceRefs, readStudioProjects } = await import('@/lib/studio-projects');
    const view = await render(<StudioProjectContent projectId="launch-practice" />);

    const removeProductStrategy = view.host.querySelector<HTMLButtonElement>('button[aria-label="Remove Product Strategy"]');
    expect(removeProductStrategy).not.toBeNull();

    await act(async () => {
      removeProductStrategy!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const project = findStudioProject(readStudioProjects(), 'launch-practice');
    expect(project).toBeTruthy();
    expect(getStudioProjectSpaceRefs(project!, 'en')).toEqual([]);
    expect(view.host.querySelector('[data-studio-project-overview-context]')?.textContent).not.toContain('Product Strategy');

    const addSpace = view.host.querySelector<HTMLButtonElement>('button[aria-label="Add Space"]');
    expect(addSpace).not.toBeNull();

    await act(async () => {
      addSpace!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const search = view.host.querySelector<HTMLInputElement>('input[aria-label="Search Spaces"]');
    expect(search).not.toBeNull();
    await setInputValue(search!, '法');

    const faOption = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.includes('法')
    ));
    expect(faOption).not.toBeNull();

    await act(async () => {
      faOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const updatedProject = findStudioProject(readStudioProjects(), 'launch-practice');
    expect(getStudioProjectSpaceRefs(updatedProject!, 'en').map((space) => space.path)).toEqual(['MIND_FA']);

    await view.cleanup();
  });

  it('filters Project Sessions by agent without changing the row chrome contract', async () => {
    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const view = await render(<StudioProjectContent projectId="launch-practice" />);

    const filter = view.host.querySelector('select') as HTMLSelectElement | null;
    expect(filter).not.toBeNull();

    await act(async () => {
      filter!.value = 'codex';
      filter!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(view.host.textContent).toContain('Launch brief review');
    expect(view.host.textContent).not.toContain('Pricing evidence pass');
    expect(view.host.querySelectorAll('[data-stable-row-trailing]')).toHaveLength(1);

    await view.cleanup();
  });

  it('shows real Project-scoped Chat sessions before seed fallback sessions', async () => {
    resetSession({ projectId: 'launch-practice' });
    const id = getActiveSessionId();
    expect(id).toBeTruthy();
    setMessages(id!, [
      { role: 'user', content: 'Prepare the investor launch memo', timestamp: Date.now() },
      { role: 'assistant', content: 'Drafted launch memo outline with source gaps.', timestamp: Date.now() },
    ], { skipPersist: true });

    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const view = await render(<StudioProjectContent projectId="launch-practice" />);

    expect(view.host.textContent).toContain('Prepare the investor launch memo');
    expect(view.host.textContent).toContain('Drafted launch memo outline with source gaps.');
    expect(view.host.textContent).toContain('Chat session');
    expect(view.host.querySelector<HTMLAnchorElement>(`a[href="/chat/${encodeURIComponent(id!)}"]`)).not.toBeNull();

    await view.cleanup();
  });

  it('shows a recoverable state for unknown Project routes', async () => {
    const StudioProjectContent = (await import('@/components/studio/StudioProjectContent')).default;
    const view = await render(<StudioProjectContent projectId="missing-project" />);

    expect(view.host.textContent).toContain('Project not found');
    expect(view.host.querySelector<HTMLAnchorElement>('a[href="/studio"]')).not.toBeNull();

    await view.cleanup();
  });
});
