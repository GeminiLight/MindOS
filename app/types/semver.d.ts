declare module 'semver' {
  export function gt(v1: string, v2: string): boolean;
  export function lt(v1: string, v2: string): boolean;
  export function gte(v1: string, v2: string): boolean;
  export function lte(v1: string, v2: string): boolean;
  export function eq(v1: string, v2: string): boolean;
  export function valid(v: string | null): string | null;
}
