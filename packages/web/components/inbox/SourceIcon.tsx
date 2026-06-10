'use client';

import { useMemo, useState } from 'react';
import { Globe2 } from 'lucide-react';
import {
  detectSourcePlatform,
  getSourcePlatformDefinition,
  normalizeSourceHostname,
  type SourcePlatformDefinition,
} from '@/lib/link-preview/source-platforms';

export interface InboxSourceMetadata {
  kind?: string;
  url?: string;
  domain?: string;
  siteName?: string;
  platform?: string;
  platformLabel?: string;
  title?: string;
}

type SourceIconSize = 'xs' | 'sm' | 'md';

const SIZE_CLASS: Record<SourceIconSize, string> = {
  xs: 'h-4 w-4 text-[9px]',
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-7 w-7 text-xs',
};

function resolvePlatform(source?: InboxSourceMetadata | null, url?: string): SourcePlatformDefinition | null {
  return getSourcePlatformDefinition(source?.platform)
    ?? detectSourcePlatform(source?.url)
    ?? detectSourcePlatform(url)
    ?? detectSourcePlatform(source?.domain)
    ?? detectSourcePlatform(source?.siteName);
}

export function getInboxSourceLabel(source?: InboxSourceMetadata | null, url?: string): string | null {
  const platform = resolvePlatform(source, url);
  if (platform) return platform.label;
  if (source?.platformLabel) return source.platformLabel;
  if (source?.siteName) return source.siteName;
  return normalizeSourceHostname(source?.domain ?? source?.url ?? url);
}

export function SourceIcon({
  source,
  url,
  size = 'md',
  className = '',
}: {
  source?: InboxSourceMetadata | null;
  url?: string;
  size?: SourceIconSize;
  className?: string;
}) {
  const platform = useMemo(() => resolvePlatform(source, url), [source, url]);
  const label = getInboxSourceLabel(source, url) ?? 'Web source';
  const fallback = platform?.fallback ?? label.slice(0, 2).toUpperCase();
  const iconPath = platform?.iconPath;
  const [failedIconPath, setFailedIconPath] = useState<string | null>(null);
  const showImage = Boolean(iconPath && failedIconPath !== iconPath);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/55 bg-background text-muted-foreground shadow-sm shadow-black/[0.02] ${SIZE_CLASS[size]} ${className}`}
      title={label}
      aria-label={`${label} source`}
    >
      {iconPath && showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconPath}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain"
          onError={() => setFailedIconPath(iconPath)}
        />
      ) : platform || label !== 'Web source' ? (
        <span className="font-semibold leading-none text-muted-foreground/80">{fallback}</span>
      ) : (
        <Globe2 size={size === 'md' ? 14 : 11} className="text-muted-foreground/60" aria-hidden="true" />
      )}
    </span>
  );
}
