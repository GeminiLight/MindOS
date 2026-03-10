import type { Metadata } from 'next';
import { Geist, Geist_Mono, IBM_Plex_Mono, IBM_Plex_Sans, Lora } from 'next/font/google';
import './globals.css';
import { getFileTree } from '@/lib/fs';
import SidebarLayout from '@/components/SidebarLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/lib/LocaleContext';
import ErrorBoundary from '@/components/ErrorBoundary';

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
  weight: ['400', '500', '600'],
  subsets: ['latin'],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: '--font-ibm-plex-sans',
  weight: ['300', '400', '500', '600'],
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
  icons: { icon: '/logo-square.svg' },
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
        {/* Inline script to apply user appearance settings before first paint, preventing flash */}
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
          <TooltipProvider delay={300}>
            <ErrorBoundary>
              <SidebarLayout fileTree={fileTree}>
                {children}
              </SidebarLayout>
            </ErrorBoundary>
          </TooltipProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
