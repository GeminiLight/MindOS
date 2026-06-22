'use client';

import { useSearchParams } from 'next/navigation';
import ChangesContentPage from '@/components/changes/ChangesContentPage';

type SourceFilter = 'all' | 'agent' | 'user' | 'system';

function parseSource(value: string | null): SourceFilter {
  if (value === 'agent' || value === 'user' || value === 'system') return value;
  return 'all';
}

export default function ChangelogClient() {
  const params = useSearchParams();
  return <ChangesContentPage initialPath={params.get('path') ?? ''} initialSource={parseSource(params.get('source'))} />;
}
