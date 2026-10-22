"use client";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import { useViewsIndex, viewHref } from "@/lib/views/hooks";
import type { ViewSpec } from "@geminilight/mindos/knowledge/views";
import type { WorkViewData } from "@/lib/views/work-api";
import { Button } from "@/components/ui/button";
import { Columns3, List, Table2 } from "lucide-react";
import { fieldClass } from "./ViewPrimitives";
export default function WorkViewNavigation({
  data,
  layout,
  onLayout,
  locale,
}: {
  data: WorkViewData;
  layout: ViewSpec["layout"];
  onLayout: (layout: ViewSpec["layout"]) => void;
  locale: string;
}) {
  const zh = locale === "zh",
    people = data.collection.template === "people",
    index = useViewsIndex(),
    push = useSmoothRouterPush();
  const siblings =
    index.data?.rootId === data.rootId
      ? index.data.views.filter((v) => v.collectionId === data.collection.id)
      : [];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        role="group"
        aria-label={zh ? "页面布局" : "Page layout"}
        className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/40 p-1"
      >
        {(
          [
            "list-detail",
            "table",
            ...(!people ? ["board"] : []),
          ] as ViewSpec["layout"][]
        ).map((value) => {
          const Icon =
            value === "board" ? Columns3 : value === "table" ? Table2 : List;
          return (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={value === layout}
              className={
                value === layout
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground"
              }
              onClick={() => onLayout(value)}
            >
              <Icon size={14} aria-hidden />
              {value === "board"
                ? zh
                  ? "看板"
                  : "Board"
                : value === "table"
                  ? zh
                    ? "表格"
                    : "Table"
                  : people
                    ? zh
                      ? "人物详情"
                      : "People details"
                    : zh
                      ? "卡片"
                      : "Cards"}
            </Button>
          );
        })}
      </div>
      {siblings.length > 1 && (
        <select
          aria-label={zh ? "已保存的查看方式" : "Saved views"}
          className={fieldClass + " sm:w-auto sm:max-w-64"}
          value={data.view?.id ?? ""}
          onChange={(e) => {
            const view = siblings.find((v) => v.id === e.target.value);
            if (view) push(viewHref(view));
          }}
        >
          {siblings.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
