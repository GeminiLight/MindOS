export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { MCP_AGENTS } from '@/lib/mcp-agents';
import {
  loadCustomAgents,
  saveCustomAgents,
  inferDefaults,
  slugify,
  generateUniqueKey,
  validateCustomAgentInput,
  type CustomAgentDef,
} from '@/lib/custom-agents';
import { handleRouteErrorSimple } from '@/lib/errors';

/** POST — Create a new custom agent. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, baseDir, ...overrides } = body as Partial<CustomAgentDef> & { name?: string; baseDir?: string };

    if (!name?.trim() || !baseDir?.trim()) {
      return NextResponse.json({ error: 'name and baseDir are required' }, { status: 400 });
    }

    const customs = loadCustomAgents();
    const existingKeys = new Set([
      ...Object.keys(MCP_AGENTS),
      ...customs.map(c => c.key),
    ]);

    const key = overrides.key && !existingKeys.has(overrides.key)
      ? overrides.key
      : generateUniqueKey(name.trim(), existingKeys);

    const error = validateCustomAgentInput({ name, baseDir, key }, existingKeys);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const defaults = inferDefaults(name.trim(), baseDir.trim());
    const agent: CustomAgentDef = {
      ...defaults,
      key,
      ...(overrides.global && { global: overrides.global }),
      ...(overrides.project !== undefined && { project: overrides.project }),
      ...(overrides.configKey && { configKey: overrides.configKey }),
      ...(overrides.format && { format: overrides.format }),
      ...(overrides.preferredTransport && { preferredTransport: overrides.preferredTransport }),
      ...(overrides.presenceDirs && { presenceDirs: overrides.presenceDirs }),
      ...(overrides.presenceCli && { presenceCli: overrides.presenceCli }),
      ...(overrides.globalNestedKey && { globalNestedKey: overrides.globalNestedKey }),
      ...(overrides.skillDir && { skillDir: overrides.skillDir }),
    };

    customs.push(agent);
    saveCustomAgents(customs);

    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

/** PUT — Update an existing custom agent. */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, ...updates } = body as Partial<CustomAgentDef> & { key: string };

    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }

    const customs = loadCustomAgents();
    const idx = customs.findIndex(c => c.key === key);

    if (idx === -1) {
      return NextResponse.json({ error: `Custom agent "${key}" not found` }, { status: 404 });
    }

    const existing = customs[idx];

    // Validate enum fields
    if (updates.format && !['json', 'toml'].includes(updates.format)) {
      return NextResponse.json({ error: 'format must be "json" or "toml"' }, { status: 400 });
    }
    if (updates.preferredTransport && !['stdio', 'http'].includes(updates.preferredTransport)) {
      return NextResponse.json({ error: 'preferredTransport must be "stdio" or "http"' }, { status: 400 });
    }

    // Validate baseDir if changed
    if (updates.baseDir) {
      const dir = updates.baseDir.trim();
      if (!dir.startsWith('~/') && !dir.startsWith('/')) {
        return NextResponse.json({ error: 'baseDir must be an absolute path' }, { status: 400 });
      }
    }

    const updated: CustomAgentDef = {
      ...existing,
      ...(updates.name && { name: updates.name }),
      ...(updates.baseDir && { baseDir: updates.baseDir }),
      ...(updates.global && { global: updates.global }),
      ...(updates.project !== undefined && { project: updates.project }),
      ...(updates.configKey && { configKey: updates.configKey }),
      ...(updates.format && { format: updates.format }),
      ...(updates.preferredTransport && { preferredTransport: updates.preferredTransport }),
      ...(updates.presenceCli !== undefined && { presenceCli: updates.presenceCli || undefined }),
      ...(updates.globalNestedKey !== undefined && { globalNestedKey: updates.globalNestedKey || undefined }),
      ...(updates.skillDir !== undefined && { skillDir: updates.skillDir || undefined }),
    };

    // Update presenceDirs: explicit override takes priority, then baseDir-derived default
    if (updates.presenceDirs) {
      updated.presenceDirs = updates.presenceDirs;
    } else if (updates.baseDir) {
      updated.presenceDirs = [updates.baseDir.endsWith('/') ? updates.baseDir : updates.baseDir + '/'];
    }

    // Update skillDir default when baseDir changes and no explicit skillDir
    if (!updates.skillDir && updates.baseDir) {
      const bd = updates.baseDir.endsWith('/') ? updates.baseDir : updates.baseDir + '/';
      updated.skillDir = bd + 'skills/';
    }

    customs[idx] = updated;
    saveCustomAgents(customs);

    return NextResponse.json({ agent: updated });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

/** DELETE — Remove a custom agent. */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { key } = body as { key: string };

    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }

    const customs = loadCustomAgents();
    const filtered = customs.filter(c => c.key !== key);

    if (filtered.length === customs.length) {
      return NextResponse.json({ error: `Custom agent "${key}" not found` }, { status: 404 });
    }

    saveCustomAgents(filtered);

    return NextResponse.json({ removed: key });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
