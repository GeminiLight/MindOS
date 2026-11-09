import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  MINDOS_PI_AGENT_DIR_ENV,
  getMindosPiAgentDir,
  installMindosPiAgentDir,
  resetMindosPiAgentDirForTests,
  toHostChildEnv,
} from './index.js';

/**
 * MindOS embeds Pi but is its own product: Pi state (extensions, skills,
 * subagents, web-search config) lives under ~/.mindos, never in the user's own
 * ~/.pi. Pi and its extensions locate that state through PI_CODING_AGENT_DIR,
 * which is process-wide — so the host must also hand children back the user's
 * original value, or a Pi the user launches through MindOS (pi-acp) would run
 * inside MindOS's directory.
 */

const HOME = path.join(path.sep, 'home', 'ada');
const MINDOS_DIR = path.join(HOME, '.mindos', 'pi');

let env: NodeJS.ProcessEnv;

beforeEach(() => {
  resetMindosPiAgentDirForTests();
  env = { PATH: '/usr/bin' };
});

afterEach(() => resetMindosPiAgentDirForTests());

describe('the MindOS-owned Pi agent directory', () => {
  it('lives under ~/.mindos rather than the user\'s ~/.pi', () => {
    expect(getMindosPiAgentDir(HOME)).toBe(MINDOS_DIR);
  });

  it('is the variable Pi and its extensions read', () => {
    expect(MINDOS_PI_AGENT_DIR_ENV).toBe('PI_CODING_AGENT_DIR');
  });
});

describe('installing it for the host process', () => {
  it('points Pi at the MindOS directory', () => {
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(env.PI_CODING_AGENT_DIR).toBe(MINDOS_DIR);
  });

  it('overrides a value the user set for their own Pi', () => {
    env.PI_CODING_AGENT_DIR = '/home/ada/my-pi';
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(env.PI_CODING_AGENT_DIR).toBe(MINDOS_DIR);
  });

  it('returns the directory so callers can pass it to Pi explicitly', () => {
    expect(installMindosPiAgentDir({ env, homeDir: HOME })).toBe(MINDOS_DIR);
  });

  it('remembers the user\'s original value only once, so a second install cannot overwrite it', () => {
    env.PI_CODING_AGENT_DIR = '/home/ada/my-pi';
    installMindosPiAgentDir({ env, homeDir: HOME });
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(toHostChildEnv(env).PI_CODING_AGENT_DIR).toBe('/home/ada/my-pi');
  });
});

describe('handing children the user\'s environment back', () => {
  it('restores the value the user had before MindOS started', () => {
    env.PI_CODING_AGENT_DIR = '/home/ada/my-pi';
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(toHostChildEnv(env).PI_CODING_AGENT_DIR).toBe('/home/ada/my-pi');
  });

  it('drops the variable entirely when the user never set it', () => {
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(toHostChildEnv(env)).not.toHaveProperty('PI_CODING_AGENT_DIR');
  });

  it('keeps a value a caller chose deliberately for one child', () => {
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(toHostChildEnv({ ...env, PI_CODING_AGENT_DIR: '/tmp/sandbox' }).PI_CODING_AGENT_DIR)
      .toBe('/tmp/sandbox');
  });

  it('leaves every other variable alone', () => {
    installMindosPiAgentDir({ env, homeDir: HOME });

    expect(toHostChildEnv({ ...env, OPENAI_API_KEY: 'k' })).toMatchObject({ PATH: '/usr/bin', OPENAI_API_KEY: 'k' });
  });

  it('does not mutate the environment it was given', () => {
    installMindosPiAgentDir({ env, homeDir: HOME });
    const snapshot = { ...env };
    toHostChildEnv(env);

    expect(env).toEqual(snapshot);
  });

  it('passes the environment through untouched before MindOS installed anything', () => {
    expect(toHostChildEnv({ PATH: '/usr/bin', PI_CODING_AGENT_DIR: '/home/ada/my-pi' }))
      .toEqual({ PATH: '/usr/bin', PI_CODING_AGENT_DIR: '/home/ada/my-pi' });
  });
});
