import { bold, dim, cyan, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { EXIT, printCommandHelp } from '../lib/command.js';

export const meta = {
  name: 'api',
  group: 'Config',
  summary: 'Raw API passthrough (GET/POST/PUT/DELETE)',
  usage: 'mindos api <METHOD> <path>',
  flags: {
    '--body <json>': 'Request body as JSON string',
    '--port <port>': 'MindOS web port',
  },
  examples: [
    'mindos api GET /api/health',
    'mindos api GET /api/files',
    'mindos api POST /api/ask --body \'{"messages":[...],"mode":"chat"}\'',
  ],
};

export async function run(args, flags) {
  if (args.length < 2) {
    printCommandHelp({ meta });
    return;
  }

  const method = args[0].toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    console.error(red('Invalid method: ' + args[0]));
    process.exit(EXIT.ARGS);
  }

  let apiPath = args[1];
  if (!apiPath.startsWith('/')) apiPath = '/' + apiPath;

  loadConfig();
  const port = flags.port || process.env.MINDOS_WEB_PORT || '3456';
  const token = process.env.MINDOS_AUTH_TOKEN || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const fetchOpts = { method, headers };
  if (flags.body && method !== 'GET') fetchOpts.body = flags.body;

  try {
    const res = await fetch('http://localhost:' + port + apiPath, fetchOpts);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      console.log(JSON.stringify(await res.json(), null, 2));
    } else {
      console.log(await res.text());
    }
    if (!res.ok) process.exit(EXIT.ERROR);
  } catch (err) {
    if (err.cause && err.cause.code === 'ECONNREFUSED') {
      console.error(red('Connection refused. Start with: mindos start'));
      process.exit(EXIT.CONNECT);
    } else {
      console.error(red('Request failed: ' + err.message));
      process.exit(EXIT.ERROR);
    }
  }
}
