import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseSkillMd, readSkillContentByName, scanSkillDirs } from '@/lib/pi-integration/skills';

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

  it('scans MindOS skill directories with precedence and metadata', () => {
    writeSkill(path.join(projectRoot, 'app', 'data', 'skills'), 'mindos', '---\nname: mindos\ndescription: builtin\n---\n');
    writeSkill(path.join(projectRoot, 'skills'), 'project-helper', '---\nname: project-helper\ndescription: project builtin\n---\n');
    writeSkill(path.join(mindRoot, '.skills'), 'user-helper', '---\nname: user-helper\ndescription: user custom\n---\n');
    writeSkill(path.join(tempRoot, '.mindos', 'skills'), 'global-helper', '---\nname: global-helper\ndescription: global skill\n---\n');

    const skills = scanSkillDirs({ projectRoot, mindRoot, disabledSkills: ['project-helper'] });

    expect(skills.map((skill) => skill.name)).toEqual(['mindos', 'project-helper', 'user-helper', 'global-helper']);
    expect(skills.find((skill) => skill.name === 'mindos')).toMatchObject({ source: 'builtin', editable: false, origin: 'app-builtin', enabled: true });
    expect(skills.find((skill) => skill.name === 'user-helper')).toMatchObject({ source: 'user', editable: true, origin: 'mindos-user', enabled: true });
    expect(skills.find((skill) => skill.name === 'project-helper')).toMatchObject({ source: 'builtin', editable: false, origin: 'project-builtin', enabled: false });
    expect(skills.find((skill) => skill.name === 'global-helper')).toMatchObject({ source: 'user', editable: true, origin: 'mindos-global', enabled: true });
  });

  it('knowledge base skill takes precedence over global skill with same name', () => {
    writeSkill(path.join(mindRoot, '.skills'), 'shared-skill', '---\nname: shared-skill\ndescription: from kb\n---\n');
    writeSkill(path.join(tempRoot, '.mindos', 'skills'), 'shared-skill', '---\nname: shared-skill\ndescription: from global\n---\n');

    const skills = scanSkillDirs({ projectRoot, mindRoot });
    const matched = skills.filter((s) => s.name === 'shared-skill');
    expect(matched).toHaveLength(1);
    expect(matched[0].origin).toBe('mindos-user');
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
});
