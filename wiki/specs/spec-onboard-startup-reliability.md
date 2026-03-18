# Spec: Onboard Startup Reliability

> **ID**: I9 — Onboard 首次启动可靠性
> **触发**: 用户报告 `mindos onboard` → "Open browser" → 60s 超时 → `✘ Server failed to start.`，无任何错误信息
> **环境**: npm install -g @geminilight/mindos v0.5.14, node v22.14.0, darwin-arm64, 全新 Mac

---

## 问题链路

```
mindos onboard
  → scripts/setup.js: startGuiSetup()
    → spawn('node bin/cli.js start', { stdio: 'ignore' })   ← P0: 所有输出被吞
      → ensureAppDeps()       ← npm install (无 lockfile, 冷缓存, 2-5 min)
      → needsBuild() → true  ← 新安装必定触发
      → next build            ← 全量编译 (1-3 min)
      → next start
    → waitForHttp(port, { retries: 60, intervalMs: 1000 })  ← P0: 60s 超时
    → "✘ Server failed to start."                           ← 用户看到的
```

**用户无法诊断**：`mindos logs` 也无输出（日志仅 daemon 模式写入）。

---

## 修复清单

### F1: 子进程输出捕获 + 日志文件（P0）

**文件**: `scripts/setup.js` 第 889-893 行

**现状**:
```js
const child = spawn(process.execPath, [cliPath, 'start'], {
  detached: true,
  stdio: 'ignore',  // ← 所有错误被丢弃
  env: { ...process.env, MINDOS_WEB_PORT: String(usePort) },
});
```

**改为**:
```js
import { openSync } from 'fs';

const LOG_PATH = resolve(MINDOS_DIR, 'mindos.log');

// Write child stdout/stderr to a log file for diagnostics
const logFd = openSync(LOG_PATH, 'a');
const child = spawn(process.execPath, [cliPath, 'start'], {
  detached: true,
  stdio: ['ignore', logFd, logFd],  // stdin=ignore, stdout+stderr→log
  env: { ...process.env, MINDOS_WEB_PORT: String(usePort) },
});
child.unref();
// No closeSync needed — spawn dups the fd, and setup.js exits shortly after.
```

**失败时打印日志路径**:
```js
if (!ready) {
  write(c.red('\n✘ Server failed to start.\n'));
  // Show tail of log for immediate diagnostics
  if (existsSync(LOG_PATH)) {
    write(c.dim(`\n  Last log output (${LOG_PATH}):\n`));
    try {
      const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n').slice(-15);
      for (const line of lines) write(c.dim(`  ${line}\n`));
    } catch {}
  }
  write(c.dim(`\n  Full logs: mindos logs\n`));
  write(c.dim(`  Manual start: mindos start\n\n`));
  process.exit(1);
}
```

**验收**:
- 子进程的 stdout/stderr 写入 `~/.mindos/mindos.log`
- 启动失败时，用户看到最后 15 行日志 + 诊断命令提示
- `mindos logs` 在非 daemon 模式也能看到 onboard 启动日志

### F2: 超时时间适配首次安装（P0）

**文件**: `scripts/setup.js` 第 898 行

**现状**:
```js
const ready = await waitForHttp(usePort, { retries: 60, intervalMs: 1000, label: 'MindOS' });
// 60s 超时，首次安装 npm install + next build 需要 3-8 分钟
```

**改为**:
```js
// First-time install needs npm install + next build (1-3 min typical).
if (isFirstTime) {
  write(c.dim('  First run: installing dependencies and building app (may take a few minutes)...\n'));
}
const ready = await waitForHttp(usePort, { retries: 120, intervalMs: 1000, label: 'MindOS' });
```

统一 120s 超时（首次和非首次相同），配合 F1 日志输出，超时后用户可自行诊断。

**验收**:
- 超时从 60s 增加到 120s
- 首次安装时打印 "First run" 提示
- 配合 F1 日志，超时后有充分的诊断信息

### F3: 包含 app/package-lock.json（P1）

**文件**: `package.json` 第 61 行

**现状**:
```json
"!app/package-lock.json"
```

**改为**: 删除这行，让 lockfile 包含在 npm tarball 中。

**收益**:
- `npm install` 走确定性安装，速度更快（2-3x）
- 避免安装到不兼容的依赖版本
- `--prefer-offline` 在有 lockfile 时更有效

**代价**:
- npm tarball 增大约 400-560 KB（lockfile 大小）
- `ensureAppDeps()` 中 `depsHash()` 基于 `package.json` 计算 hash，lockfile 变化不会触发重装 → 需要同步改为 hash 两个文件

**depsHash 调整** (`bin/lib/build.js`):
```js
function depsHash() {
  const pkgPath = resolve(ROOT, 'app', 'package.json');
  const lockPath = resolve(ROOT, 'app', 'package-lock.json');
  try {
    const h = createHash('sha256');
    h.update(readFileSync(pkgPath));
    // Include lockfile in hash if present (npm tarball may include it)
    try { h.update(readFileSync(lockPath)); } catch {}
    return h.digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}
```

**验收**:
- `npm pack --dry-run` 输出包含 `app/package-lock.json`
- 新安装时 `npm install` 走 lockfile，输出 "added N packages in Xs"（而非逐个 resolve）

### F4: `mindos logs` 非 daemon 模式也可用（P2）

**文件**: `bin/cli.js` — `logs` 命令

**现状**:
```
mindos logs
→ No log file yet at /Users/geminilight/.mindos/mindos.log
→ Logs are written when running in daemon mode (mindos start --daemon).
```

F1 修复后，onboard 启动的子进程也会写 `LOG_PATH`，所以这条提示不再准确。

**改为**: 如果 LOG_PATH 存在就直接 `tail -f`，不存在时的提示改为：
```
No log file yet at ~/.mindos/mindos.log
Logs are created when starting MindOS (mindos start, mindos onboard, or daemon mode).
```

**验收**: onboard 失败后 `mindos logs` 能看到日志

---

## 不改的部分

| 项目 | 原因 |
|------|------|
| `waitForHttp` 函数签名 | 已支持 retries/intervalMs 参数，不需要改 |
| `run()` 函数 | 子进程 stdio 已 inherit 到 fd，无需改 |
| `ensureAppDeps()` npm 检测 | 已有完善的检测 + 重试 + 错误提示 |
| daemon 模式启动流程 | 已有 120 retries * 2000ms = 240s 超时，且写 LOG_PATH |

---

## 影响范围

| 文件 | 改动 |
|------|------|
| `scripts/setup.js` | F1 (stdio→log) + F2 (超时+提示) |
| `package.json` | F3 (移除 `!app/package-lock.json`) |
| `bin/lib/build.js` | F3 (depsHash 包含 lockfile) |
| `bin/cli.js` | F4 (logs 命令提示文案) |

---

## 验证计划

1. **模拟新装机**:
   - `npm pack` → 解压到 `/tmp` → `node bin/cli.js start`
   - 确认 npm install + next build + next start 全流程成功
   - 确认 `~/.mindos/mindos.log` 有完整日志

2. **模拟超时失败**:
   - 故意让 `next build` 失败（改坏一个文件）
   - 确认用户看到最后 15 行错误日志 + 诊断命令

3. **回归**: 已有 438 tests 覆盖 config/build/port/smoke
