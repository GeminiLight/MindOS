/**
 * Echo agreement detection — find the standing rules a person has given their agents.
 *
 * Why deterministic rather than a model call: an agreement is injected into every
 * agent's startup context once approved, so its evidence has to be auditable and
 * reproducible, and the quote shown back has to be the user's own words. It also
 * keeps working with no model configured, which is the local-first default.
 *
 * ## What dogfooding changed
 *
 * The first version keyed entirely on *repetition*: a correction had to recur
 * across two separate sessions before it counted. Run against 90 days of real
 * Claude Code and Codex transcripts that produced **zero** true positives and six
 * false positives. Two reasons, both structural:
 *
 * 1. People do not repeat a correction verbatim across sessions. They work one
 *    topic per long session and steer in the moment. The one genuine standing
 *    rule in the whole corpus was stated exactly once — on purpose, with the word
 *    "以后".
 * 2. `不要` and `不能` are substrings of extremely common non-corrective phrases
 *    (`要不要` = "shall we", `也不能说` = "can't quite say"). Every single match
 *    was one of those.
 *
 * So the primary signal is now **intent to legislate**, not frequency: when
 * someone says 以后 / 下次 / 默认 / 一律 / from now on / always, they are
 * declaring a durable preference and once is enough. Repeated corrections are
 * kept as a weaker second path that still has to clear the cross-session bar.
 *
 * That same run also showed 5776 of 5834 sessions were a single batch script, so
 * stripping non-human traffic is part of the contract, not a nicety.
 */

export type AgreementSourceMessage = {
  role: string;
  content: string;
};

export type AgreementSourceSession = {
  id: string;
  title?: string;
  runtime?: string;
  createdAt?: number;
  updatedAt?: number;
  messages: AgreementSourceMessage[];
};

export type AgreementMessageRef = {
  messageIndex: number;
  role: string;
  quote: string;
};

export type AgreementSessionRef = {
  id: string;
  title?: string;
  runtime?: string;
  messageRefs: AgreementMessageRef[];
};

/** How the candidate qualified. `directive` is the stronger, intent-based signal. */
export type AgreementTrigger = 'directive' | 'repetition';

export type DetectedAgreement = {
  /** Stable cluster key — the same rule yields the same signature across runs. */
  signature: string;
  trigger: AgreementTrigger;
  title: string;
  content: string;
  occurrenceCount: number;
  sessionCount: number;
  latestAt?: number;
  sessions: AgreementSessionRef[];
};

export type DetectEchoAgreementsOptions = {
  maxAgreements?: number;
};

const DEFAULT_MAX_AGREEMENTS = 3;
/** The weaker repetition path still needs this much corroboration. */
const MIN_REPETITION_OCCURRENCES = 2;
const MIN_REPETITION_SESSIONS = 2;
/** An opener repeated verbatim this often across sessions is a script, not a person. */
const AUTOMATION_OPENER_THRESHOLD = 3;
const AUTOMATION_OPENER_KEY_CHARS = 160;
/** A rule is something typed in the moment; beyond this it is a pasted document. */
const MAX_UTTERANCE_CHARS = 600;
const MAX_QUOTE_CHARS = 240;
const MAX_TITLE_CHARS = 48;
const MIN_RULE_HEAD_CHARS = 4;
/** Below this a stripped rule carries no instruction a later agent could follow. */
const MIN_RULE_BODY_CHARS = 5;
const MAX_SCANNED_MESSAGES_PER_SESSION = 400;
const SIGNATURE_TOKEN_LIMIT = 12;
const CLUSTER_SIMILARITY_THRESHOLD = 0.5;

/**
 * Explicit "this is a standing rule" markers. One occurrence qualifies, because
 * the user is legislating rather than reacting.
 */
const DIRECTIVE_PATTERNS: readonly RegExp[] = [
  /以后(都|请|记得|不要|别|一律|统一|就)/,
  /下次(记得|别|不要|就)/,
  /记住[，,：:]/,
  /默认(就|都|用|走|改成)/,
  /一律/,
  /统一(用|走|改成|成)/,
  // "每次都" alone is usually描述 rather than instruction — "codex 每次都要重新连接"
  // reports a symptom. Require an explicit instruction verb after it.
  /每次都(要记得|请|用|走|改成)/,
  /\bfrom now on\b/i,
  /\balways\b/i,
  /\bby default\b/i,
  /\bgoing forward\b/i,
];

/**
 * Corrective reactions. Weaker evidence: a person pushing back in the moment may
 * just be steering this one task, so these only count when they recur.
 */
const CORRECTION_PATTERNS: readonly RegExp[] = [
  /不要/,
  /别(用|再|忘|直接|写|加|改|删|搞)/,
  /别忘/,
  /不准/,
  /禁止/,
  /改掉/,
  /说了多少次/,
  /说过多少次/,
  /跟你说过/,
  /又(用|改|忘|写|漏|来)/,
  /不是说过/,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bnever\b/i,
  /\bstop (using|doing|adding)\b/i,
  /\bi (already )?(said|told you)\b/i,
  /\bplease (don'?t|do not|stop)\b/i,
];

/** Phrasings that state a rule outright, as opposed to complaining about a breach. */
const PROHIBITION_PATTERNS: readonly RegExp[] = [
  /不要/,
  /别[用再忘直写加改删搞]/,
  /不准/,
  /禁止/,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bnever\b/i,
];

/**
 * Phrases that embed a negation without being one. Neutralised before matching so
 * `要不要…` ("shall we…") cannot look like `不要…` ("don't…"). Every false positive
 * in the dogfood run came from this list.
 */
const NEGATION_LOOKALIKES: readonly RegExp[] = [
  /要不要/g,
  /能不能/g,
  /行不行/g,
  /好不好/g,
  /是不是/g,
  /会不会/g,
  /用不用/g,
  /可不可以/g,
  /不能不/g,
  /也?不能说/g,
  /不得不/g,
];

/** Text that arrives on the user channel but no human typed. */
const SYNTHETIC_TURN_PATTERNS: readonly RegExp[] = [
  /^A session-scoped .{0,40}hook is now active/i,
  /^Caveat: The messages below were generated/i,
  /^\[Request interrupted/i,
  /^This session is being continued from a previous/i,
  /^#\s*AGENTS/,
  /^<[a-z-]+>/i,
  /^\s*```/,
];

/** Leading filler that is venting or scaffolding rather than the rule itself. */
const LEADING_FILLER_PATTERNS: readonly RegExp[] = [
  /^先别提交[。.!！]?\s*/,
  /^说了多少次[，,：:]?\s*/,
  /^说过多少次[，,：:]?\s*/,
  /^跟你说过[，,：:]?\s*/,
  /^不是说过[，,：:]?\s*/,
  /^又[用改忘写漏来][^，,。.]{0,12}[，,。.]\s*/,
  /^(可以|好的|行|ok|OK)[，,]\s*(不过|但是|但)\s*/,
  /^这里\s*/,
  /^i (already )?(said|told you)\s*(again)?[,:]?\s*/i,
  /^please\s+/i,
];

/** Directive markers are the cue, not the rule; drop them from the stored text. */
const DIRECTIVE_PREFIX_PATTERNS: readonly RegExp[] = [
  /^以后(除非[^，,]{0,20}[，,])?\s*(都|请|记得|一律|统一|就)?\s*/,
  /^下次\s*(记得|就)?\s*/,
  /^记住[，,：:]\s*/,
  /^每次\s*(都|记得)?\s*/,
  /^from now on[,:]?\s*/i,
  /^going forward[,:]?\s*/i,
  /^always\s+/i,
];

const STOPWORDS = new Set([
  '不要', '不能', '不准', '禁止', '改掉', '说了', '多少次', '说过', '以后', '下次', '记住',
  '这里', '这个', '那个', '一下', '一个', '我们', '可以', '不过', '其他', '没问题', '先别',
  '帮我', '谢谢', '就是', '已经', '还是', '什么', '怎么', '为什么', '默认', '一律', '统一',
  '请', '的', '了', '是', '在', '和', '与', '把', '被', '给', '对', '从', '到', '再', '又',
  '也', '都', '很', '太',
  'dont', "don't", 'do', 'not', 'never', 'stop', 'using', 'use', 'said', 'told', 'you', 'i',
  'again', 'please', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'is', 'are',
  'was', 'were', 'be', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but',
  'here', 'there', 'should', 'would', 'could', 'can', 'will', 'just', 'now', 'already',
  'instead', 'no', 'longer', 'properly', 'from', 'going', 'forward', 'always', 'default',
]);

export function detectEchoAgreements(
  sessions: AgreementSourceSession[],
  options: DetectEchoAgreementsOptions = {},
): DetectedAgreement[] {
  const maxAgreements = normalizeMaxAgreements(options.maxAgreements);
  if (maxAgreements === 0) return [];
  if (!Array.isArray(sessions)) return [];

  const human = dropAutomationSessions(dedupeSessionsById(sessions));
  const utterances = human.flatMap(collectUtterances);

  const directives = utterances
    .filter((u) => u.trigger === 'directive')
    .map(toDirectiveAgreement);

  const repetitions = clusterRepeatedCorrections(utterances.filter((u) => u.trigger === 'correction'));

  // Directives first: an explicit rule outranks an inferred one no matter how
  // many times the inferred one appeared.
  return [...sortByRecency(directives), ...sortByRecency(repetitions)].slice(0, maxAgreements);
}

// ── collecting what a person actually said ───────────────────────────────────

type Utterance = {
  sessionId: string;
  sessionTitle?: string;
  sessionRuntime?: string;
  sessionAt?: number;
  messageIndex: number;
  quote: string;
  ruleText: string;
  trigger: 'directive' | 'correction';
  tokens: Set<string>;
};

function collectUtterances(session: AgreementSourceSession): Utterance[] {
  if (!Array.isArray(session.messages)) return [];
  const found: Utterance[] = [];
  const limit = Math.min(session.messages.length, MAX_SCANNED_MESSAGES_PER_SESSION);

  for (let index = 0; index < limit; index += 1) {
    const message = session.messages[index];
    if (!isRecord(message) || message.role !== 'user' || typeof message.content !== 'string') continue;

    const content = message.content.trim();
    if (!content || content.length > MAX_UTTERANCE_CHARS) continue;
    if (SYNTHETIC_TURN_PATTERNS.some((pattern) => pattern.test(content))) continue;

    const trigger = classify(content);
    if (!trigger) continue;

    const ruleText = extractRuleText(content, trigger);
    if (!ruleText) continue;

    const tokens = signatureTokens(ruleText);
    if (tokens.size === 0) continue;

    found.push({
      sessionId: session.id,
      ...(nonEmpty(session.title) ? { sessionTitle: session.title!.trim() } : {}),
      ...(nonEmpty(session.runtime) ? { sessionRuntime: session.runtime!.trim() } : {}),
      ...(sessionTimestamp(session) !== undefined ? { sessionAt: sessionTimestamp(session) } : {}),
      messageIndex: index,
      quote: truncate(content, MAX_QUOTE_CHARS),
      ruleText,
      trigger,
      tokens,
    });
  }
  return found;
}

function classify(content: string): 'directive' | 'correction' | null {
  const masked = maskNegationLookalikes(content);
  if (DIRECTIVE_PATTERNS.some((pattern) => pattern.test(masked))) return 'directive';
  if (CORRECTION_PATTERNS.some((pattern) => pattern.test(masked))) return 'correction';
  return null;
}

/**
 * Replace rhetorical A-not-A constructions so their negation cannot match.
 * The replacement is the same length as the original so match indices computed
 * on the masked string still point at the right place in the source.
 */
function maskNegationLookalikes(content: string): string {
  let masked = content;
  for (const pattern of NEGATION_LOOKALIKES) {
    masked = masked.replace(pattern, (hit) => '〇'.repeat(hit.length));
  }
  return masked;
}

// ── turning an utterance into a rule ─────────────────────────────────────────

/**
 * The rule starts where the trigger word is, not where the message starts.
 * "要不要加个开关我再想想，但别用 any 类型" is a question followed by a rule; taking
 * the leading clause would store the question instead.
 */
function extractRuleText(content: string, trigger: 'directive' | 'correction'): string {
  const patterns = trigger === 'directive' ? DIRECTIVE_PATTERNS : CORRECTION_PATTERNS;
  const start = earliestMatchIndex(maskNegationLookalikes(content), patterns);
  const sliced = (start > 0 ? content.slice(start) : content).trim();

  const prefixes = trigger === 'directive' ? DIRECTIVE_PREFIX_PATTERNS : LEADING_FILLER_PATTERNS;
  let text = sliced;
  for (const pattern of prefixes) text = text.replace(pattern, '').trim();
  // Stripping the lead-in must not eat the rule itself: "这里又用 any 了，改掉"
  // reduces to a bare "改掉", which says nothing a later agent could act on.
  if (text.length < MIN_RULE_BODY_CHARS) text = sliced;

  return truncate(firstSentence(text), MAX_QUOTE_CHARS);
}

function earliestMatchIndex(masked: string, patterns: readonly RegExp[]): number {
  let earliest = -1;
  for (const pattern of patterns) {
    const index = masked.search(pattern);
    if (index < 0) continue;
    if (earliest < 0 || index < earliest) earliest = index;
  }
  return earliest;
}

/**
 * Keep the rule itself. The clause after the first comma usually describes the
 * one-off situation, which should not travel into every agent's context window.
 */
function firstSentence(text: string): string {
  const sentence = (text.match(/^[^。.!！?？\n]+/)?.[0] ?? text).trim();
  const head = sentence.split(/[，,、；;]/)[0]?.trim() ?? sentence;
  return (head.length >= MIN_RULE_HEAD_CHARS ? head : sentence).replace(/[，,、；;]+$/, '');
}

// ── noise removal ────────────────────────────────────────────────────────────

/**
 * A session id can repeat when a transcript is re-read mid-write; counting both
 * copies would fake the cross-session evidence the repetition path relies on.
 */
function dedupeSessionsById(sessions: AgreementSourceSession[]): AgreementSourceSession[] {
  const seen = new Set<string>();
  const unique: AgreementSourceSession[] = [];
  for (const session of sessions) {
    if (!isRecord(session)) continue;
    const id = typeof session.id === 'string' ? session.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(session);
  }
  return unique;
}

/**
 * Batch jobs open every session with the same prompt. In the dogfood corpus one
 * such script accounted for 5776 of 5834 sessions, and its template contained
 * "不要输出其他文字" — so without this the top candidate is a script's own prompt.
 */
function dropAutomationSessions(sessions: AgreementSourceSession[]): AgreementSourceSession[] {
  const openerCount = new Map<string, number>();
  for (const session of sessions) {
    const opener = firstUserContent(session);
    if (opener) openerCount.set(opener, (openerCount.get(opener) ?? 0) + 1);
  }
  return sessions.filter((session) => {
    const opener = firstUserContent(session);
    return !opener || (openerCount.get(opener) ?? 0) < AUTOMATION_OPENER_THRESHOLD;
  });
}

function firstUserContent(session: AgreementSourceSession): string | null {
  if (!Array.isArray(session.messages)) return null;
  for (const message of session.messages) {
    if (!isRecord(message) || message.role !== 'user' || typeof message.content !== 'string') continue;
    const content = message.content.trim();
    if (content) return content.slice(0, AUTOMATION_OPENER_KEY_CHARS);
  }
  return null;
}

// ── clustering the weaker signal ─────────────────────────────────────────────

type Cluster = { tokens: Set<string>; utterances: Utterance[] };

function clusterRepeatedCorrections(corrections: Utterance[]): DetectedAgreement[] {
  const recurring = keepRecurringTokens(corrections);
  const clusters: Cluster[] = [];
  for (const utterance of recurring) addToCluster(clusters, utterance);

  return clusters
    .filter((cluster) => (
      cluster.utterances.length >= MIN_REPETITION_OCCURRENCES
      && countSessions(cluster) >= MIN_REPETITION_SESSIONS
    ))
    .map(toRepetitionAgreement);
}

/**
 * Reduce each correction to the words it shares with another correction. Phrasing
 * varies far more than topic, so raw set similarity never clusters "别用 any" with
 * "不要使用 any 类型"; a word appearing in only one correction cannot be evidence
 * of a repeat anyway, so dropping it costs nothing.
 */
function keepRecurringTokens(utterances: Utterance[]): Utterance[] {
  const documentFrequency = new Map<string, number>();
  for (const utterance of utterances) {
    for (const token of utterance.tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const reduced: Utterance[] = [];
  for (const utterance of utterances) {
    const tokens = new Set(
      [...utterance.tokens]
        .filter((token) => (documentFrequency.get(token) ?? 0) >= MIN_REPETITION_OCCURRENCES)
        .sort()
        .slice(0, SIGNATURE_TOKEN_LIMIT),
    );
    if (tokens.size === 0) continue;
    reduced.push({ ...utterance, tokens });
  }
  return reduced;
}

function addToCluster(clusters: Cluster[], utterance: Utterance): void {
  let best: { cluster: Cluster; score: number } | null = null;
  for (const cluster of clusters) {
    const score = jaccard(cluster.tokens, utterance.tokens);
    if (score >= CLUSTER_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { cluster, score };
    }
  }
  if (!best) {
    clusters.push({ tokens: new Set(utterance.tokens), utterances: [utterance] });
    return;
  }
  best.cluster.utterances.push(utterance);
  // Keep only the shared core so a cluster cannot drift as members accumulate.
  best.cluster.tokens = intersect(best.cluster.tokens, utterance.tokens);
}

// ── shaping results ──────────────────────────────────────────────────────────

function toDirectiveAgreement(utterance: Utterance): DetectedAgreement {
  return {
    signature: [...utterance.tokens].sort().join('|'),
    trigger: 'directive',
    title: truncate(utterance.ruleText, MAX_TITLE_CHARS),
    content: utterance.ruleText,
    occurrenceCount: 1,
    sessionCount: 1,
    ...(utterance.sessionAt !== undefined ? { latestAt: utterance.sessionAt } : {}),
    sessions: groupBySession([utterance]),
  };
}

function toRepetitionAgreement(cluster: Cluster): DetectedAgreement {
  const sessions = groupBySession(cluster.utterances);
  const timestamps = cluster.utterances
    .map((u) => u.sessionAt)
    .filter((value): value is number => typeof value === 'number');

  return {
    signature: [...cluster.tokens].sort().join('|'),
    trigger: 'repetition',
    title: truncate(pickShortestRule(cluster.utterances), MAX_TITLE_CHARS),
    content: pickShortestRule(cluster.utterances),
    occurrenceCount: cluster.utterances.length,
    sessionCount: sessions.length,
    ...(timestamps.length > 0 ? { latestAt: Math.max(...timestamps) } : {}),
    sessions,
  };
}

/**
 * Prefer the shortest phrasing that still states a prohibition: "不要用 any 类型"
 * is a rule, "又用 any 了" is a complaint about the same thing. Among equally
 * prohibitive phrasings the terse one reads best in an agent's context window.
 */
function pickShortestRule(utterances: Utterance[]): string {
  const byLength = [...utterances].sort((a, b) => a.ruleText.length - b.ruleText.length);
  const prohibitive = byLength.find((u) => PROHIBITION_PATTERNS.some((p) => p.test(u.ruleText)));
  return (prohibitive ?? byLength[0])?.ruleText ?? '';
}

function groupBySession(utterances: Utterance[]): AgreementSessionRef[] {
  const bySession = new Map<string, AgreementSessionRef>();
  for (const utterance of utterances) {
    const ref: AgreementMessageRef = {
      messageIndex: utterance.messageIndex,
      role: 'user',
      quote: utterance.quote,
    };
    const existing = bySession.get(utterance.sessionId);
    if (existing) {
      existing.messageRefs.push(ref);
      continue;
    }
    bySession.set(utterance.sessionId, {
      id: utterance.sessionId,
      ...(utterance.sessionTitle ? { title: utterance.sessionTitle } : {}),
      ...(utterance.sessionRuntime ? { runtime: utterance.sessionRuntime } : {}),
      messageRefs: [ref],
    });
  }
  return [...bySession.values()];
}

function sortByRecency(agreements: DetectedAgreement[]): DetectedAgreement[] {
  return [...agreements].sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0));
}

// ── small helpers ────────────────────────────────────────────────────────────

function normalizeMaxAgreements(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_AGREEMENTS;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MAX_AGREEMENTS;
  return Math.floor(value);
}

function signatureTokens(content: string): Set<string> {
  const rawTokens = content.toLowerCase().match(/[a-z0-9_]+|[一-鿿]+/g) ?? [];
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    if (/^[一-鿿]+$/.test(raw)) {
      for (const piece of splitCjk(raw)) if (!STOPWORDS.has(piece)) tokens.push(piece);
      continue;
    }
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    tokens.push(raw);
  }
  return new Set(tokens);
}

/**
 * No segmenter is available, so emit overlapping bigrams plus short whole runs.
 * Bigrams let "不要使用 any 类型" and "别用 any 类型" share enough tokens to cluster
 * without pulling in unrelated sentences.
 */
function splitCjk(run: string): string[] {
  const characters = [...run];
  if (characters.length <= 2) return [run];
  const pieces: string[] = [];
  for (let index = 0; index + 1 < characters.length; index += 1) {
    pieces.push(`${characters[index]}${characters[index + 1]}`);
  }
  return pieces;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  const shared = new Set<string>();
  for (const token of left) if (right.has(token)) shared.add(token);
  return shared.size > 0 ? shared : new Set(left);
}

function countSessions(cluster: Cluster): number {
  return new Set(cluster.utterances.map((u) => u.sessionId)).size;
}

function sessionTimestamp(session: AgreementSourceSession): number | undefined {
  if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)) return session.updatedAt;
  if (typeof session.createdAt === 'number' && Number.isFinite(session.createdAt)) return session.createdAt;
  return undefined;
}

/**
 * Truncate so the result's UTF-16 `length` stays within `max`: one emoji is a
 * single code point but two units, so slicing by code point alone can overflow.
 */
function truncate(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  let kept = '';
  for (const character of text) {
    if (kept.length + character.length > max - 1) break;
    kept += character;
  }
  return `${kept}…`;
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
