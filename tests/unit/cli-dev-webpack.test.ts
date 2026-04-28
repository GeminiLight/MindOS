import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('mindos dev webpack contract', () => {
  it('starts Next dev with webpack to avoid Turbopack pnpm workspace root issues', () => {
    const devCommand = readFileSync(resolve(root, 'packages/mindos/bin/commands/dev.js'), 'utf-8');

    expect(devCommand).toContain('dev --webpack -p');
    expect(devCommand).not.toContain('`${NEXT_BIN} dev -p');
  });
});

describe('CLI local TypeScript helpers', () => {
  it('does not spawn npx or legacy app/ paths for Feishu long connection', () => {
    const feishuWsCommand = readFileSync(resolve(root, 'packages/mindos/bin/commands/feishu-ws.js'), 'utf-8');

    expect(feishuWsCommand).toContain("WEB_APP_DIR");
    expect(feishuWsCommand).toContain("'node_modules', '.bin'");
    expect(feishuWsCommand).toContain("'tsx.cmd' : 'tsx'");
    expect(feishuWsCommand).not.toContain("spawn('npx'");
    expect(feishuWsCommand).not.toContain("resolve(process.cwd(), 'app')");
  });
});
