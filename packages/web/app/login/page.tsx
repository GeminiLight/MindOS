'use client';

import { useState, Suspense, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Eye, EyeOff, HelpCircle, KeyRound, Loader2, Lock } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import Logo from '@/components/Logo';
import { resolveLoginMode, sanitizeLoginRedirect } from '@/lib/auth-session';

const PREVIOUS_WEB_SESSION_KEY = 'mindos:had-web-session';

function subscribeToPreviousSessionChange(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  return () => window.removeEventListener('storage', onStoreChange);
}

function getPreviousSessionSnapshot(): boolean {
  try {
    return localStorage.getItem(PREVIOUS_WEB_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function getPreviousSessionServerSnapshot(): boolean {
  return false;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const hadPreviousBrowserSession = useSyncExternalStore(
    subscribeToPreviousSessionChange,
    getPreviousSessionSnapshot,
    getPreviousSessionServerSnapshot,
  );

  const loginT = t.login;
  const safeRedirect = sanitizeLoginRedirect(searchParams.get('redirect'));
  const mode = resolveLoginMode(searchParams.get('reason'), hadPreviousBrowserSession);
  const isReauth = mode === 'reauth';
  const canSubmit = password.length > 0 && !loading;
  const submitButtonTone = canSubmit
    ? 'shadow-sm shadow-[var(--amber)]/20 hover:opacity-90'
    : 'cursor-not-allowed shadow-none';
  const submitButtonStyle = canSubmit
    ? {
        backgroundColor: 'var(--amber)',
        borderColor: 'var(--amber)',
        color: 'var(--amber-foreground)',
      }
    : {
        backgroundColor: 'var(--muted)',
        borderColor: 'var(--border)',
        color: 'var(--muted-foreground)',
      };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        try {
          localStorage.setItem(PREVIOUS_WEB_SESSION_KEY, '1');
        } catch { /* localStorage unavailable; session cookie still handles auth. */ }
        router.replace(safeRedirect);
      } else {
        setError(loginT?.incorrectPassword ?? 'Incorrect password. Please try again.');
        setPassword('');
      }
    } catch {
      setError(loginT?.connectionError ?? 'Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100dvh-var(--app-titlebar-h))] bg-background flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-[26rem]" aria-labelledby="login-title">
        <div className="mb-5 flex items-center justify-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <Logo id="login" className="h-6 w-10" />
          </span>
          <div className="min-w-0">
            <h1 id="login-title" className="font-brand text-2xl leading-tight text-foreground">
              MindOS
            </h1>
            <p className="text-xs italic text-muted-foreground/70">
              {loginT?.tagline ?? 'You think here, Agents act there'}
            </p>
          </div>
        </div>

        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-2xl shadow-black/10 sm:p-7">
          <div className="mb-5">
            <div className="inline-flex items-center gap-1.5 rounded-md bg-[var(--amber-subtle)] px-2 py-1 text-xs font-medium text-[var(--amber-text)]">
              <Lock size={12} aria-hidden />
              {isReauth
                ? (loginT?.reauthBadge ?? 'Session locked')
                : (loginT?.loginBadge ?? 'Private workspace')}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="password">
              {loginT?.passwordLabel ?? 'Password'}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={loginT?.passwordPlaceholder ?? 'Enter password'}
                autoFocus
                autoComplete="current-password"
                required
                className="h-11 w-full rounded-lg border border-border bg-background px-3 pr-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword
                  ? (loginT?.hidePassword ?? 'Hide password')
                  : (loginT?.showPassword ?? 'Show password')}
              >
                {showPassword ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert" aria-live="polite">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${submitButtonTone}`}
            style={submitButtonStyle}
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <KeyRound size={15} aria-hidden />
            )}
            {loading
              ? (loginT?.signingIn ?? 'Signing in…')
              : (isReauth
                  ? (loginT?.continueButton ?? 'Continue')
                  : (loginT?.signIn ?? 'Sign in'))}
          </button>
        </form>

          <details className="group mt-5 rounded-lg border border-border bg-background/60">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <HelpCircle size={14} aria-hidden />
              <span>{loginT?.forgotPassword ?? 'Forgot password?'}</span>
              <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-xs leading-5 text-muted-foreground">
              <p>{loginT?.forgotIntro ?? 'MindOS cannot recover this local Web password.'}</p>
              <p>{loginT?.forgotReset ?? 'On the machine running MindOS, reset it with:'}</p>
              <code className="block overflow-x-auto rounded-md border border-border bg-muted/60 px-2.5 py-2 font-mono text-[11px] text-foreground">
                mindos auth reset-web-password
              </code>
              <p>{loginT?.forgotDisable ?? 'To temporarily remove the login gate, use:'}</p>
              <code className="block overflow-x-auto rounded-md border border-border bg-muted/60 px-2.5 py-2 font-mono text-[11px] text-foreground">
                mindos config unset webPassword
              </code>
              <p>{loginT?.forgotRestart ?? 'Restart MindOS after changing the setting. If this is not your machine, ask the owner to reset it.'}</p>
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-[calc(100dvh-var(--app-titlebar-h))] bg-background flex items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--amber)]" aria-hidden />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
