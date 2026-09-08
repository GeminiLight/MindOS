'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X, Inbox, FolderOpen, DraftingCompass, Radio, Bot, Compass } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { MOBILE_SIDEBAR } from '@/lib/config/panel-sizes';
import { useLocale } from '@/lib/stores/locale-store';
import { getContentRoutePanel, ROUTE_PANEL_HREF } from '@/lib/navigation-panel';

const destinations = [
  { id: 'capture', icon: Inbox }, { id: 'files', icon: FolderOpen },
  { id: 'studio', icon: DraftingCompass }, { id: 'echo', icon: Radio },
  { id: 'agents', icon: Bot }, { id: 'discover', icon: Compass },
] as const;

export const MOBILE_DRAWER_BREAKPOINT_PX = 768;

interface MobileNavigationDrawerProps {
  open: boolean;
  viewportWidth: number;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

export default function MobileNavigationDrawer({ open, viewportWidth, onClose, triggerRef, children }: MobileNavigationDrawerProps) {
  const { t } = useLocale();
  const currentPanel = getContentRoutePanel(usePathname());
  const closeRef = useRef<HTMLButtonElement>(null);
  const desktop = viewportWidth >= MOBILE_DRAWER_BREAKPOINT_PX;
  const visible = open && !desktop;

  // CSS hiding alone leaves the modal state alive and the page inaccessible.
  useEffect(() => { if (open && desktop) onClose(); }, [open, desktop, onClose]);

  return (
    <Dialog.Root open={visible} onOpenChange={next => { if (!next) onClose(); }}
      onOpenChangeComplete={next => {
        // A breakpoint change hides the old trigger; return to visible content.
        if (!next && window.innerWidth >= MOBILE_DRAWER_BREAKPOINT_PX) document.getElementById('main-content')?.focus();
      }}>
      <Dialog.Portal keepMounted>
        <Dialog.Backdrop className="md:hidden fixed inset-0 z-40 overlay-backdrop transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup
          aria-label={t.sidebar.mobileMenuTitle}
          initialFocus={closeRef}
          // Base UI resolves a container to its first tabbable child. The completion
          // callback handles desktop explicitly so the reading region itself wins.
          finalFocus={() => window.innerWidth >= MOBILE_DRAWER_BREAKPOINT_PX ? false : triggerRef.current}
          className="md:hidden fixed top-0 left-0 h-dvh z-50 bg-card border-r border-border flex flex-col outline-none transition-transform duration-200 ease-out data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full"
          style={{ width: MOBILE_SIDEBAR.WIDTH, maxWidth: MOBILE_SIDEBAR.MAX_WIDTH, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <Link href="/" onClick={onClose} className="min-h-11 flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo id="drawer" />
              <span className="text-foreground text-sm font-brand">MindOS</span>
            </Link>
            <Dialog.Close ref={closeRef} className="min-h-11 min-w-11 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" aria-label={t.sidebar.closeMenu}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
            <nav aria-label={t.sidebar.mobileMenuTitle} className="grid grid-cols-2 gap-1 pb-3 mb-2 border-b border-border">
              {destinations.map(({ id, icon: Icon }) => (
                <Link key={id} href={ROUTE_PANEL_HREF[id]} onClick={onClose}
                  aria-current={currentPanel === id ? 'page' : undefined}
                  className={`min-h-11 flex items-center gap-2 rounded-lg px-3 text-sm transition-colors ${currentPanel === id ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  <Icon size={16} className="shrink-0" />{t.sidebar[id]}
                </Link>
              ))}
            </nav>
            {children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
