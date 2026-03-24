import { describe, expect, it } from 'vitest';
import {
  defaultEchoSegment,
  ECHO_SEGMENT_HREF,
  ECHO_SEGMENT_IDS,
  ECHO_SEGMENT_ORDER,
  isEchoSegment,
} from '@/lib/echo-segments';

describe('echo-segments', () => {
  it('lists five segments in product order', () => {
    expect(ECHO_SEGMENT_IDS).toEqual([
      'about-you',
      'continued',
      'daily',
      'past-you',
      'growth',
    ]);
    expect(ECHO_SEGMENT_ORDER).toBe(ECHO_SEGMENT_IDS);
  });

  it('accepts valid segment slugs', () => {
    for (const id of ECHO_SEGMENT_IDS) {
      expect(isEchoSegment(id)).toBe(true);
    }
  });

  it('rejects invalid slugs (normal path)', () => {
    expect(isEchoSegment('about-me')).toBe(false);
  });

  it('rejects empty and malformed slugs (boundary)', () => {
    expect(isEchoSegment('')).toBe(false);
    expect(isEchoSegment(' ')).toBe(false);
    expect(isEchoSegment('ABOUT-YOU')).toBe(false);
  });

  it('defaultEchoSegment matches first nav item', () => {
    expect(defaultEchoSegment()).toBe('about-you');
  });

  it('index redirect path is /echo/<default>', () => {
    expect(`/echo/${defaultEchoSegment()}`).toBe('/echo/about-you');
  });

  it('ECHO_SEGMENT_HREF covers every segment with /echo/ prefix', () => {
    for (const id of ECHO_SEGMENT_IDS) {
      expect(ECHO_SEGMENT_HREF[id]).toMatch(new RegExp(`^/echo/${id.replace(/-/g, '\\-')}$`));
    }
  });
});
