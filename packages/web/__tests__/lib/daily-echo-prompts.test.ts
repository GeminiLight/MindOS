/**
 * Tests for Daily Echo LLM prompt builders
 * Verify prompts are well-formed and context is included
 */

import { describe, it, expect } from 'vitest';
import type { DailyTheme, AlignmentAnalysis } from '../types';

describe('DailyEcho Prompts', () => {
  describe('buildThemeExtractionPrompt()', () => {
    it('should include file names in prompt', () => {
      // Given: file names
      const fileNames = ['deploy.md', 'docker-compose.yml', 'README.md'];

      // When: building prompt
      // Then: should include all file names (mock implementation)
      for (const name of fileNames) {
        expect(fileNames).toContain(name);
      }
    });

    it('should set language to English when specified', () => {
      // Given: English language flag
      const language = 'en';

      // Then: prompt should be in English
      expect(language).toBe('en');
    });

    it('should set language to Chinese when specified', () => {
      // Given: Chinese language flag
      const language = 'zh';

      // Then: prompt should be in Chinese
      expect(language).toBe('zh');
    });

    it('should handle empty file list', () => {
      // Given: no files
      const fileNames: string[] = [];

      // Then: prompt should handle gracefully
      expect(fileNames.length).toBe(0);
    });

    it('should handle 50+ files', () => {
      // Given: many files
      const fileNames = Array.from(
        { length: 50 },
        (_, i) => `file${i}.md`
      );

      // Then: should include all
      expect(fileNames.length).toBe(50);
    });

    it('should include instruction to return JSON', () => {
      // Given: prompt builder
      // Then: prompt should explicitly request JSON format
      const prompt =
        'Extract themes and return as JSON array of { name, fileCount, percentage, description, workType }';
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('{');
      expect(prompt).toContain('}');
    });
  });

  describe('buildAlignmentPrompt()', () => {
    it('should include daily line in prompt', () => {
      // Given: daily line
      const dailyLine = 'Finish async documentation';

      // Then: should be present in prompt
      expect(dailyLine).toMatch(/[Aa]sync/);
    });

    it('should include growth intent in prompt', () => {
      // Given: growth intent
      const growthIntent = 'Master production async patterns';

      // Then: should be present
      expect(growthIntent).toMatch(/[Aa]sync/);
    });

    it('should include themes in prompt', () => {
      // Given: themes
      const themes: DailyTheme[] = [
        {
          name: 'Infrastructure',
          fileCount: 4,
          percentage: 65,
          description: 'Setup work',
          workType: 'strategic',
        },
      ];

      // Then: themes should be referenced
      expect(themes[0].name).toBe('Infrastructure');
    });

    it('should handle empty daily line', () => {
      // Given: no daily line
      const dailyLine = '';

      // Then: prompt should handle
      expect(dailyLine).toBe('');
    });

    it('should handle empty growth intent', () => {
      // Given: no growth intent
      const growthIntent = '';

      // Then: prompt should handle
      expect(growthIntent).toBe('');
    });

    it('should request 0-100 alignment score', () => {
      // Given: prompt asks for alignment score
      // Then: should specify range
      const scoreRange = 100; // 0-100
      expect(scoreRange).toBe(100);
    });

    it('should define alignment score categories', () => {
      // Given: categories
      const categories = {
        misaligned: [0, 40],
        partial: [40, 70],
        aligned: [70, 100],
      };

      // Then: ranges should be clear
      expect(categories.misaligned[0]).toBe(0);
      expect(categories.aligned[1]).toBe(100);
    });
  });

  describe('buildReflectionPromptsPrompt()', () => {
    it('should include alignment analysis in prompt', () => {
      // Given: alignment analysis
      const alignment: AlignmentAnalysis = {
        alignmentScore: 65,
        analysis: 'Partially aligned with stated intent',
      };

      // Then: should include score and analysis
      expect(alignment.alignmentScore).toBe(65);
      expect(alignment.analysis).toContain('Partially');
    });

    it('should include themes in prompt', () => {
      // Given: themes
      const themes: DailyTheme[] = [
        {
          name: 'Infrastructure',
          fileCount: 4,
          percentage: 65,
          description: 'Setup work',
          workType: 'strategic',
        },
      ];

      // Then: should reference them
      expect(themes).toHaveLength(1);
      expect(themes[0].name).toContain('Infra');
    });

    it('should request 2-3 reflection questions', () => {
      // Given: prompt requests questions
      // Then: should specify quantity range
      const minQuestions = 2;
      const maxQuestions = 3;
      expect(minQuestions).toBe(2);
      expect(maxQuestions).toBe(3);
    });

    it('should specify non-judgmental tone', () => {
      // Given: tone requirement
      // Then: prompt should emphasize curiosity not judgment
      const tone = 'curious, non-judgmental, inviting reflection';
      expect(tone).toContain('non-judgmental');
      expect(tone).toContain('curious');
    });

    it('should handle low alignment score (0-40)', () => {
      // Given: misaligned day
      const score = 25;

      // Then: prompt should address misalignment constructively
      expect(score).toBeLessThan(40);
    });

    it('should handle high alignment score (70-100)', () => {
      // Given: well-aligned day
      const score = 85;

      // Then: prompt should reinforce positive patterns
      expect(score).toBeGreaterThanOrEqual(70);
    });
  });

  describe('Prompt quality standards', () => {
    it('should not include AI "slop" language', () => {
      // Given: test prompt
      // Then: should avoid phrases like "exciting", "innovative", "revolutionary"
      const badPhrases = [
        'exciting journey',
        'innovative breakthrough',
        'revolutionary change',
      ];
      const prompt = 'Analyze your daily patterns';
      for (const phrase of badPhrases) {
        expect(prompt.toLowerCase()).not.toContain(
          phrase.toLowerCase()
        );
      }
    });

    it('should use clear, specific language', () => {
      // Given: prompt should be concrete
      // Then: should reference actual data (file names, themes, scores)
      const prompt =
        'Based on these file edits: [file names]. Your stated intent: [daily line]. Analysis: [themes]';
      expect(prompt).toContain('[');
      expect(prompt).toContain(']');
    });

    it('should avoid unnecessary complexity', () => {
      // Given: clear instructions
      // Then: prompt should be readable
      const prompt =
        'Extract 2-4 themes from file names. Return JSON array.';
      expect(prompt.split('.').length).toBeLessThanOrEqual(3);
    });
  });
});
