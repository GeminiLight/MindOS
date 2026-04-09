/**
 * Daily Echo Report Generator
 *
 * Orchestrates data aggregation, LLM calls, and report compilation.
 * Runs entirely client-side (browser) since all data sources are browser APIs.
 */

import type {
  DailyEchoReport,
  DailyEchoConfig,
  DailyTheme,
  AlignmentAnalysis,
  ReflectionPrompts,
  DailySnapshot,
} from './types';
import { aggregateDailyData } from './aggregator';
import { generateSnapshot } from './snapshot';
import {
  buildThemeExtractionPrompt,
  buildAlignmentPrompt,
  buildReflectionPromptsPrompt,
} from './prompts';
import { askLLMJSON } from './ask-llm';
import {
  saveDailyEchoReport,
  getDailyEchoReport,
} from '@/lib/db/daily-echo-db';

/**
 * Generate a complete daily echo report
 */
export async function generateDailyEchoReport(
  date: Date = new Date(),
  config: DailyEchoConfig,
  force: boolean = false
): Promise<DailyEchoReport> {
  const dateStr = date.toISOString().split('T')[0];

  // Check cache first
  if (!force) {
    try {
      const cached = await getDailyEchoReport(dateStr);
      if (cached) return cached;
    } catch {
      // IndexedDB may not be available; continue
    }
  }

  // 1. Aggregate raw data
  const raw = await aggregateDailyData(date);

  // 2. Generate snapshot
  const snapshot = generateSnapshot(raw);

  // 3. Extract themes via LLM
  let themes: DailyTheme[] = [];
  if (raw.fileNames.length > 0) {
    try {
      const prompt = buildThemeExtractionPrompt({
        fileNames: raw.fileNames,
        language: config.language,
      });
      const parsed = await askLLMJSON<DailyTheme[]>(prompt);
      if (Array.isArray(parsed)) themes = parsed;
    } catch (err) {
      console.warn('[DailyEcho] Theme extraction failed:', err);
    }
  }

  // 4. Alignment analysis via LLM
  let alignment: AlignmentAnalysis = {
    alignmentScore: 50,
    analysis: config.language === 'zh'
      ? '今日数据不足以进行对齐分析。'
      : 'Insufficient data for alignment analysis.',
  };

  if (raw.dailyLine || raw.growthIntent) {
    try {
      const prompt = buildAlignmentPrompt({
        dailyLine: raw.dailyLine,
        growthIntent: raw.growthIntent,
        themes,
        language: config.language,
      });
      const parsed = await askLLMJSON<AlignmentAnalysis>(prompt);
      if (parsed && typeof parsed.alignmentScore === 'number') {
        alignment = {
          alignmentScore: Math.max(0, Math.min(100, parsed.alignmentScore)),
          analysis: parsed.analysis || alignment.analysis,
          reasoning: parsed.reasoning,
        };
      }
    } catch (err) {
      console.warn('[DailyEcho] Alignment analysis failed:', err);
    }
  }

  // 5. Generate reflection prompts via LLM
  let reflectionPrompts: ReflectionPrompts = { prompts: [] };
  try {
    const prompt = buildReflectionPromptsPrompt({
      alignment,
      themes,
      dailyLine: raw.dailyLine,
      growthIntent: raw.growthIntent,
      language: config.language,
    });
    const parsed = await askLLMJSON<{ prompts: string[] }>(prompt);
    if (parsed?.prompts && Array.isArray(parsed.prompts)) {
      reflectionPrompts = { prompts: parsed.prompts.slice(0, 3) };
    }
  } catch (err) {
    console.warn('[DailyEcho] Reflection generation failed:', err);
  }

  // 6. Compile markdown
  const markdown = compileReportMarkdown(
    dateStr, snapshot, themes, alignment, reflectionPrompts, config.language
  );

  // 7. Assemble report
  const report: DailyEchoReport = {
    id: crypto.randomUUID(),
    date: dateStr,
    generatedAt: new Date().toISOString(),
    snapshot,
    themes,
    alignment,
    reflectionPrompts,
    rawMarkdown: markdown,
  };

  // 8. Persist
  try {
    await saveDailyEchoReport(report);
  } catch {
    // IndexedDB may not be available
  }

  return report;
}

/**
 * Compile report as markdown (for export)
 */
function compileReportMarkdown(
  date: string,
  snapshot: DailySnapshot,
  themes: DailyTheme[],
  alignment: AlignmentAnalysis,
  reflections: ReflectionPrompts,
  language: 'en' | 'zh'
): string {
  const zh = language === 'zh';
  let md = zh ? `# 每日回响 — ${date}\n\n` : `# Daily Echo — ${date}\n\n`;

  // Snapshot
  md += zh ? '## 今日动向\n' : '## Today\'s Motion\n';
  md += zh
    ? `- **文件编辑**：${snapshot.filesEdited} 个文件，${snapshot.filesCreated} 个新建\n`
    : `- **Files edited**: ${snapshot.filesEdited}, ${snapshot.filesCreated} new\n`;
  md += zh
    ? `- **聊天会话**：${snapshot.sessionCount} 次\n`
    : `- **Chat sessions**: ${snapshot.sessionCount}\n`;
  md += zh
    ? `- **知识库增长**：${snapshot.kbGrowth}\n\n`
    : `- **KB growth**: ${snapshot.kbGrowth}\n\n`;

  // Themes
  if (themes.length > 0) {
    md += zh ? '## 今日主题\n' : '## Today\'s Themes\n';
    for (const t of themes) {
      md += `### ${t.name}\n`;
      md += zh
        ? `- **文件数**：${t.fileCount}  |  **占比**：${t.percentage}%  |  **类型**：${t.workType}\n`
        : `- **Files**: ${t.fileCount}  |  **Activity**: ${t.percentage}%  |  **Type**: ${t.workType}\n`;
      md += `- ${t.description}\n\n`;
    }
  }

  // Alignment
  md += zh ? '## 对齐度分析\n' : '## Alignment Analysis\n';
  md += `**${zh ? '评分' : 'Score'}**: ${alignment.alignmentScore}/100\n\n`;
  md += `${alignment.analysis}\n\n`;

  // Reflection
  if (reflections.prompts.length > 0) {
    md += zh ? '## 明天思考\n' : '## For Tomorrow\n';
    for (let i = 0; i < reflections.prompts.length; i++) {
      md += `${i + 1}. ${reflections.prompts[i]}\n`;
    }
  }

  return md;
}
