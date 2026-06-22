#!/usr/bin/env node

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');

const PACKAGE_PREFIX = '@geminilight/mindos-';
const LINUX_MUSL_EXAMPLE = 'linux-x64-musl';
const DEFAULT_RUNTIME_MANIFEST_URL = 'https://github.com/GeminiLight/MindOS/releases/download/runtime-latest/latest.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_RUNTIME_BYTES = 512 * 1024 * 1024;
const scriptPath = fs.realpathSync(__filename);
const scriptDir = path.dirname(scriptPath);
const packageRoot = path.resolve(scriptDir, '..');
const requireFromHere = createRequire(scriptPath);
const userArgs = process.argv.slice(2);

function productVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function printStaticHelp() {
  const version = productVersion() || '?';
  console.log(`
MindOS CLI v${version}

USAGE
  mindos [task] [flags]
  mindos <command> [flags]

COMMANDS
  agent         MindOS AI Agent: interactive REPL or one-shot (-p)
  start         Start MindOS services
  stop          Stop services
  status        Show service status
  open          Open Web UI in browser
  file          Manage files (list, read, write, edit, search, ...)
  space         Manage spaces (list, tree, create, rename)
  search        Search your knowledge base
  mcp           Manage AI agent connections
  onboard      First-time setup wizard (aliases: init, setup)
  config        View or update configuration
  auth          Manage local Web UI authentication
  channel       Manage IM platform configurations
  feishu-ws     Start Feishu long connection client
  doctor        Check installation health
  update        Update to latest version

FLAGS
  --help, -h    Show help
  --version, -v Show version
  --json        Output as JSON

  Run mindos to open the MindOS Agent.
  Run mindos -p "<task>" for one-shot agent mode.
  Run mindos <command> --help for details on any command.
`);
}

if (userArgs.length === 1 && (userArgs[0] === '--help' || userArgs[0] === '-h' || userArgs[0] === 'help')) {
  printStaticHelp();
  process.exit(0);
}

if (userArgs.length === 1 && (userArgs[0] === '--version' || userArgs[0] === '-v')) {
  console.log(`mindos/${productVersion() || '?'} node/${process.version} ${process.platform}-${process.arch}`);
  process.exit(0);
}

function runNodeScript(target) {
  const result = childProcess.spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 0);
}

function runDirect(target) {
  const result = childProcess.spawnSync(target, process.argv.slice(2), {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 0);
}

if (process.env.MINDOS_BIN_PATH) {
  runDirect(process.env.MINDOS_BIN_PATH);
}

if (process.env.MINDOS_RUNTIME_PACKAGE_PATH) {
  const entrypoint = runtimeEntrypoint(process.env.MINDOS_RUNTIME_PACKAGE_PATH);
  if (entrypoint) runEntrypoint(entrypoint);
  console.error(
    'MINDOS_RUNTIME_PACKAGE_PATH does not contain a MindOS runtime entrypoint: '
    + process.env.MINDOS_RUNTIME_PACKAGE_PATH,
  );
  process.exit(1);
}

function normalizedPlatform() {
  if (process.platform === 'win32') return 'windows';
  return process.platform;
}

function isLinuxMusl() {
  if (process.platform !== 'linux') return false;

  try {
    if (fs.existsSync('/etc/alpine-release')) return true;
  } catch {
    // ignore
  }

  try {
    const result = childProcess.spawnSync('ldd', ['--version'], {
      encoding: 'utf8',
      timeout: 1500,
    });
    return `${result.stdout || ''}${result.stderr || ''}`.toLowerCase().includes('musl');
  } catch {
    return false;
  }
}

function platformPackageCandidates() {
  const platform = normalizedPlatform();
  const arch = process.arch;
  const base = `${PACKAGE_PREFIX}${platform}-${arch}`;

  if (platform === 'linux') {
    const musl = isLinuxMusl();
    if (musl) return [`${base}-musl`, base];
    return [base, `${base}-musl`];
  }

  return [base];
}

function findRuntimePackageByRequire(packageName) {
  try {
    const packageJson = requireFromHere.resolve(`${packageName}/package.json`);
    return path.dirname(packageJson);
  } catch {
    return null;
  }
}

function findRuntimePackageByWalking(packageName) {
  let current = scriptDir;
  for (;;) {
    const candidate = path.join(current, 'node_modules', ...packageName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findRuntimePackageInSourceTree(packageName) {
  const key = packageName.slice(PACKAGE_PREFIX.length);
  const candidate = path.resolve(packageRoot, '..', 'mindos-platforms', key);
  if (runtimeEntrypoint(candidate)) return candidate;
  return null;
}

function runtimeEntrypoint(packageDir) {
  const binary = path.join(packageDir, 'bin', process.platform === 'win32' ? 'mindos.exe' : 'mindos');
  if (fs.existsSync(binary)) return { type: 'binary', path: binary };

  const cli = path.join(packageDir, 'bin', 'cli.js');
  if (fs.existsSync(cli)) return { type: 'node', path: cli };

  return null;
}

function runEntrypoint(entrypoint) {
  if (entrypoint.type === 'binary') runDirect(entrypoint.path);
  runNodeScript(entrypoint.path);
}

function findRuntimeEntrypoint() {
  if (process.env.MINDOS_DISABLE_PLATFORM_PACKAGE_LOOKUP !== '1') {
    for (const packageName of platformPackageCandidates()) {
      const packageDir = findRuntimePackageByRequire(packageName)
        || findRuntimePackageByWalking(packageName)
        || findRuntimePackageInSourceTree(packageName);
      if (!packageDir) continue;

      const entrypoint = runtimeEntrypoint(packageDir);
      if (entrypoint) return entrypoint;
    }
  }

  const legacyCli = path.join(packageRoot, 'bin', 'cli.js');
  const legacyStandalone = path.join(packageRoot, '_standalone', 'server.js');
  if (fs.existsSync(legacyCli) && fs.existsSync(legacyStandalone)) {
    return { type: 'node', path: legacyCli };
  }

  const downloaded = resolveDownloadedRuntimeEntrypoint();
  if (downloaded) return downloaded;

  return null;
}

const entrypoint = findRuntimeEntrypoint();
if (!entrypoint) {
  const candidates = platformPackageCandidates();
  console.error(
    'MindOS runtime package is not installed for this platform.\n\n' +
    `Tried: ${candidates.join(', ')}\n\n` +
    `Try reinstalling @geminilight/mindos, or install ${candidates[0]} at the same version.`,
  );
  process.exit(1);
}

runEntrypoint(entrypoint);

function resolveDownloadedRuntimeEntrypoint() {
  if (process.env.MINDOS_DISABLE_RUNTIME_DOWNLOAD === '1') return null;

  const cachedEntrypoint = findCachedRuntimeEntrypoint(productVersion());
  if (cachedEntrypoint) return cachedEntrypoint;

  let manifest;
  try {
    manifest = readRuntimeManifest();
  } catch (err) {
    const offlineCachedEntrypoint = findCachedRuntimeEntrypoint();
    if (offlineCachedEntrypoint) return offlineCachedEntrypoint;
    if (process.env.MINDOS_RUNTIME_MANIFEST_URL) {
      console.error(`Failed to read MindOS runtime manifest: ${errorMessage(err)}`);
    }
    return null;
  }

  const version = safeRuntimeVersion(manifest.version);
  const cacheRoot = runtimeCacheRoot();
  const runtimeRoot = path.join(cacheRoot, version);
  const cached = runtimeEntrypoint(runtimeRoot);
  if (cached) return cached;

  try {
    fs.mkdirSync(cacheRoot, { recursive: true });
    const tempRoot = path.join(cacheRoot, `.download-${version}-${process.pid}-${Date.now()}`);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });

    const archive = downloadRuntimeArchive(manifest);
    extractRuntimeArchive(archive, tempRoot);
    const entrypoint = runtimeEntrypoint(tempRoot);
    if (!entrypoint) {
      throw new Error('downloaded runtime archive does not contain bin/cli.js or bin/mindos');
    }

    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.renameSync(tempRoot, runtimeRoot);
    return runtimeEntrypoint(runtimeRoot);
  } catch (err) {
    console.error(`Failed to install MindOS runtime fallback: ${errorMessage(err)}`);
    return null;
  }
}

function runtimeCacheRoot() {
  return path.resolve(process.env.MINDOS_RUNTIME_CACHE_DIR || path.join(os.homedir(), '.mindos', 'runtime-cache'));
}

function findCachedRuntimeEntrypoint(version) {
  const cacheRoot = runtimeCacheRoot();
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.download-'))
    .filter((entry) => !version || entry.name === version)
    .map((entry) => {
      const root = path.join(cacheRoot, entry.name);
      const entrypoint = runtimeEntrypoint(root);
      if (!entrypoint) return null;
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(root).mtimeMs; } catch {}
      return { entrypoint, mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.entrypoint || null;
}

function readRuntimeManifest() {
  const manifestUrl = process.env.MINDOS_RUNTIME_MANIFEST_URL || DEFAULT_RUNTIME_MANIFEST_URL;
  const body = requestBuffer(manifestUrl, { maxBytes: MAX_MANIFEST_BYTES, timeoutMs: 30_000 });
  const manifest = JSON.parse(body.toString('utf-8'));
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is not an object');
  if (typeof manifest.version !== 'string') throw new Error('manifest.version must be a string');
  if (!Array.isArray(manifest.urls) || manifest.urls.some((url) => typeof url !== 'string')) {
    throw new Error('manifest.urls must be a string array');
  }
  return manifest;
}

function safeRuntimeVersion(value) {
  if (!/^[0-9A-Za-z._-]+$/.test(value)) {
    throw new Error(`unsafe runtime version in manifest: ${value}`);
  }
  return value;
}

function downloadRuntimeArchive(manifest) {
  let lastError;
  for (const url of manifest.urls) {
    try {
      const archive = requestBuffer(url, { maxBytes: MAX_RUNTIME_BYTES, timeoutMs: 120_000 });
      if (typeof manifest.size === 'number' && manifest.size > 0 && archive.length !== manifest.size) {
        throw new Error(`runtime archive size mismatch: got ${archive.length}, expected ${manifest.size}`);
      }
      if (typeof manifest.sha256 === 'string' && manifest.sha256) {
        const actual = crypto.createHash('sha256').update(archive).digest('hex');
        if (actual !== manifest.sha256) {
          throw new Error(`runtime archive sha256 mismatch: got ${actual}, expected ${manifest.sha256}`);
        }
      }
      return archive;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('manifest did not include a runtime archive URL');
}

function requestBuffer(urlString, options, redirectCount = 0) {
  if (redirectCount > 5) throw new Error(`too many redirects while fetching ${urlString}`);
  const url = new URL(urlString);
  if (url.protocol === 'file:') {
    const file = fs.readFileSync(url);
    if (file.length > options.maxBytes) {
      throw new Error(`file response exceeded byte limit: ${urlString}`);
    }
    return file;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported URL protocol: ${url.protocol}`);
  }

  const result = childProcess.spawnSync(process.execPath, [
    '-e',
    `
      const http = require('node:http');
      const https = require('node:https');
      const url = new URL(process.argv[1]);
      const maxBytes = Number(process.argv[2]);
      const timeoutMs = Number(process.argv[3]);
      const client = url.protocol === 'http:' ? http : https;
      const req = client.get(url, { timeout: timeoutMs }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          process.stdout.write(JSON.stringify({ redirect: new URL(res.headers.location, url).toString() }));
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          console.error('HTTP ' + res.statusCode + ' while fetching ' + url);
          res.resume();
          process.exitCode = 2;
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            console.error('response exceeded byte limit');
            req.destroy();
            process.exitCode = 3;
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => process.stdout.write(Buffer.concat(chunks)));
      });
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      req.on('error', (err) => {
        console.error(err.message);
        process.exitCode = process.exitCode || 1;
      });
    `,
    url.toString(),
    String(options.maxBytes),
    String(options.timeoutMs),
  ], {
    encoding: 'buffer',
    maxBuffer: options.maxBytes + 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.toString('utf-8').trim() || `request failed for ${urlString}`);
  }

  try {
    const redirect = JSON.parse(result.stdout.toString('utf-8'));
    if (redirect && typeof redirect.redirect === 'string') {
      return requestBuffer(redirect.redirect, options, redirectCount + 1);
    }
  } catch {
    // Binary responses and normal JSON manifests are returned as-is.
  }

  return result.stdout;
}

function extractRuntimeArchive(archive, targetRoot) {
  const tar = zlib.gunzipSync(archive);
  let offset = 0;
  let nextPax = {};

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (isZeroBlock(header)) break;

    const typeflag = String.fromCharCode(header[156] || 0);
    const size = parseOctal(header, 124, 12);
    const rawName = nextPax.path || tarName(header);
    nextPax = {};
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === 'x' || typeflag === 'g') {
      nextPax = parsePax(data);
      continue;
    }

    if (!rawName || rawName === '.' || rawName === './') continue;
    const dest = safeArchivePath(targetRoot, rawName);

    if (typeflag === '5') {
      fs.mkdirSync(dest, { recursive: true });
      continue;
    }

    if (typeflag === '0' || typeflag === '\0') {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      const mode = parseOctal(header, 100, 8);
      if ((mode & 0o111) !== 0) fs.chmodSync(dest, mode & 0o777);
    }
  }
}

function safeArchivePath(targetRoot, archiveName) {
  const normalized = path.normalize(archiveName.replace(/^\.\/+/, ''));
  if (!normalized || normalized === '.' || path.isAbsolute(normalized) || normalized.startsWith('..' + path.sep) || normalized === '..') {
    throw new Error(`unsafe runtime archive path: ${archiveName}`);
  }
  const dest = path.resolve(targetRoot, normalized);
  const rootWithSep = path.resolve(targetRoot) + path.sep;
  if (dest !== path.resolve(targetRoot) && !dest.startsWith(rootWithSep)) {
    throw new Error(`runtime archive path escapes target root: ${archiveName}`);
  }
  return dest;
}

function tarName(header) {
  const name = readNullTerminated(header, 0, 100);
  const prefix = readNullTerminated(header, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function readNullTerminated(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf-8');
}

function parseOctal(buffer, start, length) {
  const raw = readNullTerminated(buffer, start, length).trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function parsePax(buffer) {
  const text = buffer.toString('utf-8');
  const out = {};
  let index = 0;
  while (index < text.length) {
    const space = text.indexOf(' ', index);
    if (space === -1) break;
    const length = Number.parseInt(text.slice(index, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, index + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    index += length;
  }
  return out;
}

function isZeroBlock(buffer) {
  for (const byte of buffer) {
    if (byte !== 0) return false;
  }
  return true;
}

function errorMessage(err) {
  return err && typeof err.message === 'string' ? err.message : String(err);
}
