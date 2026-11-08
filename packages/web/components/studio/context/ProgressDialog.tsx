"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { contextError, saveContextProgress } from "@/lib/context-work/api";
import { ViewsApiError } from "@/lib/views/api";
import {
  readViewDraft,
  writeViewDraft,
  clearViewDraft,
} from "@/lib/views/drafts";
import { useViewOperationScope } from "@/lib/views/hooks";
import {
  Field,
  fieldClass,
  useDialogReturnFocus,
} from "../views/ViewPrimitives";
export default function ProgressDialog({
  rootId,
  scopeId,
  folder,
  locale,
  close,
  saved,
}: {
  rootId: string;
  scopeId: string;
  folder: string;
  locale: string;
  close: () => void;
  saved: (path: string) => void;
}) {
  const zh = locale === "zh";
  const scope = useViewOperationScope(rootId);
  const returnFocus = useDialogReturnFocus();
  const [draftScope] = useState({
    rootId,
    viewId: scopeId,
    personId: folder,
    kind: "progress",
  });
  const [draft] = useState(() => readViewDraft(draftScope));
  const [text, setText] = useState(String(draft?.values.text ?? ""));
  const [source, setSource] = useState(
    String(draft?.values.source ?? (zh ? "我的记录" : "My note")),
  );
  const [operationId, setOperationId] = useState(
    draft?.operationId || crypto.randomUUID(),
  );
  const [persisted, setPersisted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const attempted = useRef(false);
  useEffect(() => {
    setPersisted(
      writeViewDraft(draftScope, {
        revision: "",
        operationId,
        values: { text, source },
        updatedAt: Date.now(),
      }),
    );
  }, [draftScope, text, source, operationId]);
  function changed() {
    if (attempted.current) {
      setOperationId(crypto.randomUUID());
      attempted.current = false;
    }
    setError("");
  }
  async function save() {
    if (locked.current || scope.changed || !text.trim() || !source.trim())
      return;
    locked.current = true;
    attempted.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await saveContextProgress(scope.rootId, folder, {
        operationId,
        text: text.trim(),
        source: source.trim(),
      });
      if (scope.isCurrent()) {
        clearViewDraft(draftScope);
        saved(result.path);
      }
    } catch (e) {
      if (scope.isMounted())
        setError(e instanceof ViewsApiError ? e.code : "WRITE_FAILED");
    } finally {
      locked.current = false;
      if (scope.isMounted()) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={returnFocus}
        className="max-h-[90dvh] overflow-y-auto p-6 sm:max-w-xl"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg">
              {zh ? "记下进展" : "Record progress"}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={zh ? "关闭" : "Close"}
              onClick={close}
            >
              <X size={18} />
            </Button>
          </div>
          <DialogDescription>
            {zh
              ? "留下这次的判断和下一步，回来时就能接着做。"
              : "Leave your decision and next step here for when you return."}
          </DialogDescription>
        </DialogHeader>
        <Field label={zh ? "这次推进到了哪里" : "Where did you get to?"}>
          {(id) => (
            <textarea
              id={id}
              autoFocus
              className={`${fieldClass} min-h-44 resize-y leading-7`}
              placeholder={
                zh
                  ? "确定了什么？还有什么待确认？下一步准备做什么？"
                  : "What did you decide? What is still open? What comes next?"
              }
              value={text}
              maxLength={4000}
              disabled={busy || scope.changed}
              onChange={(e) => {
                changed();
                setText(e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={zh ? "来源" : "Source"}
          hint={
            zh
              ? "整理了 Agent 的结果，也可以在这里注明。"
              : "You can name an Agent whose result you reviewed."
          }
        >
          {(id) => (
            <input
              id={id}
              className={fieldClass}
              value={source}
              maxLength={80}
              disabled={busy || scope.changed}
              onChange={(e) => {
                changed();
                setSource(e.target.value);
              }}
            />
          )}
        </Field>
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <FileText size={14} className="mt-0.5 shrink-0" />
          <span className="break-all">
            {zh ? "保存为 Markdown 文件：" : "Save as Markdown in: "}
            {folder}/进展/
          </span>
        </p>
        {(error || scope.changed) && (
          <p role="alert" className="text-sm leading-6 text-error">
            {contextError(scope.changed ? "ROOT_CHANGED" : error, zh)}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {persisted
              ? zh
                ? "未保存的输入会保留在本机。"
                : "Unfinished input is kept in this browser."
              : zh
                ? "草稿暂时无法保留，请先复制输入。"
                : "Draft storage is unavailable. Copy your input first."}
          </p>
          <Button
            variant="amber"
            disabled={busy || scope.changed || !text.trim() || !source.trim()}
            onClick={() => void save()}
          >
            {busy
              ? zh
                ? "正在保存…"
                : "Saving…"
              : zh
                ? "保存进展"
                : "Save progress"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
