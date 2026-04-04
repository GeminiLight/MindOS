'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Lock } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loginT = t.login;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const rawRedirect = searchParams.get('redirect') ?? '/';
        // Safety: only allow relative paths starting with / to prevent open redirect
        const safe = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
          ? rawRedirect
          : '/';
        router.replace(safe);
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
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-8">
        {/* Logo + title */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" width={40} height={40}>
            <defs>
              <linearGradient id="lp-grad-human" x1="35" y1="40" x2="5" y2="40" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#c8873a" stopOpacity="0.8"/>
                <stop offset="100%" stopColor="#c8873a" stopOpacity="0.3"/>
              </linearGradient>
              <linearGradient id="lp-grad-agent" x1="35" y1="40" x2="75" y2="40" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#c8873a" stopOpacity="0.8"/>
                <stop offset="100%" stopColor="#c8873a" stopOpacity="1"/>
              </linearGradient>
            </defs>
            <g transform="translate(0, 20)">
              <path d="M35,20 C25,35 8,35 8,20 C8,5 25,5 35,20" stroke="url(#lp-grad-human)" strokeWidth="3" strokeDasharray="2 4" strokeLinecap="round"/>
              <path d="M35,20 C45,2 75,2 75,20 C75,38 45,38 35,20" stroke="url(#lp-grad-agent)" strokeWidth="4.5" strokeLinecap="round"/>
              <path d="M35,17.5 Q35,20 37.5,20 Q35,20 35,22.5 Q35,20 32.5,20 Q35,20 35,17.5 Z" fill="#FEF3C7"/>
            </g>
          </svg>
          <h1 className="text-xl font-semibold text-foreground tracking-tight font-display">
            MindOS
          </h1>
          <p className="text-xs text-muted-foreground/70 italic">
            {loginT?.tagline ?? 'You think here, Agents act there.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {loginT?.subtitle ?? 'Enter your password to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="password">
              {loginT?.passwordLabel ?? 'Password'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={loginT?.passwordPlaceholder ?? 'Enter password'}
              autoFocus
              autoComplete="current-password"
              required
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert" aria-live="polite">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mt-2 bg-[var(--amber)] text-[var(--amber-foreground)]"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Lock size={14} />
            )}
            {loading
              ? (loginT?.signingIn ?? 'Signing in…')
              : (loginT?.signIn ?? 'Sign in')}
          </button>
        </form>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
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
