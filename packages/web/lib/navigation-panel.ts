export type PanelId = 'files' | 'capture' | 'search' | 'echo' | 'agents' | 'discover' | 'workflows';

export type RoutePanelId = Extract<PanelId, 'files' | 'capture' | 'echo' | 'agents' | 'discover'>;

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

export const ROUTE_PANEL_HREF: Record<RoutePanelId, string> = {
  files: '/wiki',
  capture: '/capture',
  // Must be a valid echo segment (see ECHO_SEGMENT_IDS) — 'about-you' is not
  // one, so '/echo/about-you' 404s via app/echo/[segment] notFound().
  echo: '/echo/imprint',
  agents: '/agents',
  discover: '/explore',
};

function isRouteSegment(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
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
  if (isRouteSegment(pathname, '/explore')) return 'discover';
  if (isRouteSegment(pathname, '/echo')) return 'echo';
  if (isRouteSegment(pathname, '/capture') || isLegacyInboxContentRoute(pathname)) return 'capture';
  return null;
}

export function isNeutralContentRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return isRouteSegment(pathname, '/settings') || isRouteSegment(pathname, '/trash');
}

export function getRouteControlledPanel(pathname: string | null | undefined): PanelId | null {
  const panel = getContentRoutePanel(pathname);
  return panel === 'files' ? null : panel;
}

export function getActiveLeftPanel(
  pathname: string | null | undefined,
  localActivePanel: PanelId | null,
): PanelId | null {
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

export function getEffectivePanelMaximized(
  activeLeftPanel: PanelId | null,
  localActivePanel: PanelId | null,
  localPanelMaximized: boolean,
): boolean {
  return activeLeftPanel === localActivePanel && localPanelMaximized;
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
  activePanel: PanelId | null,
  targetPanel: RoutePanelId,
): RailPanelClickDecision {
  const onTargetRoute = isContentRouteForPanel(pathname, targetPanel);
  const targetIsActive = activePanel === targetPanel;

  if (onTargetRoute) {
    if (targetPanel === 'files' && targetIsActive) {
      return { nextPanel: null, preventDefault: true };
    }
    return { nextPanel: targetPanel, preventDefault: true };
  }

  return { nextPanel: targetPanel, preventDefault: false };
}
