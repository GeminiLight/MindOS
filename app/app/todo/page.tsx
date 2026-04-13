import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import { getFileContent, saveFileContent } from '@/lib/fs';
import TodoClient from './TodoClient';

export const dynamic = 'force-dynamic';

export default async function TodoPage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  let content = '';
  let exists = true;
  try {
    content = getFileContent('TODO.md');
  } catch {
    exists = false;
  }

  async function saveAction(newContent: string) {
    'use server';
    saveFileContent('TODO.md', newContent);
  }

  return <TodoClient content={content} exists={exists} saveAction={saveAction} />;
}
