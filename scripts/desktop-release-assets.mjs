#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';

const feeds = ['latest.yml', 'latest-arm64.yml', 'latest-mac.yml', 'latest-arm64-mac.yml', 'latest-linux.yml'];
function filename(value) {
  if (typeof value !== 'string' || !value || value !== basename(value) || /[\\/:\0]/.test(value) || value === '..') {
    throw new Error(`Invalid release filename: ${value}`);
  }
  return value;
}
async function digest(file, algorithm = 'sha512', encoding = 'base64') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
async function readFeed(dir, file) {
  const info = parse(await readFile(join(dir, file), 'utf8'));
  if (!info || !Array.isArray(info.files) || !info.files.length) throw new Error(`Empty update feed: ${file}`);
  for (const entry of info.files) filename(entry.url);
  if (info.path) filename(info.path);
  return info;
}
export async function refreshMacMetadata(dir) {
  for (const name of await readdir(dir)) {
    if (!/^latest(?:-arm64)?-mac\.yml$/.test(name)) continue;
    const info = await readFeed(dir, name);
    for (const entry of info.files) {
      if (!entry.url.endsWith('.dmg')) continue;
      const file = join(dir, entry.url);
      entry.size = (await stat(file)).size;
      entry.sha512 = await digest(file);
      if (info.path === entry.url) info.sha512 = entry.sha512;
      // MacUpdater consumes ZIP blockmaps. A pre-staple DMG blockmap describes
      // different bytes; do not publish an unused and invalid differential map.
      await unlink(file + '.blockmap').catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await writeFile(join(dir, name), stringify(info));
  }
}
export function requiredAssets(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable Desktop version');
  return [...feeds,
    `MindOS-${version}-arm64.dmg`, `MindOS-${version}.dmg`,
    `MindOS-${version}-arm64-mac.zip`, `MindOS-${version}-mac.zip`,
    `MindOS-Setup-${version}.exe`, `MindOS-Setup-${version}-arm64.exe`,
    `MindOS-${version}.AppImage`, `mindos-desktop_${version}_amd64.deb`,
    'MindOS-arm64.dmg', 'MindOS.dmg', 'MindOS-Setup.exe', 'MindOS-Setup-arm64.exe', 'MindOS.AppImage', 'mindos-desktop_amd64.deb'];
}
export async function verifyReleaseAssets(dir, version, { complete = true } = {}) {
  const names = await readdir(dir);
  if (complete) for (const file of requiredAssets(version)) {
    if (!names.includes(file) || !(await stat(join(dir, file))).isFile()) throw new Error(`Missing release asset: ${file}`);
  }
  const checked = [];
  for (const name of names.filter(name => feeds.includes(name))) {
    const info = await readFeed(dir, name);
    if (info.version !== version) throw new Error(`Version mismatch: ${name}`);
    if (complete) {
      const primary = {
        'latest.yml': `MindOS-Setup-${version}.exe`,
        'latest-arm64.yml': `MindOS-Setup-${version}-arm64.exe`,
        'latest-mac.yml': `MindOS-${version}-mac.zip`,
        'latest-arm64-mac.yml': `MindOS-${version}-arm64-mac.zip`,
        'latest-linux.yml': `MindOS-${version}.AppImage`,
      }[name];
      if (!info.files.some(entry => entry.url === primary) || (info.path && info.path !== primary)) {
        throw new Error(`Architecture/platform mismatch: ${name}`);
      }
    }
    for (const entry of info.files) {
      const file = join(dir, entry.url);
      if ((await stat(file)).size !== entry.size || await digest(file) !== entry.sha512) throw new Error(`Size/hash mismatch: ${entry.url}`);
      checked.push(entry.url);
    }
    if (info.path) {
      const entry = info.files.find(entry => entry.url === info.path);
      if (!entry || entry.sha512 !== info.sha512) throw new Error(`Legacy feed mismatch: ${name}`);
    }
  }
  if (!checked.length) throw new Error('Missing update feeds');
  if (complete) {
    const aliases = [
      ['MindOS-arm64.dmg', `MindOS-${version}-arm64.dmg`], ['MindOS.dmg', `MindOS-${version}.dmg`],
      ['MindOS-Setup.exe', `MindOS-Setup-${version}.exe`], ['MindOS-Setup-arm64.exe', `MindOS-Setup-${version}-arm64.exe`],
      ['MindOS.AppImage', `MindOS-${version}.AppImage`], ['mindos-desktop_amd64.deb', `mindos-desktop_${version}_amd64.deb`],
    ];
    for (const [alias, file] of aliases) {
      if (await digest(join(dir, alias)) !== await digest(join(dir, file))) throw new Error(`Alias mismatch: ${alias}`);
    }
  }
  return checked;
}
export async function verifyUploadedAssets(dir, version, uploaded) {
  await verifyReleaseAssets(dir, version);
  const assets = uploaded?.assets;
  if (!Array.isArray(assets)) throw new Error('Missing uploaded asset list');
  for (const name of (await readdir(dir)).filter(name => /\.(dmg|zip|exe|AppImage|deb|blockmap)$/.test(name) || feeds.includes(name))) {
    const remote = assets.find(asset => asset.name === name);
    const local = join(dir, name);
    if (!remote || remote.size !== (await stat(local)).size || remote.digest !== `sha256:${await digest(local, 'sha256', 'hex')}`) {
      throw new Error(`Uploaded asset mismatch: ${name}`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, dir, version, uploaded] = process.argv.slice(2);
  if (mode === 'refresh-mac') await refreshMacMetadata(dir);
  else if (mode === 'verify') await verifyReleaseAssets(dir, version);
  else if (mode === 'verify-upload') await verifyUploadedAssets(dir, version, JSON.parse(await readFile(uploaded, 'utf8')));
  else throw new Error('Usage: desktop-release-assets.mjs refresh-mac DIR | verify DIR VERSION');
  console.log(`Desktop release assets: ${mode} OK`);
}
