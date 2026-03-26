import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getExtensionsList } from '@/lib/pi-integration/extensions';

let tempHome: string;
let origHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ext-test-'));
  origHome = process.env.HOME ?? '';
  process.env.HOME = tempHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('extensions discovery', () => {
  it('discovers extensions from ~/.mindos/extensions/', async () => {
    const extDir = path.join(tempHome, '.mindos', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, 'hello.ts'),
      `export default function hello(pi) { pi.on("context", () => ({ appendSystemPrompt: "hello" })); }`,
    );

    const extensions = await getExtensionsList('/tmp/nonexistent-project', '/tmp/nonexistent-mind');
    const ext = extensions.find((e) => e.name === 'hello');
    expect(ext).toBeDefined();
    expect(ext!.enabled).toBe(true);
    expect(ext!.path).toContain('hello');
  });

  it('returns empty array when no extensions exist', async () => {
    const extensions = await getExtensionsList('/tmp/nonexistent-project', '/tmp/nonexistent-mind');
    expect(extensions).toEqual([]);
  });
});
