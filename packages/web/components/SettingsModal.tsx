'use client';

import SettingsContent from './settings/SettingsContent';
import type { Tab } from './settings/types';
import { Dialog } from '@base-ui/react/dialog';
import { useLocale } from '@/lib/stores/locale-store';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  onOpenPluginEntries?: () => void;
  onOpenCommandCenter?: () => void;
}

export default function SettingsModal({
  open,
  onClose,
  initialTab,
  onOpenPluginEntries,
  onOpenCommandCenter,
}: SettingsModalProps) {
  const { t } = useLocale();
  return (
    <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <Dialog.Portal keepMounted>
        <Dialog.Backdrop hidden={!open} className="fixed inset-0 z-app-modal modal-backdrop" />
        <Dialog.Popup hidden={!open} aria-label={t.settings.title} className="fixed bottom-0 left-1/2 z-app-modal flex h-[88dvh] w-full -translate-x-1/2 flex-col overflow-hidden rounded-t-xl border-t border-border bg-card shadow-xl outline-none md:bottom-auto md:top-[10dvh] md:h-[80dvh] md:max-h-[85dvh] md:w-[calc(100%-2rem)] md:max-w-4xl md:rounded-xl md:border lg:max-w-5xl">
          <SettingsContent
            visible={open}
            variant="modal"
            onClose={onClose}
            initialTab={initialTab}
            onOpenPluginEntries={onOpenPluginEntries}
            onOpenCommandCenter={onOpenCommandCenter}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
