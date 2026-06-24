import { afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resetObsidianPluginRuntimeServicesForTests } from '@/lib/obsidian-compat/runtime-service';

let mindRoot = '';
const testState = vi.hoisted(() => ({ mindRoot: '' }));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ mindRoot: testState.mindRoot }),
}));

export function installObsidianPluginApiHarness(onMindRoot?: (root: string) => void) {
  beforeEach(() => {
    resetObsidianPluginRuntimeServicesForTests();
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-plugins-api-'));
    testState.mindRoot = mindRoot;
    onMindRoot?.(mindRoot);
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.clearAllMocks();
    resetObsidianPluginRuntimeServicesForTests();
    mindRoot = '';
    testState.mindRoot = '';
  });
}

export function writePlugin(pluginId: string, mainJs: string, manifest: Record<string, unknown> = {}) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0', ...manifest }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
}

export async function importLifecycleRoute() {
  return import('../../app/api/obsidian-plugins/route');
}

export async function importSettingsRoute() {
  return import('../../app/api/obsidian-plugins/settings/route');
}

export async function importViewsRoute() {
  return import('../../app/api/obsidian-plugins/views/route');
}

export async function importMarkdownCodeBlocksRoute() {
  return import('../../app/api/obsidian-plugins/markdown-code-blocks/route');
}

export async function importMarkdownPostProcessorsRoute() {
  return import('../../app/api/obsidian-plugins/markdown-post-processors/route');
}

export function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/obsidian-plugins', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function confirmedEnableRequest(pluginId: string) {
  return postRequest({
    action: 'enable',
    pluginId,
    confirmCapabilityGate: true,
  });
}

export function settingsPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/obsidian-plugins/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function viewGetRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/obsidian-plugins/views');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

export function markdownBlocksPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/obsidian-plugins/markdown-code-blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function markdownPostProcessorsPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/obsidian-plugins/markdown-post-processors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
