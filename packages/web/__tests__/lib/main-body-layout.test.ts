import { describe, expect, it } from 'vitest';
import { parseContentWidthRatio, resolveMainBodyLayout } from '@/lib/main-body-layout';

describe('main body layout resolver', () => {
  it('keeps the configured content width centered in the normal wide layout', () => {
    const layout = resolveMainBodyLayout({
      viewportWidth: 1600,
      leftOffset: 348,
      rightReservedWidth: 0,
      contentWidthRatio: 0.8,
      gutterMin: 24,
    });

    expect(layout.unreservedWidth).toBe(1252);
    expect(layout.availableWidth).toBe(1252);
    expect(layout.preferredContentWidth).toBeCloseTo(1001.6);
    expect(layout.contentMaxWidth).toBeCloseTo(1001.6);
    expect(layout.gutterWidth).toBeCloseTo(125.2);
  });

  it('shrinks symmetric gutters before narrowing the content body', () => {
    const layout = resolveMainBodyLayout({
      viewportWidth: 1600,
      leftOffset: 348,
      rightReservedWidth: 200,
      contentWidthRatio: 0.8,
      gutterMin: 24,
    });

    expect(layout.availableWidth).toBe(1052);
    expect(layout.preferredContentWidth).toBeCloseTo(1001.6);
    expect(layout.contentMaxWidth).toBeCloseTo(1001.6);
    expect(layout.gutterWidth).toBeCloseTo(25.2);
  });

  it('narrows the body only after both gutters reach the minimum', () => {
    const layout = resolveMainBodyLayout({
      viewportWidth: 1600,
      leftOffset: 348,
      rightReservedWidth: 220,
      contentWidthRatio: 0.8,
      gutterMin: 24,
    });

    expect(layout.availableWidth).toBe(1032);
    expect(layout.preferredContentWidth).toBeCloseTo(1001.6);
    expect(layout.contentMaxWidth).toBe(984);
    expect(layout.gutterWidth).toBe(24);
  });

  it('parses current and legacy content width settings into stable ratios', () => {
    expect(parseContentWidthRatio('80%')).toBe(0.8);
    expect(parseContentWidthRatio('100%')).toBe(1);
    expect(parseContentWidthRatio('960px')).toBe(1);
    expect(parseContentWidthRatio('780px')).toBe(0.8);
    expect(parseContentWidthRatio('640px')).toBe(0.65);
    expect(parseContentWidthRatio('0.75')).toBe(0.75);
    expect(parseContentWidthRatio('75')).toBe(0.75);
    expect(parseContentWidthRatio('30%')).toBe(0.5);
    expect(parseContentWidthRatio('120%')).toBe(1);
    expect(parseContentWidthRatio(null)).toBe(0.8);
    expect(parseContentWidthRatio('narrow')).toBe(0.8);
  });
});
