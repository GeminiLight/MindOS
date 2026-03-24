import { MindOSError, ErrorCodes } from '@/lib/errors';
import { createFile } from './fs-ops';

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

  const cleanName = trimmed.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || trimmed;
  const desc = description.trim() || '(Describe the purpose and usage of this space.)';
  const readmeContent = `# ${cleanName}\n\n${desc}\n\n## 📁 Structure\n\n\`\`\`bash\n${fullPath}/\n├── INSTRUCTION.md\n├── README.md\n└── (your files here)\n\`\`\`\n\n## 💡 Usage\n\n(Add usage guidelines for this space.)\n`;

  createFile(mindRoot, `${fullPath}/README.md`, readmeContent);
  return { path: fullPath };
}
