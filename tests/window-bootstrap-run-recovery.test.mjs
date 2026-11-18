import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE,PRICE_BASE,taggedFields} from './window-reader-fixture.mjs';

// Synthetic serialized Window transport regressions. No archived market history
// or fabricated source is supplied to the actual browser/native application.
function setup(){
  const bootstrap={...makeBootstrap(),wireVersion:3};bootstrap.encoding.historyHoldMs=200;
  const indexed=(bars,start)=>bars.map((b,i)=>({...b,providerBarIndex:start+i,sessionFirst:false,sessionLast:false})),base=indexed(rows(20,60000),100),higher=[indexed(rows(20,300000),200),indexed(rows(20,900000),300)],sourceAt=Date.UTC(2026,10,14,12)+1000;
  const seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:sourceAt,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,i)=>({...bootstrap.higherTimeframes[i],bars,sessionGaps:[],reasonCodes:[]}))};
  function frame(b,sequence,slot=0,{metadata=false,offset=0}={}){
    const shift=bar=>({...bar,open:bar.open+offset,high:bar.high+offset,low:bar.low+offset,close:bar.close+offset}),liveBase=base.map(shift),liveHigher=higher.map(bars=>bars.map(shift)),current={...liveBase.at(-1),time:liveBase.at(-1).closeTime,closeTime:liveBase.at(-1).closeTime+60000,providerBarIndex:120,closed:false,sourceClosed:false};
    const raw=encodeFrame({bootstrap:b,base:liveBase,higher:liveHigher,current,sequence,slot,sourceAt:sourceAt+sequence*500});raw.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:liveBase.at(-1),HIGHER1:liveHigher[0].at(-1),HIGHER2:liveHigher[1].at(-1),HISTORY_BASE:liveBase.at(-1-slot),HISTORY_HIGHER1:liveHigher[0].at(-1-slot),HISTORY_HIGHER2:liveHigher[1].at(-1-slot)};
    for(const [name,bar]of Object.entries(groups))if(bar)raw['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    if(metadata){raw.ARROW2_HISTORY_STATE+=134217728;const bytes=Array.from(['3',b.metadata.instrument,b.metadata.timeframe,b.metadata.timezone,b.metadata.session,b.metadata.currency].join('|'),c=>c.charCodeAt(0));while(bytes.length<84)bytes.push(0);taggedFields.slice(37).forEach((f,i)=>{const j=i*4,word=bytes[j]*16777216+bytes[j+1]*65536+bytes[j+2]*256+bytes[j+3];raw[f.name]=sequence%4096*(f.kind==='price'?PRICE_BASE:SCALAR_BASE)+word;});}
    return recalculateChecksums(raw);
  }
  const f=makeWindowFixture({bootstrap,raw:frame(bootstrap,1)}),initial=f.read({bootstrapHistory:seed});assert.equal(initial.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');
  return {f,bootstrap,base,higher,seed,frame,newRun(delta=1){const next=structuredClone(bootstrap);next.runEpoch+=delta;next.runId=next.metadata.instrument+'|1|'+next.runEpoch;return next;}};
}

test('a genuinely newer native metadata frame discards only the verified cached old-run seed and primes native history',()=>{
  const x=setup(),next=x.newRun();x.f.advance();x.f.setRaw(x.frame(next,1,0,{metadata:true,offset:10}));
  const primed=x.f.read({bootstrap:undefined});assert.equal(primed.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.equal(primed.messages.length,0);assert.equal(primed.bootstrapMetadata.runId,next.runId);assert.ok(primed.history.every(s=>s.retainedBars===0));
  assert.equal(x.f.context.__arrowWindowFeedV2.bootstrapHistory,null);assert.equal(x.f.context.__arrowWindowFeedV2.bootstrapHistoryVerifiedRun,null);
  const decision=x.f.context.__arrowWindowFeedV2.continuityDecisions.find(d=>d.action==='VERIFIED_BOOTSTRAP_DISCARDED_FOR_NEW_NATIVE_RUN');assert.equal(decision.previousRunId,x.bootstrap.runId);assert.equal(decision.nativeRunId,next.runId);
  let result;for(let slot=0;slot<20;slot++){x.f.advance();x.f.setRaw(x.frame(next,slot+2,slot,{offset:10}));result=x.f.read({bootstrap:undefined,needsSnapshot:true});assert.equal(result.reasonCodes.includes('WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH'),false);}
  const packets=result.messages.map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)));assert.ok(packets.some(p=>p.kind==='snapshot'));assert.ok(packets.every(p=>p.runId===next.runId));assert.equal(packets.find(p=>p.kind==='snapshot').bars[0].open,x.base[0].open+10,'only newly observed native rows are retained');
});

test('explicitly supplied old or malformed bootstrap history is rejected before a subsequent cache-only new-run recovery',()=>{
  const x=setup(),next=x.newRun();x.f.advance();x.f.setRaw(x.frame(next,1,0,{metadata:true}));
  const rejected=x.f.read({bootstrap:undefined,bootstrapHistory:x.seed});assert.equal(rejected.reasonCodes[0],'WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH');assert.equal(rejected.messages.length,0);assert.equal(x.f.context.__arrowWindowFeedV2.bootstrapHistory.runId,x.bootstrap.runId);
  x.f.advance();x.f.setRaw(x.frame(next,2,0,{metadata:true}));const recovered=x.f.read({bootstrap:undefined});assert.equal(recovered.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.ok(recovered.history.every(s=>s.retainedBars===0));
});

test('a regressing native epoch or unverified cached claim never gets the new-run discard exception',()=>{
  for(const mode of ['REGRESSED','UNVERIFIED']){
    const x=setup(),next=x.newRun(mode==='REGRESSED'?-1:1);if(mode==='UNVERIFIED')x.f.context.__arrowWindowFeedV2.bootstrapHistoryVerifiedRun='unverified';
    x.f.advance();x.f.setRaw(x.frame(next,1,0,{metadata:true}));const result=x.f.read({bootstrap:undefined});assert.equal(result.reasonCodes[0],'WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH');assert.equal(result.messages.length,0);assert.equal(x.f.context.__arrowWindowFeedV2.bootstrapHistory.runId,x.bootstrap.runId);
  }
});
