'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import AskFab from './AskFab';
import { FileNode } from '@/lib/types';

interface SidebarLayoutProps {
  fileTree: FileNode[];
  children: React.ReactNode;
}

export default function SidebarLayout({ fileTree, children }: SidebarLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Skip to main content — accessibility for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:font-display"
        style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
      >
        Skip to main content
      </a>
      <Sidebar
        fileTree={fileTree}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      />
      <main
        id="main-content"
        className={`min-h-screen transition-all duration-300 pt-[52px] md:pt-0 ${
          collapsed ? 'md:pl-0' : 'md:pl-[280px]'
        }`}
      >
        <div className="min-h-screen bg-background">
          {children}
        </div>
      </main>
      <AskFab />
    </>
  );
}
