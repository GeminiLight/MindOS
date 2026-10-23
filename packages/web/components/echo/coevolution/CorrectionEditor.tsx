"use client";
import { useState } from "react";
import type { LearningLoop } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import {
  DraftForm,
  Field,
  MethodFields,
  control,
  note,
  say,
  type EditorProps,
  type Mutation,
} from "./editor-shared";

export function CorrectionEditor({
  task,
  locale,
  busy,
  mutate,
  loops,
  learningMutation,
  selectedRecordId,
  onSelectRecord,
}: EditorProps & {
  selectedRecordId?: string;
  onSelectRecord?: (id: string) => void;
  loops: LearningLoop[];
  learningMutation: (
    loop: LearningLoop,
    command: Record<string, unknown>,
  ) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("");
  const current =
    task.corrections.find((c) => c.id === (selectedRecordId ?? selected)) ??
    task.corrections.at(-1);
  return (
    <div className="space-y-5">
      {task.corrections.length > 1 ? (
        <label className="block space-y-2 text-sm">
          <span>{say(locale, "回看标准", "Review a standard")}</span>
          <select
            className={control}
            value={current?.id}
            onChange={(e) => {
              setSelected(e.target.value);
              onSelectRecord?.(e.target.value);
            }}
          >
            {task.corrections.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.behavior}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className={note}>
        {say(
          locale,
          "从一处真实修改开始，把你的判断变成有适用边界的方法。先保存草稿，核对后再确认。",
          "Start with an actual edit. Turn your judgment into a scoped method, then review it before confirming.",
        )}
      </p>
      {(current ? [current] : []).map((c) => {
        const loop = loops.find((l) => l.id === c.learningId);
        return (
          <section key={c.id} className="space-y-3 border-b border-border pb-5">
            <p className="text-xs text-muted-foreground">
              {c.actor.kind === "agent"
                ? say(
                    locale,
                    c.status === 'confirmed' ? "从记录提炼 · 已由你确认" : "Agent 提出的候选，请核对修改内容",
                    c.status === 'confirmed' ? "Extracted from the record · confirmed by you" : "Agent proposal: review the claimed edit",
                  )
                : say(locale, "你记录的修改", "Edit recorded by you")}
            </p>
            <div className="grid grid-cols-1 gap-2">
              <details className="rounded-lg bg-muted/30 p-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {say(locale, "原方案", "Original proposal")}
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {c.before}
                </p>
              </details>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {say(locale, "你的修改或要求", "Your edit or request")}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {c.after}
                </p>
              </div>
            </div>
            {!loop ? (
              <>
                <p className="text-sm font-medium leading-6">{c.behavior}</p>
                <p className={note}>{c.scope}</p>
                <p className={note}>
                  {say(locale, "检验：", "Check: ")}
                  {c.check}
                </p>
              </>
            ) : null}
            {c.status === "draft" ? (
              <details>
                <summary className="cursor-pointer py-2 text-sm">
                  {say(locale, "核对并修改草稿", "Review and edit draft")}
                </summary>
                <DraftForm
                  key={task.version}
                  id={task.id + ":" + c.id + ":edit"}
                  locale={locale}
                  busy={busy}
                  initial={{
                    before: c.before,
                    after: c.after,
                    behavior: c.behavior,
                    scope: c.scope,
                    check: c.check,
                  }}
                  submitLabel={say(
                    locale,
                    "保存草稿修改",
                    "Save draft changes",
                  )}
                  onSubmit={(v) =>
                    mutate({
                      action: "edit-correction",
                      correctionId: c.id,
                      before: v.before,
                      after: v.after,
                      behavior: v.behavior,
                      scope: v.scope,
                      check: v.check,
                    })
                  }
                >
                  {(v, change) => (
                    <>
                      <Field
                        name="before"
                        label={say(locale, "原来的内容", "Original content")}
                        value={v}
                        change={change}
                        max={4000}
                      />
                      <Field
                        name="after"
                        label={say(locale, "修改后的内容", "Edited content")}
                        value={v}
                        change={change}
                        max={4000}
                      />
                      <MethodFields value={v} change={change} locale={locale} />
                    </>
                  )}
                </DraftForm>
              </details>
            ) : null}
            {c.status === "draft" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {say(
                    locale,
                    "待你确认，尚未成为 Agent 的工作标准。",
                    "Awaiting your confirmation; not yet an Agent method.",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        action: "confirm-correction",
                        correctionId: c.id,
                      })
                    }
                  >
                    {say(locale, "确认这条标准", "Confirm this standard")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        action: "reject-correction",
                        correctionId: c.id,
                      })
                    }
                  >
                    {say(locale, "这次不保留", "Do not keep this")}
                  </Button>
                </div>
              </>
            ) : c.status === "rejected" ? (
              <p className={note}>
                {say(
                  locale,
                  "已拒绝，不会带入后续任务。",
                  "Rejected. It will not be used in later tasks.",
                )}
              </p>
            ) : loop ? (
              <MethodReview
                loop={loop}
                busy={busy}
                locale={locale}
                mutate={(command) => learningMutation(loop, command)}
              />
            ) : (
              <p className={note}>
                {say(
                  locale,
                  "标准已确认；重新载入可查看当前状态。",
                  "Standard confirmed. Reload to see its current status.",
                )}
              </p>
            )}
          </section>
        );
      })}
      <details>
        <summary className="cursor-pointer py-3 text-sm font-medium">
          {say(locale, "从我的修改提炼标准", "Learn a standard from my edit")}
        </summary>
        <DraftForm
          id={task.id + ":correction"}
          locale={locale}
          busy={busy}
          submitLabel={say(locale, "保存标准草稿", "Save standard draft")}
          onSubmit={(v) =>
            mutate({
              action: "draft-correction",
              before: v.before,
              after: v.after,
              behavior: v.behavior,
              scope: v.scope,
              check: v.check,
            })
          }
        >
          {(v, change) => (
            <>
              <Field
                name="before"
                label={say(locale, "原来的内容", "Original content")}
                value={v}
                change={change}
                max={4000}
              />
              <Field
                name="after"
                label={say(locale, "你修改后的内容", "Your edited content")}
                value={v}
                change={change}
                max={4000}
              />
              <MethodFields value={v} change={change} locale={locale} />
            </>
          )}
        </DraftForm>
      </details>
    </div>
  );
}
export function MethodReview({
  loop,
  locale,
  busy,
  mutate,
}: {
  loop: LearningLoop;
  locale: string;
  busy: boolean;
  mutate: Mutation;
}) {
  const method = loop.directMethod?.revisions?.at(-1) ?? loop.directMethod;
  const revisionIndex = loop.directMethod?.revisions?.length ?? 0;
  const versions = [loop.directMethod, ...(loop.directMethod?.revisions ?? [])];
  const olderActive = versions.findIndex(
    (version, index) =>
      index !== revisionIndex &&
      version?.review?.decision === "approved" &&
      version.availability === "active",
  );
  if (!method) return null;
  const base = { attemptIndex: -1, revisionIndex };
  const approved = method.review?.decision === "approved";
  const paused = method.availability === "deprecated";
  return (
    <div className="space-y-3">
      {method.review ? (
        <>
          <p className="text-sm font-medium leading-6">{method.behavior}</p>
          <p className={note}>{method.scope}</p>
          <p className={note}>
            {say(locale, "检验：", "Check: ")}
            {method.check}
          </p>
        </>
      ) : null}
      <p role="status" className="text-xs text-muted-foreground">
        {!method.review
          ? say(
              locale,
              "方法草稿 · 还需要确认启用",
              "Method draft · confirmation required",
            )
          : approved
            ? paused
              ? say(locale, "已暂停使用", "Use paused")
              : say(
                  locale,
                  "已启用 · 下次任务可采用",
                  "Active · available for future tasks",
                )
            : say(locale, "已拒绝", "Rejected")}
      </p>
      {olderActive >= 0 ? (
        <>
          <p className={note}>
            {say(
              locale,
              "上一版仍在使用，可随时暂停。",
              "The earlier version remains active. You can pause it here.",
            )}
          </p>
          <p className="text-sm leading-6">{versions[olderActive]?.behavior}</p>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void mutate({
                action: "pause-agent",
                attemptIndex: -1,
                revisionIndex: olderActive,
                reason: say(
                  locale,
                  "用户暂停上一版标准。",
                  "The user paused the earlier standard.",
                ),
              })
            }
          >
            {say(locale, "暂停上一版", "Pause earlier version")}
          </Button>
        </>
      ) : null}
      {!method.review ? (
        <>
          <p className={note}>{method.behavior}</p>
          <p className={note}>{method.scope}</p>
          <p className={note}>{method.check}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || olderActive >= 0}
              onClick={() => void mutate({ ...base, action: "approve-agent" })}
            >
              {say(locale, "确认并允许后续使用", "Confirm for future use")}
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => void mutate({ ...base, action: "reject-agent" })}
            >
              {say(locale, "拒绝", "Reject")}
            </Button>
          </div>
        </>
      ) : null}
      {approved ? (
        <details>
          <summary className="cursor-pointer py-2 text-sm">
            {say(locale, "调整或撤销", "Revise or withdraw")}
          </summary>
          <DraftForm
            key={loop.version}
            id={loop.id + ":lifecycle:" + revisionIndex}
            locale={locale}
            busy={busy}
            initial={{
              action: paused ? "resume-agent" : "pause-agent",
              behavior: method.behavior,
              scope: method.scope,
              check: method.check,
            }}
            submitLabel={say(locale, "保存调整", "Save change")}
            onSubmit={(v) =>
              mutate({
                ...base,
                action: v.action,
                reason: v.reason,
                ...(v.action === "revise-agent"
                  ? { behavior: v.behavior, scope: v.scope, check: v.check }
                  : {}),
              })
            }
          >
            {(v, change) => (
              <>
                <div className="flex flex-wrap gap-2">
                  {[
                    paused ? "resume-agent" : "pause-agent",
                    "revise-agent",
                  ].map((action) => (
                    <Button
                      key={action}
                      type="button"
                      variant={v.action === action ? "secondary" : "ghost"}
                      aria-pressed={v.action === action}
                      onClick={() => change({ ...v, action })}
                    >
                      {action === "resume-agent"
                        ? say(locale, "恢复", "Resume")
                        : action === "pause-agent"
                          ? say(locale, "暂停使用", "Pause use")
                          : say(locale, "修订标准", "Revise standard")}
                    </Button>
                  ))}
                </div>
                <Field
                  name="reason"
                  label={say(locale, "为什么调整", "Reason for the change")}
                  value={v}
                  change={change}
                />
                {v.action === "revise-agent" ? (
                  <>
                    <MethodFields value={v} change={change} locale={locale} />
                    <p className={note}>
                      {say(
                        locale,
                        "修订会保留为新草稿，确认后才启用。",
                        "The revision stays a draft until confirmed.",
                      )}
                    </p>
                  </>
                ) : null}
              </>
            )}
          </DraftForm>
        </details>
      ) : null}
    </div>
  );
}
