'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const UPDATE_STATE_KEY = 'mindos_update_in_progress';
const POLL_INTERVAL = 3_000;

/**
 * Global overlay shown when MindOS update kills the server.
 * Mounted in root layout — persists across page navigations and Settings close.
 * Reads localStorage flag set by UpdateTab. Auto-reloads when server comes back.
 */
export default function UpdateOverlay() {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const { locale } = useLocale();
  const zh = locale === 'zh';

  const startPolling = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
          // Server is back — check if version changed
          try {
            const saved = localStorage.getItem(UPDATE_STATE_KEY);
            if (saved) {
              const { originalVer } = JSON.parse(saved);
              const data = await fetch('/api/update-check', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
              if (data.current && data.current !== originalVer) {
                setDone(true);
                localStorage.removeItem(UPDATE_STATE_KEY);
                localStorage.removeItem('mindos_update_latest');
                localStorage.removeItem('mindos_update_dismissed');
                setTimeout(() => window.location.reload(), 1500);
                return;
              }
            }
          } catch { /* check failed, still reload */ }
          // Server is back but version unchanged (or no saved state) — just reload
          localStorage.removeItem(UPDATE_STATE_KEY);
          window.location.reload();
        }
      } catch {
        // Still down
      }
    }, POLL_INTERVAL);
  }, []);

  // Check on mount and listen for update-started event from UpdateTab
  useEffect(() => {
    const check = () => {
      const saved = localStorage.getItem(UPDATE_STATE_KEY);
      if (saved) {
        setVisible(true);
        if (!pollRef.current) startPolling();
      }
    };

    // Check immediately (handles page reload during update)
    check();

    // Listen for same-tab update start (localStorage 'storage' event only fires cross-tab)
    const handler = () => check();
    window.addEventListener('mindos:update-started', handler);
    window.addEventListener('storage', handler); // cross-tab fallback

    return () => {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
      window.removeEventListener('mindos:update-started', handler);
      window.removeEventListener('storage', handler);
    };
  }, [startPolling]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {done ? (
        <>
          <CheckCircle2 size={32} style={{ color: 'var(--success)', marginBottom: 12 }} />
          <div style={{ color: 'var(--foreground)', fontSize: 18, fontWeight: 600 }}>
            {zh ? '更新成功！' : 'Update Complete!'}
          </div>
          <div style={{ color: 'var(--muted-foreground)', fontSize: 13, marginTop: 6 }}>
            {zh ? '正在刷新页面...' : 'Reloading...'}
          </div>
        </>
      ) : (
        <>
          <Loader2 size={32} style={{ color: 'var(--amber)', marginBottom: 12, animation: 'spin 1s linear infinite' }} />
          <div style={{ color: 'var(--foreground)', fontSize: 18, fontWeight: 600 }}>
            {zh ? 'MindOS 正在更新...' : 'MindOS is Updating...'}
          </div>
          <div style={{ color: 'var(--muted-foreground)', fontSize: 13, marginTop: 6, textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
            {zh
              ? '服务正在重启，请勿关闭此页面。完成后将自动刷新。'
              : 'The server is restarting. Please do not close this page. It will auto-reload when ready.'}
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
