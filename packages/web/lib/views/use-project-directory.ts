"use client";
import { useCallback, useMemo } from "react";
import type { WorkProject } from "@geminilight/mindos/knowledge/views";
import {
  buildStudioProjectFromDraft,
  type StudioProject,
} from "@/lib/studio-projects";
import { pageRequest } from "./page-api";
import { useViewResource, useViewLiveUpdates } from "./hooks";

const emptyProjects: StudioProject[] = [];
export function useProjectDirectory(
  local: StudioProject[] = emptyProjects,
  enabled = true,
) {
  const read = useCallback(
    (signal: AbortSignal) =>
      pageRequest<{ rootId: string; projects: WorkProject[] }>(
        "project.list",
        {},
        signal,
      ),
    [],
  );
  const result = useViewResource(read, enabled);
  useViewLiveUpdates(result.refresh, result.loading, enabled, 5000);
  const projects = useMemo(() => {
    const merged = new Map(local.map((p) => [p.id, p]));
    for (const saved of result.data?.projects ?? []) {
      const existing =
        merged.get(saved.id) ??
        buildStudioProjectFromDraft(
          { title: saved.title, goal: saved.goal },
          [],
        );
      merged.set(saved.id, {
        ...existing,
        id: saved.id,
        title: saved.title,
        goal: saved.goal,
        titleZh: undefined,
        goalZh: undefined,
      });
    }
    return [...merged.values()];
  }, [local, result.data]);
  return { ...result, projects };
}
