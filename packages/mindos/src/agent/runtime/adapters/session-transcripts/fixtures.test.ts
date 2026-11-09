import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { listRuntimeSessionTranscripts } from './index.js';
import { RUNTIME_SESSION_TRANSCRIPT_ADAPTERS } from './registry.js';

/**
 * Format-drift guard.
 *
 * Every other test in this directory feeds the adapters hand-written records,
 * which proves the parsing logic but not that the logic still matches what the
 * vendors write to disk. These fixtures are byte-for-byte the record shapes
 * observed in real transcripts — only the prose inside them was replaced. When a
 * vendor renames a field or moves a store, the matching case here goes red
 * instead of the product silently returning an empty session list.
 *
 * Adding an adapter means adding a fixture: `enumerates adapter fixture coverage`
 * fails if this list drifts from the registry, so a new adapter cannot land
 * without a decision about its fixture being recorded here.
 */

const FIXTURES = dirname(fileURLToPath(import.meta.url)) + '/__fixtures__';

/** Adapters with no fixture, and why. Keep this honest rather than complete. */
const WITHOUT_FIXTURE: Record<string, string> = {
  'gemini-cli': 'no local Gemini CLI install to capture a real store from',
  'kimi-code': 'no local Kimi install to capture a real store from',
  opencode: 'no local OpenCode install to capture a real store from',
  'qwen-code': 'no local Qwen Code install to capture a real store from',
  'codebuddy-code': 'no local CodeBuddy install to capture a real store from',
  openclaw: 'no local OpenClaw install to capture a real store from',
  cursor: 'adapter is unverified and returns nothing by design',
  hermes: 'adapter is unverified and returns nothing by design',
};

const tempHomes: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mindos-transcript-fixtures-'));
  tempHomes.push(dir);
  return dir;
}

async function placeFixture(home: string, relativeDir: string, fixture: string, as: string): Promise<void> {
  const dir = join(home, relativeDir);
  await mkdir(dir, { recursive: true });
  await cp(join(FIXTURES, fixture), join(dir, as));
}

describe('session transcript fixtures track the real on-disk formats', () => {
  afterEach(async () => {
    await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  describe('claude-code', () => {
    it('reads a real-shaped project transcript into visible turns only', async () => {
      const home = await makeHome();
      await placeFixture(
        home,
        join('.claude', 'projects', '-workspace-demo-repo'),
        'claude-code.projects.jsonl',
        'claude-fixture-session.jsonl',
      );

      const [session, ...rest] = await listRuntimeSessionTranscripts({ runtimeId: 'claude', homeDir: home });

      expect(rest).toHaveLength(0);
      expect(session).toMatchObject({
        id: 'claude-fixture-session',
        cwd: '/workspace/demo-repo',
        transcriptSource: 'claude-code',
      });
      expect(session.turns?.map((turn) => [turn.role, turn.content])).toEqual([
        ['user', '以后都用 pnpm，不要用 npm。'],
        ['assistant', 'Understood. I will use pnpm for every command here.'],
        ['user', 'CI 也一起改。'],
        ['assistant', 'Updated the workflow to call pnpm.'],
      ]);
    });

    it('keeps thinking, tool calls, tool results and system notices out of the transcript', async () => {
      const home = await makeHome();
      await placeFixture(
        home,
        join('.claude', 'projects', '-workspace-demo-repo'),
        'claude-code.projects.jsonl',
        'claude-fixture-session.jsonl',
      );

      const [session] = await listRuntimeSessionTranscripts({ runtimeId: 'claude', homeDir: home });
      const transcript = (session.turns ?? []).map((turn) => turn.content).join('\n');

      expect(transcript).not.toContain('Hidden reasoning');
      expect(transcript).not.toContain('pnpm install');
      expect(transcript).not.toContain('Lockfile is up to date');
      expect(transcript).not.toContain('Harness notice');
    });
  });

  describe('codex', () => {
    const place = async (home: string, dir = 'sessions/2026/08/20') => placeFixture(
      home,
      join('.codex', ...dir.split('/')),
      'codex.rollout.jsonl',
      'rollout-2026-08-20T12-55-19-01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2.jsonl',
    );

    it('reads a real-shaped rollout into the conversation it recorded', async () => {
      const home = await makeHome();
      await place(home);

      const [session, ...rest] = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(rest).toHaveLength(0);
      expect(session).toMatchObject({
        id: '01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2',
        cwd: '/workspace/demo-repo',
        transcriptSource: 'codex',
      });
      expect(session.turns?.map((turn) => [turn.role, turn.content])).toEqual([
        ['user', '以后都用 pnpm，不要用 npm。'],
        ['assistant', 'Understood. I will use pnpm for every command in this repository.'],
        ['user', '是的，CI 也一起改。'],
        ['assistant', 'Updated the workflow to call pnpm.'],
      ]);
    });

    it('drops the scaffolding Codex replays through the user role', async () => {
      const home = await makeHome();
      await place(home);

      const [session] = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });
      const transcript = (session.turns ?? []).map((turn) => turn.content).join('\n');

      expect(transcript).not.toContain('environment_context');
      expect(transcript).not.toContain('AGENTS.md instructions');
      expect(transcript).not.toContain('heartbeat');
      expect(transcript).not.toContain('ambient UI state');
      expect(transcript).not.toContain('Files mentioned by the user');
      expect(transcript).not.toContain('coding agent'); // the developer-role system prompt
      expect(transcript).not.toContain('The user wants pnpm everywhere'); // reasoning
      expect(transcript).not.toContain('Lockfile is up to date'); // tool output
    });

    it('titles the session with the first thing the person actually said', async () => {
      const home = await makeHome();
      await place(home);

      const [session] = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(session.title).toBe('以后都用 pnpm，不要用 npm。');
    });

    it('also finds rollouts that Codex has archived', async () => {
      const home = await makeHome();
      await place(home, 'archived_sessions');

      const sessions = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.transcriptSource).toBe('codex');
    });

    it('reads every Codex home on the machine, not just the default one', async () => {
      // A '.codex-<name>' sibling is a separate profile with its own sessions;
      // reading only the default home silently drops it.
      const home = await makeHome();
      await place(home);
      const { readFile, writeFile, mkdir: makeDir } = await import('node:fs/promises');
      const other = (await readFile(join(FIXTURES, 'codex.rollout.jsonl'), 'utf8'))
        .replaceAll('01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2', '01a01d86-0bb8-7fb0-ab36-aaaaaaaaaaaa');
      const dir = join(home, '.codex-work', 'sessions', '2026', '08', '21');
      await makeDir(dir, { recursive: true });
      await writeFile(join(dir, 'rollout-2026-08-21T09-00-00-01a01d86-0bb8-7fb0-ab36-aaaaaaaaaaaa.jsonl'), other);

      const sessions = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(sessions.map((session) => session.id).sort()).toEqual([
        '01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2',
        '01a01d86-0bb8-7fb0-ab36-aaaaaaaaaaaa',
      ]);
    });

    it('resolves a single session by id without reading every rollout', async () => {
      const home = await makeHome();
      await place(home);

      const sessions = await listRuntimeSessionTranscripts({
        runtimeId: 'codex',
        sessionId: '01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2',
        homeDir: home,
      });

      expect(sessions).toHaveLength(1);
    });

    it('returns nothing rather than throwing when a rollout is truncated mid-write', async () => {
      const home = await makeHome();
      const dir = join(home, '.codex', 'sessions');
      await mkdir(dir, { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, 'rollout-2026-08-20T12-00-00-broken.jsonl'), '{"type":"session_meta","payl');

      await expect(listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home })).resolves.toEqual([]);
    });

    it('keeps one record when resume and archive leave copies of the same session', async () => {
      // A resumed rollout replays the earlier turns under the original id, and
      // archiving leaves a third copy. Counting them separately would fake the
      // cross-session evidence that agreement detection relies on.
      const home = await makeHome();
      await place(home);
      await place(home, 'sessions/2026/08/21');
      await place(home, 'archived_sessions');

      const sessions = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe('01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2');
    });

    it('prefers the copy that holds the most turns', async () => {
      const home = await makeHome();
      await place(home);
      const { readFile, writeFile, mkdir: makeDir } = await import('node:fs/promises');
      const full = await readFile(join(FIXTURES, 'codex.rollout.jsonl'), 'utf8');
      const trimmed = full.split('\n').filter(Boolean).slice(0, 8).join('\n');
      const dir = join(home, '.codex', 'sessions', '2026', '08', '19');
      await makeDir(dir, { recursive: true });
      await writeFile(join(dir, 'rollout-2026-08-19T09-00-00-01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2.jsonl'), trimmed);

      const [session] = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(session.turns?.length).toBe(4);
    });

    it('reads a rollout far larger than any in-memory ceiling would allow', async () => {
      // 8 of 32 live rollouts on the machine this was built against were over
      // 32MB, and the richest conversation on disk was 39MB. An earlier size
      // ceiling dropped exactly those, silently. Padding here is assistant
      // turns so the real exchange still has to survive the volume.
      const home = await makeHome();
      const { readFile, writeFile, mkdir: makeDir } = await import('node:fs/promises');
      const rows = (await readFile(join(FIXTURES, 'codex.rollout.jsonl'), 'utf8')).split('\n').filter(Boolean);
      const filler = JSON.stringify({
        type: 'response_item',
        timestamp: '2026-08-20T04:55:49.000Z',
        payload: { type: 'message', id: 'msg_pad', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(20_000) }] },
      });
      const dir = join(home, '.codex', 'sessions', '2026', '08', '20');
      await makeDir(dir, { recursive: true });
      await writeFile(
        join(dir, 'rollout-2026-08-20T12-55-19-01a01d86-0bb8-7fb0-ab36-a1c1b9e70ac2.jsonl'),
        [...rows, ...Array.from({ length: 1800 }, () => filler)].join('\n'),
      );

      const [session] = await listRuntimeSessionTranscripts({ runtimeId: 'codex', homeDir: home });

      expect(session).toBeDefined();
      expect(session.title).toBe('以后都用 pnpm，不要用 npm。');
      const human = (session.turns ?? []).filter((turn) => turn.role === 'user').map((turn) => turn.content);
      expect(human).toEqual(['以后都用 pnpm，不要用 npm。', '是的，CI 也一起改。']);
    });

    it('returns nothing for a home with no Codex store', async () => {
      await expect(listRuntimeSessionTranscripts({
        runtimeId: 'codex',
        homeDir: await makeHome(),
      })).resolves.toEqual([]);
    });
  });

  it('enumerates adapter fixture coverage so a new adapter cannot skip the decision', async () => {
    const files = await readdir(FIXTURES);
    const covered = new Set(files.map((file) => file.split('.')[0]));
    const registered = RUNTIME_SESSION_TRANSCRIPT_ADAPTERS.map((adapter) => adapter.id);

    for (const id of registered) {
      const hasFixture = covered.has(id);
      const hasReason = id in WITHOUT_FIXTURE;
      expect(
        hasFixture || hasReason,
        `adapter "${id}" has neither a fixture in __fixtures__ nor an entry in WITHOUT_FIXTURE`,
      ).toBe(true);
    }

    // A fixture landing for an adapter listed as uncovered means the list is stale.
    for (const id of Object.keys(WITHOUT_FIXTURE)) {
      expect(covered.has(id), `adapter "${id}" now has a fixture; drop it from WITHOUT_FIXTURE`).toBe(false);
      expect(registered, `WITHOUT_FIXTURE lists "${id}", which is no longer registered`).toContain(id);
    }
  });
});
