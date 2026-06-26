'use client';

import { type ReactNode } from 'react';
import { WorkbenchPageShell } from '@/components/shared/ContentPageShell';

interface StudioShellProps {
  children: ReactNode;
  contentMaxWidth?: 'default' | 'full';
}

export function StudioShell({ children, contentMaxWidth = 'default' }: StudioShellProps) {
  return (
    <WorkbenchPageShell
      as="main"
      className={`studio-content-page min-h-[calc(100dvh-var(--app-titlebar-h))] bg-background ${
        contentMaxWidth === 'full' ? '[--main-body-content-max-width:100%]' : ''
      }`}
      data-content-page-shell="studio"
    >
      {children}
    </WorkbenchPageShell>
  );
}
