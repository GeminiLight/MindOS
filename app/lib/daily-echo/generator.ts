/**
 * Daily Echo Report Generator
 *
 * Orchestrates data aggregation, LLM calls, and report compilation
 */

import { v4 as uuidv4 } from 'uuid';
import { apiFetch } from '@/lib/api';
import type {
  DailyEchoReport,
  DailyEchoConfig,
  DailyEchoRawData,
  DailyTheme,
  AlignmentAnalysis,
  ReflectionPrompts,
  ThemeExtractionResponse,
  AlignmentAnalysisResponse,
  ReflectionGenerationResponse,
} from './types';
import { aggregateDailyData } from './aggregator';
import { generateSnapshot } from './snapshot';
import {
  buildThemeExtractionPrompt,
  buildAlignmentPrompt,
  buildReflectionPromptsPrompt,
} from './prompts';
import {
  saveDailyEchoReport,
  getDailyEchoReport,
} from '@/lib/db/daily-echo-db';

/**
 * Generate a complete daily echo report
 *
 * @param date - Date to generate for (defaults to today)
 * @param config - Daily Echo configuration
 * @param force - Force regenerate even if cached
 * @returns Generated report
 */
export async function generateDailyEchoReport(
  date: Date = new Date(),
  config: DailyEchoConfig,
  force: boolean = false
): Promise<DailyEchoReport> {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

  // Check cache
  if (!force) {
    try {
      const cached = await getDailyEchoReport(dateStr);
      if (cached) {
        return cached;
      }
    } catch (err) {
      console.warn('[DailyEcho] Cache check failed:', err);
    }
  }

  try {
    // 1. Aggregate raw data
    const raw = await aggregateDailyData(date);

    // 2. Generate snapshot
    const snapshot = generateSnapshot(raw);

    // 3. Extract themes via LLM
    let themes: DailyTheme[] = [];
    try {
      const themePrompt = buildThemeExtractionPrompt({
        fileNames: raw.fileNames,
        language: config.language,
      });

      const themeRes = await apiFetch<ThemeExtractionResponse>(
        '/api/ask',
        {
          method: 'POST',
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: themePrompt,
              },
            ],
            maxSteps: 5,
          }),
          timeout: 10000,
        }
      );

      themes = themeRes.themes ?? [];
    } catch (err) {
      console.warn('[DailyEcho] Theme extraction failed:', err);
      themes = [];
    }

    // 4. Alignment analysis via LLM
    let alignment: AlignmentAnalysis = {
      alignmentScore: 60,
      analysis: 'Unable to analyze alignment',
    };

    try {
      const alignmentPrompt = buildAlignmentPrompt({
        dailyLine: raw.dailyLine,
        growthIntent: raw.growthIntent,
        themes,
        language: config.language,
      });

      const alignmentRes = await apiFetch<AlignmentAnalysisResponse>(
        '/api/ask',
        {
          method: 'POST',
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: alignmentPrompt,
              },
            ],
            maxSteps: 5,
          }),
          timeout: 10000,
        }
      );

      alignment = {
        alignmentScore: alignmentRes.alignmentScore ?? 60,
        analysis: alignmentRes.analysis ?? 'Analysis unavailable',
        reasoning: alignmentRes.reasoning,
      };
    } catch (err) {
      console.warn('[DailyEcho] Alignment analysis failed:', err);
    }

    // 5. Generate reflection prompts via LLM
    let reflectionPrompts: ReflectionPrompts = { prompts: [] };

    try {
      const reflectionPrompt = buildReflectionPromptsPrompt({
        alignment,
        themes,
        dailyLine: raw.dailyLine,
        growthIntent: raw.growthIntent,
        language: config.language,
      });

      const reflectionRes = await apiFetch<ReflectionGenerationResponse>(
        '/api/ask',
        {
          method: 'POST',
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: reflectionPrompt,
              },
            ],
            maxSteps: 5,
          }),
          timeout: 10000,
        }
      );

      reflectionPrompts = {
        prompts: reflectionRes.prompts ?? [],
      };
    } catch (err) {
      console.warn('[DailyEcho] Reflection generation failed:', err);
    }

    // 6. Compile markdown
    const markdown = compileReportMarkdown(
      dateStr,
      snapshot,
      themes,
      alignment,
      reflectionPrompts,
      config.language
    );

    // 7. Create report object
    const report: DailyEchoReport = {
      id: uuidv4(),
      date: dateStr,
      generatedAt: new Date().toISOString(),
      snapshot,
      themes,
      alignment,
      reflectionPrompts,
      rawMarkdown: markdown,
    };

    // 8. Persist to storage
    try {
      await saveDailyEchoReport(report);
    } catch (err) {
      console.warn('[DailyEcho] Failed to persist report:', err);
    }

    return report;
  } catch (err) {
    console.error('[DailyEcho] Report generation failed:', err);
    // Return error report
    throw new Error(
      `Failed to generate daily echo report: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

/**
 * Compile report as markdown
 */
function compileReportMarkdown(
  date: string,
  snapshot: any,
  themes: DailyTheme[],
  alignment: AlignmentAnalysis,
  reflections: ReflectionPrompts,
  language: 'en' | 'zh'
): string {
  if (language === 'zh') {
    let md = `# 每日回响 — ${date}\n\n`;

    md += `## 📊 今日动向\n`;
    md += `- **文件编辑**：${snapshot.filesEdited} 个文件，${snapshot.filesCreated} 个新建\n`;
    md += `- **聊天会话**：${snapshot.sessionCount} 次\n`;
    md += `- **知识库增长**：${snapshot.kbGrowth}\n\n`;

    if (themes.length > 0) {
      md += `## 🎯 今日主题\n`;
      for (const theme of themes) {
        md += `### ${theme.name}\n`;
        md += `- **文件数**：${theme.fileCount}\n`;
        md += `- **占比**：${theme.percentage}%\n`;
        md += `- **类型**：${theme.workType}\n`;
        md += `- **说明**：${theme.description}\n\n`;
      }
    }

    md += `## ✅ 对齐度分析\n`;
    md += `**评分**：${alignment.alignmentScore}/100\n\n`;
    md += `${alignment.analysis}\n\n`;

    if (reflections.prompts.length > 0) {
      md += `## ❓ 明天思考\n`;
      for (let i = 0; i < reflections.prompts.length; i++) {
        md += `${i + 1}. ${reflections.prompts[i]}\n`;
      }
    }

    return md;
  }

  // English
  let md = `# Daily Echo — ${date}\n\n`;

  md += `## 📊 Today's Motion\n`;
  md += `- **Files edited**: ${snapshot.filesEdited} files, ${snapshot.filesCreated} new\n`;
  md += `- **Chat sessions**: ${snapshot.sessionCount}\n`;
  md += `- **Knowledge base growth**: ${snapshot.kbGrowth}\n\n`;

  if (themes.length > 0) {
    md += `## 🎯 Today's Themes\n`;
    for (const theme of themes) {
      md += `### ${theme.name}\n`;
      md += `- **Files**: ${theme.fileCount}\n`;
      md += `- **Activity**: ${theme.percentage}%\n`;
      md += `- **Type**: ${theme.workType}\n`;
      md += `- **Description**: ${theme.description}\n\n`;
    }
  }

  md += `## ✅ Alignment Analysis\n`;
  md += `**Score**: ${alignment.alignmentScore}/100\n\n`;
  md += `${alignment.analysis}\n\n`;

  if (reflections.prompts.length > 0) {
    md += `## ❓ For Tomorrow\n`;
    for (let i = 0; i < reflections.prompts.length; i++) {
      md += `${i + 1}. ${reflections.prompts[i]}\n`;
    }
  }

  return md;
}
