const FILES = Object.freeze({
  'mac-arm': 'MindOS-arm64.dmg', 'mac-intel': 'MindOS.dmg',
  windows: 'MindOS-Setup.exe', linux: 'MindOS.AppImage',
});
export function downloadLinks(platform) {
  if (!Object.hasOwn(FILES, platform)) return null;
  return {
    official: 'https://github.com/GeminiLight/MindOS/releases/latest/download/' + FILES[platform],
    mirror: 'https://pub-a5b6991b1e3c4068b1ec9a4106f4d116.r2.dev/desktop/latest/' + FILES[platform],
  };
}
export async function copyText(text, clipboard) {
  if (typeof text !== 'string' || !text.trim() || typeof clipboard?.writeText !== 'function') return false;
  try { await clipboard.writeText(text); return true; } catch { return false; }
}
export function releaseDetails(value) {
  if (!value || value.draft || value.prerelease || typeof value.tag_name !== 'string') return null;
  const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(value.tag_name)?.[1];
  const url = 'https://github.com/GeminiLight/MindOS/releases/tag/' + value.tag_name;
  return version && value.html_url === url ? { version, url } : null;
}
