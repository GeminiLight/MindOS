import { describe, expect, it } from 'vitest';
import {
  defaultEchoSegment,
  ECHO_SEGMENT_HREF,
  ECHO_SEGMENT_IDS,
  ECHO_SEGMENT_ORDER,
  isEchoSegment,
} from '@/lib/echo-segments';

describe('echo-segments', () => {
  it('lists three segments in product order', () => {
    expect(ECHO_SEGMENT_IDS).toEqual(['imprint', 'growth', 'self']);
    expect(ECHO_SEGMENT_ORDER).toBe(ECHO_SEGMENT_IDS);
  });

  it('accepts valid segment slugs', () => {
    for (const id of ECHO_SEGMENT_IDS) {
      expect(isEchoSegment(id)).toBe(true);
    }
  });

  it('rejects old segment slugs', () => {
    expect(isEchoSegment('about-you')).toBe(false);
    expect(isEchoSegment('continued')).toBe(false);
    expect(isEchoSegment('daily')).toBe(false);
    expect(isEchoSegment('past-you')).toBe(false);
  });

  it('rejects empty and malformed slugs', () => {
    expect(isEchoSegment('')).toBe(false);
    expect(isEchoSegment(' ')).toBe(false);
    expect(isEchoSegment('IMPRINT')).toBe(false);
  });

  it('defaultEchoSegment returns imprint', () => {
    expect(defaultEchoSegment()).toBe('imprint');
  });

  it('index redirect path is /echo/imprint', () => {
    expect(`/echo/${defaultEchoSegment()}`).toBe('/echo/imprint');
  });

  it('ECHO_SEGMENT_HREF covers every segment with /echo/ prefix', () => {
    for (const id of ECHO_SEGMENT_IDS) {
      expect(ECHO_SEGMENT_HREF[id]).toBe(`/echo/${id}`);
    }
  });
});
