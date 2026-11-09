import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProcessSupervisorForTest, spawnSupervisedProcess } from './process-supervisor.js';
import {
  installMindosPiAgentDir,
  resetMindosPiAgentDirForTests,
} from '../../foundation/pi-agent-dir/index.js';

/**
 * Every external agent MindOS launches (ACP agents, the Codex app-server) goes
 * through this supervisor, so it is where MindOS's own PI_CODING_AGENT_DIR is
 * taken back out. Without it, a user's Pi launched as `pi-acp` would run inside
 * ~/.mindos/pi-agent instead of its own directory.
 */

const ORIGINAL = process.env.PI_CODING_AGENT_DIR;

function captureSpawnEnv(spec: { env?: NodeJS.ProcessEnv } = {}): NodeJS.ProcessEnv | undefined {
  const fakeChild = Object.assign(new EventEmitter(), {
    pid: 4321, stdout: null, stderr: null, stdin: null, kill: vi.fn(), exitCode: null, signalCode: null,
  });
  const spawnMock = vi.fn(() => fakeChild as never) as unknown as typeof spawn;
  spawnSupervisedProcess({ label: 'pi-acp', command: 'pi-acp', spawn: spawnMock, ...spec });
  fakeChild.emit('exit', 0, null);
  const options = (spawnMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
  return options.env;
}

beforeEach(() => {
  resetMindosPiAgentDirForTests();
  resetProcessSupervisorForTest();
});

afterEach(() => {
  resetMindosPiAgentDirForTests();
  resetProcessSupervisorForTest();
  if (ORIGINAL === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL;
});

describe('external agents see the user\'s Pi directory, not MindOS\'s', () => {
  it('strips the MindOS value when the user never set one', () => {
    delete process.env.PI_CODING_AGENT_DIR;
    installMindosPiAgentDir({ homeDir: '/home/ada' });

    expect(captureSpawnEnv()).not.toHaveProperty('PI_CODING_AGENT_DIR');
  });

  it('restores the user\'s own value', () => {
    process.env.PI_CODING_AGENT_DIR = '/home/ada/my-pi';
    installMindosPiAgentDir({ homeDir: '/home/ada' });

    expect(captureSpawnEnv()?.PI_CODING_AGENT_DIR).toBe('/home/ada/my-pi');
  });

  it('also applies when the caller passes an explicit environment', () => {
    delete process.env.PI_CODING_AGENT_DIR;
    installMindosPiAgentDir({ homeDir: '/home/ada' });

    const env = captureSpawnEnv({ env: { ...process.env, FOO: 'bar' } });
    expect(env).not.toHaveProperty('PI_CODING_AGENT_DIR');
    expect(env?.FOO).toBe('bar');
  });

  it('keeps the rest of the host environment', () => {
    installMindosPiAgentDir({ homeDir: '/home/ada' });

    expect(captureSpawnEnv()?.PATH).toBe(process.env.PATH);
  });
});
