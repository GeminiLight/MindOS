import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── 提取自 scripts/setup.js 的 detectSystemLang 逻辑 ────────────────────────
// 与源码保持结构一致，方便比对。

function detectSystemLang(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string {
  // Check env vars by precedence (LC_ALL > LC_MESSAGES > LANG > LANGUAGE)
  // For LANGUAGE, only use the first entry before ':' (it's a priority list)
  const candidates = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
    ...(env.LANGUAGE ? [env.LANGUAGE.split(':')[0]] : []),
  ];
  const first = candidates.find(Boolean);
  if (first) {
    return first.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale.toLowerCase().startsWith('zh')) return 'zh';
  } catch {}
  return 'en';
}

// ── 通过参数注入 env 的测试（不污染 process.env）─────────────────────────────

describe('detectSystemLang — 中文环境检测', () => {
  it('LANG=zh_CN.UTF-8 → zh', () => {
    expect(detectSystemLang({ LANG: 'zh_CN.UTF-8' })).toBe('zh');
  });

  it('LANG=zh_TW.UTF-8 → zh', () => {
    expect(detectSystemLang({ LANG: 'zh_TW.UTF-8' })).toBe('zh');
  });

  it('LC_ALL=zh_CN.UTF-8 → zh', () => {
    expect(detectSystemLang({ LANG: undefined, LC_ALL: 'zh_CN.UTF-8' })).toBe('zh');
  });

  it('LC_MESSAGES=zh_CN.UTF-8 → zh', () => {
    expect(detectSystemLang({ LANG: undefined, LC_ALL: undefined, LC_MESSAGES: 'zh_CN.UTF-8' })).toBe('zh');
  });

  it('LANGUAGE=zh_CN:en_US → zh（首选项是 zh）', () => {
    expect(detectSystemLang({ LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: 'zh_CN:en_US' })).toBe('zh');
  });
});

describe('detectSystemLang — 英文环境检测', () => {
  it('LANG=en_US.UTF-8 → en', () => {
    expect(detectSystemLang({ LANG: 'en_US.UTF-8' })).toBe('en');
  });

  it('LANG=en_GB.UTF-8 → en', () => {
    expect(detectSystemLang({ LANG: 'en_GB.UTF-8' })).toBe('en');
  });

  it('所有 env 变量为空 → en（由 Intl 或默认）', () => {
    // Intl 返回非 zh 时 fallback 为 en
    const result = detectSystemLang({ LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: undefined });
    expect(['en', 'zh']).toContain(result); // 取决于当前系统 Intl locale
  });
});

describe('detectSystemLang — 优先级：env 变量优先于 Intl', () => {
  it('LC_ALL=zh 优先于 LANG=en → zh', () => {
    expect(detectSystemLang({ LANG: 'en_US.UTF-8', LC_ALL: 'zh_CN.UTF-8' })).toBe('zh');
  });

  it('LANG=en、其他 env 无 zh → en（不论 Intl 结果）', () => {
    const result = detectSystemLang({ LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: undefined });
    expect(result).toBe('en');
  });
});

describe('detectSystemLang — LANGUAGE 优先级列表', () => {
  it('LANGUAGE=en_US:zh_CN → en（首选项是 en，zh 只是 fallback）', () => {
    expect(detectSystemLang({ LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: 'en_US:zh_CN' })).toBe('en');
  });

  it('LANGUAGE=zh_CN:en_US → zh（首选项是 zh）', () => {
    expect(detectSystemLang({ LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: 'zh_CN:en_US' })).toBe('zh');
  });

  it('LANG=en + LANGUAGE=zh_CN:en → en（LANG 优先于 LANGUAGE）', () => {
    expect(detectSystemLang({ LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: 'zh_CN:en_US' })).toBe('en');
  });
});

describe('detectSystemLang — 高优先级英文 + 低优先级中文', () => {
  it('LC_ALL=en + LANG=zh → en（LC_ALL 优先级最高）', () => {
    expect(detectSystemLang({ LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8' })).toBe('en');
  });

  it('LC_MESSAGES=en + LANG=zh → en（LC_MESSAGES 优先于 LANG）', () => {
    expect(detectSystemLang({ LANG: 'zh_CN.UTF-8', LC_ALL: undefined, LC_MESSAGES: 'en_US.UTF-8' })).toBe('en');
  });
});

describe('detectSystemLang — 边界条件', () => {
  it('LANG="C" → en', () => {
    expect(detectSystemLang({ LANG: 'C' })).toBe('en');
  });

  it('LANG="POSIX" → en', () => {
    expect(detectSystemLang({ LANG: 'POSIX' })).toBe('en');
  });

  it('env 中含 "ZH"（大写）也能识别', () => {
    // 实现 .toLowerCase() 后比较，所以大写也能匹配
    expect(detectSystemLang({ LANG: 'ZH_CN.UTF-8' })).toBe('zh');
  });

  it('LANG=fr_FR.UTF-8 → en（非中文非英文仍返回 en）', () => {
    expect(detectSystemLang({ LANG: 'fr_FR.UTF-8' })).toBe('en');
  });

  it('LANG=ja_JP.UTF-8 → en（日文环境返回 en）', () => {
    expect(detectSystemLang({ LANG: 'ja_JP.UTF-8' })).toBe('en');
  });
});
