import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { PlatformDef, PlatformStatus } from '@/lib/im/platforms';
import { StatusDot } from './shared';

export function ChannelHeader({ platform, status, im, purpose, isConnected }: {
  platform: PlatformDef;
  status: PlatformStatus | null;
  im: Record<string, any>;
  purpose: string;
  isConnected: boolean;
}) {
  return (
    <header className="flex items-start gap-4">
      <span className="text-3xl shrink-0 mt-0.5" suppressHydrationWarning>{platform.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 mb-1">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">{platform.name}</h2>
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-success/10 text-success">
              <StatusDot ok size={6} />
              {im.statusConnected}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {im.notConfigured}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">{purpose}</p>
        {isConnected && status?.botName && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">{status.botName}</p>
        )}
      </div>
    </header>
  );
}
