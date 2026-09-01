import { describe, expect, it, vi } from 'vitest';
import path from 'path';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => path.join(process.cwd(), 'tmp-install-cli-shim-home'),
    isPackaged: false,
  },
  BrowserWindow: class {},
  Notification: class {},
  dialog: {},
}));

describe('install-cli-shim', () => {
  it('escapes only % in quoted set values (carets and bangs are literal without delayed expansion)', async () => {
    const { escapeCmdSetValue } = await import('./install-cli-shim');

    expect(escapeCmdSetValue('C:\\Users\\A%TEMP%^B!C\\cli.js')).toBe(
      'C:\\Users\\A%%TEMP%%^B!C\\cli.js',
    );
    expect(() => escapeCmdSetValue('C:\\bad"quote')).toThrow();
  });

  it('expresses home-relative paths via %USERPROFILE% so the .cmd stays pure ASCII', async () => {
    const { toCmdUserProfilePath, buildWindowsCmdShimScript } = await import('./install-cli-shim');
    const home = 'C:\\Users\\张三';

    expect(toCmdUserProfilePath('C:\\Users\\张三\\.mindos\\runtime\\bin\\cli.js', home)).toBe(
      '%USERPROFILE%\\.mindos\\runtime\\bin\\cli.js',
    );
    // Non-home paths stay absolute (documented residual risk for non-ASCII)
    expect(toCmdUserProfilePath('D:\\dev\\mindos\\bin\\cli.js', home)).toBe('D:\\dev\\mindos\\bin\\cli.js');
    // A sibling prefix (C:\Users\张三丰) must NOT be treated as inside home
    expect(toCmdUserProfilePath('C:\\Users\\张三丰\\cli.js', home)).toBe('C:\\Users\\张三丰\\cli.js');

    const script = buildWindowsCmdShimScript('C:\\Users\\张三\\.mindos\\runtime\\bin\\cli.js', home);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(script), 'cmd shim must be pure ASCII for a home-relative CLI').toBe(true);
    expect(script).toContain('%USERPROFILE%\\.mindos\\runtime\\bin\\cli.js');
  });

  it('keeps delayed expansion disabled so user arguments containing ! survive %*', async () => {
    const { buildWindowsCmdShimScript } = await import('./install-cli-shim');
    const script = buildWindowsCmdShimScript('C:\\Users\\u\\.mindos\\runtime\\bin\\cli.js', 'C:\\Users\\u');

    expect(script).toContain('setlocal disabledelayedexpansion');
    expect(script).not.toContain('enabledelayedexpansion');
    expect(script).not.toContain('!CLI!');
    expect(script).not.toContain('!ERRORLEVEL!');
    // errorlevel must be read on its own line (parse-time expansion after the command line completes)
    expect(script).toContain('exit /b %errorlevel%');
    expect(script).toContain('\r\n'); // .cmd needs CRLF
    const versionChecks = script.split('\r\n').filter((line) => line.includes('process.versions.node'));
    expect(versionChecks).toHaveLength(2);
    for (const line of versionChecks) {
      expect(line).not.toContain('^>');
      expect(line).not.toContain('^|');
      expect(line).not.toContain('^&');
    }
  });

  it('falls back to a compatible PATH node when the private runtime is stale', async () => {
    if (process.platform === 'win32') return;
    const { buildUnixShimScript } = await import('./install-cli-shim');
    const fs = await import('fs');
    const os = await import('os');
    const { spawnSync } = await import('child_process');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-cli-node-fallback-'));
    const pathBin = path.join(home, 'path-bin');
    const privateBin = path.join(home, '.mindos', 'node', 'bin');
    const cli = path.join(home, 'cli.js');
    const shim = path.join(home, 'mindos');
    fs.mkdirSync(pathBin, { recursive: true });
    fs.mkdirSync(privateBin, { recursive: true });
    fs.writeFileSync(cli, '// test cli');
    fs.writeFileSync(path.join(privateBin, 'node'), '#!/bin/sh\nif [ "$1" = "-e" ]; then exit 1; fi\necho private\n', { mode: 0o755 });
    fs.writeFileSync(path.join(pathBin, 'node'), '#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\necho path\n', { mode: 0o755 });
    fs.writeFileSync(shim, buildUnixShimScript(cli), { mode: 0o755 });

    try {
      const result = spawnSync('sh', [shim], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: home, PATH: `${pathBin}:/usr/bin:/bin` },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('path');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('writes a Git Bash sh entry point alongside mindos.cmd', async () => {
    const { buildWindowsShShimScript } = await import('./install-cli-shim');
    const script = buildWindowsShShimScript('C:\\Users\\张三\\.mindos\\runtime\\bin\\cli.js', 'C:\\Users\\张三');

    expect(script.startsWith('#!/bin/sh')).toBe(true);
    expect(script).not.toContain('\r\n'); // LF only — CRLF breaks sh in Git Bash
    expect(script).toContain(`"$HOME"'/.mindos/runtime/bin/cli.js'`);
    expect(script).toContain('exec "$PATH_NODE" "$CLI" "$@"');
  });

  it('updates Windows PATH via raw registry values preserving REG_EXPAND_SZ entries', async () => {
    const { buildWindowsPathRegistryScript } = await import('./install-cli-shim');
    const script = buildWindowsPathRegistryScript();

    expect(script).toContain('DoNotExpandEnvironmentNames');
    expect(script).toContain('[Microsoft.Win32.RegistryValueKind]::ExpandString');
    expect(script).toContain('SendMessageTimeout'); // raw registry writes don't broadcast WM_SETTINGCHANGE
    expect(script).toContain(`'%USERPROFILE%\\.mindos\\bin'`);
    expect(script).not.toContain("GetEnvironmentVariable('Path', 'User')");
  });

  it('does not treat commented-out PATH mentions as an existing install', async () => {
    const { hasActiveMindosPathLine } = await import('./install-cli-shim');

    expect(hasActiveMindosPathLine('# export PATH="$HOME/.mindos/bin:$PATH"\n')).toBe(false);
    expect(hasActiveMindosPathLine('export PATH="$HOME/.mindos/bin:$PATH"\n')).toBe(true);
    expect(hasActiveMindosPathLine('')).toBe(false);
  });

  it('guards cwd conditionally in the unix shim instead of always cd-ing to $HOME', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(path.join(__dirname, 'install-cli-shim.ts'), 'utf-8');

    expect(source).toContain('if ! pwd >/dev/null 2>&1; then cd "$HOME"');
    expect(source).not.toContain('\ncd "$HOME" 2>/dev/null || true');
  });

  it('generates sh scripts that pass sh -n syntax checking', async () => {
    if (process.platform === 'win32') return;
    const { buildWindowsShShimScript, buildUnixUninstallScript } = await import('./install-cli-shim');
    const { spawnSync } = await import('child_process');
    const fs = await import('fs');
    const os = await import('os');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-shim-syntax-'));
    try {
      for (const [name, content] of [
        ['gitbash-shim.sh', buildWindowsShShimScript('C:\\Users\\张三\\.mindos\\runtime\\bin\\cli.js', 'C:\\Users\\张三')],
        ['uninstall.sh', buildUnixUninstallScript()],
      ] as const) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, content, 'utf-8');
        const res = spawnSync('sh', ['-n', file], { encoding: 'utf-8' });
        expect(res.status, `${name} failed sh -n: ${res.stderr}`).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates a Windows cleanup script without touching the knowledge base', async () => {
    const { buildWindowsUninstallScript } = await import('./install-cli-shim');

    const script = buildWindowsUninstallScript();

    expect(script).toContain('taskkill /PID');
    expect(script).toContain('mindos.cmd');
    expect(script).toContain('%MINDOS_DIR%\\runtime');
    expect(script).toContain('%MINDOS_DIR%\\runtime-downloading');
    expect(script).toContain('%MINDOS_DIR%\\runtime-old');
    expect(script).toContain('%MINDOS_DIR%\\runtime-download.tar.gz');
    expect(script).toContain('DoNotExpandEnvironmentNames');
    expect(script).toContain('[Environment]::ExpandEnvironmentVariables');
    expect(script).toContain('[Microsoft.Win32.RegistryValueKind]::ExpandString');
    expect(script).toContain('%~f0');
    // Self-delete must be the LAST command line — cmd reads batch files from
    // disk line by line, so trailing commands after a plain del never run
    const lines = script.split('\r\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('rem'));
    expect(lines[lines.length - 1]).toContain('(goto) 2>nul');
    expect(lines[lines.length - 1]).toContain('%~f0');
    expect(script).not.toContain('rmdir /s /q "%USERPROFILE%\\MindOS\\mind"');
    expect(script).not.toContain('del /f /q "%USERPROFILE%\\MindOS\\mind"');
    expect(script).not.toContain('TODO: uninstall.bat');
  });

  it('verifies Windows PID command lines before killing uninstall leftovers', async () => {
    const { buildWindowsUninstallScript } = await import('./install-cli-shim');

    const script = buildWindowsUninstallScript();

    expect(script).toContain('Get-CimInstance Win32_Process');
    expect(script).toContain('CommandLine');
    expect(script).toContain('@geminilight\\mindos');
    expect(script).not.toContain('do taskkill /PID %%P /T /F');
  });

  it('verifies Unix PID command lines before killing uninstall leftovers', async () => {
    const { buildUnixUninstallScript } = await import('./install-cli-shim');

    const script = buildUnixUninstallScript();

    expect(script).toContain('ps -p "$pid" -o args=');
    expect(script).toContain('ps -p "$pid" -o comm=');
    expect(script).toContain('is_mindos_cmd()');
    expect(script).toContain('is_ssh_cmd()');
    expect(script).toContain('"$HOME/.mindos/ssh-tunnel.pid"');
    expect(script).toContain('*/.mindos/runtime/*');
    expect(script).toContain('"$HOME/.mindos/runtime"');
    expect(script).toContain('"$HOME/.mindos/runtime-downloading"');
    expect(script).toContain('"$HOME/.mindos/runtime-old"');
    expect(script).toContain('"$HOME/.mindos/runtime-download.tar.gz"');
    expect(script).toContain('/# MindOS CLI/,+1d');
    expect(script).not.toContain('while IFS= read -r pid; do\n      kill "$pid"');
    expect(script).not.toContain('rm -rf "$HOME/MindOS/mind"');
  });

  it('does not tell Windows users to manually add PATH after PATH was appended', async () => {
    const { buildRefreshCliSuccessDialog } = await import('./install-cli-shim');

    const dialog = buildRefreshCliSuccessDialog('win32', false, true);

    expect(dialog.message).toContain('added');
    expect(dialog.message).toContain('user PATH');
    expect(dialog.message).toContain('Open a new terminal');
    expect(dialog.message).not.toContain('add this folder');
  });
});
