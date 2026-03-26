import path from 'path';
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  searchFiles, getFileContent, getFileTree, getRecentlyModified,
  saveFileContent, createFile, appendToFile, insertAfterHeading, updateSection,
  deleteFile, renameFile, moveFile, findBacklinks, gitLog, gitShowFile, appendCsvRow,
  getMindRoot,
} from '@/lib/fs';
import { readSkillContentByName, scanSkillDirs } from '@/lib/pi-integration/skills';
import { callMcporterTool, createMcporterAgentTools, listMcporterServers, listMcporterTools } from '@/lib/pi-integration/mcporter';

// Max chars per file to avoid token overflow (~100k chars ≈ ~25k tokens)
const MAX_FILE_CHARS = 20_000;

export function truncate(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  
  // Smart truncation: try to truncate at a natural boundary (newline)
  let cutoff = content.lastIndexOf('\n', MAX_FILE_CHARS);
  if (cutoff === -1) cutoff = MAX_FILE_CHARS;
  
  const totalLines = content.split('\n').length;
  
  return content.slice(0, cutoff) + `\n\n[...truncated — file is ${content.length} chars (${totalLines} lines), showing first ~${cutoff} chars]\n[Use the read_file_chunk tool to read the rest of the file by specifying start_line and end_line]`;
}

// ─── Helper: format tool error consistently ────────────────────────────────

function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Helper: build a text-only AgentToolResult ──────────────────────────────

function textResult(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: 'text', text }], details: {} as Record<string, never> };
}

/** Safe execute wrapper — catches all errors, returns error text (never throws) */
function safeExecute<T>(
  fn: (toolCallId: string, params: T, signal?: AbortSignal) => Promise<AgentToolResult<any>>,
): (toolCallId: string, params: T, signal?: AbortSignal) => Promise<AgentToolResult<any>> {
  return async (toolCallId, params, signal) => {
    try {
      return await fn(toolCallId, params, signal);
    } catch (e) {
      return textResult(`Error: ${formatToolError(e)}`);
    }
  };
}

// ─── TypeBox Schemas ────────────────────────────────────────────────────────

const ListFilesParams = Type.Object({
  path: Type.Optional(Type.String({ description: 'Optional subdirectory to list (e.g. "Projects/Products"). Omit to list everything.' })),
  depth: Type.Optional(Type.Number({ description: 'Max tree depth to expand (default 3). Directories deeper than this show item count only.', minimum: 1, maximum: 10 })),
});

const PathParam = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
});

const ReadFileChunkParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  start_line: Type.Number({ description: 'Line number to start reading from (1-indexed)' }),
  end_line: Type.Number({ description: 'Line number to stop reading at (1-indexed)' }),
});

const QueryParam = Type.Object({
  query: Type.String({ description: 'Search query (case-insensitive)' }),
});

const LimitParam = Type.Object({
  limit: Type.Optional(Type.Number({ description: 'Number of files to return (default 10)', minimum: 1, maximum: 50 })),
});

const WriteFileParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  content: Type.String({ description: 'New full content' }),
});

const CreateFileParams = Type.Object({
  path: Type.String({ description: 'Relative file path (must end in .md or .csv)' }),
  content: Type.Optional(Type.String({ description: 'Initial file content' })),
});

const BatchCreateFileParams = Type.Object({
  files: Type.Array(Type.Object({
    path: Type.String({ description: 'Relative file path (must end in .md or .csv)' }),
    content: Type.String({ description: 'Initial file content' }),
  }), { description: 'List of files to create' }),
});

const AppendParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  content: Type.String({ description: 'Content to append' }),
});

const FetchUrlParams = Type.Object({
  url: Type.String({ description: 'The HTTP/HTTPS URL to fetch' }),
});

const WebSearchParams = Type.Object({
  query: Type.String({ description: 'The search query or keywords to look up on the internet' }),
});

const InsertHeadingParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  heading: Type.String({ description: 'Heading text to find (e.g. "## Tasks" or just "Tasks")' }),
  content: Type.String({ description: 'Content to insert after the heading' }),
});

const UpdateSectionParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  heading: Type.String({ description: 'Heading text to find (e.g. "## Status")' }),
  content: Type.String({ description: 'New content for the section' }),
});

const EditLinesParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  start_line: Type.Number({ description: '1-indexed line number to start replacing' }),
  end_line: Type.Number({ description: '1-indexed line number to stop replacing (inclusive)' }),
  content: Type.String({ description: 'New content to insert in place of those lines' }),
});

const RenameParams = Type.Object({
  path: Type.String({ description: 'Current relative file path' }),
  new_name: Type.String({ description: 'New filename (no path separators, e.g. "new-name.md")' }),
});

const MoveParams = Type.Object({
  from_path: Type.String({ description: 'Current relative file path' }),
  to_path: Type.String({ description: 'New relative file path' }),
});

const HistoryParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  limit: Type.Optional(Type.Number({ description: 'Number of commits to return (default 10)', minimum: 1, maximum: 50 })),
});

const FileAtVersionParams = Type.Object({
  path: Type.String({ description: 'Relative file path' }),
  commit: Type.String({ description: 'Git commit hash (full or abbreviated)' }),
});

const CsvAppendParams = Type.Object({
  path: Type.String({ description: 'Relative path to .csv file' }),
  row: Type.Array(Type.String(), { description: 'Array of cell values for the new row' }),
});

const ListSkillsParams = Type.Object({});

const LoadSkillParams = Type.Object({
  name: Type.String({ description: 'Skill name, e.g. "mindos" or "context7"' }),
});

const ListMcpToolsParams = Type.Object({
  server: Type.Optional(Type.String({ description: 'Optional MCP server name. Omit to list discovered servers only.' })),
});

const CallMcpToolParams = Type.Object({
  server: Type.String({ description: 'MCP server name discovered via list_mcp_tools' }),
  tool: Type.String({ description: 'Exact MCP tool name to invoke' }),
  arguments_json: Type.Optional(Type.String({ description: 'Optional JSON object string of tool arguments. Example: {"query":"react hooks"}' })),
});

// ─── Tool Definitions (AgentTool interface) ─────────────────────────────────

// Write-operation tool names — used by beforeToolCall for write-protection
export const WRITE_TOOLS = new Set([
  'write_file', 'create_file', 'batch_create_files', 'append_to_file', 'insert_after_heading',
  'update_section', 'edit_lines', 'delete_file', 'rename_file', 'move_file', 'append_csv',
]);

export async function getRequestScopedTools(): Promise<AgentTool<any>[]> {
  try {
    const result = await listMcporterServers();
    const okServers = (result.servers ?? []).filter((server) => server.status === 'ok');
    if (okServers.length === 0) return knowledgeBaseTools;

    const detailedServers = await Promise.all(okServers.map(async (server) => {
      try {
        return await listMcporterTools(server.name);
      } catch {
        return server;
      }
    }));

    const dynamicMcpTools = createMcporterAgentTools(detailedServers);
    if (dynamicMcpTools.length === 0) return knowledgeBaseTools;
    return [...knowledgeBaseTools, ...dynamicMcpTools];
  } catch {
    return knowledgeBaseTools;
  }
}

export const knowledgeBaseTools: AgentTool<any>[] = [
  {
    name: 'list_files',
    label: 'List Files',
    description: 'List files in the knowledge base as an indented tree. Directories beyond `depth` show "... (N items)". Pass `path` to list only a subdirectory, or `depth` to control how deep to expand (default 3).',
    parameters: ListFilesParams,
    execute: safeExecute(async (_id, params: Static<typeof ListFilesParams>) => {
      const { path: subdir, depth: maxDepth } = params;
      const tree = getFileTree();

      if (tree.length === 0 && !subdir) {
        const root = getMindRoot();
        return textResult(`(empty — no .md or .csv files found under mind_root: ${root})`);
      }

      const limit = maxDepth ?? 3;
      const lines: string[] = [];
      function walk(nodes: Array<{ name: string; type: string; children?: unknown[] }>, depth: number) {
        for (const n of nodes) {
          lines.push('  '.repeat(depth) + (n.type === 'directory' ? `${n.name}/` : n.name));
          if (n.type === 'directory' && Array.isArray(n.children)) {
            if (depth + 1 < limit) {
              walk(n.children as typeof nodes, depth + 1);
            } else {
              lines.push('  '.repeat(depth + 1) + `... (${n.children.length} items)`);
            }
          }
        }
      }

      if (subdir) {
        const segments = subdir.replace(/\/$/, '').split('/').filter(Boolean);
        let current: Array<{ name: string; type: string; path?: string; children?: unknown[] }> = tree as any;
        for (const seg of segments) {
          const found = current.find(n => n.name === seg && n.type === 'directory');
          if (!found || !Array.isArray(found.children)) {
            return textResult(`Directory not found: ${subdir}`);
          }
          current = found.children as typeof current;
        }
        walk(current as any, 0);
      } else {
        walk(tree as any, 0);
      }

      return textResult(lines.length > 0 ? lines.join('\n') : '(empty directory)');
    }),
  },

  {
    name: 'read_file',
    label: 'Read File',
    description: 'Read the content of a file by its relative path. Always read a file before modifying it. If the file is too large, it will be truncated. Use read_file_chunk to read specific parts of large files.',
    parameters: PathParam,
    execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
      return textResult(truncate(getFileContent(params.path)));
    }),
  },

  {
    name: 'read_file_chunk',
    label: 'Read File Chunk',
    description: 'Read a specific range of lines from a file. Highly recommended for reading large files that were truncated by read_file.',
    parameters: ReadFileChunkParams,
    execute: safeExecute(async (_id, params: Static<typeof ReadFileChunkParams>) => {
      const content = getFileContent(params.path);
      const lines = content.split('\n');
      const start = Math.max(1, params.start_line);
      const end = Math.min(lines.length, params.end_line);
      
      if (start > end) {
        return textResult(`Error: start_line (${start}) is greater than end_line (${end}) or file has fewer lines.`);
      }
      
      // Prefix each line with its line number (1-indexed)
      const pad = String(lines.length).length;
      const chunk = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(pad, ' ')} | ${l}`)
        .join('\n');
        
      return textResult(`Showing lines ${start} to ${end} of ${lines.length}:\n\n${chunk}`);
    }),
  },

  {
    name: 'search',
    label: 'Search',
    description: 'Full-text search across all files in the knowledge base. Returns matching files with context snippets.',
    parameters: QueryParam,
    execute: safeExecute(async (_id, params: Static<typeof QueryParam>) => {
      const results = searchFiles(params.query);
      if (results.length === 0) return textResult('No results found.');
      return textResult(results.map(r => `- **${r.path}**: ${r.snippet}`).join('\n'));
    }),
  },

  {
    name: 'list_skills',
    label: 'List Skills',
    description: 'List available MindOS and pi-compatible skills discovered from app/data/skills, skills, {mindRoot}/.skills, .pi/skills, and ~/.pi/agent/skills. Use this before load_skill when you need a skill by name.',
    parameters: ListSkillsParams,
    execute: safeExecute(async () => {
      const projectRoot = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
      const skills = scanSkillDirs({ projectRoot, mindRoot: getMindRoot() });
      if (skills.length === 0) return textResult('No skills found.');
      return textResult(skills.map((skill) => `- **${skill.name}** [${skill.origin}]${skill.enabled ? '' : ' (disabled)'} — ${skill.description || 'No description'}\n  Path: ${skill.path}`).join('\n'));
    }),
  },

  {
    name: 'load_skill',
    label: 'Load Skill',
    description: 'Load the full content of a specific skill by name from the pi-compatible skill directories. Use list_skills first if you do not know the exact skill name.',
    parameters: LoadSkillParams,
    execute: safeExecute(async (_id, params: Static<typeof LoadSkillParams>) => {
      const projectRoot = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
      const content = readSkillContentByName(params.name, { projectRoot, mindRoot: getMindRoot() });
      if (!content) return textResult(`Skill not found: ${params.name}`);
      return textResult(truncate(content));
    }),
  },

  {
    name: 'list_mcp_tools',
    label: 'List MCP Tools',
    description: 'Inspect mcporter-managed MCP servers. Without `server`, lists discovered servers and their health. With `server`, lists that server\'s tools and JSON schemas.',
    parameters: ListMcpToolsParams,
    execute: safeExecute(async (_id, params: Static<typeof ListMcpToolsParams>) => {
      if (!params.server) {
        const result = await listMcporterServers();
        if (!result.servers || result.servers.length === 0) return textResult('No MCP servers discovered by mcporter.');
        return textResult(result.servers.map((server) => `- **${server.name}** — status: ${server.status}${server.transport ? ` | transport: ${server.transport}` : ''}${server.error ? ` | error: ${server.error}` : ''}`).join('\n'));
      }

      const server = await listMcporterTools(params.server);
      if (!server.tools || server.tools.length === 0) {
        return textResult(`No tools found for MCP server: ${params.server}`);
      }
      return textResult(server.tools.map((tool) => `## ${tool.name}\n${tool.description || 'No description'}\n\nSchema:\n${JSON.stringify(tool.inputSchema ?? {}, null, 2)}`).join('\n\n'));
    }),
  },

  {
    name: 'call_mcp_tool',
    label: 'Call MCP Tool',
    description: 'Call a specific mcporter-managed MCP tool by server and tool name. Pass `arguments_json` as a JSON object string. Use list_mcp_tools first to discover names and schemas.',
    parameters: CallMcpToolParams,
    execute: safeExecute(async (_id, params: Static<typeof CallMcpToolParams>) => {
      let parsedArgs: Record<string, unknown> = {};
      if (params.arguments_json?.trim()) {
        try {
          parsedArgs = JSON.parse(params.arguments_json) as Record<string, unknown>;
        } catch (error) {
          return textResult(`Invalid arguments_json. Expected a JSON object string. Error: ${formatToolError(error)}`);
        }
      }
      const output = await callMcporterTool(params.server, params.tool, parsedArgs);
      return textResult(output || '(empty MCP response)');
    }),
  },

  {
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the internet for up-to-date information. Uses DuckDuckGo HTML search. Returns top search results with titles, snippets, and URLs.',
    parameters: WebSearchParams,
    execute: safeExecute(async (_id, params: Static<typeof WebSearchParams>) => {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(10000)
        });
        
        if (!res.ok) {
          return textResult(`Failed to search: HTTP ${res.status}`);
        }
        
        const html = await res.text();
        const results: string[] = [];
        
        // Simple regex parsing for DuckDuckGo HTML results
        const resultBlocks = html.split('class="result__body"').slice(1);
        
        for (let i = 0; i < Math.min(resultBlocks.length, 5); i++) {
          const block = resultBlocks[i];
          
          const titleMatch = block.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
          const snippetMatch = block.match(/class="result__snippet[^>]*>([\s\S]*?)(?:<\/a>|<\/div>)/i);
          
          if (titleMatch) {
            let link = titleMatch[1];
            // Decode DuckDuckGo redirect URL if necessary
            if (link.startsWith('//duckduckgo.com/l/?uddg=')) {
              const urlParam = new URL('https:' + link).searchParams.get('uddg');
              if (urlParam) link = decodeURIComponent(urlParam);
            }
            
            // Clean up tags
            const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            
            results.push(`### ${i+1}. ${title}\n**URL:** ${link}\n**Snippet:** ${snippet}\n`);
          }
        }
        
        if (results.length === 0) {
          return textResult(`No web search results found for: ${params.query}`);
        }
        
        return textResult(`## Web Search Results for: "${params.query}"\n\n${results.join('\n')}\n\n*Note: Use web_fetch tool with any of the URLs above to read the full page content.*`);
      } catch (err) {
        return textResult(`Web search failed: ${formatToolError(err)}`);
      }
    }),
  },

  {
    name: 'web_fetch',
    label: 'Web Fetch',
    description: 'Fetch the text content of any public URL. Extracts main text from HTML and converts it to Markdown. Use this to read external docs, repos, or articles.',
    parameters: FetchUrlParams,
    execute: safeExecute(async (_id, params: Static<typeof FetchUrlParams>) => {
      let url = params.url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          },
          // Don't wait forever
          signal: AbortSignal.timeout(10000)
        });
        
        if (!res.ok) {
          return textResult(`Failed to fetch URL: HTTP ${res.status} ${res.statusText}`);
        }
        
        const contentType = res.headers.get('content-type') || '';
        
        // If it's a raw file (like raw.githubusercontent.com or a raw text file)
        if (contentType.includes('text/plain') || contentType.includes('application/json') || url.includes('raw.githubusercontent.com')) {
          const text = await res.text();
          return textResult(truncate(text));
        }
        
        // For HTML, we do a basic extraction (in a real app you might use JSDOM/Readability, but we'll do a robust regex cleanup here to avoid new dependencies)
        let html = await res.text();
        
        // Extract title if possible
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : url;
        
        // Strip out scripts, styles, svg, and headers/footers roughly
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
                   .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
                   .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
                   .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
                   .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
                   .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');

        // Convert some basic tags to markdown equivalents roughly before stripping all HTML
        html = html.replace(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/gi, '\n\n# $1\n\n')
                   .replace(/<h[3-6][^>]*>(.*?)<\/h[3-6]>/gi, '\n\n## $1\n\n')
                   .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n\n$1\n\n')
                   .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
                   .replace(/<br\s*\/?>/gi, '\n');
                   
        // Strip remaining HTML tags
        let text = html.replace(/<[^>]+>/g, ' ');
        
        // Decode common HTML entities
        text = text.replace(/&nbsp;/g, ' ')
                   .replace(/&amp;/g, ' ')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&quot;/g, '"')
                   .replace(/&#39;/g, "'");

        // Clean up whitespace: remove empty lines and extra spaces
        text = text.replace(/[ \t]+/g, ' ')
                   .replace(/\n\s*\n\s*\n/g, '\n\n')
                   .trim();
                   
        const result = `# ${title}\nSource: ${url}\n\n${text}`;
        return textResult(truncate(result));
      } catch (err) {
        return textResult(`Failed to fetch URL: ${formatToolError(err)}`);
      }
    }),
  },

  {
    name: 'get_recent',
    label: 'Recent Files',
    description: 'Get the most recently modified files in the knowledge base.',
    parameters: LimitParam,
    execute: safeExecute(async (_id, params: Static<typeof LimitParam>) => {
      const files = getRecentlyModified(params.limit ?? 10);
      return textResult(files.map(f => `- ${f.path} (${new Date(f.mtime).toISOString()})`).join('\n'));
    }),
  },

  {
    name: 'write_file',
    label: 'Write File',
    description: 'Overwrite the entire content of an existing file. Use read_file first to see current content. Prefer update_section or insert_after_heading for partial edits.',
    parameters: WriteFileParams,
    execute: safeExecute(async (_id, params: Static<typeof WriteFileParams>) => {
      saveFileContent(params.path, params.content);
      return textResult(`File written: ${params.path}`);
    }),
  },

  {
    name: 'create_file',
    label: 'Create File',
    description: 'Create a new file. Only .md and .csv files are allowed. Parent directories are created automatically.',
    parameters: CreateFileParams,
    execute: safeExecute(async (_id, params: Static<typeof CreateFileParams>) => {
      createFile(params.path, params.content ?? '');
      return textResult(`File created: ${params.path}`);
    }),
  },

  {
    name: 'batch_create_files',
    label: 'Batch Create Files',
    description: 'Create multiple new files in a single operation. Highly recommended when scaffolding new features or projects.',
    parameters: BatchCreateFileParams,
    execute: safeExecute(async (_id, params: Static<typeof BatchCreateFileParams>) => {
      const created: string[] = [];
      const errors: string[] = [];
      for (const file of params.files) {
        try {
          createFile(file.path, file.content);
          created.push(file.path);
        } catch (e) {
          errors.push(`${file.path}: ${formatToolError(e)}`);
        }
      }
      let msg = `Batch creation complete.\nCreated ${created.length} files: ${created.join(', ')}`;
      if (errors.length > 0) msg += `\n\nFailed to create ${errors.length} files:\n${errors.join('\n')}`;
      return textResult(msg);
    }),
  },

  {
    name: 'append_to_file',
    label: 'Append to File',
    description: 'Append text to the end of an existing file. A blank line separator is added automatically.',
    parameters: AppendParams,
    execute: safeExecute(async (_id, params: Static<typeof AppendParams>) => {
      appendToFile(params.path, params.content);
      return textResult(`Content appended to: ${params.path}`);
    }),
  },

  {
    name: 'insert_after_heading',
    label: 'Insert After Heading',
    description: 'Insert content right after a Markdown heading. Useful for adding items under a specific section. If heading matches fail, use edit_lines instead.',
    parameters: InsertHeadingParams,
    execute: safeExecute(async (_id, params: Static<typeof InsertHeadingParams>) => {
      insertAfterHeading(params.path, params.heading, params.content);
      return textResult(`Content inserted after heading "${params.heading}" in ${params.path}`);
    }),
  },

  {
    name: 'update_section',
    label: 'Update Section',
    description: 'Replace the content of a Markdown section identified by its heading. The section spans from the heading to the next heading of equal or higher level. If heading matches fail, use edit_lines instead.',
    parameters: UpdateSectionParams,
    execute: safeExecute(async (_id, params: Static<typeof UpdateSectionParams>) => {
      updateSection(params.path, params.heading, params.content);
      return textResult(`Section "${params.heading}" updated in ${params.path}`);
    }),
  },

  {
    name: 'edit_lines',
    label: 'Edit Lines',
    description: 'Replace a specific range of lines with new content. Extremely reliable for precise edits. You must know the exact line numbers (use read_file_chunk to get them).',
    parameters: EditLinesParams,
    execute: safeExecute(async (_id, params: Static<typeof EditLinesParams>) => {
      const { path: fp, start_line, end_line, content } = params;
      const start = Math.max(0, start_line - 1);
      const end = Math.max(0, end_line - 1);
      
      const mindRoot = getMindRoot();
      // Import the core function dynamically or it should be added to lib/fs.ts
      const { updateLines } = await import('@/lib/core');
      updateLines(mindRoot, fp, start, end, content.split('\n'));
      return textResult(`Lines ${start_line}-${end_line} replaced in ${fp}`);
    }),
  },

  {
    name: 'delete_file',
    label: 'Delete File',
    description: 'Permanently delete a file from the knowledge base. This is destructive and cannot be undone.',
    parameters: PathParam,
    execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
      deleteFile(params.path);
      return textResult(`File deleted: ${params.path}`);
    }),
  },

  {
    name: 'rename_file',
    label: 'Rename File',
    description: 'Rename a file within its current directory. Only the filename changes, not the directory.',
    parameters: RenameParams,
    execute: safeExecute(async (_id, params: Static<typeof RenameParams>) => {
      const newPath = renameFile(params.path, params.new_name);
      return textResult(`File renamed: ${params.path} → ${newPath}`);
    }),
  },

  {
    name: 'move_file',
    label: 'Move File',
    description: 'Move a file to a new location. Also returns any files that had backlinks affected by the move.',
    parameters: MoveParams,
    execute: safeExecute(async (_id, params: Static<typeof MoveParams>) => {
      const result = moveFile(params.from_path, params.to_path);
      const affected = result.affectedFiles.length > 0
        ? `\nAffected backlinks in: ${result.affectedFiles.join(', ')}`
        : '';
      return textResult(`File moved: ${params.from_path} → ${result.newPath}${affected}`);
    }),
  },

  {
    name: 'get_backlinks',
    label: 'Backlinks',
    description: 'Find all files that reference a given file path. Useful for understanding connections between notes.',
    parameters: PathParam,
    execute: safeExecute(async (_id, params: Static<typeof PathParam>) => {
      const backlinks = findBacklinks(params.path);
      if (backlinks.length === 0) return textResult(`No backlinks found for: ${params.path}`);
      return textResult(backlinks.map(b => `- **${b.source}** (L${b.line}): ${b.context}`).join('\n'));
    }),
  },

  {
    name: 'get_history',
    label: 'History',
    description: 'Get git commit history for a file. Shows recent commits that modified this file.',
    parameters: HistoryParams,
    execute: safeExecute(async (_id, params: Static<typeof HistoryParams>) => {
      const commits = gitLog(params.path, params.limit ?? 10);
      if (commits.length === 0) return textResult(`No git history found for: ${params.path}`);
      return textResult(commits.map(c => `- \`${c.hash.slice(0, 7)}\` ${c.date} — ${c.message} (${c.author})`).join('\n'));
    }),
  },

  {
    name: 'get_file_at_version',
    label: 'File at Version',
    description: 'Read the content of a file at a specific git commit. Use get_history first to find commit hashes.',
    parameters: FileAtVersionParams,
    execute: safeExecute(async (_id, params: Static<typeof FileAtVersionParams>) => {
      return textResult(truncate(gitShowFile(params.path, params.commit)));
    }),
  },

  {
    name: 'append_csv',
    label: 'Append CSV Row',
    description: 'Append a row to a CSV file. Values are automatically escaped per RFC 4180.',
    parameters: CsvAppendParams,
    execute: safeExecute(async (_id, params: Static<typeof CsvAppendParams>) => {
      const result = appendCsvRow(params.path, params.row);
      return textResult(`Row appended to ${params.path} (now ${result.newRowCount} rows)`);
    }),
  },
];
