import { KNOWLEDGE_WRITE_MAX_BODY_BYTES } from '../body.js';
import { appendContentChangeToLog } from '../handlers/change-log-store.js';
import { EXTRACT_DOCX_MAX_BODY_BYTES, handleExtractDocxPost } from '../handlers/extract-docx.js';
import { EXTRACT_PDF_MAX_BODY_BYTES, handleExtractPdfPost } from '../handlers/extract-pdf.js';
import { handleFileGet, handleFilePost, handleOpenInFileManagerGet, type FilePostResponse } from '../handlers/file.js';
import { handleRawFile } from '../handlers/file-raw.js';
import { handleFiles } from '../handlers/files.js';
import { handleRecentFiles } from '../handlers/recent-files.js';
import { handleTreeVersion } from '../handlers/tree-version.js';
import { defineRoutes, type MindosRouteContext } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';

function documentExtractionServices({ services }: MindosRouteContext) {
  return {
    ...services.documentExtraction,
    runtimeRoot: services.documentExtraction?.runtimeRoot ?? services.runtimeRoot,
    env: services.documentExtraction?.env ?? process.env,
  };
}

/** Agent names end up in audit rows and change summaries: drop control characters and cap the length. */
function normalizeAgentHeader(value: string | null): string | undefined {
  const normalized = value?.replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
  return normalized || undefined;
}

/**
 * The handler writes straight to disk. Recording the content change here (not
 * in the host) keeps `/api/changes` consistent for every host, and the
 * `knowledgeWrites.onChanged` hook lets a host with its own caches refresh
 * incrementally instead of the app-level full invalidation.
 */
function recordKnowledgeWrite(services: MindosHttpServices, response: FilePostResponse, agentName: string | undefined): void {
  if (response.changeEvent) {
    try {
      appendContentChangeToLog(services.mindRoot, {
        ...response.changeEvent,
        source: response.source ?? 'user',
        agentName: response.source === 'agent' ? agentName : undefined,
      });
    } catch (error) {
      console.warn('[mindos.file] failed to append content change log:', (error as Error).message);
    }
  }
  if (response.treeChanged || response.changeEvent) {
    services.knowledgeWrites?.onChanged?.({
      treeChanged: Boolean(response.treeChanged),
      paths: response.changeEvent?.path ? [response.changeEvent.path] : [],
    });
  }
}

export const fileRoutes = defineRoutes([
  { id: 'files', method: 'GET', path: '/api/files', auth: 'required',
    handler: ({ query, services }) => handleFiles(query, services) },
  { id: 'recent-files', method: 'GET', path: '/api/recent-files', auth: 'required',
    handler: ({ query, services }) => handleRecentFiles(query, services) },
  { id: 'tree-version', method: 'GET', path: '/api/tree-version', auth: 'required',
    handler: ({ services }) => handleTreeVersion(services) },
  { id: 'file.read', method: 'GET', path: '/api/file', auth: 'required',
    handler: async ({ query, services }) => (
      query.get('op') === 'open_in_file_manager'
        ? await handleOpenInFileManagerGet(query, services)
        : handleFileGet(query, services)
    ) },
  { id: 'file.write', method: 'POST', path: '/api/file', auth: 'required',
    handler: async ({ headers, readJsonBody, services }) => {
      const agentName = normalizeAgentHeader(headers.get('x-mindos-agent'));
      const response = await handleFilePost(await readJsonBody(KNOWLEDGE_WRITE_MAX_BODY_BYTES), { mindRoot: services.mindRoot }, {
        sourceHeader: headers.get('x-mindos-source') ?? undefined,
        agentHeader: agentName,
        protectedRootFiles: services.knowledgeWrites?.protectedRootFiles,
      });
      recordKnowledgeWrite(services, response, agentName);
      return response;
    } },
  { id: 'extract-pdf', method: 'POST', path: '/api/extract-pdf', auth: 'required',
    handler: async (ctx) => handleExtractPdfPost(await ctx.readJsonBody(EXTRACT_PDF_MAX_BODY_BYTES), documentExtractionServices(ctx)) },
  { id: 'extract-docx', method: 'POST', path: '/api/extract-docx', auth: 'required',
    handler: async (ctx) => handleExtractDocxPost(await ctx.readJsonBody(EXTRACT_DOCX_MAX_BODY_BYTES), documentExtractionServices(ctx)) },
  { id: 'file.raw', method: 'GET', path: '/api/file/raw', auth: 'required',
    handler: ({ query, headers, services }) => handleRawFile(query, services, {
      range: headers.get('range') ?? undefined,
      ifNoneMatch: headers.get('if-none-match') ?? undefined,
    }) },
]);
