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

/**
 * Create a new Mind Space (top-level directory) with README.md + auto-scaffolded INSTRUCTION.md.
 * The description is written into README.md so it appears on the homepage Space card
 * and is loaded by Agent bootstrap as directory context.
 */
export async function createSpaceAction(
  name: string,
  description: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: 'Space name is required' };
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      return { success: false, error: 'Space name must not contain path separators' };
    }

    // Strip emoji for clean title in README content
    const cleanName = trimmed.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || trimmed;
    const desc = description.trim() || '(Describe the purpose and usage of this space.)';
    const readmeContent = `# ${cleanName}\n\n${desc}\n\n## 📁 Structure\n\n\`\`\`bash\n${trimmed}/\n├── INSTRUCTION.md\n├── README.md\n└── (your files here)\n\`\`\`\n\n## 💡 Usage\n\n(Add usage guidelines for this space.)\n`;

    // createFile triggers scaffoldIfNewSpace → auto-generates INSTRUCTION.md
    createFile(`${trimmed}/README.md`, readmeContent);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create space';
    // Make "already exists" error more user-friendly
    if (msg.includes('already exists')) {
      return { success: false, error: 'A space with this name already exists' };
    }
    return { success: false, error: msg };
  }
}
