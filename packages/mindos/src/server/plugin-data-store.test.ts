import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPluginPackageSnapshot } from './plugin-package-snapshot.js';
import { readPluginData, writePluginData } from './plugin-data-store.js';
let root: string;
let binding: { pluginId: string; vaultId: string; fingerprint: string };
beforeEach(() => {
 root=mkdtempSync(join(tmpdir(),'plugin-data-test-'));
 mkdirSync(join(root,'.mindos/plugins/example'),{recursive:true});
 writeFileSync(join(root,'.mindos/plugins/example/manifest.json'),JSON.stringify({id:'example',version:'1.0.0'}));
 writeFileSync(join(root,'.mindos/plugins/example/main.js'),'module.exports = class {};');
 const {vaultId,fingerprint}=readPluginPackageSnapshot(root,'.mindos/plugins/example');
 binding={pluginId:'example',vaultId,fingerprint};
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
describe('bound plugin configuration',()=>{
 it('loads absent data and persists Unicode, false and null across fresh reads without changing code approval',()=>{
   const initial=readPluginData(root,binding);expect(initial.data).toBeNull();
   const saved=writePluginData(root,binding,initial.revision,{name:'中文 📚',enabled:false,list:[null,0,'']});
   expect(readPluginData(root,binding)).toEqual(saved);
   expect(JSON.parse(readFileSync(join(root,'.mindos/plugins/example/data.json'),'utf8'))).toEqual(saved.data);
   expect(readPluginPackageSnapshot(root,'.mindos/plugins/example').fingerprint).toBe(binding.fingerprint);
 });
 it('imports existing data and rejects a stale save without overwriting external edits',()=>{
   const file=join(root,'.mindos/plugins/example/data.json');writeFileSync(file,'{"value":1}');
   const initial=readPluginData(root,binding);writeFileSync(file,'{"value":2}');
   expect(()=>writePluginData(root,binding,initial.revision,{value:3})).toThrow(/conflict/i);
   expect(readPluginData(root,binding).data).toEqual({value:2});
 });
 it('rejects different vaults, changed package bytes and invalid plugin identities',()=>{
   expect(()=>readPluginData(root,{...binding,vaultId:'a'.repeat(64)})).toThrow(/vault/i);
   expect(()=>readPluginData(root,{...binding,pluginId:'../example'})).toThrow(/invalid/i);
   writeFileSync(join(root,'.mindos/plugins/example/main.js'),'changed');
   expect(()=>readPluginData(root,binding)).toThrow(/package/i);
 });
 it('rejects symlink configuration without reading or replacing its target',()=>{
   const outside=join(root,'outside.json');writeFileSync(outside,'{"secret":true}');
   symlinkSync(outside,join(root,'.mindos/plugins/example/data.json'));
   expect(()=>readPluginData(root,binding)).toThrow(/symlink/i);
   expect(()=>writePluginData(root,binding,'a'.repeat(64),{})).toThrow();
   expect(readFileSync(outside,'utf8')).toBe('{"secret":true}');
 });
 it('preserves legacy plugin settings without moving or reenabling the package',()=>{
   mkdirSync(join(root,'.plugins'));
   renameSync(join(root,'.mindos/plugins/example'),join(root,'.plugins/example'));
   writeFileSync(join(root,'.plugins/example/data.json'),'{"legacy":true}');
   const initial=readPluginData(root,binding);
   expect(initial.data).toEqual({legacy:true});
   writePluginData(root,binding,initial.revision,{legacy:false});
   expect(readPluginData(root,binding).data).toEqual({legacy:false});
 });
 it('rejects hardlinked settings and reserved directory identities',()=>{
   const outside=join(root,'outside.json');writeFileSync(outside,'{"secret":true}');
   linkSync(outside,join(root,'.mindos/plugins/example/data.json'));
   expect(()=>readPluginData(root,binding)).toThrow();
   expect(()=>writePluginData(root,binding,'a'.repeat(64),{})).toThrow();
   expect(readFileSync(outside,'utf8')).toBe('{"secret":true}');
   for(const pluginId of ['CON','__proto__','-example']) {
     expect(()=>readPluginData(root,{...binding,pluginId})).toThrow(/invalid/i);
   }
 });
 it('rejects malformed and oversized data, invalid revisions and unserializable values',()=>{
   const initial=readPluginData(root,binding);
   expect(()=>writePluginData(root,binding,'bad',{})).toThrow(/revision/i);
   expect(()=>writePluginData(root,binding,initial.revision,undefined)).toThrow(/JSON/i);
   expect(()=>writePluginData(root,binding,initial.revision,{value:Infinity})).toThrow(/JSON/i);
   expect(()=>writePluginData(root,binding,initial.revision,'x'.repeat(1024*1024))).toThrow(/limit/i);
   writeFileSync(join(root,'.mindos/plugins/example/data.json'),'{broken');
   expect(()=>readPluginData(root,binding)).toThrow(/JSON/i);
 });
});
