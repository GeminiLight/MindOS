import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { bold, dim, red } from '../lib/colors.js';
import { ROOT, WEB_APP_DIR } from '../lib/constants.js';

export const meta = {
  name: 'feishu-ws',
  group: 'IM Integration',
  summary: 'Start Feishu long connection client',
  usage: 'mindos feishu-ws',
  examples: [
    'mindos feishu-ws',
  ],
};

export async function run() {
  const tsxBin = resolve(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

  console.log();
  console.log(bold('Starting Feishu long connection'));
  console.log(dim('This keeps a WSClient process running for local event validation.'));
  console.log(dim(`App cwd: ${WEB_APP_DIR}`));
  console.log();

  const child = spawn(tsxBin, ['scripts/feishu-long-connection.ts'], {
    cwd: WEB_APP_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(red(`Failed to start Feishu long connection: ${error.message}`));
    process.exit(1);
  });
}
