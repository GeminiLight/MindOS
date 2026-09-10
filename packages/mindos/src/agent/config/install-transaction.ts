import { existsSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfigAdapter, AgentServerWriteResult } from './adapter.js';
import { writeFileAtomically } from './formats.js';
import { linkSkillToAgent, unlinkSkillFromAgent, type SkillLinkAgent, type SkillLinkDeps, type SkillLinkOutcome } from './skill-link.js';
import type { AgentConfigScope, SkillRoot } from './types.js';

/**
 * Install MindOS into one agent as a single unit: MCP server entry, then the
 * MindOS skill in the agent's skill workspace, then a settings mutation. Any
 * failure rolls the earlier steps back in reverse order so the agent never
 * ends up half-connected (config written, skill missing) or with an orphan
 * skill copy after a failed config write.
 *
 * Both `POST /api/mcp/install` and `mindos mcp install` run through here;
 * the HTTP handler leaves the skill step off (skills are installed through
 * `/api/mcp/install-skill`), the CLI turns it on.
 */

export type InstallAgentConnectionSkillStep = {
  /** Skill directory name (`mindos`, `mindos-zh`). */
  name: string;
  /** Roots that may hold the skill body; resolved through `resolveSkillSourceDir`. */
  sourceRoots: SkillRoot[];
  deps?: SkillLinkDeps;
};

export type InstallAgentConnectionSettingsStep<T> = {
  read(): T;
  write(settings: T): void;
  mutate(settings: T): T;
};

export type InstallAgentConnectionInput<TSettings = unknown> = {
  adapter: AgentConfigAdapter;
  scope: AgentConfigScope;
  serverName?: string;
  entry: Record<string, unknown>;
  skill?: InstallAgentConnectionSkillStep;
  settings?: InstallAgentConnectionSettingsStep<TSettings>;
};

export type InstallAgentConnectionSkillResult =
  | { status: 'skipped' }
  | { status: 'exists' | 'copied' | 'linked' | 'repaired'; workspacePath: string; skillPath: string }
  | { status: 'failed'; workspacePath: string; skillPath: string; message: string };

export type InstallAgentConnectionResult = {
  ok: boolean;
  agent: string;
  scope: AgentConfigScope;
  config?: AgentServerWriteResult;
  skill: InstallAgentConnectionSkillResult;
  settings: 'skipped' | 'written' | 'failed';
  warnings: string[];
  /** The step that failed, when `ok` is false. */
  failedStep?: 'config' | 'skill' | 'settings';
  message?: string;
  /** True when at least one earlier step was undone after a failure. */
  rolledBack: boolean;
  /** Rollback steps that themselves failed; the agent may need manual repair. */
  rollbackErrors: string[];
};

export function installAgentConnection<TSettings = unknown>(
  input: InstallAgentConnectionInput<TSettings>,
): InstallAgentConnectionResult {
  const { adapter, scope } = input;
  const serverName = input.serverName ?? 'mindos';
  const result: InstallAgentConnectionResult = {
    ok: false,
    agent: adapter.key,
    scope,
    skill: { status: 'skipped' },
    settings: 'skipped',
    warnings: [],
    rolledBack: false,
    rollbackErrors: [],
  };
  const undo: Array<() => void> = [];

  const fail = (step: 'config' | 'skill' | 'settings', message: string): InstallAgentConnectionResult => {
    result.failedStep = step;
    result.message = message;
    for (const step of undo.reverse()) {
      try {
        step();
        result.rolledBack = true;
      } catch (error) {
        result.rollbackErrors.push(errorMessage(error));
      }
    }
    return result;
  };

  // 1. MCP server entry
  try {
    const write = adapter.writeServer(serverName, input.entry, scope);
    result.config = write;
    result.warnings.push(...write.warnings);
    if (write.written) {
      const { absPath, previousText } = write;
      undo.push(() => {
        if (previousText === null) {
          if (existsSync(absPath)) unlinkSync(absPath);
        } else {
          writeFileAtomically(absPath, previousText);
        }
      });
    }
  } catch (error) {
    return fail('config', errorMessage(error));
  }

  // 2. Skill
  if (input.skill) {
    const workspace = adapter.skillWorkspace();
    const skillPath = join(workspace.workspacePath, input.skill.name);
    const skillFile = join(skillPath, 'SKILL.md');
    const existedBefore = existsSync(skillFile);
    const partialBefore = !existedBefore && existsSync(skillPath);
    if (existedBefore) {
      result.skill = { status: 'exists', workspacePath: workspace.workspacePath, skillPath };
    } else {
      const linkAgent: SkillLinkAgent = {
        key: adapter.key,
        name: adapter.def.name,
        mode: workspace.mode === 'universal' ? 'universal' : 'additional',
        skillDir: workspace.workspacePath,
      };
      const outcome = linkSkillToAgent(input.skill.name, linkAgent, input.skill.sourceRoots, input.skill.deps);
      if (!outcome.ok) {
        result.skill = { status: 'failed', workspacePath: workspace.workspacePath, skillPath, message: outcome.message };
        return fail('skill', outcome.message);
      }
      result.skill = {
        status: skillStatus(outcome, partialBefore),
        workspacePath: workspace.workspacePath,
        skillPath,
      };
      if (outcome.result === 'linked' || outcome.result === 'copied') {
        undo.push(() => {
          const removed = unlinkSkillFromAgent(input.skill!.name, linkAgent, input.skill!.sourceRoots);
          if (!removed.ok) throw new Error(removed.message);
        });
      }
    }
  }

  // 3. Settings
  if (input.settings) {
    try {
      const previous = input.settings.read();
      input.settings.write(input.settings.mutate(previous));
      result.settings = 'written';
      undo.push(() => input.settings!.write(previous));
    } catch (error) {
      result.settings = 'failed';
      return fail('settings', errorMessage(error));
    }
  }

  result.ok = true;
  return result;
}

function skillStatus(outcome: Extract<SkillLinkOutcome, { ok: true }>, partialBefore: boolean): 'exists' | 'copied' | 'linked' | 'repaired' {
  if (outcome.result === 'already') return 'exists';
  if (partialBefore) return 'repaired';
  return outcome.result === 'linked' ? 'linked' : 'copied';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Remove a skill installed by {@link installAgentConnection}; a thin alias so callers need not build a `SkillLinkAgent`. */
export function removeInstalledSkill(adapter: AgentConfigAdapter, skillName: string, sourceRoots: SkillRoot[] = []): SkillLinkOutcome {
  const workspace = adapter.skillWorkspace();
  return unlinkSkillFromAgent(skillName, {
    key: adapter.key,
    name: adapter.def.name,
    mode: workspace.mode === 'universal' ? 'universal' : 'additional',
    skillDir: workspace.workspacePath,
  }, sourceRoots);
}

// `rmSync` is intentionally not used for rollback: unlinkSkillFromAgent only
// removes links and marked copies, so a rollback can never delete user data.
void rmSync;
