import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ContentPageShellElement = 'div' | 'article' | 'section' | 'main';

interface ContentPageShellProps extends HTMLAttributes<HTMLElement> {
  as?: ContentPageShellElement;
  children: ReactNode;
}

export function ContentPageShell({
  as: Component = 'div',
  children,
  className,
  ...props
}: ContentPageShellProps) {
  return (
    <Component
      {...props}
      className={cn('content-width workbench-content-page px-4 py-8 md:px-6 md:py-10', className)}
    >
      {children}
    </Component>
  );
}
