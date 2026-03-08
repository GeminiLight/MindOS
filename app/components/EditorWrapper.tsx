'use client';

import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./Editor'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full min-h-[400px] rounded-lg border border-zinc-800 bg-zinc-900 flex items-center justify-center">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
        <span>Loading editor...</span>
      </div>
    </div>
  ),
});

export default Editor;
