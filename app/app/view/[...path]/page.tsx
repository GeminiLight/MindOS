import { notFound } from 'next/navigation';
import { getFileContent, saveFileContent, isDirectory, getDirEntries } from '@/lib/fs';
import ViewPageClient from './ViewPageClient';
import DirView from '@/components/DirView';
import Papa from 'papaparse';

interface PageProps {
  params: Promise<{ path: string[] }>;
}

export default async function ViewPage({ params }: PageProps) {
  const { path: segments } = await params;
  const filePath = segments.map(decodeURIComponent).join('/');

  // Directory: show folder listing
  if (isDirectory(filePath)) {
    const entries = getDirEntries(filePath);
    return <DirView dirPath={filePath} entries={entries} />;
  }

  let content: string;
  try {
    content = getFileContent(filePath);
  } catch {
    notFound();
  }

  const extension = filePath.split('.').pop()?.toLowerCase() || '';

  async function saveAction(newContent: string) {
    'use server';
    saveFileContent(filePath, newContent);
  }

  async function appendRowAction(newRow: string[]): Promise<{ newContent: string }> {
    'use server';
    const current = getFileContent(filePath);
    const parsed = Papa.parse<string[]>(current, { skipEmptyLines: true });
    const rows = parsed.data as string[][];
    rows.push(newRow);
    const newContent = Papa.unparse(rows);
    saveFileContent(filePath, newContent);
    return { newContent };
  }

  return (
    <ViewPageClient
      filePath={filePath}
      content={content!}
      extension={extension}
      saveAction={saveAction}
      appendRowAction={extension === 'csv' ? appendRowAction : undefined}
    />
  );
}


