import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const scanObsidianVaultPlugins = vi.fn();

vi.mock('@/lib/obsidian-compat/obsidian-import', () => ({
  scanObsidianVaultPlugins,
}));

async function importRoute() {
  return import('../../app/api/obsidian/compat-report/route');
}

describe('GET /api/obsidian/compat-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing vaultRoot', async () => {
    const { GET } = await importRoute();
    const req = new NextRequest('http://localhost/api/obsidian/compat-report');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Missing vaultRoot' });
  });

  it('expands ~/ paths and returns compatibility summary', async () => {
    scanObsidianVaultPlugins.mockResolvedValue({
      plugins: [
        {
          id: 'style-settings-like',
          manifest: { id: 'style-settings-like', name: 'Style Settings', version: '1.0.0' },
          sourceDir: '/tmp/vault/.obsidian/plugins/style-settings-like',
          compatibilityLevel: 'compatible',
          compatibility: { obsidianApis: ['PluginSettingTab'], nodeModules: [], supportedApis: ['PluginSettingTab'], partialApis: [], blockers: [] },
          hasStyles: true,
          hasData: true,
        },
        {
          id: 'desktop-only-like',
          manifest: { id: 'desktop-only-like', name: 'Desktop Only', version: '1.0.0' },
          sourceDir: '/tmp/vault/.obsidian/plugins/desktop-only-like',
          compatibilityLevel: 'blocked',
          compatibility: { obsidianApis: ['Plugin'], nodeModules: ['electron'], supportedApis: ['Plugin'], partialApis: [], blockers: ['Requires unsupported runtime module: electron'] },
          hasStyles: false,
          hasData: false,
        },
      ],
      skipped: [],
    });

    const { GET } = await importRoute();
    const req = new NextRequest('http://localhost/api/obsidian/compat-report?vaultRoot=~/vault');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.summary).toEqual({ total: 2, compatible: 1, partial: 0, blocked: 1 });
    expect(json.plugins).toHaveLength(2);
    expect(scanObsidianVaultPlugins).toHaveBeenCalledTimes(1);
    expect(scanObsidianVaultPlugins.mock.calls[0][0]).not.toContain('~/');
  });
});
