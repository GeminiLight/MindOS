import fs from 'fs';
import os from 'os';
import path from 'path';

export interface PiSkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  enabled: boolean;
  editable: boolean;
  origin: 'app-builtin' | 'project-builtin' | 'mindos-user' | 'mindos-global';
}

export interface ScanSkillOptions {
  projectRoot: string;
  mindRoot: string;
  disabledSkills?: string[];
}

export function parseSkillMd(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)/m);
  
  // Try to match block scalar (description: >) first
  // Captures all indented lines until next non-indented line or EOF
  let description = '';
  const blockMatch = yaml.match(/^description:\s*>?\s*\n((?:\s+.+\n?)*)/m);
  if (blockMatch && blockMatch[1].trim()) {
    // Block scalar: join indented lines, dedent, preserve structure
    description = blockMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s+/, '')) // Remove leading spaces
      .filter(line => line.trim()) // Remove empty lines
      .join(' ')
      .slice(0, 200);
  } else {
    // Fallback to single-line description
    const simpleMatch = yaml.match(/^description:\s*(.+)/m);
    if (simpleMatch) {
      const val = simpleMatch[1].trim();
      // Skip the ">" character if it's there (fallback from block scalar)
      description = val === '>' ? '' : val.slice(0, 200);
    }
  }
  
  const name = nameMatch ? nameMatch[1].trim() : '';
  return { name, description };
}

export function getPiSkillSearchDirs(projectRoot: string, mindRoot: string) {
  return [
    {
      origin: 'app-builtin' as const,
      dir: path.join(projectRoot, 'app', 'data', 'skills'),
      pathLabel: 'app/data/skills',
      source: 'builtin' as const,
      editable: false,
    },
    {
      origin: 'project-builtin' as const,
      dir: path.join(projectRoot, 'skills'),
      pathLabel: 'skills',
      source: 'builtin' as const,
      editable: false,
    },
    {
      origin: 'mindos-user' as const,
      dir: path.join(mindRoot, '.skills'),
      pathLabel: '{mindRoot}/.skills',
      source: 'user' as const,
      editable: true,
    },
    {
      origin: 'mindos-global' as const,
      dir: path.join(os.homedir(), '.mindos', 'skills'),
      pathLabel: '~/.mindos/skills',
      source: 'user' as const,
      editable: true,
    },
  ];
}

export function scanSkillDirs(options: ScanSkillOptions): PiSkillInfo[] {
  const { projectRoot, mindRoot, disabledSkills = [] } = options;
  const skills: PiSkillInfo[] = [];
  const seen = new Set<string>();

  for (const sourceDef of getPiSkillSearchDirs(projectRoot, mindRoot)) {
    if (!fs.existsSync(sourceDef.dir)) continue;

    for (const entry of fs.readdirSync(sourceDef.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(sourceDef.dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, 'utf-8');
      const { name, description } = parseSkillMd(content);
      const skillName = name || entry.name;
      if (!skillName || seen.has(skillName)) continue;

      seen.add(skillName);
      skills.push({
        name: skillName,
        description,
        path: `${sourceDef.pathLabel}/${entry.name}/SKILL.md`,
        source: sourceDef.source,
        enabled: !disabledSkills.includes(skillName),
        editable: sourceDef.editable,
        origin: sourceDef.origin,
      });
    }
  }

  return skills;
}

export function readSkillContentByName(name: string, options: Omit<ScanSkillOptions, 'disabledSkills'>): string | null {
  const { projectRoot, mindRoot } = options;

  for (const sourceDef of getPiSkillSearchDirs(projectRoot, mindRoot)) {
    const file = path.join(sourceDef.dir, name, 'SKILL.md');
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf-8');
    }
  }

  return null;
}
