/**
 * Daily Echo LLM Prompt Builders
 *
 * Constructs structured prompts for theme extraction, alignment analysis,
 * and reflection generation
 */

import type {
  DailyTheme,
  AlignmentAnalysis,
  ThemeExtractionRequest,
  AlignmentAnalysisRequest,
  ReflectionGenerationRequest,
} from './types';

/**
 * Build prompt for theme extraction from file names
 */
export function buildThemeExtractionPrompt(
  opts: ThemeExtractionRequest
): string {
  const lang = opts.language === 'zh' ? '中文' : 'English';
  const fileList = opts.fileNames.slice(0, 20).join(', ');

  if (opts.language === 'zh') {
    return `从以下文件名和编辑活动中提取用户今天的工作主题。

文件列表：${fileList}${opts.fileNames.length > 20 ? ` ...等 ${opts.fileNames.length - 20} 个文件` : ''}

任务：
1. 识别 2-4 个相关的工作主题/项目
2. 每个主题包括：名称、文件数量、活动占比、简短描述、工作类型（strategy/tactical/learning/maintenance）
3. 返回有效的 JSON 数组格式

返回格式（仅返回 JSON，无其他文本）：
[
  {
    "name": "基础设施 & DevOps",
    "fileCount": 4,
    "percentage": 65,
    "description": "环境搭建和部署配置",
    "workType": "strategic"
  },
  ...
]`;
  }

  return `Extract work themes from the following file names and edit activity.

File list: ${fileList}${opts.fileNames.length > 20 ? `, ...and ${opts.fileNames.length - 20} more files` : ''}

Task:
1. Identify 2-4 coherent work themes/projects
2. For each theme: name, file count, activity percentage, brief description, work type (strategic/tactical/learning/maintenance)
3. Return valid JSON array format

Return format (JSON only, no other text):
[
  {
    "name": "Infrastructure & DevOps",
    "fileCount": 4,
    "percentage": 65,
    "description": "Environment setup and deployment configuration",
    "workType": "strategic"
  },
  ...
]`;
}

/**
 * Build prompt for alignment analysis
 */
export function buildAlignmentPrompt(
  opts: AlignmentAnalysisRequest
): string {
  const themesText = opts.themes
    .map(
      t =>
        `- ${t.name} (${t.fileCount} files, ${t.percentage}%): ${t.description}`
    )
    .join('\n');

  if (opts.language === 'zh') {
    return `分析用户今天的工作与声明意图的对齐度。

用户声明：
- 今日焦点："${opts.dailyLine || '（未设定）'}"
- 长期成长方向："${opts.growthIntent || '（未设定）'}"

实际今日工作主题：
${themesText}

任务：
1. 计算对齐度评分（0-100）：
   - 0-40：显著偏离
   - 40-70：部分对齐
   - 70-100：充分对齐
2. 用 1-2 句话解释对齐/偏离原因
3. 返回 JSON 格式

返回格式（仅返回 JSON）：
{
  "alignmentScore": 65,
  "analysis": "主要集中在基础设施搭建（65%），而非原计划的 async 文档编写...",
  "reasoning": "优先级转移或约束条件改变"
}`;
  }

  return `Analyze alignment between user's stated intent and actual daily work.

User's declarations:
- Daily focus: "${opts.dailyLine || '(not set)'}"
- Long-term growth: "${opts.growthIntent || '(not set)'}"

Actual today's work themes:
${themesText}

Task:
1. Calculate alignment score (0-100):
   - 0-40: Significantly misaligned
   - 40-70: Partially aligned
   - 70-100: Well aligned
2. Explain alignment/misalignment in 1-2 sentences
3. Return JSON format

Return format (JSON only):
{
  "alignmentScore": 65,
  "analysis": "Focused on infrastructure setup (65%) rather than planned async documentation...",
  "reasoning": "Priority shift or changed constraints"
}`;
}

/**
 * Build prompt for reflection question generation
 */
export function buildReflectionPromptsPrompt(
  opts: ReflectionGenerationRequest
): string {
  const alignmentCategory =
    opts.alignment.alignmentScore >= 70
      ? '充分对齐'
      : opts.alignment.alignmentScore >= 40
        ? '部分对齐'
        : '显著偏离';

  const themesText = opts.themes
    .map(t => `- ${t.name} (${t.percentage}%)`)
    .join('\n');

  if (opts.language === 'zh') {
    return `生成 2-3 个深思的问题，帮助用户反思今天的工作模式。

背景信息：
- 对齐度：${alignmentCategory} (${opts.alignment.alignmentScore}/100)
- 分析：${opts.alignment.analysis}
- 今日焦点：${opts.dailyLine || '（未设定）'}
- 成长方向：${opts.growthIntent || '（未设定）'}

工作主题分布：
${themesText}

风格要求：
- 好奇而非指责（问"为什么"而非"你错了"）
- 帮助用户自我观察而非给出建议
- 与对齐度和主题相关

返回格式（JSON 数组，仅返回 JSON）：
{
  "prompts": [
    "你的成长意图是 X，今天 71% 的时间花在 Y 上。这是正当的优先级转移吗？",
    "你编辑了 6 个文件但只重访了 2 个前期笔记。这是在构建新知识还是巩固浅层理解？"
  ]
}`;
  }

  return `Generate 2-3 thoughtful reflection questions to help user understand their work patterns.

Context:
- Alignment: ${alignmentCategory} (${opts.alignment.alignmentScore}/100)
- Analysis: ${opts.alignment.analysis}
- Daily focus: ${opts.dailyLine || '(not set)'}
- Growth direction: ${opts.growthIntent || '(not set)'}

Work theme distribution:
${themesText}

Style requirements:
- Curious, not judgmental (ask "why" not "you're wrong")
- Help user observe patterns, not prescribe
- Relate to alignment and themes

Return format (JSON array, JSON only):
{
  "prompts": [
    "Your growth intent is X, yet 71% today was Y. Is this a legitimate priority shift?",
    "You edited 6 files but revisited only 2 prior notes. Building new knowledge or reinforcing shallow understanding?"
  ]
}`;
}
