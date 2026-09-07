import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewEchoPromotionCandidate, updateContextAssetStatus } from '@geminilight/mindos/knowledge';
import { loadMindosAgentFileContext } from '@geminilight/mindos/agent/turn';
import { recordAttachedMethodReceipt } from '@/lib/agent/attached-method-receipt';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'attached-method-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function approved() { return reviewEchoPromotionCandidate(root, { decision: 'approve', candidate: { id: 'method-trial', kind: 'playbook', title: 'Check design', content: 'Check the research design before causal claims.', source: { label: 'Work correction', sessions: [{ id: 'source', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Check the design before that claim.' }] }] } } }); }
const load = (file: string) => ({ ...loadMindosAgentFileContext([file], undefined, { readFile: p => fs.readFileSync(path.join(root, p), 'utf8') }), mode: 'full' as const });
it('records the exact approved contents that will enter the prompt, without reading newer file contents', () => {
 const method = approved(), context = load(method.targetPath!);
 fs.writeFileSync(path.join(root, method.targetPath!), 'newer contents after prompt preparation');
 const receipt = recordAttachedMethodReceipt(root, 'Review a new study', context, 'trial-session');
 expect(receipt?.selections).toEqual([expect.objectContaining({ assetId: method.assetId, assetVersion: 1, sourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), truncated: false })]);
 expect(receipt?.metadata).toMatchObject({ chatSessionId: 'trial-session', trigger: 'explicit-method-context' });
 expect(recordAttachedMethodReceipt(root, 'Review', load(method.targetPath!), 'trial-session')).toBeNull();
});
it('does not attribute references, truncated, failed, empty or paused context to an approved method', () => {
 const method = approved(), context = load(method.targetPath!);
 expect(recordAttachedMethodReceipt(root, 'Review', { ...context, mode: 'reference', contextParts: [] })).toBeNull();
 expect(recordAttachedMethodReceipt(root, 'Review', { ...context, contextParts: [context.contextParts[0].slice(0, -5)] })).toBeNull();
 expect(recordAttachedMethodReceipt(root, 'Review', { ...context, failedFiles: [method.targetPath!] })).toBeNull();
 expect(recordAttachedMethodReceipt(root, 'Review', { contextParts: [], failedFiles: [] })).toBeNull();
 updateContextAssetStatus(root, method.assetId!, 'deprecated');
 expect(recordAttachedMethodReceipt(root, 'Review', context)).toBeNull();
});
it('does not block a task when its evidence cannot be saved', () => {
 const method = approved(), context = load(method.targetPath!);
 fs.writeFileSync(path.join(root, '.mindos/retrieval-receipts'), 'blocks evidence directory');
 expect(recordAttachedMethodReceipt(root, 'Review', context)).toBeNull();
});
