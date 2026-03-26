export const dynamic = 'force-dynamic';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  MCP_AGENTS,
  detectInstalled,
  detectAgentPresence,
  detectAgentRuntimeSignals,
  detectAgentConfiguredMcpServers,
  detectAgentInstalledSkills,
  resolveSkillWorkspaceProfile,
} from '@/lib/mcp-agents';
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
    const agents = Object.entries(MCP_AGENTS).map(([key, agent]) => {
      const status = detectInstalled(key);
      const present = detectAgentPresence(key);
      const skillProfile = resolveSkillWorkspaceProfile(key);
      const runtime = detectAgentRuntimeSignals(key);
      const configuredMcp = detectAgentConfiguredMcpServers(key);
      const installedSkills = detectAgentInstalledSkills(key);
      return {
        key,
        name: agent.name,
        present,
        installed: status.installed,
        scope: status.scope,
        transport: status.transport,
        configPath: status.configPath,
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
      };
    });

    const mindos = agents.find(a => a.key === 'mindos');
    if (mindos) enrichMindOsAgent(mindos as unknown as Record<string, unknown>);

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
