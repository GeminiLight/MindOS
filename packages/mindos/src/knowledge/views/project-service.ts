import { createHash } from "node:crypto";
import { WorkViewsService, inputObject } from "./service.js";
import { WorkPagesService } from "./page-service.js";
import { readPages } from "./page-store.js";
import {
  documentRevision,
  parsePerson,
  validateOperationId,
} from "./markdown.js";
import { readDocument } from "./paths.js";
import { withFileMutation } from "./file-lock.js";
import { ViewError, type PersonInteraction } from "./types.js";
import {
  assertProjectPath,
  findProject,
  projectDefinition,
  PROJECTS_PATH,
  readProjects,
  writeProjects,
  type WorkProject,
} from "./project-store.js";
import type { PageSpec } from "./page-spec.js";

export type ProjectSnapshot = {
  rootId: string;
  project: WorkProject;
  pageId: string;
  incomplete: boolean;
  people: Array<{
    ref: string;
    name: string;
    path: string;
    revision: string;
    schemaRevision: string;
    href?: string;
  }>;
  activity: Array<
    PersonInteraction & { personRef: string; personName: string; path: string }
  >;
};
// A derived operation identity gives each project one page, including concurrent retries.
export function projectPageOperation(id: string) {
  const h = createHash("sha256")
    .update("mindos-project-page-v1:" + id)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export class WorkProjectsService {
  readonly work: WorkViewsService;
  readonly rootId: string;
  constructor(
    readonly root: string,
    work?: WorkViewsService,
    readonly signal?: AbortSignal,
  ) {
    this.work =
      work ??
      new WorkViewsService(root, async () => {
        throw new ViewError(
          "READ_ONLY",
          "Use the authenticated project writer",
          403,
        );
      });
    this.rootId = this.work.rootId;
  }
  private check(input: Record<string, unknown>) {
    if (input.expectedRootId !== this.rootId)
      throw new ViewError(
        "ROOT_CHANGED",
        "The library changed. Reopen this project.",
        409,
      );
    if (this.signal?.aborted)
      throw new ViewError(
        "REQUEST_CANCELLED",
        "Project change was cancelled",
        499,
      );
  }
  list() {
    return { rootId: this.rootId, projects: readProjects(this.root).projects };
  }
  read(id: unknown): ProjectSnapshot {
    const project = findProject(this.root, id),
      index = this.work.list();
    const people: ProjectSnapshot["people"] = [],
      activity: ProjectSnapshot["activity"] = [];
    let incomplete = false;
    const snapshots = new Map<string, ReturnType<WorkViewsService["read"]>>();
    for (const ref of project.personRefs) {
      const [collectionId, personId] = ref.split("/") as [string, string];
      try {
        let snapshot = snapshots.get(collectionId);
        if (!snapshot) {
          snapshot = this.work.read(collectionId, false);
          snapshots.set(collectionId, snapshot);
        }
        incomplete ||= snapshot.limited || snapshot.skipped > 0;
        const record = snapshot.records.find((r) => r.id === personId);
        if (!record) throw new Error();
        const doc = parsePerson(
          readDocument(this.root, record.source.path),
          record.source.path,
        );
        incomplete ||= doc.interactions.length >= 200;
        const view = index.views.find((v) => v.collectionId === collectionId);
        people.push({
          ref,
          name: doc.name,
          path: doc.path,
          revision: doc.revision,
          schemaRevision: snapshot.schemaRevision,
          ...(view
            ? {
                href: `/studio/views/${view.id}?person=${encodeURIComponent(personId)}`,
              }
            : {}),
        });
        for (const entry of doc.interactions)
          if (entry.projectId === project.id)
            activity.push({
              ...entry,
              personRef: ref,
              personName: doc.name,
              path: doc.path,
            });
      } catch {
        incomplete = true;
      }
    }
    for (const id of project.taskCollectionIds)
      try {
        const s = this.work.read(id, false);
        incomplete ||= s.limited || s.skipped > 0;
      } catch {
        incomplete = true;
      }
    activity.sort((a, b) => b.date.localeCompare(a.date));
    incomplete ||= activity.length > 100;
    return {
      rootId: this.rootId,
      project,
      pageId:
        "page-" +
        projectPageOperation(
          project.id +
            (project.pageGeneration
              ? ":generation:" + project.pageGeneration
              : ""),
        ),
      people,
      activity: activity.slice(0, 100),
      incomplete,
    };
  }
  async save(value: unknown) {
    const input = inputObject(value);
    this.check(input);
    const operationId = validateOperationId(input.operationId);
    const parsed = projectDefinition.safeParse(input.project);
    if (!parsed.success)
      throw new ViewError(
        "INVALID_PROJECT",
        "Provide a project name, identity, and bounded source relationships",
      );
    const definition = parsed.data;
    if (
      new Set(definition.taskCollectionIds).size !==
        definition.taskCollectionIds.length ||
      new Set(definition.personRefs).size !== definition.personRefs.length ||
      new Set(definition.personRefs.map((r) => r.split("/")[0])).size > 4
    )
      throw new ViewError(
        "INVALID_PROJECT",
        "Choose unique relationships from at most four people collections",
      );
    const fingerprint = documentRevision(
      JSON.stringify({ definition, expectedVersion: input.expectedVersion }),
    );
    assertProjectPath(this.root);
    return withFileMutation(this.root, PROJECTS_PATH, async () => {
      this.check(input);
      const registry = readProjects(this.root),
        receipt = registry.operations.find(
          (r) => r.operationId === operationId,
        );
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new ViewError(
            "OPERATION_CONFLICT",
            "This operation ID was used for another project change",
            409,
          );
        return { ...this.read(receipt.projectId), changedPaths: [] };
      }
      const current = registry.projects.find((p) => p.id === definition.id);
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion !== (current?.version ?? 0)
      )
        throw new ViewError(
          "REVISION_CONFLICT",
          "Project relationships changed elsewhere. Reload before saving.",
          409,
        );
      if (current && current.version >= Number.MAX_SAFE_INTEGER - 1)
        throw new ViewError(
          "PROJECTS_CAPACITY",
          "Project version limit reached",
          409,
        );
      if (!current && registry.projects.length >= 100)
        throw new ViewError(
          "PROJECTS_CAPACITY",
          "Keep at most 100 connected projects",
          409,
        );
      if (
        registry.projects.some(
          (p) =>
            p.id !== definition.id &&
            p.taskCollectionIds.some((id) =>
              definition.taskCollectionIds.includes(id),
            ),
        )
      )
        throw new ViewError(
          "PROJECT_COLLECTION_OWNED",
          "A task collection already belongs to another project",
          409,
        );
      for (const id of definition.taskCollectionIds)
        if (this.work.read(id, false).collection.template !== "tasks")
          throw new ViewError(
            "INVALID_PROJECT",
            "Select task collections for project work",
          );
      const snapshots = new Map<string, ReturnType<WorkViewsService["read"]>>();
      for (const ref of definition.personRefs) {
        const [id, personId] = ref.split("/") as [string, string];
        let s = snapshots.get(id);
        if (!s) {
          s = this.work.read(id, false);
          snapshots.set(id, s);
        }
        if (
          s.collection.template !== "people" ||
          !s.records.some((r) => r.id === personId)
        )
          throw new ViewError(
            "PROJECT_PERSON_MISSING",
            "A linked person no longer exists",
            404,
          );
      }
      const next = {
        ...definition,
        pageGeneration: current?.pageGeneration ?? 0,
        version: (current?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      registry.projects = [
        ...registry.projects.filter((p) => p.id !== next.id),
        next,
      ];
      registry.operations = [
        ...registry.operations,
        { operationId, fingerprint, projectId: next.id },
      ].slice(-500);
      writeProjects(this.root, registry);
      return { ...this.read(next.id), changedPaths: [PROJECTS_PATH] };
    });
  }
  async interact(value: unknown) {
    const input = inputObject(value);
    this.check(input);
    assertProjectPath(this.root);
    return withFileMutation(this.root, PROJECTS_PATH, async () => {
      this.check(input);
      const project = findProject(this.root, input.projectId);
      if (!project.personRefs.includes(String(input.personRef)))
        throw new ViewError(
          "PROJECT_PERSON_MISSING",
          "Choose a person linked to this project",
          409,
        );
      if (input.expectedVersion !== project.version)
        throw new ViewError(
          "REVISION_CONFLICT",
          "Project relationships changed. Review the recipient before retrying.",
          409,
        );
      const [collectionId, recordId] = String(input.personRef).split("/");
      return this.work.mutate({
        collectionId,
        recordId,
        action: "interaction.add",
        operationId: input.operationId,
        expectedRevision: input.expectedRevision,
        expectedSchemaRevision: input.expectedSchemaRevision,
        input: {
          text: input.text,
          date: input.date,
          source: input.source ?? "",
          projectId: project.id,
        },
      });
    });
  }
  async openPage(value: unknown) {
    const input = inputObject(value);
    this.check(input);
    assertProjectPath(this.root);
    return withFileMutation(this.root, PROJECTS_PATH, () =>
      this.openPageLocked(input),
    );
  }
  private async openPageLocked(input: Record<string, unknown>) {
    this.check(input);
    let project = findProject(this.root, input.projectId);
    const pages = new WorkPagesService(this.root, this.work, this.signal);
    const identity = () =>
      projectPageOperation(
        project.id +
          (project.pageGeneration
            ? ":generation:" + project.pageGeneration
            : ""),
      );
    if (readPages(this.root).retiredPageIds.includes("page-" + identity())) {
      if (
        project.version >= Number.MAX_SAFE_INTEGER - 1 ||
        project.pageGeneration >= Number.MAX_SAFE_INTEGER - 1
      )
        throw new ViewError(
          "PROJECTS_CAPACITY",
          "Project version limit reached",
          409,
        );
      const registry = readProjects(this.root);
      project = {
        ...project,
        pageGeneration: project.pageGeneration + 1,
        version: project.version + 1,
        updatedAt: new Date().toISOString(),
      };
      registry.projects = registry.projects.map((p) =>
        p.id === project.id ? project : p,
      );
      writeProjects(this.root, registry);
    }
    const operationId = identity();
    let current: ReturnType<WorkPagesService["read"]> | undefined;
    try {
      current = pages.read("page-" + operationId);
    } catch (error) {
      if (!(error instanceof ViewError) || error.code !== "PAGE_MISSING")
        throw error;
    }
    const projectSources = [
      ...project.taskCollectionIds,
      ...new Set(project.personRefs.map((r) => r.split("/")[0]!)),
    ];
    const previous = current?.page.spec.projectSources ?? [];
    if (current && JSON.stringify(previous) === JSON.stringify(projectSources))
      return current;
    const index = this.work.list();
    const sourceOf = (block: PageSpec["blocks"][number]) =>
      block.collectionId ??
      index.views.find((v) => v.id === block.viewId)?.collectionId;
    const blocks: PageSpec["blocks"] = current
      ? current.page.spec.blocks.filter((block) => {
          const id = sourceOf(block);
          return (
            (!id || !previous.includes(id) || projectSources.includes(id)) &&
            block.id !== "project-welcome"
          );
        })
      : [];
    for (const collectionId of projectSources.filter(
      (id) => !previous.includes(id),
    )) {
      if (blocks.some((block) => sourceOf(block) === collectionId)) continue;
      const tasks = project.taskCollectionIds.includes(collectionId);
      blocks.push({
        id:
          (tasks ? "tasks-" : "people-") +
          documentRevision(collectionId).slice(0, 24),
        title: tasks
          ? (index.views.find((v) => v.collectionId === collectionId)?.name ??
            "下一步")
          : "一起推进的人",
        kind: tasks ? "tasks" : "people",
        collectionId,
        ...(tasks
          ? {
              layout: "list-detail" as const,
              fields: ["title", "status", "dueDate", "personRef"],
              filter: {
                all: [{ field: "status", op: "neq" as const, value: "done" }],
              },
            }
          : {}),
      });
    }
    if (!blocks.length)
      blocks.push({
        id: "project-welcome",
        title: "开始推进项目",
        kind: "html",
        html: "<p>在项目中关联人物和任务资料，再用 AI 按你的习惯组织页面。</p>",
      });
    return pages.save({
      expectedRootId: this.rootId,
      expectedVersion: current?.page.version ?? 0,
      ...(current ? { pageId: current.page.id } : {}),
      operationId: current
        ? projectPageOperation(
            project.id +
              ":sources:" +
              project.version +
              ":" +
              current.page.version,
          )
        : operationId,
      spec: {
        ...(current?.page.spec ?? {
          specVersion: 1,
          title: project.title,
          description:
            project.goal.length > 500
              ? project.goal.slice(0, 498).replace(/[\uD800-\uDBFF]$/, "") + "…"
              : project.goal,
          layout: { columns: 2, density: "comfortable" },
        }),
        projectId: project.id,
        projectSources,
        blocks,
      },
    });
  }
}
