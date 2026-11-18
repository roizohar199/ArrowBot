import test from 'node:test';
import assert from 'node:assert/strict';
import {createLivePaperQuickStart,PAPER_RESEARCH_URL,PAPER_FULL_SCREENS_URL,isPaperResearchUrl,isPaperSourceUrl} from '../live-paper-quick-start.mjs';

function fixture({tabs=[{id:5,windowId:9,url:PAPER_RESEARCH_URL,status:'complete'}],ready=true}={}){
  let clock=10000,cancelled=false,selectedId=5;const calls=[],profile={id:'paper',enabled:true,provider:'TRADINGVIEW_PAPER',environment:'DEMO',userManagedRisk:true,nativeAccountId:'local-paper',revision:1};
  const state={profile,active:false,sourceTabId:null,reviewAccepted:false,settingsDirty:false,ready,liveEligible:ready,stale:false,lastReceivedAt:clock,accountReady:ready};
  const chrome={tabs:{query:async()=>tabs,get:async id=>({status:'complete',...tabs.find(t=>t.id===id)??{id,windowId:9,url:PAPER_RESEARCH_URL}}),update:async(...args)=>calls.push(['activate',...args])},windows:{create:async options=>{calls.push(['create',options]);return {id:9,tabs:[{id:5,windowId:9,url:PAPER_RESEARCH_URL}]};},update:async(...args)=>calls.push(['focus',...args])},scripting:{executeScript:async options=>{calls.push(['ui',options]);return [{result:{status:'READY'}}];}}};
  const quick=createLivePaperQuickStart({chrome,getSession:()=>state,selectSource:async id=>{selectedId=id;calls.push(['select',id]);if(Object.hasOwn(state,'preferredSourceTabId'))state.preferredSourceTabId=id;},connectSource:async()=>{calls.push(['connect']);state.active=true;state.sourceTabId=selectedId;state.reviewAccepted=true;},sleep:async ms=>{clock+=ms;state.lastReceivedAt=clock;if(clock>=10400){state.ready=true;state.liveEligible=true;state.accountReady=true;}},now:()=>clock,timeoutMs:2000});
  return {state,calls,quick,chrome,cancel:()=>{cancelled=true;},prepare:()=>quick.prepare({isCancelled:()=>cancelled})};
}
test('explicit start opens only the exact fallback research window and never navigates another saved layout',async()=>{
  const f=fixture({tabs:[{id:2,windowId:3,url:'https://www.tradingview.com/chart/Other/'}]});await f.prepare();
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.find(c=>c[0]==='create')[1].url,PAPER_RESEARCH_URL);
  assert.deepEqual(f.calls.find(c=>c[0]==='activate'),['activate',5,{active:true}]);assert.equal(f.quick.snapshot().status,'SOURCE_READY');
});
test('unset source selection prefers the existing FULL SCREENS tab without navigation or layout writes',async()=>{
  const f=fixture({tabs:[{id:5,windowId:9,url:PAPER_RESEARCH_URL},{id:2,windowId:3,url:PAPER_FULL_SCREENS_URL}]});await f.prepare();
  assert.deepEqual(f.calls.find(c=>c[0]==='activate'),['activate',2,{active:true}]);assert.equal(f.calls.some(c=>c[0]==='create'),false);
  assert.equal(f.quick.snapshot().sourceUrl,PAPER_FULL_SCREENS_URL);assert.equal(f.quick.snapshot().layoutName,'Full Screens Live');
  assert.deepEqual(f.calls.find(c=>c[0]==='ui')[1].args,[{nativeAccountId:'local-paper',sourceUrl:PAPER_FULL_SCREENS_URL}]);
});
test('an explicit allowed source selection wins over defaults, while invalid or unsupported selections never fall back',async()=>{
  const tabs=[{id:5,windowId:9,url:PAPER_RESEARCH_URL},{id:2,windowId:3,url:PAPER_FULL_SCREENS_URL},{id:7,windowId:3,url:PAPER_FULL_SCREENS_URL}];
  for(const id of [5,2,7]){const f=fixture({tabs});f.state.preferredSourceTabId=id;await f.prepare();assert.deepEqual(f.calls.find(c=>c[0]==='activate'),['activate',id,{active:true}]);assert.equal(f.calls.some(c=>c[0]==='create'),false);}
  for(const id of [0,'2',42]){const f=fixture({tabs});f.state.preferredSourceTabId=id;await assert.rejects(f.prepare(),/PAPER_SOURCE_SELECTION_(?:INVALID|UNSUPPORTED)/);assert.equal(f.calls.length,0);}
  const unsupported=fixture({tabs:[{id:2,windowId:3,url:PAPER_FULL_SCREENS_URL+'?symbol=CME_MINI%3ANQ1%21'},{id:5,windowId:9,url:PAPER_RESEARCH_URL}]});unsupported.state.preferredSourceTabId=2;await assert.rejects(unsupported.prepare(),/PAPER_SOURCE_SELECTION_UNSUPPORTED/);assert.equal(unsupported.calls.length,0);
  const ambiguous=fixture({tabs});await assert.rejects(ambiguous.prepare(),/MULTIPLE_FULL_SCREENS_TABS/);assert.equal(ambiguous.calls.length,0);
});
test('a changed explicit source choice cancels preparation before subsequent native actions',async()=>{
  const f=fixture();f.state.preferredSourceTabId=5;f.chrome.tabs.query=async()=>{f.state.preferredSourceTabId=2;return [{id:5,windowId:9,url:PAPER_RESEARCH_URL}];};await assert.rejects(f.prepare(),/PAPER_SOURCE_SELECTION_CHANGED/);assert.equal(f.calls.length,0);
});
test('a ready connected research source is reused without reconnect or waiting',async()=>{
  const f=fixture();Object.assign(f.state,{active:true,sourceTabId:5,reviewAccepted:true});await f.prepare();assert.equal(f.calls.some(c=>c[0]==='connect'||c[0]==='create'),false);assert.equal(f.quick.snapshot().elapsedMs,0);
});
test('source preparation waits for real fresh ready state and grants no execution authority',async()=>{
  const f=fixture({ready:false});assert.equal(await f.prepare(),undefined);assert.equal(f.quick.snapshot().elapsedMs,400);assert.equal('orderEligible' in f.quick.snapshot(),false);
});
test('PA, duplicate source, changed source, and cancellation cannot reach account preparation',async()=>{
  const pa=fixture();pa.state.profile.provider='TRADOVATE';await assert.rejects(pa.prepare(),/PAPER_DEMO_PROFILE_REQUIRED/);assert.equal(pa.calls.length,0);
  const dup=fixture({tabs:[{id:5,windowId:9,url:PAPER_RESEARCH_URL},{id:6,windowId:9,url:PAPER_RESEARCH_URL}]});await assert.rejects(dup.prepare(),/MULTIPLE_RESEARCH_TABS/);assert.equal(dup.calls.length,0);
  const changed=fixture();changed.chrome.tabs.get=async()=>({url:'https://www.tradingview.com/chart/ARROWFR1/'});await assert.rejects(changed.prepare(),/RESEARCH_SOURCE_CHANGED/);assert.equal(changed.calls.some(c=>c[0]==='ui'),false);
  const stopped=fixture();stopped.cancel();await assert.rejects(stopped.prepare(),/START_CANCELLED/);assert.equal(stopped.calls.length,0);
});
test('cancellation and changed profile after asynchronous browser operations prevent all later actions',async()=>{
  const f=fixture();f.chrome.tabs.query=async()=>{f.cancel();return [];};await assert.rejects(f.prepare(),/START_CANCELLED/);assert.equal(f.calls.length,0);
  const p=fixture();p.chrome.tabs.query=async()=>{p.state.profile={...p.state.profile,revision:2};return [];};await assert.rejects(p.prepare(),/ACCOUNT_PROFILE_CHANGED/);assert.equal(p.calls.length,0);
});
test('URL qualification is exact and UI readiness cannot substitute for real source readiness',async()=>{
  assert.equal(isPaperResearchUrl(PAPER_RESEARCH_URL),true);for(const url of [PAPER_RESEARCH_URL+'?x=1',PAPER_RESEARCH_URL+'#x','https://evil.test/chart/ARROWRV1/'])assert.equal(isPaperResearchUrl(url),false);
  assert.equal(isPaperSourceUrl(PAPER_FULL_SCREENS_URL),true);assert.equal(isPaperSourceUrl(PAPER_RESEARCH_URL),true);for(const url of [PAPER_FULL_SCREENS_URL+'?x=1',PAPER_FULL_SCREENS_URL+'#x','https://evil.test/chart/ARROWFR1/'])assert.equal(isPaperSourceUrl(url),false);
  const f=fixture();f.state.stale=true;await assert.rejects(f.prepare(),/RESEARCH_START_TIMEOUT/);assert.equal(f.quick.snapshot().status,'FAILED');
});
