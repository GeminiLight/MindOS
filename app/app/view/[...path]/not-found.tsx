'use client';

import { usePathname, useRouter } from 'next/navigation';
import { FilePlus, Home, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';

export default function ViewNotFound() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const [creating, setCreating] = useState(false);

  // Extract the attempted file path from /view/...
  const filePath = pathname.startsWith('/view/')
    ? decodeURIComponent(pathname.slice('/view/'.length))
    : '';

  const parentDir = filePath.includes('/')
    ? filePath.split('/').slice(0, -1).join('/')
    : '';

  const isMd = filePath.endsWith('.md') || !filePath.includes('.');
  const displayPath = filePath || 'unknown';

  const notFoundT = t.notFound;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const target = isMd && !filePath.includes('.') ? `${filePath}.md` : filePath;
      const res = await fetch('/api/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target, content: '' }),
      });
      if (res.ok) {
        router.replace(`/view/${encodePath(target)}`);
        router.refresh();
      }
    } catch {
      // silent — user can retry
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="content-width px-4 md:px-6 py-16 md:py-24 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-6">
        <FilePlus size={24} className="text-muted-foreground" />
      </div>

      <h1 className="text-lg font-semibold tracking-tight text-foreground mb-2">
        {notFoundT?.title ?? 'File not found'}
      </h1>

      <p className="text-sm text-muted-foreground mb-1">
        <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">{displayPath}</code>
      </p>
      <p className="text-sm text-muted-foreground mb-8">
        {notFoundT?.description ?? 'This file does not exist in your knowledge base.'}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {isMd && (
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
          >
            <FilePlus size={14} />
            {creating
              ? (notFoundT?.creating ?? 'Creating...')
              : (notFoundT?.createButton ?? 'Create this file')}
          </button>
        )}

        {parentDir && (
          <button
            onClick={() => router.push(`/view/${encodePath(parentDir)}`)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft size={14} />
            {notFoundT?.goToParent ?? 'Go to parent folder'}
          </button>
        )}

        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Home size={14} />
          {notFoundT?.goHome ?? 'Home'}
        </button>
      </div>
    </div>
  );
}
