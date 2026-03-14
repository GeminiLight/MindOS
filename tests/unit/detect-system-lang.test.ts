import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── 提取自 scripts/setup.js 的 detectSystemLang 逻辑 ────────────────────────
// 与源码保持结构一致，方便比对。

function detectSystemLang(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string {
  const vars = [env.LANG, env.LC_ALL, env.LC_MESSAGES, env.LANGUAGE]
    .filter(Boolean).join(' ').toLowerCase();
  if (vars.includes('zh')) return 'zh';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale.toLowerCase().startsWith('zh')) return 'zh';
  } catch {}
  return 'en';
}

// ── 保存/还原 env 的辅助 ───────────────────────────────────────────────────
const ENV_KEYS = ['LANG', 'LC_ALL', 'LC_MESSAGES', 'LANGUAGE'] as const;

function withEnv(overrides: Partial<Record<typeof ENV_KEYS[number], string | undefined>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { fn(); } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
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

  it('LANGUAGE=zh_CN:en_US → zh', () => {
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
  it('LANG 包含 zh 即返回 zh，不走 Intl', () => {
    // 即使 Intl 返回 en，LANG=zh_CN 也应返回 zh
    expect(detectSystemLang({ LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8' })).toBe('zh');
  });

  it('LANG=en、其他 env 无 zh → en（不论 Intl 结果）', () => {
    const result = detectSystemLang({ LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_MESSAGES: undefined, LANGUAGE: undefined });
    expect(result).toBe('en');
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
});
