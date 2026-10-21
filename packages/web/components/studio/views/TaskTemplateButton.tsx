"use client";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { workRequest } from "@/lib/views/work-api";
import { Field, fieldClass, useDialogReturnFocus } from "./ViewPrimitives";
export default function TaskTemplateButton({
  rootId,
  locale,
}: {
  rootId: string;
  locale: string;
}) {
  const zh = locale === "zh",
    push = useSmoothRouterPush(),
    returnFocus = useDialogReturnFocus();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [folder, setFolder] = useState(""),
    [mode, setMode] = useState("new"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [scope, setScope] = useState(rootId),
    [operationId, setOperationId] = useState("");
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setScope(rootId);
          setOperationId(crypto.randomUUID());
          setError("");
          setOpen(true);
        }}
      >
        {zh ? "项目待办模板" : "Project tasks template"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent finalFocus={returnFocus}>
          <DialogHeader>
            <DialogTitle>
              {zh ? "创建项目待办视图" : "Create project tasks view"}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "每个项目一份本地待办文件，人与 Agent 共同维护。"
                : "One local task file per project, shared by you and your Agents."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || scope !== rootId) return;
              setBusy(true);
              setError("");
              try {
                const result = await workRequest<any>("create", {
                  name,
                  folder,
                  mode,
                  template: "tasks",
                  operationId,
                  expectedRootId: scope,
                });
                push(result.viewUrl);
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={zh ? "视图名称" : "View name"}>
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={80}
                  className={fieldClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label={zh ? "项目资料位置" : "Project folder"}>
              {(id) => (
                <input
                  id={id}
                  required
                  className={fieldClass}
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                />
              )}
            </Field>
            <select
              className={fieldClass}
              aria-label={zh ? "资料来源" : "Data source"}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="new">
                {zh ? "新建空项目目录" : "New empty project folder"}
              </option>
              <option value="existing">
                {zh
                  ? "关联已有兼容待办文件"
                  : "Bind an existing compatible task file"}
              </option>
            </select>
            {scope !== rootId && (
              <p role="alert">
                {zh
                  ? "资料库已切换，请重新打开。"
                  : "Library changed; reopen this form."}
              </p>
            )}
            {error && (
              <p role="alert" className="text-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="amber"
              disabled={busy || scope !== rootId}
            >
              {zh ? "创建视图" : "Create view"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
