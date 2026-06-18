import { redactSensitiveObject, redactSensitiveText } from './redaction.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeToolArgs(toolName: string, args: unknown): unknown {
  if (!isRecord(args)) return typeof args === 'string' ? redactSensitiveText(args) : redactSensitiveObject(args);

  if (toolName === 'batch_create_files' && Array.isArray(args.files)) {
    return redactSensitiveObject({
      ...args,
      files: args.files
        .filter(isRecord)
        .map((file) => ({
          path: file.path,
          ...(file.description ? { description: file.description } : {}),
        })),
    });
  }

  if (typeof args.content === 'string' && args.content.length > 200) {
    return redactSensitiveObject({ ...args, content: `[${args.content.length} chars]` });
  }
  if (typeof args.text === 'string' && args.text.length > 200) {
    return redactSensitiveObject({ ...args, text: `[${args.text.length} chars]` });
  }
  return redactSensitiveObject(args);
}

export function sanitizeToolOutput(output: string): string {
  return redactSensitiveText(output);
}

export function safeParseMindosJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
