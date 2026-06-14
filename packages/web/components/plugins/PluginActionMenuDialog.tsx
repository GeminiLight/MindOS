'use client';

import { Check, Loader2, Menu as MenuIcon, MousePointer2 } from 'lucide-react';
import type { PluginMenuSnapshot } from '@/lib/plugins/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PluginActionMenuDialogProps {
  menu: PluginMenuSnapshot | null;
  onClose: () => void;
  onChooseItem?: (menu: PluginMenuSnapshot, item: PluginMenuSnapshot['items'][number]) => void;
  choosingItemIndex?: number | null;
  choiceError?: string | null;
}

export default function PluginActionMenuDialog({
  menu,
  onClose,
  onChooseItem,
  choosingItemIndex = null,
  choiceError = null,
}: PluginActionMenuDialogProps) {
  if (!menu) return null;

  const items = menu.items.filter((item) => item.separator || item.title.trim().length > 0);
  const canChooseItems = Boolean(onChooseItem && menu.interactionId);

  return (
    <Dialog open={Boolean(menu)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border/70 bg-card/75 px-5 py-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
            <MenuIcon size={14} />
          </span>
          <div className="min-w-0">
            <DialogTitle id="plugin-action-menu-title" className="truncate text-sm font-semibold">
              Plugin menu
            </DialogTitle>
            <DialogDescription className="sr-only">
              Plugin menu snapshot from the Obsidian compatibility host.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            {canChooseItems ? 'Choose a menu item to continue in the MindOS compatibility host.' : 'Safe plugin menu snapshot.'}
          </div>

          <div className="flex items-center gap-1.5 text-2xs uppercase text-muted-foreground">
            <MousePointer2 size={11} />
            {menu.source === 'position' ? 'Position menu' : 'Mouse menu'}
          </div>

          <div className="overflow-hidden rounded-lg border border-border/70 bg-card/70">
            {items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No menu items were recorded.</div>
            ) : (
              items.map((item) => (
                item.separator ? (
                  <div key={`${menu.id}:${item.index}`} className="border-t border-border/70" />
                ) : (
                  <button
                    key={`${menu.id}:${item.index}`}
                    type="button"
                    disabled={!canChooseItems || !item.canRun || item.disabled === true || choosingItemIndex !== null}
                    onClick={() => onChooseItem?.(menu, item)}
                    className={`flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 ${item.disabled ? 'text-muted-foreground/60' : 'text-foreground'}`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--amber)]">
                      {item.checked ? <Check size={13} /> : null}
                    </span>
                    {item.icon && (
                      <span className="shrink-0 rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                        {item.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.disabled && <span className="shrink-0 text-2xs text-muted-foreground">Disabled</span>}
                    {choosingItemIndex === item.index && <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />}
                  </button>
                )
              ))
            )}
          </div>
          {choiceError && (
            <div className="rounded-lg border border-[var(--error)]/25 bg-[var(--error)]/10 px-3 py-2 text-xs text-[var(--error)]">
              {choiceError}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 flex-row rounded-none border-t border-border/70 bg-card/95 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
