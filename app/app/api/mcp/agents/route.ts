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
} from '@/lib/mcp-agents';
import { getAllAgents, loadCustomAgents } from '@/lib/custom-agents';
import { readSettings } from '@/lib/settings';
import { scanSkillDirs } from '@/lib/pi-integration/skills';
import { getMindRoot } from '@/lib/fs';

function enrichMindOsAgent(agent: Record<string, unknown>) {
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
    const projectRoot = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
    const skills = scanSkillDirs({ projectRoot, mindRoot: getMindRoot() });
    const enabledSkills = skills.filter(s => s.enabled);
    agent.installedSkillNames = enabledSkills.map(s => s.name);
    agent.installedSkillCount = enabledSkills.length;
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

      const skillProfile = resolveSkillWorkspaceProfile(key);
      const runtime = isCustom
        ? { hiddenRootPath: '', hiddenRootPresent: false, conversationSignal: false, usageSignal: false, lastActivityAt: undefined }
        : detectAgentRuntimeSignals(key);
      const configuredMcp = isCustom
        ? { servers: [] as string[], sources: [] as string[] }
        : detectAgentConfiguredMcpServers(key);
      const installedSkills = isCustom
        ? { skills: [] as string[], sourcePath: '' }
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
    if (mindos) enrichMindOsAgent(mindos as unknown as Record<string, unknown>);

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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
