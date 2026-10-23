import { redactSensitiveText } from '../../foundation/security/redaction.js';
import { getKnowledgeAgentRunCapsule, type KnowledgeAgentRunSnapshot } from '../agent-run-data.js';

/** The capsule retains completed output beyond the ledger's short summary. */
export function coevolutionRunOutput(root: string, run: KnowledgeAgentRunSnapshot): string {
  let output = run.outputSummary ?? '';
  if (run.status === 'completed') {
    try {
      const capsule = getKnowledgeAgentRunCapsule(root, run.id);
      if (capsule?.id === run.id && capsule.runId === run.id &&
          capsule.chatSessionId === run.chatSessionId && capsule.status === 'completed' &&
          capsule.result?.outputText) {
        output = capsule.result.outputText;
      }
    } catch {
      // Older or unavailable capsules retain their attributable ledger summary.
    }
  }
  return redactSensitiveText(output).slice(0, 64 * 1024);
}
