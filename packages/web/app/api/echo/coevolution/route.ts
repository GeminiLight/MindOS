import { sessionExcerpts } from '@/lib/coevolution-source';
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createCoevolutionTask,
  getCoevolutionTask,
  listCoevolutionTasks,
  updateCoevolutionTask,
  prepareCoevolutionTaskRun,
  createCoevolutionInquiry,
  coevolutionMethods,
  coevolutionRuns,
  createCoevolutionTaskSchema,
  getInquiry,
  getLearningLoop,
  listInquiries,
  LearningError,
  coevolutionCommandSchema,
  type CoevolutionTask,
} from "@geminilight/mindos/knowledge";
import { listBranchStories } from "@geminilight/mindos/knowledge/branch-replay/store";
import {
  resolveCoevolutionDecisionBridge,
  type CoevolutionDecisionDelivery,
} from "@geminilight/mindos/agent/tool";
import { getMindRoot, invalidateCache } from "@/lib/fs";
import { body, json, ownerBoundary } from "@/lib/research-http";
import {
  completedSourceSelection,
  readCompletedReply,
  sourceHash,
} from "@/lib/echo-completed-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const create = createCoevolutionTaskSchema
  .omit({ source: true })
  .extend({
    source: completedSourceSelection.strict().optional(),
    storyId: z
      .string()
      .regex(/^replay-[\w-]{1,180}$/)
      .optional(),
  })
  .strict()
  .refine((input) => !(input.source && input.storyId));
function failure(error: unknown) {
  const code = error instanceof LearningError ? error.code : "storage";
  return json(
    {
      code,
      error:
        error instanceof LearningError
          ? error.message
          : "The local collaboration record is unavailable. Please retry.",
    },
    { invalid: 400, conflict: 409, "not-found": 404, storage: 500 }[code],
  );
}
function view(task: CoevolutionTask) {
  const root = getMindRoot();
  const ids = [
    ...new Set(
      [
        ...task.corrections.map((item) => item.learningId),
        ...task.agreements.map((item) => item.learningId),
      ].filter((id): id is string => !!id),
    ),
  ];
  const learningLoops = ids
    .map((id) => getLearningLoop(root, id))
    .filter((loop): loop is NonNullable<typeof loop> => !!loop);
  return {
    task,
    methods: coevolutionMethods(root, `${task.title} ${task.goal}`),
    runs: coevolutionRuns(root, task),
    learningLoops,
    ...(task.inquiryId ? { inquiry: getInquiry(root, task.inquiryId) } : {}),
  };
}
export async function GET(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    if ([...req.nextUrl.searchParams.keys()].some((key) => key !== "id"))
      throw new LearningError("invalid", "Choose a task.");
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const task = getCoevolutionTask(getMindRoot(), id);
      if (!task)
        throw new LearningError("not-found", "Collaboration task not found.");
      return json(view(task));
    }
    const listed = listCoevolutionTasks(getMindRoot());
    return json({
      ...listed,
      tasks: listed.tasks.filter((task) => !task.archived),
      methods: coevolutionMethods(getMindRoot()),
      inquiries: listInquiries(getMindRoot()).inquiries,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const parsed = create.safeParse(await body(req));
    if (!parsed.success)
      throw new LearningError(
        "invalid",
        "Give this task a title and goal; choose one verified source or start your own task.",
      );
    const { source: selection, storyId, ...input } = parsed.data;
    let source: CoevolutionTask["source"];
    if (storyId) {
      const story = listBranchStories().find((item) => item.id === storyId);
      if (!story || !["claude", "codex"].includes(story.source.runtime))
        throw new LearningError(
          "not-found",
          "This real session replay is unavailable.",
        );
      const preferred = story.scenes?.[0]?.choices[0]?.proposal.messageId;
      const messageIndex = preferred
        ? story.source.messages.findIndex(
            (message) =>
              message.id === preferred && message.role === "assistant",
          )
        : story.source.messages.findIndex(
            (message) => message.role === "assistant",
          );
      const index =
        messageIndex < 0
          ? story.source.messages.findIndex(
              (message) => message.role === "assistant",
            )
          : messageIndex;
      const message = story.source.messages[index];
      if (!message?.text.trim())
        throw new LearningError(
          "invalid",
          "This replay has no attributable Agent reply.",
        );
      const question = story.source.messages
        .slice(0, index)
        .reverse()
        .find((message) => message.role === "user")
        ?.text.trim();
      source = {
        kind: "replay",
        storyId: story.id,
        runtime: story.source.runtime,
        sessionId: story.source.id,
        messageIndex: index,
        messageHash: sourceHash(message.text),
        title: story.source.title.slice(0, 300),
        quote: message.text.trim().slice(0, 4000),
        excerpts: sessionExcerpts(story.source.messages),
        ...(question ? { question: question.slice(0, 4000) } : {}),
      };
    } else if (selection) {
      const completed = readCompletedReply(selection);
      source = {
        kind: "session",
        ...selection,
        title: (typeof completed.session.title === "string"
          ? completed.session.title
          : input.title
        ).slice(0, 300),
        quote: completed.text.trim().slice(0, 4000),
        ...(completed.question
          ? { question: completed.question.slice(0, 4000) }
          : {}),
      };
    }
    return json(
      view(
        createCoevolutionTask(getMindRoot(), {
          ...input,
          ...(source ? { source } : {}),
        }),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(req: NextRequest) {
  let action: unknown;
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const { id, ...command } = await body(req);
    action = command.action;
    if (typeof id !== "string")
      throw new LearningError("invalid", "Choose a saved collaboration task.");
    if (action === "prepare") {
      const input = { ...command };
      delete input.action;
      const prepared = prepareCoevolutionTaskRun(getMindRoot(), id, input);
      return json({ ...view(prepared.task), draft: prepared.draft });
    }
    if (action === "create-inquiry") {
      const input = { ...command };
      delete input.action;
      const created = createCoevolutionInquiry(getMindRoot(), id, input);
      return json({ ...view(created.task), inquiry: created.inquiry });
    }
    let task: CoevolutionTask;
    try {
      task = updateCoevolutionTask(getMindRoot(), id, command);
    } catch (error) {
      const parsed = coevolutionCommandSchema.safeParse(command);
      if (
        !(error instanceof LearningError) ||
        error.code !== "conflict" ||
        !parsed.success ||
        parsed.data.action !== "choose-decision"
      )
        throw error;
      const c = parsed.data;
      const current = getCoevolutionTask(getMindRoot(), id);
      const choice = current?.decisions.find(
        (d) => d.id === c.decisionId,
      )?.choice;
      // The Ask surface may win the same human submission. Accept that exact
      // saved choice, but never rewrite it or reuse a request id with new input.
      if (
        !current ||
        current.archived ||
        current.commands.some((item) => item.requestId === c.requestId) ||
        !choice ||
        choice.optionId !== c.optionId ||
        choice.prediction !== c.prediction ||
        choice.confidence !== c.confidence ||
        choice.reason !== c.reason
      )
        throw error;
      task = current;
    }
    if (
      action === "choose-decision" &&
      typeof command.decisionId === "string"
    ) {
      let decisionDelivery: CoevolutionDecisionDelivery;
      try {
        decisionDelivery = resolveCoevolutionDecisionBridge(
          task,
          command.decisionId,
        );
      } catch {
        decisionDelivery = {
          status: "unavailable",
          message:
            "Your choice is saved, but it could not reach the waiting Agent. Retry delivery or continue in the conversation.",
        };
      }
      return json({ ...view(task), decisionDelivery });
    }
    return json(view(task));
  } catch (error) {
    return failure(error);
  } finally {
    if (action === "confirm-correction" || action === "resolve-agreement") {
      invalidateCache();
      try {
        revalidatePath("/", "layout");
      } catch {
        /* Tests and non-rendering hosts have no Next cache context. */
      }
    }
  }
}
