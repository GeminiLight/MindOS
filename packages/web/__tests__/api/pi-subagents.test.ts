/**
 * Tests for built-in pi-subagents extension support.
 *
 * Verifies that MindOS correctly bundles and loads pi-subagents as a default
 * extension, providing subagent tools (subagent, subagent_status) to the Agent.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DefaultResourceLoader, SettingsManager } from '@mariozechner/pi-coding-agent';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

describe('pi-subagents built-in extension', () => {
  describe('dependency installation', () => {
    it('pi-subagents is listed in package.json dependencies', () => {
      const pkgPath = path.join(PROJECT_ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      expect(pkg.dependencies).toHaveProperty('pi-subagents');
      expect(pkg.dependencies['pi-subagents']).toMatch(/^\^?0\.\d+\.\d+$/);
    });

    it('pi-subagents is installed in node_modules', () => {
      const indexPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'index.ts');
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('pi-subagents has expected structure (agents directory)', () => {
      const agentsDir = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'agents');
      expect(fs.existsSync(agentsDir)).toBe(true);

      // Should have builtin agents like scout.md, planner.md
      const agentFiles = fs.readdirSync(agentsDir);
      expect(agentFiles.some((f) => f.endsWith('.md'))).toBe(true);
    });
  });

  describe('extension path registration', () => {
    let askRouteContent: string;

    beforeAll(() => {
      const routePath = path.join(PROJECT_ROOT, 'app', 'api', 'ask', 'route.ts');
      askRouteContent = fs.readFileSync(routePath, 'utf-8');
    });

    it('ask/route.ts includes pi-subagents in additionalExtensionPaths', () => {
      expect(askRouteContent).toContain('pi-subagents');
      expect(askRouteContent).toContain("path.join(webAppDir, 'node_modules', 'pi-subagents', 'index.ts')");
    });

    it('ask/route.ts preserves the built-in schedule-prompt extension from the legacy app', () => {
      expect(askRouteContent).toContain('schedule-prompt');
      expect(askRouteContent).toContain("path.join(webAppDir, 'lib', 'schedule-prompt', 'index.ts')");
    });

    it('pi-subagents path is after user extensions (scanExtensionPaths)', () => {
      // User extensions should have priority, so scanExtensionPaths() comes first
      const scanIndex = askRouteContent.indexOf('scanExtensionPaths()');
      const subagentsIndex = askRouteContent.indexOf('pi-subagents');

      expect(scanIndex).toBeGreaterThan(-1);
      expect(subagentsIndex).toBeGreaterThan(scanIndex);
    });
  });

  describe('extension exports', () => {
    it('pi-subagents index.ts is valid TypeScript with default export', async () => {
      const indexPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');

      // Extension should have a default export function
      expect(content).toMatch(/export\s+default\s+function/);
    });

    it('pi-subagents registers subagent tool via pi.registerTool', async () => {
      const indexPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');

      // Should call pi.registerTool with the subagent tool
      expect(content).toContain('pi.registerTool');
      // Should have tool definition for 'subagent'
      expect(content).toMatch(/name:\s*['"]subagent['"]/);
    });
  });

  describe('runtime extension loading (integration)', () => {
    it('DefaultResourceLoader loads pi-subagents and exposes subagent tools', async () => {
      // This test mirrors the actual loading path used by /api/ask
      const settingsManager = SettingsManager.inMemory();
      const piSubagentsPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'index.ts');

      const loader = new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        settingsManager,
        systemPromptOverride: () => '',
        appendSystemPromptOverride: () => [],
        additionalSkillPaths: [],
        additionalExtensionPaths: [piSubagentsPath],
      });

      await loader.reload();
      const { extensions } = loader.getExtensions();

      // Find the pi-subagents extension
      const subagentsExt = extensions.find((ext) =>
        ext.path.includes('pi-subagents') || ext.resolvedPath?.includes('pi-subagents')
      );

      expect(subagentsExt).toBeDefined();

      // Verify tools are registered
      const toolNames = [...subagentsExt!.tools.keys()];
      expect(toolNames).toContain('subagent');
      expect(toolNames).toContain('subagent_status');
    });

    it('subagent tool is registered and available', async () => {
      const settingsManager = SettingsManager.inMemory();
      const piSubagentsPath = path.join(PROJECT_ROOT, 'node_modules', 'pi-subagents', 'index.ts');

      const loader = new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        settingsManager,
        systemPromptOverride: () => '',
        appendSystemPromptOverride: () => [],
        additionalSkillPaths: [],
        additionalExtensionPaths: [piSubagentsPath],
      });

      await loader.reload();
      const { extensions } = loader.getExtensions();
      const subagentsExt = extensions.find((ext) =>
        ext.path.includes('pi-subagents') || ext.resolvedPath?.includes('pi-subagents')
      );

      expect(subagentsExt).toBeDefined();

      // Both tools should be registered in the tools Map
      const subagentTool = subagentsExt!.tools.get('subagent');
      const statusTool = subagentsExt!.tools.get('subagent_status');

      expect(subagentTool).toBeDefined();
      expect(statusTool).toBeDefined();

      // The tool objects exist - the actual structure depends on pi-coding-agent internals
      // What matters is that the extension successfully registered both tools
      expect(subagentsExt!.tools.size).toBeGreaterThanOrEqual(2);
    });
  });
});
