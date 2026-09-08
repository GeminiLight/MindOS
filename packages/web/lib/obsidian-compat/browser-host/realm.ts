/** Not an authorization boundary: Desktop owns the session, CSP and network policy.
 * This guard prevents installing Obsidian's DOM globals on the application page.
 */
export function assertIsolatedPluginRealm(): void {
  if (window.parent === window || (window.origin !== 'null'
    && !/^https:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.obsidian\.mindos\.invalid$/.test(window.origin))) {
    throw new Error('An isolated plugin frame is required.');
  }
  try { void window.parent.document; } catch { return; }
  throw new Error('Plugin frames must not share the parent document origin.');
}
