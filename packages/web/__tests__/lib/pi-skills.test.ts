import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseSkillMd, readSkillContentByName } from '@/lib/pi-integration/skills';
import { generateSkillsXml } from '@/lib/agent/skills-xml';

let tempRoot: string;
let projectRoot: string;
let mindRoot: string;
let originalHome: string | undefined;

function writeSkill(baseDir: string, name: string, content: string) {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-pi-skills-'));
  projectRoot = path.join(tempRoot, 'project');
  mindRoot = path.join(tempRoot, 'mind');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(mindRoot, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = tempRoot;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('pi skill integration', () => {
  it('parses name and description from SKILL frontmatter', () => {
    const result = parseSkillMd('---\nname: test-skill\ndescription: useful helper\n---\n\nBody');
    expect(result).toEqual({ name: 'test-skill', description: 'useful helper' });
  });

  it('parses block scalar description', () => {
    const result = parseSkillMd('---\nname: test-skill\ndescription: >\n  multi line\n  description here\n---\n');
    expect(result.name).toBe('test-skill');
    expect(result.description).toContain('multi line');
    expect(result.description).toContain('description here');
  });

  it('returns empty for content without frontmatter', () => {
    const result = parseSkillMd('No frontmatter here');
    expect(result).toEqual({ name: '', description: '' });
  });

  it('reads skill content by name across skill directories', () => {
    writeSkill(path.join(mindRoot, '.skills'), 'user-skill', '---\nname: user-skill\ndescription: user skill\n---\n\nHello from user');

    const content = readSkillContentByName('user-skill', { projectRoot, mindRoot });
    expect(content).toContain('Hello from user');
  });

  it('reads skill from ~/.mindos/skills', () => {
    writeSkill(path.join(tempRoot, '.mindos', 'skills'), 'global-skill', '---\nname: global-skill\ndescription: global\n---\n\nHello from global');

    const content = readSkillContentByName('global-skill', { projectRoot, mindRoot });
    expect(content).toContain('Hello from global');
  });

  it('returns null for non-existent skill', () => {
    const content = readSkillContentByName('nonexistent', { projectRoot, mindRoot });
    expect(content).toBeNull();
  });

  it('prefers packages/web/data/skills over ~/.mindos/skills for same name', () => {
    writeSkill(path.join(projectRoot, 'packages', 'web', 'data', 'skills'), 'shared', '---\nname: shared\ndescription: builtin\n---\n\nBuiltin version');
    writeSkill(path.join(tempRoot, '.mindos', 'skills'), 'shared', '---\nname: shared\ndescription: global\n---\n\nGlobal version');

    const content = readSkillContentByName('shared', { projectRoot, mindRoot });
    expect(content).toContain('Builtin version');
  });
});

describe('generateSkillsXml', () => {
  it('generates valid XML for skill list', () => {
    const xml = generateSkillsXml([
      { name: 'context7', description: 'Look up library docs' },
      { name: 'test-skill', description: 'Run tests' },
    ]);

    expect(xml).toContain('<available_skills>');
    expect(xml).toContain('</available_skills>');
    expect(xml).toContain('<name>context7</name>');
    expect(xml).toContain('<description>Look up library docs</description>');
    expect(xml).toContain('<name>test-skill</name>');
    expect(xml).toContain('load_skill');
    expect(xml).not.toContain('<location>');
  });

  it('escapes XML entities in skill content', () => {
    const xml = generateSkillsXml([
      { name: 'test&skill', description: 'handles <special> "chars" & \'quotes\'' },
    ]);

    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
    expect(xml).not.toContain('<special>');
  });

  it('returns empty available_skills block for empty array', () => {
    const xml = generateSkillsXml([]);
    expect(xml).toContain('<available_skills>');
    expect(xml).toContain('</available_skills>');
    expect(xml).not.toContain('<skill>');
  });
});
