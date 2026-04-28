/**
 * Daily Echo (每日回响) — Type Definitions
 *
 * Complete TypeScript interfaces and types for the Daily Echo feature.
 * Type-first design: All data structures defined before implementation.
 */

/**
 * Daily Echo Configuration
 * Stored in localStorage under key: 'mindos-daily-echo-config'
 */
export interface DailyEchoConfig {
  /** Enable/disable daily echo reports */
  enabled: boolean;

  /** Scheduled generation time (24-hour format, e.g., "20:00") */
  scheduleTime: string;

  /** Timezone identifier (e.g., "Asia/Shanghai") */
  timezone: string;

  /** Report language */
  language: 'en' | 'zh';

  /** Include chat sessions in analysis */
  includeChat: boolean;

  /** Include 7-day trend analysis (when available) */
  includeTrendAnalysis: boolean;

  /** Target report length */
  maxReportLength: 'short' | 'medium' | 'long';
}

/**
 * Default Daily Echo config
 */
export const DEFAULT_DAILY_ECHO_CONFIG: DailyEchoConfig = {
  enabled: false,
  scheduleTime: '20:00',
  timezone: 'Asia/Shanghai',
  language: 'zh',
  includeChat: true,
  includeTrendAnalysis: true,
  maxReportLength: 'medium',
};

/**
 * Raw aggregated data from 24-hour window
 * Intermediate result from data aggregation layer
 */
export interface DailyEchoRawData {
  /** Date in YYYY-MM-DD format */
  date: string;

  /** Array of file paths edited (for theme extraction) */
  fileNames: string[];

  /** Number of files created in 24-hour window */
  filesCreated: number;

  /** Total number of distinct files edited */
  filesEdited: number;

  /** Number of chat sessions */
  sessionCount: number;

  /** KB growth displayed as "+12 KB" or "same" */
  kbGrowth: string;

  /** User's stated daily intention */
  dailyLine: string;

  /** User's stated long-term growth direction */
  growthIntent: string;
}

/**
 * Quick summary statistics shown in report header
 */
export interface DailySnapshot {
  /** Number of distinct files edited */
  filesEdited: number;

  /** Number of newly created files */
  filesCreated: number;

  /** Number of AI chat sessions */
  sessionCount: number;

  /** Knowledge base growth (e.g., "+12 KB") */
  kbGrowth: string;
}

/**
 * Identified theme/project from user's daily work
 * Result of theme extraction LLM call
 */
export interface DailyTheme {
  /** Human-readable theme name (e.g., "Infrastructure & DevOps") */
  name: string;

  /** Number of files related to this theme */
  fileCount: number;

  /** Percentage of total activity (0-100) */
  percentage: number;

  /** Brief description of this theme's work */
  description: string;

  /** Classification of work type */
  workType: 'strategic' | 'tactical' | 'learning' | 'maintenance';
}

/**
 * Alignment analysis between stated intent and actual work
 * Result of alignment analysis LLM call
 */
export interface AlignmentAnalysis {
  /** Alignment score (0-100), where:
   * 0-40: Misaligned (red)
   * 40-70: Partially aligned (amber)
   * 70-100: Well aligned (green)
   */
  alignmentScore: number;

  /** Markdown narrative analyzing the alignment */
  analysis: string;

  /** Why was there alignment/misalignment? */
  reasoning?: string;
}

/**
 * Reflection prompts to guide user's thinking
 * Result of reflection generation LLM call
 */
export interface ReflectionPrompts {
  /** Array of 2-3 thoughtful questions */
  prompts: string[];
}

/**
 * Growth vector analysis (7-day trends if available)
 * Optional: only included if includeTrendAnalysis enabled and enough history
 */
export interface GrowthVector {
  /** Is user deepening (revisiting) or expanding (new areas)? */
  trend: 'deepening' | 'expanding' | 'balanced';

  /** Velocity metric (e.g., "12 files/week") */
  velocity: string;

  /** Session frequency trend (increasing/steady/decreasing) */
  sessionTrend: 'increasing' | 'steady' | 'decreasing';

  /** Specialization analysis (concentrating or broadening?) */
  specialization: string;

  /** Plain English implication of the trends */
  implication: string;
}

/**
 * Complete Daily Echo Report
 * Stored in IndexedDB under key: 'YYYY-MM-DD'
 */
export interface DailyEchoReport {
  /** Unique identifier (UUID) */
  id: string;

  /** ISO 8601 timestamp when report was generated */
  generatedAt: string;

  /** Date in YYYY-MM-DD format (used as IndexedDB key) */
  date: string;

  /** Quick statistics snapshot */
  snapshot: DailySnapshot;

  /** Identified themes/projects from the day (2-4 items) */
  themes: DailyTheme[];

  /** Alignment analysis */
  alignment: AlignmentAnalysis;

  /** Reflection prompts for user */
  reflectionPrompts: ReflectionPrompts;

  /** Optional: Growth trends if available */
  growthVector?: GrowthVector;

  /** Full markdown version (for export) */
  rawMarkdown: string;
}

/**
 * API Request: Generate Daily Echo Report
 * POST /api/daily-echo/generate
 */
export interface DailyEchoGenerateRequest {
  /** Date to generate report for (defaults to today) */
  date?: string;

  /** Optional force regenerate even if cached */
  force?: boolean;
}

/**
 * API Response: Daily Echo Report generated/retrieved
 * 200 OK response from /api/daily-echo/generate
 */
export interface DailyEchoGenerateResponse {
  /** The generated or cached report */
  report: DailyEchoReport;

  /** Whether this was a cached result vs. newly generated */
  cached: boolean;

  /** When the report was generated */
  generatedAt: string;
}

/**
 * API Error Response
 */
export interface DailyEchoErrorResponse {
  /** Machine-readable error code */
  code:
    | 'no_knowledge_base'
    | 'no_ai_provider'
    | 'generation_failed'
    | 'invalid_date'
    | 'storage_error';

  /** Human-readable error message */
  message: string;

  /** Additional error details (stack trace in dev) */
  details?: string;
}

/**
 * UI State: Report drawer/modal open/close
 */
export interface DailyEchoUIState {
  /** Is the report drawer visible? */
  isOpen: boolean;

  /** Currently displayed report (null = no report loaded) */
  report: DailyEchoReport | null;

  /** Is generation in progress? */
  isGenerating: boolean;

  /** Error state during generation */
  error: string | null;
}

/**
 * Theme extraction LLM prompt request
 * Internal: used for orchestrating LLM calls
 */
export interface ThemeExtractionRequest {
  fileNames: string[];
  language: 'en' | 'zh';
}

/**
 * Theme extraction LLM response
 */
export interface ThemeExtractionResponse {
  themes: DailyTheme[];
}

/**
 * Alignment analysis LLM prompt request
 */
export interface AlignmentAnalysisRequest {
  dailyLine: string;
  growthIntent: string;
  themes: DailyTheme[];
  language: 'en' | 'zh';
}

/**
 * Alignment analysis LLM response
 */
export interface AlignmentAnalysisResponse {
  alignmentScore: number;
  analysis: string;
  reasoning?: string;
}

/**
 * Reflection generation LLM prompt request
 */
export interface ReflectionGenerationRequest {
  alignment: AlignmentAnalysis;
  themes: DailyTheme[];
  dailyLine: string;
  growthIntent: string;
  language: 'en' | 'zh';
}

/**
 * Reflection generation LLM response
 */
export interface ReflectionGenerationResponse {
  prompts: string[];
}

/**
 * Content change event from `/api/changes`
 * Used to track file edits
 */
export interface ContentChangeEvent {
  id: string;
  path: string;
  op: 'create' | 'write' | 'delete' | 'rename' | 'move' | 'append';
  ts: string; // ISO 8601
}

/**
 * Chat session from `/api/ask-sessions`
 * Used to count sessions in 24-hour window
 */
export interface ChatSession {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  title?: string;
  messageCount: number;
}

/**
 * Export/download format options
 */
export type DailyEchoExportFormat = 'markdown' | 'pdf' | 'json';
