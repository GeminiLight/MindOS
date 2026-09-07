import type { Metadata } from 'next';
import './globals.css';
import { getFileTree, getMindRoot } from '@/lib/fs';
import { listMindSystemSlots, type MindSystemSlot } from '@/lib/mind-system';
import ShellLayout from '@/components/ShellLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import LocaleStoreInit from '@/lib/stores/LocaleStoreInit';
import ErrorBoundary from '@/components/ErrorBoundary';
import Toaster from '@/components/ui/Toaster';
import RegisterSW from './register-sw';
import UpdateOverlay from '@/components/UpdateOverlay';
import UpdateToast from '@/components/UpdateToast';
import { cookies, headers } from 'next/headers';
import { createHash } from 'crypto';
import type { Locale } from '@/lib/i18n';
import { shouldLoadShellData } from '@/lib/shell-route';
import '@/lib/renderers/index'; // globally register built-in renderers once

export const metadata: Metadata = {
  title: 'MindOS',
  description: 'Personal knowledge base',
  icons: { icon: '/logo-square.svg', apple: '/icons/icon-192.png' },
  manifest: '/manifest.json',
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let fileTree: import('@/lib/types').FileNode[] = [];
  let mindSystemSlots: MindSystemSlot[] = [];
  // Workspace-tab sets are namespaced per mind root (spec-titlebar-row Phase 2):
  // a stable opaque id keeps vault-relative doc keys from leaking across roots.
  let mindRootId = 'default';
  const headerStore = await headers();
  const pathname = headerStore.get('x-pathname');
  const studyPage = /^\/study\/(?:participate|review|longitudinal)\//.test(pathname ?? '');
  if (shouldLoadShellData(pathname)) {
    try {
      fileTree = getFileTree();
      const mindRoot = getMindRoot();
      mindSystemSlots = listMindSystemSlots(mindRoot);
      mindRootId = createHash('sha256').update(mindRoot).digest('hex').slice(0, 12);
    } catch (err) {
      console.error('[RootLayout] Failed to load file tree:', err);
    }
  }

  // Read locale from cookie, or infer from Accept-Language header
  // This matches the client pre-hydration script logic: 
  // localStorage > system language preference (via Accept-Language)
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value;
  let ssrLocale: Locale = 'en';
  if (cookieLocale === 'zh') {
    ssrLocale = 'zh';
  } else if (cookieLocale !== 'en') {
    // Cookie not set or invalid — infer from Accept-Language header
    // (matches client: navigator.language.startsWith('zh') ? 'zh' : 'en')
    const acceptLanguage = headerStore.get('Accept-Language') || '';
    ssrLocale = acceptLanguage.includes('zh') ? 'zh' : 'en';
  }

  return (
    <html lang={ssrLocale} suppressHydrationWarning data-mind-root-id={mindRootId} style={{ backgroundColor: '#f8f6f1', color: '#1c1a17' }}>
      <head>
        <meta name="theme-color" content="#c8873a" />
        {/* Patch Node.removeChild/insertBefore to swallow errors caused by browser
            extensions (translators, Grammarly, twemoji, etc.) that mutate the DOM between
            SSR and hydration. See: https://github.com/facebook/react/issues/17256 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=='undefined'){var o=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(c.parentNode!==this){try{return o.call(c.parentNode,c)}catch(e){return c}}return o.call(this,c)};var i=Node.prototype.insertBefore;Node.prototype.insertBefore=function(n,r){if(r&&r.parentNode!==this){try{return i.call(r.parentNode,n,r)}catch(e){return i.call(this,n,null)}}return i.call(this,n,r)}}})();`,
          }}
        />
        {/* Electron macOS: set data-electron-mac before first paint so sidebar clears traffic lights.
            data-mac-titlebar-row only when the shell declares the capability (new shells, preload mindosShell) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(/electron/i.test(navigator.userAgent)&&/macintosh/i.test(navigator.userAgent)){document.documentElement.setAttribute('data-electron-mac','')}if(window.mindosShell&&window.mindosShell.macTitlebarRow){document.documentElement.setAttribute('data-mac-titlebar-row','')}}catch(e){}})();`,
          }}
        />
        {/* Apply user appearance settings before first paint, preventing flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var dark=s&&s!=='system'?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);document.documentElement.style.backgroundColor=dark?'#131210':'#f8f6f1';document.documentElement.style.color=dark?'#e8e4dc':'#1c1a17';var cw=localStorage.getItem('content-width');if(cw)document.documentElement.style.setProperty('--content-width-override',cw);var pf=localStorage.getItem('prose-font');if(!pf){pf='inter';localStorage.setItem('prose-font','inter')}if(pf==='geist'){pf='inter';localStorage.setItem('prose-font','inter')}var fm={lora:'"Lora", Georgia, serif','ibm-plex-sans':'"IBM Plex Sans", sans-serif',inter:'var(--font-inter), sans-serif','ibm-plex-mono':'"IBM Plex Mono", monospace'};if(pf&&fm[pf])document.documentElement.style.setProperty('--prose-font-override',fm[pf]);var loc=localStorage.getItem('locale')||'system';var rl=loc==='system'?(navigator.language.startsWith('zh')?'zh':'en'):loc;window.__mindos_locale__=rl;document.documentElement.lang=rl==='zh'?'zh':'en';document.cookie='locale='+rl+';path=/;max-age=31536000;SameSite=Lax'}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className="antialiased bg-background text-foreground"
        suppressHydrationWarning
      >
        <LocaleStoreInit ssrLocale={ssrLocale} />
          <TooltipProvider delay={300}>
            <ErrorBoundary>
              <ShellLayout fileTree={fileTree} mindSystemSlots={mindSystemSlots}>
                {children}
              </ShellLayout>
            </ErrorBoundary>
          </TooltipProvider>
        {!studyPage ? <><Toaster /><RegisterSW /><UpdateOverlay /><UpdateToast /></> : null}
      </body>
    </html>
  );
}
