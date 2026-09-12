import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
const workflow = parse(readFileSync(resolve(__dirname,'../.github/workflows/build-desktop.yml'),'utf8'));
const script = workflow.jobs.finalize.steps.find((step: {name: string}) => step.name === 'Upload to Alibaba Cloud OSS').run.replaceAll('${{ steps.version.outputs.version }}','1.2.3');
describe.skipIf(process.platform === 'win32')('OSS publication failure accounting', () => {
  it.each(['version', 'latest', 'none'])('reports %s stage accurately without hiding failed children', stage => {
    const dir = mkdtempSync(join(tmpdir(),'desktop-mirror-'));
    try {
      mkdirSync(join(dir,'artifacts')); mkdirSync(join(dir,'bin'));
      writeFileSync(join(dir,'artifacts','MindOS-1.2.3.dmg'),'fixture');
      writeFileSync(join(dir,'bin','ossutil64'), `#!/bin/sh\necho "$*" >> "$TRACE_FILE"\ncase "$*" in\n *desktop/latest/*) [ "$FAIL_STAGE" != latest ];;\n *) [ "$FAIL_STAGE" != version ];;\nesac\n`, {mode:0o755});
      const result = spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:dir,encoding:'utf8',timeout:5000,env:{...process.env,PATH:`${join(dir,'bin')}:${process.env.PATH}`,OSS_ACCESS_KEY_ID:'test',OSS_ACCESS_KEY_SECRET:'test',OSS_ENDPOINT:'invalid',OSS_BUCKET:'fixture',FAIL_STAGE:stage,TRACE_FILE:join(dir,'trace')}});
      expect(result.status,result.stderr).toBe(stage === 'none' ? 0 : 1);
      expect(result.stdout.includes('Uploaded to Alibaba')).toBe(stage === 'none');
      if (stage === 'version') expect(readFileSync(join(dir,'trace'),'utf8')).not.toContain('desktop/latest/');
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
});
