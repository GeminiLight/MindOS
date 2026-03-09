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
      <Sidebar
        fileTree={fileTree}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      />
      <main
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
