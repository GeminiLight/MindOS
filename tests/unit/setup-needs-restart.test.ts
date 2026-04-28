import { describe, it, expect } from 'vitest';

// ── 提取自 app/app/api/setup/route.ts 的 needsRestart 逻辑 ──────────────────
// 与源码保持结构一致，方便比对。若源码逻辑改变，此处需同步更新。

interface CurrentConfig {
  setupPending?: boolean;
  mindRoot?: string;
  port?: number;
  mcpPort?: number;
  authToken?: string;
  webPassword?: string;
}

interface IncomingPayload {
  webPort: number;
  mcpPortNum: number;
  resolvedRoot: string;
  authToken?: string;
  webPassword?: string;
}

function computeNeedsRestart(current: CurrentConfig, incoming: IncomingPayload): boolean {
  const isFirstTime = current.setupPending === true || !current.mindRoot;
  const resolvedAuthToken   = incoming.authToken   ?? current.authToken   ?? '';
  const resolvedWebPassword = incoming.webPassword ?? '';
  return !isFirstTime && (
    incoming.webPort      !== (current.port      ?? 3456) ||
    incoming.mcpPortNum   !== (current.mcpPort   ?? 8781) ||
    incoming.resolvedRoot !== (current.mindRoot  || '')   ||
    resolvedAuthToken     !== (current.authToken   ?? '') ||
    resolvedWebPassword   !== (current.webPassword ?? '')
  );
}

// ── 基础场景 ──────────────────────────────────────────────────────────────────

const EXISTING: CurrentConfig = {
  setupPending: false,
  mindRoot: '/home/user/MindOS/mind',
  port: 3456,
  mcpPort: 8781,
  authToken: 'abc-token',
  webPassword: 'secret',
};

const UNCHANGED: IncomingPayload = {
  webPort: 3456,
  mcpPortNum: 8781,
  resolvedRoot: '/home/user/MindOS/mind',
  authToken: 'abc-token',
  webPassword: 'secret',
};

describe('needsRestart — 首次 onboard 不触发', () => {
  it('setupPending=true 时不触发', () => {
    const current: CurrentConfig = { ...EXISTING, setupPending: true };
    expect(computeNeedsRestart(current, UNCHANGED)).toBe(false);
  });

  it('mindRoot 为空字符串时不触发', () => {
    const current: CurrentConfig = { ...EXISTING, setupPending: false, mindRoot: '' };
    expect(computeNeedsRestart(current, UNCHANGED)).toBe(false);
  });

  it('mindRoot 为 undefined 时不触发', () => {
    const current: CurrentConfig = { ...EXISTING, setupPending: false, mindRoot: undefined };
    expect(computeNeedsRestart(current, UNCHANGED)).toBe(false);
  });
});

describe('needsRestart — 再次 onboard 无变更不触发', () => {
  it('所有字段相同时不触发', () => {
    expect(computeNeedsRestart(EXISTING, UNCHANGED)).toBe(false);
  });

  it('只改 AI Key/Model（payload 中无对应字段）不触发', () => {
    // AI 配置不在 needsRestart 的比较字段里
    expect(computeNeedsRestart(EXISTING, UNCHANGED)).toBe(false);
  });
});

describe('needsRestart — 各字段变更触发', () => {
  it('改 webPort 触发', () => {
    const incoming = { ...UNCHANGED, webPort: 3001 };
    expect(computeNeedsRestart(EXISTING, incoming)).toBe(true);
  });

  it('改 mcpPort 触发', () => {
    const incoming = { ...UNCHANGED, mcpPortNum: 8788 };
    expect(computeNeedsRestart(EXISTING, incoming)).toBe(true);
  });

  it('改 mindRoot 触发', () => {
    const incoming = { ...UNCHANGED, resolvedRoot: '/home/user/notes' };
    expect(computeNeedsRestart(EXISTING, incoming)).toBe(true);
  });

  it('改 authToken 触发', () => {
    const incoming = { ...UNCHANGED, authToken: 'new-token' };
    expect(computeNeedsRestart(EXISTING, incoming)).toBe(true);
  });

  it('改 webPassword 触发', () => {
    const incoming = { ...UNCHANGED, webPassword: 'new-pass' };
    expect(computeNeedsRestart(EXISTING, incoming)).toBe(true);
  });
});

describe('needsRestart — 边界条件', () => {
  it('authToken=undefined 时使用 current.authToken，不误判', () => {
    // 模拟前端未传 authToken（保留原值），不应触发重启
    const incoming: IncomingPayload = { ...UNCHANGED, authToken: undefined };
    expect(computeNeedsRestart(EXISTING, incoming)).toBe(false);
  });

  it('webPassword=undefined 时视为空字符串', () => {
    // current 无密码，incoming 也未传，不应触发
    const current: CurrentConfig = { ...EXISTING, webPassword: '' };
    const incoming: IncomingPayload = { ...UNCHANGED, webPassword: undefined };
    expect(computeNeedsRestart(current, incoming)).toBe(false);
  });

  it('current 无 port/mcpPort 时使用默认值 3456/8781', () => {
    const current: CurrentConfig = { ...EXISTING, port: undefined, mcpPort: undefined };
    // incoming 与默认值相同，不触发
    expect(computeNeedsRestart(current, UNCHANGED)).toBe(false);
    // incoming 与默认值不同，触发
    expect(computeNeedsRestart(current, { ...UNCHANGED, webPort: 3001 })).toBe(true);
  });

  it('current 无 authToken 时视为空字符串', () => {
    const current: CurrentConfig = { ...EXISTING, authToken: undefined };
    // incoming 传空字符串，与 undefined 等价，不触发
    expect(computeNeedsRestart(current, { ...UNCHANGED, authToken: '' })).toBe(false);
    // incoming 传新 token，触发
    expect(computeNeedsRestart(current, { ...UNCHANGED, authToken: 'new' })).toBe(true);
  });
});
