"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  FolderOpen,
  Eye,
  Search,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select } from "@/components/settings/Primitives";
import { Button } from "@/components/ui/button";
import { openAskModal } from "@/hooks/useAskModal";
import { ViewsApiError } from "@/lib/views/api";
import { contextError } from "@/lib/context-work/api";
import type { ContextPosition } from "@/lib/context-work/continuity";
import { readViewDraft, writeViewDraft } from "@/lib/views/drafts";
import { useViewOperationScope } from "@/lib/views/hooks";
import {
  Field,
  fieldClass,
  useDialogReturnFocus,
} from "../views/ViewPrimitives";

export type HandoffItem = {
  id: string;
  label: string;
  path: string;
  hint?: string;
};
export type HandoffProps = {
  rootId: string;
  scopeId: string;
  title: string;
  folder: string;
  locale: string;
  items: HandoffItem[];
  defaults: string[];
  initialGoal?: string;
  legacyScopeId?: string;
  presentation?: "dialog" | "inline";
  position?: Omit<ContextPosition, "updatedAt">;
  activeItemId?: string;
  inspect?: (path: string) => void;
  privacyHint?: string;
  prepare: (
    selected: string[],
    goal: string,
    target: string,
    signal: AbortSignal,
  ) => Promise<string>;
  reload?: () => void | Promise<void>;
  close: () => void;
};
export default function ContextHandoff(props: HandoffProps) {
  const {
    rootId,
    scopeId,
    title,
    folder,
    locale,
    items,
    defaults,
    prepare,
    reload,
    close,
  } = props;
  const zh = locale === "zh";
  const inline = props.presentation === "inline";
  const surface = useRef<HTMLElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!inline) return;
    const element = surface.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      // Keep the action visible below the project's heading, including after
      // wrapping, scrolling or opening the mobile keyboard.
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      setAvailableHeight(Math.max(320, Math.min(760, viewportHeight - Math.max(16, rect.top) - 16)));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(element.closest("#context-workspace") ?? element);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [inline]);
  const Header = inline ? "header" : DialogHeader;
  const Title = inline ? "h2" : DialogTitle;
  const Description = inline ? "p" : DialogDescription;
  const scope = useViewOperationScope(rootId);
  const returnFocus = useDialogReturnFocus();
  const [draftScope] = useState({
    rootId,
    viewId: scopeId,
    personId: folder,
    kind: "handoff",
  });
  const [draft] = useState(() => readViewDraft(draftScope) ?? (props.legacyScopeId
    ? readViewDraft({ ...draftScope, viewId: props.legacyScopeId }) : null));
  const [goal, setGoal] = useState(
    String(draft?.values.goal ?? props.initialGoal ?? ""),
  );
  const [target, setTarget] = useState(() =>
    ["MindOS", "Codex", "Claude Code", "Other"].includes(
      String(draft?.values.target),
    )
      ? String(draft!.values.target)
      : "MindOS",
  );
  const [selected, setSelected] = useState(() =>
    draft
      ? items
          .filter((i) => draft.values["item:" + i.id] === true)
          .map((i) => i.id)
      : defaults.filter((id) => items.some((item) => item.id === id)),
  );
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [persisted, setPersisted] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const included = selected.filter((id) => items.some((i) => i.id === id));
  const activeItem = items.find((item) => item.id === props.activeItemId);
  const visibleItems = items.filter(
    (item) =>
      (!onlySelected || included.includes(item.id)) &&
      `${item.label} ${item.path}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const selectionHint = !goal.trim()
    ? zh
      ? "先写下希望 Agent 帮你做什么。"
      : "Describe what you want the Agent to do first."
    : !included.length
      ? zh
        ? "至少选择 1 份资料，再继续。"
        : "Select at least one item to continue."
      : included.length >= 12
        ? zh
          ? "已选 12 份资料；取消一份后可换选。"
          : "12 items selected. Remove one to choose another."
        : zh
          ? `已选 ${included.length} 份资料`
          : `${included.length} item${included.length === 1 ? "" : "s"} selected`;
  useEffect(() => {
    const values: Record<string, string | boolean> = { goal, target };
    selected.forEach((id) => {
      values["item:" + id] = true;
    });
    setPersisted(
      writeViewDraft(draftScope, {
        revision: "",
        operationId: "",
        values,
        updatedAt: Date.now(),
      }),
    );
    setPreview("");
    setCopied(false);
    setError("");
  }, [draftScope, goal, target, selected]);
  useEffect(() => () => controller.current?.abort(), []);
  const valid =
    !!goal.trim() &&
    included.length > 0 &&
    included.length <= 12 &&
    !busy &&
    !scope.changed;
  async function run(action: "preview" | "continue") {
    if (!valid || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const text = await prepare(included, goal.trim(), target, request.signal);
      if (!scope.isCurrent() || request.signal.aborted) return;
      setPreview(text);
      if (action === "continue") {
        if (target === "MindOS") {
          openAskModal(text, "user", null, {
            newSession: true,
            ...(props.position ? { handoffOrigin: {
              rootId, title, folder, position: props.position,
              items: items.filter(item => included.includes(item.id)).map(({ id, label, path }) => ({ id, label, path })),
            } } : {}),
          });
          close();
        } else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              navigator.clipboard.writeText(text),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(Error("COPY_FAILED")), 5000);
              }),
            ]);
            if (scope.isCurrent()) setCopied(true);
          } catch {
            if (scope.isCurrent()) setError("COPY_FAILED");
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      }
    } catch (e) {
      if (scope.isCurrent() && !request.signal.aborted)
        setError(e instanceof ViewsApiError ? e.code : "NETWORK_ERROR");
    } finally {
      controller.current = null;
      if (scope.isMounted()) setBusy(false);
    }
  }
  const content = <>
        <Header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <Title className="text-base font-semibold">
              {zh ? "交给 Agent" : "Hand off to an Agent"}
            </Title>
            <Button
              variant="ghost"
              size="icon"
              aria-label={zh ? "关闭" : "Close"}
              onClick={close}
            >
              <X size={18} />
            </Button>
          </div>
          <Description className="mt-2 text-xs leading-5 text-muted-foreground">
            {zh
              ? "说清下一步，带上刚刚在看的资料。"
              : "Describe the next step and bring the material you were reading."}
          </Description>
        </Header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!inline && <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
            <FolderOpen
              className="mt-0.5 shrink-0 text-muted-foreground"
              size={17}
            />
            <div className="min-w-0">
              <p className="font-medium">{title}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {folder}
              </p>
            </div>
          </div>}
          <Field
            label={
              zh ? "希望 Agent 帮你做什么" : "What should the Agent help with?"
            }
          >
            {(id) => (
              <textarea
                id={id}
                className={`${fieldClass} min-h-24 resize-y leading-6`}
                value={goal}
                maxLength={2000}
                disabled={busy || scope.changed}
                placeholder={
                  zh
                    ? "例如：根据这份简报，找出还需要确认的问题。"
                    : "For example: identify the questions this brief leaves open."
                }
                onChange={(e) => setGoal(e.target.value)}
              />
            )}
          </Field>
          <Field label={zh ? "交给谁" : "Continue with"}>
            {(id) => (
              <Select
                id={id}
                aria-label={zh ? "交给谁" : "Continue with"}
                className="w-full"
                value={target}
                disabled={busy || scope.changed}
                onChange={(e) => setTarget(e.target.value)}
              >
                {["MindOS", "Codex", "Claude Code", "Other"].map((t) => (
                  <option key={t} value={t}>
                    {t === "Other" ? (zh ? "其他 Agent" : "Another Agent") : t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <fieldset disabled={busy || scope.changed}>
            <legend className="mb-3 text-sm font-medium">
              {zh ? "带上的资料" : "Included material"}
              <span className="ml-2 font-normal text-muted-foreground">
                {included.length} / {items.length}
              </span>
            </legend>
            {activeItem && !included.includes(activeItem.id) && (
              <div className="mb-3 rounded-md bg-muted/40 p-3 text-xs">
                <p className="break-words text-muted-foreground">{zh ? "正在阅读：" : "Reading: "}{activeItem.label}</p>
                <Button variant="ghost" size="sm" className="mt-1" disabled={included.length >= 12}
                  onClick={() => setSelected(prev => prev.includes(activeItem.id) || prev.length >= 12 ? prev : [...prev, activeItem.id])}>
                  {zh ? "带上当前文件" : "Include current file"}
                </Button>
              </div>
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {items.length > 4 && (
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input px-3">
                  <Search
                    size={14}
                    aria-hidden
                    className="shrink-0 text-muted-foreground"
                  />
                  <input
                    aria-label={zh ? "查找交接资料" : "Find handoff material"}
                    placeholder={zh ? "查找资料" : "Find material"}
                    className="min-h-9 w-full min-w-0 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={zh ? "清除资料搜索" : "Clear material search"}
                      onClick={() => setQuery("")}
                    >
                      <X size={13} />
                    </Button>
                  )}
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={onlySelected}
                onClick={() => {
                  setOnlySelected(!onlySelected);
                  setQuery("");
                }}
              >
                {onlySelected
                  ? zh
                    ? "查看全部"
                    : "Show all"
                  : zh
                    ? "只看已选"
                    : "Selected only"}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-14 items-start gap-1 px-3 py-3 hover:bg-muted/40"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={item.label}
                    className="mt-1 size-4 shrink-0 accent-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring"
                    checked={included.includes(item.id)}
                    disabled={
                      !included.includes(item.id) && included.length >= 12
                    }
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? prev.length < 12
                            ? [...prev, item.id]
                            : prev
                          : prev.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <FileText
                    size={15}
                    className="mt-1 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="line-clamp-2 break-words text-sm">
                      {item.label}
                    </span>
                    <span
                      title={item.path}
                      className="mt-1 line-clamp-1 break-all text-xs text-muted-foreground"
                    >
                      {item.hint || item.path}
                    </span>
                  </span>
                  </label>
                  {props.inspect && (
                    <Button variant="ghost" size="icon-sm" aria-label={`${zh ? "查看" : "Read"} ${item.label}`}
                      onClick={() => props.inspect?.(item.path)}><Eye size={14} /></Button>
                  )}
                </div>
              ))}
              {!visibleItems.length && (
                <p
                  role="status"
                  className="px-3 py-5 text-sm text-muted-foreground"
                >
                  {zh ? "没有符合条件的资料。" : "No matching material."}
                </p>
              )}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {props.privacyHint ||
                (zh
                  ? "只携带勾选的文件内容，其他资料不会自动加入。"
                  : "Only checked files are included. Other material stays out.")}
            </p>
            {(!included.length || included.length > 12) && (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {zh ? "请选择 1–12 份资料。" : "Choose 1–12 items."}
              </p>
            )}
          </fieldset>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!valid}
              onClick={() => void run("preview")}
            >
              {zh ? "查看完整内容" : "Preview complete handoff"}
            </Button>
            {preview && (
              <textarea
                aria-label={zh ? "完整交接内容" : "Complete handoff"}
                readOnly
                value={preview}
                className={`${fieldClass} mt-3 min-h-64 font-mono text-xs leading-6`}
              />
            )}
            {preview && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([preview], {
                      type: "text/markdown;charset=utf-8",
                    }),
                  );
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "context-handoff.md";
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {zh ? "另存为 Markdown" : "Save as Markdown"}
              </Button>
            )}
          </div>
          {!persisted && (
            <p role="status" className="text-xs text-muted-foreground">
              {zh
                ? "浏览器暂时无法保存草稿，关闭页面前请复制你的目标。"
                : "This browser cannot save the draft. Copy your goal before leaving."}
            </p>
          )}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-border bg-background px-6 py-4">
          {(error || scope.changed) && (
            <div
              role="alert"
              className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6"
            >
              <p>
                {error === "COPY_FAILED"
                  ? zh
                    ? "复制未成功。完整内容已展开，可以选中后手动复制。"
                    : "Copy failed. Select the complete text above and copy it manually."
                  : contextError(scope.changed ? "ROOT_CHANGED" : error, zh)}
              </p>
              {error === "REVISION_CONFLICT" && reload && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await reload();
                      setError("");
                      setPreview("");
                    } catch {
                      setError("NETWORK_ERROR");
                    }
                  }}
                >
                  {zh ? "重新读取资料" : "Reload material"}
                </Button>
              )}
            </div>
          )}
          <p role="status" className="text-xs leading-5 text-muted-foreground">
            {selectionHint}
          </p>
          {inline && included.length > 0 && <p
            title={items.filter(item => included.includes(item.id)).map(item => item.path).join("\n")}
            className="line-clamp-2 break-words text-xs leading-5 text-foreground">
            {items.filter(item => included.includes(item.id)).map(item => item.label).join(" · ")}
          </p>}
          {copied && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-success"
            >
              <Check size={16} />
              {zh
                ? "已复制。粘贴到 Agent 后即可继续。"
                : "Copied. Paste it into your Agent to continue."}
            </p>
          )}
          <Button
            variant="amber"
            size="lg"
            className="min-h-11 w-full"
            disabled={!valid}
            onClick={() => void run("continue")}
          >
            {target === "MindOS" ? (
              <ArrowUpRight size={16} />
            ) : (
              <Copy size={16} />
            )}
            {busy
              ? zh
                ? "正在核对资料…"
                : "Checking material…"
              : target === "MindOS"
                ? zh
                  ? "在 MindOS 中继续"
                  : "Continue in MindOS"
                : zh
                  ? `复制给 ${target === "Other" ? "Agent" : target}`
                  : `Copy for ${target === "Other" ? "Agent" : target}`}
          </Button>
          <p className="text-center text-xs leading-5 text-muted-foreground">
            {target === "MindOS"
              ? zh
                ? "带入新对话草稿，确认后再发送。"
                : "Opens a new conversation draft for you to review and send."
              : zh
                ? "复制到剪贴板后，由你粘贴到对应 Agent。"
                : "Copy to the clipboard, then paste into your chosen Agent."}
          </p>
        </footer>
  </>;
  if (inline) return <section ref={surface} aria-label={zh ? "交给 Agent" : "Hand off to an Agent"}
    style={{ maxHeight: availableHeight }}
    className="flex max-h-[80dvh] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
    {content}
  </section>;
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent finalFocus={returnFocus} showCloseButton={false}
      className="top-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-xl">
      {content}
    </DialogContent>
  </Dialog>;
}
