import { getInquiry, updateInquiry } from '../inquiries/index.js';
import { frameContentSchema } from '../inquiries/model.js';
import { createCoevolutionInquiry } from './inquiries.js';
import { readTask, fail } from './storage.js';
import { assertTaskAgent } from './runs.js';

/** An Agent may fill an empty candidate, never confirm a frame or overwrite human work. */
export function suggestCoevolutionInquiry(root: string, id: string, input: unknown, actor: { runId: string; chatSessionId: string }) {
  const parsed = frameContentSchema.safeParse(input);
  if (!parsed.success) return fail('invalid', 'Describe the two views and evidence that distinguishes them.');
  const task = readTask(root, id);
  if (!task) return fail('not-found', 'Task unavailable.');
  assertTaskAgent(root, task, actor);
  const inquiry = task.inquiryId ? getInquiry(root, task.inquiryId) : createCoevolutionInquiry(root, id, { version: task.version, requestId: 'agent-inquiry-' + task.id.slice(12), locale: 'zh' }).inquiry;
  if (!inquiry || inquiry.archived || !inquiry.draft) return fail('conflict', 'Continue the existing confirmed inquiry; do not overwrite it.');
  if (Object.entries(parsed.data).every(([key, value]) => inquiry.draft?.[key as keyof typeof parsed.data] === value)) return inquiry;
  if (inquiry.draft.question !== inquiry.source.question || ['explanationA', 'explanationB', 'distinction', 'capability'].some(key => inquiry.draft![key as keyof typeof inquiry.draft]!.trim())) return fail('conflict', 'A draft already exists. Ask the human to review it before replacing it.');
  return updateInquiry(root, inquiry.id, { version: inquiry.version, requestId: 'agent-draft-' + task.id.slice(12), action: 'save-draft', draft: parsed.data });
}
