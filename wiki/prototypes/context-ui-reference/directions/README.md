# MindOS 三种渐进式界面方案

日期：2026-10-03。交付类型：独立交互原型，用于比较布局与流程；尚未改动生产界面。

打开：[三种方案](http://localhost:4599/directions/#a/reading)。上方 A / B / C 切换共用示例状态，可以直接比较。原型采用虚构人物、虚构会话，不读取用户资料。

## 共同的产品判断

用户打开 MindOS，首先要找到、理解和维护自己的内容。目录回答“在哪里”，出处回答“当时为什么”，本次材料回答“这次带什么给谁”。这三个问题应在同一个工作位置顺畅完成。

四个产品特性接在一段经历中：打开人物资料 → 核对相关会话 → 保留自己的判断 → 在下一次协作中选择使用 → 根据真实互动补充记录。Chat 在正式实现时复用现有 Ask，作为当前内容的辅助能力。

保持当前的 Rail / 可切换 Panel / 工作标签。保留树、文件夹和项目；无需另建一套 Context 目录，也不增加一级模块。比较控件与示例说明放在原型外。

## 三种可能性

| 方案 | UI 怎么变 | 适合的任务 | 投入与代价 |
| --- | --- | --- | --- |
| [A 原位精修](http://localhost:4599/directions/#a/reading) | 来源在正文附近展开；准备材料就近操作；阅读列仍是主体 | 偶尔核对来源、读完接着记录或继续工作 | 变化最小。重点是打开/关闭、草稿、选中项和返回位置。展开后正文会变长 |
| [B 内容与出处](http://localhost:4599/directions/#b/reading) | 足够宽时使用一个辅助区，出处与材料互斥；窄屏自动单列 | 频繁在正文、原话和候选判断之间核对 | 局部变化。占用宽度；需要接入已有 Ask/TOC/Agent Detail 的互斥和尺寸规则 |
| [C 人物工作视图](http://localhost:4599/directions/#c/reading) | 同一资料变成联系人列表与详情，展示背景、互动和跟进 | 持续维护某个人、查看最近交流、准备下次接续 | 新场景能力。正式实现需完成文件写回、视图实例保存、再次打开与恢复 |

推荐先采用 A；真实任务频繁需要并排核对时再吸收 B。C 作为工作台内的一个人脉模板独立验证，先把一个模板做完整，再考虑更多模板或自然语言调整布局。

C 展示的是 Generative UI 可以生成并维护的工作视图样例。本页没有接入自然语言生成，也没有将整个应用导航交给模型重写。正式实现应预览结构变化、保留内容归属、允许恢复旧版本。

## 与当前产品的对应

| 当前基础 | 本原型保留/示范的关系 | 正式实现还需要什么 |
| --- | --- | --- |
| 48px Activity Bar、默认 300px Panel、工作标签 | 固定导航骨架与目录；窄屏把目录放在可关闭的入口中 | 复用当前标签恢复与 Panel 宽度契约 |
| Markdown 阅读与树、文件夹、项目 | A/B 原文阅读；C 原资料与工作视图相互核对 | 真实读写、权限、并发和缓存一致性 |
| Studio 项目与工具入口、CSV renderer | 项目内继续阅读、人物视图、原 CSV 核对 | 视图实例保存、字段编辑与文件写回 |
| Echo 来源与审核、外部 Session | 原话 / 候选 / 自己的判断分别呈现 | 精确关联真实消息，处理失效来源与读取失败 |
| 上下文选择、Agent 连接与现有 Ask | 选择目标与材料，先预览，再复制 | 实际发送契约与有证据的接收反馈 |

当前 4567 服务本轮不可连接，机器未提供 tmux；原型依据当前源码及设计规范制作。没有为了设计演示更改产品服务。

## 可以试的操作

1. 点“查看原会话”，修订候选，再点“保留这条判断”。切到另一个方案，内容保持一致。
2. 点“记录一次互动”，保存后核对互动列表和“查看原文件”。切换人物时记录与草稿分别保留。
3. 点“准备给 Agent”，选 Codex / Claude Code / Cursor，勾选资料、会话或已保留的判断，再查看预览、复制。改变目标或选材会清除过期完成状态。
4. 打开“相关判断”/回响，记下私人观察。它不进入材料预览或复制。
5. 试着收起目录、折叠文件夹、切换项目和人物、刷新、切换明暗；键盘左右键切换 A/B/C，Esc 关闭原文件与移动目录。

未保存的判断修订不会替换材料中的已保留版本。文件夹展开状态会恢复。无效日期、空输入与超长内容不产生记录。

## 数据与状态边界

- 示例修改仅保留在当前标签页 `sessionStorage`；可以重置。未写入 Markdown/CSV 知识库，未连接真实 Agent。
- “查看原文件”显示与本页示例一致的 Markdown 或 CSV，属于可核对的模拟原文。
- “复制”实际调用 Clipboard API；失败时保留预览与手动复制提示。已复制只表示复制成功，不能据此宣称 Agent 已接收。
- 原话、AI 候选、已保留判断、私人观察分别维护。私人观察不进入材料清单，即使恢复了过期或伪造选择。
- 刷新恢复时校验字段，旧准备/复制反馈不恢复；存储被禁用时内存操作仍可继续，并说明刷新不能保留。

## 借鉴与依据

以下都是对公开材料的设计解读，不是登录试用结论；完整来源、图像与观察边界见[研究材料](../product-hunt-report.md)和[基础图鉴](../report.md)。

- A：借鉴 [Linear Peek](https://linear.app/docs/peek) 的就近预览与 [Readwise Reader](https://readwise.io/read) 的原文阅读关系。
- B：借鉴 [Heptabase](https://heptabase.com/) 把原文与理解放在一起的思路，以及 [Claude Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) 的并排工作成果。
- C：借鉴 [Capacities](https://capacities.io/product) 的对象详情、[Attio Records](https://attio.com/help/reference/managing-your-data/records/create-and-view-records) 的人物记录和 [Obsidian Bases](https://obsidian.md/help/bases) 的文件与视图关系。

图标复用当前项目的 Lucide；字体、语义颜色、圆角与导航尺寸依据当前设计系统。未增加依赖或远程资源。

## 验证与运行

从仓库根目录运行，静态服务只暴露研究目录：

```bash
python3 -m http.server 4599 --bind 127.0.0.1 --directory wiki/prototypes/context-ui-reference
node --test wiki/prototypes/context-ui-reference/directions/model.test.cjs
node wiki/prototypes/context-ui-reference/directions/qa.cjs
node wiki/prototypes/context-ui-reference/qa.cjs
```

行为测试覆盖正常保存、按人物隔离、Unicode 恢复、空/超长输入、无效日期、损坏状态和私人观察排除。浏览器检查覆盖布局、真实复制及失败、草稿/目录恢复、未保留修订、目标切换、键盘和焦点、明暗主题与减少动效、320/390/1024/1440px 响应式。

截图保存于 `/tmp/mindos-directions-*.png`。本验证只适用于独立原型，不能替代真实文件写回、MCP/Agent、数据迁移或生产 UI 回归。
