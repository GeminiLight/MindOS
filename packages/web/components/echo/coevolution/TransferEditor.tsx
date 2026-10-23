"use client";
import type { CoevolutionMethod } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import {
  DraftForm,
  Field,
  MethodFields,
  note,
  say,
  type EditorProps,
} from "./editor-shared";
export function TransferEditor({
  task,
  locale,
  busy,
  mutate,
  methods,
}: EditorProps & { methods: CoevolutionMethod[] }) {
  return (
    <div className="space-y-5">
      <p className={note}>
        {say(
          locale,
          "从已经确认的方法中选择。先想清楚这次有什么不同，再决定是否沿用。",
          "Choose from confirmed methods. Consider what differs in this task before reusing one.",
        )}
      </p>
      {!methods.length ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6">
          {say(
            locale,
            "还没有已启用的方法。先在「留下标准」中确认一条标准，就能带到新的任务。",
            "No active methods yet. Confirm a standard in “Keep a standard” to bring it into a new task.",
          )}
        </p>
      ) : null}
      {methods.map((method) => {
        const application = task.applications
          .filter(
            (a) =>
              a.method.learningId === method.learningId &&
              a.method.baseHash === method.baseHash,
          )
          .at(-1);
        return (
          <section
            key={method.baseHash}
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <h3 className="text-sm font-medium leading-6">{method.behavior}</h3>
            <p className={note}>{method.scope}</p>
            {application ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {application.disposition === "adopt"
                  ? say(locale, "已采用", "Adopted")
                  : application.disposition === "adjust"
                    ? say(locale, "已按本任务调整", "Adapted for this task")
                    : say(locale, "这次不使用", "Not used this time")}{" "}
                · {application.reason}
              </p>
            ) : null}
            {!application && <div className="flex flex-wrap gap-2">
              {(["adopt", "reject"] as const).map(disposition => <Button key={disposition} variant={disposition === "adopt" ? "outline" : "ghost"} disabled={busy} onClick={() => void mutate({ action: "apply-method", method: { learningId: method.learningId, attemptIndex: method.attemptIndex, revisionIndex: method.revisionIndex, baseHash: method.baseHash }, disposition, reason: disposition === "adopt" ? say(locale, "用户选择按原适用范围在本任务试用，效果待验证。", "User chose to try the original scope on this task; effect unverified.") : say(locale, "用户选择本任务不使用这条方法。", "User chose not to use this method on this task.") })}>{disposition === "adopt" ? say(locale, "按这个范围试用", "Try within this scope") : say(locale, "这次不用", "Skip this time")}</Button>)}
            </div>}
            <details>
              <summary className="cursor-pointer py-2 text-sm font-medium">
                {application
                  ? say(locale, "重新考虑", "Reconsider")
                  : say(locale, "调整范围或补充理由", "Adapt the scope or add a reason")}
              </summary>
              <DraftForm
                id={task.id + ":transfer:" + method.baseHash}
                busy={busy}
                locale={locale}
                initial={{
                  disposition: "adjust",
                  behavior: method.behavior,
                  scope: method.scope,
                  check: method.check,
                }}
                submitLabel={say(locale, "保存这次决定", "Save this decision")}
                onSubmit={(v) =>
                  mutate({
                    action: "apply-method",
                    method: {
                      learningId: method.learningId,
                      attemptIndex: method.attemptIndex,
                      revisionIndex: method.revisionIndex,
                      baseHash: method.baseHash,
                    },
                    disposition: v.disposition,
                    reason: v.reason,
                    ...(v.disposition === "adjust"
                      ? {
                          adjustment: {
                            behavior: v.behavior,
                            scope: v.scope,
                            check: v.check,
                          },
                        }
                      : {}),
                  })
                }
              >
                {(v, change) => (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {(["adopt", "adjust", "reject"] as const).map((d) => (
                        <Button
                          key={d}
                          type="button"
                          variant={v.disposition === d ? "secondary" : "ghost"}
                          aria-pressed={v.disposition === d}
                          onClick={() => change({ ...v, disposition: d })}
                        >
                          {d === "adopt"
                            ? say(locale, "沿用", "Adopt")
                            : d === "adjust"
                              ? say(locale, "调整后用", "Adapt")
                              : say(locale, "这次不用", "Skip")}
                        </Button>
                      ))}
                    </div>
                    <Field
                      name="reason"
                      label={say(
                        locale,
                        "这次有哪些相同或不同的条件",
                        "What is similar or different this time?",
                      )}
                      value={v}
                      change={change}
                    />
                    {v.disposition === "adjust" ? (
                      <>
                        <MethodFields
                          value={v}
                          change={change}
                          locale={locale}
                        />
                        <p className={note}>
                          {say(
                            locale,
                            "保存即确认本任务采用这份调整；原方法保持不变。",
                            "Saving confirms this adjustment for the current task. The original method stays unchanged.",
                          )}
                        </p>
                      </>
                    ) : null}
                  </>
                )}
              </DraftForm>
            </details>
          </section>
        );
      })}
      {task.applications.some(
        (a) => !methods.some((m) => m.baseHash === a.method.baseHash),
      ) ? (
        <details>
          <summary className="py-3 text-sm">
            {say(
              locale,
              "不再生效的历史决定",
              "Earlier decisions no longer active",
            )}
          </summary>
          {task.applications
            .filter(
              (a) => !methods.some((m) => m.baseHash === a.method.baseHash),
            )
            .map((a) => (
              <p key={a.id} className={note}>
                {a.method.behavior} · {a.reason}
              </p>
            ))}
        </details>
      ) : null}
    </div>
  );
}
