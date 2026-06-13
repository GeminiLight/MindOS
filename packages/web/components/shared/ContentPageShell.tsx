import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ContentPageShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ContentPageShell({
  children,
  className,
  ...props
}: ContentPageShellProps) {
  return (
    <div
      {...props}
      className={cn('content-width workbench-content-page px-4 py-8 md:px-6 md:py-10', className)}
    >
      {children}
    </div>
  );
}
