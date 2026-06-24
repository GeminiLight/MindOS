import { describe, expect, it } from 'vitest';
import {
  getActiveLeftPanel,
  getContentRoutePanel,
  getEffectivePanelMaximized,
  getHomeClickSidebarExpanded,
  getHomeClickPanel,
  getPendingHomePanel,
  getPendingRoutePanel,
  getRailActivePanel,
  getRailPanelClickDecision,
  getRoutePanelClickSidebarExpanded,
  getRouteControlledPanel,
  getTitlebarSidebarExpandPanel,
  isStudioRoute,
  isNeutralContentRoute,
  recoverStaleCapturePanel,
  recoverStaleRoutePanel,
  ROUTE_PANEL_HREF,
  shouldSuppressRoutePanel,
} from '@/lib/navigation-panel';

describe('navigation panel route recovery', () => {
  it('maps content routes to their matching rail panels', () => {
    expect(getContentRoutePanel('/wiki')).toBe('files');
    expect(getContentRoutePanel('/view/Notes/example.md')).toBe('files');
    expect(getContentRoutePanel('/capture')).toBe('capture');
    expect(getContentRoutePanel('/capture/history')).toBe('capture');
    expect(getContentRoutePanel('/inbox/history')).toBe('capture');
    expect(getContentRoutePanel('/agents')).toBe('agents');
    expect(getContentRoutePanel('/agents/codex')).toBe('agents');
    expect(getContentRoutePanel('/studio')).toBe('studio');
    expect(getContentRoutePanel('/studio/launch-practice')).toBe('studio');
    expect(getContentRoutePanel('/explore')).toBe('discover');
    expect(getContentRoutePanel('/explore/capabilities')).toBe('discover');
    expect(getContentRoutePanel('/explore/mcp')).toBe('discover');
    expect(getContentRoutePanel('/explore/plugins')).toBe('discover');
    expect(getContentRoutePanel('/echo/about-you')).toBe('echo');
  });

  it('keeps route panel hrefs aligned with real entry routes', () => {
    expect(ROUTE_PANEL_HREF.files).toBe('/wiki');
    expect(ROUTE_PANEL_HREF.capture).toBe('/capture');
    expect(ROUTE_PANEL_HREF.echo).toBe('/echo/overview');
    expect(ROUTE_PANEL_HREF.agents).toBe('/agents');
    expect(ROUTE_PANEL_HREF.studio).toBe('/studio');
    expect(ROUTE_PANEL_HREF.discover).toBe('/explore');
  });

  it('does not treat route name prefixes as panel routes', () => {
    expect(getContentRoutePanel('/agents-old')).toBeNull();
    expect(getContentRoutePanel('/explorer')).toBeNull();
    expect(getContentRoutePanel('/echoes')).toBeNull();
    expect(getContentRoutePanel('/capture-old')).toBeNull();
    expect(getContentRoutePanel('/studio-old')).toBeNull();
    expect(getContentRoutePanel('/inbox')).toBeNull();
    expect(getContentRoutePanel('/inbox/history/old')).toBeNull();
    expect(getContentRoutePanel('/inbox-old')).toBeNull();
    expect(getContentRoutePanel('/wiki-old')).toBeNull();
    expect(getContentRoutePanel('/view')).toBeNull();
    expect(getContentRoutePanel('/view-old')).toBeNull();
  });

  it('marks full-page utility routes as neutral left-panel routes', () => {
    expect(isNeutralContentRoute('/settings')).toBe(true);
    expect(isNeutralContentRoute('/settings/sync')).toBe(true);
    expect(isNeutralContentRoute('/trash')).toBe(true);
    expect(isNeutralContentRoute('/trash/expired')).toBe(true);
    expect(isNeutralContentRoute('/studio')).toBe(false);
    expect(isNeutralContentRoute('/studio/launch-practice')).toBe(false);
    expect(isNeutralContentRoute('/wiki')).toBe(false);
    expect(isNeutralContentRoute('/settings-old')).toBe(false);
    expect(isNeutralContentRoute('/studio-old')).toBe(false);
  });

  it('matches Studio routes with segment boundaries', () => {
    expect(isStudioRoute('/studio')).toBe(true);
    expect(isStudioRoute('/studio/launch-practice')).toBe(true);
    expect(isStudioRoute('/studio-old')).toBe(false);
    expect(isStudioRoute('/studios')).toBe(false);
  });

  it('only route-controls workbench panels that must match their content route', () => {
    expect(getRouteControlledPanel('/wiki')).toBeNull();
    expect(getRouteControlledPanel('/view/Notes/example.md')).toBeNull();
    expect(getRouteControlledPanel('/capture')).toBe('capture');
    expect(getRouteControlledPanel('/agents')).toBe('agents');
    expect(getRouteControlledPanel('/studio')).toBe('studio');
    expect(getRouteControlledPanel('/studio/launch-practice')).toBe('studio');
    expect(getRouteControlledPanel('/explore')).toBe('discover');
    expect(getRouteControlledPanel('/explore/capabilities')).toBe('discover');
    expect(getRouteControlledPanel('/explore/mcp')).toBe('discover');
    expect(getRouteControlledPanel('/explore/plugins')).toBe('discover');
    expect(getRouteControlledPanel('/echo/about-you')).toBe('echo');
  });

  it('uses route panels as defaults while allowing utility panels to temporarily override them', () => {
    expect(getActiveLeftPanel('/', null)).toBeNull();
    expect(getActiveLeftPanel('/', 'files')).toBe('home');
    expect(getActiveLeftPanel('/', 'capture')).toBe('home');
    expect(getActiveLeftPanel('/', 'home')).toBe('home');
    expect(getActiveLeftPanel('/', 'search')).toBe('search');
    expect(getActiveLeftPanel('/agents', null)).toBe('agents');
    expect(getActiveLeftPanel('/agents', 'files')).toBe('agents');
    expect(getActiveLeftPanel('/agents', 'search')).toBe('search');
    expect(getActiveLeftPanel('/agents', 'workflows')).toBe('workflows');
    expect(getActiveLeftPanel('/studio', null)).toBe('studio');
    expect(getActiveLeftPanel('/studio/launch-practice', 'agents')).toBe('studio');
    expect(getActiveLeftPanel('/wiki', null)).toBeNull();
    expect(getActiveLeftPanel('/wiki', 'files')).toBe('files');
  });

  it('keeps full-page chat routes from changing the current left sidebar state', () => {
    expect(getActiveLeftPanel('/chat/new', null)).toBeNull();
    expect(getActiveLeftPanel('/chat/new', 'files')).toBe('files');
    expect(getActiveLeftPanel('/chat/session-123', 'home')).toBe('home');
    expect(getActiveLeftPanel('/chat/session-123', 'studio')).toBe('studio');
    expect(getRailActivePanel('/chat/session-123', 'files')).toBe('files');
  });

  it('lets the titlebar restore the most relevant sidebar panel', () => {
    expect(getTitlebarSidebarExpandPanel('/', 'files')).toBe('home');
    expect(getTitlebarSidebarExpandPanel('/studio/launch-practice', 'files')).toBe('studio');
    expect(getTitlebarSidebarExpandPanel('/agents', 'files')).toBe('agents');
    expect(getTitlebarSidebarExpandPanel('/view/Notes/example.md', null)).toBe('files');
    expect(getTitlebarSidebarExpandPanel('/chat/session-123', 'studio')).toBe('studio');
    expect(getTitlebarSidebarExpandPanel('/settings', 'search')).toBe('files');
  });

  it('can suppress route-owned panels without losing their rail highlight', () => {
    expect(shouldSuppressRoutePanel('/studio', 'studio', null, 'studio')).toBe(true);
    expect(shouldSuppressRoutePanel('/agents/codex', 'agents', 'files', 'agents')).toBe(true);
    expect(shouldSuppressRoutePanel('/studio', 'search', 'search', 'studio')).toBe(false);
    expect(shouldSuppressRoutePanel('/studio', 'studio', null, 'agents')).toBe(false);
    expect(getRailActivePanel('/studio', null)).toBe('studio');
  });

  it('clears stale workbench panels on neutral routes while preserving utility panels', () => {
    expect(getActiveLeftPanel('/settings', 'files')).toBeNull();
    expect(getActiveLeftPanel('/settings', 'agents')).toBeNull();
    expect(getActiveLeftPanel('/trash', 'capture')).toBeNull();
    expect(getActiveLeftPanel('/trash', 'search')).toBe('search');
    expect(getActiveLeftPanel('/settings', 'workflows')).toBe('workflows');
    expect(getRailActivePanel('/settings', 'files')).toBeNull();
  });

  it('recovers the Files panel when a pending Inbox navigation later commits to Wiki', () => {
    expect(recoverStaleCapturePanel('/wiki', 'capture')).toBe('files');
    expect(recoverStaleCapturePanel('/view/Notes/example.md', 'capture')).toBe('files');
  });

  it('recovers sibling destination panels when leaving Inbox', () => {
    expect(recoverStaleCapturePanel('/agents', 'capture')).toBe('agents');
    expect(recoverStaleCapturePanel('/studio', 'capture')).toBe('studio');
    expect(recoverStaleCapturePanel('/explore', 'capture')).toBe('discover');
    expect(recoverStaleCapturePanel('/explore/capabilities', 'capture')).toBe('discover');
    expect(recoverStaleCapturePanel('/explore/mcp', 'capture')).toBe('discover');
    expect(recoverStaleCapturePanel('/explore/plugins', 'capture')).toBe('discover');
    expect(recoverStaleCapturePanel('/echo/about-you', 'capture')).toBe('echo');
  });

  it('recovers any stale route-owned panel when the destination route commits', () => {
    expect(recoverStaleRoutePanel('/capture', 'agents')).toBe('capture');
    expect(recoverStaleRoutePanel('/agents', 'discover')).toBe('agents');
    expect(recoverStaleRoutePanel('/studio', 'agents')).toBe('studio');
    expect(recoverStaleRoutePanel('/explore', 'echo')).toBe('discover');
  });

  it('keeps the legacy Capture recovery wrapper scoped to Capture state', () => {
    expect(recoverStaleCapturePanel('/agents', 'discover')).toBeUndefined();
    expect(recoverStaleRoutePanel('/agents', 'discover')).toBe('agents');
  });

  it('does not reopen panels the user already closed or replace utility panels', () => {
    expect(recoverStaleCapturePanel('/wiki', null)).toBeUndefined();
    expect(recoverStaleRoutePanel('/wiki', 'search')).toBeUndefined();
    expect(recoverStaleRoutePanel('/agents', 'workflows')).toBeUndefined();
    expect(recoverStaleCapturePanel('/capture', 'capture')).toBeUndefined();
  });

  it('keeps route highlight separate from an opened files panel', () => {
    expect(getActiveLeftPanel('/wiki', null)).toBeNull();
    expect(getRailActivePanel('/wiki', null)).toBe('files');
  });

  it('does not inherit a stale local maximize state for route-derived panels', () => {
    expect(getEffectivePanelMaximized('capture', 'files', true)).toBe(false);
    expect(getEffectivePanelMaximized('agents', null, true)).toBe(false);
    expect(getEffectivePanelMaximized(null, 'files', true)).toBe(false);
    expect(getEffectivePanelMaximized('search', 'search', true)).toBe(true);
    expect(getEffectivePanelMaximized('agents', 'agents', false)).toBe(false);
  });

  it('keeps the clicked panel active while its rail navigation is in flight', () => {
    // Click Agents from /capture: pathname has not committed yet — the pending
    // target must win so the panel/rail switch instantly with no width flip.
    const pending = { target: 'agents' as const, fromPathname: '/capture' };
    expect(getPendingRoutePanel('/capture', pending)).toBe('agents');
    expect(getPendingRoutePanel('/capture', pending) ?? getActiveLeftPanel('/capture', 'agents')).toBe('agents');
  });

  it('invalidates the pending rail navigation the moment any route commits', () => {
    const pending = { target: 'agents' as const, fromPathname: '/capture' };
    // Destination committed
    expect(getPendingRoutePanel('/agents', pending)).toBeNull();
    // User navigated somewhere else mid-flight (file tree, back button)
    expect(getPendingRoutePanel('/view/Notes/example.md', pending)).toBeNull();
    expect(getPendingRoutePanel('/wiki', pending)).toBeNull();
  });

  it('ignores pending state that is already satisfied or absent', () => {
    expect(getPendingRoutePanel('/capture', null)).toBeNull();
    // Defensive: a pending entry recorded ON its own target route is a no-op
    expect(getPendingRoutePanel('/agents', { target: 'agents', fromPathname: '/agents' })).toBeNull();
  });

  it('keeps a home navigation intent active until the home route commits', () => {
    const pending = { panel: 'home' as const, fromPathname: '/view/Notes/example.md' };

    expect(getPendingHomePanel('/view/Notes/example.md', pending)).toBe('home');
    expect(getPendingHomePanel('/', pending)).toBeNull();
    expect(getPendingHomePanel('/wiki', pending)).toBeNull();
  });

  it('keeps rail sections inactive whenever home is clicked', () => {
    const panels = [null, 'home', 'files', 'capture', 'search', 'echo', 'agents', 'studio', 'discover', 'workflows'] as const;
    for (const panel of panels) {
      expect(getHomeClickPanel(panel)).toBe('home');
    }
  });

  it('preserves the sidebar preference when the logo navigates home from another route', () => {
    expect(getHomeClickSidebarExpanded('/agents', false)).toBe(false);
    expect(getHomeClickSidebarExpanded('/agents', true)).toBe(true);
    expect(getHomeClickSidebarExpanded('/view/Notes/example.md', false)).toBe(false);
    expect(getHomeClickSidebarExpanded('/', false)).toBe(true);
  });

  it('computes route-backed rail click behavior from one contract', () => {
    expect(getRailPanelClickDecision('/', 'files', 'files')).toEqual({
      nextPanel: 'files',
      preventDefault: false,
    });
    expect(getRailPanelClickDecision('/wiki', 'files', 'files')).toEqual({
      nextPanel: null,
      preventDefault: true,
    });
    expect(getRailPanelClickDecision('/capture', 'capture', 'capture')).toEqual({
      nextPanel: 'capture',
      preventDefault: true,
    });
    expect(getRailPanelClickDecision('/agents/codex', 'agents', 'agents')).toEqual({
      nextPanel: 'agents',
      preventDefault: true,
    });
    expect(getRailPanelClickDecision('/studio/launch-practice', 'studio', 'studio')).toEqual({
      nextPanel: 'studio',
      preventDefault: true,
    });
    expect(getRailPanelClickDecision('/capture', 'capture', 'agents')).toEqual({
      nextPanel: 'agents',
      preventDefault: false,
    });
  });

  it('keeps a collapsed sidebar collapsed while rail navigation changes routes', () => {
    const crossRouteDecision = getRailPanelClickDecision('/capture', null, 'agents');

    expect(crossRouteDecision).toEqual({
      nextPanel: 'agents',
      preventDefault: false,
    });
    expect(getRoutePanelClickSidebarExpanded(false, crossRouteDecision)).toBe(false);
    expect(getRoutePanelClickSidebarExpanded(true, crossRouteDecision)).toBe(true);
  });

  it('uses same-route rail clicks as explicit panel open or close intents', () => {
    const reopenCurrentAgentsDecision = getRailPanelClickDecision('/agents', null, 'agents');
    const closeCurrentFilesDecision = getRailPanelClickDecision('/wiki', 'files', 'files');

    expect(reopenCurrentAgentsDecision).toEqual({
      nextPanel: 'agents',
      preventDefault: true,
    });
    expect(getRoutePanelClickSidebarExpanded(false, reopenCurrentAgentsDecision)).toBe(true);

    expect(closeCurrentFilesDecision).toEqual({
      nextPanel: null,
      preventDefault: true,
    });
    expect(getRoutePanelClickSidebarExpanded(true, closeCurrentFilesDecision)).toBe(false);
  });
});
