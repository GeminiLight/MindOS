import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { execFile } from 'child_process';
import { detectLocalAcpAgents, resolveExistingPresenceDir } from '../../lib/acp/detect-local';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

describe('detectLocalAcpAgents', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  const originalPlatform = process.platform;
  const originalAppData = process.env.APPDATA;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    mockExecFile.mockReset();
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
  });

  it('detects installed agents from PATH lookups', async () => {
    mockExecFile.mockImplementation((command, args, _options, callback) => {
      const binary = String(args?.[0] ?? '');
      const stdout = binary === 'gemini' ? '/usr/local/bin/gemini\n' : '';
      callback?.(stdout ? null : new Error('not found'), stdout, '');
      return {} as never;
    });

    const result = await detectLocalAcpAgents({ acpAgents: {} } as any);

    expect(result.installed.some((agent) => agent.id === 'gemini' && agent.binaryPath === '/usr/local/bin/gemini')).toBe(true);
  });

  it('does not mark directory-only detections as runnable when the launch command is unavailable', async () => {
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback?.(new Error('not found'), '', '');
      return {} as never;
    });
    existsSyncSpy.mockImplementation((filePath: fs.PathLike) => String(filePath).includes('.cursor/extensions'));

    const result = await detectLocalAcpAgents({ acpAgents: {} } as any);

    expect(result.installed.some((agent) => agent.id === 'cursor')).toBe(false);
    expect(result.notInstalled.some((agent) => agent.id === 'cursor')).toBe(true);
  });

  it('treats an override command path as installed even when it is outside PATH', async () => {
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback?.(new Error('not found'), '', '');
      return {} as never;
    });
    existsSyncSpy.mockImplementation((filePath: fs.PathLike) => String(filePath) === '/opt/tools/claude');

    const result = await detectLocalAcpAgents({
      acpAgents: {
        claude: {
          command: '/opt/tools/claude',
        },
      },
    } as any);

    expect(result.installed.some((agent) => agent.id === 'claude' && agent.binaryPath === '/opt/tools/claude')).toBe(true);
  });

  it('detects user-configured custom ACP agents and skips disabled entries', async () => {
    mockExecFile.mockImplementation((_command, args, _options, callback) => {
      const binary = String(Array.isArray(args) ? args.at(-1) : '');
      const stdout = binary === 'custom-acp' ? '/usr/local/bin/custom-acp\n' : '';
      callback?.(stdout ? null : new Error('not found'), stdout, '');
      return {} as never;
    });

    const result = await detectLocalAcpAgents({
      acpAgents: {
        'custom-acp': {
          name: 'Custom ACP',
          command: 'custom-acp',
          args: ['--acp'],
          detectCommands: ['custom-acp'],
          installCmd: 'npm install -g custom-acp',
        },
        'disabled-acp': {
          name: 'Disabled ACP',
          command: 'disabled-acp',
          enabled: false,
        },
      },
    } as any);

    expect(result.installed).toContainEqual(expect.objectContaining({
      id: 'custom-acp',
      name: 'Custom ACP',
      binaryPath: '/usr/local/bin/custom-acp',
      resolvedCommand: { cmd: 'custom-acp', args: ['--acp'], source: 'user-override' },
    }));
    expect(result.installed.some((agent) => agent.id === 'disabled-acp')).toBe(false);
    expect(result.notInstalled.some((agent) => agent.id === 'disabled-acp')).toBe(false);
  });

  it('tries the Windows where command on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockExecFile.mockImplementation((command, args, _options, callback) => {
      const binary = String(args?.[0] ?? '');
      const stdout = binary === 'gemini' ? 'C:\\Tools\\gemini.cmd\r\n' : '';
      callback?.(stdout ? null : new Error('not found'), stdout, '');
      return {} as never;
    });

    const result = await detectLocalAcpAgents({ acpAgents: {} } as any);

    expect(mockExecFile).toHaveBeenCalledWith('where', ['gemini'], expect.any(Object), expect.any(Function));
    expect(result.installed.some((agent) => agent.id === 'gemini' && agent.binaryPath === 'C:\\Tools\\gemini.cmd')).toBe(true);
  });

  it('can launch from an alternate detected executable when it matches the agent command family', async () => {
    mockExecFile.mockImplementation((_command, args, _options, callback) => {
      const binary = String(args?.[0] ?? '');
      const stdout = binary === 'qwen' ? '/usr/local/bin/qwen\n' : '';
      callback?.(stdout ? null : new Error('not found'), stdout, '');
      return {} as never;
    });

    const result = await detectLocalAcpAgents({ acpAgents: {} } as any);

    expect(result.installed.some((agent) => agent.id === 'qwen-code' && agent.binaryPath === '/usr/local/bin/qwen')).toBe(true);
  });

  it('expands Windows APPDATA placeholders when probing ACP presence directories', () => {
    process.env.APPDATA = 'C:/Users/Test/AppData/Roaming';
    existsSyncSpy.mockImplementation((filePath: fs.PathLike) => (
      String(filePath) === 'C:/Users/Test/AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/'
    ));

    expect(resolveExistingPresenceDir(['%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/'])).toBe(
      'C:/Users/Test/AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/',
    );
  });
});
