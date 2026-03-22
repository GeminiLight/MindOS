'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Search, Settings, Menu, X } from 'lucide-react';
import ActivityBar, { type PanelId } from './ActivityBar';
import Panel from './Panel';
import FileTree from './FileTree';
import Logo from './Logo';
import SearchPanel from './panels/SearchPanel';
import PluginsPanel from './panels/PluginsPanel';
import AgentsPanel from './panels/AgentsPanel';
import RightAskPanel from './RightAskPanel';
import AskFab from './AskFab';
import SyncPopover from './panels/SyncPopover';
import SearchModal from './SearchModal';
import AskModal from './AskModal';
import SettingsModal from './SettingsModal';
import KeyboardShortcuts from './KeyboardShortcuts';
import { MobileSyncDot, useSyncStatus } from './SyncStatusBar';
import { FileNode } from '@/lib/types';
import { useLocale } from '@/lib/LocaleContext';
import { WalkthroughProvider } from './walkthrough';
import McpProvider from '@/hooks/useMcpData';
import { useLeftPanel } from '@/hooks/useLeftPanel';
import { useAskPanel } from '@/hooks/useAskPanel';
import type { Tab } from './settings/types';

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

  // ── Mobile state ──
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileAskOpen, setMobileAskOpen] = useState(false);

  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { status: syncStatus, fetchStatus: syncStatusRefresh } = useSyncStatus();

  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

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
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Refresh file tree periodically
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 30_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [router]);

  // Unified keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lp.panelMaximized) { lp.handlePanelMaximize(); return; }
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
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lp.panelMaximized, ap.askPanelOpen, ap.desktopAskPopupOpen, ap.toggleAskPanel, lp]);

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
    <McpProvider>
    <>
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:font-display"
        style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
      >
        Skip to main content
      </a>

      {/* ── Desktop: Activity Bar + Panel ── */}
      <ActivityBar
        activePanel={lp.activePanel}
        onPanelChange={lp.setActivePanel}
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
      >
        <div className={`flex flex-col h-full ${lp.activePanel === 'search' ? '' : 'hidden'}`}>
          <SearchPanel active={lp.activePanel === 'search'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${lp.activePanel === 'plugins' ? '' : 'hidden'}`}>
          <PluginsPanel active={lp.activePanel === 'plugins'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${lp.activePanel === 'agents' ? '' : 'hidden'}`}>
          <AgentsPanel active={lp.activePanel === 'agents'} maximized={lp.panelMaximized} onMaximize={lp.handlePanelMaximize} />
        </div>
      </Panel>

      {/* ── Right-side Ask AI Panel ── */}
      <RightAskPanel
        open={ap.askPanelOpen}
        onClose={ap.closeAskPanel}
        currentFile={currentFile}
        initialMessage={ap.askInitialMessage}
        onFirstMessage={handleFirstMessage}
        width={ap.askPanelWidth}
        onWidthChange={ap.handleAskWidthChange}
        onWidthCommit={ap.handleAskWidthCommit}
        askMode={ap.askMode}
        onModeSwitch={ap.handleAskModeSwitch}
      />

      <AskModal
        open={ap.desktopAskPopupOpen}
        onClose={ap.closeDesktopAskPopup}
        currentFile={currentFile}
        initialMessage={ap.askInitialMessage}
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

      {mobileOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />}
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
          <FileTree nodes={fileTree} onNavigate={() => setMobileOpen(false)} />
        </div>
      </aside>

      <SearchModal open={mobileSearchOpen} onClose={() => setMobileSearchOpen(false)} />
      <AskModal open={mobileAskOpen} onClose={() => setMobileAskOpen(false)} currentFile={currentFile} />

      <main id="main-content" className="min-h-screen transition-all duration-200 pt-[52px] md:pt-0">
        <div className="min-h-screen bg-background">{children}</div>
      </main>

      <style>{`
        @media (min-width: 768px) {
          :root { --right-panel-width: ${ap.askPanelOpen ? ap.askPanelWidth : 0}px; }
          #main-content {
            padding-left: ${lp.panelOpen && lp.panelMaximized ? '100vw' : `${lp.panelOpen ? lp.railWidth + lp.effectivePanelWidth : lp.railWidth}px`} !important;
            padding-right: var(--right-panel-width) !important;
            padding-top: 0 !important;
          }
        }
      `}</style>
    </>
    </McpProvider>
    </WalkthroughProvider>
  );
}
