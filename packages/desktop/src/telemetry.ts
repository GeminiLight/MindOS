import desktopPackage from '../package.json';

export type TelemetryValue = string | number | boolean;

export interface DesktopTelemetryEvent {
  name: string;
  ts: number;
  props?: Record<string, TelemetryValue>;
  durationMs?: number;
  appVersion: string;
  platform: string;
  arch: string;
}

const MAX_HISTORY = 200;
/**
 * `pending` is only drained by flush(), which no-ops without
 * MINDOS_TELEMETRY_ENDPOINT. Unbounded, it grew for the whole process lifetime
 * (every crash respawn, port kill and restart adds events).
 */
const MAX_PENDING = 500;

class DesktopTelemetryClient {
  private history: DesktopTelemetryEvent[] = [];
  private pending: DesktopTelemetryEvent[] = [];
  private dropped = 0;

  track(name: string, props?: Record<string, TelemetryValue>): void {
    this.record(this.makeEvent(name, props));
  }

  startTimer(name: string, baseProps?: Record<string, TelemetryValue>) {
    const start = Date.now();
    return (extraProps?: Record<string, TelemetryValue>) => {
      this.record(this.makeEvent(name, { ...(baseProps ?? {}), ...(extraProps ?? {}) }, Date.now() - start));
    };
  }

  getEvents(): DesktopTelemetryEvent[] {
    return this.history.map((event) => ({ ...event, props: event.props ? { ...event.props } : undefined }));
  }

  /** Events dropped from the pending queue because nothing flushed them. */
  getDroppedCount(): number {
    return this.dropped;
  }

  reset(): void {
    this.history = [];
    this.pending = [];
    this.dropped = 0;
  }

  async flush(): Promise<number> {
    if (this.pending.length === 0) return 0;

    const batch = this.pending.splice(0);
    const endpoint = process.env.MINDOS_TELEMETRY_ENDPOINT?.trim();
    if (!endpoint) return batch.length;

    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      return batch.length;
    } catch {
      this.pending.unshift(...batch);
      this.trimPending();
      return 0;
    }
  }

  private makeEvent(
    name: string,
    props?: Record<string, TelemetryValue>,
    durationMs?: number,
  ): DesktopTelemetryEvent {
    return {
      name,
      ts: Date.now(),
      props,
      durationMs,
      appVersion: desktopPackage.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  private record(event: DesktopTelemetryEvent): void {
    this.history.push(event);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    this.pending.push(event);
    this.trimPending();
    this.log(event);
  }

  /** Drop the oldest pending events once the queue exceeds its cap. */
  private trimPending(): void {
    if (this.pending.length <= MAX_PENDING) return;
    const excess = this.pending.length - MAX_PENDING;
    this.pending.splice(0, excess);
    this.dropped += excess;
  }

  private log(event: DesktopTelemetryEvent): void {
    if (process.env.NODE_ENV === 'production') return;
    console.debug('[telemetry]', event.name, event.props ?? '', event.durationMs ? `${event.durationMs}ms` : '');
  }
}

export const desktopTelemetry = new DesktopTelemetryClient();
