'use client';

import { useLocale } from '@/lib/stores/locale-store';
import AskContent from '@/components/ask/AskContent';
import type { AcpAgentSelection, AskAgentRuntimeSelection } from '@/hooks/useAskModal';

interface AskModalProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
  initialMessage?: string;
  initialAcpAgent?: AcpAgentSelection | null;
  initialAgentRuntime?: AskAgentRuntimeSelection | null;
  onFirstMessage?: () => void;
}

export default function AskModal({ open, onClose, currentFile, initialMessage, initialAcpAgent, initialAgentRuntime, onFirstMessage }: AskModalProps) {
  const { t } = useLocale();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-app-modal flex items-end md:items-start justify-center md:pt-[10vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.ask.title}
        className="w-full md:max-w-2xl md:mx-4 bg-card border-t md:border border-border/60 rounded-t-xl md:rounded-xl shadow-xl flex flex-col h-[92vh] md:h-auto md:max-h-[75vh]"
      >
        <AskContent
          visible={open}
          variant="modal"
          onClose={onClose}
          currentFile={currentFile}
          initialMessage={initialMessage}
          initialAcpAgent={initialAcpAgent}
          initialAgentRuntime={initialAgentRuntime}
          onFirstMessage={onFirstMessage}
        />
      </div>
    </div>
  );
}
