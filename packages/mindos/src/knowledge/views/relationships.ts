import type { WorkSnapshot } from "./service.js";
import type { CollectionDefinition, ViewDefinition } from "./types.js";
import { ViewError } from "./types.js";
import { scanFolder } from "./paths.js";
import {
  defaultSpec,
  projectView,
  validateViewSpec,
  type ViewSpec,
} from "./view-spec.js";
import { validateId } from "./markdown.js";
type Registry = {
  collections: CollectionDefinition[];
  views: ViewDefinition[];
};
export type RelatedWork = {
  rootId: string;
  personRef: string;
  incomplete: boolean;
  groups: Array<{
    collectionId: string;
    viewId: string;
    name: string;
    folder: string;
    canCreate: boolean;
    canEdit: boolean;
    records: Array<{ id: string; fields: Record<string, string> }>;
  }>;
};
/** Resolve each referenced collection once, with a fixed IO budget and no persistent name cache. */
export function taskPeople(root: string, registry: Registry, refs: string[]) {
  const names = new Map<string, { personName: string; personHref?: string }>();
  const references = new Set(refs);
  const ids = [
    ...new Set(
      refs.map((r) => r.split("/")[0]).filter((id): id is string => !!id),
    ),
  ].slice(0, 20);
  for (const id of ids) {
    const c = registry.collections.find(
      (c) => c.id === id && c.template === "people",
    );
    if (!c) continue;
    try {
      const people = scanFolder(root, c.folder).people;
      const views = registry.views.filter((v) => v.collectionId === id);
      for (const person of people) {
        const ref = id + "/" + person.id;
        if (!references.has(ref)) continue;
        const view = views.find((v) => {
          const spec = v.spec ?? defaultSpec(id, "people");
          return (
            spec.layout === "list-detail" &&
            spec.fields.join(",") === "name,background,focus" &&
            !Object.keys(spec.labels ?? {}).length &&
            [
              "record.create",
              "record.update",
              "interaction.add",
              "followup.update",
              "source.open",
            ].every((action) =>
              spec.actions.includes(action as ViewSpec["actions"][number]),
            ) &&
            projectView(spec, [
              {
                id: person.id,
                fields: {
                  name: person.name,
                  background: person.background,
                  focus: person.focus,
                  followup: person.followup.text,
                  followupState: person.followup.completed ? "done" : "todo",
                  followupDate: person.followup.date,
                },
              },
            ]).length > 0
          );
        });
        names.set(ref, {
          personName: person.name,
          ...(view
            ? {
                personHref: `/studio/views/${view.id}?person=${encodeURIComponent(person.id)}`,
              }
            : {}),
        });
      }
    } catch {
      /* An unreadable person must not prevent opening the project tasks. */
    }
  }
  return names;
}
/** One saved projection per collection avoids duplicates and honors presentation constraints. */
export function relatedWork(
  rootId: string,
  registry: Registry,
  read: (id: string) => WorkSnapshot,
  collectionId: string,
  personId: string,
): RelatedWork {
  validateId(personId);
  const person = read(collectionId);
  if (
    person.collection.template !== "people" ||
    !person.records.some((r) => r.id === personId)
  )
    throw new ViewError("PERSON_MISSING", "Person no longer exists", 404);
  const ref = collectionId + "/" + personId;
  const groups: RelatedWork["groups"] = [];
  const collections = registry.collections.filter(
    (c) => c.template === "tasks",
  );
  let incomplete =
      collections.length > 30 || person.limited || person.skipped > 0,
    total = 0;
  for (const c of collections.slice(0, 30)) {
    const view = registry.views.find((v) => v.collectionId === c.id);
    if (!view) continue;
    try {
      const snapshot = read(c.id),
        spec: ViewSpec = validateViewSpec(
          view.spec ?? defaultSpec(c.id, "tasks"),
          snapshot.fields,
        );
      if (!spec.fields.includes("title")) continue;
      const matches = projectView(spec, snapshot.records).filter(
        (r) => r.fields.personRef === ref,
      );
      const records = matches.slice(0, Math.max(0, 100 - total));
      incomplete ||=
        snapshot.limited ||
        snapshot.skipped > 0 ||
        records.length < matches.length;
      total += records.length;
      groups.push({
        collectionId: c.id,
        viewId: view.id,
        name: view.name,
        folder: c.folder,
        canCreate: spec.actions.includes("record.create"),
        canEdit: spec.actions.includes("record.update"),
        records: records.map((r) => ({
          id: r.id,
          fields: Object.fromEntries(
            spec.fields.map((k) => [k, r.fields[k] ?? ""]),
          ),
        })),
      });
    } catch {
      incomplete = true;
    }
  }
  return { rootId, personRef: ref, groups, incomplete };
}
