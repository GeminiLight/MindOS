/**
 * Image path resolution utilities for Markdown.
 *
 * Converts markdown image paths (e.g., `![alt](/.media/image.png)`) to API URLs
 * that can be served by `/api/file/raw?path=...`
 */

/**
 * Checks if a path is an absolute path (starts with `/`).
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/');
}

/**
 * Checks if a path is a URL (starts with protocol like http://, https://, file://).
 */
function isUrl(path: string): boolean {
  return /^(https?|file):\/\//.test(path);
}

/**
 * Resolves an image path to a URL for the API endpoint.
 *
 * Rules:
 * - Absolute paths (start with `/`) → `/api/file/raw?path=...` (strip leading slash)
 * - URLs (http/https/file) → return as-is
 * - Relative paths → return as-is (browser handles relative URLs)
 *
 * @param imagePath - The image path from markdown syntax
 * @returns The resolved URL or path
 */
export function resolveImagePath(imagePath: string): string {
  // Already a URL
  if (isUrl(imagePath)) {
    return imagePath;
  }

  // Absolute path like `/.media/image.png` or `/path/to/image.png`
  if (isAbsolutePath(imagePath)) {
    const cleanPath = imagePath.slice(1); // Remove leading `/`
    return `/api/file/raw?path=${encodeURIComponent(cleanPath)}`;
  }

  // Relative path — return as-is for browser to resolve
  return imagePath;
}
