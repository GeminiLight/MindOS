import { bold, dim, cyan, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT } from '../lib/command.js';
import { getBaseUrl, getAuthHeaders } from '../lib/remote.js';

export const meta = {
  name: 'search', group: 'Knowledge',
  summary: 'Search knowledge base via API',
  usage: 'mindos search "<query>"',
  examples: ['mindos search "meeting notes"', 'mindos search "RAG" --limit 5 --json'],
};

export async function run(args, flags) {
  const query = args.join(' ');
  if (!query || flags.help || flags.h) {
    console.log(bold('mindos search') + ' — Knowledge base search');
    console.log('');
    console.log('Usage: mindos search "<query>"');
    console.log('Flags: --limit <n> (default 20), --json');
    console.log('Note: MindOS must be running. Offline: mindos file search "<query>"');
    return;
  }
  loadConfig();
  const baseUrl = getBaseUrl();
  const limit = parseInt(flags.limit) || 20;
  const headers = getAuthHeaders();
  try {
    const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, { headers });
    if (!res.ok) throw new Error('API error (' + res.status + ')');
    const data = await res.json();
    const results = data.results || data || [];
    if (isJsonMode(flags)) { output({ query, count: results.length, results }, flags); return; }
    if (results.length === 0) { console.log(dim('No results for "' + query + '"')); return; }
    console.log('');
    console.log(bold('Search: "' + query + '"  (' + results.length + ' results)'));
    console.log('');
    for (const r of results) {
      const path = r.path || r.filePath || r.name || 'unknown';
      const snippet = r.snippet || r.preview || r.excerpt || '';
      const score = r.score ? dim(' (' + (r.score * 100).toFixed(0) + '%)') : '';
      console.log('  ' + cyan(path) + score);
      if (snippet) { for (const line of snippet.split('\n').slice(0, 2)) { console.log('    ' + dim(line.trim().slice(0, 100))); } }
    }
    console.log('');
  } catch (err) {
    if (err.cause && err.cause.code === 'ECONNREFUSED') { console.error(red('MindOS not running. Offline: mindos file search "' + query + '"')); }
    else { console.error(red(err.message)); }
    process.exit(EXIT.ERROR);
  }
}
