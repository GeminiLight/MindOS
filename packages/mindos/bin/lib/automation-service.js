import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { CLI_PATH, MINDOS_DIR, NODE_BIN } from './constants.js';
import { green } from './colors.js';

const AUTOMATION_LOG_PATH = resolve(MINDOS_DIR, 'automation.log');
const SYSTEMD_DIR = resolve(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT = resolve(SYSTEMD_DIR, 'mindos-automation.service');
const LAUNCHD_DIR = resolve(homedir(), 'Library', 'LaunchAgents');
const LAUNCHD_PLIST = resolve(LAUNCHD_DIR, 'com.mindos.automation.plist');
const LAUNCHD_LABEL = 'com.mindos.automation';

export function buildAutomationSystemdUnit({
  binaryExecutor = process.env.MINDOS_BINARY_EXECUTOR,
  nodeBin = NODE_BIN,
  cliPath = CLI_PATH,
  home = homedir(),
  path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  logPath = AUTOMATION_LOG_PATH,
} = {}) {
  const invocation = automationWorkerInvocation({ binaryExecutor, nodeBin, cliPath });
  return [
    '[Unit]',
    'Description=MindOS independent automation executor',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${invocation.map(quoteSystemd).join(' ')}`,
    'Restart=on-failure',
    'RestartSec=5',
    `Environment=${quoteSystemd(`HOME=${home}`)}`,
    `Environment=${quoteSystemd(`PATH=${path}`)}`,
    `StandardOutput=${quoteSystemd(`append:${logPath}`)}`,
    `StandardError=${quoteSystemd(`append:${logPath}`)}`,
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n');
}

export function buildAutomationLaunchdPlist({
  binaryExecutor = process.env.MINDOS_BINARY_EXECUTOR,
  nodeBin = NODE_BIN,
  cliPath = CLI_PATH,
  home = homedir(),
  path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  logPath = AUTOMATION_LOG_PATH,
} = {}) {
  const invocation = automationWorkerInvocation({ binaryExecutor, nodeBin, cliPath });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${invocation.map((argument) => `    <string>${xml(argument)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xml(home)}</string>
    <key>PATH</key><string>${xml(path)}</string>
  </dict>
</dict>
</plist>
`;
}

function automationWorkerInvocation({ binaryExecutor, nodeBin, cliPath }) {
  return binaryExecutor
    ? [binaryExecutor, 'automation', 'worker']
    : [nodeBin, cliPath, 'automation', 'worker'];
}

export function getAutomationServicePlatform() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'linux') return 'systemd';
  return null;
}

export async function runAutomationServiceCommand(command) {
  const platform = getAutomationServicePlatform();
  if (!platform) throw new Error('Automation service installation is supported on macOS and Linux. Use `mindos automation worker` on this platform.');
  if (!['install', 'uninstall', 'start', 'stop', 'status', 'logs'].includes(command)) {
    throw new Error(`Unknown automation service command: ${command}`);
  }
  mkdirSync(MINDOS_DIR, { recursive: true });
  if (platform === 'launchd') return runLaunchd(command);
  return runSystemd(command);
}

function runSystemd(command) {
  if (command === 'install') {
    mkdirSync(SYSTEMD_DIR, { recursive: true });
    writeFileSync(SYSTEMD_UNIT, buildAutomationSystemdUnit(), { encoding: 'utf-8', mode: 0o600 });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', '--now', 'mindos-automation.service'], { stdio: 'inherit' });
    console.log(green('✔ Automation executor service installed and started'));
    return;
  }
  if (command === 'uninstall') {
    try { execFileSync('systemctl', ['--user', 'disable', '--now', 'mindos-automation.service'], { stdio: 'inherit' }); } catch {}
    rmSync(SYSTEMD_UNIT, { force: true });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    console.log(green('✔ Automation executor service uninstalled'));
    return;
  }
  if (command === 'logs') {
    execFileSync('journalctl', ['--user', '-u', 'mindos-automation.service', '-f'], { stdio: 'inherit' });
    return;
  }
  const systemdCommand = command === 'status' ? 'status' : command;
  try {
    execFileSync('systemctl', ['--user', systemdCommand, 'mindos-automation.service'], { stdio: 'inherit' });
  } catch (error) {
    if (command !== 'status') throw error;
  }
}

function runLaunchd(command) {
  const target = `gui/${launchctlUid()}/${LAUNCHD_LABEL}`;
  if (command === 'install') {
    mkdirSync(LAUNCHD_DIR, { recursive: true });
    writeFileSync(LAUNCHD_PLIST, buildAutomationLaunchdPlist(), { encoding: 'utf-8', mode: 0o600 });
    try { execFileSync('launchctl', ['bootout', target], { stdio: 'ignore' }); } catch {}
    execFileSync('launchctl', ['bootstrap', `gui/${launchctlUid()}`, LAUNCHD_PLIST], { stdio: 'inherit' });
    console.log(green('✔ Automation executor service installed and started'));
    return;
  }
  if (command === 'uninstall') {
    try { execFileSync('launchctl', ['bootout', target], { stdio: 'inherit' }); } catch {}
    rmSync(LAUNCHD_PLIST, { force: true });
    console.log(green('✔ Automation executor service uninstalled'));
    return;
  }
  if (command === 'start') {
    if (!existsSync(LAUNCHD_PLIST)) throw new Error('Automation service is not installed.');
    try { execFileSync('launchctl', ['bootstrap', `gui/${launchctlUid()}`, LAUNCHD_PLIST], { stdio: 'ignore' }); } catch {}
    execFileSync('launchctl', ['kickstart', '-k', target], { stdio: 'inherit' });
    return;
  }
  if (command === 'stop') {
    execFileSync('launchctl', ['bootout', target], { stdio: 'inherit' });
    return;
  }
  if (command === 'status') {
    try { execFileSync('launchctl', ['print', target], { stdio: 'inherit' }); } catch {}
    return;
  }
  execFileSync('tail', ['-f', AUTOMATION_LOG_PATH], { stdio: 'inherit' });
}

function launchctlUid() {
  return execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim();
}

function quoteSystemd(value) {
  const raw = String(value);
  if (/[\0\r\n]/.test(raw)) throw new Error('Invalid service unit value.');
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
