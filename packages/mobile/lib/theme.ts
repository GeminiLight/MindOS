import { StyleSheet } from 'react-native';

import { useColorScheme } from 'react-native';
import { darkColors, palettes, type ThemeColors } from './palette';
export type { ThemeColors } from './palette';
export const colors = darkColors;
export function useThemeColors() { return palettes[useColorScheme() === 'dark' ? 'dark' : 'light']; }
// Every row shares one stylesheet per palette instead of rebuilding a sheet per list item.
const themedCache = new WeakMap<Function, Map<ThemeColors, unknown>>();
export function useThemedStyles<T>(create: (colors: ThemeColors) => T): T & { colors: ThemeColors } {
  const colors = useThemeColors();
  let cache = themedCache.get(create);
  if (!cache) { cache = new Map(); themedCache.set(create, cache); }
  if (!cache.has(colors)) cache.set(colors, { ...create(colors), colors });
  return cache.get(colors) as T & { colors: ThemeColors };
}

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
export const minTouchTarget = 48;
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
