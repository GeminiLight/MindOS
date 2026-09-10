/**
 * ACP shutdown hooks — make sure ACP agent processes (and the terminals they
 * spawned) die with the MindOS process instead of being orphaned.
 *
 * This is now a thin adapter over the shared process supervisor
 * (`agent/runtime/process-supervisor.ts`), which owns the single shutdown hook
 * for every locally spawned process (Codex app-servers, ACP agents). ACP adds
 * one extra teardown — `killAllAgents`, which reaps ACP terminals before their
 * parent agents — so the one hook covers terminals too (they are detached into
 * their own process group and are not tracked as supervised processes).
 *
 * Signal handlers can only do synchronous work reliably, so the teardown
 * tree-kills process groups directly; the graceful `session/close` path belongs
 * to `MindosHttpServer.close()`, which awaits `closeAllSessions`.
 */

import { killAllAgents } from './subprocess.js';
import {
  addProcessSupervisorShutdownTeardown,
  registerProcessSupervisorShutdownHooks,
  type ProcessSupervisorShutdownHookOptions,
} from '../../agent/runtime/process-supervisor.js';

export type AcpShutdownHookOptions = ProcessSupervisorShutdownHookOptions;

/**
 * Register the ACP contribution to the single supervisor shutdown hook. When
 * the caller supplies an explicit `killAll` (tests), it is registered verbatim
 * on the given target; otherwise ACP folds `killAllAgents` into the supervisor's
 * default teardown and ensures the hook is registered. Idempotent per target.
 */
export function registerAcpShutdownHooks(options: AcpShutdownHookOptions = {}): void {
  if (!options.killAll) {
    // Terminals must be reaped before their parent agents; the supervisor's
    // default killAll runs this teardown ahead of the supervised-process sweep.
    addProcessSupervisorShutdownTeardown(killAllAgents);
  }
  registerProcessSupervisorShutdownHooks(options);
}
