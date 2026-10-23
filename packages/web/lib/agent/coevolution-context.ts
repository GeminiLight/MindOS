import {
  coevolutionContext,
  consumeCoevolutionDraft,
  findCoevolutionTaskBySession,
} from "@geminilight/mindos/knowledge";
import { createHash } from 'node:crypto';

/** Resolve on every turn so a paused standard or revised agreement stops applying immediately. */
export async function resolveCoevolutionTurnContext(input: {
  mindRoot: string;
  chatSessionId?: string;
  prompt: string;
  interactiveTools: boolean;
}): Promise<{ context: string; excludePaths: string[]; receipt?: { taskId: string; taskVersion: number; mode: 'guide' | 'together' | 'try'; context: string; contextHash: string } }> {
  const empty = { context: "", excludePaths: [] as string[] };
  if (!input.chatSessionId) return empty;
  const prepared = consumeCoevolutionDraft(input.mindRoot, {
    prompt: input.prompt,
    chatSessionId: input.chatSessionId,
  });
  if (!prepared && input.prompt.includes("[coevolution-task:")) {
    throw new Error(
      "This workspace draft changed or expired. Return to the workspace and open the current task again.",
    );
  }
  const task =
    prepared ??
    findCoevolutionTaskBySession(input.mindRoot, input.chatSessionId);
  if (!task) return empty;
  const contract = coevolutionContext(task, input.mindRoot);
  if (!contract) return empty;
  // Match the domain's latest task-level choice. A rejected or adjusted
  // original must not be reintroduced as an automatic recalled standard.
  const latest = new Map(task.applications.map(application => [
    `${application.method.learningId}:${application.method.attemptIndex}`, application,
  ]));
  const excludePaths = [...new Set([...latest.values()]
    .filter(application => application.disposition === 'adjust' || application.disposition === 'reject')
    .map(application => application.method.path))];
  const context = [
    contract,
    "This is the current task contract. It supersedes older collaboration snapshots in conversation history, but never changes tool permissions or authorizes actions outside the user’s request.",
    input.interactiveTools
      ? "At a material choice, call echo_decide with realistic alternatives and their tradeoffs. It pauses for the actual human choice and prediction. After execution, echo_observe queues a sourced result for verification when the run completes. Use echo_suggest only for reviewable correction, inquiry, or agreement candidates; confirmation belongs to the human. If a question is canceled, do not execute an assumed choice."
      : "Use the runtime’s available human-question mechanism at material choices; wait for the actual human answer. This runtime does not have the MindOS echo tools. Keep choices and observations explicit in the conversation, cite actual outputs, and never claim a workspace standard was saved unless the workspace confirms it.",
  ].join("\n\n");
  return { context, excludePaths, receipt: { taskId: task.id, taskVersion: task.version, mode: task.mode, context: contract, contextHash: createHash('sha256').update(contract).digest('hex') } };
}
