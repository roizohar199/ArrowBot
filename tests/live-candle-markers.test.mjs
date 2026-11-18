import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {buildTechnicalCandleMarkerPayload} from '../candle-marker-payload.mjs';
import {createLiveCandleMarkers,mergeConfirmedMarkerHistory} from '../live-candle-markers.mjs';

// Simulated contracts only; never market evidence, native UI or broker orders.
const seed=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
function input(){const f=structuredClone(seed);Object.assign(f.options.metadata,{instrument:'CME_MINI:NQ1!',replay:false,realtime:true,synthetic:false,testOnly:false});f.options.risk=null;f.options.config={...f.options.config,requireRisk:false,strategyPolicy:'guide_scenarios_v1'};f.bars.forEach(b=>b.finalOhlcVerified=true);return {bars:f.bars,metadata:f.options.metadata,asOfTime:f.options.asOfTime,analysis:analyzeGuideSignals(f.bars,f.options)};}
function fields(p){const last=p.records.at(-1);return {ARROW_MARKER_SCHEMA:p.schemaVersion,ARROW_MARKER_SIGNATURE:p.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:p.records.length,ARROW_MARKER_MATCHED_COUNT:p.records.length,ARROW_MARKER_DRAWN_COUNT:p.records.length,ARROW_MARKER_MODE:1,ARROW_MARKER_LAST_TIME:p.schemaVersion===5&&last?.entryFilled?last.fillTime:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:p.schemaVersion===5&&last?.entryFilled?last.fillPriceTicks:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:p.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};}
function fixture({runUi,defer=false,entryDisplay=false,interactiveFillList=false,data={}}={}){let ctx={active:true,ready:true,liveEligible:true,tabId:42,sourceUrl:'https://www.tradingview.com/chart/ARROWFR1/',sourceMode:'LIVE',runEpoch:1794835173809};const calls=[],timers=[];const controller=createLiveCandleMarkers({entryDisplay,interactiveFillList,getContext:()=>ctx,runUi:runUi??(task=>defer?Promise.resolve({status:'PRESENTATION_DEFERRED'}):task()),execute:async(_fn,c)=>{calls.push(c);if(!c.payload)return {status:'FILL_LIST_RENDERED'};return {status:'NATIVE_MARKERS_VERIFIED',fields:fields(c.payload)};},storage:{async get(k){return {[k]:data[k]};},async set(v){Object.assign(data,v);}},setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:()=>{}});return {controller,calls,data,timers,ctx,setContext:v=>{ctx={...ctx,...v};},allow:()=>{defer=false;}};}

test('full engine LIVE history produces bounded technical markers and never an order permit',()=>{
  const f=input(),p=buildTechnicalCandleMarkerPayload({...f,sourceMode:'LIVE',displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL'});assert.equal(p.status,'READY',JSON.stringify(p));assert.ok(p.records.length>0);assert.ok(p.records.every(r=>r.liveApproved===false));assert.equal(p.orderEligible,false);assert.equal(p.fillInferred,false);assert.equal(p.schemaVersion,3);
});

test('automatic marker synchronization verifies exact reflection and ignores account changes or unchanged records',async()=>{
  const f=fixture(),i=input();await f.controller.update(i);await f.controller.flush();assert.equal(f.calls.length,1);assert.equal(f.controller.snapshot().status,'VERIFIED');assert.equal(f.calls[0].expected.allowResearchLiveMultiChart,true);assert.equal(Object.hasOwn(f.calls[0].expected,'account'),false);
  f.setContext({accountId:'A completely different selected account'});await f.controller.update(i);await f.controller.flush();assert.equal(f.calls.length,1);assert.ok(Object.keys(f.data).length>0);f.controller.dispose();
});

test('native execution gets priority; deferred presentation retains its payload and retries without changing execution state',async()=>{
  const f=fixture({defer:true});await f.controller.update(input());await f.controller.flush();assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().pending,true);f.allow();await f.controller.flush();assert.equal(f.controller.snapshot().status,'VERIFIED');assert.equal(f.calls.length,1);f.controller.dispose();
});

test('hidden/stale or changed source cannot apply a queued payload to another chart',async()=>{
  const f=fixture();await f.controller.update(input());f.setContext({liveEligible:false});await f.controller.flush();assert.equal(f.calls.length,0);f.setContext({liveEligible:true,tabId:43});await f.controller.flush();assert.equal(f.calls.length,0);f.controller.dispose();
});

test('display history drops invalid, conflicting and out-of-horizon records and checks known OHLC',()=>{
  const i=input(),p=buildTechnicalCandleMarkerPayload({...i,sourceMode:'LIVE',displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL'}),r=p.records[0];assert.ok(r);
  const cached=[{...r,time:0,closeTime:60000},{...r,openTicks:0},{...r,direction:r.direction==='LONG'?'SHORT':'LONG',directionCode:-r.directionCode}];const merged=mergeConfirmedMarkerHistory(p,cached,i.bars);assert.equal(merged.records.some(x=>x.time===r.time),false,'conflicting historical direction is not drawn');assert.ok(merged.records.every(x=>x.time>0&&x.openTicks>0));assert.equal(merged.accountIndependent,true);
});

test('disposed controller cannot draw or revive from pending timers',async()=>{const f=fixture();await f.controller.update(input());f.controller.dispose();await f.controller.flush();assert.equal(f.calls.length,0);});
test('interactive fill list receives only the natively verified wire payload after marker delivery',async()=>{
 const f=fixture({entryDisplay:true,interactiveFillList:true});await f.controller.update(input());await f.controller.flush();assert.equal(f.controller.snapshot().status,'VERIFIED');assert.equal(f.calls.length,2);assert.equal(f.calls[0].action,'deliver');assert.deepEqual(f.calls[1],{action:'show',expected:{researchUrl:f.ctx.sourceUrl,instrument:'CME_MINI:NQ1!',runEpoch:f.ctx.runEpoch},textPayload:f.controller.snapshot().payload.textPayload});await f.controller.flush();assert.equal(f.calls.length,2);f.controller.dispose();
});
test('recomputed historical research replaces obsolete past markers while preserving actual live approvals',async()=>{const f=fixture(),i=input();await f.controller.update(i);const previous=f.controller.snapshot().payload;assert.ok(previous.records.length>0);await f.controller.acceptHistorical({kind:'HISTORY24_RESEARCH_RESULT_V1',status:'COMPLETE',start:i.bars[0].time-1,end:i.bars.at(-1).closeTime,signals:[],ordersCreated:false,orderEligible:false,fillInferred:false});await f.controller.flush();assert.equal(f.controller.snapshot().payload.records.length,0);assert.equal(f.controller.snapshot().status,'VERIFIED');assert.equal(f.calls.at(-1).payload.records.length,0);f.controller.dispose();});


test('fill display refresh promotes only a native verified fill, survives restart, and keeps account switches as research',async()=>{
 const data={},f=fixture({entryDisplay:true,data}),i=input(),account={provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:'test'};f.setContext({accountIdentity:account});await f.controller.update(i);await f.controller.flush();let p=f.controller.snapshot().payload;assert.equal(p.schemaVersion,5);assert.equal(p.entryArrowCount,0);assert.ok(p.researchCircleCount>0);const r=p.records.at(-1);
 const timeText=new Date(r.closeTime+1000).toISOString().slice(0,19).replace('T',' '),nativeFill={kind:'NATIVE_EXECUTED_FILL_V1',origin:'PUBLIC_NATIVE_UI',...account,nativeOrderId:'101',direction:r.direction,price:r.closeTicks*.25,filledAt:r.closeTime+1000,timeText,timestampField:'closeDate',timestampPrecisionMs:1000,utcOffsetMinutes:0,timezoneBasis:'VISIBLE_CHART_TIMEZONE_MENU',orderRow:{id:'101',type:'Market',status:'filled',side:r.direction==='LONG'?'Buy':'Sell',symbol:'CME_MINI:NQZ2026',avgPrice:String(r.closeTicks*.25),closeDate:timeText}};i.execution={journal:[{phase:'NATIVE_SUBMISSION_REPLY',eventId:r.eventId,attemptKey:'a'},{phase:'NATIVE_FILLED_VERIFIED',attemptKey:'a',result:{...account,intentKey:'a',nativeOrderId:'101',ownedStatus:'FILLED',fillVerified:true,ownershipVerified:true,nativeFill}}]};await f.controller.update(i);await f.controller.flush();assert.equal(f.controller.snapshot().payload.entryArrowCount,1);assert.equal(f.controller.snapshot().status,'VERIFIED');await f.controller.acceptHistorical({kind:'HISTORY24_RESEARCH_RESULT_V1',status:'COMPLETE',start:i.bars[0].time-1,end:i.bars.at(-1).closeTime,signals:[],ordersCreated:false,orderEligible:false,fillInferred:false});await f.controller.flush();assert.equal(f.controller.snapshot().payload.schemaVersion,5,'history cannot downgrade an unchanged verified entry payload');assert.equal(f.controller.snapshot().payload.entryArrowCount,1);f.controller.dispose();
 const second=fixture({entryDisplay:true,data});second.setContext({accountIdentity:account});await second.controller.update({...i,execution:{journal:[]}});await second.controller.flush();assert.equal(second.controller.snapshot().payload.entryArrowCount,1);second.setContext({accountIdentity:{...account,nativeAccountId:'PA-other'}});await second.controller.update({...i,execution:{journal:[]}});await second.controller.flush();assert.equal(second.controller.snapshot().payload.entryArrowCount,0);second.controller.dispose();
});
