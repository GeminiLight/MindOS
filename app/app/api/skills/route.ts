export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readSettings, writeSettings } from '@/lib/settings';

const PROJECT_ROOT = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');

function getMindRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  enabled: boolean;
  editable: boolean;
}

function parseSkillMd(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)/m);
  const descMatch = yaml.match(/^description:\s*>?\s*\n?([\s\S]*?)(?=\n\w|\n---)/m);
  const name = nameMatch ? nameMatch[1].trim() : '';
  let description = '';
  if (descMatch) {
    description = descMatch[1].trim().split('\n').map(l => l.trim()).join(' ').slice(0, 200);
  } else {
    const simpleDesc = yaml.match(/^description:\s*(.+)/m);
    if (simpleDesc) description = simpleDesc[1].trim().slice(0, 200);
  }
  return { name, description };
}

function scanSkillDirs(disabledSkills: string[]): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  // 1. app/data/skills/ — builtin
  const builtinDir = path.join(PROJECT_ROOT, 'app', 'data', 'skills');
  if (fs.existsSync(builtinDir)) {
    for (const entry of fs.readdirSync(builtinDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(builtinDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf-8');
      const { name, description } = parseSkillMd(content);
      const skillName = name || entry.name;
      seen.add(skillName);
      skills.push({
        name: skillName,
        description,
        path: `app/data/skills/${entry.name}/SKILL.md`,
        source: 'builtin',
        enabled: !disabledSkills.includes(skillName),
        editable: false,
      });
    }
  }

  // 2. skills/ — project root builtin
  const skillsDir = path.join(PROJECT_ROOT, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf-8');
      const { name, description } = parseSkillMd(content);
      const skillName = name || entry.name;
      if (seen.has(skillName)) continue; // already listed from app/data/skills/
      seen.add(skillName);
      skills.push({
        name: skillName,
        description,
        path: `skills/${entry.name}/SKILL.md`,
        source: 'builtin',
        enabled: !disabledSkills.includes(skillName),
        editable: false,
      });
    }
  }

  // 3. {mindRoot}/.skills/ — user custom
  const mindRoot = getMindRoot();
  const userSkillsDir = path.join(mindRoot, '.skills');
  if (fs.existsSync(userSkillsDir)) {
    for (const entry of fs.readdirSync(userSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(userSkillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf-8');
      const { name, description } = parseSkillMd(content);
      const skillName = name || entry.name;
      if (seen.has(skillName)) continue;
      seen.add(skillName);
      skills.push({
        name: skillName,
        description,
        path: `{mindRoot}/.skills/${entry.name}/SKILL.md`,
        source: 'user',
        enabled: !disabledSkills.includes(skillName),
        editable: true,
      });
    }
  }

  return skills;
}

export async function GET() {
  try {
    const settings = readSettings();
    const disabledSkills = settings.disabledSkills ?? [];
    const skills = scanSkillDirs(disabledSkills);
    return NextResponse.json({ skills });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, name, description, content, enabled } = body as {
      action: 'create' | 'update' | 'delete' | 'toggle' | 'read';
      name?: string;
      description?: string;
      content?: string;
      enabled?: boolean;
    };

    const settings = readSettings();
    const mindRoot = getMindRoot();
    const userSkillsDir = path.join(mindRoot, '.skills');

    // Validate skill name — prevent path traversal
    if (name && !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return NextResponse.json({ error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' }, { status: 400 });
    }

    switch (action) {
      case 'toggle': {
        if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
        const disabled = settings.disabledSkills ?? [];
        if (enabled === false) {
          if (!disabled.includes(name)) disabled.push(name);
        } else {
          const idx = disabled.indexOf(name);
          if (idx >= 0) disabled.splice(idx, 1);
        }
        writeSettings({ ...settings, disabledSkills: disabled });
        return NextResponse.json({ ok: true });
      }

      case 'create': {
        if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
        // Check for conflicts with builtin
        const builtinDir = path.join(PROJECT_ROOT, 'app', 'data', 'skills', name);
        const skillsRootDir = path.join(PROJECT_ROOT, 'skills', name);
        if (fs.existsSync(builtinDir) || fs.existsSync(skillsRootDir)) {
          return NextResponse.json({ error: 'A built-in skill with this name already exists' }, { status: 409 });
        }
        const skillDir = path.join(userSkillsDir, name);
        if (fs.existsSync(skillDir)) {
          return NextResponse.json({ error: 'A skill with this name already exists' }, { status: 409 });
        }
        fs.mkdirSync(skillDir, { recursive: true });
        // If content already has frontmatter, use it as-is; otherwise build frontmatter
        const fileContent = content && content.trimStart().startsWith('---')
          ? content
          : `---\nname: ${name}\ndescription: ${description || name}\n---\n\n${content || ''}`;
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), fileContent, 'utf-8');
        return NextResponse.json({ ok: true });
      }

      case 'update': {
        if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
        const skillDir = path.join(userSkillsDir, name);
        if (!fs.existsSync(skillDir)) {
          return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (content !== undefined) {
          fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
        }
        return NextResponse.json({ ok: true });
      }

      case 'delete': {
        if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
        const skillDir = path.join(userSkillsDir, name);
        if (!fs.existsSync(skillDir)) {
          return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        fs.rmSync(skillDir, { recursive: true, force: true });
        return NextResponse.json({ ok: true });
      }

      case 'read': {
        if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
        const dirs = [
          path.join(PROJECT_ROOT, 'app', 'data', 'skills', name),
          path.join(PROJECT_ROOT, 'skills', name),
          path.join(userSkillsDir, name),
        ];
        for (const dir of dirs) {
          const file = path.join(dir, 'SKILL.md');
          if (fs.existsSync(file)) {
            return NextResponse.json({ content: fs.readFileSync(file, 'utf-8') });
          }
        }
        return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
