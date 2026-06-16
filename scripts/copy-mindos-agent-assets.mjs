#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

copyAgentPromptAsset();

function copyAgentPromptAsset() {
  const src = resolve(root, 'packages/mindos/src/agent/prompt/agent-prompt.txt');
  const dest = resolve(root, 'packages/mindos/dist/agent/prompt/agent-prompt.txt');
  if (!existsSync(src)) {
    throw new Error(`Missing MindOS agent prompt asset: ${src}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}
