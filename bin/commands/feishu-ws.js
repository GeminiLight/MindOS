import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { bold, cyan, dim, red } from '../lib/colors.js';

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
  const scriptPath = resolve(process.cwd(), 'app/scripts/feishu-long-connection.ts');

  console.log();
  console.log(bold('Starting Feishu long connection'));
  console.log(dim('This keeps a WSClient process running for local event validation.'));
  console.log(dim(`Script: ${scriptPath}`));
  console.log();

  const child = spawn('npx', ['tsx', scriptPath], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(red(`Failed to start Feishu long connection: ${error.message}`));
    console.error(cyan('Try running:'), dim(`npx tsx ${scriptPath}`));
    process.exit(1);
  });
}
