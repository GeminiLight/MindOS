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

  it('scans MindOS and pi skill directories with precedence and metadata', () => {
    writeSkill(path.join(projectRoot, 'app', 'data', 'skills'), 'mindos', '---\nname: mindos\ndescription: builtin\n---\n');
    writeSkill(path.join(projectRoot, 'skills'), 'project-helper', '---\nname: project-helper\ndescription: project builtin\n---\n');
    writeSkill(path.join(mindRoot, '.skills'), 'user-helper', '---\nname: user-helper\ndescription: user custom\n---\n');
    writeSkill(path.join(projectRoot, '.pi', 'skills'), 'pi-local', '---\nname: pi-local\ndescription: local pi skill\n---\n');
    writeSkill(path.join(tempRoot, '.pi', 'agent', 'skills'), 'pi-global', '---\nname: pi-global\ndescription: global pi skill\n---\n');

    const skills = scanSkillDirs({ projectRoot, mindRoot, disabledSkills: ['pi-local'] });

    expect(skills.map((skill) => skill.name)).toEqual(['mindos', 'project-helper', 'user-helper', 'pi-local', 'pi-global']);
    expect(skills.find((skill) => skill.name === 'mindos')).toMatchObject({ source: 'builtin', editable: false, origin: 'app-builtin', enabled: true });
    expect(skills.find((skill) => skill.name === 'user-helper')).toMatchObject({ source: 'user', editable: true, origin: 'mindos-user', enabled: true });
    expect(skills.find((skill) => skill.name === 'pi-local')).toMatchObject({ source: 'user', editable: false, origin: 'pi-project', enabled: false });
    expect(skills.find((skill) => skill.name === 'pi-global')).toMatchObject({ source: 'user', editable: false, origin: 'pi-global', enabled: true });
  });

  it('reads skill content by name across pi-compatible directories', () => {
    writeSkill(path.join(projectRoot, '.pi', 'skills'), 'pi-local', '---\nname: pi-local\ndescription: local pi skill\n---\n\nHello from pi');

    const content = readSkillContentByName('pi-local', { projectRoot, mindRoot });
    expect(content).toContain('Hello from pi');
  });
});
