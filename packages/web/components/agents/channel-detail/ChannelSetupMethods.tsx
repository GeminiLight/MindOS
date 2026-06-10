import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink, ScanLine } from 'lucide-react';
import type { PlatformDef, PlatformSetupMethod } from '@/lib/im/platforms';

export function ChannelSetupMethods({ platform, im, locale }: {
  platform: PlatformDef;
  im: Record<string, any>;
  locale: string;
}) {
  const methods = platform.setupMethods ?? [];
  if (methods.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <ScanLine size={15} className="text-[var(--amber)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground tracking-tight">{im.setupMethodsTitle}</h3>
      </div>
      <div className="divide-y divide-border/70 rounded-md border border-border/70 bg-background">
        {methods.map((method) => (
          <SetupMethodRow key={method.id} method={method} im={im} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function SetupMethodRow({ method, im, locale }: {
  method: PlatformSetupMethod;
  im: Record<string, any>;
  locale: string;
}) {
  const [copied, setCopied] = useState(false);
  const title = localize(locale, method.title, method.titleZh);
  const description = localize(locale, method.description, method.descriptionZh);
  const actionLabel = localize(locale, method.actionLabel, method.actionLabelZh) || im.openSetupLink;
  const availability = getAvailabilityLabel(method.availability, im);
  const canOpen = Boolean(method.href);

  const handleCopy = async () => {
    if (!method.href || typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(method.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">{title}</h4>
            {method.recommended && (
              <span className="rounded-full bg-[var(--amber)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--amber)]">
                {im.recommended}
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {availability}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:flex-wrap sm:items-center">
          {canOpen && (
            <Link
              href={method.href as string}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto"
            >
              <ExternalLink size={12} aria-hidden="true" />
              {actionLabel}
            </Link>
          )}
          {canOpen && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto"
              aria-label={im.copySetupLink}
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? im.copied : im.copyLink}
            </button>
          )}
        </div>
      </div>

      {method.qr && method.href && (
        <div className="mt-3 flex flex-col items-start gap-3 rounded-md bg-muted/30 p-3 sm:flex-row">
          <QrPreview value={method.href} alt={im.setupQrAlt?.(title) ?? `${title} QR`} />
          <p className="text-xs leading-relaxed text-muted-foreground">{im.scanQrHint}</p>
        </div>
      )}
    </div>
  );
}

function QrPreview({ value, alt }: { value: string; alt: string }) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [failed, setFailed] = useState(false);
  const stableValue = useMemo(() => value, [value]);

  useEffect(() => {
    let cancelled = false;
    setDataUrl('');
    setFailed(false);
    void import('qrcode')
      .then((QRCodeModule) => {
        type QrGenerator = {
          toDataURL: (text: string, options: { width: number; margin: number }) => Promise<string>;
        };
        const qrModule = QRCodeModule as Partial<QrGenerator> & { default?: Partial<QrGenerator> };
        const generator = qrModule.toDataURL ? qrModule : qrModule.default;
        if (!generator?.toDataURL) throw new Error('QR generator unavailable');
        return generator.toDataURL(stableValue, { width: 96, margin: 1 });
      })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [stableValue]);

  if (failed) {
    return (
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[10px] font-medium text-muted-foreground"
        aria-label={alt}
        data-testid="setup-qr-fallback"
      >
        QR
      </div>
    );
  }

  if (!dataUrl) {
    return <div className="h-16 w-16 shrink-0 animate-pulse rounded-md border border-border bg-muted/40" aria-hidden="true" data-testid="setup-qr-loading" />;
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className="h-16 w-16 shrink-0 rounded-md border border-border bg-background p-1"
      data-testid="setup-qr-image"
    />
  );
}

function localize(locale: string, en?: string, zh?: string): string {
  return locale === 'zh' ? (zh ?? en ?? '') : (en ?? zh ?? '');
}

function getAvailabilityLabel(availability: PlatformSetupMethod['availability'], im: Record<string, any>): string {
  switch (availability) {
    case 'available':
      return im.setupAvailable;
    case 'after_credentials':
      return im.setupAfterCredentials;
    case 'planned':
      return im.setupPlanned;
    case 'manual_only':
    default:
      return im.setupManualOnly;
  }
}
