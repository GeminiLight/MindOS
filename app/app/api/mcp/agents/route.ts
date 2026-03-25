export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import {
  MCP_AGENTS,
  detectInstalled,
  detectAgentPresence,
  detectAgentRuntimeSignals,
  resolveSkillWorkspaceProfile,
} from '@/lib/mcp-agents';

export async function GET() {
  try {
    const agents = Object.entries(MCP_AGENTS).map(([key, agent]) => {
      const status = detectInstalled(key);
      const present = detectAgentPresence(key);
      const skillProfile = resolveSkillWorkspaceProfile(key);
      const runtime = detectAgentRuntimeSignals(key);
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
        // Snippet generation fields
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
      };
    });

    // Sort: installed first, then detected, then not found
    agents.sort((a, b) => {
      const rank = (x: typeof a) => x.installed ? 0 : x.present ? 1 : 2;
      return rank(a) - rank(b);
    });

    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
