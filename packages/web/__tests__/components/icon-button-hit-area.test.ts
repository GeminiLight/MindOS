import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('icon button hit areas', () => {
  it('defines rectangular hit targets for visually rounded controls', () => {
    const source = readSource('app/globals.css');

    expect(source).toContain('.hit-target-box');
    expect(source).toContain('border-radius: 0 !important;');
    expect(source).toContain('.hit-target-box:not(.absolute):not(.fixed):not(.sticky)');
    expect(source).toContain('.hit-target-box::before');
    expect(source).toContain('border-radius: var(--hit-target-radius, var(--radius-md));');
    expect(source).toContain('--hit-target-border-width');
    expect(source).toContain('--hit-target-outline-width');
    expect(source).toContain('--hit-target-hover-outline');
    expect(source).toContain('--hit-target-shadow');
  });

  it('keeps breadcrumb links large enough to click across the full visual target', () => {
    const source = readSource('components/Breadcrumb.tsx');

    expect(source).toContain('hit-target-box inline-flex h-8 w-8');
    expect(source).toContain('hit-target-box inline-flex min-h-8');
    expect(source).toContain('inline-flex h-8 w-8');
    expect(source).toContain('inline-flex min-h-8');
    expect(source).toContain('focus-visible:ring-2 focus-visible:ring-ring touch-manipulation');
  });

  it('keeps markdown header controls on stable full-button hit targets', () => {
    const source = readSource('app/view/[...path]/ViewPageClient.tsx');

    expect(source).toContain('inline-flex h-8 min-w-8');
    expect(source).toContain('inline-flex h-8 w-8');
    expect(source).toContain('hover:bg-card/60 hover:text-foreground');
    expect(source).toContain('transition-colors duration-75');
    expect(source).not.toContain('className={`flex items-center gap-1 px-2 py-1 rounded text-[11px]');
  });

  it('keeps side panel header tool buttons on full 32px hit targets', () => {
    const panelHeaderSource = readSource('components/panels/PanelHeader.tsx');
    const filesPanelSource = readSource('components/Panel.tsx');
    const agentsPanelSource = readSource('components/panels/AgentsPanel.tsx');

    expect(panelHeaderSource).toContain('flex h-[46px] shrink-0 items-center');
    expect(panelHeaderSource).not.toContain('px-4 py-3 h-[46px]');
    expect(panelHeaderSource).toContain('hit-target-box inline-flex h-8 w-8');
    expect(panelHeaderSource).not.toContain('className="p-1 rounded hover:bg-muted');

    expect(filesPanelSource).toContain('hit-target-box inline-flex h-8 w-8');
    expect(filesPanelSource).toContain('[--hit-target-radius:0px]');
    expect(filesPanelSource).not.toContain('className="p-1 rounded hover:bg-muted');
    expect(filesPanelSource).not.toContain('hover:bg-muted transition-colors text-left');

    expect(agentsPanelSource).toContain('hit-target-box inline-flex h-8 w-8');
    expect(agentsPanelSource).not.toContain('className="p-1 rounded hover:bg-muted');
  });

  it('keeps built-in Mind System sidebar controls on rectangular hit targets', () => {
    const source = readSource('components/Panel.tsx');

    expect(source).toContain('data-hit-active={collapsed ? undefined : \'true\'}');
    expect(source).toContain('hit-target-box mb-1 flex w-full items-center gap-2');
    expect(source).toContain('data-mind-system-sidebar-open={item.key}');
    expect(source).toContain('hit-target-box flex w-full min-w-0 items-center gap-2');
  });

  it('keeps file tree row controls on stable hit targets', () => {
    const source = readSource('components/FileTree.tsx');

    expect(source).toContain('type="button"');
    expect(source).toContain('hit-target-box inline-flex h-7 w-7 shrink-0 items-center justify-center');
    expect(source).toContain('hit-target-box inline-flex h-7 w-7 items-center justify-center');
    expect(source).toContain('hit-target-box flex-1 flex min-h-7 items-center');
    expect(source).toContain('hit-target-box w-full flex min-h-7 items-center');
    expect(source).toContain('focus-visible:ring-2 focus-visible:ring-ring touch-manipulation');
    expect(source).not.toContain('className="shrink-0 p-1 rounded hover:bg-muted');
    expect(source).not.toContain('className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"');
  });

  it('keeps rail navigation using rectangular hit targets despite rounded visuals', () => {
    const source = readSource('components/ActivityBar.tsx');

    expect(source).toContain('hit-target-box relative flex items-center');
    expect(source).toContain('hit-target-box');
    expect(source).toContain('[--hit-target-radius:9999px]');
    expect(source).toContain("'data-hit-active': active ? 'true' : undefined");
    expect(source).not.toContain("hover:bg-muted'");
    expect(source).not.toContain("bg-[var(--amber-dim)]'");
  });

  it('keeps ask header runtime controls on rectangular hit targets', () => {
    const headerSource = readSource('components/ask/AskHeader.tsx');
    const runtimeSource = readSource('components/ask/RuntimeIconSwitcher.tsx');
    const saveSource = readSource('components/ask/SaveSessionInline.tsx');
    const contentSource = readSource('components/ask/AskContent.tsx');
    const modeSource = readSource('components/ask/ModeCapsule.tsx');
    const providerSource = readSource('components/ask/ProviderModelCapsule.tsx');

    expect(headerSource).toContain('const headerButtonClass = \'hit-target-box');
    expect(headerSource).toContain('data-hit-active={showHistory ? \'true\' : undefined}');
    expect(headerSource).toContain('hit-target-box inline-flex items-center gap-1 border border-transparent');
    expect(headerSource).toContain('hit-target-box inline-flex h-7 w-7 items-center justify-center');
    expect(headerSource).not.toContain('rounded-md transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${s.pinned');
    expect(runtimeSource).toContain('hit-target-box group/runtime');
    expect(runtimeSource).toContain('data-hit-active={open ? \'true\' : undefined}');
    expect(saveSource).toContain('hit-target-box relative z-10 h-9 w-9');
    expect(contentSource).toContain('hit-target-box p-2 text-muted-foreground');
    expect(contentSource).toContain('hit-target-box p-2 disabled:opacity-20');
    expect(contentSource).toContain('hit-target-box flex w-full items-center gap-2.5 px-3 py-2');
    expect(modeSource).toContain('hit-target-box relative z-10 inline-flex min-h-6');
    expect(providerSource).toContain('hit-target-box relative z-10 inline-flex min-h-6');
  });

  it('keeps wiki home quick links and space cards on rectangular hit targets', () => {
    const source = readSource('components/WikiHomeContent.tsx');
    const homeSource = readSource('components/HomeContent.tsx');
    const inboxSource = readSource('components/home/InboxSection.tsx');
    const changesSource = readSource('components/changes/ChangesBanner.tsx');
    const fabSource = readSource('components/AskFab.tsx');
    const syncSource = readSource('components/SyncStatusBar.tsx');

    expect(source).toContain('hit-target-box flex-1 flex items-center gap-3');
    expect(source).toContain('hit-target-box inline-flex items-center gap-2 px-4 py-2.5');
    expect(source).toContain('hit-target-box inline-flex items-center gap-2 px-3.5 py-2');
    expect(source).toContain('hit-target-box border-transparent hover:-translate-y-0.5');
    expect(homeSource).toContain('hit-target-box flex items-center gap-1.5 px-4 py-2');
    expect(inboxSource).toContain('hit-target-box flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-2 py-1');
    expect(inboxSource).toContain('hit-target-box flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] px-2.5 py-1');
    expect(inboxSource).toContain('hit-target-box group flex items-center gap-3');
    expect(changesSource).toContain('hit-target-box inline-flex items-center px-2.5 py-1');
    expect(fabSource).toContain('hit-target-box');
    expect(syncSource).toContain('hit-target-box flex min-h-7');
  });

  it('keeps directory header controls on rectangular hit targets', () => {
    const source = readSource('components/DirView.tsx');

    expect(source).toContain('hit-target-box flex items-center gap-1.5 px-2.5 py-1.5');
    expect(source).toContain('data-hit-active={view === \'grid\' ? \'true\' : undefined}');
    expect(source).toContain('data-hit-active={view === \'list\' ? \'true\' : undefined}');
  });

  it('keeps chat hover actions responsive and clickable beyond the icon glyph', () => {
    const actionsSource = readSource('components/ask/UserMessageActions.tsx');
    const messageListSource = readSource('components/ask/MessageList.tsx');
    const saveSource = readSource('components/ask/SaveSessionInline.tsx');
    const historyPanelSource = readSource('components/ask/SessionHistoryPanel.tsx');
    const historySource = readSource('components/ask/SessionHistory.tsx');
    const saveInsightSource = readSource('components/ask/SaveInsightInline.tsx');
    const providerCapsuleSource = readSource('components/ask/ProviderModelCapsule.tsx');

    for (const source of [
      actionsSource,
      messageListSource,
      saveSource,
      historyPanelSource,
      historySource,
      saveInsightSource,
      providerCapsuleSource,
    ]) {
      expect(source).toContain('inline-flex h-7 w-7');
      expect(source).toContain('focus-visible:ring-2 focus-visible:ring-ring');
    }
    expect(actionsSource).toContain('md:focus-within:opacity-100');
    expect(actionsSource).toContain('const btnBase = \'hit-target-box');
    expect(actionsSource).toContain('[--hit-target-hover-bg:var(--muted)]');
    expect(actionsSource).toContain('[--hit-target-hover-bg:color-mix(in_srgb,var(--amber)_10%,transparent)]');
    expect(messageListSource).toContain('md:focus-within:opacity-100');
    expect(messageListSource).toContain('hit-target-box group/sug');
    expect(messageListSource).toContain('hover:bg-muted hover:text-foreground');
    expect(saveInsightSource).toContain('hit-target-box inline-flex h-7 w-7');
    expect(saveInsightSource).toContain('[--hit-target-hover-border:color-mix(in_srgb,var(--amber)_30%,transparent)]');
    expect(saveSource).toContain('hover:bg-[var(--amber)]/10 hover:text-[var(--amber)]');
  });

  it('keeps floating utilities and modal buttons on rectangular hit targets', () => {
    const markdownSource = readSource('components/MarkdownView.tsx');
    const findSource = readSource('components/FindInPage.tsx');
    const syncPopoverSource = readSource('components/panels/SyncPopover.tsx');
    const createSpaceSource = readSource('components/CreateSpaceModal.tsx');
    const exportSource = readSource('components/ExportModal.tsx');
    const importSource = readSource('components/ImportModal.tsx');
    const dirPickerSource = readSource('components/DirPicker.tsx');
    const workflowsSource = readSource('components/panels/WorkflowsPanel.tsx');

    expect(markdownSource).toContain('hit-target-box inline-flex h-8 w-8');
    expect(markdownSource).toContain('hit-target-box inline-flex h-7 w-7');
    expect(findSource).toContain('hit-target-box p-1 text-muted-foreground');
    expect(syncPopoverSource).toContain('hit-target-box inline-flex h-8 w-8');
    expect(syncPopoverSource).toContain('hit-target-box inline-flex min-h-9');
    expect(createSpaceSource).toContain('hit-target-box px-4 py-2 text-sm font-medium');
    expect(exportSource).toContain('hit-target-box flex items-start gap-3 p-3');
    expect(importSource).toContain('hit-target-box transition-all duration-200 cursor-pointer');
    expect(importSource).toContain('[--hit-target-outline-style:dashed]');
    expect(importSource).toContain('hit-target-box flex flex-col items-center gap-2 p-4');
    expect(dirPickerSource).toContain('data-hit-active={expanded ? \'true\' : undefined}');
    expect(dirPickerSource).toContain('hit-target-box w-full flex items-center gap-2 px-3 py-2');
    expect(dirPickerSource).toContain('hit-target-box w-full flex items-center gap-2 px-3 py-1.5');
    expect(workflowsSource).toContain('hit-target-box flex-1 px-3 py-1.5 text-xs');
    expect(workflowsSource).toContain('hit-target-box flex items-start gap-2.5 px-3 py-2 mx-1');
  });

  it('does not make chat action tooltips feel delayed during fast pointer scans', () => {
    const source = readSource('components/ask/ActionTooltip.tsx');

    expect(source).toContain('delay = 140');
    expect(source).toContain('onPointerEnter={handleEnter}');
    expect(source).toContain('onPointerLeave={handleLeave}');
    expect(source).toContain('clearTimer()');
  });
});
