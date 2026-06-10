import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type MindosMcpStatusSettings = {
  mcpPort?: number;
  authToken?: string;
  connectionMode?: {
    cli: boolean;
    mcp: boolean;
  };
};

export type MindosMcpStatusServices = {
  env?: Record<string, string | undefined>;
  readSettings(): MindosMcpStatusSettings;
  fetchHealth(url: string, timeoutMs: number): Promise<{ ok: boolean; body?: { ok?: boolean; service?: string } }>;
  getLocalIP(): string | null;
  maskToken(token: string): string;
};

export type MindosMcpStatusOptions = {
  host?: string | null;
};

export type MindosMcpStatusPayload = {
  running: boolean;
  transport: 'http';
  endpoint: string;
  port: number;
  toolCount: number;
  authConfigured: boolean;
  maskedToken?: string;
  localIP: string | null;
  connectionMode: {
    cli: boolean;
    mcp: boolean;
  };
};

export type MindosMcpTokenRevealPayload = {
  authConfigured: boolean;
  authToken?: string;
};

function parseHostname(host: string): string {
  if (host.includes(']')) return host.slice(0, host.lastIndexOf(']') + 1);
  const colonIdx = host.lastIndexOf(':');
  return colonIdx > 0 ? host.slice(0, colonIdx) : host;
}

export async function handleMcpStatus(
  services: MindosMcpStatusServices,
  options: MindosMcpStatusOptions = {},
): Promise<MindosServerResponse<MindosMcpStatusPayload | { error: string }>> {
  try {
    const settings = services.readSettings();
    const port = Number(services.env?.MINDOS_MCP_PORT) || settings.mcpPort || 8781;
    const token = settings.authToken ?? '';
    const authConfigured = !!token;
    const reqHost = options.host ?? `127.0.0.1:${port}`;
    const hostname = parseHostname(reqHost);
    const endpoint = `http://${hostname}:${port}/mcp`;
    const healthUrl = `http://127.0.0.1:${port}/api/health`;

    let running = false;
    try {
      const health = await services.fetchHealth(healthUrl, 2000);
      running = health.ok && health.body?.ok === true && health.body.service === 'mindos';
    } catch {
      running = false;
    }

    return json({
      running,
      transport: 'http',
      endpoint,
      port,
      toolCount: running ? 24 : 0,
      authConfigured,
      maskedToken: authConfigured ? services.maskToken(token) : undefined,
      localIP: services.getLocalIP(),
      connectionMode: settings.connectionMode ?? { cli: true, mcp: false },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMcpTokenReveal(
  services: Pick<MindosMcpStatusServices, 'readSettings'>,
): Promise<MindosServerResponse<MindosMcpTokenRevealPayload | { error: string }>> {
  try {
    const token = services.readSettings().authToken ?? '';
    return json({
      authConfigured: !!token,
      ...(token ? { authToken: token } : {}),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
