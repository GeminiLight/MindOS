'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import AskModal from './AskModal';
import { useAskModal } from '@/hooks/useAskModal';

export default function AskFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

  // Listen to useAskModal store for cross-component open requests (e.g. from GuideCard)
  const askModal = useAskModal();
  const [initialMessage, setInitialMessage] = useState('');
  const [openSource, setOpenSource] = useState<'user' | 'guide' | 'guide-next'>('user');

  useEffect(() => {
    if (askModal.open) {
      setInitialMessage(askModal.initialMessage);
      setOpenSource(askModal.source);
      setOpen(true);
      askModal.close(); // Reset store state after consuming
    }
  }, [askModal.open, askModal.initialMessage, askModal.source, askModal.close]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setInitialMessage('');
    setOpenSource('user');
  }, []);

  // Dispatch correct PATCH based on how the modal was opened
  const handleFirstMessage = useCallback(() => {
    const notifyGuide = () => window.dispatchEvent(new Event('guide-state-updated'));

    if (openSource === 'guide') {
      // Task ② completion: mark askedAI
      fetch('/api/setup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideState: { askedAI: true } }),
      }).then(notifyGuide).catch(() => {});
    } else if (openSource === 'guide-next') {
      // Next-step advancement: GuideCard already PATCHed nextStepIndex optimistically.
      // Just notify GuideCard to re-fetch for consistency; no additional PATCH needed.
      notifyGuide();
    }
    // For 'user' source: no guide action needed
  }, [openSource]);

  return (
    <>
      <button
        onClick={() => { setInitialMessage(''); setOpenSource('user'); setOpen(true); }}
        className="
          group
          fixed z-40
          bottom-5 right-5
          md:bottom-5 md:right-5
          flex items-center justify-center
          gap-0 hover:gap-2
          p-3 md:p-[11px] rounded-xl
          text-white font-medium text-[13px]
          shadow-md shadow-amber-900/15
          transition-all duration-200 ease-out
          hover:shadow-lg hover:shadow-amber-800/25
          active:scale-95
          cursor-pointer
          overflow-hidden
          font-display
        "
        style={{
          background: 'linear-gradient(135deg, #b07c2e 0%, #c8873a 50%, #d4943f 100%)',
          marginBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        title="MindOS Agent (⌘/)"
        aria-label="MindOS Agent"
      >
        <Sparkles size={16} className="relative z-10 shrink-0" />

        <span className="
          relative z-10
          max-w-0 group-hover:max-w-[120px]
          opacity-0 group-hover:opacity-100
          transition-all duration-200 ease-out
          whitespace-nowrap overflow-hidden
        ">
          MindOS Agent
        </span>
      </button>

      <AskModal
        open={open}
        onClose={handleClose}
        currentFile={currentFile}
        initialMessage={initialMessage}
        onFirstMessage={handleFirstMessage}
      />
    </>
  );
}
