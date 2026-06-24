import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mindosRuntimeDescriptor,
  nativeDescriptor,
} from '../../agent/runtime/descriptors.js';
import {
  emptySkillRuntimeRequirements,
  type MindosSkillRuntimeRequirements,
} from '../../agent/runtime/skill-runtime-requirements.js';
import { evaluateSkillRuntimeMatch } from '../../agent/runtime/skill-runtime-matcher.js';
import type { MindosSkillInfo, MindosSkillRoot } from './skills.js';
import {
  buildSkillRuntimeMatchesPayload,
  handleSkillRuntimeMatchesGet,
} from './skill-runtime-matches.js';

const CHECKED_AT = '2026-06-25T00:00:00.000Z';

function codexRuntime() {
  return nativeDescriptor({
    id: 'codex',
    name: 'Codex',
    checkedAt: CHECKED_AT,
    source: {
      id: 'codex-acp',
      name: 'Codex',
      binaryPath: '/usr/local/bin/codex',
      status: 'available',
    },
  });
}

function skill(
  name: string,
  runtimeRequirements: MindosSkillRuntimeRequirements,
): MindosSkillInfo {
  return {
    name,
    description: name,
    path: `/skills/${name}/SKILL.md`,
    source: 'user',
    enabled: true,
    editable: true,
    origin: 'custom',
    runtimeRequirements,
  };
}

function requirements(
  overrides: Partial<MindosSkillRuntimeRequirements> = {},
): MindosSkillRuntimeRequirements {
  return {
    ...emptySkillRuntimeRequirements(),
    declared: true,
    approvals: 'not-required',
    userInput: 'not-required',
    ...overrides,
  };
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('skill runtime matcher', () => {
  it('reports a ready match when a declared coding skill fits the Codex runtime', () => {
    const match = evaluateSkillRuntimeMatch({
      skill: skill('ship-it', requirements({
        runtimeKinds: ['codex', 'native'],
        requiredTools: ['shell', 'file', 'git', 'mcp'],
        requiredCapabilities: ['diff-output', 'branch-output', 'pr-output', 'approval-routing'],
        approvals: 'required',
        userInput: 'required',
      })),
      runtime: codexRuntime(),
    });

    expect(match.level).toBe('ready');
    expect(match.blockers).toBeUndefined();
    expect(match.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-kind', status: 'satisfied' }),
      expect.objectContaining({ id: 'tool:git', status: 'satisfied' }),
      expect.objectContaining({ id: 'capability:pr-output', status: 'satisfied' }),
      expect.objectContaining({ id: 'approval-requirement', status: 'satisfied' }),
      expect.objectContaining({ id: 'user-input-requirement', status: 'satisfied' }),
    ]));
  });

  it('blocks a skill whose declared runtime kind, tools, and output are missing', () => {
    const match = evaluateSkillRuntimeMatch({
      skill: skill('native-ship', requirements({
        runtimeKinds: ['codex'],
        requiredTools: ['shell', 'git'],
        requiredCapabilities: ['branch-output'],
      })),
      runtime: mindosRuntimeDescriptor(CHECKED_AT),
    });

    expect(match.level).toBe('blocked');
    expect(match.blockers).toEqual(expect.arrayContaining([
      'runtime-kind',
      'tool:shell',
      'tool:git',
      'capability:branch-output',
    ]));
  });

  it('keeps undeclared skill requirements unknown instead of treating them as safe everywhere', () => {
    const match = evaluateSkillRuntimeMatch({
      skill: skill('legacy', emptySkillRuntimeRequirements()),
      runtime: codexRuntime(),
    });

    expect(match.level).toBe('unknown');
    expect(match.declared).toBe(false);
    expect(match.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'skill-requirements-declared', status: 'unknown' }),
    ]));
    expect(match.blockers).toBeUndefined();
  });

  it('does not silently satisfy unknown named capabilities', () => {
    const match = evaluateSkillRuntimeMatch({
      skill: skill('future-skill', requirements({
        runtimeKinds: ['codex'],
        requiredCapabilities: ['vector-db'],
      })),
      runtime: codexRuntime(),
    });

    expect(match.level).toBe('unknown');
    expect(match.blockers).toBeUndefined();
    expect(match.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'capability:vector-db', status: 'unknown' }),
    ]));
  });

  it('blocks remote-control when the skill explicitly declares remote unsafe', () => {
    const match = evaluateSkillRuntimeMatch({
      skill: skill('local-only', requirements({
        runtimeKinds: ['codex'],
        remote: 'unsafe',
      })),
      runtime: codexRuntime(),
      scenario: 'remote-control',
    });

    expect(match.level).toBe('blocked');
    expect(match.blockers).toContain('remote-unsafe');
    expect(match.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'remote-safety', status: 'missing' }),
    ]));
  });

  it('blocks unattended automation when the skill still requires user input', () => {
    const match = evaluateSkillRuntimeMatch({
      skill: skill('interview', requirements({
        runtimeKinds: ['codex'],
        unattended: 'safe',
        userInput: 'required',
      })),
      runtime: codexRuntime(),
      scenario: 'unattended-automation',
    });

    expect(match.level).toBe('blocked');
    expect(match.blockers).toContain('user-input-required');
  });
});

describe('skill runtime match payload', () => {
  it('builds a skill x runtime match matrix for the requested scenario', () => {
    const payload = buildSkillRuntimeMatchesPayload({
      skills: [skill('ship-it', requirements({
        runtimeKinds: ['codex'],
        requiredTools: ['git'],
        requiredCapabilities: ['pr-output'],
      }))],
      runtimes: [mindosRuntimeDescriptor(CHECKED_AT), codexRuntime()],
      scenario: 'interactive-turn',
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.scenario).toBe('interactive-turn');
    expect(payload.matches['ship-it']?.codex.level).toBe('ready');
    expect(payload.matches['ship-it']?.mindos).toMatchObject({
      level: 'blocked',
      blockers: expect.arrayContaining(['runtime-kind', 'tool:git', 'capability:pr-output']),
    });
  });

  it('handles GET /api/skills/runtime-matches from scanned skill roots', async () => {
    const base = makeTempDir('mindos-skill-runtime-matches-');
    try {
      const root = join(base, 'skills');
      const dir = join(root, 'ship-it');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), [
        '---',
        'name: ship-it',
        'description: Shipping workflow',
        'runtimeKinds: codex',
        'requiredTools: git',
        'requiredCapabilities: pr-output',
        'remoteSafe: true',
        'requiresApprovals: false',
        'requiresUserInput: false',
        '---',
        '',
        'Ship code.',
      ].join('\n'), 'utf-8');
      const skillRoots: MindosSkillRoot[] = [{ path: root, source: 'user', origin: 'custom', editable: true }];

      const response = await handleSkillRuntimeMatchesGet(new URLSearchParams('scenario=remote-control'), {
        skillRoots,
        listRuntimes: () => [mindosRuntimeDescriptor(CHECKED_AT), codexRuntime()],
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        schemaVersion: 1,
        scenario: 'remote-control',
        skills: [expect.objectContaining({ name: 'ship-it' })],
        runtimes: [
          expect.objectContaining({ id: 'mindos' }),
          expect.objectContaining({ id: 'codex' }),
        ],
      });
      expect(response.body && 'matches' in response.body ? response.body.matches['ship-it']?.codex : undefined)
        .toMatchObject({
          level: 'limited',
          reasons: expect.arrayContaining([
            expect.objectContaining({ id: 'runtime-scenario:remote-control', status: 'limited' }),
            expect.objectContaining({ id: 'remote-safety', status: 'satisfied' }),
          ]),
        });
      expect(response.headers?.['Cache-Control']).toBe('no-store');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects unsupported scenarios', async () => {
    const response = await handleSkillRuntimeMatchesGet(new URLSearchParams('scenario=nope'), {
      skillRoots: [],
      listRuntimes: () => [],
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Unsupported scenario: nope' });
  });

  it('returns an explicit error when runtime descriptors cannot be built', async () => {
    const response = await handleSkillRuntimeMatchesGet(new URLSearchParams(), {
      skillRoots: [],
      listRuntimes: () => {
        throw new Error('runtime detection failed');
      },
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'runtime detection failed' });
  });
});
