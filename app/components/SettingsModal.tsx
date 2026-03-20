'use client';

import SettingsContent from './settings/SettingsContent';
import type { Tab } from './settings/types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
}

export default function SettingsModal({ open, onClose, initialTab }: SettingsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Settings" className="w-full md:max-w-3xl md:mx-4 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col h-[88vh] md:h-[80vh] md:max-h-[85vh]">
        <SettingsContent
          visible={open}
          variant="modal"
          onClose={onClose}
          initialTab={initialTab}
        />
      </div>
    </div>
  );
}
