/**
 * Bundler-proof native dynamic import.
 *
 * Core dist files are consumed both natively (CLI, vitest, MCP server) and
 * inside the Next.js server bundle. Next only honors `serverExternalPackages`
 * for imports issued inside the app root — core dist lives OUTSIDE
 * packages/web, so a static (or even plain dynamic) import of a native-only
 * SDK lets webpack inline a private copy whose `import.meta` is broken. That
 * kills anything in the SDK that depends on it: jiti's
 * `createRequire(import.meta.url)` inside pi-coding-agent (→ every extension
 * entry fails to load, the session runs with no KB tools), the Claude Agent
 * SDK's CLI binary resolution, etc.
 *
 * A `new Function`-constructed import is invisible to every bundler (webpack,
 * turbopack, esbuild), so the module always executes in the real Node module
 * system with a working loader, and every consumer shares one instance.
 *
 * See wiki/known-pitfalls/02-frontend-mcp-ask-process.md ("Next.js 把 pi SDK
 * 打进 webpack bundle") for the full failure chain.
 */
export const nativeImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;
