import {access,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const nativeReplay='verification/nq-replay/native-NQ-merged-replay.json';
const nativeSample='verification/0.22.0/natural-profile-1793355420000-SHORT.json';
const recordings={
  'guide-direction-view.test.mjs':[nativeSample],
  'live-user-mode.test.mjs':[nativeSample],
  'replay-research-page.test.mjs':[nativeReplay],
  'replay-research.test.mjs':[nativeReplay],
  'research-upgrades-worker.test.mjs':['verification/0.18.0/closest-real-setup-input-part-v5-0.json'],
  'tradingview-window-real-fixture.test.mjs':['verification/0.11.0/window-fields-example.json'],
  'user-market-research-page.test.mjs':[nativeReplay,'verification/0.19.0/older-batch/native-NQ-session-2026-10-30.json'],
  'verify-preopen-recording.test.mjs':['verification/0.13.0/nq-preopen-window-session.json'],
  'verify-replay-readiness.test.mjs':[nativeReplay],
};
const files=[];
for(const name of await readdir(new URL('tests/',root))){
  if(!name.endsWith('.test.mjs'))continue;
  const required=recordings[name]??[];
  const checks=await Promise.allSettled(required.map(file=>access(new URL(file,root))));
  if(checks.some(check=>check.status==='rejected')){
    console.log('Missing local recording, skipping '+name);
    continue;
  }
  files.push('tests/'+name);
}
const test=spawnSync(process.execPath,['--test','--test-reporter=dot',...files],{cwd:fileURLToPath(root),stdio:'inherit'});
if(test.error)throw test.error;
process.exitCode=test.status??1;
