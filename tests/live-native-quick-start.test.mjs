import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveNativeQuickStart,prepareNativeUserAccountPanel,readNativeStartupWarmup} from '../live-native-quick-start.mjs';

const full='https://www.tradingview.com/chart/ARROWFR1/',research='https://www.tradingview.com/chart/ARROWRV1/';
function fixture({provider='TRADOVATE',environment='PA',ready=true,timeoutMs=1200,afterSleep=(state,elapsed)=>{if(elapsed>=400)Object.assign(state,{ready:true,liveEligible:true,accountReady:true});}}={}){
  let clock=10000;const calls=[],tabs=[{id:5,windowId:9,url:full,status:'complete'},{id:6,windowId:10,url:research,status:'complete'}];
  const state={profile:{id:'chosen',provider,environment,enabled:true,userManagedRisk:true,nativeAccountId:'exact-account',revision:1},preferredSourceTabId:null,active:false,sourceTabId:null,reviewAccepted:false,settingsDirty:false,ready,liveEligible:ready,stale:false,lastReceivedAt:clock,accountReady:ready};
  const chrome={tabs:{query:async()=>tabs,get:async id=>tabs.find(t=>t.id===id),update:async(...args)=>{calls.push(['activate',...args]);}},windows:{update:async(...args)=>{calls.push(['focus',...args]);}},scripting:{executeScript:async options=>{calls.push(['script',options]);return [{result:options.func===prepareNativeUserAccountPanel?{status:'READY'}:{status:'OBSERVED',provider:state.profile.provider,nativeAccountId:state.profile.nativeAccountId,nativeIdentityVerified:true,environment:provider==='TRADINGVIEW_PAPER'?'DEMO':null,environmentVerified:provider==='TRADINGVIEW_PAPER'}}];}}};
  const quick=createLiveNativeQuickStart({chrome,getSession:()=>state,selectSource:async id=>{calls.push(['select',id]);state.preferredSourceTabId=id;},connectSource:async()=>{calls.push(['connect']);Object.assign(state,{active:true,sourceTabId:state.preferredSourceTabId,reviewAccepted:true});},now:()=>clock,timeoutMs,sleep:async ms=>{clock+=ms;state.lastReceivedAt=clock;afterSleep(state,clock-10000);}});
  return {quick,state,calls,chrome,tabs};
}

test('Paper and explicitly selected Tradovate environments share the same source preparation without Order or risk fields',async()=>{
  for(const [provider,environment] of [['TRADINGVIEW_PAPER','DEMO'],['TRADOVATE','DEMO'],['TRADOVATE','PA'],['TRADOVATE','LIVE'],['TRADOVATE','EVALUATION']]){
    const f=fixture({provider,environment});await f.quick.prepare();
    assert.equal(f.quick.snapshot().status,'SOURCE_READY');assert.equal(f.quick.snapshot().provider,provider);
    assert.deepEqual(f.calls.find(c=>c[0]==='activate'),['activate',5,{active:true}]);
    const ui=f.calls.find(c=>c[0]==='script')[1];assert.equal(ui.func,prepareNativeUserAccountPanel);
    assert.deepEqual(ui.args,[{provider,nativeAccountId:'exact-account',sourceUrl:full}]);
    assert.equal(f.calls.filter(c=>c[0]==='script').length,2);
    assert.equal('armed' in f.quick.snapshot(),false);
  }
});

test('explicit research choice wins without navigation, account selection or layout writes',async()=>{
  const f=fixture();f.state.preferredSourceTabId=6;await f.quick.prepare();
  assert.deepEqual(f.calls.find(c=>c[0]==='activate'),['activate',6,{active:true}]);assert.equal(f.quick.snapshot().sourceUrl,research);
  assert.equal(f.calls.some(c=>['create','navigate','order'].includes(c[0])),false);
});

test('a ready current source is reused; a warming source must become genuinely ready',async()=>{
  const f=fixture();Object.assign(f.state,{active:true,sourceTabId:5,reviewAccepted:true});await f.quick.prepare();assert.equal(f.calls.some(c=>c[0]==='connect'),false);
  const warming=fixture({ready:false});await warming.quick.prepare();assert.equal(warming.quick.snapshot().elapsedMs,400);
  const stale=fixture();stale.state.stale=true;await assert.rejects(stale.quick.prepare(),/NATIVE_START_TIMEOUT/);
});

test('the same click survives a cold start that becomes live five seconds after the original deadline',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO',ready:false,timeoutMs:180_000,afterSleep(state,elapsed){
    state.warmup={runId:'nq-run',target:100,collected:Math.min(100,Math.floor(elapsed/1800)),contiguous:Math.min(100,Math.floor(elapsed/1850))};
    if(elapsed>=184_000)Object.assign(state,{ready:true,accountReady:true});
    if(elapsed>=185_000)state.liveEligible=true;
  }});
  const progress=[];await f.quick.prepare({onProgress:message=>progress.push(message)});
  assert.ok(progress.some(message=>/נאספו \d+ מתוך 100 נרות דקה/.test(message)));
  assert.equal(f.quick.snapshot().elapsedMs,185_000);
  assert.equal(f.quick.snapshot().status,'SOURCE_READY');
  assert.equal(f.calls.filter(call=>call[0]==='connect').length,1);
});

test('repeated warming frames and progress beyond the hard limit cannot keep a pending activation indefinitely',async()=>{
  for(const [afterSleep,expected] of [
    [(s,t)=>{if(t>=170_000)s.warmup={runId:'run',target:100,collected:88,contiguous:24};},230_200],
    [(s,t)=>{s.warmup={runId:'run',target:100,collected:100,contiguous:Math.floor(t/4000)};},360_200],
  ]){
    const f=fixture({ready:false,timeoutMs:180_000,afterSleep});
    await assert.rejects(f.quick.prepare(),/NATIVE_START_TIMEOUT/);
    assert.equal(f.quick.snapshot().elapsedMs,expected);
  }
});

test('startup progress reports validated observed history without lending readiness to hidden or replay charts',()=>{
  const evidence={windowFrame:{coherent:true,checksumsVerified:true,realtime:true,historyCounts:[100]},chart:{documentVisible:true,replay:false},
    bootstrapMetadata:{runId:'nq-run'},history:[{timeframe:'1',retainedBars:87,contiguousBars:24}]};
  assert.deepEqual(readNativeStartupWarmup(evidence),{runId:'nq-run',target:100,collected:87,contiguous:24});
  for(const overrides of [{chart:{documentVisible:false,replay:false}},{chart:{documentVisible:true,replay:true}},{windowFrame:{...evidence.windowFrame,checksumsVerified:false}}]){
    assert.equal(readNativeStartupWarmup({...evidence,...overrides}),null);
  }
});

test('profile, source and native identity changes stop before activation',async()=>{
  const mismatch=fixture();mismatch.chrome.scripting.executeScript=async options=>[{result:options.func===prepareNativeUserAccountPanel?{status:'READY'}:{status:'OBSERVED',provider:'TRADOVATE',nativeAccountId:'another-account',nativeIdentityVerified:true,environmentVerified:false}}];
  await assert.rejects(mismatch.quick.prepare(),/SELECTED_AND_VISIBLE_ACCOUNT_DIFFER/);assert.equal(mismatch.calls.some(c=>c[0]==='connect'),false);
  const changed=fixture();changed.chrome.tabs.query=async()=>{changed.state.profile={...changed.state.profile,revision:2};return changed.tabs;};await assert.rejects(changed.quick.prepare(),/ACCOUNT_PROFILE_CHANGED/);assert.equal(changed.calls.length,0);
  const url=fixture();url.tabs[0].url=full+'?symbol=x';url.state.preferredSourceTabId=5;await assert.rejects(url.quick.prepare(),/OPEN_SUPPORTED_TRADINGVIEW_SOURCE_REQUIRED/);assert.equal(url.calls.length,0);
});

test('ambiguous defaults and cancellation never silently pick another account or source',async()=>{
  const f=fixture();f.tabs.push({id:7,windowId:11,url:full});await assert.rejects(f.quick.prepare(),/NATIVE_SOURCE_SELECTION_AMBIGUOUS/);assert.equal(f.calls.length,0);
  const c=fixture();await assert.rejects(c.quick.prepare({isCancelled:()=>true}),/START_CANCELLED/);assert.equal(c.calls.length,0);
  const unsupported=fixture({provider:'OTHER'});await assert.rejects(unsupported.quick.prepare(),/SUPPORTED_NATIVE_ACCOUNT_PROFILE_REQUIRED/);assert.equal(unsupported.calls.length,0);
});
