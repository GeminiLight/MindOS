import { WorkViewsService, inputObject } from "./service.js";
import {
  documentRevision,
  validateId,
  validateOperationId,
} from "./markdown.js";
import { withFileMutation } from "./file-lock.js";
import { ViewError } from "./types.js";
import { validatePageSpec, type PageSpec } from "./page-spec.js";
import { renderPageData } from "./page-data.js";
import {
  readPages,
  assertPageMetadataPath,
  writePages,
  PAGES_PATH,
  MAX_RETIRED_PAGES,
  type PageRegistry,
  type SavedPage,
} from "./page-store.js";
export type { SavedPage, PageVersion } from "./page-store.js";
export type { PageBlockData } from "./page-data.js";
export class WorkPagesService {
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
          "Page rendering cannot write source data",
          403,
        );
      });
    this.rootId = this.work.rootId;
  }
  list() {
    return {
      rootId: this.rootId,
      pages: readPages(this.root)
        .pages.map(({ history: _history, ...page }) => page)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }
  read(pageId: string) {
    validateId(pageId);
    const page = readPages(this.root).pages.find((page) => page.id === pageId);
    if (!page)
      throw new ViewError(
        "PAGE_MISSING",
        "This page was removed or is not in this library",
        404,
      );
    return {
      rootId: this.rootId,
      page,
      blocks: renderPageData(this.root, this.work, page.spec),
    };
  }
  preview(value: unknown) {
    const input = inputObject(value);
    this.checkRoot(input);
    const spec = validatePageSpec(input.spec);
    return {
      rootId: this.rootId,
      spec,
      blocks: renderPageData(this.root, this.work, spec),
    };
  }
  private checkRoot(input: Record<string, unknown>) {
    if (input.expectedRootId !== this.rootId)
      throw new ViewError(
        "ROOT_CHANGED",
        "The library changed. Reopen the page before saving.",
        409,
      );
  }
  private expected(input: Record<string, unknown>, current: number) {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion !== current
    )
      throw new ViewError(
        "REVISION_CONFLICT",
        "This page changed elsewhere. Reload it before applying your layout.",
        409,
      );
  }
  private replay(
    registry: PageRegistry,
    operationId: string,
    fingerprint: string,
  ) {
    const receipt = registry.operations.find(
      (op) => op.operationId === operationId,
    );
    if (!receipt) return undefined;
    if (receipt.fingerprint !== fingerprint)
      throw new ViewError(
        "OPERATION_CONFLICT",
        "This operation ID was used for a different page change",
        409,
      );
    if (receipt.removed)
      return {
        rootId: this.rootId,
        pageId: receipt.pageId,
        removed: true as const,
        changedPaths: [PAGES_PATH],
      };
    const page = registry.pages.find((page) => page.id === receipt.pageId);
    if (!page)
      throw new ViewError(
        "PAGE_MISSING",
        "This page was removed. Create a new request instead of replaying its save.",
        404,
      );
    return { rootId: this.rootId, page, changedPaths: [PAGES_PATH] };
  }
  private async mutate(kind: "save" | "restore" | "remove", value: unknown) {
    const input = inputObject(value);
    this.checkRoot(input);
    const operationId = validateOperationId(input.operationId);
    const spec = kind === "save" ? validatePageSpec(input.spec) : undefined;
    const pageId =
      input.pageId === undefined && kind === "save"
        ? undefined
        : validateId(input.pageId);
    const fingerprint = documentRevision(
      JSON.stringify({
        kind,
        pageId,
        spec,
        expectedVersion: input.expectedVersion,
        restoreVersion: input.restoreVersion,
      }),
    );
    assertPageMetadataPath(this.root);
    return withFileMutation(this.root, PAGES_PATH, async () => {
      if (this.signal?.aborted)
        throw new ViewError(
          "REQUEST_CANCELLED",
          "The page change was cancelled",
          499,
        );
      const registry = readPages(this.root);
      const prior = this.replay(registry, operationId, fingerprint);
      if (prior) return prior;
      const targetId = pageId ?? "page-" + operationId;
      if (registry.retiredPageIds.includes(targetId))
        throw new ViewError(
          "PAGE_MISSING",
          "This page was removed. Create a new request instead of replaying its save.",
          404,
        );
      const index = registry.pages.findIndex((page) => page.id === targetId),
        current = index >= 0 ? registry.pages[index] : undefined;
      if (pageId && !current)
        throw new ViewError("PAGE_MISSING", "This page no longer exists", 404);
      this.expected(input, current?.version ?? 0);
      if (!current && registry.pages.length >= 100)
        throw new ViewError(
          "PAGES_CAPACITY",
          "Keep at most 100 saved work pages. Remove an unused page first.",
          409,
        );
      const now = new Date().toISOString();
      let next: SavedPage | undefined;
      if (kind === "remove") {
        if (registry.retiredPageIds.length >= MAX_RETIRED_PAGES)
          throw new ViewError(
            "PAGES_CAPACITY",
            "The removed-page history reached its limit. Existing pages were preserved.",
            409,
          );
        registry.pages.splice(index, 1);
        registry.retiredPageIds.push(current!.id);
      } else {
        let nextSpec = spec;
        if (kind === "restore") {
          if (!Number.isSafeInteger(input.restoreVersion))
            throw new ViewError("INVALID_PAGE", "Choose a valid page version");
          nextSpec = current!.history.find(
            (item) => item.version === input.restoreVersion,
          )?.spec;
          if (!nextSpec)
            throw new ViewError(
              "VERSION_MISSING",
              "This layout version is no longer available",
              404,
            );
        }
        if (current && current.version >= Number.MAX_SAFE_INTEGER - 1)
          throw new ViewError(
            "PAGES_CAPACITY",
            "The page version limit was reached",
            409,
          );
        next = {
          id: targetId,
          spec: nextSpec!,
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          history: current
            ? [
                ...current.history,
                {
                  version: current.version,
                  spec: current.spec,
                  createdAt: current.updatedAt,
                },
              ].slice(-20)
            : [],
        };
        if (current) registry.pages[index] = next;
        else registry.pages.push(next);
      }
      const actualId = next?.id ?? current!.id;
      registry.operations = [
        ...registry.operations,
        {
          operationId,
          fingerprint,
          pageId: actualId,
          ...(kind === "remove" ? { removed: true } : {}),
        },
      ].slice(-500);
      if (this.signal?.aborted)
        throw new ViewError(
          "REQUEST_CANCELLED",
          "The page change was cancelled",
          499,
        );
      writePages(this.root, registry);
      return next
        ? { rootId: this.rootId, page: next, changedPaths: [PAGES_PATH] }
        : {
            rootId: this.rootId,
            pageId: actualId,
            removed: true as const,
            changedPaths: [PAGES_PATH],
          };
    });
  }
  async save(
    input: unknown,
  ): Promise<{ rootId: string; page: SavedPage; changedPaths: string[] }> {
    return (await this.mutate("save", input)) as {
      rootId: string;
      page: SavedPage;
      changedPaths: string[];
    };
  }
  async restore(
    input: unknown,
  ): Promise<{ rootId: string; page: SavedPage; changedPaths: string[] }> {
    return (await this.mutate("restore", input)) as {
      rootId: string;
      page: SavedPage;
      changedPaths: string[];
    };
  }
  async remove(input: unknown): Promise<{
    rootId: string;
    pageId: string;
    removed: true;
    changedPaths: string[];
  }> {
    return (await this.mutate("remove", input)) as {
      rootId: string;
      pageId: string;
      removed: true;
      changedPaths: string[];
    };
  }
}
