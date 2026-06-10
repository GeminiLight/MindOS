import { describe, expect, it } from 'vitest';
import { detectSourcePlatform, normalizeSourceHostname } from '@/lib/link-preview/source-platforms';

describe('source platform detection', () => {
  it('detects mainstream social and reference domains', () => {
    expect(detectSourcePlatform('https://www.youtube.com/watch?v=abc')?.id).toBe('youtube');
    expect(detectSourcePlatform('https://b23.tv/abc')?.id).toBe('bilibili');
    expect(detectSourcePlatform('https://www.xiaohongshu.com/explore/abc')?.id).toBe('xiaohongshu');
    expect(detectSourcePlatform('https://zhuanlan.zhihu.com/p/123')?.id).toBe('zhihu');
    expect(detectSourcePlatform('https://gist.github.com/user/id')?.id).toBe('github');
    expect(detectSourcePlatform('https://old.reddit.com/r/localfirst')?.id).toBe('reddit');
    expect(detectSourcePlatform('https://twitter.com/user/status/1')?.id).toBe('x');
    expect(detectSourcePlatform('https://mp.weixin.qq.com/s/example')?.id).toBe('wechat');
    expect(detectSourcePlatform('https://arxiv.org/abs/2401.00001')?.id).toBe('arxiv');
  });

  it('normalizes hosts without treating arbitrary text as a source', () => {
    expect(normalizeSourceHostname('www.youtube.com/watch?v=abc')).toBe('youtube.com');
    expect(normalizeSourceHostname('not a url')).toBeNull();
    expect(detectSourcePlatform('https://example.com')).toBeNull();
  });
});
