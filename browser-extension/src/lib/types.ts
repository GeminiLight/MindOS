/* ── MindOS Web Clipper — Shared Types ── */

/** Stored extension configuration */
export interface ClipperConfig {
  mindosUrl: string;       // e.g. "http://localhost:3456"
  authToken: string;       // e.g. "abcd-1234-efgh-..."
  defaultSpace: string;    // e.g. "Clips"
  connected: boolean;      // last health check passed
}

/** Extracted page content before conversion */
export interface PageContent {
  title: string;
  byline: string | null;   // author
  excerpt: string | null;   // description
  content: string;          // cleaned HTML from Readability
  textContent: string;      // plain text (for word count)
  siteName: string | null;
  url: string;
  savedAt: string;          // ISO date
  wordCount: number;
}

/** Final markdown document ready to save */
export interface ClipDocument {
  fileName: string;         // sanitized filename with .md
  markdown: string;         // full document with frontmatter
  space: string;            // target space path
  wordCount: number;
}

/** MindOS space (folder) */
export interface MindOSSpace {
  name: string;
  path: string;
}

/** API response from POST /api/file or /api/inbox */
export interface FileApiResponse {
  ok?: boolean;
  error?: string;
}
