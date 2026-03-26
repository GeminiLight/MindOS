import { MindOSError, ErrorCodes } from '@/lib/errors';
import { createFile } from './fs-ops';

/**
 * Generate the template README.md content for a new space.
 * Extracted so both createSpaceFilesystem and revert can produce identical content.
 */
export function generateReadmeTemplate(fullPath: string, name: string, description: string): string {
  const cleanName = name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || name;
  const desc = description.trim() || '(Describe the purpose and usage of this space.)';
  return `# ${cleanName}\n\n${desc}\n\n## 📁 Structure\n\n\`\`\`bash\n${fullPath}/\n├── INSTRUCTION.md\n├── README.md\n└── (your files here)\n\`\`\`\n\n## 💡 Usage\n\n(Add usage guidelines for this space.)\n`;
}

/**
 * Create a Mind Space on disk: `{fullPath}/README.md` plus scaffold from {@link createFile} / scaffoldIfNewSpace.
 * Caller must invalidate app file-tree cache (e.g. `invalidateCache()` in `lib/fs.ts`).
 */
export function createSpaceFilesystem(
  mindRoot: string,
  name: string,
  description: string,
  parentPath = '',
): { path: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Space name is required', { name });
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new MindOSError(ErrorCodes.INVALID_PATH, 'Space name must not contain path separators', { name: trimmed });
  }

  const cleanParent = parentPath.replace(/\/+$/, '').trim();
  if (cleanParent.includes('..') || cleanParent.startsWith('/') || cleanParent.includes('\\')) {
    throw new MindOSError(ErrorCodes.INVALID_PATH, 'Invalid parent path', { parentPath });
  }

  const prefix = cleanParent ? `${cleanParent}/` : '';
  const fullPath = `${prefix}${trimmed}`;
  const readmeContent = generateReadmeTemplate(fullPath, trimmed, description);

  createFile(mindRoot, `${fullPath}/README.md`, readmeContent);
  return { path: fullPath };
}
