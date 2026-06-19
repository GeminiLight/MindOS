export type MindosServerContext = {
  runtimeRoot?: string;
  projectRoot?: string;
  env?: Record<string, string | undefined>;
  authRequired?: boolean;
};

export type MindosRequestQuery = URLSearchParams | Record<string, string | string[] | undefined>;

export function queryValue(query: MindosRequestQuery | undefined, key: string): string | undefined {
  if (!query) return undefined;
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined;
  const value = query[key];
  if (Array.isArray(value)) return value[0];
  return value;
}
