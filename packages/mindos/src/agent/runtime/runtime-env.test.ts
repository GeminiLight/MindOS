import {
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  buildCodexAppServerEnv,
  extractLoginShellEnvValue,
  extractWindowsRegistryEnvValue,
  buildAgentRuntimeEnv,
  readPlatformEnvironmentValue,
  resolveAgentRuntimeEnvOverlay,
} from './index.js';

describe('agent runtime adapters: environment detection', () => {
  it('injects only the configured Codex provider key from the runtime environment fallback', () => {
    const readShellEnvValue = vi.fn((key: string) => key === 'STAFF_KEY' ? 'shell-secret' : undefined);
    const env = buildCodexAppServerEnv({
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/Users/tester',
        OTHER_SECRET: 'do-not-copy-from-shell',
      },
      configText: [
        'model_provider = "subhub-prod-responses"',
        '',
        '[model_providers.subhub-prod-responses]',
        'env_key = "STAFF_KEY"',
      ].join('\n'),
      readShellEnvValue,
    });

    expect(readShellEnvValue).toHaveBeenCalledWith('STAFF_KEY', expect.objectContaining({
      PATH: '/usr/bin',
      HOME: '/Users/tester',
    }));
    expect(env.STAFF_KEY).toBe('shell-secret');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.OTHER_SECRET).toBe('do-not-copy-from-shell');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('does not override an explicit Codex provider key already visible to MindOS', () => {
    const readShellEnvValue = vi.fn(() => 'shell-secret');
    const env = buildCodexAppServerEnv({
      baseEnv: { STAFF_KEY: 'process-secret' },
      configText: [
        'model_provider = "subhub-prod-responses"',
        '',
        '[model_providers.subhub-prod-responses]',
        'env_key = "STAFF_KEY"',
      ].join('\n'),
      readShellEnvValue,
    });

    expect(readShellEnvValue).not.toHaveBeenCalled();
    expect(env.STAFF_KEY).toBe('process-secret');
  });

  it('extracts Codex provider keys from login shell output without banner pollution', () => {
    expect(extractLoginShellEnvValue([
      'debug banner from shell profile',
      '__MINDOS_CODEX_ENV_VALUE_START__shell-secret__MINDOS_CODEX_ENV_VALUE_END__',
      'goodbye banner',
    ].join('\n'))).toBe('shell-secret');
    expect(extractLoginShellEnvValue('debug banner without sentinels')).toBeUndefined();
  });

  it('reads macOS launchd environment before falling back to a login shell', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const value = readPlatformEnvironmentValue({
      key: 'STAFF_KEY',
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      execFile: (command, args) => {
        calls.push({ command, args });
        if (command === 'launchctl') return 'launch-secret\n';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    expect(value).toBe('launch-secret');
    expect(calls).toEqual([{ command: 'launchctl', args: ['getenv', 'STAFF_KEY'] }]);
  });

  it('reads Windows user or machine environment without using a POSIX login shell', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const value = readPlatformEnvironmentValue({
      key: 'STAFF_KEY',
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      execFile: (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('powershell.exe')) {
          return '__MINDOS_CODEX_ENV_VALUE_START__windows-secret__MINDOS_CODEX_ENV_VALUE_END__';
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    expect(value).toBe('windows-secret');
    expect(calls[0]?.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']));
  });

  it('falls back to Windows registry environment values when PowerShell is unavailable', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const value = readPlatformEnvironmentValue({
      key: 'STAFF_KEY',
      platform: 'win32',
      env: {},
      execFile: (command, args) => {
        calls.push({ command, args });
        if (command !== 'reg.exe') throw new Error('PowerShell unavailable');
        return [
          '',
          'HKEY_CURRENT_USER\\Environment',
          '    STAFF_KEY    REG_EXPAND_SZ    registry-secret',
          '',
        ].join('\r\n');
      },
    });

    expect(value).toBe('registry-secret');
    expect(extractWindowsRegistryEnvValue('    STAFF_KEY    REG_SZ    direct-secret', 'STAFF_KEY')).toBe('direct-secret');
    expect(calls.some((call) => call.command === 'reg.exe')).toBe(true);
  });

  it('injects only allowlisted local runtime env keys from the runtime environment fallback', () => {
    const readShellEnvValue = vi.fn((key: string) => ({
      CLAUDE_CODE_OAUTH_TOKEN: 'shell-token',
      EXTRA_SECRET: 'extra-secret',
    }[key]));

    const result = buildAgentRuntimeEnv({
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/Users/tester',
        EXTRA_SECRET: 'process-extra',
      },
      settings: {
        keys: [
          'CLAUDE_CODE_OAUTH_TOKEN',
          'EXTRA_SECRET',
          'invalid key',
          '__proto__',
          'MISSING_KEY',
          'CLAUDE_CODE_OAUTH_TOKEN',
        ],
      },
      readShellEnvValue,
    });

    expect(result.keys).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'EXTRA_SECRET', 'MISSING_KEY']);
    expect(readShellEnvValue).toHaveBeenCalledWith('CLAUDE_CODE_OAUTH_TOKEN', expect.objectContaining({
      PATH: '/usr/bin',
      HOME: '/Users/tester',
    }));
    expect(readShellEnvValue).not.toHaveBeenCalledWith('EXTRA_SECRET', expect.anything());
    expect(result.injectedKeys).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
    expect(result.missingKeys).toEqual(['MISSING_KEY']);
    expect(result.overlay).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'shell-token' });
    expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('shell-token');
    expect(result.env.EXTRA_SECRET).toBe('process-extra');
    expect(Object.prototype.hasOwnProperty.call(result.env, '__proto__')).toBe(false);
  });

  it('returns only the allowlist overlay when resolving local runtime env for ACP launch options', () => {
    const result = resolveAgentRuntimeEnvOverlay({
      baseEnv: { PATH: '/usr/bin' },
      settings: { keys: ['GEMINI_API_KEY'] },
      readShellEnvValue: (key) => key === 'GEMINI_API_KEY' ? 'shell-gemini' : undefined,
    });

    expect(result.overlay).toEqual({ GEMINI_API_KEY: 'shell-gemini' });
    expect(result.injectedKeys).toEqual(['GEMINI_API_KEY']);
  });
});
