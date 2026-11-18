import {buildTechnicalCandleMarkerPayload} from '../candle-marker-payload.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistory24Cache} from '../history-24-core.mjs';
import {analyzeWarmupSequential} from '../history-warmup-analysis.mjs';
import {createWarmupModel} from '../history-warmup-model.mjs';
import {createHistoryWarmupController} from '../history-warmup-controller.mjs';
import {createGuideAnalyzer} from '../guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from '../guide-technical-decision.mjs';
import {selectFreshLiveSignal} from '../live-signal-eligibility.mjs';
import {userManagedLiveAnalysisOptions} from '../live-user-mode.mjs';
import {readFile} from 'node:fs/promises';

const end=Date.UTC(2026,10,16,18),minute=60000;
const metadata={source:'ohlc',sourceId:'warmup-fixture',tabId:7,sourceUrl:'https://www.tradingview.com/chart/ARROWFR1/',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
function rows(tf,count){const d=Number(tf)*minute,last=Math.floor(end/d)*d;return Array.from({length:count},(_,i)=>{const close=27000+(i%20)*.25;return {time:last-(count-i)*d,closeTime:last-(count-i-1)*d,open:close,high:close+1,low:close-1,close:close+.25,volume:100,closed:true,sourceClosed:true,finalOhlcVerified:true,providerBarIndex:i+10000,sessionFirst:false,sessionLast:false,knownAt:end+5000};});}
function dataset(count=3000){const series={'1':rows('1',count),'5':rows('5',Math.ceil(count/5)+120),'15':rows('15',Math.ceil(count/15)+120)};return {kind:'WARMUP_VERIFIED_COUNT_DATASET_V1',complete:true,requestedBars:count,start:series['1'][0].time,end,series,coverage:[]};}
function nativeState(data){const bars=data.series['1'].slice(-100).map((b,i)=>({...b,providerBarIndex:i+40,knownAt:end+100}));return {ready:true,liveEligible:true,stale:false,requiresSnapshot:false,decisionAsOfTime:end+6000,generation:2,metadata,bars,bootstrapAsOfTime:end-600000};}
function higher(data){return Object.fromEntries(['5','15'].map(tf=>[tf,{bars:data.series[tf].slice(-100).map((b,i)=>({...b,knownAt:end+100,providerBarIndex:i+50})),metadata:{...metadata,timeframe:tf,timeframeMs:Number(tf)*minute}}]));}
test('3000-count coverage crosses clock-day boundaries, persists all required rows and never reduces the separate 24-hour range',()=>{
  const cache=createHistory24Cache(),data=dataset();for(const tf of ['1','5','15'])cache.ingest(data.series[tf],tf,{runKey:'native',windowEnd:end});
  const exact=cache.forBars(end);assert.equal(exact.complete,true,JSON.stringify(exact.coverage));assert.equal(exact.series['1'].length,3000);assert.ok(exact.start<end-86400000);assert.equal(cache.forRange(end).start,end-86400000);
  const restored=createHistory24Cache(JSON.parse(JSON.stringify(cache.snapshot())));assert.deepEqual(restored.forBars(end),exact);
  const partial=createHistory24Cache();partial.ingest(data.series['1'].slice(-2999),'1',{runKey:'native',windowEnd:end});assert.equal(partial.forBars(end).complete,false);
});
test('causal chronological processing accounts for every bar, matches one-bar replay and cannot create live approvals',async()=>{
  const data=dataset(60),original=structuredClone(data),progress=[];
  const one=await analyzeWarmupSequential(data,metadata,{batchSize:1,yieldControl:async()=>{}}),batch=await analyzeWarmupSequential(data,metadata,{batchSize:10,onProgress:p=>progress.push(p.processedBars),yieldControl:async()=>{}});
  assert.equal(batch.status,'COMPLETE',JSON.stringify(batch.reasonCodes));assert.equal(batch.processedBars,60);assert.deepEqual(batch.audit.map(r=>r.index),Array.from({length:60},(_,i)=>i));assert.deepEqual(batch.signals,one.signals);assert.deepEqual(data,original);assert.deepEqual(progress,[10,20,30,40,50,60]);assert.equal(batch.orderEligible,false);assert.equal(batch.ordersCreated,false);assert.ok(batch.signals.every(s=>s.liveApproved===false));
  const gap=structuredClone(data);gap.series['1'].splice(20,1);gap.requestedBars--;assert.equal((await analyzeWarmupSequential(gap,metadata,{yieldControl:async()=>{}})).status,'BLOCKED');
});
test('batched chronological replay preserves nonempty real-engine confirmations and cannot borrow future bars',async()=>{
  const source=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
  const verified=input=>input.map((b,i)=>({...b,closed:true,sourceClosed:true,finalOhlcVerified:true,providerBarIndex:i+10000,sessionFirst:false,sessionLast:false}));
  const data={complete:true,requestedBars:source.bars.length,series:{'1':verified(source.bars),'5':verified(source.options.higherTimeframes['5'].bars),'15':verified(source.options.higherTimeframes['15'].bars)},coverage:[]};
  const meta={...source.options.metadata,instrument:metadata.instrument};
  const batch=await analyzeWarmupSequential(data,meta,{batchSize:25,yieldControl:async()=>{}}),one=await analyzeWarmupSequential(data,meta,{batchSize:1,yieldControl:async()=>{}});
  assert.equal(batch.status,'COMPLETE',JSON.stringify(batch.reasonCodes));assert.ok(batch.signals.length>0,'the test must exercise confirmations, not just compare two empty lists');assert.deepEqual(batch.signals,one.signals);
  assert.ok(batch.audit.some(row=>row.patternIds.length>0));
  const prefix=structuredClone(data);prefix.series['1']=prefix.series['1'].slice(0,-30);prefix.requestedBars-=30;const earlier=await analyzeWarmupSequential(prefix,meta,{batchSize:25,yieldControl:async()=>{}}),cutoff=prefix.series['1'].at(-1).closeTime;
  assert.deepEqual(batch.signals.filter(s=>s.closeTime<=cutoff),earlier.signals);
});

test('a fresh full-engine LONG and SHORT remain eligible with 3000 bars and user-managed risk, while old reconstruction never passes the live baseline',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
  for(const direction of ['LONG','SHORT']){
    const f=structuredClone(fixture),first=f.bars[0],missing=3000-f.bars.length;
    const past=Array.from({length:missing},(_,i)=>({...first,time:first.time-(missing-i)*minute,closeTime:first.time-(missing-i-1)*minute,knownAt:first.time-(missing-i-1)*minute,open:first.open,high:first.open+.25,low:first.open-.25,close:first.open}));
    f.bars=[...past,...f.bars];if(direction==='SHORT'){const mirror=b=>({...b,open:56676-b.open,high:56676-b.low,low:56676-b.high,close:56676-b.close});f.bars=f.bars.map(mirror);for(const h of Object.values(f.options.higherTimeframes))h.bars=h.bars.map(mirror);}
    // Artificial trusted transport contract only; never leaves Node.
    f.options.metadata={...f.options.metadata,instrument:metadata.instrument,synthetic:false,testOnly:false,replay:false,realtime:true};f.bars.forEach(b=>b.finalOhlcVerified=true);
    const options={...f.options,...userManagedLiveAnalysisOptions()};options.config.maxBars=3000;
    const analysis=createGuideAnalyzer().analyze(f.bars,{...options,evaluationStartIndex:2994}),decision=selectGuideTechnicalDecision({analysis,bars:f.bars});
    assert.equal(analysis.stats.closedBars,3000);assert.equal(decision.status,'CONFIRMED',JSON.stringify(decision.reasonCodes));assert.equal(decision.direction,direction);
    const signal=analysis.signals.find(s=>s.confirmationBarCloseTime===analysis.asOfTime);assert.ok(signal);assert.equal(signal.riskPlan,null);
    const fresh=selectFreshLiveSignal(signal,analysis,{bootstrapAsOfTime:signal.formationStartTime-1,eligibleCloseTimes:[analysis.asOfTime],bars:f.bars});assert.ok(fresh);assert.equal(fresh.direction,direction);
    const markers=buildTechnicalCandleMarkerPayload({analysis,bars:f.bars,metadata:{...analysis.metadata,replay:false,realtime:true},sourceMode:'LIVE',displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL',asOfTime:analysis.asOfTime,approvedSignals:[fresh]});
    assert.equal(markers.status,'READY',JSON.stringify(markers.reasonCodes));assert.equal(markers.records.at(-1).direction,direction);assert.equal(markers.records.at(-1).time,f.bars.at(-1).time);
    assert.equal(selectFreshLiveSignal(signal,analysis,{bootstrapAsOfTime:analysis.asOfTime+1,eligibleCloseTimes:[analysis.asOfTime],bars:f.bars}),null);
    for(const key of ['quantity','stop','target','riskBudget'])assert.equal(Object.hasOwn(fresh,key),false);
  }
});
test('a processed 3000-bar model activates only on a safe handoff, normalizes native indices and timestamps context at actual activation',()=>{
  const data=dataset(),model=createWarmupModel(),state=nativeState(data),htf=higher(data),value={dataset:data,result:{kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'COMPLETE',processedBars:3000}};
  model.offer(value);assert.equal(model.prepare({state,higherTimeframes:htf,canActivate:false}),null);
  const prepared=model.prepare({state,higherTimeframes:htf,canActivate:true});assert.ok(prepared,model.snapshot().reason);assert.equal(prepared.bars.length,3000);assert.equal(prepared.bootstrapAsOfTime,state.decisionAsOfTime);assert.ok(prepared.bars.every(b=>b.knownAt>=state.decisionAsOfTime));assert.equal(prepared.bars.at(-1).close,state.bars.at(-1).close);assert.equal(prepared.bars.at(-1).providerBarIndex,data.series['1'].at(-1).providerBarIndex);assert.deepEqual(state,nativeState(data));
  const changed=structuredClone(state);changed.bars.at(-1).close+=.25;assert.equal(model.prepare({state:changed,higherTimeframes:htf,canActivate:true}),null);assert.equal(model.snapshot().status,'WAITING_SAFE_ACTIVATION');
});
test('recent-candidate evaluation uses the complete 3000-bar context, stays bounded and invalid input cannot hit a previous good cache',()=>{
  const data=dataset(),bars=data.series['1'].map(b=>({...b,knownAt:b.closeTime})),options={...userManagedLiveAnalysisOptions(),metadata,higherTimeframes:{},asOfTime:end};options.config.maxBars=3000;
  const analyzer=createGuideAnalyzer(),analysis=analyzer.analyze(bars,{...options,evaluationStartIndex:2994});assert.notEqual(analysis.status,'BLOCKED');assert.equal(analysis.stats.closedBars,3000);assert.equal(analysis.context.barsUsed,3000);assert.ok(analysis.events.every(e=>e.signalIndex>=2994));assert.ok(analysis.events.length<200);
  const bad=structuredClone(bars);bad.at(-1).high=0;assert.equal(analyzer.analyze(bad,{...options,evaluationStartIndex:2994}).status,'BLOCKED');
});

test('the activated model keeps a rolling 3000-bar context after more than the small live buffer has elapsed',()=>{
  const data=dataset(),model=createWarmupModel(),state=nativeState(data),htf=higher(data);
  model.offer({dataset:data,result:{kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'COMPLETE',processedBars:3000}});
  assert.ok(model.prepare({state,higherTimeframes:htf,canActivate:true}));const activation=state.decisionAsOfTime;
  const extended={};for(const tf of ['1','5','15']){const d=Number(tf)*minute,last=data.series[tf].at(-1);extended[tf]=[...data.series[tf],...Array.from({length:Math.ceil(660/Number(tf))},(_,i)=>({...last,time:last.closeTime+i*d,closeTime:last.closeTime+(i+1)*d,providerBarIndex:last.providerBarIndex+i+1,knownAt:last.closeTime+(i+1)*d+100}))];}
  for(let minutes=30;minutes<=660;minutes+=30){const cutoff=end+minutes*minute;state.bars=extended['1'].filter(b=>b.closeTime<=cutoff).slice(-100);state.decisionAsOfTime=cutoff+6000;for(const tf of ['5','15'])htf[tf].bars=extended[tf].filter(b=>b.closeTime<=cutoff).slice(-100);const selected=model.prepare({state,higherTimeframes:htf,canActivate:false});assert.ok(selected,model.snapshot().reason);assert.equal(selected.bars.length,3000);assert.equal(selected.bars.at(-1).closeTime,cutoff);assert.equal(selected.bootstrapAsOfTime,activation);assert.equal(selected.bars[0].time,data.series['1'][minutes].time);}
});
test('pending collection and the historical worker cannot block live execution or publish an old signal as an entry',async()=>{
  let release,message;const pending=new Promise(r=>release=r),c={active:true,metadata,bars:rows('1',100),sourceUrl:metadata.sourceUrl},data=dataset();let ready;
  const cache={countDataset:()=>null,ingestArchive:()=>{}},fake={postMessage:m=>{message=m;},terminate(){}};
  const ctl=createHistoryWarmupController({getContext:()=>c,historyCache:cache,execute:()=>pending,createWorker:()=>fake,onReady:r=>ready=r,setTimer:()=>1,clearTimer:()=>{}});
  ctl.start();const work=ctl.tick();await new Promise(r=>setImmediate(r));assert.equal(ctl.snapshot().liveExecutionBlocked,false);assert.equal(ctl.snapshot().ordersCreated,false);release({status:'WAITING'});await work;
  cache.countDataset=()=>data;await ctl.tick();assert.equal(message.type,'PROCESS_WARMUP_HISTORY');assert.equal(ctl.snapshot().status,'PROCESSING');
  fake.onmessage({data:{type:'WARMUP_RESULT',jobId:message.jobId,result:{kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'COMPLETE',processedBars:3000,reasonCodes:[],signals:[]}}});assert.equal(ctl.snapshot().status,'WAITING_SAFE_ACTIVATION');assert.ok(ready);assert.equal(ctl.snapshot().ordersCreated,false);ctl.dispose();
});


test('unrelated older HTF cache gaps cannot delay the 3000-bar run, while missing required causal HTF context still blocks it',()=>{
  for(const missing of [10,40]){const cache=createHistory24Cache(),data=dataset();for(const tf of ['1','5','15'])cache.ingest(data.series[tf].filter((_b,i)=>tf==='1'||i!==missing),tf,{runKey:'native',windowEnd:end});const got=cache.forBars(end);assert.equal(got.complete,missing===10,JSON.stringify(got.coverage));if(got.complete)for(const tf of ['5','15'])assert.equal(got.series[tf].filter(b=>b.closeTime<=got.start).length,100);}
});


test('only missing provider rows and absent closed tails request targeted repair; native closed-session gaps are not fabricated',()=>{
  const cache=createHistory24Cache(),data=dataset();for(const tf of ['1','5','15'])cache.ingest(data.series[tf].filter((_b,i)=>tf!=='1'||i!==900),tf,{runKey:'fixture',windowEnd:end});const got=cache.forBars(end);assert.equal(got.complete,false);assert.ok(got.repairRequests.some(r=>r.timeframe==='1'&&r.time===data.series['1'][900].time));assert.ok(got.repairRequests.some(r=>r.reason==='NATIVE_INDEX_ALIGNMENT_ANCHOR'&&r.time===data.series['1'].at(-1).time));const shifted=b=>({...b,providerBarIndex:b.providerBarIndex+4500});cache.ingest([shifted(data.series['1'][900])],'1',{runKey:'new-native',windowEnd:end});assert.equal(cache.forBars(end).complete,false,'gap-only repair remains unaligned');cache.ingest([shifted(data.series['1'].at(-1))],'1',{runKey:'new-native',windowEnd:end});assert.equal(cache.forBars(end).complete,true,'the requested known anchor unlocks exactly the buffered missing row');const good=createHistory24Cache();for(const tf of ['1','5','15'])good.ingest(data.series[tf],tf,{runKey:'fixture',windowEnd:end});assert.deepEqual(good.forBars(end).repairRequests,[]);
});

test('repair requests are separate from the live lane, throttled and still require verified returned history before a worker starts',async()=>{
  const data=dataset(),requests=[];let clock=end+6000;const incomplete={...data,complete:false,repairRequests:[{timeframe:'1',time:end-600000}],coverage:[],reasonCodes:['MISSING']},cache={countDataset:()=>incomplete,ingestArchive(){}};
  const ctl=createHistoryWarmupController({getContext:()=>({active:true,metadata,bars:data.series['1'].slice(-100),sourceUrl:metadata.sourceUrl}),historyCache:cache,execute:async()=>({status:'WAITING'}),requestRepair:async r=>{requests.push(r);return {status:'NATIVE_ARCHIVE_REPAIR_REQUEST_ACCEPTED'};},now:()=>clock,setTimer:()=>1,clearTimer:()=>{}});
  ctl.start();await ctl.tick();assert.equal(requests.length,1);assert.equal(ctl.snapshot().status,'COLLECTING');assert.equal(ctl.snapshot().processedBars,0);assert.equal(ctl.snapshot().liveExecutionBlocked,false);await ctl.tick();assert.equal(requests.length,1);clock+=45000;await ctl.tick();assert.equal(requests.length,2);ctl.dispose();
});


test('actual base-store and HTF-store closure contracts activate the 3000 model, but absent or explicitly rejected proof cannot be upgraded',()=>{
  for(const mode of ['actual-contracts','missing-proof','explicit-rejection']){const data=dataset(),model=createWarmupModel(),state=nativeState(data),htf=higher(data);for(const b of state.bars)delete b.sourceClosed;for(const h of Object.values(htf))for(const b of h.bars)delete b.finalOhlcVerified;if(mode==='missing-proof')delete state.bars.at(-1).finalOhlcVerified;if(mode==='explicit-rejection')state.bars.at(-1).sourceClosed=false;model.offer({dataset:data,result:{kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'COMPLETE',processedBars:3000}});const got=model.prepare({state,higherTimeframes:htf,canActivate:true});assert.equal(!!got,mode==='actual-contracts',model.snapshot().reason);if(got){assert.equal(got.bars.length,3000);assert.equal(got.bars.at(-1).sourceClosed,true);assert.equal(got.higherTimeframes['5'].bars.at(-1).finalOhlcVerified,true);assert.equal(Object.hasOwn(state.bars.at(-1),'sourceClosed'),false);}}
});

test('same-source recovery retains verified knowledge time but advances the execution baseline and requires a safe revalidation',()=>{
  const data=dataset(),model=createWarmupModel(),state=nativeState(data),htf=higher(data);
  model.offer({dataset:data,result:{kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'COMPLETE',processedBars:3000}});
  const first=model.prepare({state,higherTimeframes:htf,canActivate:true}),activation=model.snapshot().availableAt;
  state.generation+=2;state.decisionAsOfTime+=120000;state.bootstrapAsOfTime=state.decisionAsOfTime;
  assert.equal(model.prepare({state,higherTimeframes:htf,canActivate:false}),null);
  const recovered=model.prepare({state,higherTimeframes:htf,canActivate:true});
  assert.ok(recovered,model.snapshot().reason);assert.equal(model.snapshot().availableAt,activation);
  assert.equal(recovered.bootstrapAsOfTime,state.bootstrapAsOfTime);
  assert.deepEqual(recovered.bars.map(b=>b.knownAt),first.bars.map(b=>b.knownAt));
  assert.deepEqual(recovered.higherTimeframes['15'].bars.map(b=>b.knownAt),first.higherTimeframes['15'].bars.map(b=>b.knownAt));
  const analysis=createGuideAnalyzer().analyze(recovered.bars,{...userManagedLiveAnalysisOptions(),metadata:recovered.metadata,higherTimeframes:recovered.higherTimeframes,asOfTime:state.decisionAsOfTime,config:{...userManagedLiveAnalysisOptions().config,maxBars:3000}});
  assert.equal(analysis.context.barsUsed,3000);
  assert.ok(analysis.signals.every(s=>selectFreshLiveSignal(s,analysis,{bootstrapAsOfTime:recovered.bootstrapAsOfTime,eligibleCloseTimes:[s.confirmationBarCloseTime],bars:recovered.bars})===null));
});

test('recovery cannot retain knowledge across a source contract change or accept conflicting previously verified OHLC',()=>{
  for(const change of ['sourceId','tabId','sourceUrl','instrument','timeframe','tickSize','currency','timezone','session','availabilityClock','ohlc']){
    const data=dataset(),model=createWarmupModel(),state=nativeState(data),htf=higher(data);
    model.offer({dataset:data,result:{kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'COMPLETE',processedBars:3000}});
    assert.ok(model.prepare({state,higherTimeframes:htf,canActivate:true}));
    state.generation++;state.decisionAsOfTime+=120000;
    if(change==='ohlc')state.bars.at(-1).close+=.25;else state.metadata={...metadata,[change]:'different-contract'};
    const recovered=model.prepare({state,higherTimeframes:htf,canActivate:true});
    if(change==='ohlc'){assert.equal(recovered,null);assert.equal(model.snapshot().reason,'WARMUP_NATIVE_OVERLAP_CONFLICT');}
    else {assert.ok(recovered,change);assert.equal(model.snapshot().availableAt,state.decisionAsOfTime,change);}
  }
});
