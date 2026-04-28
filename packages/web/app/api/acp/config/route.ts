export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { readSettings, writeSettings } from '@/lib/settings';
import type { AcpAgentOverride } from '@/lib/acp/agent-descriptors';

/** GET /api/acp/config — Returns all per-agent ACP overrides from settings. */
export async function GET() {
  const settings = readSettings();
  return NextResponse.json({ agents: settings.acpAgents ?? {} });
}

/** POST /api/acp/config — Save a per-agent override. Body: { agentId, config } */
export async function POST(req: NextRequest) {
  let body: { agentId?: string; config?: AcpAgentOverride };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { agentId, config } = body;
  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  const settings = readSettings();
  const existing = settings.acpAgents ?? {};

  if (config && typeof config === 'object') {
    // Sanitize the override
    const sanitized: AcpAgentOverride = {};
    if (typeof config.command === 'string' && config.command.trim()) {
      sanitized.command = config.command.trim();
    }
    if (Array.isArray(config.args)) {
      sanitized.args = config.args.filter((a): a is string => typeof a === 'string');
    }
    if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      if (Object.keys(env).length > 0) sanitized.env = env;
    }
    if (typeof config.enabled === 'boolean') {
      sanitized.enabled = config.enabled;
    }

    existing[agentId] = sanitized;
  }

  settings.acpAgents = existing;
  writeSettings(settings);
  return NextResponse.json({ ok: true, agents: settings.acpAgents });
}

/** DELETE /api/acp/config — Reset a single agent to defaults. Body: { agentId } */
export async function DELETE(req: NextRequest) {
  let body: { agentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { agentId } = body;
  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  const settings = readSettings();
  if (settings.acpAgents) {
    delete settings.acpAgents[agentId];
    if (Object.keys(settings.acpAgents).length === 0) {
      settings.acpAgents = undefined;
    }
  }

  writeSettings(settings);
  return NextResponse.json({ ok: true, agents: settings.acpAgents ?? {} });
}
