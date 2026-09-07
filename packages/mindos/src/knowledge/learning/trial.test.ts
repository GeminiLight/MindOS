import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startLearningCorrection, updateLearningLoop } from './store.js';
import { prepareLearningMethodTrial } from './trial.js';
import { updateContextAssetStatus } from '../context-assets/registry.js';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'method-trial-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function draft() { return startLearningCorrection(root, { cardId: 'trial', title: '证据边界', content: 'Check claims', sessions: [{ id: 's1', messageRefs: [{ role: 'assistant', messageIndex: 0, quote: 'A claim' }] }] }, { behavior: 'Check evidence', scope: 'Research', check: 'Design supports claims' }); }
it('prepares only the exact approved active method without starting a run or changing the journal', () => {
 let loop = draft();
 expect(() => prepareLearningMethodTrial(root, loop.id, -1, loop.version)).toThrow();
 loop = updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: -1, version: loop.version });
 const trial = prepareLearningMethodTrial(root, loop.id, -1, loop.version);
 expect(trial).toMatchObject({ path: loop.directMethod!.review!.targetPath, assetId: loop.directMethod!.review!.assetId, title: '证据边界', assetVersion: 1 });
 expect(trial.contentHash).toMatch(/^[a-f0-9]{64}$/);
 expect(() => prepareLearningMethodTrial(root, loop.id, -1, loop.version - 1)).toThrow();
 expect(() => prepareLearningMethodTrial(root, loop.id, 0, loop.version)).toThrow();
 updateContextAssetStatus(root, trial.assetId, 'deprecated');
 expect(() => prepareLearningMethodTrial(root, loop.id, -1, loop.version)).toThrow();
});
it('refuses missing, modified or unsafe files and malformed requests', () => {
 let loop = draft(); loop = updateLearningLoop(root, loop.id, { action: 'approve-agent', attemptIndex: -1, version: loop.version });
 const file = path.join(root, loop.directMethod!.review!.targetPath!);
 fs.writeFileSync(file, 'edited after approval');
 expect(() => prepareLearningMethodTrial(root, loop.id, -1, loop.version)).toThrow();
 fs.unlinkSync(file);
 expect(() => prepareLearningMethodTrial(root, loop.id, -1, loop.version)).toThrow();
 expect(() => prepareLearningMethodTrial(root, '../bad', -1, 1)).toThrow();
 expect(() => prepareLearningMethodTrial(root, loop.id, NaN, loop.version)).toThrow();
});
