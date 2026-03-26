'use server';

import fs from 'fs';
import path from 'path';
import { createFile, deleteFile, deleteDirectory, convertToSpace, renameFile, renameSpace, getMindRoot, invalidateCache, collectAllFiles } from '@/lib/fs';
import { createSpaceFilesystem, generateReadmeTemplate } from '@/lib/core/create-space';
import { INSTRUCTION_TEMPLATE, cleanDirName } from '@/lib/core/space-scaffold';
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

export async function convertToSpaceAction(
  dirPath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    convertToSpace(dirPath);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to convert to space' };
  }
}

export async function deleteFolderAction(
  dirPath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    deleteDirectory(dirPath);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete folder' };
  }
}

export async function renameSpaceAction(
  spacePath: string,
  newName: string,
): Promise<{ success: boolean; newPath?: string; error?: string }> {
  try {
    const newPath = renameSpace(spacePath, newName);
    revalidatePath('/', 'layout');
    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to rename space' };
  }
}

export async function deleteSpaceAction(
  spacePath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    deleteDirectory(spacePath);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete space' };
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

/**
 * Revert AI-generated space content back to scaffold templates.
 * Called when user discards AI initialization from SpaceInitToast.
 */
export async function revertSpaceInitAction(
  spacePath: string,
  name: string,
  description: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const mindRoot = getMindRoot();
    const absDir = path.resolve(mindRoot, spacePath);
    if (!absDir.startsWith(mindRoot)) {
      return { success: false, error: 'Invalid path' };
    }

    const readmePath = path.join(absDir, 'README.md');
    const instructionPath = path.join(absDir, 'INSTRUCTION.md');

    const readmeContent = generateReadmeTemplate(spacePath, name, description);
    fs.writeFileSync(readmePath, readmeContent, 'utf-8');

    const dirName = cleanDirName(name);
    fs.writeFileSync(instructionPath, INSTRUCTION_TEMPLATE(dirName), 'utf-8');

    invalidateCache();
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to revert' };
  }
}

const EXAMPLE_PREFIX = '🧪_example_';

export async function scanExampleFilesAction(): Promise<{ files: string[] }> {
  const all = collectAllFiles();
  const examples = all.filter(f => path.basename(f).startsWith(EXAMPLE_PREFIX));
  return { files: examples };
}

export async function cleanupExamplesAction(): Promise<{ success: boolean; deleted: number; error?: string }> {
  try {
    const { files } = await scanExampleFilesAction();
    if (files.length === 0) return { success: true, deleted: 0 };

    const root = getMindRoot();
    for (const relPath of files) {
      const absPath = path.resolve(root, relPath);
      if (absPath.startsWith(root) && fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
    }

    // Clean up empty directories left behind
    const dirs = new Set(files.map(f => path.dirname(path.resolve(root, f))));
    const sortedDirs = [...dirs].sort((a, b) => b.length - a.length);
    for (const dir of sortedDirs) {
      try {
        if (dir.startsWith(root) && dir !== root) {
          const entries = fs.readdirSync(dir);
          if (entries.length === 0) fs.rmdirSync(dir);
        }
      } catch { /* directory not empty or already removed */ }
    }

    invalidateCache();
    revalidatePath('/', 'layout');
    return { success: true, deleted: files.length };
  } catch (err) {
    return { success: false, deleted: 0, error: err instanceof Error ? err.message : 'Failed to cleanup' };
  }
}
