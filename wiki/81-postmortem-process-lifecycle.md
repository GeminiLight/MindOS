<!-- Last verified: 2026-03-22 -->

# 进程生命周期 Bug 根因分析

> 背景：restart/stop 模块连续出现 7 个互相关联的 bug，修 1 个露 1 个，直到第 3 轮 review 才收敛。本文回溯根因，提炼可复用的设计规则。

## 一、Bug 时间线

| # | 现象 | 根因 | 修复轮次 |
|---|------|------|---------|
| 1 | `setup.js finish()` 用 `start` 重启，`assertPortFree` 失败 | 旧进程还在，应该用 `restart` | 轮次 1 |
| 2 | `stopMindos` 后端口仍被占用 | PID 文件只记录主进程，工人残留；有 PID 文件时跳过了端口清理 | 轮次 1 |
| 3 | `lsof` 在部分环境失败 | 环境差异，无 fallback | 轮次 1 |
| 4 | `ss` 端口子串误匹配 `:3003` → `:30030` | 字符串 includes 而非正则 | 轮次 1 |
| 5 | restart 1.5s sleep 后端口未释放 | 固定 delay 不可靠 | 轮次 1 |
| 6 | re-onboard 误报 "Port already in use"（自己的端口） | `/api/health` 被 auth 拦截 | 轮次 2 |
| 7 | GUI 改端口后 restart，服务跑在旧端口 / 旧 MCP 存活 | env 继承 + config 只有新端口 | 轮次 3 |

## 二、为什么 bug 不断出现

### 问题 1：没有端到端的心智模型

每次只看到局部代码，没有画出**数据在组件间怎么流**：

```
config.json ──写入──→ stopMindos（读 config）
                         ↕
process.env ──继承──→ loadConfig（不覆盖已有 env）──→ start（用 env 端口）
                         ↕
PID 文件   ──读取──→ killTree（只杀记录的 PID）
```

如果一开始画出这张图，就能立刻发现：
- config 写入 vs 运行态进程 是两个时间线
- env 继承 + "不覆盖" = 隐式优先级
- PID 文件 ≠ 全部进程

### 问题 2：每个组件单独"正确"，组合后出错

- `loadConfig()` 的 "已有则不覆盖" 策略：在正常启动时合理（CLI 可以通过 env 覆盖 config）
- `stopMindos()` 从 config 读端口：在端口不变时正确
- `/api/restart` 传 `process.env`：看起来合理

三个组件各自都"说得通"，但**组合**在"端口变更 + restart"这个场景下全部失效。这是典型的**接口契约缺失**——没有任何地方明确定义：restart 时，旧端口信息从哪里来、由谁传递。

### 问题 3：只测 happy path

之前的测试（手动 + 自动）都是：start → stop → 端口释放。从没测过**改端口再 restart** 这个路径。因为写代码时默认用户不会改端口——但 onboard 就是为了让用户配置端口的。

## 三、提炼的设计规则

### 规则 1：多步状态变更，画数据流图

涉及"配置写入 → 进程管理 → 启动"的流程，先画出：
- 每一步读写的数据源（config file / env / PID file / 端口状态）
- 数据在步骤间怎么传递
- 哪些是运行态（当前进程持有），哪些是配置态（已持久化到文件）

### 规则 2：进程管理不信任单一来源

- PID 文件 → 不完整（工人进程不在里面），必须有端口清理兜底
- config 文件 → 可能已被更新（新端口），不代表运行态
- env vars → 可能被子进程继承，也可能被清掉

**正确做法：** 多来源取并集。端口清理既看 config（新端口）也看 env/传参（旧端口）。

### 规则 3：env "不覆盖" 策略 = 隐式优先级炸弹

`if (!process.env[key]) process.env[key] = val` 这个模式意味着 env 比 config 文件优先。当子进程继承父进程 env 时，如果不主动清理，文件里的配置变更永远不会生效。

**规则：** 任何 spawn 子进程 + loadConfig 的组合，都要检查：父进程的 env 是否包含需要被子进程从文件重新读取的值。如果是，必须在 spawn 前删除。

### 规则 4：异步资源释放用轮询，不用 sleep

端口释放、进程退出都是异步的。`setTimeout(1500)` 只是赌运气。改为 polling + deadline。

### 规则 5：健康检查端点必须无认证

`/api/health` 被内部自检、端口检测、gateway 探活等多个场景使用，任何认证都会导致自检失败。

### 规则 6：端口变更必须测

涉及端口/路径等"identity"级配置的变更路径，必须作为独立测试用例覆盖，不能只测"不变"的 happy path。

## 四、Checklist（进程管理变更时使用）

- [ ] 画出数据流：config file → env → PID → 端口状态，标注读/写方向
- [ ] 端口清理覆盖新旧端口（config + 运行态）
- [ ] spawn 子进程前检查 env 继承：是否有需要从文件重新读取的值
- [ ] 资源释放用 polling + deadline，不用固定 sleep
- [ ] 测试覆盖：端口变更 + restart、端口不变 + restart、首次启动
- [ ] 健康检查端点不受 auth 影响
