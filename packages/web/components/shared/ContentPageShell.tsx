import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ContentPageShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  as?: ElementType;
}

export function ContentPageShell({
  children,
  className,
  as,
  ...props
}: ContentPageShellProps) {
  const Component = as ?? 'div';
  return (
    <Component
      {...props}
      className={cn('content-width workbench-content-page px-4 py-8 md:px-6 md:py-10', className)}
    >
      {children}
    </Component>
  );
}
