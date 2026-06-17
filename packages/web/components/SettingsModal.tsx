'use client';

import SettingsContent from './settings/SettingsContent';
import type { Tab } from './settings/types';

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
  return (
    <div style={{ display: open ? undefined : 'none' }}>
      <div
        className="fixed inset-0 z-app-modal flex items-end md:items-start justify-center md:pt-[10vh] modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div role="dialog" aria-modal="true" aria-label="Settings" className="w-full md:max-w-4xl lg:max-w-5xl md:mx-4 bg-card border-t md:border border-border rounded-t-xl md:rounded-xl shadow-xl flex flex-col h-[88vh] md:h-[80vh] md:max-h-[85vh] overflow-hidden">
          <SettingsContent
            visible={open}
            variant="modal"
            onClose={onClose}
            initialTab={initialTab}
            onOpenPluginEntries={onOpenPluginEntries}
            onOpenCommandCenter={onOpenCommandCenter}
          />
        </div>
      </div>
    </div>
  );
}
