import { notFound } from 'next/navigation';
import { getFileContent, saveFileContent, isDirectory, getDirEntries, createFile, getFileTree, getSpacePreview } from '@/lib/fs';
import type { FileNode } from '@/lib/types';
import ViewPageClient from './ViewPageClient';
import DirView from '@/components/DirView';
import Papa from 'papaparse';

interface PageProps {
  params: Promise<{ path: string[] }>;
}

function collectDirectories(nodes: FileNode[]): string[] {
  const dirs: string[] = [];
  for (const n of nodes) {
    if (n.type === 'directory') {
      dirs.push(n.path);
      if (n.children) dirs.push(...collectDirectories(n.children));
    }
  }
  return dirs;
}

export default async function ViewPage({ params }: PageProps) {
  const { path: segments } = await params;
  const filePath = segments.map(decodeURIComponent).join('/');

  if (isDirectory(filePath)) {
    const entries = getDirEntries(filePath);
    const spacePreview = getSpacePreview(filePath);
    return <DirView dirPath={filePath} entries={entries} spacePreview={spacePreview} />;
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

  async function createDraftAction(targetPath: string, draftContent: string) {
    'use server';
    createFile(targetPath, draftContent);
  }

  let content = '';
  let exists = true;
  try {
    content = getFileContent(filePath);
  } catch {
    exists = false;
  }

  if (!exists) {
    // Special draft entry used by homepage "New Notes"
    if (filePath === 'Untitled.md') {
      const draftDirectories = collectDirectories(getFileTree());
      return (
        <ViewPageClient
          filePath={filePath}
          content=""
          extension="md"
          saveAction={saveAction}
          initialEditing
          isDraft
          draftDirectories={draftDirectories}
          createDraftAction={createDraftAction}
        />
      );
    }
    notFound();
  }

  return (
    <ViewPageClient
      filePath={filePath}
      content={content}
      extension={extension}
      saveAction={saveAction}
      appendRowAction={extension === 'csv' ? appendRowAction : undefined}
    />
  );
}
