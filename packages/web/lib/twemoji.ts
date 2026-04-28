/**
 * Convert twemoji image markdown back to native Unicode emoji.
 * Browser extensions may replace emoji with <img src="twemoji-cdn-url">;
 * ProseMirror serializes these as ![alt](cdn.jsdelivr.net/.../CODEPOINT.svg "title")
 * where alt can be empty, the emoji character, a number like "1.00", etc.
 */
const TWEMOJI_MD_RE = /!\[[^\]]*\]\(https?:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji@[^/]+\/assets\/svg\/([a-f0-9-]+)\.svg\s*(?:"[^"]*")?\)/g;

export function twemojiToNative(markdown: string): string {
  return markdown.replace(TWEMOJI_MD_RE, (_match, codepoints: string) => {
    try {
      return String.fromCodePoint(
        ...codepoints.split('-').map((cp: string) => parseInt(cp, 16)),
      );
    } catch {
      return _match;
    }
  });
}
