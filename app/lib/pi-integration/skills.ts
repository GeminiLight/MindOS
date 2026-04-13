import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ServerSettings } from '@/lib/settings';
import { getSkillSearchPaths } from '@/lib/agent/skill-paths';

export interface PiSkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  enabled: boolean;
  editable: boolean;
  origin: 'app-builtin' | 'project-builtin' | 'mindos-user' | 'mindos-global' | 'agents-global' | 'custom';
}

export interface ScanSkillOptions {
  projectRoot: string;
  mindRoot: string;
  disabledSkills?: string[];
  settings?: Pick<ServerSettings, 'skillPaths'>;
}

export function parseSkillMd(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)/m);
  
  let description = '';
  const blockMatch = yaml.match(/^description:\s*>?\s*\n((?:\s+.+\n?)*)/m);
  if (blockMatch && blockMatch[1].trim()) {
    description = blockMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s+/, ''))
      .filter(line => line.trim())
      .join(' ')
      .slice(0, 200);
  } else {
    const simpleMatch = yaml.match(/^description:\s*(.+)/m);
    if (simpleMatch) {
      const val = simpleMatch[1].trim();
      description = val === '>' ? '' : val.slice(0, 200);
    }
  }
  
  const name = nameMatch ? nameMatch[1].trim() : '';
  return { name, description };
}

/** Read the full content of a SKILL.md by skill name, searching multiple directories. */
export function readSkillContentByName(name: string, options: Omit<ScanSkillOptions, 'disabledSkills'>): string | null {
  const { projectRoot, mindRoot, settings } = options;

  for (const dir of getSkillSearchPaths(projectRoot, mindRoot, settings)) {
    const file = path.join(dir, name, 'SKILL.md');
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf-8');
    }
  }

  return null;
}
