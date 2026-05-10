import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

describe('mindos gateway service root resolution', () => {
  it('uses argv command lookup instead of shell strings when finding mindos binaries', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'lib', 'gateway.js'), 'utf-8');

    expect(source).toContain("execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mindos']");
    expect(source).not.toContain("'where mindos'");
    expect(source).not.toContain("'which mindos'");
  });

  it('uses argv-safe subprocess calls for service manager commands', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'lib', 'gateway.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("execFileSync('systemctl', ['--user', 'daemon-reload']");
    expect(source).toContain("execFileSync('journalctl', ['--user', '-u', 'mindos', '-f']");
    expect(source).toContain("execFileSync('launchctl', ['bootstrap', `gui/${launchctlUid()}`, LAUNCHD_PLIST]");
    expect(source).toContain("execFileSync('tail', ['-f', LOG_PATH]");
  });

  it('escapes systemd unit command and environment values with spaces', async () => {
    const { buildSystemdUnit } = await import('../../packages/mindos/bin/lib/gateway.js');

    const unit = buildSystemdUnit({
      nodeBin: '/Users/Ada Lovelace/.mindos/node/bin/node',
      cliPath: '/Applications/MindOS Dev/app/bin/cli.js',
      home: '/Users/Ada Lovelace',
      path: '/opt/local/bin:/Users/Ada Lovelace/bin',
      mindosEnvPath: '/Users/Ada Lovelace/.mindos/env',
      logPath: '/Users/Ada Lovelace/.mindos/app log.txt',
    });

    expect(unit).toContain('ExecStart="/Users/Ada Lovelace/.mindos/node/bin/node" "/Applications/MindOS Dev/app/bin/cli.js" start');
    expect(unit).toContain('Environment="HOME=/Users/Ada Lovelace"');
    expect(unit).toContain('Environment="PATH=/opt/local/bin:/Users/Ada Lovelace/bin"');
    expect(unit).toContain('EnvironmentFile=-"/Users/Ada Lovelace/.mindos/env"');
    expect(unit).toContain('StandardOutput=append:"/Users/Ada Lovelace/.mindos/app log.txt"');
  });

  it('escapes launchd plist strings as XML text', async () => {
    const { buildLaunchdPlist } = await import('../../packages/mindos/bin/lib/gateway.js');

    const plist = buildLaunchdPlist({
      label: 'com.mindos.app',
      nodeBin: '/Users/Ada & Bob/.mindos/node/bin/node',
      cliPath: '/Applications/MindOS <Dev>/app/bin/cli.js',
      home: '/Users/Ada & Bob',
      path: '/usr/local/bin:/Users/Ada & Bob/bin',
      logPath: '/Users/Ada & Bob/.mindos/app.log',
    });

    expect(plist).toContain('<string>/Users/Ada &amp; Bob/.mindos/node/bin/node</string>');
    expect(plist).toContain('<string>/Applications/MindOS &lt;Dev&gt;/app/bin/cli.js</string>');
    expect(plist).toContain('<key>HOME</key><string>/Users/Ada &amp; Bob</string>');
    expect(plist).toContain('<key>PATH</key><string>/usr/local/bin:/Users/Ada &amp; Bob/bin</string>');
    expect(plist).not.toContain('/Users/Ada & Bob');
  });
});
