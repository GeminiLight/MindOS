export const dynamic = 'force-dynamic';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import {
  MCP_AGENTS,
  expandHome,
  detectInstalled,
  detectAgentPresence,
  detectAgentRuntimeSignals,
  detectAgentConfiguredMcpServers,
  detectAgentInstalledSkills,
  resolveSkillWorkspaceProfile,
  parseJsonc,
} from '@/lib/mcp-agents';
import { getAllAgents, loadCustomAgents, scanCustomAgentSkills, toAgentDef } from '@/lib/custom-agents';
import { readSettings } from '@/lib/settings';
import { loadSkills } from '@mariozechner/pi-coding-agent';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { getProjectRoot } from '@/lib/project-root';

async function enrichMindOsAgent(agent: Record<string, unknown>) {
  agent.present = true;
  agent.installed = true;
  agent.scope = 'builtin';

  try {
    const settings = readSettings();
    const port = Number(process.env.MINDOS_MCP_PORT) || settings.mcpPort || 8781;
    agent.transport = `http :${port}`;
  } catch {
    agent.transport = 'http :8781';
  }

  try {
    const projectRoot = getProjectRoot();
    const mindRoot = getMindRoot();
    const { skills } = loadSkills({
      cwd: projectRoot,
      skillPaths: [
        path.join(projectRoot, 'packages', 'web', 'data', 'skills'),
        path.join(projectRoot, 'skills'),
        path.join(mindRoot, '.skills'),
        path.join(os.homedir(), '.mindos', 'skills'),
      ],
      includeDefaults: false,
    });
    agent.installedSkillNames = skills.map(s => s.name);
    agent.installedSkillCount = skills.length;
    agent.installedSkillSourcePath = path.join(projectRoot, 'skills');
    agent.skillMode = 'universal';
    agent.skillWorkspacePath = path.join(os.homedir(), '.agents', 'skills');
  } catch { /* skill scan unavailable */ }

  const mcpConfigPath = path.join(os.homedir(), '.mindos', 'mcp.json');
  try {
    if (fs.existsSync(mcpConfigPath)) {
      const raw = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      const servers = Object.keys(raw.mcpServers ?? {});
      agent.configuredMcpServers = servers;
      agent.configuredMcpServerCount = servers.length;
      agent.configuredMcpSources = servers.length > 0 ? [`local:${mcpConfigPath}`] : [];
    }
  } catch { /* ignore */ }

  agent.runtimeConversationSignal = true;
  agent.runtimeLastActivityAt = new Date().toISOString();
  agent.hiddenRootPath = path.join(os.homedir(), '.mindos');
  agent.hiddenRootPresent = true;
}

/**
 * Detect configured MCP servers for a custom agent.
 */
function detectCustomAgentConfiguredMcp(
  customDef: Parameters<typeof toAgentDef>[0],
): { servers: string[]; sources: string[] } {
  const globalPath = expandHome(customDef.global);
  if (!fs.existsSync(globalPath)) {
    return { servers: [], sources: [] };
  }

  try {
    const content = fs.readFileSync(globalPath, 'utf-8');
    const config = customDef.format === 'toml'
      ? parseTomlForServers(content, customDef.configKey)
      : parseJsonForServers(content, customDef.configKey);
    return {
      servers: config,
      sources: config.length > 0 ? [`local:${globalPath}`] : [],
    };
  } catch {
    return { servers: [], sources: [] };
  }
}

/**
 * Parse JSON config for MCP servers.
 */
function parseJsonForServers(content: string, key: string): string[] {
  try {
    const config = parseJsonc(content);
    const servers = config[key];
    if (servers && typeof servers === 'object') {
      return Object.keys(servers).sort();
    }
  } catch {}
  return [];
}

/**
 * Parse TOML config for MCP servers.
 */
function parseTomlForServers(content: string, sectionKey: string): string[] {
  const names = new Set<string>();
  const lines = content.split('\n');
  const sectionPrefix = `${sectionKey}.`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = trimmed.slice(1, -1).trim();
      if (section.startsWith(sectionPrefix)) {
        const name = section.slice(sectionPrefix.length).split('.')[0];
        if (name) names.add(name);
      }
    }
  }

  return [...names].sort();
}

export async function GET() {
  try {
    const allAgents = getAllAgents();
    const customDefs = loadCustomAgents();
    const customKeySet = new Set(customDefs.map(c => c.key));
    const customByKey = Object.fromEntries(customDefs.map(c => [c.key, c]));

    const agents = Object.entries(allAgents).map(([key, agent]) => {
      const isCustom = customKeySet.has(key) && !(key in MCP_AGENTS);

      // Built-in agents: use standard detection. Custom agents: detect using their AgentDef directly.
      let present: boolean;
      let status: { installed: boolean; scope?: string; transport?: string; configPath?: string; url?: string };

      if (isCustom) {
        present = agent.presenceDirs?.some((d: string) => fs.existsSync(expandHome(d))) ?? false;
        if (agent.presenceCli) {
          try {
            execSync(
              process.platform === 'win32' ? `where ${agent.presenceCli}` : `which ${agent.presenceCli}`,
              { stdio: 'pipe' },
            );
            present = true;
          } catch { /* not in PATH */ }
        }
        status = { installed: false };
        const globalPath = expandHome(agent.global);
        try {
          if (fs.existsSync(globalPath)) {
            const raw = fs.readFileSync(globalPath, 'utf-8');
            const parsed = JSON.parse(raw);
            const configObj = agent.globalNestedKey
              ? agent.globalNestedKey.split('.').reduce((o: Record<string, unknown>, k: string) => (o?.[k] as Record<string, unknown>) ?? {}, parsed)
              : parsed;
            const servers = configObj?.[agent.key] ?? {};
            if (servers && typeof servers === 'object' && 'mindos' in servers) {
              status = { installed: true, scope: 'global', configPath: globalPath };
            }
          }
        } catch { /* config not parseable */ }
      } else {
        present = detectAgentPresence(key);
        status = detectInstalled(key);
      }

      const skillProfile = isCustom
        ? { mode: 'additional' as const, skillAgentName: key, workspacePath: expandHome(customByKey[key]?.skillDir || agent.presenceDirs?.[0] + 'skills/') }
        : resolveSkillWorkspaceProfile(key);
      const runtime = isCustom
        ? { hiddenRootPath: '', hiddenRootPresent: false, conversationSignal: false, usageSignal: false, lastActivityAt: undefined }
        : detectAgentRuntimeSignals(key);
      const configuredMcp = isCustom
        ? detectCustomAgentConfiguredMcp(customByKey[key])
        : detectAgentConfiguredMcpServers(key);
      const installedSkills = isCustom
        ? scanCustomAgentSkills(customByKey[key])
        : detectAgentInstalledSkills(key);

      return {
        key,
        name: agent.name,
        present,
        installed: status.installed,
        scope: status.scope,
        transport: status.transport,
        configPath: status.configPath,
        url: status.url,
        hasProjectScope: !!agent.project,
        hasGlobalScope: !!agent.global,
        preferredTransport: agent.preferredTransport,
        format: agent.format ?? 'json',
        configKey: agent.key,
        globalNestedKey: agent.globalNestedKey,
        globalPath: agent.global,
        projectPath: agent.project,
        skillMode: skillProfile.mode,
        skillAgentName: skillProfile.skillAgentName,
        skillWorkspacePath: skillProfile.workspacePath,
        hiddenRootPath: runtime.hiddenRootPath,
        hiddenRootPresent: runtime.hiddenRootPresent,
        runtimeConversationSignal: runtime.conversationSignal,
        runtimeUsageSignal: runtime.usageSignal,
        runtimeLastActivityAt: runtime.lastActivityAt,
        configuredMcpServers: configuredMcp.servers,
        configuredMcpServerCount: configuredMcp.servers.length,
        configuredMcpSources: configuredMcp.sources,
        installedSkillNames: installedSkills.skills,
        installedSkillCount: installedSkills.skills.length,
        installedSkillSourcePath: installedSkills.sourcePath,
        isCustom,
        customBaseDir: isCustom ? customByKey[key]?.baseDir : undefined,
      };
    });

    const mindos = agents.find(a => a.key === 'mindos');
    if (mindos) await enrichMindOsAgent(mindos as unknown as Record<string, unknown>);

    // Runtime verification: for agents marked as installed with HTTP endpoint,
    // verify endpoint is reachable (1s timeout to avoid blocking)
    await Promise.all(agents.map(async (agent) => {
      if (agent.installed && agent.url && agent.transport?.startsWith('http')) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1000);
          try {
            const response = await fetch(agent.url, { method: 'HEAD', signal: controller.signal });
            // Accept 200-299 or 405 (HEAD not allowed). Others = unreachable
            if (response.status >= 300 && response.status !== 405) {
              agent.installed = false;
            }
          } finally {
            clearTimeout(timeout);
          }
        } catch {
          // Timeout, network error, or abort — mark as not installed (false positive prevention)
          agent.installed = false;
        }
      }
    }));

    // Sort: mindos first, then installed, then detected, then not found
    agents.sort((a, b) => {
      if (a.key === 'mindos') return -1;
      if (b.key === 'mindos') return 1;
      const rank = (x: typeof a) => x.installed ? 0 : x.present ? 1 : 2;
      return rank(a) - rank(b);
    });

    return NextResponse.json({ agents });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
