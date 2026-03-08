'use server';

import { createFile, deleteFile, renameFile } from '@/lib/fs';
import { revalidatePath } from 'next/cache';

export async function createFileAction(dirPath: string, fileName: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const name = fileName.trim();
    if (!name) return { success: false, error: 'File name is required' };
    // Ensure extension
    const hasExt = name.endsWith('.md') || name.endsWith('.csv');
    const finalName = hasExt ? name : `${name}.md`;
    const filePath = dirPath ? `${dirPath}/${finalName}` : finalName;
    createFile(filePath);
    revalidatePath('/', 'layout');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create file' };
  }
}

export async function deleteFileAction(filePath: string): Promise<{ success: boolean; error?: string }> {
  try {
    deleteFile(filePath);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete file' };
  }
}

export async function renameFileAction(oldPath: string, newName: string): Promise<{ success: boolean; newPath?: string; error?: string }> {
  try {
    const newPath = renameFile(oldPath, newName);
    revalidatePath('/', 'layout');
    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to rename file' };
  }
}
