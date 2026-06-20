'use client';

import { useState, useEffect, useCallback, useRef, useMemo, startTransition } from 'react';
import { flushSync } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Search, Settings, Menu, X, FolderInput } from 'lucide-react';
import ActivityBar from './ActivityBar';
import TitlebarRow from './TitlebarRow';
import Panel from './Panel';
import MindFileTreeSections from './file-tree/MindFileTreeSections';
import Logo from './Logo';
import AskFab from './AskFab';
import PluginEntriesDock from './plugins/PluginEntriesDock';
import PluginHotkeyHost from './plugins/PluginHotkeyHost';
import SyncPopover from './panels/SyncPopover';
import KeyboardShortcuts from './KeyboardShortcuts';
import ChangesBanner from './changes/ChangesBanner';
import SpaceInitToast from './SpaceInitToast';
import OrganizeToast from './OrganizeToast';
import { getMobileSyncLabel, MobileSyncDot, useSyncStatus } from './SyncStatusBar';
import { FileNode } from '@/lib/types';
import type { MindSystemSlot } from '@/lib/mind-system';
import { useLocale } from '@/lib/stores/locale-store';
import { telemetry } from '@/lib/telemetry';
import { notifyFilesChanged } from '@/lib/files-changed';
import dynamic from 'next/dynamic';

const SearchModal = dynamic(() => import('./SearchModal'), { ssr: false });
const AskModal = dynamic(() => import('./AskModal'), { ssr: false });
const SettingsModal = dynamic(() => import('./SettingsModal'), { ssr: false });
const CreateSpaceModal = dynamic(() => import('./CreateSpaceModal'), { ssr: false });
const ImportModal = dynamic(() => import('./ImportModal'), { ssr: false });
import McpStoreInit from '@/lib/stores/McpStoreInit';
import WalkthroughInit from '@/lib/stores/WalkthroughInit';
import '@/lib/renderers/index'; // client-side renderer registration source of truth
import { useLeftPanel } from '@/hooks/useLeftPanel';
import { useAskPanel } from '@/hooks/useAskPanel';
import { useAiOrganize } from '@/hooks/useAiOrganize';
import { useInboxOrganizeController } from '@/hooks/useInboxOrganizeController';
import { shouldHandleSmoothNavigation, useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { InboxOrganizeProvider } from '@/components/inbox/InboxOrganizeContext';
import { quickDropToInbox } from '@/lib/inbox-upload';
import {
  COMMAND_CENTER_OPEN_EVENT,
  PLUGIN_ENTRIES_STATE_EVENT,
  requestPluginEntriesOpen,
  type PluginEntriesStateDetail,
} from '@/lib/plugins/ui-events';
import {
  ROUTE_PANEL_HREF,
  getActiveLeftPanel,
  getContentRoutePanel,
  getEffectivePanelMaximized,
  getHomeClickPanel,
  getPendingHomePanel,
  getPendingRoutePanel,
  getRailActivePanel,
  getRailPanelClickDecision,
  getRouteControlledPanel,
  getTitlebarSidebarExpandPanel,
  isNeutralContentRoute,
  recoverStaleRoutePanel,
  shouldSuppressRoutePanel,
  type PanelId,
  type PendingHomeNav,
  type PendingRouteNav,
  type RoutePanelId,
} from '@/lib/navigation-panel';
import type { Tab } from './settings/types';
import { MOBILE_SIDEBAR, RIGHT_AGENT_DETAIL_PANEL, getLeftPanelWidth } from '@/lib/config/panel-sizes';
import {
  MAIN_BODY_CONTENT_WIDTH_EVENT,
  parseContentWidthRatio,
  resolveMainBodyLayout,
} from '@/lib/main-body-layout';
import { resolveRightAskLayout } from '@/lib/right-ask-layout';

const noop = () => {};
const SYNC_POPOVER_ID = 'sync-popover';

const SearchPanel = dynamic(() => import('./panels/SearchPanel'), { ssr: false });
const CapturePanel = dynamic(() => import('./panels/CapturePanel'), { ssr: false });
function AgentsPanelLoading() {
  const { t } = useLocale();
  const p = t.panels.agents;
  return (
    <div className="flex h-full flex-col">
      <div className="h-[var(--workspace-header-h)] shrink-0 border-b border-border px-4 flex items-center">
        <span className="text-sm font-medium text-foreground">{p.title}</span>
      </div>
      <div className="flex-1 px-3 py-3" aria-busy="true" aria-label={p.title}>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-sm px-1 py-2.5 motion-safe:animate-pulse"
              aria-hidden="true"
            >
              <div className="h-7 w-7 shrink-0 rounded-md bg-muted/70" />
              <div className="h-3.5 flex-1 rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const AgentsPanel = dynamic(() => import('./panels/AgentsPanel'), {
  ssr: false,
  loading: AgentsPanelLoading,
});
const StudioPanel = dynamic(() => import('./panels/StudioPanel'), { ssr: false });
const DiscoverPanel = dynamic(() => import('./panels/DiscoverPanel'), { ssr: false });
const EchoPanel = dynamic(() => import('./panels/EchoPanel'), { ssr: false });
const WorkflowsPanel = dynamic(() => import('./panels/WorkflowsPanel'), { ssr: false });
const RightAskPanel = dynamic(() => import('./RightAskPanel'), { ssr: false });
const RightAgentDetailPanel = dynamic(() => import('./RightAgentDetailPanel'), { ssr: false });

const RIGHT_AGENT_DETAIL_DEFAULT_WIDTH = RIGHT_AGENT_DETAIL_PANEL.DEFAULT;
const RIGHT_AGENT_DETAIL_MIN_WIDTH = RIGHT_AGENT_DETAIL_PANEL.MIN;
const RIGHT_AGENT_DETAIL_MAX_WIDTH = RIGHT_AGENT_DETAIL_PANEL.MAX_ABS;

function useViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return viewportWidth;
}

function readStoredContentWidthRatio(): number {
  if (typeof window === 'undefined') return parseContentWidthRatio(undefined);
  try {
    return parseContentWidthRatio(window.localStorage.getItem('content-width'));
  } catch {
    return parseContentWidthRatio(undefined);
  }
}

function collectDirPaths(nodes: FileNode[], prefix = ''): string[] {
  const result: string[] = [];
  for (const n of nodes) {
    if (n.type === 'directory' && !n.name.startsWith('.')) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      result.push(p);
      if (n.children) result.push(...collectDirPaths(n.children, p));
    }
  }
  return result;
}

interface SidebarLayoutProps {
  fileTree: FileNode[];
  mindSystemSlots: MindSystemSlot[];
  children: React.ReactNode;
}

export default function SidebarLayout({ fileTree, mindSystemSlots, children }: SidebarLayoutProps) {
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const pathname = usePathname();

  // ── Left panel state (extracted hook) ──
  const lp = useLeftPanel(pathname === '/' ? 'home' : 'files');

  // ── Right Ask AI panel state (extracted hook) ──
  const ap = useAskPanel();

  // ── Settings modal ──
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<Tab | undefined>(undefined);

  // ── Sync popover ──
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [syncAnchorRect, setSyncAnchorRect] = useState<DOMRect | null>(null);
  const [pluginEntriesAvailable, setPluginEntriesAvailable] = useState(false);

  // ── Agent MCP detail (right dock, does not replace left Agents list) ──
  const [agentDetailKey, setAgentDetailKey] = useState<string | null>(null);
  const [agentDetailWidth, setAgentDetailWidth] = useState(RIGHT_AGENT_DETAIL_DEFAULT_WIDTH);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('right-agent-detail-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= RIGHT_AGENT_DETAIL_MIN_WIDTH && w <= RIGHT_AGENT_DETAIL_MAX_WIDTH) {
          setAgentDetailWidth(w);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── AI Organize (lifted from ImportModal so toast shares state) ──
  const aiOrganize = useAiOrganize();
  const [organizeToastVisible, setOrganizeToastVisible] = useState(false);

  // Show toast whenever organize is active
  useEffect(() => {
    if (aiOrganize.phase === 'organizing' || aiOrganize.phase === 'done' || aiOrganize.phase === 'error') {
      setOrganizeToastVisible(true);
    }
  }, [aiOrganize.phase]);

  const handleOrganizeToastDismiss = useCallback(() => {
    setOrganizeToastVisible(false);
    if (aiOrganize.phase !== 'organizing') {
      aiOrganize.reset();
    } else {
      aiOrganize.abort();
      aiOrganize.reset();
    }
  }, [aiOrganize]);

  const handleHistoryUpdate = useCallback(() => {
    window.dispatchEvent(new Event('mindos:organize-history-update'));
  }, []);

  // ── Import modal state ──
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importDefaultSpace, setImportDefaultSpace] = useState<string | undefined>(undefined);
  const [importInitialFiles, setImportInitialFiles] = useState<File[] | undefined>(undefined);
  const [dragOverlay, setDragOverlay] = useState(false);
  const [createSpaceRequestId, setCreateSpaceRequestId] = useState(0);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const requestCreateSpace = () => setCreateSpaceRequestId((current) => current + 1);
    window.addEventListener('mindos:create-space', requestCreateSpace);
    return () => window.removeEventListener('mindos:create-space', requestCreateSpace);
  }, []);

  const handleOpenImport = useCallback((space?: string) => {
    setImportDefaultSpace(space);
    setImportInitialFiles(undefined);
    setImportModalOpen(true);
  }, []);

  const handleCloseImport = useCallback(() => {
    setImportModalOpen(false);
    setImportDefaultSpace(undefined);
    setImportInitialFiles(undefined);
  }, []);

  // ── Mobile state ──
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileAskOpen, setMobileAskOpen] = useState(false);

  const { t } = useLocale();
  const inboxOrganize = useInboxOrganizeController({ aiOrganize, labels: t.inbox });
  const isFullPageChatRoute = pathname === '/chat' || pathname.startsWith('/chat/');
  const effectiveAskPanelOpen = !isFullPageChatRoute && ap.askPanelOpen;
  const effectiveDesktopAskPopupOpen = !isFullPageChatRoute && ap.desktopAskPopupOpen;
  const effectiveMobileAskOpen = !isFullPageChatRoute && mobileAskOpen;
  const dirPaths = useMemo(() => {
    const stop = telemetry.startTimer('sidebar.collect_dir_paths');
    const paths = collectDirPaths(fileTree);
    stop({ nodeCount: fileTree.length, pathCount: paths.length });
    return paths;
  }, [fileTree]);
  const { status: syncStatus, error: syncStatusError, stale: syncStatusStale, fetchStatus: syncStatusRefresh } = useSyncStatus();
  const mobileSyncLabel = getMobileSyncLabel({
    status: syncStatus,
    stale: syncStatusStale,
    loadError: syncStatusError,
    syncT: t.sidebar?.sync as Record<string, unknown> | undefined,
    prefix: t.sidebar?.syncLabel ?? 'Sync',
  });

  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

  // ── Optimistic rail navigation ──
  // A rail click toward another module records a pending target. Until the
  // route commits, the pending target IS the active panel: the panel content
  // and rail highlight switch in the click's render, and the local/route
  // mismatch can't flip any derived state back and forth (the rail-click
  // flicker). Any pathname change invalidates the pending entry in-render.
  const [pendingNav, setPendingNav] = useState<PendingRouteNav | null>(null);
  const [pendingHomeNav, setPendingHomeNav] = useState<PendingHomeNav | null>(null);
  const [suppressedRoutePanel, setSuppressedRoutePanel] = useState<RoutePanelId | null>(null);
  const pendingRoutePanel = getPendingRoutePanel(pathname, pendingNav);
  const pendingHomePanel = getPendingHomePanel(pathname, pendingHomeNav);
  const homeNavPending = pendingHomeNav?.fromPathname === pathname;
  const derivedActiveLeftPanel = homeNavPending
    ? pendingHomePanel
    : pendingRoutePanel ?? getActiveLeftPanel(pathname, lp.activePanel);
  const routePanelSuppressed = shouldSuppressRoutePanel(pathname, derivedActiveLeftPanel, lp.activePanel, suppressedRoutePanel);
  const activeLeftPanel = lp.sidebarExpanded && !routePanelSuppressed ? derivedActiveLeftPanel : null;
  const railActivePanel = homeNavPending
    ? pendingHomePanel
    : pendingRoutePanel ?? getRailActivePanel(pathname, lp.activePanel);
  const agentDockOpen = agentDetailKey !== null && activeLeftPanel === 'agents';
  const panelOpen = activeLeftPanel !== null;
  const effectivePanelMaximized = getEffectivePanelMaximized(activeLeftPanel, lp.activePanel, lp.panelMaximized);
  // One width for all panels (user-resized wins, per-panel default otherwise).
  // Deriving width from WHICH state controlled the panel made every
  // navigation transition animate through 2-4 widths — the flicker.
  const effectivePanelWidth = getLeftPanelWidth(activeLeftPanel, lp.panelWidth);
  const viewportWidth = useViewportWidth();
  const [contentWidthRatio, setContentWidthRatio] = useState(() => parseContentWidthRatio(undefined));
  useEffect(() => {
    const updateFromValue = (value: string | null | undefined) => {
      setContentWidthRatio(parseContentWidthRatio(value));
    };
    const handleContentWidthChange = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: string }>).detail;
      if (typeof detail?.value === 'string') {
        updateFromValue(detail.value);
        return;
      }
      try {
        updateFromValue(window.localStorage.getItem('content-width'));
      } catch {
        updateFromValue(undefined);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'content-width') updateFromValue(event.newValue);
    };

    setContentWidthRatio(readStoredContentWidthRatio());
    window.addEventListener(MAIN_BODY_CONTENT_WIDTH_EVENT, handleContentWidthChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(MAIN_BODY_CONTENT_WIDTH_EVENT, handleContentWidthChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  const contentLeftOffset = panelOpen ? lp.railWidth + effectivePanelWidth : lp.railWidth;
  const contentLeftOffsetCss = panelOpen && effectivePanelMaximized ? '100vw' : `${contentLeftOffset}px`;
  const rightAskLayout = useMemo(() => resolveRightAskLayout({
    viewportWidth,
    leftOffset: contentLeftOffset,
    askOpen: effectiveAskPanelOpen,
    askWidth: ap.askPanelWidth,
    askFocused: ap.askMaximized,
    agentDetailOpen: agentDockOpen,
    agentDetailWidth,
  }), [
    viewportWidth,
    contentLeftOffset,
    effectiveAskPanelOpen,
    ap.askPanelWidth,
    ap.askMaximized,
    agentDockOpen,
    agentDetailWidth,
  ]);
  const mainBodyLayout = useMemo(() => resolveMainBodyLayout({
    viewportWidth,
    leftOffset: contentLeftOffset,
    rightReservedWidth: rightAskLayout.reservedRightWidth,
    contentWidthRatio,
  }), [
    viewportWidth,
    contentLeftOffset,
    rightAskLayout.reservedRightWidth,
    contentWidthRatio,
  ]);
  const mainBodyContentMaxWidthCss = panelOpen && effectivePanelMaximized
    ? '100%'
    : viewportWidth > 0
      ? `${Math.round(mainBodyLayout.contentMaxWidth)}px`
      : 'var(--content-width-override, var(--content-width))';
  const rightDockReservedWidthCss = `${Math.round(rightAskLayout.reservedRightWidth)}px`;
  const previousSearchPanelRef = useRef<PanelId | null>(null);
  const lastSidebarPanelRef = useRef<PanelId | null>(pathname === '/' ? 'home' : 'files');
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);

  const resolveSearchClosePanel = useCallback((): PanelId | null => {
    const previous = previousSearchPanelRef.current;
    if (!previous) return null;
    if (previous === 'home') return pathname === '/' ? 'home' : null;
    if (previous === 'workflows') return 'workflows';
    const routePanel = getContentRoutePanel(pathname);
    if (previous === 'files') return routePanel === 'files' ? 'files' : null;
    return routePanel === previous ? previous : null;
  }, [pathname]);

  const openOrFocusSearchPanel = useCallback(() => {
    if (activeLeftPanel && activeLeftPanel !== 'search') {
      previousSearchPanelRef.current = activeLeftPanel;
    }
    lp.handleSidebarExpandedChange(true);
    lp.setActivePanel('search');
    setSearchFocusRequest((request) => request + 1);
  }, [activeLeftPanel, lp]);

  const closeSearchPanel = useCallback(() => {
    const nextPanel = resolveSearchClosePanel();
    previousSearchPanelRef.current = null;
    lp.handleSidebarExpandedChange(nextPanel !== null);
    lp.setActivePanel(nextPanel);
  }, [lp, resolveSearchClosePanel]);

  const toggleSearchPanel = useCallback(() => {
    if (activeLeftPanel === 'search') {
      closeSearchPanel();
      return;
    }
    openOrFocusSearchPanel();
  }, [activeLeftPanel, closeSearchPanel, openOrFocusSearchPanel]);

  useEffect(() => {
    if (activeLeftPanel !== 'search') previousSearchPanelRef.current = null;
  }, [activeLeftPanel]);

  // Drop the pending entry once any route commits (the derivation above
  // already ignores it from that render on — this is just state hygiene).
  useEffect(() => {
    setPendingNav((prev) => (prev && prev.fromPathname !== pathname ? null : prev));
    setSuppressedRoutePanel(null);
  }, [pathname]);

  useEffect(() => {
    if (activeLeftPanel && activeLeftPanel !== 'search' && activeLeftPanel !== 'workflows') {
      lastSidebarPanelRef.current = activeLeftPanel;
    }
  }, [activeLeftPanel]);

  useEffect(() => {
    if (!pendingHomeNav || pendingHomeNav.fromPathname === pathname) return;
    setPendingHomeNav(null);
    if (pathname === '/' && pendingHomeNav.panel) {
      lp.handleSidebarExpandedChange(true);
      lp.setActivePanel(pendingHomeNav.panel);
    }
  }, [pathname, pendingHomeNav, lp]);

  useEffect(() => {
    if (!isFullPageChatRoute) return;
    if (mobileAskOpen) setMobileAskOpen(false);
  }, [isFullPageChatRoute, mobileAskOpen]);

  // Auto-exit Ask panel maximize when navigating to a different page
  // or when left panel opens (content needs to be visible).
  // NOTE: the useEffect serves as a fallback for programmatic navigation;
  // the primary (synchronous) exit happens in exitAskMaximized() below.
  useEffect(() => {
    if (ap.askMaximized) ap.toggleAskMaximized();
  // Only react to pathname / left-panel changes, not askMaximized changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, panelOpen]);

  // Synchronous helper — call in click handlers that activate content pages,
  // so the Ask panel exits maximized in the same render (no flicker).
  const exitAskMaximized = useCallback(() => {
    if (ap.askMaximized) ap.toggleAskMaximized();
  }, [ap.askMaximized, ap.toggleAskMaximized]);

  // Close right Ask panel when entering home page — home has its own embedded Ask
  useEffect(() => {
    if (pathname === '/') {
      if (ap.askPanelOpen) ap.closeAskPanel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const [mountedPanels, setMountedPanels] = useState<Set<PanelId>>(() => new Set());
  const [rightAskMounted, setRightAskMounted] = useState(false);
  const [rightAgentDetailMounted, setRightAgentDetailMounted] = useState(false);
  const [mobileSearchMounted, setMobileSearchMounted] = useState(false);
  const [desktopAskPopupMounted, setDesktopAskPopupMounted] = useState(false);
  const [mobileAskMounted, setMobileAskMounted] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [importMounted, setImportMounted] = useState(false);

  useEffect(() => {
    const active = activeLeftPanel;
    if (!active || active === 'files' || active === 'home') return;
    setMountedPanels((prev) => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [activeLeftPanel]);

  useEffect(() => { if (effectiveAskPanelOpen) setRightAskMounted(true); }, [effectiveAskPanelOpen]);
  useEffect(() => { if (agentDockOpen) setRightAgentDetailMounted(true); }, [agentDockOpen]);
  useEffect(() => { if (mobileSearchOpen) setMobileSearchMounted(true); }, [mobileSearchOpen]);
  useEffect(() => { if (effectiveDesktopAskPopupOpen) setDesktopAskPopupMounted(true); }, [effectiveDesktopAskPopupOpen]);
  useEffect(() => { if (effectiveMobileAskOpen) setMobileAskMounted(true); }, [effectiveMobileAskOpen]);
  useEffect(() => { if (settingsOpen) setSettingsMounted(true); }, [settingsOpen]);
  useEffect(() => { if (importModalOpen) setImportMounted(true); }, [importModalOpen]);

  const isPanelMounted = useCallback(
    (panel: PanelId) => activeLeftPanel === panel || mountedPanels.has(panel),
    [activeLeftPanel, mountedPanels],
  );

  // ── Event listeners ──

  // Listen for cross-component "open settings" events
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setSettingsTab(tab);
      setSettingsOpen(true);
    };
    window.addEventListener('mindos:open-settings', handler);
    return () => window.removeEventListener('mindos:open-settings', handler);
  }, []);

  useEffect(() => {
    const handler = () => handleOpenImport();
    window.addEventListener('mindos:open-import', handler);
    return () => window.removeEventListener('mindos:open-import', handler);
  }, [handleOpenImport]);

  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail?.files as Array<{ name: string; path: string }> | undefined;
      if (!files || files.length === 0) return;
      void inboxOrganize.requestInboxOrganize(files, {
        providerOverride: (e as CustomEvent).detail?.providerOverride,
        modelOverride: (e as CustomEvent).detail?.modelOverride,
      });
    };
    window.addEventListener('mindos:inbox-organize', handler);
    return () => window.removeEventListener('mindos:inbox-organize', handler);
  }, [inboxOrganize]);

  // ── Session/Message: AI organize conversation content ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { content: string; name: string } | undefined;
      if (!detail?.content) return;
      inboxOrganize.requestConversationOrganize(detail);
    };
    window.addEventListener('mindos:session-organize', handler);
    return () => window.removeEventListener('mindos:session-organize', handler);
  }, [inboxOrganize]);

  // Listen for cross-component "open panel" events (e.g. GuideCard → Agents)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panel?: PanelId | null }>).detail;
      if (detail && Object.prototype.hasOwnProperty.call(detail, 'panel')) {
        const panel = detail.panel;
        if (panel === null) {
          lp.handleSidebarExpandedChange(false);
          lp.setActivePanel(null);
          return;
        }
        if (panel === 'search') {
          openOrFocusSearchPanel();
          return;
        }
        if (panel) {
          lp.handleSidebarExpandedChange(true);
          lp.setActivePanel(panel);
        }
        return;
      }
    };
    window.addEventListener('mindos:open-panel', handler);
    return () => window.removeEventListener('mindos:open-panel', handler);
  }, [lp, openOrFocusSearchPanel]);

  useEffect(() => {
    const handler = () => {
      if (window.innerWidth >= 768) {
        openOrFocusSearchPanel();
      } else {
        setMobileSearchOpen(true);
      }
    };
    window.addEventListener(COMMAND_CENTER_OPEN_EVENT, handler);
    return () => window.removeEventListener(COMMAND_CENTER_OPEN_EVENT, handler);
  }, [openOrFocusSearchPanel]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PluginEntriesStateDetail>).detail;
      setPluginEntriesAvailable((detail?.count ?? 0) > 0);
    };
    window.addEventListener(PLUGIN_ENTRIES_STATE_EVENT, handler);
    return () => window.removeEventListener(PLUGIN_ENTRIES_STATE_EVENT, handler);
  }, []);

  // GuideCard first message handler
  const handleFirstMessage = useCallback(() => {
    const notifyGuide = () => window.dispatchEvent(new Event('guide-state-updated'));
    if (ap.askOpenSource === 'guide') {
      fetch('/api/setup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideState: { askedAI: true } }),
      }).then(notifyGuide).catch((err) => console.warn('Guide state update failed:', err));
    } else if (ap.askOpenSource === 'guide-next') {
      notifyGuide();
    }
  }, [ap.askOpenSource]);

  // Close mobile drawer on route change
  useEffect(() => {
    const id = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  // Deep-link workbench routes keep their matching left panel aligned with URL.
  // Files/Mind routes are intentionally excluded so users can close that panel
  // while still staying on /wiki or /view/* content.
  useEffect(() => {
    if (isNeutralContentRoute(pathname)) {
      lp.setActivePanel((panel) => (panel === 'search' || panel === 'workflows' ? panel : null));
      return;
    }
    const panel = getRouteControlledPanel(pathname);
    if (panel) {
      lp.setActivePanel(panel);
    }
  }, [pathname, lp.setActivePanel]);

  // When leaving a route-owned panel, a slow RSC transition can let the previous
  // route alignment effect run after the destination click. Once the destination
  // route commits, recover the matching panel without overwriting utility panels.
  // Skipped while a rail navigation is in flight — recovering would undo the
  // user's optimistic click and re-trigger the state tug-of-war.
  useEffect(() => {
    if (pendingRoutePanel) return;
    const recoveredPanel = recoverStaleRoutePanel(pathname, lp.activePanel);
    if (recoveredPanel) lp.setActivePanel(recoveredPanel);
  }, [pathname, lp.activePanel, lp.setActivePanel, pendingRoutePanel]);

  const handleAgentDetailWidthCommit = useCallback((w: number) => {
    setAgentDetailWidth(w);
    try {
      localStorage.setItem('right-agent-detail-panel-width', String(w));
    } catch { /* ignore */ }
  }, []);

  const closeAgentDetailPanel = useCallback(() => setAgentDetailKey(null), []);

  // Refresh file tree when server-side tree version changes.
  // Polls a lightweight version counter every 5s — only calls router.refresh()
  // (which rebuilds the full tree) when the version actually changes.
  // A 2-second cooldown prevents rapid-fire refreshes during bulk file operations.
  useEffect(() => {
    let lastVersion = -1;
    let stopped = false;
    let lastRefreshTime = 0;
    let pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    const doRefresh = (version: number, previousVersion: number) => {
      lastRefreshTime = Date.now();
      const stopRefresh = telemetry.startTimer('tree.refresh.trigger');
      startTransition(() => {
        router.refresh();
      });
      stopRefresh({ previousVersion, version, reason: 'tree_version_changed' });
      notifyFilesChanged();
    };

    const REFRESH_COOLDOWN_MS = 2000;
    // Idle-polling budget contract (idle-polling-budget.test): own writes
    // arrive via mindos:files-changed events, so the fallback poll can be slow.
    const POLL_INTERVAL_MS = 15000;

    const checkVersion = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      const stop = telemetry.startTimer('tree.version.poll');
      try {
        const res = await fetch('/api/tree-version');
        if (!res.ok) {
          stop({ ok: false, changed: false });
          return;
        }
        const { v } = (await res.json()) as { v: number };
        if (lastVersion === -1) {
          lastVersion = v;
          stop({ ok: true, changed: false, version: v, initial: true });
          return;
        }
        if (v !== lastVersion) {
          const previousVersion = lastVersion;
          lastVersion = v;

          // Cooldown: if we refreshed recently, delay this one
          const elapsed = Date.now() - lastRefreshTime;
          if (elapsed < REFRESH_COOLDOWN_MS) {
            if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
            pendingRefreshTimer = setTimeout(() => {
              pendingRefreshTimer = null;
              if (!stopped) doRefresh(v, previousVersion);
            }, REFRESH_COOLDOWN_MS - elapsed);
            stop({ ok: true, changed: true, previousVersion, version: v, deferred: true });
          } else {
            doRefresh(v, previousVersion);
            stop({ ok: true, changed: true, previousVersion, version: v });
          }
          return;
        }
        stop({ ok: true, changed: false, version: v });
      } catch (err) {
        stop({ ok: false, changed: false });
        console.debug('[tree-version] poll failed', err);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVersion();
    };

    void checkVersion();
    const interval = setInterval(() => void checkVersion(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(interval);
      if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  // Unified keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (effectivePanelMaximized) { lp.handlePanelMaximize(); return; }
        if (agentDockOpen) { setAgentDetailKey(null); return; }
        if (effectiveAskPanelOpen) { ap.closeAskPanel(); return; }
        if (effectiveDesktopAskPopupOpen) { ap.closeDesktopAskPopup(); return; }
        if (activeLeftPanel === 'search') { closeSearchPanel(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          toggleSearchPanel();
        } else {
          setMobileSearchOpen(v => !v);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        if (isFullPageChatRoute) return;
        if (window.innerWidth >= 768) {
          ap.toggleAskPanel();
        } else {
          setMobileAskOpen(v => !v);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        setImportModalOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeLeftPanel, agentDockOpen, closeSearchPanel, effectiveAskPanelOpen, effectiveDesktopAskPopupOpen, effectivePanelMaximized, isFullPageChatRoute, lp, ap, toggleSearchPanel]);

  // ── Settings helpers ──
  const openSyncSettings = useCallback(() => {
    setSettingsTab('sync');
    setSyncPopoverOpen(false);
    setSettingsOpen(true);
  }, []);

  const openPluginsSettings = useCallback(() => {
    setSettingsTab('plugins');
    setSyncPopoverOpen(false);
    setSettingsOpen(true);
  }, []);

  const handleSettingsClick = useCallback(() => {
    setSettingsOpen(true);
    setSettingsTab(undefined);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsTab(undefined);
  }, []);

  const openPluginEntriesFromSettings = useCallback(() => {
    closeSettings();
    window.requestAnimationFrame(requestPluginEntriesOpen);
  }, [closeSettings]);

  const openPluginEntriesFromRail = useCallback(() => {
    setSyncPopoverOpen(false);
    requestPluginEntriesOpen();
  }, []);

  const openCommandCenterFromSettings = useCallback(() => {
    closeSettings();
    window.requestAnimationFrame(() => {
      if (window.innerWidth >= 768) {
        openOrFocusSearchPanel();
      } else {
        setMobileSearchOpen(true);
      }
    });
  }, [closeSettings, openOrFocusSearchPanel]);

  const handleSyncClick = useCallback((rect: DOMRect) => {
    setSyncAnchorRect(rect);
    setSyncPopoverOpen(prev => !prev);
  }, []);

  const handleExpandedChange = useCallback((expanded: boolean) => {
    lp.handleExpandedChange(expanded);
    setSyncPopoverOpen(false);
  }, [lp]);

  const handleSidebarPanelExpandedChange = useCallback((expanded: boolean) => {
    previousSearchPanelRef.current = null;
    lp.handleSidebarExpandedChange(expanded);
    if (expanded) {
      setSuppressedRoutePanel(null);
      lp.setActivePanel(getTitlebarSidebarExpandPanel(pathname, lastSidebarPanelRef.current));
    } else {
      const routePanel = getRouteControlledPanel(pathname);
      if (routePanel && activeLeftPanel === routePanel) setSuppressedRoutePanel(routePanel);
      lp.setActivePanel(null);
    }
  }, [activeLeftPanel, lp, pathname]);

  const handleMobileNavigate = useCallback(() => setMobileOpen(false), []);

  const handleHomeClick = useCallback(() => {
    const nextPanel = getHomeClickPanel(activeLeftPanel);
    flushSync(() => {
      exitAskMaximized();
      setSuppressedRoutePanel(null);
      previousSearchPanelRef.current = null;
      setAgentDetailKey(null);
      setPendingNav(null);
      setPendingHomeNav(pathname !== '/' ? { fromPathname: pathname, panel: nextPanel } : null);
      lp.handleSidebarExpandedChange(true);
      lp.setActivePanel(nextPanel);
    });
    if (pathname !== '/') {
      smoothPush('/');
    }
  }, [activeLeftPanel, exitAskMaximized, lp, pathname, smoothPush]);

  const handleRoutePanelClick = useCallback((
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    targetPanel: RoutePanelId,
  ) => {
    if (!shouldHandleSmoothNavigation(event)) return;
    exitAskMaximized();
    const decision = getRailPanelClickDecision(pathname, activeLeftPanel, targetPanel);
    event.preventDefault();
    setSuppressedRoutePanel(null);
    if (!decision.preventDefault) {
      // Real navigation starts — keep the clicked target active until it commits
      setPendingNav({ target: targetPanel, fromPathname: pathname });
      smoothPush(ROUTE_PANEL_HREF[targetPanel]);
    }
    previousSearchPanelRef.current = null;
    lp.handleSidebarExpandedChange(decision.nextPanel !== null);
    lp.setActivePanel(decision.nextPanel);
    if (targetPanel === 'agents') setAgentDetailKey(null);
  }, [activeLeftPanel, exitAskMaximized, lp, pathname, smoothPush]);

  const handleActivityPanelChange = useCallback((panel: PanelId | null) => {
    lp.handleSidebarExpandedChange(panel !== null);
    lp.setActivePanel(panel);
  }, [lp]);

  return (
    <InboxOrganizeProvider value={inboxOrganize}>
      <McpStoreInit />
      <WalkthroughInit />
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-app-popover focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-lg focus-visible:text-sm focus-visible:font-medium bg-[var(--amber)] text-[var(--amber-foreground)]"
      >
        Skip to main content
      </a>

      {/* ── Desktop: Titlebar row + Activity Bar + Panel ── */}
      <TitlebarRow
        searchActive={activeLeftPanel === 'search'}
        onSearchOpenOrFocus={openOrFocusSearchPanel}
        sidebarExpanded={panelOpen}
        onSidebarExpandedChange={handleSidebarPanelExpandedChange}
      />
      <ActivityBar
        activePanel={railActivePanel}
        suppressRouteActive={homeNavPending}
        onPanelChange={handleActivityPanelChange}
        onHomeClick={handleHomeClick}
        onCaptureClick={(event) => handleRoutePanelClick(event, 'capture')}
        onEchoClick={(event) => handleRoutePanelClick(event, 'echo')}
        onAgentsClick={(event) => handleRoutePanelClick(event, 'agents')}
        onStudioClick={(event) => handleRoutePanelClick(event, 'studio')}
        onDiscoverClick={(event) => handleRoutePanelClick(event, 'discover')}
        onSpacesClick={(event) => handleRoutePanelClick(event, 'files')}
        syncStatus={syncStatus}
        syncStale={syncStatusStale}
        expanded={lp.railExpanded}
        onExpandedChange={handleExpandedChange}
        onSettingsClick={handleSettingsClick}
        pluginEntriesAvailable={pluginEntriesAvailable}
        onPluginEntriesClick={openPluginEntriesFromRail}
        onSyncClick={handleSyncClick}
        syncPopoverOpen={syncPopoverOpen}
        syncPopoverId={SYNC_POPOVER_ID}
      />

      <Panel
        activePanel={activeLeftPanel}
        fileTree={fileTree}
        mindSystemSlots={mindSystemSlots}
        onNavigate={noop}
        onOpenSyncSettings={openSyncSettings}
        railWidth={lp.railWidth}
        panelWidth={lp.panelWidth ?? undefined}
        onWidthChange={lp.handlePanelWidthChange}
        onWidthCommit={lp.handlePanelWidthCommit}
        maximized={effectivePanelMaximized}
        onMaximize={lp.handlePanelMaximize}
        onImport={handleOpenImport}
        onSearchOpenOrFocus={openOrFocusSearchPanel}
      >
        {isPanelMounted('echo') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'echo' ? '' : 'hidden'}`}>
            <EchoPanel active={activeLeftPanel === 'echo'} />
          </div>
        )}
        {isPanelMounted('capture') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'capture' ? '' : 'hidden'}`}>
            <CapturePanel />
          </div>
        )}
        {isPanelMounted('search') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'search' ? '' : 'hidden'}`}>
            <SearchPanel
              active={activeLeftPanel === 'search'}
              focusRequest={searchFocusRequest}
              onClose={closeSearchPanel}
            />
          </div>
        )}
        {isPanelMounted('agents') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'agents' ? '' : 'hidden'}`}>
            <AgentsPanel
              active={activeLeftPanel === 'agents'}
              selectedAgentKey={agentDockOpen ? agentDetailKey : null}
            />
          </div>
        )}
        {isPanelMounted('studio') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'studio' ? '' : 'hidden'}`}>
            <StudioPanel active={activeLeftPanel === 'studio'} />
          </div>
        )}
        {isPanelMounted('discover') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'discover' ? '' : 'hidden'}`}>
            <DiscoverPanel active={activeLeftPanel === 'discover'} maximized={effectivePanelMaximized} onMaximize={lp.handlePanelMaximize} />
          </div>
        )}
        {isPanelMounted('workflows') && (
          <div className={`flex flex-col h-full ${activeLeftPanel === 'workflows' ? '' : 'hidden'}`}>
            <WorkflowsPanel active={activeLeftPanel === 'workflows'} maximized={effectivePanelMaximized} onMaximize={lp.handlePanelMaximize} />
          </div>
        )}
      </Panel>

      {/* ── Right-side Ask AI Panel ── */}
      {rightAskMounted && (
        <RightAskPanel
          open={effectiveAskPanelOpen}
          onClose={ap.closeAskPanel}
          currentFile={currentFile}
          initialMessage={ap.askInitialMessage}
          initialAcpAgent={ap.askAcpAgent}
          initialAgentRuntime={ap.askAgentRuntime}
          contextRequest={ap.askContextRequest}
          onFirstMessage={handleFirstMessage}
          width={ap.askPanelWidth}
          onWidthChange={ap.handleAskWidthChange}
          onWidthCommit={ap.handleAskWidthCommit}
          maximized={ap.askMaximized}
          onMaximize={ap.toggleAskMaximized}
          sidebarOffset={contentLeftOffset}
          layoutMode={rightAskLayout.mode}
        />
      )}

      {rightAgentDetailMounted && (
        <RightAgentDetailPanel
          open={agentDockOpen}
          agentKey={agentDetailKey}
          onClose={closeAgentDetailPanel}
          rightOffset={effectiveAskPanelOpen ? 'var(--right-ask-panel-visual-width, 0px)' : 0}
          width={agentDetailWidth}
          onWidthChange={setAgentDetailWidth}
          onWidthCommit={handleAgentDetailWidthCommit}
        />
      )}

      {desktopAskPopupMounted && (
        <AskModal
          open={effectiveDesktopAskPopupOpen}
          onClose={ap.closeDesktopAskPopup}
          currentFile={currentFile}
          initialMessage={ap.askInitialMessage}
          initialAcpAgent={ap.askAcpAgent}
          initialAgentRuntime={ap.askAgentRuntime}
          contextRequest={ap.askContextRequest}
          onFirstMessage={handleFirstMessage}
        />
      )}

      <PluginEntriesDock onOpenPluginsSettings={openPluginsSettings} onOpenCommandCenter={openOrFocusSearchPanel} />
      <PluginHotkeyHost />
      <AskFab onToggle={ap.toggleAskPanel} askPanelOpen={effectiveAskPanelOpen || effectiveDesktopAskPopupOpen} />
      <KeyboardShortcuts />

      {settingsMounted && (
        <SettingsModal
          open={settingsOpen}
          onClose={closeSettings}
          initialTab={settingsTab}
          onOpenPluginEntries={openPluginEntriesFromSettings}
          onOpenCommandCenter={openCommandCenterFromSettings}
        />
      )}

      <SyncPopover
        id={SYNC_POPOVER_ID}
        open={syncPopoverOpen}
        onClose={() => setSyncPopoverOpen(false)}
        anchorRect={syncAnchorRect}
        railWidth={lp.railWidth}
        onOpenSyncSettings={openSyncSettings}
        syncStatus={syncStatus}
        syncStale={syncStatusStale}
        syncLoadError={syncStatusError}
        onSyncStatusRefresh={syncStatusRefresh}
      />

      {/* ── Mobile ── */}
      {/* top: var(--app-titlebar-h) — when the mac shell viewport drops below md, the header sits below the titlebar drag row */}
      <header className="md:hidden fixed top-[var(--app-titlebar-h)] left-0 right-0 z-30 bg-card border-b border-border flex items-center justify-between px-3 py-2" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={() => setMobileOpen(true)} className="p-3 -ml-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo id="mobile" />
          <span className="text-foreground text-sm font-brand">MindOS</span>
        </Link>
        <div className="flex items-center gap-0.5">
          <button
            onClick={openSyncSettings}
            className="p-3 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent flex items-center justify-center"
            aria-label={mobileSyncLabel}
          >
            <MobileSyncDot status={syncStatus} stale={syncStatusStale} loadError={syncStatusError} />
          </button>
          <button onClick={() => setMobileSearchOpen(true)} className="p-3 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label={t.sidebar.searchTitle}>
            <Search size={20} />
          </button>
          <button onClick={() => { setSettingsOpen(true); setSettingsTab(undefined); }} className="p-3 -mr-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label={t.sidebar.settingsTitle}>
            <Settings size={20} />
          </button>
        </div>
      </header>

      {mobileOpen && <div className="md:hidden fixed inset-0 z-40 overlay-backdrop" onClick={() => setMobileOpen(false)} />}
      <aside
        className={`md:hidden fixed top-0 left-0 h-screen z-50 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: MOBILE_SIDEBAR.WIDTH, maxWidth: MOBILE_SIDEBAR.MAX_WIDTH }}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo id="drawer" />
            <span className="text-foreground text-sm font-brand">MindOS</span>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          <MindFileTreeSections
            fileTree={fileTree}
            mindSystemSlots={mindSystemSlots}
            onNavigate={handleMobileNavigate}
            onImport={handleOpenImport}
          />
        </div>
      </aside>

      {mobileSearchMounted && <SearchModal open={mobileSearchOpen} onClose={() => setMobileSearchOpen(false)} />}
      {mobileAskMounted && <AskModal open={effectiveMobileAskOpen} onClose={() => setMobileAskOpen(false)} currentFile={currentFile} />}

      <main
        id="main-content"
        className="min-h-screen transition-[padding-left,padding-right] duration-200 pt-[52px] md:pt-0"
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragCounterRef.current++;
          if (dragCounterRef.current === 1) setDragOverlay(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
        }}
        onDragLeave={() => {
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) setDragOverlay(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounterRef.current = 0;
          setDragOverlay(false);
          if (e.dataTransfer.files.length > 0 && !importModalOpen) {
            quickDropToInbox(Array.from(e.dataTransfer.files), t);
          }
        }}
      >
        {/* min-height subtracts the titlebar row: main already pads down by
            --app-titlebar-h, so a bare 100vh here would overflow the document
            by that amount and let content scroll underneath the fixed row */}
        <div className="min-h-[calc(100vh-var(--app-titlebar-h))] bg-background">
          <ChangesBanner />
          {children}
        </div>

        <SpaceInitToast />
        <CreateSpaceModal t={t} dirPaths={dirPaths} openRequestId={createSpaceRequestId} />

        {/* Global drag overlay — Quick Drop to Inbox */}
        {dragOverlay && !importModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-200">
            <div className="border-2 border-dashed border-[var(--amber)]/50 rounded-xl p-12 flex flex-col items-center gap-3">
              <FolderInput size={48} className="text-[var(--amber)]/60" />
              <p className="text-sm text-foreground font-medium">{t.inbox.dropOverlay}</p>
              <p className="text-xs text-muted-foreground">{t.inbox.dropOverlayFormats}</p>
            </div>
          </div>
        )}
      </main>

      {importMounted && (
        <ImportModal
          open={importModalOpen}
          onClose={handleCloseImport}
          defaultSpace={importDefaultSpace}
          initialFiles={importInitialFiles}
          aiOrganize={aiOrganize}
          dirPaths={dirPaths}
        />
      )}

      {organizeToastVisible && (
        <OrganizeToast
          aiOrganize={aiOrganize}
          onDismiss={handleOrganizeToastDismiss}
          onCancel={() => { aiOrganize.abort(); aiOrganize.reset(); setOrganizeToastVisible(false); }}
          onHistoryUpdate={handleHistoryUpdate}
        />
      )}

      <style>{`
        @media (min-width: 768px) {
          :root {
            --rail-width: ${lp.railWidth}px;
            --content-left-offset: ${contentLeftOffsetCss};
            --right-ask-panel-visual-width: ${effectiveAskPanelOpen ? (ap.askMaximized ? `calc(100vw - ${contentLeftOffset}px)` : `min(${ap.askPanelWidth}px, calc(100vw - ${contentLeftOffset}px))`) : '0px'};
            --right-agent-detail-visual-width: ${agentDockOpen ? agentDetailWidth : 0}px;
            --right-stack-visual-width: calc(var(--right-ask-panel-visual-width) + var(--right-agent-detail-visual-width));
            --right-dock-reserved-width: ${rightDockReservedWidthCss};
            --right-panel-width: var(--right-dock-reserved-width);
            --right-agent-detail-width: 0px;
            --main-body-content-max-width: ${mainBodyContentMaxWidthCss};
          }
          #main-content {
            padding-left: ${contentLeftOffsetCss} !important;
            padding-right: var(--right-dock-reserved-width) !important;
            padding-top: var(--app-titlebar-h);
          }
        }
      `}</style>
    </InboxOrganizeProvider>
  );
}
