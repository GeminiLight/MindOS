# CLI UX 改进 Spec

> 基于 `review/cli-review.md` 的 18 项问题，#4（启动信息精简）标记待处理，其余项的实现规格如下。

---

## #1 CLI 启动时自动检查更新（P0）

### 目标
用户执行 `mindos start` / `mindos dev` / `mindos doctor` 时，非阻塞地检查是否有新版本，有则打印一行提示。

### 新增文件
`bin/lib/update-check.js`

### 设计

```
缓存文件：~/.mindos/update-check.json
格式：{ "lastCheck": <ISO timestamp>, "latestVersion": "0.4.0" }
TTL：24 小时
```

**核心函数**：`checkForUpdate()` → `Promise<string|null>`（返回新版本号或 null）

流程：
1. 读取缓存文件：
   - 若 `Date.now() - lastCheck < 24h` 且 `latestVersion > currentVersion` → 返回 latestVersion
   - 若 `Date.now() - lastCheck < 24h` 且 `latestVersion <= currentVersion` → 返回 null（缓存命中，无更新）
2. 若缓存过期或不存在，fetch npmmirror → npmjs（复用 `app/app/api/update-check/route.ts` 的双源逻辑），timeout 3s
3. 写入缓存文件（非阻塞，失败静默）
4. 比较版本号（手写 semver 比较，避免引入 root 依赖）
5. 返回新版本号或 null

**调用点**：
- 集成到 `printStartupInfo()` 内部（仅 `start` / `dev` 走这条路径）
- `doctor` 命令单独调用
- 在 `printStartupInfo()` 中，先发起 checkForUpdate()（不 await），继续同步打印启动信息，打印完毕后用 `await Promise.race([updatePromise, timeout(4000)])` 获取结果再打印更新提示行
- **不能用裸 `.then()` 回调**：因为 `printStartupInfo` 之后是 `run('npx next start ...')`（同步阻塞的 execSync），.then 回调会在 next 输出中间插入，打乱终端输出

**输出格式**：
```
⬆  MindOS v0.4.0 available (current: v0.3.0). Run `mindos update` to upgrade.
```

**禁用方式**：`MINDOS_NO_UPDATE_CHECK=1` 环境变量

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/update-check.js` | 新建 |
| `bin/lib/constants.js` | 新增 `UPDATE_CHECK_PATH` |
| `bin/lib/startup.js` | `printStartupInfo` 改为 async，内部集成 update check |
| `bin/cli.js` | `start`/`dev` 的 printStartupInfo 调用改为 await；`doctor` 单独调用 checkForUpdate |

### 注意
- semver 是 app/ 的依赖（`update-check/route.ts` 使用了 `import { gt } from 'semver'`），但 root package.json 没有。手写一个简单的版本比较即可，避免引入 root 依赖。
- fetch 在 Node 18+ 已内置，无需额外依赖。
- `printStartupInfo` 变为 async 后，调用方需要 await。当前 `start`/`dev` 命令中 `printStartupInfo()` 在 `run('npx next ...')` 之前，改为 `await printStartupInfo(...)` 即可，因为 `start`/`dev` 本身已是 async 函数。

---

## #2 支持 `--version` / `-v`（P1）

### 改动
`bin/cli.js` 入口区域，在 commands 分发之前加判断：

```js
if (cmd === '--version' || cmd === '-v') {
  const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
  console.log(`mindos/${version} node/${process.version} ${process.platform}-${process.arch}`);
  process.exit(0);
}
```

同时在 help 页面顶部加版本号：
```
🧠 MindOS CLI v0.3.0
```

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | 入口区新增 `--version` / `-v` 处理 + help 文本加版本 |

---

## #3 支持 `--help` / `-h`（P2）

### 改动
`bin/cli.js` 入口区域：

```js
if (cmd === '--help' || cmd === '-h') {
  // 打印现有 help 内容
  process.exit(0);
}
```

对子命令也支持：`mindos start --help` → 打印 start 相关的选项说明。初期可以先只做顶层 `--help`，子命令 help 作为后续迭代。

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | 入口区新增 `--help` / `-h` 分支 |

---

## #5 Network URL 可达性提示（P2）

### 改动
`bin/lib/startup.js` 的 `getLocalIP()` 返回 IP 后，在 `printStartupInfo()` 中对该 IP 做快速 TCP connect 检测（connect to port 自身，timeout 500ms）。

实际上 getLocalIP 返回的是本机网卡 IP，始终可达。真正的问题是：**远程用户是否能访问这个 IP**，这无法从本机检测。

**调整方案**：
- 检测 localhost 是否可绑定（始终可以），所以 Local URL 始终展示
- Network URL 加提示语 `(accessible from other devices on the same network)`
- 如果是 Docker/WSL/远程服务器场景，建议 SSH port forwarding（已有此提示，保留即可）

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/startup.js` | Network URL 行加提示文案微调 |

---

## #6 `run()` 错误信息透传（P1）

### 改动
`bin/lib/utils.js`：

```js
export function run(command, cwd = ROOT) {
  try {
    execSync(command, { cwd, stdio: 'inherit', env: process.env });
  } catch (err) {
    // execSync with stdio:'inherit' 已经打印了子进程的错误输出
    // 只需透传 exit code
    process.exit(err.status || 1);
  }
}
```

关键：保留 `err.status`（子进程退出码）而不是固定 `1`。

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/utils.js` | catch 块透传 err.status |

---

## #7 pkill 精确化（P2）

### 改动
`bin/lib/stop.js`：当无 PID 文件时，改用端口查找代替 pkill 模式匹配。

```js
// 替换 pkill 为端口精确查找
import { loadConfig } from './config.js';

export function stopMindos() {
  const pids = loadPids();
  if (pids.length) {
    // 现有逻辑不变
    ...
  } else {
    // 通过端口查找
    loadConfig();
    const webPort = process.env.MINDOS_WEB_PORT || '3000';
    const mcpPort = process.env.MINDOS_MCP_PORT || '8787';
    for (const port of [webPort, mcpPort]) {
      try {
        const pid = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (pid) {
          pid.split('\n').forEach(p => {
            try { process.kill(Number(p), 'SIGTERM'); } catch {}
          });
        }
      } catch {}
    }
    console.log(green('✔ Done'));
  }
}
```

保留 pkill 作为最后兜底（lsof 不存在的环境），但加注释说明风险。

### 注意
- `lsof` 在 Alpine / 最小化 Debian 等环境不预装。需先 `which lsof` 检测，不存在时 fallback 到 pkill。
- 端口查找也有误杀风险：用户可能在同端口跑了其他服务。可在 kill 前用 `lsof -p <pid> -Fn` 检查进程 cmdline 是否包含 `next` 或 `mindos`，但复杂度较高，初期可接受端口匹配。
- macOS 的 lsof 参数与 Linux 一致（`-ti :PORT`），无需分平台。

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/stop.js` | 重构无 PID 时的进程查找逻辑 |

---

## #8 `config set` 类型解析增强（P2）

### 改动
`bin/cli.js` config set 分支，替换 coerce 逻辑：

```js
function coerceValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  if (val === '""' || val === "''") return '';
  if (!isNaN(Number(val)) && val.trim() !== '') return Number(val);
  return val;
}
```

新增 `config unset <key>`：
```js
if (sub === 'unset') {
  const key = process.argv[4];
  if (!key) { console.error(red('Usage: mindos config unset <key>')); process.exit(1); }
  if (!existsSync(CONFIG_PATH)) { console.error(red('No config found.')); process.exit(1); }
  let config;
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {
    console.error(red('Failed to parse config file.')); process.exit(1);
  }
  // 用 dot-notation 遍历删除
  const parts = key.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) { console.log(dim(`Key "${key}" not found`)); return; }
    obj = obj[parts[i]];
  }
  if (!(parts[parts.length - 1] in obj)) { console.log(dim(`Key "${key}" not found`)); return; }
  delete obj[parts[parts.length - 1]];
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`${green('✔')} Removed ${cyan(key)}`);
}
```

help 文本中新增 `config unset` 说明行。

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | config set 的 coerce 函数 + 新增 config unset 分支 + help 文本 |

---

## #9 `config show` 展示版本信息（P3）

### 改动
`bin/cli.js` config show 分支，在输出 JSON 之前加一行：

```js
const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
console.log(`\n${bold('📋 MindOS Config')}  ${dim(`v${version}`)}  ${dim(CONFIG_PATH)}\n`);
```

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | config show 标题行加版本号 |

---

## #10 setup 配置确认机制（P2）

### 改动
`scripts/setup.js` 的 `main()` 函数，在写入 config 之前（第 768 行附近），插入配置摘要确认步骤：

```
━━━ Configuration Summary ━━━
  Knowledge base:  ~/.mindos/my-mind
  Web port:        3000
  MCP port:        8787
  Auth token:      a1b2-c3d4-****
  Web password:    ••••••••
  AI provider:     anthropic
  Start mode:      daemon

Save this config? [Y/n]
```

用户输入 `n` 时提示用户重新运行 `mindos onboard`（不自动重跑 `main()`，因为知识库目录和模板已创建，重跑会走"目录已存在"分支，体验混乱）。

完整的"回退上一步"实现复杂度较高（需要重构为状态机），先做最终确认即可覆盖 80% 场景。用户如果想改某个单项，可以用 `mindos config set` 修改。

### 改动清单
| 文件 | 操作 |
|------|------|
| `scripts/setup.js` | 写入 config 前插入摘要确认 |

---

## #11 setupPending 清理（P2）

### 改动

**方案 A**：`mindos start` 入口检测 `config.setupPending === true`，打印警告并提示用户：
```
⚠ Setup was not completed. Run `mindos onboard` to finish, or `mindos config set setupPending false` to dismiss.
```

**方案 B**：GUI setup 完成后的 `/api/setup/complete` 端点清除该标记（如果 GUI setup 流程已实现此逻辑则无需改动）。

两者都做：A 作为兜底，B 作为正常路径。

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | start 命令入口检测 setupPending |
| GUI 端 | 确认 setup 完成后清除 setupPending（如已有则无需改动） |

---

## #12 命令别名文档化（P3）

### 改动
- help 文本中标注 `init` / `setup` 为 `onboard` 的别名
- 或直接从 help 中移除未公开的别名，保持单一入口

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | help 文本调整 |

---

## #13 sync 子命令校验（P3）

### 改动
`bin/cli.js` sync 命令，在已知子命令之后加 else 分支：

```js
const validSubs = ['init', 'now', 'conflicts', 'on', 'off'];
if (sub && !validSubs.includes(sub)) {
  console.error(red(`Unknown sync subcommand: ${sub}`));
  console.error(dim(`Available: ${validSubs.join(' | ')}`));
  process.exit(1);
}
```

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/cli.js` | sync 命令加未知子命令校验 |

---

## #14 统一 debug 日志（P2）

### 新增文件
`bin/lib/debug.js`

```js
import { dim } from './colors.js';

const enabled = process.env.MINDOS_DEBUG === '1' || process.argv.includes('--verbose');

export function debug(...args) {
  if (enabled) {
    const ts = new Date().toISOString().slice(11, 23);
    console.error(dim(`[${ts}]`), ...args);
  }
}
```

- 输出到 stderr（不干扰 stdout 的 JSON 输出等）
- 各模块按需 `import { debug } from './debug.js'` 加日志
- `--verbose` 从仅 MCP 扩展为全局生效

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/debug.js` | 新建 |
| `bin/cli.js` | 将 `isVerbose` 设为环境变量以便子模块读取 |
| 各 `bin/lib/*.js` | 按需加 debug 调用（渐进式，不必一次全加） |

---

## #15 NO_COLOR / FORCE_COLOR 支持（P3）

### 改动
`bin/lib/colors.js`：

```js
const forceColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0';
const noColor = 'NO_COLOR' in process.env;
export const isTTY = noColor ? false : (forceColor || process.stdout.isTTY);
```

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/colors.js` | isTTY 判断增加 NO_COLOR / FORCE_COLOR |

---

## #16 auth token 日志脱敏（P2）

### 改动

**`bin/lib/startup.js` printStartupInfo()**：

token 显示行 mask：
```js
// 替换
console.log(`\n  🔑 ${bold('Auth token:')} ${cyan(authToken)}`);
// 为
const masked = authToken.length > 8 ? authToken.slice(0, 8) + '••••' : '••••';
console.log(`\n  🔑 ${bold('Auth token:')} ${cyan(masked)}  ${dim('(run `mindos token` for full value)')}`);
```

MCP JSON block 也包含完整 token（`"Authorization": "Bearer <token>"`），同样需要 mask。改 `block()` 函数：
```js
// 当前：
const auth = authToken
  ? `,\n        "headers": { "Authorization": "Bearer ${authToken}" }`
  : '';
// 改为：
const maskedToken = authToken.length > 8 ? authToken.slice(0, 8) + '••••' : '••••';
const auth = authToken
  ? `,\n        "headers": { "Authorization": "Bearer ${maskedToken}" }`
  : '';
```

注意：`mindos token` 命令（cli.js:102-185）是用户**主动**查看 token 的入口，应保持输出完整 token，不 mask。

**日志文件权限**（`bin/lib/gateway.js`）：
在 `ensureMindosDir()` 中确保日志文件权限：
```js
import { chmodSync } from 'node:fs';

export function ensureMindosDir() {
  if (!existsSync(MINDOS_DIR)) mkdirSync(MINDOS_DIR, { recursive: true, mode: 0o700 });
  if (existsSync(LOG_PATH)) {
    try { chmodSync(LOG_PATH, 0o600); } catch {}
  }
}
```

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/startup.js` | token 显示 mask |
| `bin/lib/gateway.js` | ensureMindosDir 设置目录和日志权限 |

---

## #17 config 加载 lazy singleton（P3）

### 改动
`bin/lib/config.js`：将 `loadConfig()` 改为幂等，内部缓存已加载状态。

```js
let loaded = false;
export function loadConfig() {
  if (loaded) return;
  loaded = true;
  // 现有逻辑...
}
```

### 改动清单
| 文件 | 操作 |
|------|------|
| `bin/lib/config.js` | 加 loaded 标记 |

---

## #18 ensureAppDeps 增量检测（P3）

优先级低，当前行为可接受。如需改进：

在 `BUILD_STAMP` 旁写一个 `deps-stamp`，内容为 `app/package-lock.json` 的 hash。`ensureAppDeps()` 比较 hash，不一致时重新 `npm install`。

暂不实施。

---

## 实施状态

```
Phase 1（已完成）: #1 ✅, #2 ✅, #6 ✅, #15 ✅, #16 ✅
Phase 2（已完成）: #3 ✅, #7 ✅, #8 ✅, #13 ✅, #14 ✅
Phase 3（已完成）: #5 ✅, #10 ✅, #11 ✅, #17 ✅
Backlog（已完成）: #4 ✅, #9 ✅, #12 ✅, #18 ✅
```

### Phase 1 实施记录（2026-03-14）

| # | 项 | 改动文件 | 状态 |
|---|---|---------|------|
| #1 | CLI 启动自动检查更新 | `bin/lib/update-check.js`(新), `bin/lib/constants.js`, `bin/lib/startup.js`, `bin/cli.js` | ✅ |
| #2 | `--version` / `-v` + help 显示版本 | `bin/cli.js` | ✅ |
| #6 | `run()` 错误 exit code 透传 | `bin/lib/utils.js` | ✅ |
| #15 | NO_COLOR / FORCE_COLOR 支持 | `bin/lib/colors.js` | ✅ |
| #16 | auth token 启动日志脱敏 + MCP JSON block 脱敏 | `bin/lib/startup.js` | ✅ |

### Phase 2 实施记录（2026-03-14）

| # | 项 | 改动文件 | 状态 |
|---|---|---------|------|
| #3 | `--help` / `-h` 支持 | `bin/cli.js` | ✅ |
| #7 | pkill 精确化（端口查找优先 + pkill 兜底） | `bin/lib/stop.js` | ✅ |
| #8 | `config set` 类型解析增强 + `config unset` | `bin/cli.js` | ✅ |
| #13 | sync 子命令校验 | `bin/cli.js` | ✅ |
| #14 | 统一 debug 日志模块 | `bin/lib/debug.js`(新) | ✅ |

### Phase 3 实施记录（2026-03-14）

| # | 项 | 改动文件 | 状态 |
|---|---|---------|------|
| #5 | Network URL SSH 提示增强（含 MCP 端口转发） | `bin/lib/startup.js` | ✅ |
| #10 | setup 配置确认机制（摘要 + Y/n 确认） | `scripts/setup.js` | ✅ |
| #11 | setupPending 启动警告 | `bin/cli.js` | ✅ |
| #17 | config 加载 lazy singleton | `bin/lib/config.js` | ✅ |

### Backlog 实施记录（2026-03-14）

| # | 项 | 改动文件 | 状态 |
|---|---|---------|------|
| #4 | 启动信息精简（移除 JSON block，紧凑布局） | `bin/lib/startup.js` | ✅ |
| #9 | `config show` 展示版本号 | `bin/cli.js` | ✅ |
| #12 | 别名文档化（help 标注 init/setup 为 onboard 别名） | `bin/cli.js` | ✅ |
| #18 | ensureAppDeps 增量检测（package-lock.json hash） | `bin/lib/build.js`, `bin/lib/constants.js` | ✅ |
