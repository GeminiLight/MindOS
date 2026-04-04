'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Search, Settings, Menu, X, FolderInput } from 'lucide-react';
import ActivityBar, { type PanelId } from './ActivityBar';
import Panel from './Panel';
import FileTree from './FileTree';
import Logo from './Logo';
import SearchPanel from './panels/SearchPanel';

import AgentsPanel from './panels/AgentsPanel';
import DiscoverPanel from './panels/DiscoverPanel';
import EchoPanel from './panels/EchoPanel';
import WorkflowsPanel from './panels/WorkflowsPanel';

import RightAskPanel from './RightAskPanel';
import RightAgentDetailPanel, {
  RIGHT_AGENT_DETAIL_DEFAULT_WIDTH,
  RIGHT_AGENT_DETAIL_MIN_WIDTH,
  RIGHT_AGENT_DETAIL_MAX_WIDTH,
} from './RightAgentDetailPanel';
import AskFab from './AskFab';
import SyncPopover from './panels/SyncPopover';
import SearchModal from './SearchModal';
import AskModal from './AskModal';
import SettingsModal from './SettingsModal';
import KeyboardShortcuts from './KeyboardShortcuts';
import ChangesBanner from './changes/ChangesBanner';
import SpaceInitToast from './SpaceInitToast';
import OrganizeToast from './OrganizeToast';
import CreateSpaceModal from './CreateSpaceModal';
import { MobileSyncDot, useSyncStatus } from './SyncStatusBar';
import { FileNode } from '@/lib/types';
import { useLocale } from '@/lib/stores/locale-store';
import dynamic from 'next/dynamic';

const ImportModal = dynamic(() => import('./ImportModal'), { ssr: false });
import { WalkthroughProvider } from './walkthrough';
import McpStoreInit from '@/lib/stores/McpStoreInit';
import '@/lib/renderers/index'; // client-side renderer registration source of truth
import { useLeftPanel } from '@/hooks/useLeftPanel';
import { useAskPanel } from '@/hooks/useAskPanel';
import { useAiOrganize } from '@/hooks/useAiOrganize';
import { toast } from '@/lib/toast';
import type { Tab } from './settings/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

async function quickDropToInbox(
  files: File[],
  t: ReturnType<typeof useLocale>['t'],
) {
  const payload: Array<{ name: string; content: string; encoding?: string }> = [];
  let oversizedCount = 0;

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      oversizedCount++;
      continue;
    }
    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const buf = await file.arrayBuffer();
        payload.push({ name: file.name, content: arrayBufferToBase64(buf), encoding: 'base64' });
      } else {
        const text = await file.text();
        payload.push({ name: file.name, content: text });
      }
    } catch {
      /* skip unreadable files */
    }
  }

  if (payload.length === 0) {
    if (oversizedCount > 0) {
      toast.error(t.inbox.tooLarge(oversizedCount), 4000);
    } else if (files.length > 0) {
      toast.error(t.inbox.saveFailed, 4000);
    }
    return;
  }

  try {
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payload }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[QuickDrop] Save failed:', data.error);
      toast.error(t.inbox.saveFailed, 4000);
      return;
    }

    const result = await res.json();
    const saved = result.saved?.length ?? 0;
    const formatSkipped = result.skipped?.length ?? 0;

    showQuickDropToast(saved, formatSkipped, oversizedCount, t);
    window.dispatchEvent(new Event('mindos:files-changed'));
    window.dispatchEvent(new Event('mindos:inbox-updated'));
  } catch (err) {
    console.error('[QuickDrop] Network error:', err);
    toast.error(t.inbox.saveFailed, 4000);
  }
}

function showQuickDropToast(
  saved: number,
  formatSkipped: number,
  oversized: number,
  t: ReturnType<typeof useLocale>['t'],
) {
  if (saved > 0 && oversized > 0 && formatSkipped === 0) {
    toast.success(t.inbox.savedWithOversized(saved, oversized), 4000);
  } else if (saved > 0 && (formatSkipped + oversized) > 0) {
    toast.success(t.inbox.savedWithSkipped(saved, formatSkipped + oversized), 4000);
  } else if (saved > 0) {
    toast.success(t.inbox.savedToast(saved), 3000);
  } else {
    if (oversized > 0) toast.error(t.inbox.tooLarge(oversized), 4000);
    if (formatSkipped > 0) toast.error(t.inbox.savedWithSkipped(0, formatSkipped), 4000);
    if (oversized === 0 && formatSkipped === 0) toast.error(t.inbox.saveFailed, 4000);
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
  children: React.ReactNode;
}

export default function SidebarLayout({ fileTree, children }: SidebarLayoutProps) {
  // ── Left panel state (extracted hook) ──
  const lp = useLeftPanel();

  // ── Right Ask AI panel state (extracted hook) ──
  const ap = useAskPanel();

  // ── Settings modal ──
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<Tab | undefined>(undefined);

  // ── Sync popover ──
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [syncAnchorRect, setSyncAnchorRect] = useState<DOMRect | null>(null);

  // ── Agent MCP detail (right dock, does not replace left Agents list) ──
  const [agentDetailKey, setAgentDetailKey] = useState<string | null>(null);
  const [agentDetailWidth, setAgentDetailWidth] = useState(() => {
    if (typeof window === 'undefined') return RIGHT_AGENT_DETAIL_DEFAULT_WIDTH;
    try {
      const stored = localStorage.getItem('right-agent-detail-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= RIGHT_AGENT_DETAIL_MIN_WIDTH && w <= RIGHT_AGENT_DETAIL_MAX_WIDTH) return w;
      }
    } catch { /* ignore */ }
    return RIGHT_AGENT_DETAIL_DEFAULT_WIDTH;
  });

  // ── AI Organize (lifted from ImportModal so toast shares state) ──
  const aiOrganize = useAiOrganize();
  const [organizeToastVisible, setOrganizeToastVisible] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

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
    setHistoryRefreshToken(t => t + 1);
    window.dispatchEvent(new Event('mindos:organize-history-update'));
  }, []);

  // ── Import modal state ──
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importDefaultSpace, setImportDefaultSpace] = useState<string | undefined>(undefined);
  const [importInitialFiles, setImportInitialFiles] = useState<File[] | undefined>(undefined);
  const [dragOverlay, setDragOverlay] = useState(false);
  const dragCounterRef = useRef(0);

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
  const router = useRouter();
  const pathname = usePathname();
  const dirPaths = useMemo(() => collectDirPaths(fileTree), [fileTree]);
  const { status: syncStatus, fetchStatus: syncStatusRefresh } = useSyncStatus();

  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

  // Auto-exit Ask panel maximize when navigating to a different page
  useEffect(() => {
    if (ap.askMaximized) ap.toggleAskMaximized();
  // Only react to pathname changes, not askMaximized changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const agentsContentActive = pathname?.startsWith('/agents');
  const railActivePanel = lp.activePanel ?? (agentsContentActive ? 'agents' : null);

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

  // ── Inbox: batch AI organize from InboxSection ──
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail?.files as Array<{ name: string; path: string }> | undefined;
      if (!files || files.length === 0 || aiOrganize.phase === 'organizing') return;

      const prompt = t.inbox.organizePrompt(files.map(f => f.name));

      (async () => {
        const attachments: Array<{ name: string; content: string }> = [];
        for (const f of files) {
          try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(f.path)}`);
            if (res.ok) {
              const data = await res.json();
              attachments.push({ name: f.name, content: data.content ?? '' });
            }
          } catch { /* skip unreadable files */ }
        }
        if (attachments.length > 0) {
          aiOrganize.start(attachments, prompt);
        } else {
          toast.error(t.inbox.organizeFailed, 4000);
          window.dispatchEvent(new Event('mindos:organize-done'));
        }
      })();
    };
    window.addEventListener('mindos:inbox-organize', handler);
    return () => window.removeEventListener('mindos:inbox-organize', handler);
  }, [aiOrganize, t]);

  // Notify InboxSection when organize finishes
  useEffect(() => {
    if (aiOrganize.phase === 'done' || aiOrganize.phase === 'error') {
      window.dispatchEvent(new Event('mindos:organize-done'));
    }
  }, [aiOrganize.phase]);

  // Listen for cross-component "open panel" events (e.g. GuideCard → Agents)
  useEffect(() => {
    const handler = (e: Event) => {
      const panel = (e as CustomEvent).detail?.panel;
      if (panel) lp.setActivePanel(panel);
    };
    window.addEventListener('mindos:open-panel', handler);
    return () => window.removeEventListener('mindos:open-panel', handler);
  }, [lp]);

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

  // Deep-link Echo routes: keep left Echo panel aligned with URL
  useEffect(() => {
    if (pathname?.startsWith('/echo')) {
      lp.setActivePanel('echo');
    }
  }, [pathname, lp.setActivePanel]);

  const handleAgentDetailWidthCommit = useCallback((w: number) => {
    setAgentDetailWidth(w);
    try {
      localStorage.setItem('right-agent-detail-panel-width', String(w));
    } catch { /* ignore */ }
  }, []);

  const closeAgentDetailPanel = useCallback(() => setAgentDetailKey(null), []);

  const agentDockOpen = agentDetailKey !== null && lp.activePanel === 'agents';

  // Refresh file tree when server-side tree version changes.
  // Polls a lightweight version counter every 3s — only calls router.refresh()
  // (which rebuilds the full tree) when the version actually changes.
  useEffect(() => {
    let lastVersion = -1;
    let stopped = false;

    const checkVersion = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const res = await fetch('/api/tree-version');
        if (!res.ok) return;
        const { v } = (await res.json()) as { v: number };
        if (lastVersion === -1) {
          lastVersion = v;
          return;
        }
        if (v !== lastVersion) {
          lastVersion = v;
          router.refresh();
          window.dispatchEvent(new Event('mindos:files-changed'));
        }
      } catch (err) { console.debug('[tree-version] poll failed', err); }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVersion();
    };

    void checkVersion();
    const interval = setInterval(() => void checkVersion(), 3_000);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  // Unified keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lp.panelMaximized) { lp.handlePanelMaximize(); return; }
        if (agentDockOpen) { setAgentDetailKey(null); return; }
        if (ap.askPanelOpen) { ap.closeAskPanel(); return; }
        if (ap.desktopAskPopupOpen) { ap.closeDesktopAskPopup(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          lp.setActivePanel((p: PanelId | null) => p === 'search' ? null : 'search');
        } else {
          setMobileSearchOpen(v => !v);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
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
  }, [agentDockOpen, lp, ap]);

  // ── Settings helpers ──
  const openSyncSettings = useCallback(() => {
    setSettingsTab('sync');
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

  const handleSyncClick = useCallback((rect: DOMRect) => {
    setSyncAnchorRect(rect);
    setSyncPopoverOpen(prev => !prev);
  }, []);

  const handleExpandedChange = useCallback((expanded: boolean) => {
    lp.handleExpandedChange(expanded);
    setSyncPopoverOpen(false);
  }, [lp]);

  return (
    <WalkthroughProvider>
    <>
      <McpStoreInit />
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:font-display bg-[var(--amber)] text-[var(--amber-foreground)]"
      >
        Skip to main content
      </a>

      {/* ── Desktop: Activity Bar + Panel ── */}
      <ActivityBar
        activePanel={railActivePanel}
        onPanelChange={lp.setActivePanel}
        onEchoClick={() => {
          const wasActive = lp.activePanel === 'echo';
          lp.setActivePanel(wasActive ? null : 'echo');
          if (!wasActive) router.push('/echo/about-you');
        }}
        onAgentsClick={() => {
          const wasActive = lp.activePanel === 'agents';
          lp.setActivePanel(wasActive ? null : 'agents');
          if (!wasActive) router.push('/agents');
          setAgentDetailKey(null);
        }}
        onDiscoverClick={() => {
          const wasActive = lp.activePanel === 'discover';
          lp.setActivePanel(wasActive ? null : 'discover');
          if (!wasActive) router.push('/explore');
        }}
        syncStatus={syncStatus}
        expanded={lp.railExpanded}
        onExpandedChange={handleExpandedChange}
        onSettingsClick={handleSettingsClick}
        onSyncClick={handleSyncClick}
      />

      <Panel
        activePanel={lp.activePanel}
        fileTree={fileTree}
        onNavigate={() => {}}
        onOpenSyncSettings={openSyncSettings}
        railWidth={lp.railWidth}
        panelWidth={lp.panelWidth ?? undefined}
        onWidthChange={lp.handlePanelWidthChange}
        onWidthCommit={lp.handlePanelWidthCommit}
        maximized={lp.panelMaximized}
        onMaximize={lp.handlePanelMaximize}
        onImport={handleOpenImport}
      >
        <div className={`flex flex-col h-full ${lp.activePanel === 'echo' ? '' : 'hidden'}`}>
          <EchoPanel active={lp.activePanel === 'echo'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${lp.activePanel === 'search' ? '' : 'hidden'}`}>
          <SearchPanel active={lp.activePanel === 'search'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${lp.activePanel === 'agents' ? '' : 'hidden'}`}>
          <AgentsPanel
            active={lp.activePanel === 'agents'}
            maximized={lp.panelMaximized}
            onMaximize={lp.handlePanelMaximize}
            selectedAgentKey={agentDockOpen ? agentDetailKey : null}
          />
        </div>
        <div className={`flex flex-col h-full ${lp.activePanel === 'discover' ? '' : 'hidden'}`}>
          <DiscoverPanel active={lp.activePanel === 'discover'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${lp.activePanel === 'workflows' ? '' : 'hidden'}`}>
          <WorkflowsPanel active={lp.activePanel === 'workflows'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
      </Panel>

      {/* ── Right-side Ask AI Panel ── */}
      <RightAskPanel
        open={ap.askPanelOpen}
        onClose={ap.closeAskPanel}
        currentFile={currentFile}
        initialMessage={ap.askInitialMessage}
        initialAcpAgent={ap.askAcpAgent}
        onFirstMessage={handleFirstMessage}
        width={ap.askPanelWidth}
        onWidthChange={ap.handleAskWidthChange}
        onWidthCommit={ap.handleAskWidthCommit}
        askMode={ap.askMode}
        onModeSwitch={ap.handleAskModeSwitch}
        maximized={ap.askMaximized}
        onMaximize={ap.toggleAskMaximized}
        sidebarOffset={lp.panelOpen ? lp.railWidth + lp.effectivePanelWidth : lp.railWidth}
      />

      <RightAgentDetailPanel
        open={agentDockOpen}
        agentKey={agentDetailKey}
        onClose={closeAgentDetailPanel}
        rightOffset={ap.askPanelOpen ? ap.askPanelWidth : 0}
        width={agentDetailWidth}
        onWidthChange={setAgentDetailWidth}
        onWidthCommit={handleAgentDetailWidthCommit}
      />

      <AskModal
        open={ap.desktopAskPopupOpen}
        onClose={ap.closeDesktopAskPopup}
        currentFile={currentFile}
        initialMessage={ap.askInitialMessage}
        initialAcpAgent={ap.askAcpAgent}
        onFirstMessage={handleFirstMessage}
        askMode={ap.askMode}
        onModeSwitch={ap.handleAskModeSwitch}
      />

      <AskFab onToggle={ap.toggleAskPanel} askPanelOpen={ap.askPanelOpen || ap.desktopAskPopupOpen} />
      <KeyboardShortcuts />

      <SettingsModal open={settingsOpen} onClose={closeSettings} initialTab={settingsTab} />

      <SyncPopover
        open={syncPopoverOpen}
        onClose={() => setSyncPopoverOpen(false)}
        anchorRect={syncAnchorRect}
        railWidth={lp.railWidth}
        onOpenSyncSettings={openSyncSettings}
        syncStatus={syncStatus}
        onSyncStatusRefresh={syncStatusRefresh}
      />

      {/* ── Mobile ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-30 bg-card border-b border-border flex items-center justify-between px-3 py-2" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={() => setMobileOpen(true)} className="p-3 -ml-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo id="mobile" />
          <span className="font-semibold text-foreground text-sm tracking-wide">MindOS</span>
        </Link>
        <div className="flex items-center gap-0.5">
          <button onClick={openSyncSettings} className="p-3 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent flex items-center justify-center" aria-label="Sync status">
            <MobileSyncDot status={syncStatus} />
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
      <aside className={`md:hidden fixed top-0 left-0 h-screen w-[85vw] max-w-[320px] z-50 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Logo id="drawer" />
            <span className="font-semibold text-foreground text-sm tracking-wide font-display">MindOS</span>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          <FileTree nodes={fileTree} onNavigate={() => setMobileOpen(false)} onImport={handleOpenImport} />
        </div>
      </aside>

      <SearchModal open={mobileSearchOpen} onClose={() => setMobileSearchOpen(false)} />
      <AskModal open={mobileAskOpen} onClose={() => setMobileAskOpen(false)} currentFile={currentFile} />

      <main
        id="main-content"
        className={`min-h-screen transition-all duration-200 pt-[52px] md:pt-0`}
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
        <div className="min-h-screen bg-background overflow-x-hidden">
          <ChangesBanner />
          {children}
        </div>

        <SpaceInitToast />
        <CreateSpaceModal t={t} dirPaths={dirPaths} />

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

      <ImportModal
        open={importModalOpen}
        onClose={handleCloseImport}
        defaultSpace={importDefaultSpace}
        initialFiles={importInitialFiles}
        aiOrganize={aiOrganize}
        dirPaths={dirPaths}
      />

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
            --right-panel-width: ${ap.askMaximized ? `calc(100vw - ${lp.panelOpen ? lp.railWidth + lp.effectivePanelWidth : lp.railWidth}px)` : `${ap.askPanelOpen ? ap.askPanelWidth : 0}px`};
            --right-agent-detail-width: ${agentDockOpen ? agentDetailWidth : 0}px;
          }
          #main-content {
            padding-left: ${lp.panelOpen && lp.panelMaximized ? '100vw' : `${lp.panelOpen ? lp.railWidth + lp.effectivePanelWidth : lp.railWidth}px`} !important;
            padding-right: calc(var(--right-panel-width) + var(--right-agent-detail-width)) !important;
            padding-top: 0;
          }
        }
      `}</style>
    </>
    </WalkthroughProvider>
  );
}
