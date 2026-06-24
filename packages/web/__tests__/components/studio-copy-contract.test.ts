import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Studio Chinese copy contract', () => {
  it('uses 工作台 / 项目 / 对话 for the Studio product vocabulary', () => {
    const files = [
      'components/studio/StudioContent.tsx',
      'components/studio/StudioAutomationSection.tsx',
      'components/studio/StudioProjectContent.tsx',
      'components/panels/StudioPanel.tsx',
      'lib/i18n/modules/ai-chat-zh.ts',
      'lib/i18n/modules/knowledge-zh.ts',
      'lib/i18n/modules/navigation-zh.ts',
      'lib/i18n/modules/onboarding-zh.ts',
      'lib/i18n/modules/panels-zh.ts',
      'lib/i18n/modules/settings-zh.ts',
    ];
    const source = files
      .map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'))
      .join('\n');
    const extractZhCopy = (file: string) => {
      const fileSource = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
      const start = fileSource.indexOf('  zh: {');
      const end = fileSource.indexOf('\n  },\n} as const;', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return fileSource.slice(start, end);
    };
    const studioZhCopy = [
      'components/studio/StudioContent.tsx',
      'components/studio/StudioAutomationSection.tsx',
      'components/studio/StudioProjectContent.tsx',
      'components/panels/StudioPanel.tsx',
    ].map(extractZhCopy).join('\n');
    const studioPanelSource = fs.readFileSync(path.resolve(process.cwd(), 'components/panels/StudioPanel.tsx'), 'utf8');

    expect(source).toContain("title: '工作台'");
    expect(source).toContain("studio: '工作台'");
    expect(studioPanelSource).toContain("overview: '总览'");
    expect(studioPanelSource).toContain("automation: '自动化'");
    expect(source).toContain("returnStudio: '返回工作台'");
    expect(source).toContain("newProject: '新建项目'");
    expect(source).toContain("createTitle: '新建项目'");
    expect(source).toContain("createTitle: '创建自动化'");
    expect(source).toContain("newSession: '新建对话'");
    expect(source).toContain("historicalSessions: '对话历史'");
    expect(source).toContain("files: '心智'");
    expect(source).toContain("homeMindFiles: '心智文件'");
    expect(source).toContain("builtInSpacesTitle: '心智系统'");
    expect(source).toContain("builtInSpacesDesc: ''");
    expect(source).toContain("spaceLabel: '心智空间'");
    expect(source).toContain("mindRoot: '心智'");
    expect(source).toContain("navAssistant: '助理'");
    expect(source).toContain("title: '助理'");
    expect(source).toContain("organizationAgentTitle: '收集箱整理助理'");
    expect(source).toContain("description: '用于长期 AI 工作、复盘和成长的项目工作面。默认显示。'");
    expect(source).toContain("workDirs: '工作目录'");
    expect(source).toContain("aiKits: 'AI 套件'");
    expect(source).toContain("review: '复盘'");
    expect(source).toContain("kitLabel: 'AI 套件'");
    expect(source).toContain("workAreaLabel: '工作目录'");
    expect(source).toContain("kitPlaceholder: '研究套件'");
    expect(source).toContain("kits: 'AI 套件'");
    expect(source).toContain("directory: '工作目录'");
    expect(source).toContain("review: '复盘队列'");

    expect(source).not.toContain('用四个内置空间整理你的知识。');
    expect(source).not.toContain("title: 'Studio',\n    overview: 'Overview',\n    newProject: '新建 Project'");
    expect(studioPanelSource).not.toContain("overview: '概览'");
    expect(source).not.toContain("returnStudio: '返回 Studio'");
    expect(source).not.toContain("newSession: '新建 Session'");
    expect(source).not.toContain("createTitle: '新建 Project'");
    expect(source).not.toContain("titleLabel: 'Project 名称'");
    expect(source).not.toContain("navAssistant: 'Assistant'");
    expect(source).not.toContain("addAssistant: '添加 Assistant'");
    expect(source).not.toContain("organizeToMindAction: '整理到 Mind'");
    expect(source).not.toContain("organizationAgentTitle: '收集箱整理助手'");
    expect(studioZhCopy).not.toContain("workDirs: 'Work dirs'");
    expect(studioZhCopy).not.toContain("aiKits: 'AI Kits'");
    expect(studioZhCopy).not.toContain("kitLabel: 'AI Kit'");
    expect(studioZhCopy).not.toContain("workAreaLabel: 'WorkDir'");
    expect(studioZhCopy).not.toContain("kitPlaceholder: 'Research Kit'");
    expect(studioZhCopy).not.toContain("kits: 'AI Kits'");
    expect(studioZhCopy).not.toContain("directory: 'WorkDir'");
    expect(studioZhCopy).not.toContain("review: 'Review queue'");
  });
});
