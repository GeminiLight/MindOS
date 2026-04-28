#!/usr/bin/env node

/**
 * Download Community Plugins Script
 *
 * Downloads real Obsidian community plugins for testing.
 * Only downloads the built files (main.js, manifest.json, styles.css),
 * not the full source code.
 *
 * Usage:
 *   node scripts/download-community-plugins.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PLUGINS = [
  {
    id: 'obsidian-style-settings',
    name: 'Style Settings',
    repo: 'mgmeyers/obsidian-style-settings',
    // Download from latest release
    files: ['main.js', 'manifest.json', 'styles.css'],
  },
  {
    id: 'quickadd',
    name: 'QuickAdd',
    repo: 'chhoumann/quickadd',
    files: ['main.js', 'manifest.json'],
  },
  {
    id: 'tag-wrangler',
    name: 'Tag Wrangler',
    repo: 'pjeby/tag-wrangler',
    files: ['main.js', 'manifest.json'],
  },
  {
    id: 'obsidian-homepage',
    name: 'Homepage',
    repo: 'mirnovov/obsidian-homepage',
    files: ['main.js', 'manifest.json', 'styles.css'],
  },
];

const OUTPUT_DIR = path.join(__dirname, '../packages/web/__fixtures__/real-plugins');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        download(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function getLatestRelease(repo) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: {
        'User-Agent': 'MindOS-Test-Suite',
      },
    };

    https.get(options, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        if (response.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Failed to get release info: ${response.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function downloadPlugin(plugin) {
  console.log(`\nDownloading ${plugin.name}...`);

  try {
    const release = await getLatestRelease(plugin.repo);
    console.log(`  Latest release: ${release.tag_name}`);

    const pluginDir = path.join(OUTPUT_DIR, plugin.id);
    fs.mkdirSync(pluginDir, { recursive: true });

    for (const file of plugin.files) {
      const asset = release.assets.find(a => a.name === file);
      if (!asset) {
        console.log(`  ⚠ ${file} not found in release, skipping`);
        continue;
      }

      const dest = path.join(pluginDir, file);
      console.log(`  Downloading ${file}...`);
      await download(asset.browser_download_url, dest);
      console.log(`  ✓ ${file}`);
    }

    console.log(`✓ ${plugin.name} downloaded successfully`);
  } catch (err) {
    console.error(`✗ Failed to download ${plugin.name}: ${err.message}`);
  }
}

async function main() {
  console.log('Downloading Obsidian community plugins for testing...');
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const plugin of PLUGINS) {
    await downloadPlugin(plugin);
  }

  console.log('\n✓ All downloads complete!');
  console.log('\nTo run tests with real plugins:');
  console.log('  TEST_REAL_PLUGINS=1 npm test -- community-real-plugins.test.ts');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
