import type { Metadata } from 'next';
import { Geist, Geist_Mono, IBM_Plex_Mono, IBM_Plex_Sans, Lora } from 'next/font/google';
import './globals.css';
import { getFileTree } from '@/lib/fs';
import ShellLayout from '@/components/ShellLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/lib/LocaleContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import RegisterSW from './register-sw';
import UpdateBanner from '@/components/UpdateBanner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  weight: ['400', '600'],
  subsets: ['latin'],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: '--font-ibm-plex-sans',
  weight: ['400', '500', '600'],
  subsets: ['latin'],
});

const lora = Lora({
  variable: '--font-lora',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let fileTree: import('@/lib/types').FileNode[] = [];
  try {
    fileTree = getFileTree();
  } catch (err) {
    console.error('[RootLayout] Failed to load file tree:', err);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#c8871e" />
        {/* Patch Node.removeChild/insertBefore to swallow errors caused by browser
            extensions (translators, Grammarly, etc.) that mutate the DOM between SSR
            and hydration. See: https://github.com/facebook/react/issues/17256 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=='undefined'){var o=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(c.parentNode!==this){try{return o.call(c.parentNode,c)}catch(e){return c}}return o.call(this,c)};var i=Node.prototype.insertBefore;Node.prototype.insertBefore=function(n,r){if(r&&r.parentNode!==this){try{return i.call(r.parentNode,n,r)}catch(e){return i.call(this,n,null)}}return i.call(this,n,r)}}})();`,
          }}
        />
        {/* Apply user appearance settings before first paint, preventing flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var dark=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);var cw=localStorage.getItem('content-width');if(cw)document.documentElement.style.setProperty('--content-width-override',cw);var pf=localStorage.getItem('prose-font');var fm={lora:'"Lora", Georgia, serif','ibm-plex-sans':'"IBM Plex Sans", sans-serif',geist:'var(--font-geist-sans), sans-serif','ibm-plex-mono':'"IBM Plex Mono", monospace'};if(pf&&fm[pf])document.documentElement.style.setProperty('--prose-font-override',fm[pf]);}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable} ${lora.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        <LocaleProvider>
          <UpdateBanner />
          <TooltipProvider delay={300}>
            <ErrorBoundary>
              <ShellLayout fileTree={fileTree}>
                {children}
              </ShellLayout>
            </ErrorBoundary>
          </TooltipProvider>
          <RegisterSW />
        </LocaleProvider>
      </body>
    </html>
  );
}
