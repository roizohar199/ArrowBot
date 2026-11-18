import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';
import {verifyLiveChart} from '../live-ohlc.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';

// Artificial serialized native frames, never a history seed or browser order.
const minute=60000,start=Date.UTC(2026,10,14,12),cacheKey='__arrowVerifiedWindowContextV1';
function setup(){
  const bootstrap={...makeBootstrap(),wireVersion:3},indexed=(data,offset)=>data.map((b,i)=>({...b,providerBarIndex:offset+i,sessionFirst:false,sessionLast:false})),base=indexed(rows(100,minute),400),higher=[indexed(rows(100,5*minute),600),indexed(rows(100,15*minute),800)];
  const current={...base.at(-1),time:start,closeTime:start+minute,providerBarIndex:500,closed:false,sourceClosed:false};let sequence=1,sourceAt=start+1000;
  function frame({b=bootstrap,data=base,high=higher,active=current,seq=sequence,at=sourceAt,slot=0}={}){
    const raw=encodeFrame({bootstrap:b,base:data,higher:high,current:active,sequence:seq,sourceAt:at,slot,counts:[100,100,100]});raw.ARROW2_PROTOCOL=3;
    const groups={CURRENT:active,PREVIOUS:data.at(-1),HIGHER1:high[0].at(-1),HIGHER2:high[1].at(-1),HISTORY_BASE:data.at(-1-slot),HISTORY_HIGHER1:high[0].at(-1-slot),HISTORY_HIGHER2:high[1].at(-1-slot)};
    for(const [name,bar]of Object.entries(groups))if(bar)raw['ARROW2_'+name+'_CLOSE_TIME']=seq%4096*SCALAR_BASE+bar.providerBarIndex*4+(bar.sessionFirst?1:0)+(bar.sessionLast?2:0);return recalculateChecksums(raw);
  }
  const f=makeWindowFixture({bootstrap,raw:frame()});f.read();let last;
  for(let slot=0;slot<100;slot++){sequence++;sourceAt+=200;f.advance(200);f.setRaw(frame({slot}));last=f.read();}
  assert.ok(last.history.every(series=>series.retainedBars===100&&series.snapshotSent));assert.ok(f.context[cacheKey]);
  const advance=(options={})=>{sequence++;sourceAt+=200;f.advance(200);f.setRaw(frame(options));return f.read({sessionId:'restart',bootstrap:undefined});};
  return {f,bootstrap,base,higher,current,frame,advance,get sequence(){return sequence;},get sourceAt(){return sourceAt;}};
}
const packets=output=>output.messages.map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)));
test('monitor stop/restart reuses only same-document verified native context, then requires two genuinely new frames and a new live baseline',()=>{
  const s=setup(),before=s.f.context[cacheKey];assert.equal(s.f.read({stop:true}).status,'STOPPED');assert.equal(s.f.context.__arrowWindowFeedV2,undefined);assert.equal(s.f.context[cacheKey],before,'stop retains passive data, not the observer');
  const context=s.f.read({sessionId:'restart',bootstrap:undefined});assert.equal(context.contextOnly,true);assert.equal(context.liveEligible,false);assert.equal(context.recovery.freshFrames,0);assert.deepEqual(context.clockWitnesses,[]);assert.ok(context.history.every(series=>series.retainedBars===100&&!series.snapshotSent));assert.ok(packets(context).every(packet=>packet.realtime===false&&packet.bootstrapOnly===true));assert.deepEqual(packets(context).map(packet=>packet.kind),['snapshot','timeframe_snapshot','timeframe_snapshot']);
  let intakeNow=context.observedAtWall;const store=createLiveOhlcStore({now:()=>intakeNow}),base=packets(context).find(packet=>packet.kind==='snapshot'),parsed=parsePineOhlcMessage('ARROW_OHLC_V1 '+JSON.stringify(base),{tabId:17,receivedAt:context.observedAtWall});assert.equal(parsed.ok,true);const history=store.ingest({...parsed.packet,metadata:verifyLiveChart(parsed.packet,context,17).metadata},{sourceAsOfTime:base.sourceEmittedAt});assert.equal(history.accepted,true);assert.equal(history.contextOnly,true);assert.equal(history.liveEligible,false);assert.deepEqual(history.eligibleCloseTimes,[]);
  for(let i=0;i<3;i++){const same=s.f.read({sessionId:'restart',bootstrap:undefined});assert.equal(same.recovery.freshFrames,0,'a repeated RPC cannot count toward recovery');}
  const first=s.advance();assert.equal(first.contextOnly,true);assert.equal(first.recovery.freshFrames,1);assert.deepEqual(first.messages,[]);
  const second=s.advance();assert.equal(second.contextOnly,undefined);assert.ok(packets(second).some(packet=>packet.kind==='snapshot'&&packet.bootstrapOnly!==true));assert.ok(packets(second).some(packet=>packet.kind==='update'));assert.ok(second.continuityDecisions.some(row=>row.action==='RECOVERY_FRESH_PAIR_VERIFIED'));
  const fresh=packets(second).find(packet=>packet.kind==='snapshot');assert.ok(fresh.sourceEmittedAt>base.sourceEmittedAt);assert.equal(s.f.context.__arrowWindowFeedV2.sessionId,'restart');assert.equal(s.f.context.__arrowWindowFeedV2.contextRecovery,null);
  const deliver=packet=>{intakeNow=second.observedAtWall;const parsed=parsePineOhlcMessage('ARROW_OHLC_V1 '+JSON.stringify(packet),{tabId:17,receivedAt:second.observedAtWall});assert.equal(parsed.ok,true);return store.ingest({...parsed.packet,metadata:verifyLiveChart(parsed.packet,second,17).metadata},{sourceAsOfTime:packet.sourceEmittedAt});};
  const freshBase=deliver(fresh);assert.equal(freshBase.accepted,true,JSON.stringify(freshBase.reasonCodes));assert.equal(freshBase.bootstrap,true);assert.equal(freshBase.contextOnly,false);assert.deepEqual(freshBase.eligibleCloseTimes,[]);assert.equal(freshBase.bootstrapAsOfTime,fresh.sourceEmittedAt);
  const update=deliver(packets(second).find(packet=>packet.kind==='update'));assert.equal(update.accepted,true);assert.equal(update.liveEligible,true);assert.deepEqual(update.eligibleCloseTimes,[],'retained closed history cannot become a post-connection entry');
});

test('a new monitor owner never inherits old pending packets, observer timing, approvals or receiver cursor',()=>{
  const s=setup(),old=s.f.context.__arrowWindowFeedV2;old.clockWitnesses=[{kind:'OLD_WITNESS'}];old.pendingMessages.set('fabricated',{raw:'OLD_APPROVAL_PACKET',sequence:999999,observation:{id:'old'}});old.receivedCursor='old';
  const output=s.f.read({sessionId:'restart',bootstrap:undefined});assert.equal(output.contextOnly,true);assert.ok(output.messages.every(raw=>!raw.includes('OLD_APPROVAL')));assert.deepEqual(output.clockWitnesses,[]);assert.equal(s.f.context.__arrowWindowFeedV2.receivedCursor,undefined);assert.equal(old.observer.active,false);assert.equal(s.f.context.__arrowWindowFeedV2.acceptedFrames,0);
});

test('run, metadata, source/sequence regression, correction and missing continuity cannot borrow the retained context',()=>{
  for(const mode of ['RUN','METADATA','SOURCE_REGRESSION','SEQUENCE_REGRESSION','SEQUENCE_GAP','CORRECTION','SAME_SEQUENCE_CHANGED_CURRENT','CURRENT_GAP','REPLAY']){
    const s=setup();let b=structuredClone(s.bootstrap),data=structuredClone(s.base),active=structuredClone(s.current),seq=s.sequence+1,at=s.sourceAt+200;
    if(mode==='RUN'){b.runEpoch++;b.runId=b.metadata.instrument+'|1|'+b.runEpoch;}
    if(mode==='METADATA')b.metadata.currency='EUR';
    if(mode==='SOURCE_REGRESSION')at=s.sourceAt-1;
    if(mode==='SEQUENCE_REGRESSION')seq=s.sequence-1;
    if(mode==='SEQUENCE_GAP')seq=s.sequence+4096;
    if(mode==='CORRECTION')data.at(-1).high+=.25;
    if(mode==='SAME_SEQUENCE_CHANGED_CURRENT'){seq=s.sequence;at=s.sourceAt;active.high+=.25;}
    if(mode==='CURRENT_GAP'){active.time+=2*minute;active.closeTime+=2*minute;active.providerBarIndex+=2;at=active.time+1000;}
    if(mode==='REPLAY')s.f.replay.attrs['aria-pressed']='true';
    s.f.setRaw(s.frame({b,data,active,seq,at}));const result=s.f.read({sessionId:'restart',bootstrap:b});assert.notEqual(result.contextOnly===true&&packets(result).some(packet=>packet.bootstrapOnly),true,mode);assert.ok(result.messages.length===0,mode);assert.equal(s.f.context[cacheKey],undefined,mode);
  }
});

test('page URL/document clock changes, expired retention and explicit reset cannot reuse previous native history',()=>{
  for(const mode of ['URL','DOCUMENT','TIME_ORIGIN','EXPIRED','RESET']){
    const s=setup();if(mode==='URL')s.f.context.location.pathname='/chart/other/';if(mode==='DOCUMENT')s.f.context[cacheKey].document={};if(mode==='TIME_ORIGIN')s.f.context.performance.timeOrigin+=1;if(mode==='EXPIRED')s.f.advance(60001);
    const output=s.f.read({sessionId:'restart',bootstrap:undefined,...(mode==='RESET'?{reset:true}:{})});assert.deepEqual(output.messages,[],mode);assert.notEqual(output.contextOnly,true,mode);assert.equal(s.f.context[cacheKey],undefined,mode);
  }
});

test('explicit invalid bootstrap history remains rejected rather than falling back to a retained native cache',()=>{
  const s=setup(),bad={...structuredClone(s.f.context[cacheKey].seed),runId:'wrong'};const result=s.f.read({sessionId:'restart',bootstrapHistory:bad});assert.equal(result.reasonCodes[0],'WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH');assert.deepEqual(result.messages,[]);assert.notEqual(result.contextOnly,true);
});
