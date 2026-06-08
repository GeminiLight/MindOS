export type PanelId = 'files' | 'capture' | 'search' | 'echo' | 'agents' | 'discover' | 'workflows';

export type RoutePanelId = Extract<PanelId, 'files' | 'capture' | 'echo' | 'agents' | 'discover'>;

export interface RailPanelClickDecision {
  nextPanel: PanelId | null;
  preventDefault: boolean;
}

export const ROUTE_PANEL_HREF: Record<RoutePanelId, string> = {
  files: '/wiki',
  capture: '/capture',
  echo: '/echo/about-you',
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
