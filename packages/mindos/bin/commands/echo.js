import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT, printCommandHelp } from '../lib/command.js';
import { getBaseUrl, getAuthHeaders } from '../lib/remote.js';

/**
 * A thin client over `/api/echo/cards`, like `mindos search` is over
 * `/api/search`. Echo's generation and review logic stays server-side: a second
 * implementation here would be a second set of rules to keep in step, and every
 * other knowledge command already reaches the running server.
 */

export const meta = {
  name: 'echo', group: 'Knowledge',
  summary: 'Review what MindOS learned from your agent sessions',
  usage: 'mindos echo [--approve <id> | --reject <id>]',
  flags: {
    '--segment <name>': 'promotion (default) or insight',
    '--all': 'Include playbooks and practices, not just agreements',
    '--reviewed': 'Include cards already approved or rejected',
    '--approve <id>': 'Approve a card and write it where it takes effect',
    '--reject <id>': 'Reject a card',
    '--note <text>': 'Note to store with the review',
    '--json': 'Output as JSON',
  },
  examples: [
    'mindos echo',
    'mindos echo --all --reviewed',
    'mindos echo --approve echo-card-a1b2c3',
  ],
};

const SEGMENTS = ['promotion', 'insight'];
const REVIEWED = ['approved', 'rejected'];

export function resolveSegment(flags) {
  const segment = typeof flags.segment === 'string' && flags.segment.trim() ? flags.segment.trim() : 'promotion';
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`--segment must be one of: ${SEGMENTS.join(', ')}`);
  }
  return segment;
}

export function buildCardsUrl(baseUrl, segment) {
  return `${String(baseUrl).replace(/\/+$/, '')}/api/echo/cards?segment=${encodeURIComponent(segment)}`;
}

/** Agreements only by default: they are the cards that change agent behaviour. */
export function selectAgreements(cards, flags) {
  if (!Array.isArray(cards)) return [];
  return cards.filter((card) => {
    if (!card || typeof card !== 'object') return false;
    if (!flags.all && card.kind !== 'agreement') return false;
    if (!flags.reviewed && REVIEWED.includes(card.review?.status)) return false;
    return true;
  });
}

export function formatAgreementLine(card) {
  const rule = String(card.content ?? card.title ?? card.id ?? '').replace(/\s+/g, ' ').trim();
  const label = String(card.source?.label ?? '').replace(/\s+/g, ' ').trim();
  const status = card.review?.status === 'approved'
    ? green(`已生效 → ${card.review.targetPath ?? ''}`.trim())
    : card.review?.status === 'rejected'
      ? dim('已拒绝')
      : '';
  const meta = [label, status].filter(Boolean).join('  ');
  return `  ${cyan(rule || '(empty)')}\n    ${dim(card.id ?? '')}${meta ? `  ${meta}` : ''}`;
}

export async function reviewCard(baseUrl, headers, segment, id, action, note) {
  const res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/api/echo/cards`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment, id, action, ...(note ? { note } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `API error (${res.status})`);
  return data.review ?? {};
}

export async function run(args, flags) {
  if (args.length > 0) {
    printCommandHelp({ meta });
    return;
  }
  loadConfig();
  const baseUrl = getBaseUrl();
  const headers = getAuthHeaders();

  let segment;
  try {
    segment = resolveSegment(flags);
  } catch (err) {
    console.error(red(err.message));
    process.exit(EXIT.ERROR);
  }

  const reviewId = typeof flags.approve === 'string' ? flags.approve : typeof flags.reject === 'string' ? flags.reject : null;
  const action = typeof flags.approve === 'string' ? 'approve' : 'reject';

  try {
    if (reviewId) {
      const review = await reviewCard(baseUrl, headers, segment, reviewId, action, flags.note);
      if (isJsonMode(flags)) { output({ id: reviewId, action, review }, flags); return; }
      const where = review.targetPath ? dim(` → ${review.targetPath}`) : '';
      console.log('');
      console.log(`${review.decision === 'approved' ? green('✓ 已批准') : yellow('已拒绝')} ${dim(reviewId)}${where}`);
      console.log('');
      return;
    }

    const res = await fetch(buildCardsUrl(baseUrl, segment), { headers, cache: 'no-store' });
    if (!res.ok) throw new Error(`API error (${res.status})`);
    const data = await res.json();
    const cards = selectAgreements(data.cards, flags);

    if (isJsonMode(flags)) { output({ segment, count: cards.length, cards }, flags); return; }
    if (cards.length === 0) {
      console.log(dim(flags.all ? 'No pending Echo cards.' : 'No pending agreements. Try --all or --reviewed.'));
      return;
    }
    console.log('');
    console.log(bold(`Echo ${segment}  (${cards.length})`));
    console.log('');
    for (const card of cards) console.log(formatAgreementLine(card));
    console.log('');
    console.log(dim('Approve with: mindos echo --approve <id>'));
    console.log('');
  } catch (err) {
    if (err.cause && err.cause.code === 'ECONNREFUSED') {
      console.error(red('MindOS not running. Start it with: mindos start'));
    } else {
      console.error(red(err.message));
    }
    process.exit(EXIT.ERROR);
  }
}
