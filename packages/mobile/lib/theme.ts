import { StyleSheet } from 'react-native';

export const colors = {
  background: '#1a1917',
  surface: '#292524',
  surfaceMuted: '#211d1b',
  surfaceRaised: '#332d2a',
  border: '#44403c',
  borderSubtle: '#292524',
  text: '#fafaf9',
  textMuted: '#a8a29e',
  textSubtle: '#78716c',
  amber: '#c8873a',
  amberSoft: 'rgba(200, 135, 58, 0.14)',
  amberBorder: 'rgba(200, 135, 58, 0.28)',
  success: '#22c55e',
  successSoft: 'rgba(34, 197, 94, 0.12)',
  successBorder: 'rgba(34, 197, 94, 0.28)',
  warning: '#eab308',
  warningSoft: 'rgba(234, 179, 8, 0.12)',
  warningBorder: 'rgba(234, 179, 8, 0.3)',
  error: '#ef4444',
  errorText: '#fca5a5',
  errorSoft: 'rgba(239, 68, 68, 0.1)',
  errorBorder: 'rgba(239, 68, 68, 0.25)',
  white: '#ffffff',
  scrim: 'rgba(0, 0, 0, 0.55)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  sheet: 16,
};

export const typography = {
  caption: 12,
  body: 14,
  bodyLarge: 15,
  title: 16,
  section: 18,
  hero: 32,
};

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };
export const minTouchTarget = 40;
export const hairlineWidth = StyleSheet.hairlineWidth;

export const shadows = {
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 8,
  },
};
