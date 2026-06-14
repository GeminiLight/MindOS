/* eslint-disable @next/next/no-img-element -- Tiny bundled SVG marks mirror AgentAvatar's local icon rendering. */
import type { PlatformDef } from '@/lib/im/platforms';

type ChannelIconSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<ChannelIconSize, { box: string; img: string; fallback: string }> = {
  sm: { box: 'h-5 w-5 rounded-sm', img: 'h-4 w-4', fallback: 'text-sm' },
  md: { box: 'h-9 w-9 rounded-md', img: 'h-6 w-6', fallback: 'text-xl' },
  lg: { box: 'h-11 w-11 rounded-lg', img: 'h-8 w-8', fallback: 'text-3xl' },
};

export function ChannelIcon({
  platform,
  size = 'md',
  className,
}: {
  platform: Pick<PlatformDef, 'name' | 'icon' | 'iconFile'>;
  size?: ChannelIconSize;
  className?: string;
}) {
  const classes = SIZE_CLASSES[size];

  if (platform.iconFile) {
    return (
      <span
        className={`${classes.box} inline-flex shrink-0 items-center justify-center border border-border bg-background/80 ${className ?? ''}`}
        title={platform.name}
      >
        <img
          src={`/channel-icons/${platform.iconFile}`}
          alt=""
          aria-hidden="true"
          className={`${classes.img} object-contain`}
        />
      </span>
    );
  }

  return (
    <span className={`${classes.fallback} ${className ?? ''} shrink-0`} suppressHydrationWarning>
      {platform.icon}
    </span>
  );
}
