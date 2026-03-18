import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for bin/lib/config.js — loadConfig env mapping.
 *
 * loadConfig() has a module-level `let loaded = false` idempotency guard.
 * We must vi.resetModules() + dynamic import() for each test to get a fresh module.
 */

let tempDir: string;
let configPath: string;

// All env vars that loadConfig may set
const MANAGED_ENV_KEYS = [
  'MIND_ROOT', 'MINDOS_WEB_PORT', 'MINDOS_MCP_PORT',
  'AUTH_TOKEN', 'WEB_PASSWORD', 'AI_PROVIDER',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL',
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-cfg-test-'));
  configPath = path.join(tempDir, 'config.json');

  // Save and clear managed env vars
  savedEnv = {};
  for (const key of MANAGED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  // Reset module registry so loadConfig's `loaded` flag resets
  vi.resetModules();

  // Mock constants to point CONFIG_PATH to our temp file
  vi.doMock('../../bin/lib/constants.js', () => ({
    CONFIG_PATH: configPath,
    ROOT: path.resolve(__dirname, '..', '..'),
    MINDOS_DIR: tempDir,
    PID_PATH: path.join(tempDir, 'mindos.pid'),
    BUILD_STAMP: path.join(tempDir, '.mindos-build-version'),
    LOG_PATH: path.join(tempDir, 'mindos.log'),
    CLI_PATH: '',
    NODE_BIN: process.execPath,
    UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
    DEPS_STAMP: path.join(tempDir, 'deps-hash'),
  }));
});

afterEach(() => {
  // Restore env
  for (const key of MANAGED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeConfig(config: Record<string, unknown>) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

async function importConfig() {
  return await import('../../bin/lib/config.js') as {
    loadConfig: () => void;
    getStartMode: () => string;
    isDaemonMode: () => boolean;
  };
}

// ── loadConfig env mapping ──────────────────────────────────────────────────

describe('loadConfig — new format (providers)', () => {
  it('maps anthropic provider fields', async () => {
    writeConfig({
      mindRoot: '/tmp/mind',
      ai: {
        provider: 'anthropic',
        providers: {
          anthropic: { apiKey: 'sk-ant-xxx', model: 'claude-sonnet-4-6' },
        },
      },
    });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.AI_PROVIDER).toBe('anthropic');
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx');
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
  });

  it('maps openai provider fields (apiKey + model + baseUrl)', async () => {
    writeConfig({
      ai: {
        provider: 'openai',
        providers: {
          openai: { apiKey: 'sk-oai-xxx', model: 'gpt-5.4', baseUrl: 'https://custom.api.com/v1' },
        },
      },
    });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.AI_PROVIDER).toBe('openai');
    expect(process.env.OPENAI_API_KEY).toBe('sk-oai-xxx');
    expect(process.env.OPENAI_MODEL).toBe('gpt-5.4');
    expect(process.env.OPENAI_BASE_URL).toBe('https://custom.api.com/v1');
  });
});

describe('loadConfig — old format (flat keys)', () => {
  it('maps flat anthropic keys as fallback', async () => {
    writeConfig({
      ai: {
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-old',
        anthropicModel: 'claude-3-opus',
      },
    });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-old');
    expect(process.env.ANTHROPIC_MODEL).toBe('claude-3-opus');
  });

  it('maps flat openai keys as fallback', async () => {
    writeConfig({
      ai: {
        provider: 'openai',
        openaiApiKey: 'sk-oai-old',
        openaiModel: 'gpt-4',
        openaiBaseUrl: 'https://old.api.com',
      },
    });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.OPENAI_API_KEY).toBe('sk-oai-old');
    expect(process.env.OPENAI_MODEL).toBe('gpt-4');
    expect(process.env.OPENAI_BASE_URL).toBe('https://old.api.com');
  });
});

describe('loadConfig — core fields', () => {
  it('maps port and mcpPort', async () => {
    writeConfig({ port: 3001, mcpPort: 8788 });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.MINDOS_WEB_PORT).toBe('3001');
    expect(process.env.MINDOS_MCP_PORT).toBe('8788');
  });

  it('maps mindRoot', async () => {
    writeConfig({ mindRoot: '/home/user/MindOS/mind' });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.MIND_ROOT).toBe('/home/user/MindOS/mind');
  });

  it('maps authToken', async () => {
    writeConfig({ authToken: 'tok-abc123' });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.AUTH_TOKEN).toBe('tok-abc123');
  });

  it('maps webPassword', async () => {
    writeConfig({ webPassword: 'pass123' });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.WEB_PASSWORD).toBe('pass123');
  });
});

describe('loadConfig — does not override existing env', () => {
  it('preserves existing AUTH_TOKEN', async () => {
    process.env.AUTH_TOKEN = 'already-set';
    writeConfig({ authToken: 'from-config' });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.AUTH_TOKEN).toBe('already-set');
  });
});

describe('loadConfig — error handling', () => {
  it('does not throw when config file does not exist', async () => {
    // configPath does not exist — should not throw
    const { loadConfig } = await importConfig();
    expect(() => loadConfig()).not.toThrow();
  });

  it('does not throw on corrupt JSON (outputs warning)', async () => {
    fs.writeFileSync(configPath, '{broken json!!!', 'utf-8');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { loadConfig } = await importConfig();
    expect(() => loadConfig()).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('loadConfig — idempotency', () => {
  it('only loads once (second call is no-op)', async () => {
    writeConfig({ authToken: 'first' });
    const { loadConfig } = await importConfig();
    loadConfig();
    expect(process.env.AUTH_TOKEN).toBe('first');

    // Overwrite config file and call again — should NOT re-read
    writeConfig({ authToken: 'second' });
    loadConfig();
    expect(process.env.AUTH_TOKEN).toBe('first');
  });
});

// ── getStartMode / isDaemonMode ─────────────────────────────────────────────

describe('getStartMode', () => {
  it('returns "start" when no config', async () => {
    const { getStartMode } = await importConfig();
    expect(getStartMode()).toBe('start');
  });

  it('returns "start" when startMode is "daemon" (CLI uses --daemon flag)', async () => {
    writeConfig({ startMode: 'daemon' });
    const { getStartMode } = await importConfig();
    expect(getStartMode()).toBe('start');
  });

  it('returns stored startMode for non-daemon values', async () => {
    writeConfig({ startMode: 'dev' });
    const { getStartMode } = await importConfig();
    expect(getStartMode()).toBe('dev');
  });
});

describe('isDaemonMode', () => {
  it('returns true when startMode is "daemon"', async () => {
    writeConfig({ startMode: 'daemon' });
    const { isDaemonMode } = await importConfig();
    expect(isDaemonMode()).toBe(true);
  });

  it('returns false when startMode is not "daemon"', async () => {
    writeConfig({ startMode: 'start' });
    const { isDaemonMode } = await importConfig();
    expect(isDaemonMode()).toBe(false);
  });

  it('returns false when no config', async () => {
    const { isDaemonMode } = await importConfig();
    expect(isDaemonMode()).toBe(false);
  });
});
