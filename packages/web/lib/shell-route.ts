const SHELL_DATA_FREE_ROUTES = ['/login', '/setup', '/study/participate', '/study/review', '/study/longitudinal'];

export function normalizeShellPathname(pathname: string | null | undefined): string {
  const raw = pathname?.trim();
  if (!raw) return '/';
  const withoutQuery = raw.split(/[?#]/, 1)[0] || '/';
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function shouldLoadShellData(pathname: string | null | undefined): boolean {
  const normalized = normalizeShellPathname(pathname);
  return !SHELL_DATA_FREE_ROUTES.some((route) => matchesRoute(normalized, route));
}

export function shouldRenderShell(pathname: string | null | undefined): boolean {
  return shouldLoadShellData(pathname);
}
