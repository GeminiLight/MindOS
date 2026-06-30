// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { useAskPanel, type AskPanelState } from '@/hooks/useAskPanel';
import { closeAskModal, openAskModal, useAskModal } from '@/hooks/useAskModal';

const navState = vi.hoisted(() => ({
  pathname: '/wiki',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
}));

const latestState = { current: null as AskPanelState | null };

function Probe() {
  const state = useAskPanel();
  const askModal = useAskModal();
  latestState.current = state;
  return (
    <div
      data-ask-open={state.askPanelOpen ? 'true' : 'false'}
      data-popup-open={state.desktopAskPopupOpen ? 'true' : 'false'}
      data-modal-store-open={askModal.open ? 'true' : 'false'}
    />
  );
}

function renderProbe(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(<Probe />);
  });

  return { host, root };
}

describe('useAskPanel full-page chat guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    closeAskModal();
    latestState.current = null;
    navState.pathname = '/wiki';
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('opens from direct toggle and dock event on regular content routes', () => {
    const { host, root } = renderProbe();
    const probe = host.querySelector('div');

    act(() => {
      latestState.current?.toggleAskPanel();
    });
    expect(probe?.getAttribute('data-ask-open')).toBe('true');

    act(() => {
      latestState.current?.closeAskPanel();
    });
    expect(probe?.getAttribute('data-ask-open')).toBe('false');

    act(() => {
      window.dispatchEvent(new CustomEvent('mindos:open-ask-panel'));
    });
    expect(probe?.getAttribute('data-ask-open')).toBe('true');

    act(() => root.unmount());
  });

  it('restores the last non-focus width when Focus was entered from a drag snapshot', () => {
    const { root } = renderProbe();

    act(() => {
      latestState.current?.handleAskWidthChange(760);
    });
    expect(latestState.current?.askPanelWidth).toBe(760);

    act(() => {
      latestState.current?.toggleAskMaximized(420);
    });
    expect(latestState.current?.askMaximized).toBe(true);

    act(() => {
      latestState.current?.toggleAskMaximized();
    });
    expect(latestState.current?.askMaximized).toBe(false);
    expect(latestState.current?.askPanelWidth).toBe(420);

    act(() => root.unmount());
  });

  it('refuses direct toggle but preserves dock intent on full-page chat routes', () => {
    navState.pathname = '/chat/session-123';
    const { host, root } = renderProbe();
    const probe = host.querySelector('div');

    act(() => {
      latestState.current?.toggleAskPanel();
    });
    expect(probe?.getAttribute('data-ask-open')).toBe('false');

    act(() => {
      window.dispatchEvent(new CustomEvent('mindos:open-ask-panel'));
    });
    expect(probe?.getAttribute('data-ask-open')).toBe('true');

    navState.pathname = '/wiki';
    act(() => {
      root.render(<Probe />);
    });
    expect(probe?.getAttribute('data-ask-open')).toBe('true');

    act(() => root.unmount());
  });

  it('closes useAskModal bridge requests instead of opening panel chrome on full-page chat routes', async () => {
    navState.pathname = '/chat/session-123';
    const { host, root } = renderProbe();
    const probe = host.querySelector('div');

    await act(async () => {
      openAskModal('hello from bridge');
      await Promise.resolve();
    });

    expect(probe?.getAttribute('data-ask-open')).toBe('false');
    expect(probe?.getAttribute('data-popup-open')).toBe('false');
    expect(probe?.getAttribute('data-modal-store-open')).toBe('false');

    act(() => root.unmount());
  });

  it('opens the Ask panel from a bridge request on regular content routes', async () => {
    const { host, root } = renderProbe();
    const probe = host.querySelector('div');

    await act(async () => {
      openAskModal('continue from this Echo card', 'user', null, { newSession: true });
      await Promise.resolve();
    });

    expect(probe?.getAttribute('data-ask-open')).toBe('true');
    expect(probe?.getAttribute('data-popup-open')).toBe('false');
    expect(probe?.getAttribute('data-modal-store-open')).toBe('false');
    expect(latestState.current?.askInitialMessage).toBe('continue from this Echo card');
    expect(latestState.current?.askNewSession).toBe(true);
    expect(latestState.current?.askOpenRequestId).toBeGreaterThan(0);

    act(() => root.unmount());
  });

  it('keeps SidebarLayout render output gated on full-page chat before effects close stale state', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'components/SidebarLayout.tsx'), 'utf-8');

    expect(source).toContain('const effectiveAskPanelOpen = !isFullPageChatRoute && ap.askPanelOpen');
    expect(source).toContain('const effectiveDesktopAskPopupOpen = !isFullPageChatRoute && ap.desktopAskPopupOpen');
    expect(source).toContain('const effectiveMobileAskOpen = !isFullPageChatRoute && mobileAskOpen');
    expect(source).toContain('<RightAskPanel\n          open={effectiveAskPanelOpen}');
    expect(source).toContain('<AskModal\n          open={effectiveDesktopAskPopupOpen}');
    expect(source).toContain('<AskFab onToggle={ap.toggleAskPanel} askPanelOpen={effectiveAskPanelOpen || effectiveDesktopAskPopupOpen} />');
    expect(source).toContain('<AskModal open={effectiveMobileAskOpen}');
    expect(source).not.toContain('<RightAskPanel\n          open={ap.askPanelOpen}');
    expect(source).not.toContain('<AskModal\n          open={ap.desktopAskPopupOpen}');
    expect(source).not.toContain('<AskModal open={mobileAskOpen}');
  });

  it('does not use the full-page chat guard to collapse the left sidebar panel', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'components/SidebarLayout.tsx'), 'utf-8');

    expect(source).not.toContain('const activeLeftPanel = isFullPageChatRoute');
    expect(source).not.toContain('const railActivePanel = isFullPageChatRoute');
    expect(source).toContain('const derivedActiveLeftPanel = homeNavPending');
    expect(source).toContain('const routePanelSuppressed = shouldSuppressRoutePanel');
    expect(source).toContain('const activeLeftPanel = lp.sidebarExpanded && !routePanelSuppressed ? derivedActiveLeftPanel : null;');
    expect(source).toContain('const railActivePanel = homeNavPending');
  });
});
