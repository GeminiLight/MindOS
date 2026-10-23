"use client";
import { Button } from "@/components/ui/button";
import { note, say, type EditorProps } from "./editor-shared";
export function HandoffEditor({
  task,
  locale,
  busy,
  mutate,
  start,
}: EditorProps & { start: () => void }) {
  const modes = [
    {
      id: "guide",
      zh: "带我做",
      en: "Show me",
      zhHint: "Agent 示范关键步骤，把取舍和依据说清楚。",
      enHint: "The Agent demonstrates key steps and explains the tradeoffs.",
    },
    {
      id: "together",
      zh: "一起做",
      en: "Work together",
      zhHint: "Agent 处理执行，在关键判断处邀请你参与。",
      enHint: "The Agent handles execution and invites you into key decisions.",
    },
    {
      id: "try",
      zh: "让我试",
      en: "Let me try",
      zhHint: "你先给出判断或方案，Agent 提示、检查，等你需要时接手。",
      enHint:
        "You propose a judgment or solution. The Agent gives hints and checks, taking over when you ask.",
    },
  ];
  return (
    <div className="space-y-5">
      <p className={note}>
        {say(
          locale,
          "根据你现在想练什么决定谁来做。随时可以换，下一轮任务会使用新的方式。",
          "Choose who takes the lead for what you want to practice. You can switch at any time; it applies to the next turn.",
        )}
      </p>
      <div className="space-y-2">
        {modes.map((m) => (
          <button
            key={m.id}
            disabled={busy}
            type="button"
            aria-pressed={task.mode === m.id}
            onClick={() => void mutate({ action: "set-mode", mode: m.id })}
            className={
              "w-full rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (task.mode === m.id
                ? "border-[var(--amber)] bg-muted/40"
                : "border-border hover:bg-muted/20")
            }
          >
            <span className="text-sm font-medium">
              {locale === "zh" ? m.zh : m.en}
            </span>
            <span className="mt-2 block text-xs leading-6 text-muted-foreground">
              {locale === "zh" ? m.zhHint : m.enHint}
            </span>
          </button>
        ))}
      </div>
      <Button disabled={busy} className="min-h-11" onClick={start}>
        {say(locale, "按这个方式开始任务", "Start with this approach")}
      </Button>
      <details>
        <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
          {say(locale, "接棒记录", "Handoff history")} ·{" "}
          {task.modeHistory.length}
        </summary>
        <ol className="space-y-2 border-l border-border pl-4">
          {task.modeHistory.map((h, i) => (
            <li key={i} className={note}>
              {locale === "zh"
                ? modes.find((m) => m.id === h.mode)?.zh
                : modes.find((m) => m.id === h.mode)?.en}
              <span className="ml-2 text-xs">
                {new Date(h.recordedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
