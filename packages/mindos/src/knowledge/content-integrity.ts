export type AgentWriteIntegrityOperation =
  | 'write_file'
  | 'save_file'
  | 'create_file'
  | 'batch_create_files'
  | 'append_to_file'
  | 'insert_lines'
  | 'update_lines'
  | 'insert_after_heading'
  | 'update_section'
  | 'edit_lines';

export type AgentWriteIntegrityInput = {
  operation: AgentWriteIntegrityOperation;
  path: string;
  content: string;
  isAgentWrite: boolean;
  beforeContent?: string;
  allowShrink?: boolean;
  allowTruncatedContent?: boolean;
  allowEmpty?: boolean;
};

const SUSPICIOUS_SHRINK_MIN_BEFORE_CHARS = 8_000;
const SUSPICIOUS_SHRINK_MIN_DELTA_CHARS = 4_000;
const SUSPICIOUS_SHRINK_RATIO = 0.6;

const TRUNCATION_MARKERS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'MindOS truncated-read marker', pattern: /\[\.\.\.\s*truncated\b/i },
  { label: 'MindOS paginated-read marker', pattern: /\[\s*Showing characters \d+/i },
  { label: 'MindOS read_file_chunk hint', pattern: /\[Use read_file_chunk to read the rest of the file/i },
  { label: 'MindOS relevance-extraction marker', pattern: /\[\.\.\.extracted \d+\/\d+ paragraphs by relevance\b/i },
  { label: 'MindOS context-preflight marker', pattern: /MindOS context preflight:\s*middle content omitted/i },
];

export function readBooleanFlag(
  params: Record<string, unknown>,
  snakeName: string,
  camelName = snakeName.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
): boolean {
  return params[snakeName] === true || params[camelName] === true;
}

export function findMindosTruncationMarker(content: string): string | null {
  for (const marker of TRUNCATION_MARKERS) {
    if (marker.pattern.test(content)) return marker.label;
  }
  return null;
}

export function assertSafeAgentWriteContent(input: AgentWriteIntegrityInput): void {
  if (!input.isAgentWrite) return;

  if (!input.allowTruncatedContent) {
    const marker = findMindosTruncationMarker(input.content);
    if (marker) {
      throw new Error(
        `refusing to write potentially truncated content to ${input.path}: found ${marker}. `
        + 'Re-read the source with paginated/chunked reads and write the complete content, '
        + 'or pass allow_truncated_content=true only when this marker is intentional prose.',
      );
    }
  }

  if (input.operation === 'create_file' || input.operation === 'batch_create_files') {
    if (!input.allowEmpty && input.content.length === 0) {
      throw new Error(
        `refusing to create empty file ${input.path}: agent-created empty files often mean the tool payload was truncated. `
        + 'Pass allow_empty=true only when an empty file is intentional.',
      );
    }
  }

  if ((input.operation === 'write_file' || input.operation === 'save_file') && input.content.length === 0 && !input.allowShrink) {
    throw new Error(
      `refusing to write empty content to ${input.path}: empty full-file writes often mean the tool payload was truncated. `
      + 'Pass allow_shrink=true only after verifying that clearing the file is intentional.',
    );
  }

  if (input.beforeContent === undefined || input.allowShrink) return;

  const beforeChars = input.beforeContent.length;
  const afterChars = input.content.length;
  const shrinkChars = beforeChars - afterChars;
  if (
    beforeChars >= SUSPICIOUS_SHRINK_MIN_BEFORE_CHARS
    && shrinkChars >= SUSPICIOUS_SHRINK_MIN_DELTA_CHARS
    && afterChars <= beforeChars * SUSPICIOUS_SHRINK_RATIO
  ) {
    throw new Error(
      `refusing to shrink ${input.path} from ${beforeChars} to ${afterChars} chars via ${input.operation}: `
      + 'this looks like a truncated full-file write. Use edit_lines/update_section/append_to_file for partial edits, '
      + 'or pass allow_shrink=true only after verifying the complete replacement content.',
    );
  }
}
