import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type MindosRuntimeImageAttachment = {
  kind: 'image';
  name?: string;
  mimeType?: string;
  data?: string;
  path?: string;
};

export type MindosRuntimeUploadedFileAttachment = {
  kind: 'uploaded_file';
  name: string;
  mimeType?: string;
  size?: number;
  content?: string;
  dataBase64?: string;
  path?: string;
  materializedFrom?: 'original' | 'text_projection' | 'provided_path';
};

export type MindosRuntimeAttachment =
  | MindosRuntimeImageAttachment
  | MindosRuntimeUploadedFileAttachment;

export type MindosRuntimeMaterializedAttachments = {
  attachments: MindosRuntimeAttachment[];
  cleanup(): Promise<void>;
};

export function createMindosRuntimeUploadedFileAttachments(uploadedFiles: unknown): MindosRuntimeUploadedFileAttachment[] {
  if (!Array.isArray(uploadedFiles)) return [];
  const result: MindosRuntimeUploadedFileAttachment[] = [];

  for (const file of uploadedFiles) {
    if (!file || typeof file !== 'object') continue;
    const record = file as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name.trim()) continue;
    const attachment: MindosRuntimeUploadedFileAttachment = {
      kind: 'uploaded_file',
      name: record.name,
      ...(typeof record.content === 'string' ? { content: record.content } : {}),
      ...(typeof record.mimeType === 'string' && record.mimeType.trim() ? { mimeType: record.mimeType } : {}),
      ...(typeof record.size === 'number' && Number.isFinite(record.size) ? { size: record.size } : {}),
      ...(typeof record.dataBase64 === 'string' && record.dataBase64 ? { dataBase64: record.dataBase64 } : {}),
    };
    result.push(attachment);
  }

  return result;
}

export function createMindosRuntimeImageAttachments(images: unknown): MindosRuntimeImageAttachment[] {
  if (!Array.isArray(images)) return [];
  const result: MindosRuntimeImageAttachment[] = [];

  for (const image of images) {
    if (!image || typeof image !== 'object') continue;
    const record = image as Record<string, unknown>;
    if (record.type !== 'image') continue;
    const data = typeof record.data === 'string' && record.data ? record.data : undefined;
    if (!data) continue;
    result.push({
      kind: 'image',
      ...(typeof record.fileName === 'string' && record.fileName ? { name: record.fileName } : {}),
      ...(typeof record.mimeType === 'string' && record.mimeType ? { mimeType: record.mimeType } : {}),
      data,
    });
  }

  return result;
}

export function getMindosRuntimeAttachmentImages(attachments: MindosRuntimeAttachment[] | undefined): MindosRuntimeImageAttachment[] {
  return (attachments ?? []).filter((attachment): attachment is MindosRuntimeImageAttachment => attachment.kind === 'image');
}

export function hasMindosRuntimeAttachments(attachments: MindosRuntimeAttachment[] | undefined): boolean {
  return Array.isArray(attachments) && attachments.length > 0;
}

export async function materializeMindosRuntimeAttachments(
  attachments: MindosRuntimeAttachment[] | undefined,
  options: { prefix?: string } = {},
): Promise<MindosRuntimeMaterializedAttachments> {
  if (!attachments?.length) {
    return { attachments: [], cleanup: async () => {} };
  }

  const root = join(tmpdir(), 'mindos-runtime-attachments', options.prefix ?? randomUUID());
  let created = false;
  const materialized: MindosRuntimeAttachment[] = [];

  try {
    for (const [index, attachment] of attachments.entries()) {
      if (attachment.kind === 'image') {
        if (attachment.path) {
          materialized.push(attachment);
          continue;
        }
        if (!attachment.data) continue;
        if (!created) {
          await mkdir(root, { recursive: true });
          created = true;
        }
        const fileName = safeAttachmentFileName(index, attachment.name, extensionForImageMime(attachment.mimeType));
        const filePath = join(root, fileName);
        await writeFile(filePath, Buffer.from(attachment.data, 'base64'));
        materialized.push({ ...attachment, path: filePath });
        continue;
      }

      if (attachment.path) {
        materialized.push({ ...attachment, materializedFrom: attachment.materializedFrom ?? 'provided_path' });
        continue;
      }

      if (!created) {
        await mkdir(root, { recursive: true });
        created = true;
      }

      const fromOriginal = Boolean(attachment.dataBase64);
      const fileName = safeAttachmentFileName(
        index,
        attachment.name,
        fromOriginal ? extensionForFileAttachment(attachment) : '.txt',
      );
      const filePath = join(root, fileName);
      const data = attachment.dataBase64
        ? Buffer.from(attachment.dataBase64, 'base64')
        : Buffer.from(attachment.content ?? '', 'utf8');
      await writeFile(filePath, data);
      materialized.push({
        ...attachment,
        path: filePath,
        materializedFrom: fromOriginal ? 'original' : 'text_projection',
      });
    }
  } catch (error) {
    if (created) await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    attachments: materialized,
    cleanup: async () => {
      if (!created) return;
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function renderMindosRuntimeAttachmentPathContext(
  attachments: MindosRuntimeAttachment[] | undefined,
  options: { includeImages?: boolean } = {},
): string {
  const items = (attachments ?? []).filter((attachment) => {
    if (!attachment.path) return false;
    return attachment.kind === 'uploaded_file' || options.includeImages;
  });
  if (items.length === 0) return '';

  const lines = [
    '## Runtime Attachment Files',
    '',
    'The user uploaded the following original attachment files for this turn. They are available as local files while this runtime turn is running. Use these paths when you need the raw file instead of the text projection in the turn context.',
  ];

  for (const attachment of items) {
    if (attachment.kind === 'image') {
      lines.push(
        '',
        `### ${attachment.name ?? 'uploaded image'}`,
        `- path: ${attachment.path}`,
        `- type: image`,
        ...(attachment.mimeType ? [`- mime_type: ${attachment.mimeType}`] : []),
      );
      continue;
    }

    lines.push(
      '',
      `### ${attachment.name}`,
      `- path: ${attachment.path}`,
      `- type: uploaded_file`,
      ...(attachment.mimeType ? [`- mime_type: ${attachment.mimeType}`] : []),
      ...(typeof attachment.size === 'number' ? [`- size_bytes: ${attachment.size}`] : []),
      `- materialized_from: ${attachment.materializedFrom ?? 'unknown'}`,
    );
  }

  return lines.join('\n');
}

export function appendMindosRuntimeAttachmentPathContext(
  prompt: string,
  attachments: MindosRuntimeAttachment[] | undefined,
  options: { includeImages?: boolean } = {},
): string {
  const context = renderMindosRuntimeAttachmentPathContext(attachments, options);
  return context ? [prompt, '---', context].filter(Boolean).join('\n\n') : prompt;
}

export async function readMindosRuntimeImageAsBase64(attachment: MindosRuntimeImageAttachment): Promise<string | undefined> {
  if (attachment.data) return attachment.data;
  if (!attachment.path) return undefined;
  return (await readFile(attachment.path)).toString('base64');
}

function safeAttachmentFileName(index: number, name: string | undefined, fallbackExt: string): string {
  const rawName = name && name.trim() ? name : `attachment-${index}${fallbackExt}`;
  const sanitized = rawName
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const withExt = extname(sanitized) ? sanitized : `${sanitized}${fallbackExt}`;
  return `${String(index + 1).padStart(2, '0')}-${withExt}`;
}

function extensionForImageMime(mimeType: string | undefined): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/webp') return '.webp';
  return '.img';
}

function extensionForFileAttachment(attachment: MindosRuntimeUploadedFileAttachment): string {
  const fromName = extname(attachment.name);
  if (fromName) return fromName;
  if (attachment.mimeType === 'application/pdf') return '.pdf';
  if (attachment.mimeType === 'text/markdown') return '.md';
  if (attachment.mimeType === 'text/csv') return '.csv';
  if (attachment.mimeType === 'application/json') return '.json';
  if (attachment.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
  return '.dat';
}
