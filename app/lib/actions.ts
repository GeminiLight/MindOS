'use server';

import { createFile, deleteFile, renameFile, getMindRoot, invalidateCache } from '@/lib/fs';
import { createSpaceFilesystem } from '@/lib/core/create-space';
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

/**
 * Create a new Mind Space (top-level directory) with README.md + auto-scaffolded INSTRUCTION.md.
 * The description is written into README.md so it appears on the homepage Space card
 * and is loaded by Agent bootstrap as directory context.
 */
export async function createSpaceAction(
  name: string,
  description: string,
  parentPath: string = ''
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const { path: fullPath } = createSpaceFilesystem(getMindRoot(), name, description, parentPath);
    invalidateCache();
    revalidatePath('/', 'layout');
    return { success: true, path: fullPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create space';
    if (msg.includes('already exists')) {
      return { success: false, error: 'A space with this name already exists' };
    }
    return { success: false, error: msg };
  }
}
