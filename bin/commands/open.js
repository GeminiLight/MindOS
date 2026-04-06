/**
 * mindos open — Open Web UI in browser
 */

import { execSync } from 'node:child_process';
import { loadConfig } from '../lib/config.js';
import { cyan, green, dim } from '../lib/colors.js';

export const meta = {
  name: 'open',
  group: 'Service',
  summary: 'Open Web UI in browser',
  usage: 'mindos open',
};

export const run = () => {
  loadConfig();
  const webPort = process.env.MINDOS_WEB_PORT || '3456';
  const url = `http://localhost:${webPort}`;

  let cmd;
  if (process.platform === 'darwin') {
    cmd = 'open';
  } else if (process.platform === 'linux') {
    try {
      const uname = execSync('uname -r', { encoding: 'utf-8' });
      cmd = uname.toLowerCase().includes('microsoft') ? 'wslview' : 'xdg-open';
    } catch {
      cmd = 'xdg-open';
    }
  } else {
    cmd = 'start';
  }

  try {
    if (process.platform === 'win32') {
      // Windows `start` treats the first quoted arg as a window title
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`${cmd} ${url}`, { stdio: 'ignore' });
    }
    console.log(`${green('✔')} Opening ${cyan(url)}`);
  } catch {
    console.log(dim(`Could not open browser automatically. Visit: ${cyan(url)}`));
  }
};
