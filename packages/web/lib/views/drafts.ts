export type ViewDraft = {
  revision: string;
  schemaRevision?: string;
  operationId: string;
  values: Record<string, string | boolean>;
  updatedAt: number;
};
export type ViewDraftScope = {
  rootId: string;
  viewId: string;
  personId: string;
  kind: string;
};
const key = (s: ViewDraftScope) =>
  `mindos:view-draft:${JSON.stringify([s.rootId, s.viewId, s.personId, s.kind])}`;
export function readViewDraft(scope: ViewDraftScope): ViewDraft | null {
  try {
    const raw = localStorage.getItem(key(scope));
    if (!raw) return null;
    const d = JSON.parse(raw) as ViewDraft;
    if (
      !d ||
      typeof d.revision !== "string" ||
      typeof d.operationId !== "string" ||
      !Number.isFinite(d.updatedAt) ||
      !d.values ||
      typeof d.values !== "object" ||
      Array.isArray(d.values) ||
      Object.values(d.values).some(
        (v) => typeof v !== "string" && typeof v !== "boolean",
      )
    )
      return null;
    return d;
  } catch {
    return null;
  }
}
export function writeViewDraft(
  scope: ViewDraftScope,
  draft: ViewDraft,
): boolean {
  try {
    localStorage.setItem(key(scope), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearViewDraft(scope: ViewDraftScope): void {
  try {
    localStorage.removeItem(key(scope));
  } catch {
    /* Input remains in the mounted editor. */
  }
}
