/** Native semantic colors. Amber ink and filled actions have separate contrast requirements. */
export const darkColors = {
  background: '#1a1917', surface: '#292524', surfaceMuted: '#211d1b', surfaceRaised: '#332d2a',
  border: '#57514b', borderSubtle: '#332d2a',
  text: '#fafaf9', textMuted: '#c2bcb6', textSubtle: '#aaa29b',
  amber: '#e2a55e', amberAction: '#9b5f22', amberSoft: 'rgba(200, 135, 58, 0.14)', amberBorder: 'rgba(200, 135, 58, 0.35)',
  success: '#5eda8a', successSoft: 'rgba(34, 197, 94, 0.12)', successBorder: 'rgba(34, 197, 94, 0.28)',
  warning: '#f2cd58', warningSoft: 'rgba(234, 179, 8, 0.12)', warningBorder: 'rgba(234, 179, 8, 0.3)',
  error: '#ff8c85', errorText: '#fca5a5', errorSoft: 'rgba(239, 68, 68, 0.1)', errorBorder: 'rgba(239, 68, 68, 0.3)',
  white: '#ffffff', scrim: 'rgba(0, 0, 0, 0.55)', black: '#000000',
};
export type ThemeColors = typeof darkColors;
export const lightColors: ThemeColors = {
  background: '#faf8f5', surface: '#ffffff', surfaceMuted: '#f1ede7', surfaceRaised: '#ffffff',
  border: '#c9c0b6', borderSubtle: '#e4ddd4',
  text: '#28231e', textMuted: '#645a50', textSubtle: '#70655a',
  amber: '#935719', amberAction: '#9b5f22', amberSoft: 'rgba(200, 135, 58, 0.1)', amberBorder: 'rgba(147, 87, 25, 0.3)',
  success: '#217346', successSoft: 'rgba(33, 115, 70, 0.08)', successBorder: 'rgba(33, 115, 70, 0.25)',
  warning: '#81600b', warningSoft: 'rgba(180, 132, 20, 0.1)', warningBorder: 'rgba(129, 96, 11, 0.3)',
  error: '#b93229', errorText: '#aa2f27', errorSoft: 'rgba(185, 50, 41, 0.07)', errorBorder: 'rgba(185, 50, 41, 0.25)',
  white: '#ffffff', scrim: 'rgba(0, 0, 0, 0.4)', black: '#000000',
};
export const palettes = { light: lightColors, dark: darkColors };
