#!/usr/bin/env node

/**
 * Download real Obsidian community plugin packages for manual compatibility gates.
 *
 * This script intentionally downloads only release assets used by Obsidian
 * community packages: manifest.json, main.js, and optional styles.css.
 *
 * Usage:
 *   node scripts/download-community-plugins.js
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = path.join(__dirname, 'obsidian-community-real-plugins.json');
const OUTPUT_DIR = path.join(__dirname, '../packages/web/__fixtures__/real-plugins');
const MATRIX_PATH = path.join(OUTPUT_DIR, 'matrix.json');
const HTTPS_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

const targetsConfig = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8'));
const targets = Array.isArray(targetsConfig.plugins) ? targetsConfig.plugins : [];

function isRedirectStatus(statusCode) {
  return statusCode === 301
    || statusCode === 302
    || statusCode === 303
    || statusCode === 307
    || statusCode === 308;
}

function download(url, dest, redirectsRemaining = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = https.get(url, (response) => {
      if (isRedirectStatus(response.statusCode)) {
        file.close();
        fs.rmSync(dest, { force: true });
        const location = response.headers.location;
        if (!location) {
          reject(new Error(`Redirect without location for ${url}`));
          return;
        }
        if (redirectsRemaining <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        download(new URL(location, url).toString(), dest, redirectsRemaining - 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        file.close();
        fs.rmSync(dest, { force: true });
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (err) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(err);
      });
    });

    request.setTimeout(HTTPS_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out downloading ${url}`));
    });
    request.on('error', (err) => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(err);
    });
  });
}

function getLatestRelease(repo, redirectsRemaining = MAX_REDIRECTS, redirectedUrl = null) {
  return new Promise((resolve, reject) => {
    const url = redirectedUrl ? new URL(redirectedUrl) : new URL(`https://api.github.com/repos/${repo}/releases/latest`);
    const options = {
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': 'MindOS-Obsidian-Plugin-Matrix',
        Accept: 'application/vnd.github+json',
      },
    };

    https.get(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        if (isRedirectStatus(response.statusCode)) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error(`Redirect without location for ${repo}`));
            return;
          }
          if (redirectsRemaining <= 0) {
            reject(new Error(`Too many redirects while fetching release info for ${repo}`));
            return;
          }
          getLatestRelease(repo, redirectsRemaining - 1, new URL(location, url).toString()).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode === 200) {
          resolve(JSON.parse(data));
          return;
        }
        reject(new Error(`Failed to get release info for ${repo}: HTTP ${response.statusCode}`));
      });
    }).setTimeout(HTTPS_TIMEOUT_MS, function onTimeout() {
      this.destroy(new Error(`Timed out fetching release info for ${repo}`));
    }).on('error', reject);
  });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function assertSafePathSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

async function downloadPlugin(plugin) {
  console.log(`\nDownloading ${plugin.name} (${plugin.repo})...`);
  assertSafePathSegment(plugin.id, 'plugin id');
  const release = await getLatestRelease(plugin.repo);
  const pluginDir = path.join(OUTPUT_DIR, plugin.id);
  const stagePluginDir = path.join(OUTPUT_DIR, `.tmp-${plugin.id}-${process.pid}`);
  fs.rmSync(stagePluginDir, { recursive: true, force: true });
  fs.mkdirSync(stagePluginDir, { recursive: true });

  const files = {};
  const requiredFiles = Array.isArray(plugin.requiredFiles) ? plugin.requiredFiles : ['main.js', 'manifest.json'];
  const optionalFiles = Array.isArray(plugin.optionalFiles) ? plugin.optionalFiles : [];

  try {
    for (const fileName of [...requiredFiles, ...optionalFiles]) {
      assertSafePathSegment(fileName, 'asset file name');
      const asset = Array.isArray(release.assets)
        ? release.assets.find((item) => item.name === fileName)
        : undefined;
      const optional = optionalFiles.includes(fileName);

      if (!asset) {
        if (optional) {
          console.log(`  - ${fileName}: not published`);
          files[fileName] = { present: false, optional: true };
          continue;
        }
        throw new Error(`${plugin.name} release ${release.tag_name} is missing required asset ${fileName}`);
      }

      const dest = path.join(stagePluginDir, fileName);
      await download(asset.browser_download_url, dest);
      const bytes = fs.statSync(dest).size;
      const sha256 = sha256File(dest);
      files[fileName] = {
        present: true,
        optional,
        bytes,
        sha256,
        url: asset.browser_download_url,
      };
      console.log(`  + ${fileName}: ${bytes} B`);
    }

    const manifest = readManifest(stagePluginDir);
    const matrixEntry = {
      id: plugin.id,
      name: plugin.name,
      repo: plugin.repo,
      sourcePolicy: targetsConfig.sourcePolicy ?? 'github-release-assets',
      releaseTag: release.tag_name,
      releaseUrl: release.html_url,
      downloadedAt: new Date().toISOString(),
      expectedCompatibilityLevel: plugin.expectedCompatibilityLevel,
      manifest: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        minAppVersion: manifest.minAppVersion,
        isDesktopOnly: manifest.isDesktopOnly === true,
      },
      files,
    };

    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.renameSync(stagePluginDir, pluginDir);
    return matrixEntry;
  } catch (err) {
    fs.rmSync(stagePluginDir, { recursive: true, force: true });
    throw err;
  }
}

async function main() {
  if (targets.length === 0) {
    throw new Error(`No plugin targets found in ${TARGETS_PATH}`);
  }

  console.log('Downloading Obsidian community plugins for compatibility testing...');
  console.log(`Output directory: ${OUTPUT_DIR}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const matrix = {
    schemaVersion: 1,
    sourcePolicy: targetsConfig.sourcePolicy ?? 'github-release-assets',
    generatedAt: new Date().toISOString(),
    plugins: [],
  };
  const failures = [];

  for (const plugin of targets) {
    try {
      matrix.plugins.push(await downloadPlugin(plugin));
      console.log(`+ ${plugin.name} downloaded`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ id: plugin.id, name: plugin.name, repo: plugin.repo, error: message });
      console.error(`! ${plugin.name} failed: ${message}`);
    }
  }

  matrix.failures = failures;
  fs.writeFileSync(MATRIX_PATH, `${JSON.stringify(matrix, null, 2)}\n`, 'utf-8');
  console.log(`\nMatrix written: ${MATRIX_PATH}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} plugin download(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAll downloads complete.');
  console.log('Run: cd packages/web && TEST_REAL_PLUGINS=1 pnpm test __tests__/obsidian-compat/community-real-plugins.test.ts');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
