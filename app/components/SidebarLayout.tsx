'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Search, Settings, Menu, X } from 'lucide-react';
import ActivityBar, { type PanelId, RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from './ActivityBar';
import Panel, { PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH_ABS, MAX_PANEL_WIDTH_RATIO } from './Panel';
import FileTree from './FileTree';
import Logo from './Logo';
import SearchPanel from './panels/SearchPanel';
import PluginsPanel from './panels/PluginsPanel';
import AgentsPanel from './panels/AgentsPanel';
import RightAskPanel, { RIGHT_ASK_DEFAULT_WIDTH, RIGHT_ASK_MIN_WIDTH, RIGHT_ASK_MAX_WIDTH } from './RightAskPanel';
import AskFab from './AskFab';
import SyncPopover from './panels/SyncPopover';
import SearchModal from './SearchModal';
import AskModal from './AskModal';
import SettingsModal from './SettingsModal';
import { MobileSyncDot, useSyncStatus } from './SyncStatusBar';
import { useAskModal } from '@/hooks/useAskModal';
import { FileNode } from '@/lib/types';
import { useLocale } from '@/lib/LocaleContext';
import type { Tab } from './settings/types';

interface SidebarLayoutProps {
  fileTree: FileNode[];
  children: React.ReactNode;
}

export default function SidebarLayout({ fileTree, children }: SidebarLayoutProps) {
  const [activePanel, setActivePanel] = useState<PanelId | null>('files');
  const [mobileOpen, setMobileOpen] = useState(false);

  // Settings modal state — settings is a modal overlay, not a panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<Tab | undefined>(undefined);

  // Rail expanded state — persisted to localStorage
  const [railExpanded, setRailExpanded] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('rail-expanded') === 'true') setRailExpanded(true);
    } catch {}
  }, []);

  // Panel width state — shared across all left panels
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [panelMaximized, setPanelMaximized] = useState(false);

  // Load persisted panel width when activePanel changes
  useEffect(() => {
    if (!activePanel) return;
    try {
      const stored = localStorage.getItem('left-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH_ABS) {
          setPanelWidth(w);
          return;
        }
      }
    } catch {}
    setPanelWidth(280);
  }, [activePanel]);

  // Exit maximize when switching panels
  useEffect(() => { setPanelMaximized(false); }, [activePanel]);

  const handlePanelWidthChange = useCallback((w: number) => {
    setPanelWidth(w);
  }, []);

  const handlePanelWidthCommit = useCallback((w: number) => {
    try { localStorage.setItem('left-panel-width', String(w)); } catch {}
  }, []);

  const handlePanelMaximize = useCallback(() => {
    setPanelMaximized(v => !v);
  }, []);

  // ── Right-side Ask AI panel state (independent of left panel) ──
  const [askPanelOpen, setAskPanelOpen] = useState(false);
  const [askPanelWidth, setAskPanelWidth] = useState(RIGHT_ASK_DEFAULT_WIDTH);
  const [askMode, setAskMode] = useState<'panel' | 'popup'>('panel');
  // Desktop popup (distinct from mobileAskOpen)
  const [desktopAskPopupOpen, setDesktopAskPopupOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('right-ask-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= RIGHT_ASK_MIN_WIDTH && w <= RIGHT_ASK_MAX_WIDTH) setAskPanelWidth(w);
      }
      const mode = localStorage.getItem('ask-mode');
      if (mode === 'popup') setAskMode('popup');
    } catch {}

    // Listen for Settings → AskDisplayMode changes
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ask-mode' && (e.newValue === 'panel' || e.newValue === 'popup')) {
        setAskMode(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleAskWidthChange = useCallback((w: number) => { setAskPanelWidth(w); }, []);
  const handleAskWidthCommit = useCallback((w: number) => {
    try { localStorage.setItem('right-ask-panel-width', String(w)); } catch {}
  }, []);

  const toggleAskPanel = useCallback(() => {
    if (askMode === 'popup') {
      setDesktopAskPopupOpen(v => {
        if (!v) { setAskInitialMessage(''); setAskOpenSource('user'); }
        return !v;
      });
    } else {
      setAskPanelOpen(v => {
        if (!v) { setAskInitialMessage(''); setAskOpenSource('user'); }
        return !v;
      });
    }
  }, [askMode]);

  const closeAskPanel = useCallback(() => { setAskPanelOpen(false); }, []);
  const closeDesktopAskPopup = useCallback(() => { setDesktopAskPopupOpen(false); }, []);

  // Switch between panel ↔ popup mode
  const handleAskModeSwitch = useCallback(() => {
    setAskMode(prev => {
      const next = prev === 'panel' ? 'popup' : 'panel';
      try {
        localStorage.setItem('ask-mode', next);
        window.dispatchEvent(new StorageEvent('storage', { key: 'ask-mode', newValue: next }));
      } catch {}
      if (next === 'popup') {
        setAskPanelOpen(false);
        setDesktopAskPopupOpen(true);
      } else {
        setDesktopAskPopupOpen(false);
        setAskPanelOpen(true);
      }
      return next;
    });
  }, []);

  // Sync popover state
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [syncAnchorRect, setSyncAnchorRect] = useState<DOMRect | null>(null);

  // Mobile modals — kept for <768px
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileAskOpen, setMobileAskOpen] = useState(false);

  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { status: syncStatus, fetchStatus: syncStatusRefresh } = useSyncStatus();
  const askModal = useAskModal();

  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

  // AskPanel initial message from GuideCard bridge
  const [askInitialMessage, setAskInitialMessage] = useState('');
  const [askOpenSource, setAskOpenSource] = useState<'user' | 'guide' | 'guide-next'>('user');

  // Persist rail expanded state
  const handleExpandedChange = useCallback((expanded: boolean) => {
    setRailExpanded(expanded);
    setSyncPopoverOpen(false);
    try { localStorage.setItem('rail-expanded', String(expanded)); } catch {}
  }, []);

  // Bridge useAskModal store → right Ask panel or popup
  useEffect(() => {
    if (askModal.open) {
      setAskInitialMessage(askModal.initialMessage);
      setAskOpenSource(askModal.source);
      if (askMode === 'popup') {
        setDesktopAskPopupOpen(true);
      } else {
        setAskPanelOpen(true);
      }
      askModal.close();
    }
  }, [askModal.open, askModal.initialMessage, askModal.source, askModal.close, askMode]);

  // GuideCard first message handler
  const handleFirstMessage = useCallback(() => {
    const notifyGuide = () => window.dispatchEvent(new Event('guide-state-updated'));
    if (askOpenSource === 'guide') {
      fetch('/api/setup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideState: { askedAI: true } }),
      }).then(notifyGuide).catch((err) => console.warn('Guide state update failed:', err));
    } else if (askOpenSource === 'guide-next') {
      notifyGuide();
    }
  }, [askOpenSource]);

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
      // ESC exits panel maximize or closes right Ask panel/popup
      if (e.key === 'Escape') {
        if (panelMaximized) { setPanelMaximized(false); return; }
        if (askPanelOpen) { setAskPanelOpen(false); return; }
        if (desktopAskPopupOpen) { setDesktopAskPopupOpen(false); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          setActivePanel(p => p === 'search' ? null : 'search');
        } else {
          setMobileSearchOpen(v => !v);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          toggleAskPanel();
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
  }, [panelMaximized, askPanelOpen, desktopAskPopupOpen, toggleAskPanel]);

  const openSyncSettings = useCallback(() => {
    setSettingsTab('sync');
    setSyncPopoverOpen(false);
    setSettingsOpen(true);
  }, []);

  const handleSettingsClick = useCallback(() => {
    setSettingsOpen(true);
    setSettingsTab(undefined);
  }, []);

  const openSettingsTab = useCallback((tab: Tab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsTab(undefined);
  }, []);

  const closeSyncPopover = useCallback(() => setSyncPopoverOpen(false), []);

  const handleSyncClick = useCallback((rect: DOMRect) => {
    setSyncAnchorRect(rect);
    setSyncPopoverOpen(prev => !prev);
  }, []);

  const railWidth = railExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;
  const panelOpen = activePanel !== null;
  const effectivePanelWidth = panelWidth ?? (activePanel ? PANEL_WIDTH[activePanel] : 280);

  return (
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
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        syncStatus={syncStatus}
        expanded={railExpanded}
        onExpandedChange={handleExpandedChange}
        onSettingsClick={handleSettingsClick}
        onSyncClick={handleSyncClick}
      />

      <Panel
        activePanel={activePanel}
        fileTree={fileTree}
        onNavigate={() => {}}
        onOpenSyncSettings={openSyncSettings}
        railWidth={railWidth}
        panelWidth={panelWidth ?? undefined}
        onWidthChange={handlePanelWidthChange}
        onWidthCommit={handlePanelWidthCommit}
        maximized={panelMaximized}
        onMaximize={handlePanelMaximize}
      >
        {/* All panels always mounted — hidden/flex toggled to preserve state */}
        <div className={`flex flex-col h-full ${activePanel === 'search' ? '' : 'hidden'}`}>
          <SearchPanel active={activePanel === 'search'} maximized={panelMaximized} onMaximize={handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${activePanel === 'plugins' ? '' : 'hidden'}`}>
          <PluginsPanel active={activePanel === 'plugins'} maximized={panelMaximized} onMaximize={handlePanelMaximize} />
        </div>
        <div className={`flex flex-col h-full ${activePanel === 'agents' ? '' : 'hidden'}`}>
          <AgentsPanel
            active={activePanel === 'agents'}
            maximized={panelMaximized}
            onMaximize={handlePanelMaximize}
            onOpenSettings={openSettingsTab}
          />
        </div>
      </Panel>

      {/* ── Right-side Ask AI Panel (desktop, panel mode) ── */}
      <RightAskPanel
        open={askPanelOpen}
        onClose={closeAskPanel}
        currentFile={currentFile}
        initialMessage={askInitialMessage}
        onFirstMessage={handleFirstMessage}
        width={askPanelWidth}
        onWidthChange={handleAskWidthChange}
        onWidthCommit={handleAskWidthCommit}
        askMode={askMode}
        onModeSwitch={handleAskModeSwitch}
      />

      {/* ── Desktop Ask AI Popup (popup mode) ── */}
      <AskModal
        open={desktopAskPopupOpen}
        onClose={closeDesktopAskPopup}
        currentFile={currentFile}
        initialMessage={askInitialMessage}
        onFirstMessage={handleFirstMessage}
        askMode={askMode}
        onModeSwitch={handleAskModeSwitch}
      />

      {/* ── Ask AI FAB (desktop only — toggles right panel or popup) ── */}
      <AskFab onToggle={toggleAskPanel} askPanelOpen={askPanelOpen || desktopAskPopupOpen} />

      {/* ── Settings Modal (desktop overlay — does not affect panel) ── */}
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        initialTab={settingsTab}
      />

      {/* ── Sync Popover ── */}
      <SyncPopover
        open={syncPopoverOpen}
        onClose={closeSyncPopover}
        anchorRect={syncAnchorRect}
        railWidth={railWidth}
        onOpenSyncSettings={openSyncSettings}
        syncStatus={syncStatus}
        onSyncStatusRefresh={syncStatusRefresh}
      />

      {/* ── Mobile: Header Bar ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-30 bg-card border-b border-border flex items-center justify-between px-3 py-2" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={() => setMobileOpen(true)} className="p-3 -ml-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo id="mobile" />
          <span className="font-semibold text-foreground text-sm tracking-wide">MindOS</span>
        </Link>
        <div className="flex items-center gap-0.5">
          <button
            onClick={openSyncSettings}
            className="p-3 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent flex items-center justify-center"
            aria-label="Sync status"
          >
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

      {/* ── Mobile: Drawer overlay ── */}
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

      {/* ── Mobile: Modals (preserved for <768px) ── */}
      <SearchModal open={mobileSearchOpen} onClose={() => setMobileSearchOpen(false)} />
      <AskModal open={mobileAskOpen} onClose={() => setMobileAskOpen(false)} currentFile={currentFile} />

      {/* ── Main Content ── */}
      <main
        id="main-content"
        className="min-h-screen transition-all duration-200 pt-[52px] md:pt-0"
      >
        <div className="min-h-screen bg-background">
          {children}
        </div>
      </main>

      {/* Desktop padding via <style> — avoids hydration mismatch from window checks */}
      <style>{`
        @media (min-width: 768px) {
          :root { --right-panel-width: ${askPanelOpen ? askPanelWidth : 0}px; }
          #main-content {
            padding-left: ${panelOpen && panelMaximized ? '100vw' : `${panelOpen ? railWidth + effectivePanelWidth : railWidth}px`} !important;
            padding-right: var(--right-panel-width) !important;
            padding-top: 0 !important;
          }
        }
      `}</style>
    </>
  );
}
