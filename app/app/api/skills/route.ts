export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readSettings, writeSettings } from '@/lib/settings';
import { parseSkillMd, readSkillContentByName, scanSkillDirs } from '@/lib/pi-integration/skills';

const PROJECT_ROOT = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');

function getMindRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}

export async function GET() {
  try {
    const settings = readSettings();
    const disabledSkills = settings.disabledSkills ?? [];
    const skills = scanSkillDirs({
      projectRoot: PROJECT_ROOT,
      mindRoot: getMindRoot(),
      disabledSkills,
    });
    return NextResponse.json({ skills });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, name, description, content, enabled, sourcePath } = body as {
      action: 'create' | 'update' | 'delete' | 'toggle' | 'read' | 'read-native';
      name?: string;
      description?: string;
      content?: string;
      enabled?: boolean;
      sourcePath?: string;
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
        const content = readSkillContentByName(name, { projectRoot: PROJECT_ROOT, mindRoot });
        if (!content) {
          return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        return NextResponse.json({ content });
      }

      case 'read-native': {
        if (!name || !sourcePath) return NextResponse.json({ error: 'name and sourcePath required' }, { status: 400 });
        const nativeBase = path.resolve(sourcePath);
        const nativeSkillFile = path.join(nativeBase, name, 'SKILL.md');
        if (!nativeSkillFile.startsWith(nativeBase)) {
          return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
        }
        if (!fs.existsSync(nativeSkillFile)) {
          return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        const nativeContent = fs.readFileSync(nativeSkillFile, 'utf-8');
        const { description: nativeDesc } = parseSkillMd(nativeContent);
        return NextResponse.json({ content: nativeContent, description: nativeDesc });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
