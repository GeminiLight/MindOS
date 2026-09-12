import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify, parse } from 'yaml';
import { refreshMacMetadata, verifyReleaseAssets } from '../scripts/desktop-release-assets.mjs';
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-assets-')); dirs.push(dir);
  const file = 'MindOS-1.2.3-arm64.dmg';
  writeFileSync(join(dir, file), 'signed and stapled');
  writeFileSync(join(dir, 'latest-arm64-mac.yml'), stringify({version:'1.2.3',files:[{url:file,size:1,sha512:'old'}]}));
  writeFileSync(join(dir, file + '.blockmap'), 'stale');
  return { dir, file };
}
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir,{recursive:true,force:true})));
describe('final release bytes', () => {
  it('refreshes DMG hashes after stapling and removes obsolete DMG blockmaps', async () => {
    const {dir, file} = fixture(); await refreshMacMetadata(dir);
    const info = parse(readFileSync(join(dir,'latest-arm64-mac.yml'),'utf8'));
    expect(info.files[0]).toMatchObject({size:18,sha512:createHash('sha512').update('signed and stapled').digest('base64')});
    expect(() => readFileSync(join(dir,file+'.blockmap'))).toThrow();
    await expect(verifyReleaseAssets(dir, '1.2.3', {complete:false})).resolves.toHaveLength(1);
  });
  it('rejects stale metadata and an incomplete release', async () => {
    const {dir} = fixture();
    await expect(verifyReleaseAssets(dir,'1.2.3',{complete:false})).rejects.toThrow(/mismatch/);
    await expect(verifyReleaseAssets(dir,'1.2.3')).rejects.toThrow(/Missing/);
  });
  it.each(['../secret','https://example.com/app.zip','sub/app.zip'])('rejects metadata paths outside the artifact set: %s', async url => {
    const {dir} = fixture(); writeFileSync(join(dir,'latest-arm64-mac.yml'),stringify({version:'1.2.3',files:[{url,size:1,sha512:'a'}]}));
    await expect(refreshMacMetadata(dir)).rejects.toThrow(/filename/);
  });
});

describe('complete desktop distribution', () => {
  async function completeFixture() {
    const {requiredAssets} = await import('../scripts/desktop-release-assets.mjs');
    const dir = mkdtempSync(join(tmpdir(),'complete-desktop-')); dirs.push(dir);
    const names = requiredAssets('1.2.3');
    const binaries = names.filter(name => !name.endsWith('.yml'));
    for (const name of binaries) writeFileSync(join(dir,name),'binary');
    const mappings: Record<string,string> = {
      'latest.yml':'MindOS-Setup-1.2.3.exe', 'latest-arm64.yml':'MindOS-Setup-1.2.3-arm64.exe',
      'latest-mac.yml':'MindOS-1.2.3-mac.zip', 'latest-arm64-mac.yml':'MindOS-1.2.3-arm64-mac.zip', 'latest-linux.yml':'MindOS-1.2.3.AppImage',
    };
    for (const [name,url] of Object.entries(mappings)) {
      const sha512 = createHash('sha512').update('binary').digest('base64');
      writeFileSync(join(dir,name),stringify({version:'1.2.3',path:url,sha512,files:[{url,size:6,sha512}]}));
    }
    return {dir,names};
  }
  it('accepts a complete release and checks GitHub uploaded bytes before publishing', async () => {
    const {verifyUploadedAssets} = await import('../scripts/desktop-release-assets.mjs');
    const {dir,names} = await completeFixture();
    const assets = names.map(name => {
      const bytes = readFileSync(join(dir,name));
      return {name,size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
    });
    await expect(verifyUploadedAssets(dir,'1.2.3',{assets})).resolves.toBeUndefined();
    assets[0].digest = 'sha256:wrong';
    await expect(verifyUploadedAssets(dir,'1.2.3',{assets})).rejects.toThrow(/Uploaded asset mismatch/);
  });
  it('rejects an ARM feed that points to an otherwise valid x64 binary', async () => {
    const {dir} = await completeFixture();
    writeFileSync(join(dir,'latest-arm64.yml'),readFileSync(join(dir,'latest.yml')));
    await expect(verifyReleaseAssets(dir,'1.2.3')).rejects.toThrow(/Architecture\/platform mismatch/);
  });
  it('rejects stale aliases and malformed release versions', async () => {
    const {dir} = await completeFixture();
    writeFileSync(join(dir,'MindOS-arm64.dmg'),'old binary');
    await expect(verifyReleaseAssets(dir,'1.2.3')).rejects.toThrow(/Alias mismatch/);
    await expect(verifyReleaseAssets(dir,'../main')).rejects.toThrow(/stable Desktop version/);
  });
});
