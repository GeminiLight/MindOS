import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  ViewError,
  type PersonDocument,
  type PersonFields,
  type PersonFollowup,
  type PersonInteraction,
  type ViewMaterial,
} from "./types.js";
export const documentRevision = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const aliases = {
  background: ["背景", "Background"],
  focus: ["关注方向", "Focus"],
  followup: ["下次跟进", "Follow-up"],
  interactions: ["互动记录", "Interactions"],
  sources: ["来源", "Sources"],
};
// Reject invalid control characters in one-line fields.
// eslint-disable-next-line no-control-regex
const inlineControl = /[\x00-\x1f\x7f]/;
export function validateText(
  value: unknown,
  label: string,
  limit: number,
  required = false,
  inline = false,
): string {
  if (typeof value !== "string")
    throw new ViewError("INVALID_INPUT", `${label} must be text`);
  const text = value.trim();
  if (required && !text)
    throw new ViewError("INVALID_INPUT", `${label} is required`);
  if (
    [...text].length > limit ||
    text.includes("\0") ||
    (inline && inlineControl.test(text)) ||
    /[\uD800-\uDFFF]/u.test(text)
  )
    throw new ViewError(
      "INVALID_INPUT",
      `${label} is too long or contains invalid characters`,
    );
  return text;
}
export function validateId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{7,79}$/.test(value))
    throw new ViewError("INVALID_INPUT", "Invalid record identity");
  return value;
}
export function validateOperationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new ViewError("INVALID_INPUT", "A valid operationId is required");
  return value.toLowerCase();
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
const normalize = (s: string) => s.replace(/\r\n/g, "\n");
const plain = (s: string) =>
  s.replace(/^\\(?=#+\s)/gm, "").replace(/^\\(?=<!-- mindos-)/gm, "");
const escapePlain = (s: string) => s.replace(/^(?=#+\s|<!-- mindos-)/gm, "\\");
// Keep offsets while masking fenced examples, so they cannot become shared sections.
function outsideFences(content: string): string {
  let fence: { char: string; length: number } | undefined;
  return content
    .split(/(?<=\n)/)
    .map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!fence && match) {
        fence = { char: match[1]![0]!, length: match[1]!.length };
        return line.replace(/[^\n]/g, " ");
      }
      if (fence) {
        if (
          match &&
          match[1]![0] === fence.char &&
          match[1]!.length >= fence.length &&
          /^ {0,3}(?:`+|~+)\s*$/.test(line.trimEnd())
        )
          fence = undefined;
        return line.replace(/[^\n]/g, " ");
      }
      return line;
    })
    .join("");
}
function section(
  content: string,
  names: string[],
): { start: number; bodyStart: number; end: number; body: string } | null {
  const headings = [...outsideFences(content).matchAll(/^##\s+([^\n]+)\n?/gm)];
  const index = headings.findIndex((h) => names.includes(h[1]?.trim() || ""));
  if (index < 0) return null;
  const h = headings[index]!;
  const start = h.index!;
  const bodyStart = start + h[0].length;
  const end = headings[index + 1]?.index ?? content.length;
  return { start, bodyStart, end, body: content.slice(bodyStart, end).trim() };
}
function setSection(content: string, names: string[], body: string): string {
  const part = section(content, names);
  const text = body.trim();
  if (!part) return content.trimEnd() + `\n\n## ${names[0]}\n${text}\n`;
  return (
    content.slice(0, part.bodyStart) + text + "\n\n" + content.slice(part.end)
  );
}
function restoreEol(original: string, next: string): string {
  return original.includes("\r\n") ? next.replace(/\n/g, "\r\n") : next;
}
function readInteractions(body: string): PersonInteraction[] {
  if (!body.trim()) return [];
  const headings = [...body.matchAll(/^###\s+(\d{4}-\d{2}-\d{2})[^\n]*\n/gm)];
  const entries: PersonInteraction[] = [];
  const prefix = body.slice(0, headings[0]?.index ?? body.length).trim();
  if (prefix) {
    const lines = prefix.split(/\n(?=-\s+\d{4}-\d{2}-\d{2})/);
    for (const text of lines)
      entries.push({
        id: "legacy-" + documentRevision(text).slice(0, 24),
        date: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "",
        text: plain(text.replace(/^-\s*\d{4}-\d{2}-\d{2}[：:\s]*/, "")),
        source: "",
      });
  }
  for (const [i, h] of headings.entries()) {
    const block = body
      .slice(h.index! + h[0].length, headings[i + 1]?.index ?? body.length)
      .trim();
    const marker = block.match(
      /^<!-- mindos-interaction:([a-f0-9-]+):([a-f0-9]{64}) -->\n?/,
    );
    const without = marker ? block.slice(marker[0].length) : block;
    const source = without.match(/^来源：[\s]*([^\n]*)\n?/);
    entries.push({
      id:
        marker?.[1] || "legacy-" + documentRevision(h[0] + block).slice(0, 24),
      date: h[1]!,
      source: source?.[1] || "",
      text: plain((source ? without.slice(source[0].length) : without).trim()),
    });
  }
  return entries.slice(-200).reverse();
}
export function isPersonDocument(content: string, path: string): boolean {
  return (
    /[<]!-- mindos-person:[a-z0-9-]+ -->/.test(content) ||
    /(?:^|\/)(?:人物|People|people)\//.test(path) ||
    /^##\s+(?:背景|Background|互动记录|Interactions|下次跟进|Follow-up)\s*$/m.test(
      content,
    )
  );
}
export function parsePerson(content: string, path: string): PersonDocument {
  const raw = normalize(content);
  const title =
    raw.match(/^#\s+([^\n]+)/m)?.[1]?.trim() || basename(path, ".md");
  const marker = raw.match(/[<]!-- mindos-person:([a-z][a-z0-9-]{7,79}) -->/);
  const interactions = readInteractions(
    section(raw, aliases.interactions)?.body || "",
  );
  const plan = section(raw, aliases.followup)?.body || "";
  const date =
    plan.match(/^(?:日期|Date)[：:]\s*(\d{4}-\d{2}-\d{2})/m)?.[1] || "";
  const after = plan.match(/^(?:下一步|Next)[：:]\s*\n?([\s\S]*)/m)?.[1];
  return {
    id: marker?.[1] || "p-" + documentRevision(path).slice(0, 24),
    name: title,
    path,
    revision: documentRevision(content),
    background: plain(section(raw, aliases.background)?.body || ""),
    focus: plain(section(raw, aliases.focus)?.body || ""),
    followup: {
      date: validDate(date) ? date : "",
      completed: /^(?:状态|Status)[：:]\s*(?:已完成|Completed)\s*$/m.test(plan),
      text: plain(
        after?.trim() ||
          plan.replace(/^(?:日期|Date|状态|Status)[：:][^\n]*\n?/gm, "").trim(),
      ),
    },
    interactions,
    interactionCount: interactions.length,
    sources: plain(section(raw, aliases.sources)?.body || ""),
    managed: !!marker,
  };
}
export function newPerson(id: string, fields: PersonFields): string {
  validateId(id);
  const next = patchFields(
    `# Untitled\n<!-- mindos-person:${id} -->\n\n## 互动记录\n`,
    fields,
  );
  return next.trimEnd() + "\n";
}
export function patchFields(
  content: string,
  fields: Partial<PersonFields>,
): string {
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    throw new ViewError("INVALID_INPUT", "Invalid person fields");
  let raw = normalize(content);
  if (fields.name !== undefined) {
    const name = validateText(fields.name, "Name", 80, true, true);
    raw = /^#\s+[^\n]*/m.test(raw)
      ? raw.replace(/^#\s+[^\n]*/m, () => `# ${name}`)
      : `# ${name}\n\n${raw}`;
  }
  for (const key of ["background", "focus"] as const)
    if (fields[key] !== undefined)
      raw = setSection(
        raw,
        aliases[key],
        escapePlain(validateText(fields[key], key, 8000)),
      );
  return restoreEol(content, raw);
}
export function patchFollowup(
  content: string,
  followup: PersonFollowup,
): string {
  const text = validateText(followup?.text, "Next step", 4000, true);
  if (
    typeof followup.date !== "string" ||
    !validDate(followup.date) ||
    typeof followup.completed !== "boolean"
  )
    throw new ViewError(
      "INVALID_INPUT",
      "A valid follow-up date and state are required",
    );
  const body = `日期：${followup.date}\n状态：${followup.completed ? "已完成" : "待跟进"}\n下一步：\n${escapePlain(text)}`;
  return restoreEol(
    content,
    setSection(normalize(content), aliases.followup, body),
  );
}
export function appendInteraction(
  content: string,
  entry: PersonInteraction,
): string {
  const id = validateOperationId(entry?.id);
  const text = validateText(entry?.text, "Interaction", 8000, true);
  const source = validateText(entry?.source ?? "", "Source", 1000, false, true);
  if (typeof entry.date !== "string" || !validDate(entry.date))
    throw new ViewError(
      "INVALID_INPUT",
      "A valid interaction date is required",
    );
  const hash = documentRevision(
    JSON.stringify({ date: entry.date, text, source }),
  );
  const raw = normalize(content);
  const receipt = raw.match(
    new RegExp(`^<!-- mindos-interaction:${id}:([a-f0-9]{64}) -->$`, "m"),
  );
  if (receipt) {
    if (receipt[1] !== hash)
      throw new ViewError(
        "OPERATION_CONFLICT",
        "This operationId was already used with different content",
        409,
      );
    return content;
  }
  const old = section(raw, aliases.interactions)?.body || "";
  const block = `### ${entry.date} · 互动\n<!-- mindos-interaction:${id}:${hash} -->\n${source ? "来源：" + source + "\n" : ""}${escapePlain(text)}`;
  return restoreEol(
    content,
    setSection(
      raw,
      aliases.interactions,
      [old, block].filter(Boolean).join("\n\n"),
    ),
  );
}
export function personMaterials(
  person: PersonDocument,
  selected: string[],
): ViewMaterial[] {
  const items: ViewMaterial[] = [
    {
      id: "background",
      label: "人物背景",
      path: person.path,
      revision: person.revision,
      content: `# ${person.name}\n\n${person.background}\n\n${person.focus}`,
    },
    {
      id: "followup",
      label: "下一步跟进",
      path: person.path,
      revision: person.revision,
      content: `${person.followup.text || "暂未安排"}\n${person.followup.date}${person.followup.completed ? " · 已完成" : ""}`,
    },
    {
      id: "interactions",
      label: "互动记录",
      path: person.path,
      revision: person.revision,
      content:
        person.interactions
          .map(
            (r) =>
              `${r.date}\n${r.text}${r.source ? "\n来源：" + r.source : ""}`,
          )
          .join("\n\n") || "暂无互动记录",
    },
  ];
  if (person.sources.trim())
    items.push({
      id: "sources",
      label: "关联来源",
      path: person.path,
      revision: person.revision,
      content: person.sources,
    });
  return items.filter((item) => selected.includes(item.id));
}
export function exportPeopleCsv(people: PersonDocument[]): string {
  const quote = (value: string) =>
    '"' +
    (/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll(
      '"',
      '""',
    ) +
    '"';
  return (
    "\ufeff姓名,背景,关注方向,下一步,日期,状态,资料文件\r\n" +
    people
      .map((p) =>
        [
          p.name,
          p.background,
          p.focus,
          p.followup.text,
          p.followup.date,
          p.followup.completed ? "已完成" : "待跟进",
          p.path,
        ]
          .map(quote)
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
