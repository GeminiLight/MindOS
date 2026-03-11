'use client';

import { usePathname } from 'next/navigation';
import SidebarLayout from './SidebarLayout';
import { FileNode } from '@/lib/types';

interface ShellLayoutProps {
  fileTree: FileNode[];
  children: React.ReactNode;
}

export default function ShellLayout({ fileTree, children }: ShellLayoutProps) {
  const pathname = usePathname();
  if (pathname === '/login') return <>{children}</>;
  return <SidebarLayout fileTree={fileTree}>{children}</SidebarLayout>;
}
