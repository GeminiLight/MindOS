import type { ViewSpec } from "./view-spec.js";
export type ViewTemplate = "people" | "tasks";
export type CollectionDefinition = {
  id: string;
  folder: string;
  template: ViewTemplate;
  schemaVersion: 1;
};
export type ViewDefinition = {
  id: string;
  name: string;
  folder: string;
  template: ViewTemplate;
  version: number;
  createdAt: string;
  updatedAt: string;
  collectionId?: string;
  spec?: ViewSpec;
  pinned?: boolean;
  previousSpec?: ViewSpec;
  lastOpenedAt?: string;
  lastPersonId?: string;
  lastPersonName?: string;
};
export type ViewSummary = ViewDefinition & {
  availability: "ready" | "missing" | "unavailable";
};
export type PersonFields = { name: string; background: string; focus: string };
export type PersonFollowup = { text: string; date: string; completed: boolean };
export type PersonInteraction = {
  id: string;
  date: string;
  text: string;
  source: string;
};
export type PersonSummary = PersonFields & {
  id: string;
  path: string;
  revision: string;
  followup: PersonFollowup;
  interactionCount: number;
};
export type PersonDocument = PersonSummary & {
  interactions: PersonInteraction[];
  sources: string;
  managed: boolean;
};
export type ViewFile = {
  path: string;
  name: string;
  size: number;
  personId?: string;
};
export type ViewCollection = {
  view: ViewSummary;
  people: PersonSummary[];
  files: ViewFile[];
  skipped: number;
  limited: boolean;
};
export type ViewIndex = {
  rootId: string;
  views: ViewSummary[];
  folders: string[];
};
export type ViewPreview = {
  folder: string;
  people: Array<Pick<PersonSummary, "id" | "name" | "path">>;
  personCount: number;
  fileCount: number;
  skipped: number;
  limited: boolean;
  existingView?: ViewSummary;
};
export type ViewMaterial = {
  id: "background" | "followup" | "interactions" | "sources";
  label: string;
  path: string;
  revision: string;
  content: string;
};
export type ViewKnowledgeWrite = {
  op: "create_file" | "save_file";
  path: string;
  content?: string;
  expectedRevision?: string;
};
export type ViewKnowledgeWriter = (
  operation: ViewKnowledgeWrite,
) => Promise<void>;
export class ViewError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ViewError";
  }
}
