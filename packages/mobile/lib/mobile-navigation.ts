import type { Href } from 'expo-router';

export function splitRoutePath(filePath: string): string[] {
  return filePath.split('/').filter((segment) => segment.length > 0);
}

export function viewFileHref(filePath: string): Href {
  return {
    pathname: '/view/[...path]',
    params: { path: splitRoutePath(filePath) },
  };
}

export const filesTabHref: Href = '/(tabs)/files';
