import os from 'node:os';
import path from 'node:path';

/**
 * Where MindOS keeps the state of the Pi framework it embeds.
 *
 * MindOS is built on Pi but is its own product: extensions, skills, subagent
 * definitions and the web-search config that Pi and its extensions read live
 * under ~/.mindos, and MindOS neither reads nor writes the user's own ~/.pi.
 *
 * Pi and its extensions (pi-subagents, pi-web-access …) locate that state
 * through one variable, PI_CODING_AGENT_DIR. It is read from `process.env`
 * lazily and cached, so it has to be set process-wide. That has a cost: every
 * child would inherit it, and a Pi the user launches through MindOS (for
 * example `pi-acp` from the ACP registry) would then run inside MindOS's
 * directory instead of its own. `toHostChildEnv` gives children the user's
 * original value back.
 */
export const MINDOS_PI_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';

/**
 * Process-wide so every bundle copy agrees (Next loads core dist more than
 * once), matching the convention in `agent/global-state.ts`.
 */
const STATE_KEY = Symbol.for('mindos.foundation.piAgentDir');

type PiAgentDirState = {
  /** The MindOS directory this process installed. */
  installed: string;
  /** The user's value before MindOS touched it; undefined when it was unset. */
  original: string | undefined;
};

function state(): PiAgentDirState | undefined {
  return (globalThis as Record<symbol, PiAgentDirState | undefined>)[STATE_KEY];
}

export function getMindosPiAgentDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.mindos', 'pi');
}

/**
 * Point Pi at the MindOS directory for this process and return it, so callers
 * can also pass it to Pi explicitly. Idempotent: the user's original value is
 * recorded once, on the first install, and never overwritten afterwards.
 */
export function installMindosPiAgentDir(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  const env = options.env ?? process.env;
  const dir = getMindosPiAgentDir(options.homeDir);
  const current = state();
  if (!current) {
    (globalThis as Record<symbol, PiAgentDirState>)[STATE_KEY] = {
      installed: dir,
      original: env[MINDOS_PI_AGENT_DIR_ENV],
    };
  }
  env[MINDOS_PI_AGENT_DIR_ENV] = dir;
  return dir;
}

/**
 * The environment a child process should see: the user's own
 * PI_CODING_AGENT_DIR, not the one MindOS installed for itself. A value that
 * differs from what MindOS installed was chosen for this child on purpose and
 * is kept. Returns a copy; the input is not mutated.
 */
export function toHostChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const current = state();
  if (!current || env[MINDOS_PI_AGENT_DIR_ENV] !== current.installed) return { ...env };

  const child = { ...env };
  if (current.original === undefined) delete child[MINDOS_PI_AGENT_DIR_ENV];
  else child[MINDOS_PI_AGENT_DIR_ENV] = current.original;
  return child;
}

/** Test-only: forget what this process installed. */
export function resetMindosPiAgentDirForTests(): void {
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
}
