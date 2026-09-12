# Obsidian 兼容宿主扩展指南

## 兼容判断

`runtime-plan.ts` 描述实际提供的浏览器模块，`browser-host/modules.ts` 提供对应实例。目录与实例表由契约测试约束。预检给出的 `desktopCandidate` 只表示可以尝试隔离运行，不表示 API、主题、多窗口或完整插件工作流已经兼容。

安装与执行分开：已具备模块的编辑器插件可以从社区安装或 Vault 导入，默认不启用。服务端仍依据原兼容报告拦截；桌面入口单独请求当前知识库、插件包指纹、当前笔记与插件配置的授权。额外读取其他知识库文件仍需单独选择。

无法解析的动态 require、Node/Electron 模块、未提供的第三方 external 仍被拦截。第三方包名不再被视为“已经打包”的证据。成员对象上的可选 require 探测不被误认成注入的宿主 require；这仍是静态扫描，不能证明别名调用与所有条件分支可执行。动态 import 保留警告；桌面可尝试加载，但不提供任意动态模块解析，也不承诺该分支可执行。

社区安装 main.js 默认上限为 8 MiB，正文读取过程中按实际字节限制并设置超时，不能依赖 Content-Length 或先整包读入再检查。manifest/CSS 保持各自更小的上限。

## 新增模块或 API

1. 在 `runtime-plan.ts` 声明模块，同时在 `browser-host/modules.ts` 提供真实实现；Web package 直接声明所 import 的依赖。
2. CodeMirror/Lezer 必须复用宿主同一依赖实例；禁止单独引入另一份 EditorState/View。新增模块需经过浏览器打包验证，不能导入 Node 能力。
3. 缺失 Obsidian 导出通过官方 API 快照给出 browser 诊断。补 API 时验证实际行为、生命周期撤销与错误路径；不能用返回空值的占位实现宣称支持。
4. 增加无插件 ID 特判的正常、边界与失败测试，再用固定版本原包验证具体工作流。记录版本、字节摘要、实际操作、失败与未验证部分。
5. 模块依赖以外的新 I/O 必须单独设计授权与 broker。不得通过暴露 require、IPC、token 或任意路径扩大兼容面。

## 配置数据流

`Plugin.loadData/saveData` → 浏览器有界消息 → 可信 preload → 主进程批准会话 → `/api/obsidian-plugins/data` → 产品核心 `plugin-data-store` → 该插件的 `data.json`。

- 每次请求绑定 pluginId、知识库身份与批准的包指纹，插件侧只能提供 JSON 数据。
- 初次读取沿用已有 `data.json`；不存在时返回 null。代码指纹不包含配置。
- 浏览器保存按顺序执行，只有写盘成功才更新本地缓存；主进程维护独立配置 revision。
- 外部修改会触发冲突并保留外部数据；写入失败后要求重开编辑器，不能自动重读后覆盖。
- 文件大小上限 1 MiB；同一会话最多 32 个待处理请求，消息和网络请求均有超时。符号链接、硬链接、包替换、切库和失效会话均不授予新访问。
- 同目录独占临时文件加原子替换；支持同进程顺序写和外部变更检测，不宣称严格的跨进程文件 CAS。
- 配置可能包含插件之前保存的凭据，授权说明明确包含配置访问；数据不进入日志、异常、包摘要或无缓存控制的响应。

## 当前边界

桌面提供真实 DOM、CM6 与有限 Vault 能力，仍是单个隔离编辑器宿主。新增模块目录与配置持久化能够支持一类插件，但不等于完整复刻 Obsidian workspace。Native 模块、任意文件/网络权限、更多 Obsidian API 和多窗口行为仍需各自实现与验证。服务端 API 覆盖率和模块预检无阻断率都不能换算为插件兼容率。

## 验证入口

Web 的 `__tests__/obsidian-compat`、`__tests__/api/obsidian*`；核心 `plugin-data-store.test.ts`；Desktop `obsidian-*.test.ts`；`community-original-install.test.ts` 可通过原包目录环境变量重放安装；四个 `tests/e2e/obsidian-*.spec.ts`。E2E 使用临时知识库和固定版本原包，不写用户真实笔记。

安装函数/导入 API 的门控由独立测试验证，Electron 原包测试使用受控临时包目录；两者不是一条完整的社区安装 UI 自动化证据。
