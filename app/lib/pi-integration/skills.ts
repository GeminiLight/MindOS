import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PiSkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  enabled: boolean;
  editable: boolean;
  origin: 'app-builtin' | 'project-builtin' | 'mindos-user' | 'pi-project' | 'pi-global';
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
  const descMatch = yaml.match(/^description:\s*>?\s*\n?([\s\S]*?)(?=\n\w|\n---)/m);
  const name = nameMatch ? nameMatch[1].trim() : '';
  let description = '';
  if (descMatch) {
    description = descMatch[1].trim().split('\n').map((l) => l.trim()).join(' ').slice(0, 200);
  } else {
    const simpleDesc = yaml.match(/^description:\s*(.+)/m);
    if (simpleDesc) description = simpleDesc[1].trim().slice(0, 200);
  }
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
      origin: 'pi-project' as const,
      dir: path.join(projectRoot, '.pi', 'skills'),
      pathLabel: '.pi/skills',
      source: 'user' as const,
      editable: false,
    },
    {
      origin: 'pi-global' as const,
      dir: path.join(os.homedir(), '.pi', 'agent', 'skills'),
      pathLabel: '~/.pi/agent/skills',
      source: 'user' as const,
      editable: false,
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
