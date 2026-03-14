#!/usr/bin/env node

/**
 * MindOS interactive setup script
 *
 * Usage: npm run setup  OR  mindos onboard
 *
 * Steps:
 *   1. Choose knowledge base path → default ~/MindOS
 *   2. Choose template (en / zh / empty / custom) → copy to knowledge base path
 *   3. Choose ports (web + mcp) — checked for conflicts upfront
 *   4. Auth token (auto-generated or passphrase-seeded)
 *   5. Web UI password (optional)
 *   6. Choose AI provider + API Key → write ~/.mindos/config.json
 *   7. Print next steps
 *
 * Language switching:
 *   ← → keys switch UI language (en/zh) at any prompt
 *   ↑ ↓ keys navigate select options
 *   Enter confirms
 */

import { existsSync, cpSync, writeFileSync, readFileSync, mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir, tmpdir, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { execSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createConnection } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MINDOS_DIR = resolve(homedir(), '.mindos');
const CONFIG_PATH = resolve(MINDOS_DIR, 'config.json');

// ── i18n ─────────────────────────────────────────────────────────────────────

const T = {
  title:          { en: '🧠 MindOS Setup', zh: '🧠 MindOS 初始化' },
  langHint:       { en: '  ← → switch language / 切换语言    ↑ ↓ navigate    Enter confirm', zh: '  ← → switch language / 切换语言    ↑ ↓ 上下切换    Enter 确认' },

  // mode selection
  modePrompt:     { en: 'Setup mode', zh: '配置方式' },
  modeOpts:       { en: ['CLI — terminal wizard', 'GUI — browser wizard (recommended)'], zh: ['CLI — 终端向导', 'GUI — 浏览器向导（推荐）'] },
  modeVals:       ['cli', 'gui'],
  guiStarting:    { en: '⏳ Starting server for GUI setup...', zh: '⏳ 正在启动服务...' },
  guiReady:       { en: (url) => `🌐 Complete setup in browser: ${url}`, zh: (url) => `🌐 在浏览器中完成配置: ${url}` },
  guiOpenFailed:  { en: (url) => `  Could not open browser automatically. Open this URL manually:\n  ${url}`, zh: (url) => `  无法自动打开浏览器，请手动访问：\n  ${url}` },

  // step labels
  step:           { en: (n, total) => `Step ${n}/${total}`, zh: (n, total) => `步骤 ${n}/${total}` },
  stepTitles:     {
    en: ['Knowledge Base', 'Template', 'Ports', 'Auth Token', 'Web Password', 'AI Provider', 'Start Mode'],
    zh: ['知识库',         '模板',     '端口',   'Auth Token', 'Web 密码',     'AI 服务商',    '启动方式'],
  },

  // path
  pathPrompt:     { en: 'Folder name or absolute path', zh: '文件夹名或绝对路径' },
  pathHintInline: { en: (base) => `stored under ${base + '/'}`, zh: (base) => `存储在 ${base + '/'}` },
  pathResolved:   { en: (p) => `  → ${c.dim(p)}`, zh: (p) => `  → ${c.dim(p)}` },

  // existing kb
  kbExists:       { en: (p) => `  ${c.yellow('⚠')} Directory already exists: ${c.dim(p)}`, zh: (p) => `  ${c.yellow('⚠')} 目录已存在：${c.dim(p)}` },
  kbExistsFiles:  { en: 'Contents', zh: '目录内容' },
  kbExistsOpts:   { en: ['Use this directory', 'Choose a different path'], zh: ['使用此目录', '重新选择路径'] },
  kbExistsVals:   ['use', 'reselect'],
  kbCreated:      { en: '✔ Knowledge base initialized', zh: '✔ 知识库已初始化' },

  // template
  tplPrompt:      { en: 'Template', zh: '模板' },
  tplOptions:     { en: ['en — English template', 'zh — Chinese template', 'empty — blank files only', 'custom — local path or URL'], zh: ['en — 英文模板', 'zh — 中文模板', 'empty — 仅基础文件', 'custom — 本地路径或 URL'] },
  tplValues:      ['en', 'zh', 'empty', 'custom'],
  tplNotFound:    { en: '✘ Template not found', zh: '✘ 模板目录不存在' },
  customPrompt:   { en: 'Path or URL', zh: '路径或 URL' },
  customEmpty:    { en: '  Path cannot be empty, please try again', zh: '  路径不能为空，请重新输入' },
  downloading:    { en: '⏳ Downloading template...', zh: '⏳ 正在下载模板...' },
  dlDone:         { en: '✔ Template downloaded', zh: '✔ 模板下载完成' },

  // ports
  webPortPrompt:  { en: 'Web UI port', zh: 'Web UI 端口' },
  mcpPortPrompt:  { en: 'MCP server port', zh: 'MCP 服务端口' },
  portInUse:      { en: (p) => `  ⚠ Port ${p} is already in use, choose another`, zh: (p) => `  ⚠ 端口 ${p} 已被占用，请换一个` },
  portInvalid:    { en: (p) => `  ⚠ Invalid port "${p}", must be 1024–65535`, zh: (p) => `  ⚠ 端口 "${p}" 无效，需在 1024–65535 之间` },

  // auth
  authPrompt:     { en: 'Auth token seed (Enter to auto-generate)', zh: 'Auth token 种子（回车自动生成）' },
  tokenGenerated: { en: '✔ Auth token', zh: '✔ Auth token' },

  // web password
  webPassPrompt:  { en: 'Web UI password (leave empty = no password protection)', zh: 'Web UI 访问密码（留空 = 不设密码）' },
  webPassWarn:    { en: '  ⚠ No Web UI password — anyone on the network can access the UI', zh: '  ⚠ 未设置 Web UI 密码，局域网内任何人均可访问' },
  webPassSkip:    { en: 'Skip password protection anyway?', zh: '确认不设密码继续？' },

  // provider
  providerPrompt: { en: 'AI Provider', zh: 'AI 服务商' },
  providerOpts:   { en: ['anthropic', 'openai', 'skip — configure later via `mindos config set`'], zh: ['anthropic', 'openai', 'skip — 稍后通过 `mindos config set` 配置'] },
  providerVals:   ['anthropic', 'openai', 'skip'],
  providerSkip:   { en: '  → AI provider skipped. Run `mindos config set ai.provider <anthropic|openai>` later.', zh: '  → 已跳过 AI 配置，稍后运行 `mindos config set ai.provider <anthropic|openai>` 补填。' },
  anthropicKey:   { en: 'Anthropic API Key (sk-ant-...)', zh: 'Anthropic API Key (sk-ant-...)' },
  openaiKey:      { en: 'OpenAI API Key (sk-...)', zh: 'OpenAI API Key (sk-...)' },
  openaiBase:     { en: 'OpenAI Base URL (leave empty for default)', zh: 'OpenAI Base URL（留空使用默认）' },
  apiKeyWarn:     { en: '  ⚠ No API key entered — AI features will not work until you add one to ~/.mindos/config.json', zh: '  ⚠ 未填写 API Key，AI 功能将无法使用，可后续在 ~/.mindos/config.json 中补填' },

  // config
  cfgExists:      { en: (p) => `${p} already exists. Overwrite?`, zh: (p) => `${p} 已存在，是否覆盖？` },

  // start mode
  startModePrompt: { en: 'Start Mode', zh: '启动方式' },
  startModeOpts:   { en: ['Background service (recommended, auto-start on boot)', 'Foreground (manual start each time)'], zh: ['后台服务（推荐，开机自启）', '前台运行（每次手动启动）'] },
  startModeVals:   ['daemon', 'start'],
  startModeSkip:   { en: '  → Daemon not supported on this platform, using foreground mode', zh: '  → 当前平台不支持后台服务，使用前台模式' },
  cfgKept:        { en: '✔ Keeping existing config', zh: '✔ 保留现有配置' },
  cfgKeptNote:    { en: '  Settings from this session were not saved', zh: '  本次填写的设置未保存' },
  cfgSaved:       { en: '✔ Config saved', zh: '✔ 配置已保存' },
  cfgConfirm:     { en: 'Save this configuration?', zh: '保存此配置？' },
  cfgAborted:     { en: '✘ Setup cancelled. Run `mindos onboard` to try again.', zh: '✘ 设置已取消。运行 `mindos onboard` 重新开始。' },
  yesNo:          { en: '[y/N]', zh: '[y/N]' },
  yesNoDefault:   { en: '[Y/n]', zh: '[Y/n]' },
  startNow:       { en: 'Start MindOS now?', zh: '现在启动 MindOS？' },
  syncSetup:      { en: 'Set up cross-device sync via Git?', zh: '是否配置 Git 跨设备同步？' },
  syncLater:      { en: '  → Run `mindos sync init` anytime to set up sync later.', zh: '  → 随时运行 `mindos sync init` 配置同步。' },

  // next steps (onboard — keep it minimal, details shown on `mindos start`)
  nextSteps: {
    en: (cmd) => [
      '─────────────────────────────────────────────',
      '🚀 Setup complete! Start MindOS:\n',
      `     ${c.cyan(cmd)}`,
      `  ${c.dim('MCP config, auth token, and skills info will be shown on startup.')}\n`,
      '─────────────────────────────────────────────',
    ],
    zh: (cmd) => [
      '─────────────────────────────────────────────',
      '🚀 初始化完成！启动 MindOS：\n',
      `     ${c.cyan(cmd)}`,
      `  ${c.dim('MCP 配置、Auth token、Skills 信息将在启动后显示。')}\n`,
      '─────────────────────────────────────────────',
    ],
  },
};

// ── Terminal helpers ──────────────────────────────────────────────────────────

const ESC = '\x1b';
const CLEAR_LINE = '\r\x1b[K';
const CURSOR_UP = (n) => n > 0 ? `\x1b[${n}A` : '';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const c = process.stdout.isTTY ? {
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
} : { bold: s=>s, dim: s=>s, cyan: s=>s, green: s=>s, red: s=>s, yellow: s=>s };

function write(s) { process.stdout.write(s); }

// ── State ─────────────────────────────────────────────────────────────────────

let uiLang = 'en';
const t = (key) => T[key]?.[uiLang] ?? T[key]?.en ?? '';
const tf = (key, ...args) => {
  const v = T[key]?.[uiLang] ?? T[key]?.en;
  return typeof v === 'function' ? v(...args) : v ?? '';
};

// ── Step header ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 7;
function stepHeader(n) {
  const title = T.stepTitles[uiLang][n - 1] ?? T.stepTitles.en[n - 1];
  const stepLabel = tf('step', n, TOTAL_STEPS);
  console.log(`\n${c.bold(title)}  ${c.dim(stepLabel)}`);
  console.log(c.dim('─'.repeat(44)));
}

// ── Raw-mode key reader ───────────────────────────────────────────────────────

function readKey() {
  return new Promise((resolve) => {
    const { stdin } = process;
    if (!stdin.isTTY) return resolve(null);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      resolve(chunk);
    };
    stdin.on('data', onData);
  });
}

// ── Select prompt ─────────────────────────────────────────────────────────────

async function select(labelKey, optionsKey, valuesKey = null) {
  let idx = 0;
  let lastLineCount = 0;

  const render = (first = false) => {
    const opts = T[optionsKey][uiLang];
    const lines = [
      `${c.bold(t(labelKey) + ':')}`,
      ...opts.map((o, i) => {
        const [val, ...rest] = o.split(' — ');
        const desc = rest.join(' — ');
        const item = desc ? `${c.cyan(val)} ${c.dim('—')} ${c.dim(desc)}` : c.cyan(val);
        return i === idx
          ? `  ${c.cyan('❯')} ${item}`
          : `    ${c.dim(val)}${desc ? c.dim(' — ' + desc) : ''}`;
      }),
    ];
    if (!first && lastLineCount > 0) {
      write(`${CURSOR_UP(lastLineCount)}\r\x1b[J`);
    }
    lastLineCount = lines.length;
    write(lines.join('\n') + '\n');
  };

  write(HIDE_CURSOR);
  render(true);

  while (true) {
    const key = await readKey();
    if (key === null) {
      write(SHOW_CURSOR);
      return (valuesKey ? T[valuesKey] : T[optionsKey][uiLang])[0];
    }

    const opts = T[optionsKey][uiLang];

    if (key === '\r' || key === '\n') {
      write(SHOW_CURSOR);
      write(`${CURSOR_UP(lastLineCount)}\r\x1b[J`);
      const displayLabel = opts[idx].split(' — ')[0];
      write(`${c.bold(t(labelKey) + ':')} ${c.cyan(displayLabel)}\n`);
      return valuesKey ? T[valuesKey][idx] : opts[idx];
    }

    if (key === `${ESC}[A`) { idx = (idx - 1 + opts.length) % opts.length; render(); }
    else if (key === `${ESC}[B`) { idx = (idx + 1) % opts.length; render(); }
    else if (key === `${ESC}[C` || key === `${ESC}[D`) {
      uiLang = uiLang === 'en' ? 'zh' : 'en';
      idx = Math.min(idx, T[optionsKey][uiLang].length - 1);
      render();
    }
    else if (key === '\x03') { write(SHOW_CURSOR); process.exit(1); }
  }
}

// ── Text input prompt ─────────────────────────────────────────────────────────

async function askText(labelKey, defaultValue = '', hintKey = '', ...hintArgs) {
  const buildPrompt = () => {
    const label = c.bold(t(labelKey));
    const def   = defaultValue ? ` ${c.dim('[' + defaultValue + ']')}` : '';
    const hintStr = hintKey ? tf(hintKey, ...hintArgs) : '';
    const h     = hintStr ? `  ${c.dim('← ' + hintStr)}` : '';
    return `${label}${def}${h}: `;
  };

  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(buildPrompt(), (ans) => { rl.close(); resolve(ans.trim() || defaultValue); });
    });
  }

  const render = (buf, first = false) => {
    if (!first) write(`\r\x1b[K`);
    write(`${buildPrompt()}${c.cyan(buf)}`);
  };

  write(HIDE_CURSOR);
  let buf = '';
  render(buf, true);
  write(SHOW_CURSOR);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    const onData = (chunk) => {
      if (chunk === '\x03') { write('\n'); process.exit(1); }

      if (chunk === '\r' || chunk === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        write('\n');
        resolve(buf || defaultValue);
        return;
      }

      if (chunk === `${ESC}[C` || chunk === `${ESC}[D`) {
        uiLang = uiLang === 'en' ? 'zh' : 'en';
        render(buf);
        return;
      }

      if (chunk === '\x7f' || chunk === '\b') {
        if (buf.length > 0) { buf = buf.slice(0, -1); render(buf); }
        return;
      }

      if (chunk.startsWith(ESC)) return;
      buf += chunk;
      render(buf);
    };
    process.stdin.on('data', onData);
  });
}

// ── Yes/No prompt ─────────────────────────────────────────────────────────────

async function askYesNo(labelKey, arg = '', defaultYes = false) {
  const label = typeof T[labelKey][uiLang] === 'function' ? T[labelKey][uiLang](arg) : t(labelKey);
  const hintKey = defaultYes ? 'yesNoDefault' : 'yesNo';
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`${c.bold(label)} ${c.dim(t(hintKey))}: `, (ans) => {
        const v = ans.trim().toLowerCase();
        rl.close(); resolve(defaultYes ? v !== 'n' : v === 'y');
      });
    });
  }

  write(HIDE_CURSOR);
  const render = (buf = '', first = false) => {
    if (!first) write(`\r\x1b[K`);
    write(`${c.bold(label)} ${c.dim(t(hintKey))}: ${c.cyan(buf)}`);
  };
  render('', true);
  write(SHOW_CURSOR);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let buf = '';
    const onData = (chunk) => {
      if (chunk === '\x03') { write('\n'); process.exit(1); }

      if (chunk === '\r' || chunk === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        write('\n');
        const v = buf.toLowerCase();
        resolve(defaultYes ? v !== 'n' : v === 'y');
        return;
      }

      if (chunk === `${ESC}[C` || chunk === `${ESC}[D`) {
        uiLang = uiLang === 'en' ? 'zh' : 'en';
        render(buf);
        return;
      }

      if (chunk === '\x7f' || chunk === '\b') {
        if (buf.length > 0) { buf = buf.slice(0, -1); render(buf); }
        return;
      }

      if (chunk.startsWith(ESC)) return;
      buf += chunk;
      render(buf);
    };
    process.stdin.on('data', onData);
  });
}

const askYesNoDefault = (labelKey, arg = '') => askYesNo(labelKey, arg, true);

// ── Port helpers ──────────────────────────────────────────────────────────────

function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
  });
}

async function findFreePort(from) {
  let p = from;
  while (p <= 65535 && await isPortInUse(p)) p++;
  return p;
}

async function askPort(labelKey, defaultPort) {
  let port = await findFreePort(defaultPort);
  while (true) {
    const input = (await askText(labelKey, String(port))).trim();
    const parsed = parseInt(input, 10);
    if (!parsed || parsed < 1024 || parsed > 65535) {
      write(c.yellow(tf('portInvalid', input) + '\n'));
      continue;
    }
    if (await isPortInUse(parsed)) {
      const next = await findFreePort(parsed + 1);
      write(c.yellow(tf('portInUse', parsed) + '\n'));
      port = next;
      continue;
    }
    return parsed;
  }
}

// ── Token generation ──────────────────────────────────────────────────────────

function generateToken(passphrase = '') {
  let bytes;
  if (passphrase) {
    const salt = randomBytes(16).toString('hex');
    bytes = createHash('sha256').update(passphrase + salt).digest();
  } else {
    bytes = randomBytes(24);
  }
  const hex = bytes.toString('hex').slice(0, 24);
  return hex.match(/.{4}/g).join('-');
}

// ── Template handler ──────────────────────────────────────────────────────────

function parseGithubDir(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/);
  if (!m) return null;
  const [, owner, repo, ref, subdir] = m;
  return { tarball: `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`, subdir: subdir || '' };
}

async function downloadAndExtract(url, destDir) {
  const tmp = join(tmpdir(), `mindos-tpl-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const tarPath = join(tmp, 'tpl.tar.gz');

  let fetchUrl = url;
  let subdir = '';
  const gh = parseGithubDir(url);
  if (gh) { fetchUrl = gh.tarball; subdir = gh.subdir; }

  const res = await fetch(fetchUrl, { headers: { 'User-Agent': 'mindos-init' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(tarPath));

  const extractDir = join(tmp, 'extracted');
  mkdirSync(extractDir, { recursive: true });
  execSync(`tar -xzf "${tarPath}" -C "${extractDir}"`);

  const { readdirSync, statSync } = await import('node:fs');
  let contentRoot = extractDir;
  const entries = readdirSync(extractDir);
  if (entries.length === 1 && statSync(join(extractDir, entries[0])).isDirectory()) {
    contentRoot = join(extractDir, entries[0]);
  }
  if (subdir) contentRoot = join(contentRoot, subdir);

  cpSync(contentRoot, destDir, { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
  rmSync(tmp, { recursive: true, force: true });
}

async function applyTemplate(tpl, mindDir) {
  if (tpl === 'custom') {
    let source = '';
    while (!source) {
      source = (await askText('customPrompt')).trim();
      if (!source) write(c.yellow(t('customEmpty') + '\n'));
    }

    const isUrl = source.startsWith('http://') || source.startsWith('https://');
    if (isUrl) {
      write(c.yellow(t('downloading') + '\n'));
      await downloadAndExtract(source, mindDir);
      console.log(`${c.green(t('dlDone'))}: ${c.dim(mindDir)}`);
    } else {
      const localPath = resolve(source);
      if (!existsSync(localPath)) {
        console.error(c.red(`${t('tplNotFound')}: ${localPath}`));
        process.exit(1);
      }
      cpSync(localPath, mindDir, { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
      console.log(`${c.green(t('kbCreated'))}: ${c.dim(mindDir)}`);
    }
  } else {
    const tplDir = resolve(ROOT, 'templates', tpl);
    if (!existsSync(tplDir)) {
      console.error(c.red(`${t('tplNotFound')}: ${tplDir}`));
      process.exit(1);
    }
    cpSync(tplDir, mindDir, { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
    console.log(`${c.green(t('kbCreated'))}: ${c.dim(mindDir)}`);
  }
}

// ── GUI Setup ─────────────────────────────────────────────────────────────────

function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else if (platform === 'linux') {
      // Check for WSL
      const isWSL = existsSync('/proc/version') &&
        readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
      if (isWSL) {
        execSync(`cmd.exe /c start "${url}"`, { stdio: 'ignore' });
      } else {
        execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
      }
    } else {
      execSync(`cmd.exe /c start "${url}"`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

async function startGuiSetup() {
  // Ensure ~/.mindos directory exists
  mkdirSync(MINDOS_DIR, { recursive: true });

  // Read or create config, set setupPending
  let config = {};
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { /* ignore */ }
  config.setupPending = true;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

  // Find a free port
  const port = await findFreePort(3000);
  if (config.port === undefined) {
    config.port = port;
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  }
  const usePort = config.port || port;

  write(c.yellow(t('guiStarting') + '\n'));

  // Start the server in the background
  const cliPath = resolve(__dirname, '../bin/cli.js');
  const child = spawn(process.execPath, [cliPath, 'start'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(usePort) },
  });
  child.unref();

  // Wait for the server to be ready
  const { waitForHttp } = await import('../bin/lib/gateway.js');
  const ready = await waitForHttp(usePort, { retries: 60, intervalMs: 1000, label: 'MindOS' });

  if (!ready) {
    write(c.red('\n✘ Server failed to start.\n'));
    process.exit(1);
  }

  const url = `http://localhost:${usePort}/setup`;
  console.log(`\n${c.green(tf('guiReady', url))}\n`);

  const opened = openBrowser(url);
  if (!opened) {
    console.log(c.dim(tf('guiOpenFailed', url)));
  }

  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold(t('title'))}\n\n${c.dim(t('langHint'))}\n`);

  // ── Mode selection: CLI or GUI ───────────────────────────────────────────
  const mode = await select('modePrompt', 'modeOpts', 'modeVals');

  if (mode === 'gui') {
    await startGuiSetup();
    return;
  }

  // ── CLI mode continues below ─────────────────────────────────────────────

  // ── Early overwrite check ─────────────────────────────────────────────────
  if (existsSync(CONFIG_PATH)) {
    let existing = {};
    try { existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}

    const mask = (s) => s ? s.slice(0, 4) + '••••••••' + s.slice(-2) : c.dim('(not set)');
    const row  = (label, val) => `  ${c.dim(label.padEnd(18))} ${val}`;
    const providers = existing.ai?.providers;
    const anthropicKey = providers?.anthropic?.apiKey || existing.ai?.anthropicApiKey || '';
    const openaiKey    = providers?.openai?.apiKey    || existing.ai?.openaiApiKey    || '';

    console.log(c.bold('\nExisting config:'));
    console.log(row('Knowledge base:', c.cyan(existing.mindRoot || '(not set)')));
    console.log(row('Web port:',       c.cyan(String(existing.port || '3000'))));
    console.log(row('MCP port:',       c.cyan(String(existing.mcpPort || '8787'))));
    console.log(row('Auth token:',     existing.authToken ? mask(existing.authToken) : c.dim('(not set)')));
    console.log(row('Web password:',   existing.webPassword ? '••••••••' : c.dim('(none)')));
    console.log(row('AI provider:',    c.cyan(existing.ai?.provider || '(not set)')));
    if (anthropicKey) console.log(row('Anthropic key:', mask(anthropicKey)));
    if (openaiKey)    console.log(row('OpenAI key:',    mask(openaiKey)));
    write('\n');

    const overwrite = await askYesNo('cfgExists', CONFIG_PATH);
    if (!overwrite) {
      const existingMode     = existing.startMode || 'start';
      const existingMcpPort  = existing.mcpPort   || 8787;
      const existingAuth     = existing.authToken || '';
      const existingMindRoot = existing.mindRoot  || resolve(MINDOS_DIR, 'my-mind');
      console.log(`\n${c.green(t('cfgKept'))}  ${c.dim(CONFIG_PATH)}`);
      write(c.dim(t('cfgKeptNote') + '\n'));
      const installDaemon = process.argv.includes('--install-daemon');
      finish(existingMindRoot, existingMode, existingMcpPort, existingAuth, installDaemon);
      return;
    }
  }

  // ── Step 1: Knowledge base path ───────────────────────────────────────────
  stepHeader(1);

  const { readdirSync } = await import('node:fs');
  let mindDir;

  while (true) {
    const input = (await askText('pathPrompt', 'my-mind', 'pathHintInline', MINDOS_DIR)).trim();
    const resolved = input.startsWith('/') ? input : resolve(MINDOS_DIR, input);
    write(tf('pathResolved', resolved) + '\n');
    mindDir = resolved;

    if (existsSync(mindDir)) {
      // show contents
      let entries = [];
      try { entries = readdirSync(mindDir).filter(e => !e.startsWith('.')); } catch {}
      write('\n');
      write(tf('kbExists', mindDir) + '\n');
      if (entries.length) {
        const label = T.kbExistsFiles[uiLang] ?? T.kbExistsFiles.en;
        write(`  ${c.dim(label + ':')} ${entries.slice(0, 8).map(e => c.dim(e)).join('  ')}${entries.length > 8 ? c.dim('  …') : ''}\n`);
      } else {
        write(`  ${c.dim('(empty)')}\n`);
      }
      write('\n');

      const choice = await select('kbExistsFiles', 'kbExistsOpts', 'kbExistsVals');
      if (choice === 'reselect') { write('\n'); continue; }
      break;
    } else {
      // ── Step 2: Template ────────────────────────────────────────────────
      write('\n');
      stepHeader(2);
      const tpl = await select('tplPrompt', 'tplOptions', 'tplValues');
      mkdirSync(mindDir, { recursive: true });
      await applyTemplate(tpl, mindDir);
      break;
    }
  }

  // ── Step 3: Ports ─────────────────────────────────────────────────────────
  write('\n');
  stepHeader(3);
  const webPort = await askPort('webPortPrompt', 3000);
  const mcpPort = await askPort('mcpPortPrompt', 8787);

  // ── Step 4: Auth token ────────────────────────────────────────────────────
  write('\n');
  stepHeader(4);
  const authSeed = await askText('authPrompt');
  const authToken = generateToken(authSeed);
  console.log(`${c.green(t('tokenGenerated'))}: ${c.cyan(authToken)}`);

  // ── Step 5: Web UI password ───────────────────────────────────────────────
  write('\n');
  stepHeader(5);
  let webPassword = '';
  while (true) {
    webPassword = await askText('webPassPrompt');
    if (webPassword) break;
    write(c.yellow(t('webPassWarn') + '\n'));
    const confirmed = await askYesNo('webPassSkip');
    if (confirmed) break;
  }

  // ── Step 6: AI Provider + API Key ─────────────────────────────────────────
  write('\n');
  stepHeader(6);

  const provider = await select('providerPrompt', 'providerOpts', 'providerVals');
  const isSkip = provider === 'skip';
  const isAnthropic = provider === 'anthropic';

  // preserve existing provider configs
  let existingProviders = {
    anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
    openai:    { apiKey: '', model: 'gpt-5.4', baseUrl: '' },
  };
  let existingAiProvider = 'anthropic';
  try {
    const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (existing.ai?.providers) {
      existingProviders = { ...existingProviders, ...existing.ai.providers };
    } else if (existing.ai?.anthropicApiKey) {
      existingProviders.anthropic = { apiKey: existing.ai.anthropicApiKey || '', model: existing.ai.anthropicModel || 'claude-sonnet-4-6' };
      existingProviders.openai    = { apiKey: existing.ai.openaiApiKey || '', model: existing.ai.openaiModel || 'gpt-5.4', baseUrl: existing.ai.openaiBaseUrl || '' };
    }
    if (existing.ai?.provider) existingAiProvider = existing.ai.provider;
  } catch { /* ignore */ }

  if (isSkip) {
    write(c.dim(t('providerSkip') + '\n'));
  } else {
    let apiKey = '';
    let baseUrl = '';
    if (isAnthropic) {
      apiKey = await askText('anthropicKey');
    } else {
      apiKey = await askText('openaiKey');
      baseUrl = await askText('openaiBase');
    }

    if (!apiKey) {
      write(c.yellow(t('apiKeyWarn') + '\n'));
    }

    if (isAnthropic) {
      existingProviders.anthropic = { apiKey, model: existingProviders.anthropic?.model || 'claude-sonnet-4-6' };
    } else {
      existingProviders.openai = { apiKey, model: existingProviders.openai?.model || 'gpt-5.4', baseUrl: baseUrl || '' };
    }
  }

  // ── Step 7: Start Mode ──────────────────────────────────────────────────
  write('\n');
  stepHeader(7);

  let startMode = 'start';
  const daemonPlatform = process.platform === 'darwin' || process.platform === 'linux';
  if (daemonPlatform) {
    startMode = await select('startModePrompt', 'startModeOpts', 'startModeVals');
  } else {
    write(c.dim(t('startModeSkip') + '\n'));
  }

  const config = {
    mindRoot:    mindDir,
    port:        webPort,
    mcpPort:     mcpPort,
    authToken:   authToken,
    webPassword: webPassword || '',
    startMode:   startMode,
    ai: {
      provider:  isSkip ? existingAiProvider : (isAnthropic ? 'anthropic' : 'openai'),
      providers: existingProviders,
    },
  };

  // ── Configuration Summary & Confirmation ──────────────────────────────────
  const maskPw = (s) => s ? '•'.repeat(Math.min(s.length, 8)) : '';
  const maskTk = (s) => s && s.length > 8 ? s.slice(0, 8) + '····' : (s ? s.slice(0, 4) + '····' : '');
  const sep = '━'.repeat(40);
  write(`\n${sep}\n`);
  write(`${c.bold(uiLang === 'zh' ? '配置摘要' : 'Configuration Summary')}\n`);
  write(`${sep}\n`);
  write(`  ${c.dim('Knowledge base:')}  ${mindDir}\n`);
  write(`  ${c.dim('Web port:')}        ${webPort}\n`);
  write(`  ${c.dim('MCP port:')}        ${mcpPort}\n`);
  write(`  ${c.dim('Auth token:')}      ${maskTk(authToken)}\n`);
  if (webPassword) write(`  ${c.dim('Web password:')}    ${maskPw(webPassword)}\n`);
  write(`  ${c.dim('AI provider:')}     ${config.ai.provider}\n`);
  write(`  ${c.dim('Start mode:')}      ${startMode}\n`);
  write(`${sep}\n`);

  const confirmSave = await askYesNoDefault('cfgConfirm');
  if (!confirmSave) {
    console.log(c.red(t('cfgAborted')));
    process.exit(0);
  }

  mkdirSync(MINDOS_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n${c.green(t('cfgSaved'))}: ${c.dim(CONFIG_PATH)}`);

  // ── Sync setup (optional) ──────────────────────────────────────────────────
  const wantSync = await askYesNo('syncSetup');
  if (wantSync) {
    const { initSync } = await import('../bin/lib/sync.js');
    await initSync(mindDir);
  } else {
    console.log(c.dim(t('syncLater')));
  }

  const installDaemon = startMode === 'daemon' || process.argv.includes('--install-daemon');
  finish(mindDir, config.startMode, config.mcpPort, config.authToken, installDaemon);
}

function getLocalIP() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

async function finish(mindDir, startMode = 'start', mcpPort = 8787, authToken = '', installDaemon = false) {
  const startCmd = installDaemon ? 'mindos start --daemon' : (startMode === 'dev' ? 'mindos dev' : 'mindos start');
  const lines = T.nextSteps[uiLang](startCmd);
  console.log('');
  lines.forEach((l) => console.log(l));

  const doStart = await askYesNoDefault('startNow');
  if (doStart) {
    const { execSync } = await import('node:child_process');
    const cliPath = resolve(__dirname, '../bin/cli.js');
    if (installDaemon) {
      // Install and start as background service — returns immediately
      execSync(`node "${cliPath}" start --daemon`, { stdio: 'inherit' });
    } else {
      execSync(`node "${cliPath}" ${startMode}`, { stdio: 'inherit' });
    }
  }
}

main().catch((err) => {
  write(SHOW_CURSOR);
  console.error(err);
  process.exit(1);
});
