export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readSettings, writeSettings } from '@/lib/settings';
import { parseSkillMd, readSkillContentByName } from '@/lib/pi-integration/skills';
import { loadSkills, type Skill } from '@mariozechner/pi-coding-agent';
import { generateJsonETag, setPublicCacheHeaders } from '@/lib/api-cache-headers';
import { handleRouteErrorSimple } from '@/lib/errors';
import { getSkillSearchPaths } from '@/lib/agent/skill-paths';
import { getProjectRoot } from '@/lib/project-root';

const PROJECT_ROOT = getProjectRoot();

function getMindRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}

export async function GET() {
  try {
    const settings = readSettings();
    const disabledSkills = settings.disabledSkills ?? [];
    const mindRoot = getMindRoot();

    const skillSearchPaths = getSkillSearchPaths(PROJECT_ROOT, mindRoot, settings);

    const { skills: frameworkSkills } = loadSkills({
      cwd: PROJECT_ROOT,
      skillPaths: skillSearchPaths,
      includeDefaults: false,
    });

    const userSkillsDir = path.join(mindRoot, '.skills');
    const globalSkillsDir = path.join(os.homedir(), '.mindos', 'skills');
    const agentsSkillsDir = path.join(os.homedir(), '.agents', 'skills');
    const appBuiltinDir = path.join(PROJECT_ROOT, 'packages', 'web', 'data', 'skills');
    // Custom paths from settings — skills in these dirs are user-editable
    const customDirs = (settings.skillPaths?.custom ?? []).map(p => p.trim()).filter(Boolean);

    const skills = frameworkSkills.map((s: Skill) => {
      const fp = s.filePath;
      const isUserKb = fp.startsWith(userSkillsDir);
      const isGlobal = fp.startsWith(globalSkillsDir);
      const isAgents = fp.startsWith(agentsSkillsDir);
      const isCustom = customDirs.some(d => fp.startsWith(d));
      const isAppBuiltin = fp.startsWith(appBuiltinDir);

      return {
        name: s.name,
        description: s.description,
        path: fp,
        source: (isUserKb || isGlobal || isAgents || isCustom) ? 'user' as const : 'builtin' as const,
        enabled: !disabledSkills.includes(s.name),
        editable: isUserKb || isGlobal || isAgents || isCustom,
        origin: isAppBuiltin ? 'app-builtin' as const
          : isUserKb ? 'mindos-user' as const
          : isGlobal ? 'mindos-global' as const
          : isAgents ? 'agents-global' as const
          : isCustom ? 'custom' as const
          : 'project-builtin' as const,
      };
    });

    const data = { skills };
    const response = NextResponse.json(data);
    
    // ── Cache control: 5 minutes ──
    // Skill definitions are stable unless skills are installed/removed/toggled.
    // Cache significantly improves list loading performance (100+ skills).
    const etag = generateJsonETag(data);
    return setPublicCacheHeaders(response, 300, etag);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, name, description, content, enabled, sourcePath } = body as {
      action: 'create' | 'update' | 'delete' | 'toggle' | 'read' | 'read-native' | 'record-install';
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
        const builtinDir = path.join(PROJECT_ROOT, 'packages', 'web', 'data', 'skills', name);
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
        const content = readSkillContentByName(name, { projectRoot: PROJECT_ROOT, mindRoot, settings });
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

      case 'record-install': {
        // Record that a skill was installed to a specific agent (for auto-update tracking)
        const agentKey = (body as { agentKey?: string }).agentKey;
        const skillName = name;
        const installPath = (body as { installPath?: string }).installPath;
        if (!agentKey || !skillName || !installPath) {
          return NextResponse.json({ error: 'agentKey, name, and installPath are required' }, { status: 400 });
        }
        const { recordSkillInstall } = await import('@/lib/settings');
        recordSkillInstall(agentKey, skillName, installPath);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
