/**
 * Copy text to clipboard with fallback for non-HTTPS environments.
 * Returns true if successful.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern Clipboard API (requires HTTPS or localhost)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* falls through to fallback */ }
  }
  // Fallback: textarea + execCommand (works over HTTP).
  // execCommand('copy') is deprecated but remains the only option for
  // non-secure contexts. No replacement exists yet — monitor browser support.
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
