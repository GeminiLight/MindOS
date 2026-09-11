import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian HoverPopover compatibility', () => {
  it('constructs a popover and associates it with the hover parent', () => {
    const { HoverPopover } = createObsidianModule();
    const parent = { hoverPopover: null };
    const target = createObsidianElement('a');
    const popover = new HoverPopover(parent, target);
    expect(parent.hoverPopover).toBe(popover);
    expect(popover).toBeInstanceOf(HoverPopover);
  });

  it('creates a hover element container', () => {
    const { HoverPopover } = createObsidianModule();
    const popover = new HoverPopover({ hoverPopover: null }, null);
    expect(popover.hoverEl).toBeDefined();
    expect(popover.hoverEl.tagName.toLowerCase()).toBe('div');
  });

  it('tolerates optional wait time and static position arguments', () => {
    const { HoverPopover } = createObsidianModule();
    expect(() => new HoverPopover({ hoverPopover: null }, createObsidianElement('span'), 300, { x: 1, y: 2 })).not.toThrow();
  });

  it('exposes the PopoverState enum surface without inventing members', () => {
    const { PopoverState } = createObsidianModule();
    // The official 1.13.2 declaration ships this enum empty; the shim follows
    // instead of guessing numeric lifecycle values.
    expect(PopoverState).toBeDefined();
    expect(Object.keys(PopoverState)).toEqual([]);
  });

  it('classifies HoverPopover and HoverParent as supported APIs', () => {
    const report = analyzePluginCompatibility(
      'const { HoverPopover } = require("obsidian"); const h = new HoverPopover(parent, el);',
    );
    expect(report.obsidianApis).toContain('HoverPopover');
    expect(report.unsupportedApis).not.toContain('HoverPopover');
    expect(report.partialApis).toContain('HoverPopover');
  });
});
