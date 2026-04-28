export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import { copyDir, dirExists } from '@/lib/file-ops';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { getProjectRoot } from '@/lib/project-root';

/**
 * Find the source path of a skill from the standard search directories.
 */
function findSkillSourcePath(skillName: string): string | null {
  const mindRoot = getMindRoot();
  const projectRoot = getProjectRoot();

  // Search in order of priority
  const searchDirs = [
    path.join(projectRoot, 'packages', 'web', 'data', 'skills', skillName),
    path.join(projectRoot, 'skills', skillName),
    path.join(mindRoot, '.skills', skillName),
    path.join(os.homedir(), '.mindos', 'skills', skillName),
  ];

  for (const dir of searchDirs) {
    if (dirExists(dir)) {
      return dir;
    }
  }

  return null;
}

/**
 * POST — Copy a skill to a target agent's skill directory.
 *
 * Request body:
 * {
 *   skillName: string;        // Name of the skill to copy
 *   targetPath: string;       // Target directory (e.g., "~/.qclaw/skills/")
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { skillName, targetPath } = body as { skillName?: string; targetPath?: string };

    if (!skillName?.trim()) {
      return NextResponse.json({ error: 'skillName is required' }, { status: 400 });
    }

    if (!targetPath?.trim()) {
      return NextResponse.json({ error: 'targetPath is required' }, { status: 400 });
    }

    // Validate skill name (prevent path traversal)
    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
      return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 });
    }

    // Validate target path (must be absolute or ~/ and no path traversal)
    const trimmedTarget = targetPath.trim();
    if (trimmedTarget.includes('..')) {
      return NextResponse.json({ error: 'Invalid target path' }, { status: 400 });
    }
    if (!trimmedTarget.startsWith('~/') && !trimmedTarget.startsWith('/')) {
      return NextResponse.json(
        { error: 'Target path must be absolute (starting with / or ~/)' },
        { status: 400 },
      );
    }

    // Find source skill
    const sourcePath = findSkillSourcePath(skillName);
    if (!sourcePath) {
      return NextResponse.json(
        { error: `Skill "${skillName}" not found` },
        { status: 404 },
      );
    }

    // Expand target path (support ~/)
    let expandedTargetPath = trimmedTarget.startsWith('~/')
      ? path.join(os.homedir(), trimmedTarget.slice(2))
      : trimmedTarget;

    // Ensure trailing slash stripped for joining
    expandedTargetPath = expandedTargetPath.replace(/\/$/, '');
    const targetSkillPath = path.join(expandedTargetPath, skillName);

    // Check target doesn't already exist
    if (dirExists(targetSkillPath)) {
      return NextResponse.json(
        { error: `Skill "${skillName}" already exists in target directory` },
        { status: 409 },
      );
    }

    // Copy skill
    await copyDir(sourcePath, targetSkillPath);

    return NextResponse.json({
      success: true,
      skillName,
      targetPath: targetSkillPath,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
