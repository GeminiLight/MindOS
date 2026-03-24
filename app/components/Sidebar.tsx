'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Search, PanelLeftClose, PanelLeftOpen, Menu, X, Settings } from 'lucide-react';
import FileTree from './FileTree';
import SearchModal from './SearchModal';
import AskModal from './AskModal';
import SettingsModal from './SettingsModal';
import SyncStatusBar, { SyncDot, MobileSyncDot, useSyncStatus } from './SyncStatusBar';
import { FileNode } from '@/lib/types';
import type { Tab } from './settings/types';
import { useLocale } from '@/lib/LocaleContext';

interface SidebarProps {
  fileTree: FileNode[];
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

const Logo = ({ id }: { id: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" fill="none" className="w-8 h-4 text-[var(--amber)]" aria-hidden="true">
    <defs>
      <linearGradient id={`grad-human-${id}`} x1="35" y1="20" x2="5" y2="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.8"/>
        <stop offset="100%" stopColor="currentColor" stopOpacity="0.3"/>
      </linearGradient>
      <linearGradient id={`grad-agent-${id}`} x1="35" y1="20" x2="75" y2="20" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.8"/>
        <stop offset="100%" stopColor="currentColor" stopOpacity="1"/>
      </linearGradient>
    </defs>
    <path d="M35,20 C25,35 8,35 8,20 C8,5 25,5 35,20" stroke={`url(#grad-human-${id})`} strokeWidth="3" strokeDasharray="2 4" strokeLinecap="round"/>
    <path d="M35,20 C45,2 75,2 75,20 C75,38 45,38 35,20" stroke={`url(#grad-agent-${id})`} strokeWidth="4.5" strokeLinecap="round"/>
    <path d="M35,17.5 Q35,20 37.5,20 Q35,20 35,22.5 Q35,20 32.5,20 Q35,20 35,17.5 Z" fill="#FEF3C7"/>
  </svg>
);

export default function Sidebar({ fileTree, collapsed = false, onCollapse, onExpand }: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<Tab | undefined>(undefined);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useLocale();
  const router = useRouter();

  // Shared sync status for collapsed dot & mobile dot
  const { status: syncStatus } = useSyncStatus();

  const pathname = usePathname();
  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

  // Refresh file tree when tab becomes visible (catches external changes from
  // MCP agents, CLI edits, or other browser tabs) and periodically while visible.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Light periodic refresh every 30s while tab is visible
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); setAskOpen(v => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setSettingsOpen(v => !v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const openSyncSettings = () => { setSettingsTab('sync'); setSettingsOpen(true); };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="shrink-0 electron-mac-titlebar-pad" />
      <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo id="desktop" />
          <span className="font-semibold text-foreground text-sm tracking-wide font-display">MindOS</span>
        </Link>
        {/* Mobile close */}
        <button onClick={() => setMobileOpen(false)} className="md:hidden p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
        {/* Desktop action buttons — trimmed to 4 */}
        <div className="hidden md:flex items-center gap-1">
          <button onClick={() => setSearchOpen(true)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.sidebar.searchTitle} aria-label={t.sidebar.searchTitle}>
            <Search size={15} />
          </button>
          <button onClick={() => setSettingsOpen(true)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.sidebar.settingsTitle} aria-label={t.sidebar.settingsTitle}>
            <Settings size={15} />
          </button>
          <button onClick={onCollapse} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.sidebar.collapseTitle} aria-label={t.sidebar.collapseTitle}>
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
        <FileTree nodes={fileTree} onNavigate={() => setMobileOpen(false)} />
      </div>
      <SyncStatusBar
        collapsed={collapsed}
        onOpenSyncSettings={openSyncSettings}
      />
    </div>
  );

  return (
    <>
      <aside className={`sidebar-panel hidden md:flex fixed top-0 left-0 h-screen w-[280px] z-30 bg-card border-r border-border flex-col transition-transform duration-300 ${collapsed ? '-translate-x-full' : 'translate-x-0'}`}>
        {sidebarContent}
      </aside>

      {/* #7 — Collapsed sidebar: expand button with sync health dot */}
      {collapsed && (
        <div className="hidden md:flex fixed top-4 left-0 z-30 flex-col items-center gap-2">
          <button onClick={onExpand} className="relative flex items-center justify-center w-6 h-10 bg-card border border-border rounded-r-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={t.sidebar.expandTitle}>
            <PanelLeftOpen size={14} />
            <SyncDot status={syncStatus} />
          </button>
        </div>
      )}

      {/* Mobile navbar */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-30 bg-card border-b border-border flex items-center justify-between px-3 py-2" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={() => setMobileOpen(true)} className="p-3 -ml-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo id="mobile" />
          <span className="font-semibold text-foreground text-sm tracking-wide">MindOS</span>
        </Link>
        <div className="flex items-center gap-0.5">
          {/* #8 — Mobile sync dot: visible when there's a problem */}
          <button
            onClick={openSyncSettings}
            className="p-3 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent flex items-center justify-center"
            aria-label="Sync status"
          >
            <MobileSyncDot status={syncStatus} />
          </button>
          <button onClick={() => setSearchOpen(true)} className="p-3 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label={t.sidebar.searchTitle}>
            <Search size={20} />
          </button>
          <button onClick={() => setSettingsOpen(true)} className="p-3 -mr-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors active:bg-accent" aria-label={t.sidebar.settingsTitle}>
            <Settings size={20} />
          </button>
        </div>
      </header>

      {mobileOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />}

      <aside className={`md:hidden fixed top-0 left-0 h-screen w-[85vw] max-w-[320px] z-50 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {sidebarContent}
      </aside>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AskModal open={askOpen} onClose={() => setAskOpen(false)} currentFile={currentFile} />
      <SettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); setSettingsTab(undefined); }} initialTab={settingsTab} />
    </>
  );
}
