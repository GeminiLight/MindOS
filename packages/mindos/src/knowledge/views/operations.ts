import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { checkedPath, readDocument } from "./paths.js";
import { documentRevision, validateOperationId } from "./markdown.js";
import { ViewError, type ViewKnowledgeWriter } from "./types.js";
import { withFileMutation } from "./file-lock.js";
export type MutationRequest = {
  operationId: string;
  path: string;
  expectedRevision?: string;
  input: unknown;
};
export type Receipt = {
  operationId: string;
  fingerprint: string;
  path: string;
  before: string | null;
  after: string;
  beforeRevision: string | null;
  afterRevision: string;
  action?: string;
  status: "prepared" | "committed" | "conflict";
  createdAt: string;
};
export function atomicMetadata(
  root: string,
  path: string,
  value: unknown,
): void {
  const file = checkedPath(root, path);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, JSON.stringify(value) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temp, checkedPath(root, path));
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      /* Already renamed. */
    }
  }
}
export function readReceipt(root: string, id: string): Receipt {
  validateOperationId(id);
  const file = checkedPath(root, `.mindos/views/operations/${id}.json`);
  if (statSync(file).size > 4 * 1024 * 1024)
    throw new ViewError(
      "OPERATION_PENDING",
      "Operation receipt is too large",
      409,
    );
  const r = JSON.parse(readFileSync(file, "utf8")) as Receipt;
  if (
    r.operationId !== id ||
    typeof r.path !== "string" ||
    typeof r.after !== "string" ||
    r.afterRevision !== documentRevision(r.after) ||
    (r.before !== null &&
      (typeof r.before !== "string" ||
        r.beforeRevision !== documentRevision(r.before)))
  )
    throw new ViewError(
      "OPERATION_PENDING",
      "Operation receipt needs recovery",
      409,
    );
  return r;
}
export async function commitViewMutation(
  root: string,
  request: MutationRequest,
  change: (before: string | null) => string,
  write: ViewKnowledgeWriter,
) {
  validateOperationId(request.operationId);
  return withFileMutation(root, ".mindos/views/operation-gateway", () =>
    withFileMutation(root, request.path, async () => {
      const relative = `.mindos/views/operations/${request.operationId}.json`,
        file = checkedPath(root, relative);
      const fingerprint = documentRevision(JSON.stringify(request));
      const current = existsSync(checkedPath(root, request.path))
        ? readDocument(root, request.path)
        : null;
      const revision = current === null ? null : documentRevision(current);
      let receipt: Receipt;
      if (existsSync(file)) {
        receipt = readReceipt(root, request.operationId);
        if (receipt.fingerprint !== fingerprint)
          throw new ViewError(
            "OPERATION_CONFLICT",
            "Operation ID was already used with different input",
            409,
          );
        if (receipt.status === "committed")
          return {
            operationId: receipt.operationId,
            committed: true,
            newRevision: receipt.afterRevision,
            sourcePath: receipt.path,
            changedPaths: [receipt.path],
          };
        if (
          revision !== receipt.afterRevision &&
          revision !== receipt.beforeRevision
        ) {
          receipt.status = "conflict";
          atomicMetadata(root, relative, receipt);
          throw new ViewError(
            "REVISION_CONFLICT",
            "The file changed while recovering this operation",
            409,
          );
        }
      } else {
        if (
          (current !== null && request.expectedRevision !== revision) ||
          (current === null && request.expectedRevision !== undefined)
        )
          throw new ViewError(
            "REVISION_CONFLICT",
            "Read the current record before saving",
            409,
          );
        const after = change(current);
        if (Buffer.byteLength(after) > 256 * 1024)
          throw new ViewError("INVALID_RECORD", "Record exceeds 256 KiB", 413);
        receipt = {
          operationId: request.operationId,
          fingerprint,
          path: request.path,
          before: current,
          after,
          beforeRevision: revision,
          afterRevision: documentRevision(after),
          action:
            request.input &&
            typeof request.input === "object" &&
            "action" in request.input
              ? String(request.input.action)
              : undefined,
          status: "prepared",
          createdAt: new Date().toISOString(),
        };
        const directory = checkedPath(root, ".mindos/views/operations");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        let bytes = 0;
        for (const name of readdirSync(directory)) {
          const entry = checkedPath(root, `.mindos/views/operations/${name}`);
          bytes += statSync(entry).size;
        }
        if (
          bytes + Buffer.byteLength(JSON.stringify(receipt)) >
          128 * 1024 * 1024
        )
          throw new ViewError(
            "RECOVERY_STORAGE_FULL",
            "Recovery storage is full; archive completed operations older than seven days",
            507,
          );
        atomicMetadata(root, relative, receipt);
      }
      if (revision !== receipt.afterRevision)
        await write({
          op: current === null ? "create_file" : "save_file",
          path: receipt.path,
          content: receipt.after,
          ...(revision ? { expectedRevision: revision } : {}),
        });
      const saved = readDocument(root, receipt.path);
      if (documentRevision(saved) !== receipt.afterRevision)
        throw new ViewError(
          "REVISION_CONFLICT",
          "The saved file changed; inspect the operation before retrying",
          409,
        );
      receipt.status = "committed";
      atomicMetadata(root, relative, receipt);
      return {
        operationId: receipt.operationId,
        committed: true,
        newRevision: receipt.afterRevision,
        sourcePath: receipt.path,
        changedPaths: [receipt.path],
      };
    }),
  );
}
