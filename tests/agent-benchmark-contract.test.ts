import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const benchmarkRoot = path.join(repoRoot, 'benchmark', 'Agent');
const casesPath = path.join(benchmarkRoot, 'cases.json');
const fixtureRoot = path.join(benchmarkRoot, 'fixtures', 'base-mind');
const runnerPath = path.join(benchmarkRoot, 'run-agent-benchmark.mjs');
const mindosSkillPath = path.join(repoRoot, 'skills', 'mindos', 'SKILL.md');
const mindosZhSkillPath = path.join(repoRoot, 'skills', 'mindos-zh', 'SKILL.md');
const mirroredSkillFiles = [
  ['skills/mindos/SKILL.md', 'packages/web/data/skills/mindos/SKILL.md'],
  ['skills/mindos-zh/SKILL.md', 'packages/web/data/skills/mindos-zh/SKILL.md'],
  ['skills/mindos/references/write-supplement.md', 'packages/web/data/skills/mindos/references/write-supplement.md'],
  ['skills/mindos-zh/references/write-supplement.md', 'packages/web/data/skills/mindos-zh/references/write-supplement.md'],
  ['skills/mindos/references/knowledge-health.md', 'packages/web/data/skills/mindos/references/knowledge-health.md'],
  ['skills/mindos-zh/references/knowledge-health.md', 'packages/web/data/skills/mindos-zh/references/knowledge-health.md'],
  ['skills/mindos/references/preference-capture.md', 'packages/web/data/skills/mindos/references/preference-capture.md'],
  ['skills/mindos-zh/references/preference-capture.md', 'packages/web/data/skills/mindos-zh/references/preference-capture.md'],
];

type BenchmarkCase = {
  id: string;
  locale: string;
  capability: string;
  query: string;
  expected: {
    idealAnswer: string;
    shouldRead: boolean;
    shouldWrite: boolean;
    shouldAsk: boolean;
    expectedReadFiles: string[];
    expectedWriteFiles: string[];
    expectedWriteFilesAny?: string[];
    expectedWriteFilePatterns?: string[];
    mustMention: string[];
    mustNotMention: string[];
    successCriteria: string[];
  };
};

function loadCases(): BenchmarkCase[] {
  const parsed = JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: BenchmarkCase[] };
  return parsed.cases;
}

describe('Agent benchmark contract', () => {
  it('keeps a broad set of realistic MindOS Agent cases', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(20);

    const capabilities = new Set(cases.map((testCase) => testCase.capability));
    for (const capability of [
      'lookup-history',
      'capture-lesson',
      'inbox-capture',
      'inbox-organization',
      'targeted-update',
      'boundary',
      'preference-capture',
      'knowledge-health',
      'sop',
      'missing-evidence',
      'naturalness',
    ]) {
      expect(capabilities.has(capability), `missing capability ${capability}`).toBe(true);
    }
  });

  it('requires observable ground truth for every query', () => {
    for (const testCase of loadCases()) {
      expect(testCase.id).toMatch(/^[a-z0-9-]+$/);
      expect(testCase.query.trim().length, testCase.id).toBeGreaterThan(5);
      expect(testCase.expected.idealAnswer.trim().length, testCase.id).toBeGreaterThan(20);
      expect(Array.isArray(testCase.expected.successCriteria), testCase.id).toBe(true);
      expect(testCase.expected.successCriteria.length, testCase.id).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(testCase.expected.mustMention), testCase.id).toBe(true);
      expect(Array.isArray(testCase.expected.mustNotMention), testCase.id).toBe(true);
      expect(typeof testCase.expected.shouldRead, testCase.id).toBe('boolean');
      expect(typeof testCase.expected.shouldWrite, testCase.id).toBe('boolean');
      expect(typeof testCase.expected.shouldAsk, testCase.id).toBe('boolean');
    }
  });

  it('points expected fixture reads at files that exist when reads are expected', () => {
    for (const testCase of loadCases()) {
      for (const relPath of testCase.expected.expectedReadFiles ?? []) {
        expect(existsSync(path.join(fixtureRoot, relPath)), `${testCase.id} expected missing fixture file ${relPath}`).toBe(true);
      }
    }
  });

  it('does not expect root-level writes', () => {
    for (const testCase of loadCases()) {
      for (const relPath of testCase.expected.expectedWriteFiles ?? []) {
        expect(relPath.includes('/'), `${testCase.id} writes to root-level path ${relPath}`).toBe(true);
      }
      for (const relPath of testCase.expected.expectedWriteFilesAny ?? []) {
        expect(relPath.includes('/'), `${testCase.id} writes to root-level path ${relPath}`).toBe(true);
      }
    }
  });

  it('keeps setup failures separate from Agent behavior failures', () => {
    const runner = readFileSync(runnerPath, 'utf8');
    expect(runner).toContain('generated-for-start-server');
    expect(runner).toContain('mindos-agent-benchmark-home-');
    expect(runner).toContain('authToken: token');
    expect(runner).toContain('setupStatus');
    expect(runner).toContain('setup_failed');
    expect(runner).toContain('No API key was detected');
  });

  it('scores behavior from real MindRoot file changes, not output text alone', () => {
    const runner = readFileSync(runnerPath, 'utf8');
    expect(runner).toContain('snapshotMindRoot');
    expect(runner).toContain('diffSnapshots');
    expect(runner).toContain('actualFileChanges');
    expect(runner).toContain('expected-write-file');
    expect(runner).toContain('expected-write-file-any');
    expect(runner).toContain('expected-write-file-pattern-any');
    expect(runner).toContain('should-not-write');
    expect(runner).toContain('should-not-use-tools');
  });

  it('can reset the fixture before each live case for isolated replay', () => {
    const runner = readFileSync(runnerPath, 'utf8');
    expect(runner).toContain('--isolate-cases');
    expect(runner).toContain('resetMindRootFromFixture');
    expect(runner).toContain('isolateCases');
  });

  it('can throttle full live suites to avoid provider RPM noise', () => {
    const runner = readFileSync(runnerPath, 'utf8');
    const readme = readFileSync(path.join(benchmarkRoot, 'README.md'), 'utf8');

    expect(runner).toContain('--delay-ms');
    expect(runner).toContain('delayMs');
    expect(runner).toContain('waiting');
    expect(readme).toContain('--delay-ms');
    expect(readme).toContain('rate-limited providers');
  });

  it('can re-score previous live outputs without another model call', () => {
    const runner = readFileSync(runnerPath, 'utf8');
    const readme = readFileSync(path.join(benchmarkRoot, 'README.md'), 'utf8');

    expect(runner).toContain('--replay-results');
    expect(runner).toContain('replayResults');
    expect(runner).toContain('replayedFrom');
    expect(readme).toContain('Re-score A Prior Live Run');
    expect(readme).toContain('--replay-results');
  });

  it('keeps default MindOS skill copies aligned', () => {
    for (const [source, packaged] of mirroredSkillFiles) {
      expect(readFileSync(path.join(repoRoot, packaged), 'utf8'), `${packaged} should match ${source}`)
        .toBe(readFileSync(path.join(repoRoot, source), 'utf8'));
    }
  });

  it('documents the natural answer and precise retrieval contract in default skills', () => {
    const english = readFileSync(mindosSkillPath, 'utf8');
    const zh = readFileSync(mindosZhSkillPath, 'utf8');

    expect(english).toContain('## Answer contract');
    expect(english).toContain('Close the turn cleanly');
    expect(english).toContain('Respect the source-code boundary');
    expect(english).toContain('short no-change sentence');
    expect(english).toContain('Explicit handoff requests');
    expect(english).toContain('Uploaded content write');
    expect(english).toContain('Do NOT** mechanically fire 2-4 searches');

    expect(zh).toContain('## 回答收口');
    expect(zh).toContain('## 检索策略');
    expect(zh).toContain('尊重源码边界');
    expect(zh).toContain('短句说明没有修改');
    expect(zh).toContain('明确要求交接上下文');
    expect(zh).toContain('上传内容写入');
    expect(zh).toContain('不要机械地每次都发 2-4 条搜索');
    expect(zh).not.toContain('禁止单关键词搜索。至少 2-4 个并行搜索');
  });

  it('documents preference persistence confirmation boundaries', () => {
    const englishRef = readFileSync(path.join(repoRoot, 'skills/mindos/references/preference-capture.md'), 'utf8');
    const zhRef = readFileSync(path.join(repoRoot, 'skills/mindos-zh/references/preference-capture.md'), 'utf8');
    const prompt = readFileSync(path.join(repoRoot, 'packages/mindos/src/agent/prompt/agent-prompt.txt'), 'utf8');

    expect(englishRef).toContain('Future-tense preference wording is not save permission');
    expect(englishRef).toContain('auto-confirm-all: false');
    expect(englishRef).toContain('auto-confirm: false');
    expect(zhRef).toContain('未来时态的偏好表述不是保存授权');
    expect(zhRef).toContain('auto-confirm-all: false');
    expect(zhRef).toContain('auto-confirm: false');
    expect(prompt).toContain('candidate preference, not persistence permission');
    expect(prompt).toContain('Do not answer a preference-capture turn from memory alone');
    expect(prompt).toContain('auto-confirm-all: true');
    expect(prompt).toContain('auto-confirm: true');
  });
});
