export type PanelId = 'home' | 'files' | 'capture' | 'search' | 'echo' | 'agents' | 'studio' | 'apps' | 'discover' | 'workflows';

export type RoutePanelId = Extract<PanelId, 'files' | 'capture' | 'echo' | 'agents' | 'studio' | 'apps' | 'discover'>;

export interface RailPanelClickDecision {
  nextPanel: PanelId | null;
  preventDefault: boolean;
}

/**
 * A rail click that triggers route navigation, recorded until the route
 * commits. While in flight the clicked target must stay the active panel —
 * otherwise the route-derived panel (still the OLD route) wins the
 * derivation, the local/route mismatch flips the panel width source, and the
 * recover effect fights the click: the visible result is the rail-click
 * flicker (width/padding oscillating through several animated values).
 */
export interface PendingRouteNav {
  target: RoutePanelId;
  fromPathname: string;
}

export interface PendingHomeNav {
  panel: PanelId | null;
  fromPathname: string;
}

/**
 * The pending target while its navigation is still in flight, else null.
 * Any pathname change — destination commit, file-tree click, back button —
 * invalidates the pending state in the same render (no stale frame).
 */
export function getPendingRoutePanel(
  pathname: string | null | undefined,
  pending: PendingRouteNav | null,
): RoutePanelId | null {
  if (!pending) return null;
  if (pathname !== pending.fromPathname) return null;
  if (isContentRouteForPanel(pathname, pending.target)) return null;
  return pending.target;
}

export function getPendingHomePanel(
  pathname: string | null | undefined,
  pending: PendingHomeNav | null,
): PanelId | null {
  if (!pending) return null;
  if (pathname !== pending.fromPathname) return null;
  return pending.panel;
}

export const ROUTE_PANEL_HREF: Record<RoutePanelId, string> = {
  files: '/wiki',
  capture: '/capture',
  // Must be a valid echo segment (see ECHO_SEGMENT_IDS) so app/echo/[segment]
  // can validate the route before rendering.
  echo: '/echo/overview',
  agents: '/agents',
  studio: '/studio',
  apps: '/apps',
  discover: '/explore',
};

function isRouteSegment(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isStudioRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return isRouteSegment(pathname, '/studio');
}

export function isAppsRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return isRouteSegment(pathname, '/apps');
}

function isViewContentRoute(pathname: string): boolean {
  return pathname.startsWith('/view/');
}

function isLegacyInboxContentRoute(pathname: string): boolean {
  return pathname === '/inbox/history' || pathname === '/inbox/history/';
}

export function getContentRoutePanel(pathname: string | null | undefined): PanelId | null {
  if (!pathname) return null;
  if (isRouteSegment(pathname, '/wiki') || isViewContentRoute(pathname)) {
    return 'files';
  }
  if (isRouteSegment(pathname, '/agents')) return 'agents';
  if (isStudioRoute(pathname)) return 'studio';
  if (isAppsRoute(pathname)) return 'apps';
  if (isRouteSegment(pathname, '/explore')) return 'discover';
  if (isRouteSegment(pathname, '/echo')) return 'echo';
  if (isRouteSegment(pathname, '/capture') || isLegacyInboxContentRoute(pathname)) return 'capture';
  return null;
}

export function isNeutralContentRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return isRouteSegment(pathname, '/settings') || isRouteSegment(pathname, '/trash');
}

export function getRouteControlledPanel(pathname: string | null | undefined): RoutePanelId | null {
  const panel = getContentRoutePanel(pathname);
  switch (panel) {
    case 'capture':
    case 'echo':
    case 'agents':
    case 'studio':
    case 'apps':
    case 'discover':
      return panel;
    default:
      return null;
  }
}

export function getActiveLeftPanel(
  pathname: string | null | undefined,
  localActivePanel: PanelId | null,
): PanelId | null {
  if (pathname === '/') {
    if (localActivePanel === null) return null;
    if (localActivePanel === 'search' || localActivePanel === 'workflows') return localActivePanel;
    return 'home';
  }
  if (isNeutralContentRoute(pathname)) {
    return localActivePanel === 'search' || localActivePanel === 'workflows' ? localActivePanel : null;
  }
  const routePanel = getRouteControlledPanel(pathname);
  if (!routePanel) return localActivePanel;
  if (localActivePanel === 'search' || localActivePanel === 'workflows') return localActivePanel;
  return routePanel;
}

export function getRailActivePanel(
  pathname: string | null | undefined,
  localActivePanel: PanelId | null,
): PanelId | null {
  return getActiveLeftPanel(pathname, localActivePanel) ?? getContentRoutePanel(pathname);
}

export function getTitlebarSidebarExpandPanel(
  pathname: string | null | undefined,
  lastPanel: PanelId | null,
): PanelId {
  if (pathname === '/') return 'home';
  const routePanel = getContentRoutePanel(pathname);
  if (routePanel) return routePanel;
  if (lastPanel && lastPanel !== 'search' && lastPanel !== 'workflows') return lastPanel;
  return 'files';
}

export function shouldSuppressRoutePanel(
  pathname: string | null | undefined,
  activeLeftPanel: PanelId | null,
  localActivePanel: PanelId | null,
  suppressedRoutePanel: RoutePanelId | null,
): boolean {
  if (!suppressedRoutePanel) return false;
  if (localActivePanel === 'search' || localActivePanel === 'workflows') return false;
  const routePanel = getRouteControlledPanel(pathname);
  return routePanel === suppressedRoutePanel && activeLeftPanel === routePanel;
}

export function getEffectivePanelMaximized(
  activeLeftPanel: PanelId | null,
  localActivePanel: PanelId | null,
  localPanelMaximized: boolean,
): boolean {
  return activeLeftPanel === localActivePanel && localPanelMaximized;
}

export function getHomeClickPanel(_activeLeftPanel: PanelId | null): PanelId {
  return 'home';
}

export function getHomeClickSidebarExpanded(
  pathname: string | null | undefined,
  currentExpanded: boolean,
): boolean {
  return pathname === '/' ? true : currentExpanded;
}

export function recoverStaleCapturePanel(
  pathname: string | null | undefined,
  activePanel: PanelId | null,
): PanelId | undefined {
  if (activePanel !== 'capture') return undefined;
  return recoverStaleRoutePanel(pathname, activePanel);
}

export function recoverStaleRoutePanel(
  pathname: string | null | undefined,
  activePanel: PanelId | null,
): PanelId | undefined {
  if (!activePanel || activePanel === 'search' || activePanel === 'workflows') return undefined;
  const routePanel = getContentRoutePanel(pathname);
  if (!routePanel || routePanel === activePanel) return undefined;
  return routePanel;
}

export function isContentRouteForPanel(
  pathname: string | null | undefined,
  panel: RoutePanelId,
): boolean {
  return getContentRoutePanel(pathname) === panel;
}

export function getRailPanelClickDecision(
  pathname: string | null | undefined,
  _activePanel: PanelId | null,
  targetPanel: RoutePanelId,
): RailPanelClickDecision {
  const onTargetRoute = isContentRouteForPanel(pathname, targetPanel);

  if (onTargetRoute) {
    return { nextPanel: targetPanel, preventDefault: true };
  }

  return { nextPanel: targetPanel, preventDefault: false };
}

export function getRoutePanelClickSidebarExpanded(
  currentExpanded: boolean,
  decision: RailPanelClickDecision,
): boolean {
  if (!decision.preventDefault) return currentExpanded;
  return decision.nextPanel !== null;
}
