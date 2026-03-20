'use client';

import { useLocale } from '@/lib/LocaleContext';
import AskContent from '@/components/ask/AskContent';

interface AskModalProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
  initialMessage?: string;
  onFirstMessage?: () => void;
  askMode?: 'panel' | 'popup';
  onModeSwitch?: () => void;
}

export default function AskModal({ open, onClose, currentFile, initialMessage, onFirstMessage, askMode, onModeSwitch }: AskModalProps) {
  const { t } = useLocale();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.ask.title}
        className="w-full md:max-w-2xl md:mx-4 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col h-[92vh] md:h-auto md:max-h-[75vh]"
      >
        <AskContent
          visible={open}
          variant="modal"
          onClose={onClose}
          currentFile={currentFile}
          initialMessage={initialMessage}
          onFirstMessage={onFirstMessage}
          askMode={askMode}
          onModeSwitch={onModeSwitch}
        />
      </div>
    </div>
  );
}
