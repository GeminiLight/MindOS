'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { TodoRenderer } from '@/components/renderers/todo/TodoRenderer';
import type { RendererContext } from '@/lib/renderers/registry';

interface TodoClientProps {
  content: string;
  exists: boolean;
  saveAction: (content: string) => Promise<void>;
}

export default function TodoClient({ content, exists, saveAction }: TodoClientProps) {
  if (!exists) {
    return (
      <div className="content-width py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No TODO.md found. Create a <code className="text-xs bg-muted px-1.5 py-0.5 rounded">TODO.md</code> file in your workspace to get started.
        </p>
      </div>
    );
  }

  const ctx: RendererContext = {
    filePath: 'TODO.md',
    content,
    extension: 'md',
    saveAction,
  };

  return (
    <div className="content-width py-2">
      <div className="flex items-center justify-end mb-2">
        <Link
          href="/view/TODO.md"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <FileText size={13} />
          <span>Markdown</span>
        </Link>
      </div>
      <TodoRenderer {...ctx} />
    </div>
  );
}
