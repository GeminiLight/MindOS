// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStudioProject,
  findStudioProject,
  getStudioProjectHref,
  readStudioProjects,
  STUDIO_PROJECTS,
} from '@/lib/studio-projects';

describe('studio projects', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('includes the default projects when no custom projects exist', () => {
    const projects = readStudioProjects();

    expect(projects.map((project) => project.id)).toEqual(STUDIO_PROJECTS.map((project) => project.id));
  });

  it('creates a trimmed custom project and persists it before defaults', () => {
    const project = createStudioProject({
      title: '  Growth Room  ',
      goal: '  Train launch review habits  ',
      space: '  Product Strategy  ',
      kit: '  Review Kit  ',
      workArea: '  Session drafts  ',
    });

    expect(project).toMatchObject({
      id: 'growth-room',
      title: 'Growth Room',
      goal: 'Train launch review habits',
      space: 'Product Strategy',
      kits: ['Review Kit'],
      workArea: 'Session drafts',
    });
    expect(readStudioProjects()[0]?.id).toBe('growth-room');
  });

  it('keeps project routes segment-local and url encoded', () => {
    expect(getStudioProjectHref('launch-practice')).toBe('/studio/launch-practice');
    expect(getStudioProjectHref('产品 发布')).toBe('/studio/%E4%BA%A7%E5%93%81%20%E5%8F%91%E5%B8%83');
  });

  it('keeps the Next app route at /studio/[projectId]', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/studio/[projectId]/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'app/studio/projects/[projectId]/page.tsx'))).toBe(false);
  });

  it('suffixes duplicate ids against defaults and custom projects', () => {
    const first = createStudioProject({
      title: 'Launch Practice',
      goal: 'A different launch practice',
      space: '',
      kit: '',
      workArea: '',
    });
    const second = createStudioProject({
      title: 'Launch Practice',
      goal: 'Another launch practice',
      space: '',
      kit: '',
      workArea: '',
    });

    expect(first.id).toBe('launch-practice-2');
    expect(second.id).toBe('launch-practice-3');
    expect(findStudioProject(readStudioProjects(), second.id)?.goal).toBe('Another launch practice');
  });

  it('ignores corrupt localStorage payloads and keeps default projects available', () => {
    localStorage.setItem('mindos:studio-projects', '{broken');

    expect(readStudioProjects().map((project) => project.id)).toEqual(STUDIO_PROJECTS.map((project) => project.id));
  });
});
