'use client';

import { useMemo } from 'react';

interface JsonViewProps {
  content: string;
}

export default function JsonView({ content }: JsonViewProps) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <pre
      className="rounded-xl border border-border bg-card px-4 py-3 overflow-x-auto text-sm leading-relaxed font-display"
      suppressHydrationWarning
    >
      <code>{pretty}</code>
    </pre>
  );
}
