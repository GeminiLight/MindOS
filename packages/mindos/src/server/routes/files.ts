import { EXTRACT_DOCX_MAX_BODY_BYTES, handleExtractDocxPost } from '../handlers/extract-docx.js';
import { EXTRACT_PDF_MAX_BODY_BYTES, handleExtractPdfPost } from '../handlers/extract-pdf.js';
import { handleFileGet, handleFilePost, handleOpenInFileManagerGet } from '../handlers/file.js';
import { handleRawFile } from '../handlers/file-raw.js';
import { handleFiles } from '../handlers/files.js';
import { handleRecentFiles } from '../handlers/recent-files.js';
import { handleTreeVersion } from '../handlers/tree-version.js';
import { defineRoutes, type MindosRouteContext } from '../route-table.js';

function documentExtractionServices({ services }: MindosRouteContext) {
  return {
    ...services.documentExtraction,
    runtimeRoot: services.documentExtraction?.runtimeRoot ?? services.runtimeRoot,
    env: services.documentExtraction?.env ?? process.env,
  };
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
    handler: async ({ headers, readJsonBody, services }) => handleFilePost(await readJsonBody(), { mindRoot: services.mindRoot }, {
      sourceHeader: headers.get('x-mindos-source') ?? undefined,
      agentHeader: headers.get('x-mindos-agent') ?? undefined,
    }) },
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
