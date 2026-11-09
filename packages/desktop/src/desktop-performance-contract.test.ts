import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { desktopTelemetry } from './telemetry';

describe('telemetry queue bounds', () => {
  beforeEach(() => desktopTelemetry.reset());
  afterEach(() => desktopTelemetry.reset());

  it('keeps the history bounded', () => {
    for (let i = 0; i < 1000; i++) desktopTelemetry.track(`event.${i}`);
    expect(desktopTelemetry.getEvents()).toHaveLength(200);
  });

  it('bounds the pending queue so an unflushed session cannot grow forever', async () => {
    // flush() is a no-op without MINDOS_TELEMETRY_ENDPOINT, and nothing in the
    // app calls it — the pending array used to grow for the whole process life.
    const previous = process.env.MINDOS_TELEMETRY_ENDPOINT;
    delete process.env.MINDOS_TELEMETRY_ENDPOINT;
    try {
      for (let i = 0; i < 5000; i++) desktopTelemetry.track(`event.${i}`);
      expect(desktopTelemetry.getDroppedCount()).toBeGreaterThan(0);
      const flushed = await desktopTelemetry.flush();
      expect(flushed).toBeLessThanOrEqual(500);
      expect(await desktopTelemetry.flush()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.MINDOS_TELEMETRY_ENDPOINT;
      else process.env.MINDOS_TELEMETRY_ENDPOINT = previous;
    }
  });

  it('reports a zero drop count on a quiet session', () => {
    desktopTelemetry.track('one');
    expect(desktopTelemetry.getDroppedCount()).toBe(0);
  });
});

describe('child process log forwarding', () => {
  const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

  it('is gated instead of echoing every Next.js request line on the UI thread', () => {
    expect(source).toContain('private shouldPipeChildOutput()');
    expect(source).toContain("process.env.MINDOS_OPEN_DEVTOOLS === '1'");
    expect(source).toContain('MINDOS_VERBOSE_CHILD_LOGS');
    const pipe = source.slice(
      source.indexOf('private pipeChildOutput('),
      source.indexOf('/** Quick check if a MindOS MCP is already listening'),
    );
    expect(pipe).toContain('if (!this.shouldPipeChildOutput())');
  });

  it('still drains stdout when forwarding is off so the child never blocks', () => {
    expect(source).toContain('proc.stdout?.resume?.()');
  });

  it('registers a single stderr listener per child', () => {
    // captureStderr + pipeChildOutput + setupCrashHandler each attached their
    // own 'data' listener, re-decoding every chunk three times.
    const crashHandler = source.slice(
      source.indexOf('private setupCrashHandler('),
      source.indexOf('// ── Stdin pipe watchdog'),
    );
    expect(crashHandler.split("proc.stderr?.on('data'").length - 1).toBe(1);
    const pipe = source.slice(
      source.indexOf('private pipeChildOutput('),
      source.indexOf('/** Quick check if a MindOS MCP is already listening'),
    );
    expect(pipe).not.toContain("proc.stderr?.on('data'");
  });
});

describe('obsidian editor state pushes', () => {
  const source = readFileSync(path.join(__dirname, 'obsidian-editor-window.ts'), 'utf-8');

  it('only pushes state from the 250ms watchdog when something changed', () => {
    expect(source).toContain('sendStateIfChanged');
    const watchdog = source
      .slice(source.indexOf('watchdog = setInterval('), source.indexOf('}, 250);'))
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(watchdog).toContain('sendStateIfChanged()');
    expect(watchdog).not.toMatch(/(?<!IfChanged)\bsendState\(\)/);
  });

  it('takes its chrome strings from the shared table rather than hardcoding Chinese', () => {
    expect(source).toContain('obsidianEditorStrings(lang)');
    expect(source).not.toContain('保存笔记');
    expect(source).not.toContain('隔离插件编辑器');
    const preload = readFileSync(path.join(__dirname, 'obsidian-editor-preload.ts'), 'utf-8');
    expect(preload).toContain('message.strings');
    expect(preload).not.toContain('未保存');
    expect(preload).not.toContain('保存冲突');
  });
});
