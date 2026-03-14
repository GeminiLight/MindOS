'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import AskModal from './AskModal';

export default function AskFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const currentFile = pathname.startsWith('/view/')
    ? pathname.slice('/view/'.length).split('/').map(decodeURIComponent).join('/')
    : undefined;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
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

      <AskModal open={open} onClose={() => setOpen(false)} currentFile={currentFile} />
    </>
  );
}
