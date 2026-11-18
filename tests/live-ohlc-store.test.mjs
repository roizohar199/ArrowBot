import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
const minute=60000,start=Date.UTC(2026,10,14,10);
const metadata={source:'ohlc',provider:'TradingView Pine Logs',sourceId:'run-1',tabId:41,instrument:'SYNTHETIC',timeframe:'1',timeframeMs:minute,chartType:'standard',tickSize:.25,timezone:'UTC',session:'synthetic',realtime:true,replay:false};
const bar=(i,closed=true,extra={})=>({time:start+i*minute,closeTime:start+(i+1)*minute,open:100,high:102,low:99,close:101,closed,...extra});
function fixture(options={}){
  let clock=start+3*minute+100;
  const store=createLiveOhlcStore({staleAfterMs:2*minute,now:()=>clock,...options});
  const ingest=(kind,bars,extra={})=>store.ingest({kind,metadata,bars,receivedAt:clock,...extra});
  const seeded=ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)]);
  return {store,seeded,ingest,setClock:at=>{clock=at;},clock:()=>clock};
}

test('historical bootstrap is engine-ready but never announces old closes and preserves an open current separately',()=>{
  const {store,seeded,clock}=fixture();
  assert.equal(seeded.ready,true);assert.equal(seeded.liveEligible,true);assert.equal(seeded.bootstrap,true);
  assert.equal(seeded.bars.length,3);assert.equal(seeded.current.time,bar(3).time);assert.equal(seeded.current.closed,false);
  assert.deepEqual(seeded.newlyClosed,[]);assert.deepEqual(seeded.eligibleCloseTimes,[]);
  assert.ok(seeded.bars.every(b=>b.knownAt===clock()&&b.closureProvenance==='explicit_provider_close'&&b.finalOhlcVerified));
  seeded.bars[0].close=999;seeded.metadata.instrument='MUTATED';assert.equal(store.snapshot().bars[0].close,101);assert.equal(store.snapshot().metadata.instrument,'SYNTHETIC');
});

test('clock passage cannot close a current candle; explicit provider final emits one new eligible close',()=>{
  const f=fixture();f.setClock(start+4*minute+20);
  assert.equal(f.store.snapshot().current.closed,false);assert.equal(f.store.snapshot().bars.length,3);
  const closed=f.ingest('update',[bar(3,true,{high:103,close:102})]);
  assert.equal(closed.accepted,true);assert.equal(closed.current,null);assert.deepEqual(closed.eligibleCloseTimes,[start+4*minute]);
  assert.equal(closed.newlyClosed[0].knownAt,f.clock());assert.equal(closed.newlyClosed[0].high,103);
  const duplicate=f.ingest('update',[bar(3,true,{high:103,close:102})]);
  assert.equal(duplicate.changed,false);assert.deepEqual(duplicate.eligibleNewlyClosed,[]);assert.equal(duplicate.bars.at(-1).knownAt,closed.bars.at(-1).knownAt);
});

test('a contiguous next bar proves the boundary but cannot invent a missed final OHLC tick',()=>{
  const f=fixture();f.setClock(start+4*minute+10);
  const next=f.ingest('update',[bar(4,false)]);
  assert.equal(next.accepted,true);assert.equal(next.ready,false);assert.ok(next.reasonCodes.includes('FINAL_OHLC_NOT_VERIFIED'));
  assert.equal(next.newlyClosed[0].closureProvenance,'observed_next_contiguous_bar');assert.equal(next.newlyClosed[0].finalOhlcVerified,false);assert.deepEqual(next.eligibleNewlyClosed,[]);
  f.setClock(f.clock()+10);
  const verified=f.ingest('update',[bar(3,true,{high:104,close:103}),bar(4,false)]);
  assert.equal(verified.ready,true);assert.equal(verified.bars.at(-1).high,104);assert.equal(verified.eligibleNewlyClosed.length,1);assert.equal(verified.eligibleNewlyClosed[0].closureProvenance,'explicit_provider_close');
});

test('normal next-bar packets include prior final OHLC and never create an unverifiable interim history',()=>{
  const f=fixture();f.setClock(start+4*minute+2);
  const result=f.ingest('update',[bar(0),bar(1),bar(2),bar(3,true,{high:103}),bar(4,false)]);
  assert.equal(result.ready,true);assert.equal(result.newlyClosed.length,1);assert.equal(result.current.time,bar(4).time);assert.equal(result.eligibleNewlyClosed.length,1);
});

test('an actual closed-bar correction fails atomically and requires a new non-actionable snapshot',()=>{
  const f=fixture();f.setClock(start+4*minute+2);
  const before=f.store.snapshot();
  const result=f.ingest('update',[bar(1,true,{high:105}),bar(2),bar(3,true)]);
  assert.equal(result.accepted,false);assert.equal(result.ready,false);assert.ok(result.reasonCodes.includes('CLOSED_BAR_CORRECTION'));assert.equal(result.requiresSnapshot,true);
  assert.deepEqual(result.bars,before.bars);assert.equal(result.current.closed,false);assert.deepEqual(result.eligibleNewlyClosed,[]);
  assert.ok(f.ingest('update',[bar(3,true)]).reasonCodes.includes('SNAPSHOT_REQUIRED'));
  const reboot=f.ingest('snapshot',[bar(0),bar(1,true,{high:105}),bar(2),bar(3,true),bar(4,false)]);
  assert.equal(reboot.ready,true);assert.deepEqual(reboot.eligibleNewlyClosed,[]);
});

test('symbol, duration, session, source and tab changes cannot mix candles across a binding',()=>{
  for(const patch of [{instrument:'OTHER'},{timeframe:'2',timeframeMs:2*minute},{session:'other'},{sourceId:'run-2'},{tabId:42}]){
    const f=fixture(),result=f.ingest('update',[bar(3,false)],{metadata:{...metadata,...patch}});
    // A duration mutation may be rejected earlier as malformed input; both are gated.
    assert.equal(result.ready,false);assert.equal(result.accepted,false);assert.deepEqual(result.eligibleNewlyClosed,[]);
    const correctedBar=patch.timeframeMs?{...bar(3,false),closeTime:bar(3,false).time+patch.timeframeMs}:bar(3,false);
    const seed=f.ingest('snapshot',[correctedBar],{metadata:{...metadata,...patch}});
    assert.equal(seed.accepted,true);assert.equal(seed.metadata.instrument,patch.instrument??metadata.instrument);assert.deepEqual(seed.eligibleNewlyClosed,[]);
  }
});

test('provider currency is optional for legacy sources but changes require a fresh baseline',()=>{
  const legacy=fixture();assert.equal(legacy.seeded.accepted,true);assert.equal(legacy.seeded.metadata.currency,undefined);
  const f=fixture(),usd={...metadata,currency:'USD'};
  const initial=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)],{metadata:usd});assert.equal(initial.accepted,true);assert.equal(initial.metadata.currency,'USD');
  const changed=f.ingest('update',[bar(3,false)],{metadata:{...usd,currency:'EUR'}});assert.equal(changed.accepted,false);assert.ok(changed.reasonCodes.includes('SOURCE_CHANGED'));assert.deepEqual(changed.eligibleCloseTimes,[]);
  const recovered=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)],{metadata:{...usd,currency:'EUR'}});assert.equal(recovered.accepted,true);assert.equal(recovered.metadata.currency,'EUR');assert.deepEqual(recovered.eligibleCloseTimes,[]);
  for(const currency of [null,'',123,'USD\n','X'.repeat(21)]){const invalid=fixture().ingest('snapshot',[bar(0)],{metadata:{...metadata,currency}});assert.equal(invalid.accepted,false);assert.ok(invalid.reasonCodes.includes('INVALID_INSTRUMENT_METADATA'));}
});

test('real volume, explicit missing volume and legacy omitted volume retain their exact meanings',()=>{
  const f=fixture(),seed=f.ingest('snapshot',[bar(0,true,{volume:123.5}),bar(1,true,{volume:null}),bar(2),bar(3,false,{volume:null})]);
  assert.equal(seed.accepted,true);assert.equal(seed.bars[0].volume,123.5);assert.equal(seed.bars[1].volume,null);assert.equal(seed.bars[2].volume,undefined);assert.equal(seed.current.volume,null);
  const duplicate=f.ingest('update',[bar(1,true,{volume:null}),bar(3,false,{volume:null})]);assert.equal(duplicate.accepted,false,'noncontiguous rows in one packet remain a data gap even with missing volume');
  const restored=f.ingest('snapshot',[bar(0,true,{volume:123.5}),bar(1,true,{volume:null}),bar(2),bar(3,false,{volume:null})]);assert.equal(restored.accepted,true);
  const same=f.ingest('update',[bar(2),bar(3,false,{volume:null})]);assert.equal(same.accepted,true);assert.equal(same.current.volume,null);
  const open=f.ingest('update',[bar(3,false,{volume:42})]);assert.equal(open.accepted,true);assert.equal(open.current.volume,42);
  for(const volume of [-1,NaN,Infinity,'42']){const invalid=fixture().ingest('snapshot',[bar(0,true,{volume})]);assert.equal(invalid.accepted,false);assert.ok(invalid.reasonCodes.includes('INVALID_VOLUME'));}
});

test('stale data and reconnects require a snapshot before any new live closure can be eligible',()=>{
  const f=fixture({staleAfterMs:1000});f.setClock(f.clock()+1001);
  const stale=f.store.snapshot();assert.equal(stale.ready,false);assert.equal(stale.status,'STALE');assert.ok(stale.reasonCodes.includes('FEED_STALE'));
  const update=f.ingest('update',[bar(3,false)]);assert.equal(update.accepted,false);assert.ok(update.reasonCodes.includes('RECONNECT_SNAPSHOT_REQUIRED'));
  const fresh=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)]);assert.equal(fresh.ready,true);assert.deepEqual(fresh.eligibleNewlyClosed,[]);
  f.store.disconnect();assert.equal(f.store.snapshot().ready,false);assert.equal(f.ingest('update',[bar(3,false)]).accepted,false);
});

test('same-binding recovery retains first verified closed availability while establishing a fresh nonactionable baseline',()=>{
  const f=fixture(),before=f.store.snapshot(),first=before.bars.map(b=>Object.fromEntries(['knownAt','availableAt','receivedAt','localAvailableAt'].map(k=>[k,b[k]])));
  f.setClock(f.clock()+1200);const disconnected=f.store.disconnect('WINDOW_CLOCK_QUARANTINED');
  assert.equal(disconnected.ready,false);assert.equal(disconnected.liveEligible,false);assert.equal(disconnected.connected,false);assert.equal(disconnected.requiresSnapshot,true);assert.deepEqual(disconnected.bars,before.bars);
  const blocked=f.ingest('update',[bar(3,false)]);assert.equal(blocked.accepted,false);assert.equal(blocked.liveEligible,false);assert.deepEqual(blocked.eligibleCloseTimes,[]);
  const recovered=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)]);
  assert.equal(recovered.accepted,true);assert.equal(recovered.ready,true);assert.equal(recovered.generation,before.generation+1);assert.equal(recovered.bootstrapAt,f.clock());assert.equal(recovered.bootstrapAsOfTime,f.clock());
  assert.deepEqual(recovered.bars.map(b=>Object.fromEntries(['knownAt','availableAt','receivedAt','localAvailableAt'].map(k=>[k,b[k]]))),first);
  assert.deepEqual(recovered.newlyClosed,[]);assert.deepEqual(recovered.eligibleNewlyClosed,[]);assert.deepEqual(recovered.eligibleCloseTimes,[]);assert.equal(recovered.current.receivedAt,f.clock());
  assert.ok(recovered.bars.every(b=>b.knownAt<recovered.bootstrapAsOfTime));
  const duplicate=f.ingest('update',[bar(2),bar(3,false)]);assert.deepEqual(duplicate.eligibleCloseTimes,[]);
  f.setClock(start+4*minute+10);const next=f.ingest('update',[bar(3),bar(4,false)]);assert.deepEqual(next.eligibleCloseTimes,[bar(3).closeTime]);
});

test('ordinary snapshots and explicit resets do not reuse earlier availability without a same-run recovery requirement',()=>{
  for(const reset of [false,true]){
    const f=fixture();f.setClock(f.clock()+1000);if(reset)f.store.reset('NEW_START');
    const fresh=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)]);
    assert.ok(fresh.bars.every(b=>b.knownAt===f.clock()&&b.availableAt===f.clock()&&b.receivedAt===f.clock()&&b.localAvailableAt===f.clock()));assert.deepEqual(fresh.eligibleCloseTimes,[]);
  }
});

test('corrected or newly seen older recovery rows stay newly available and conservatively advance later availability',()=>{
  for(const mode of ['correction','new-older-row']){
    const f=fixture(),before=f.store.snapshot();f.setClock(f.clock()+1000);f.store.disconnect();
    const rows=mode==='correction'?[bar(0),bar(1,true,{high:103}),bar(2),bar(3,false)]:[bar(-1),bar(0),bar(1),bar(2),bar(3,false)];
    const recovered=f.ingest('snapshot',rows);assert.equal(recovered.accepted,true);assert.deepEqual(recovered.eligibleCloseTimes,[]);
    const firstNew=mode==='correction'?1:0;
    if(mode==='correction')assert.equal(recovered.bars[0].knownAt,before.bars[0].knownAt);
    for(const b of recovered.bars.slice(firstNew)){assert.equal(b.knownAt,f.clock());assert.equal(b.availableAt,f.clock());}
    const changed=recovered.bars[firstNew];assert.equal(changed.receivedAt,f.clock());assert.equal(changed.localAvailableAt,f.clock());
    const unchangedTail=recovered.bars.at(-1);assert.equal(unchangedTail.receivedAt,before.bars.at(-1).receivedAt);assert.equal(unchangedTail.localAvailableAt,before.bars.at(-1).localAvailableAt);
    assert.ok(recovered.bars.every((b,i)=>i===0||b.knownAt>=recovered.bars[i-1].knownAt&&b.availableAt>=recovered.bars[i-1].availableAt));
  }
});

test('recovery availability requires strict volume, provider-known-at and provider-bar-proof equality',()=>{
  for(const change of [{volume:10},{volume:null},{knownAt:bar(1).closeTime},{providerBarIndex:11,sessionFirst:false,sessionLast:false}]){
    const f=fixture(),before=f.store.snapshot();f.setClock(f.clock()+1000);f.store.disconnect();
    const rows=[bar(0),bar(1,true,change),bar(2),bar(3,false)];
    if(change.providerBarIndex){rows[0]=bar(0,true,{providerBarIndex:10,sessionFirst:false,sessionLast:false});rows[2]=bar(2,true,{providerBarIndex:12,sessionFirst:false,sessionLast:false});rows[3]=bar(3,false,{providerBarIndex:13,sessionFirst:false,sessionLast:false});}
    const recovered=f.ingest('snapshot',rows);assert.equal(recovered.accepted,true);assert.equal(recovered.bars[1].knownAt,f.clock());assert.equal(recovered.bars[1].receivedAt,f.clock());
    if(!change.providerBarIndex)assert.equal(recovered.bars[0].knownAt,before.bars[0].knownAt);
    assert.deepEqual(recovered.eligibleCloseTimes,[]);
  }
  const f=fixture();f.ingest('snapshot',[bar(0,true,{volume:null}),bar(1),bar(2),bar(3,false)]);f.setClock(f.clock()+1000);f.store.disconnect();
  const missing=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)]);assert.equal(missing.bars[0].knownAt,f.clock());assert.equal(Object.hasOwn(missing.bars[0],'volume'),false);
});

test('an inferred unverified close cannot lend earlier availability to its first explicit final recovery value',()=>{
  const f=fixture();f.setClock(start+4*minute+10);const inferred=f.ingest('update',[bar(4,false)]);
  assert.equal(inferred.bars.at(-1).finalOhlcVerified,false);f.setClock(f.clock()+1000);f.store.disconnect();
  const recovered=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3),bar(4,false)]);
  assert.equal(recovered.bars.at(-1).finalOhlcVerified,true);assert.equal(recovered.bars.at(-1).knownAt,f.clock());assert.equal(recovered.bars.at(-1).receivedAt,f.clock());assert.deepEqual(recovered.eligibleCloseTimes,[]);
});

test('recovery never carries availability across changed source URL, run, tab, provider, symbol or candle type',()=>{
  for(const change of [{sourceUrl:'https://www.tradingview.com/chart/other/'},{sourceId:'run-2'},{tabId:99},{provider:'different-provider'},{instrument:'different-symbol'},{chartType:'candles'}]){
    const f=fixture();f.setClock(f.clock()+1000);f.store.disconnect();
    const recovered=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)],{metadata:{...metadata,...change}});
    assert.equal(recovered.accepted,true);assert.ok(recovered.reasonCodes.includes('SOURCE_CHANGED'));assert.ok(recovered.bars.every(b=>b.knownAt===f.clock()&&b.receivedAt===f.clock()));assert.deepEqual(recovered.eligibleCloseTimes,[]);
  }
});

test('producer-clock recovery retains only the same availability axis and never imports provider-supplied historical knowledge',()=>{
  const f=fixture(),store=createLiveOhlcStore({now:f.clock}),initial=f.clock()+1000;
  const seed={kind:'snapshot',metadata,receivedAt:f.clock(),sourceEmittedAt:initial,bars:[bar(0),bar(1),bar(2),bar(3,false)]};
  const first=store.ingest(seed,{sourceAsOfTime:initial});f.setClock(f.clock()+1000);store.disconnect();
  const same=store.ingest({...seed,receivedAt:f.clock(),sourceEmittedAt:initial+1000},{sourceAsOfTime:initial+1000});
  assert.equal(same.bars[0].knownAt,first.bars[0].knownAt);assert.equal(same.bars[0].availableAt,first.bars[0].availableAt);assert.equal(same.bars[0].localAvailableAt,first.bars[0].localAvailableAt);assert.equal(same.bootstrapAsOfTime,initial+1000);assert.deepEqual(same.eligibleCloseTimes,[]);
  f.setClock(f.clock()+1000);store.disconnect();const switched=store.ingest({...seed,receivedAt:f.clock(),bars:[bar(0,true,{knownAt:bar(0).closeTime}),bar(1),bar(2),bar(3,false)]});
  assert.equal(switched.accepted,true);assert.equal(switched.availabilityClock,'receiver_wall');assert.ok(switched.bars.every(b=>b.knownAt===f.clock()&&b.availableAt===f.clock()));assert.equal(switched.bars[0].providerKnownAt,bar(0).closeTime);assert.deepEqual(switched.eligibleCloseTimes,[]);
});

test('a recovery observation cannot import availability timestamps from its future or admit a future closed candle',()=>{
  const f=fixture(),before=f.store.snapshot();f.store.disconnect();f.setClock(f.clock()-50);
  const recovered=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)]);
  assert.equal(recovered.accepted,true);assert.ok(recovered.bars.every(b=>b.knownAt===f.clock()&&b.receivedAt===f.clock()&&b.knownAt<before.bars[0].knownAt));
  f.store.disconnect();const future=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3)]);
  assert.equal(future.accepted,false);assert.equal(future.liveEligible,false);assert.ok(future.reasonCodes.includes('FUTURE_BAR_DATA'));assert.deepEqual(future.eligibleCloseTimes,[]);
});

test('gaps, out-of-order rows, reopened closes, malformed sources and future closed bars fail closed',()=>{
  for(const mutate of [
    ()=>({kind:'snapshot',metadata:{...metadata,chartType:'heikin_ashi'},bars:[bar(0)]}),
    ()=>({kind:'snapshot',metadata:{...metadata,provider:''},bars:[bar(0)]}),
    ()=>({kind:'snapshot',metadata,bars:[bar(0),bar(2)]}),
    ()=>({kind:'snapshot',metadata,bars:[bar(1),bar(0)]}),
    ()=>({kind:'snapshot',metadata,bars:[bar(0,false),bar(1)]}),
    ()=>({kind:'update',metadata,bars:[bar(2,false)]}),
    ()=>({kind:'update',metadata,bars:[bar(4)]}),
    ()=>({kind:'update',metadata,bars:[bar(3,false,{high:99})]}),
  ]){
    const f=fixture(),result=f.store.ingest({...mutate(),receivedAt:f.clock()});assert.equal(result.accepted,false);assert.equal(result.ready,false);assert.deepEqual(result.eligibleNewlyClosed,[]);
  }
});

test('declared market-closed gaps stay explicit and never manufacture a prior current final',()=>{
  const f=fixture(),closedMetadata={...metadata,sessionGaps:[{from:bar(1).closeTime,to:bar(3).time,kind:'market_closed'}]};
  const result=f.ingest('snapshot',[bar(0),bar(1),bar(3,false)],{metadata:closedMetadata});
  assert.equal(result.accepted,true);assert.equal(result.metadata.sessionGaps.length,1);assert.deepEqual(result.eligibleCloseTimes,[]);
  f.setClock(start+5*minute+10);
  const missingFinal=f.ingest('update',[bar(5,false)],{metadata:closedMetadata});
  assert.equal(missingFinal.accepted,false);assert.ok(missingFinal.reasonCodes.includes('NEXT_BAR_NOT_CONTIGUOUS'));
});

test('unknown delay/replay status can warm the engine but cannot label a close as live',()=>{
  for(const change of [{realtime:undefined},{replay:undefined},{realtime:false},{replay:true}]){
    const f=fixture();f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3,false)],{metadata:{...metadata,...change}});f.setClock(start+4*minute+10);
    const update=f.ingest('update',[bar(3)],{metadata:{...metadata,...change}});
    assert.equal(update.ready,true);assert.equal(update.liveEligible,false);assert.equal(update.newlyClosed.length,1);assert.deepEqual(update.eligibleCloseTimes,[]);
  }
});

test('late closes and old snapshots never become fresh actionable alerts merely because they were received now',()=>{
  const f=fixture({maxLiveCloseLagMs:1000});f.setClock(start+4*minute+1001);
  const result=f.ingest('update',[bar(3)]);assert.equal(result.ready,true);assert.equal(result.liveEligible,false);assert.ok(result.reasonCodes.includes('LIVE_CLOSE_TOO_OLD'));assert.ok(result.liveReasonCodes.includes('SOURCE_BAR_TOO_OLD'));assert.deepEqual(result.eligibleNewlyClosed,[]);
  const reboot=f.ingest('snapshot',[bar(0),bar(1),bar(2),bar(3)]);assert.deepEqual(reboot.eligibleNewlyClosed,[]);
});

test('bounded live history advances a declared window and does not rewrite retained availability',()=>{
  const f=fixture({maxBars:3});const original=f.seeded.bars[1];f.setClock(start+4*minute+10);
  const update=f.ingest('update',[bar(3),bar(4,false)]);
  assert.equal(update.bars.length,3);assert.equal(update.bars[0].time,bar(1).time);assert.equal(update.evictedClosedBars,1);assert.ok(update.reasonCodes.includes('HISTORY_WINDOW_ADVANCED'));
  assert.deepEqual(update.bars[0],original);assert.equal(update.orderEligible,false);
});

test('clock rollback and invalid configuration cannot leave an actionable store',()=>{
  assert.throws(()=>createLiveOhlcStore({maxBars:601}));assert.throws(()=>createLiveOhlcStore({staleAfterMs:0}));
  const f=fixture();f.setClock(f.clock()-1);const result=f.ingest('update',[bar(3,false)]);
  assert.equal(result.ready,false);assert.ok(result.reasonCodes.includes('RECEIPT_TIME_WENT_BACKWARD'));
});

test('explicit Pine producer clock accepts already observed closed data despite the measured +1312 ms local offset',()=>{
  const localReceipt=1794636153099,sourceAsOf=1794636154411,period=1000;
  const meta={...metadata,timeframe:'1S',timeframeMs:period};let clock=localReceipt-1000;
  const store=createLiveOhlcStore({now:()=>clock});
  const short=(time,closed=true)=>({time,closeTime:time+period,open:100,high:102,low:99,close:101,closed});
  const baselineSource=sourceAsOf-1000,baseline={kind:'snapshot',metadata:meta,receivedAt:clock,sourceEmittedAt:baselineSource,bars:[short(1794636150000),short(1794636151000),short(1794636152000)]};
  const seed=store.ingest(baseline,{sourceAsOfTime:baselineSource});
  assert.equal(seed.ready,true);assert.equal(seed.bootstrapAt,clock);assert.equal(seed.bootstrapAsOfTime,baselineSource);assert.equal(seed.availabilityClock,'pine_source_execution_unverified_sync');
  clock=localReceipt;
  const update={kind:'update',metadata:meta,receivedAt:clock,sourceEmittedAt:sourceAsOf,bars:[short(1794636153000),short(1794636154000,false)]};
  const state=store.ingest(update,{sourceAsOfTime:sourceAsOf});
  assert.equal(state.accepted,true);assert.equal(state.ready,true);assert.equal(state.liveEligible,true);assert.equal(state.eligibleNewlyClosed.length,1);
  assert.equal(state.bars.at(-1).receivedAt,localReceipt);assert.equal(state.bars.at(-1).localAvailableAt,localReceipt);assert.equal(state.bars.at(-1).knownAt,sourceAsOf);
  assert.equal(state.lastReceivedAt,localReceipt);assert.equal(state.sourceDecisionTime,sourceAsOf);assert.equal(state.decisionAsOfTime,sourceAsOf);assert.equal(state.metadata.availabilityClock,'pine_source_execution_unverified_sync');
});

test('producer mode rejects incoherent envelopes, excessive offset and bars beyond the producer decision time',()=>{
  const f=fixture(),raw={kind:'snapshot',metadata,receivedAt:f.clock(),sourceEmittedAt:f.clock()+1000,bars:[bar(0),bar(1),bar(2)]};
  for(const [packet,options,reason] of [
    [raw,{sourceAsOfTime:raw.sourceEmittedAt+1},'INVALID_SOURCE_DECISION_TIME'],
    [{...raw,sourceEmittedAt:raw.receivedAt+3001},{sourceAsOfTime:raw.receivedAt+3001},'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED'],
    [{...raw,sourceEmittedAt:raw.receivedAt-3001},{sourceAsOfTime:raw.receivedAt-3001},'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED'],
    [{...raw,bars:[bar(3)]},{sourceAsOfTime:raw.sourceEmittedAt},'FUTURE_BAR_DATA'],
  ]){
    const store=createLiveOhlcStore({now:f.clock}),result=store.ingest(packet,options);assert.equal(result.accepted,false);assert.ok(result.reasonCodes.includes(reason));assert.equal(result.eligibleNewlyClosed.length,0);
  }
});

test('producer clock order and clock mode changes cannot rewrite the availability axis midstream',()=>{
  const f=fixture(),store=createLiveOhlcStore({now:f.clock}),source=f.clock()+1000;
  const seed={kind:'snapshot',metadata,receivedAt:f.clock(),sourceEmittedAt:source,bars:[bar(0),bar(1),bar(2),bar(3,false)]};
  assert.equal(store.ingest(seed,{sourceAsOfTime:source}).accepted,true);f.setClock(f.clock()+10);
  const backward=store.ingest({...seed,kind:'update',receivedAt:f.clock(),sourceEmittedAt:source-1,bars:[bar(3,false)]},{sourceAsOfTime:source-1});
  assert.ok(backward.reasonCodes.includes('PRODUCER_CLOCK_WENT_BACKWARD'));assert.equal(backward.ready,false);
  const separate=createLiveOhlcStore({now:f.clock});separate.ingest({...seed,receivedAt:f.clock()},{sourceAsOfTime:source});
  const switched=separate.ingest({kind:'update',metadata,receivedAt:f.clock(),bars:[bar(3,false)]});
  assert.ok(switched.reasonCodes.includes('AVAILABILITY_CLOCK_CHANGED'));
});

test('a nonadvancing producer clock becomes stale independently of fresh receiver messages',()=>{
  const f=fixture(),store=createLiveOhlcStore({now:f.clock,staleAfterMs:1000}),source=f.clock()+1000;
  const seed={kind:'snapshot',metadata,receivedAt:f.clock(),sourceEmittedAt:source,bars:[bar(0),bar(1),bar(2),bar(3,false)]};
  store.ingest(seed,{sourceAsOfTime:source});f.setClock(f.clock()+500);
  store.ingest({...seed,kind:'update',receivedAt:f.clock(),bars:[bar(3,false)]},{sourceAsOfTime:source});f.setClock(f.clock()+501);
  const state=store.ingest({...seed,kind:'update',receivedAt:f.clock(),bars:[bar(3,false)]},{sourceAsOfTime:source});
  assert.equal(state.accepted,true);assert.equal(state.stale,false);assert.equal(state.producerStale,true);assert.equal(state.ready,false);assert.ok(state.reasonCodes.includes('PRODUCER_CLOCK_STALE'));
  const both=store.snapshot(f.clock()+1001);assert.equal(both.stale,true);assert.equal(both.producerStale,true);
});
