# Voice Memo — 语音备忘录插件

> 录音 → Whisper 转录 → Markdown 存入暂存台。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `voice-memo` |
| 类型 | 转换器（Converter） |
| 来源 | 浏览器 MediaRecorder API / 移动端录音 |
| 依赖 | OpenAI Whisper API 或本地 whisper.cpp |
| 状态 | 计划中 |

## 解决什么问题

灵感和想法来得快去得也快。打字不如说话快，尤其是在走路、通勤、做饭时。录一段语音 → 自动转成文字 → 存入知识库，是最低摩擦的捕获方式。

## 功能

- Web 端：首页或暂存台增加录音按钮
- 移动端：Quick Capture 区域增加语音模式
- 录音完成后自动调用转录 API
- 转录结果保存为 `Inbox/voice-YYYY-MM-DD-HHmm.md`
- 原始音频可选保留（存为 `.webm` / `.m4a`）

## 转录方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| OpenAI Whisper API | 质量最高，多语言 | 需要 API Key，有成本 |
| 本地 whisper.cpp | 免费，隐私 | 需要用户安装，CPU 密集 |
| 浏览器 Web Speech API | 零依赖 | 质量一般，仅英文好 |

建议：默认用 OpenAI Whisper API（用户已配置的 API Key），可选回退到 Web Speech API。

## 输出格式

```markdown
---
type: voice-memo
recorded_at: 2026-04-12T14:30:00
duration: 45s
---

# Voice Memo — 2026-04-12 14:30

今天和 Alex 讨论了新的 API 设计方案。
主要结论是用 REST 而不是 GraphQL，因为团队更熟悉。
需要在周五前出第一版 spec。
```

## 实施要点

- 录音限制：单次最长 5 分钟（控制转录成本）
- 静音检测：超过 3s 无声自动停止
- 离线队列：无网络时暂存音频，恢复后批量转录
