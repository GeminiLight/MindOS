import { expect, it } from 'vitest';
import { palettes } from '@/lib/palette';
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
for (const scheme of ['light', 'dark'] as const) {
  it(`${scheme} keeps text and primary actions legible`, () => {
    const c = palettes[scheme];
    for (const text of [c.text, c.textMuted, c.textSubtle, c.amber]) for (const background of [c.background, c.surface]) expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.white, c.amberAction)).toBeGreaterThanOrEqual(4.5);
  });
}
