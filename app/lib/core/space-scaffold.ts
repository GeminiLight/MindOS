/**
 * Auto-scaffolding for new top-level directories (Spaces).
 *
 * When a file is created inside a new first-level directory that lacks
 * INSTRUCTION.md, this module generates lightweight scaffolding files
 * so that MindOS Agents can bootstrap correctly in any Space.
 *
 * Design decisions:
 * - Only acts on first-level directories (direct children of mindRoot)
 * - Idempotent: never overwrites existing files
 * - Fail-safe: errors are silently caught (scaffold must never block file ops)
 * - Does NOT modify root README.md (that's the Agent's job per INSTRUCTION.md §5.1)
 */
import fs from 'fs';
import path from 'path';

export const INSTRUCTION_TEMPLATE = (dirName: string) =>
  `# ${dirName} Instruction Set

## Goal

- Define local execution rules for this directory.

## Local Rules

- Read root \`INSTRUCTION.md\` first.
- Then read this directory \`README.md\` for navigation.
- Keep edits minimal, structured, and traceable.

## Execution Order

1. Root \`INSTRUCTION.md\`
2. This directory \`INSTRUCTION.md\`
3. This directory \`README.md\` and target files

## Boundary

- Root rules win on conflict.
`;

export const README_TEMPLATE = (dirName: string) =>
  `# ${dirName}

## 📁 Structure

\`\`\`bash
${dirName}/
├── INSTRUCTION.md
├── README.md
└── (your files here)
\`\`\`

## 💡 Usage

(Describe the purpose and usage of this space.)
`;

/**
 * Strip leading emoji and whitespace from a directory name.
 * e.g. "📖 Learning" → "Learning", "🔄 Workflows" → "Workflows"
 */
export function cleanDirName(dirName: string): string {
  // Match leading emoji (Unicode emoji properties) + whitespace
  const cleaned = dirName.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '');
  return cleaned || dirName; // fallback to original if everything was stripped
}

/**
 * If filePath is inside a top-level directory that lacks INSTRUCTION.md,
 * auto-generate scaffolding files.
 *
 * - Only triggered by createFile (not writeFile) — see spec for rationale
 * - Idempotent: won't overwrite existing files
 * - Only acts on first-level directories (direct children of mindRoot)
 */
export function scaffoldIfNewSpace(mindRoot: string, filePath: string): void {
  try {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length < 2) return; // root-level file, not inside a Space

    const topDir = parts[0];
    if (topDir.startsWith('.')) return; // skip hidden directories

    const topDirAbs = path.join(mindRoot, topDir);
    const instructionPath = path.join(topDirAbs, 'INSTRUCTION.md');

    // Already has INSTRUCTION.md → not a new Space, skip
    if (fs.existsSync(instructionPath)) return;

    const name = cleanDirName(topDir);

    // Generate INSTRUCTION.md
    fs.writeFileSync(instructionPath, INSTRUCTION_TEMPLATE(name), 'utf-8');

    // Generate README.md only if it doesn't exist
    const readmePath = path.join(topDirAbs, 'README.md');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(readmePath, README_TEMPLATE(name), 'utf-8');
    }
  } catch {
    // Scaffold failure must never block the primary file operation
  }
}
