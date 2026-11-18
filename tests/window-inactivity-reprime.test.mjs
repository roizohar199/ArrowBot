import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';

const start=Date.UTC(2026,10,14,12),minute=60000;
const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
const openAfter=bar=>({...bar,time:bar.closeTime,closeTime:bar.closeTime+minute,providerBarIndex:bar.providerBarIndex+1,closed:false,sourceClosed:false});
function frame({bootstrap,base,higher,sequence,sourceAt,slot=0,current=openAfter(base.at(-1))}){
  const raw=encodeFrame({bootstrap,base,higher,sequence,sourceAt,slot,current,counts:[base.length,...higher.map(bars=>bars.length)]});raw.ARROW2_PROTOCOL=3;
  const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1-slot),HISTORY_HIGHER1:higher[0].at(-1-slot),HISTORY_HIGHER2:higher[1].at(-1-slot)};
  for(const [name,bar] of Object.entries(groups))if(bar)raw['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4+(bar.sessionFirst?1:0)+(bar.sessionLast?2:0);
  return recalculateChecksums(raw);
}
function readyFixture({extendBootstrap}={}){
  const bootstrap={...makeBootstrap(),wireVersion:3},base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)],sourceAt=start+1000;
  extendBootstrap?.(bootstrap);
  const fixture=makeWindowFixture({bootstrap,raw:frame({bootstrap,base,higher,sequence:1,sourceAt})});fixture.read();let output;
  for(let slot=0;slot<20;slot++){fixture.advance(500);fixture.setRaw(frame({bootstrap,base,higher,sequence:slot+2,sourceAt:sourceAt+(slot+1)*500,slot}));output=fixture.read({needsSnapshot:true});}
  assert.ok(output.history.every(series=>series.contiguousBars===20&&series.snapshotSent));
  return {fixture,bootstrap,base,higher,sourceAt:sourceAt+10000,sequence:21};
}
const packets=output=>output.messages.map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)));

test('inactivity re-prime retains learned closed history and first observations while requiring a new pair and fresh snapshot availability',()=>{
  const b=readyFixture(),f=b.fixture,newClosed={...openAfter(b.base.at(-1)),closed:true,sourceClosed:true},base=[...b.base,newClosed],newSourceAt=newClosed.closeTime+1000;
  f.advance(newSourceAt-b.sourceAt);f.setRaw(frame({...b,base,sequence:22,sourceAt:newSourceAt}));let result=f.read();assert.equal(result.reasonCodes[0],'WINDOW_COHERENCE_REPRIMING');assert.equal(result.messages.length,0);
  f.advance(200);f.setRaw(frame({...b,base,sequence:23,sourceAt:newSourceAt+200}));result=f.read({needsSnapshot:true});assert.equal(packets(result).find(packet=>packet.kind==='snapshot').bars.length,21,'a closed bar observed after the initial baseline is retained');
  const before=JSON.parse(JSON.stringify(f.context.__arrowWindowFeedV2.series)),oldPacketIds=[...f.context.__arrowWindowFeedV2.pendingMessages.values()].map(item=>item.sequence);
  f.advance(16001);f.setRaw(frame({...b,base,sequence:24,sourceAt:newSourceAt+16201}));const quiet=f.read(),state=f.context.__arrowWindowFeedV2;
  assert.equal(quiet.reasonCodes[0],'WINDOW_COHERENCE_REPRIMING');assert.equal(quiet.status,'WAITING');assert.equal(quiet.resetRequired,true);assert.equal(quiet.messages.length,0);assert.equal(state.pendingMessages.size,0);assert.equal(state.latestEvidence,null);assert.ok(state.series.every(series=>!series.snapshotSent&&series.lastSnapshotRevision===-1));
  assert.deepEqual(JSON.parse(JSON.stringify(state.series.map(series=>series.bars))),before.map(series=>series.bars),'closed prices and first-observation provenance remain exact');
  assert.equal(f.read().messages.length,0,'a duplicate quiet frame cannot stand in for the second coherent frame');
  f.advance(200);const resumedAt=newSourceAt+16401;f.setRaw(frame({...b,base,sequence:25,sourceAt:resumedAt}));const resumed=f.read({needsSnapshot:true}),emitted=packets(resumed);
  assert.equal(resumed.status,'OK');assert.equal(resumed.resetRequired,false);assert.deepEqual(emitted.filter(packet=>packet.kind==='snapshot').map(packet=>packet.bars.length),[21]);assert.deepEqual(emitted.filter(packet=>packet.kind==='timeframe_snapshot').map(packet=>packet.higherTimeframes[0].bars.length),[20,20]);
  assert.ok(emitted.every(packet=>packet.sourceEmittedAt===resumedAt&&packet.sequence>Math.max(...oldPacketIds)),'recovery availability and packet identities use only the new coherent observation');
  assert.deepEqual(resumed.history.map(series=>series.firstObservations),before.map(series=>series.bars.map(bar=>({time:bar.time,firstObservedSourceAt:bar.firstObservedSourceAt,firstObservedDomEpoch:bar.firstObservedDomEpoch}))));
});

test('sequence or clock regressions, large jumps, changed run and quiet corrections discard learned history',()=>{
  for(const mode of ['SEQUENCE_ROLLBACK','LARGE_SEQUENCE_JUMP','CLOCK_ROLLBACK','CHANGED_RUN','QUIET_CORRECTION','QUIET_CURRENT_ROLLBACK','QUIET_FROZEN_SOURCE_TIME']){
    const b=readyFixture(),f=b.fixture;let bootstrap=b.bootstrap,base=b.base,sequence=b.sequence+1,sourceAt=b.sourceAt+500;
    if(mode==='SEQUENCE_ROLLBACK')sequence=b.sequence-1;
    if(mode==='LARGE_SEQUENCE_JUMP')sequence=b.sequence+4096;
    if(mode==='CLOCK_ROLLBACK')sourceAt=b.sourceAt-100;
    if(mode==='CHANGED_RUN'){bootstrap=structuredClone(b.bootstrap);bootstrap.runEpoch++;bootstrap.runId=bootstrap.metadata.instrument+'|1|'+bootstrap.runEpoch;}
    if(mode==='QUIET_CORRECTION'){base=structuredClone(b.base);base.at(-1).high+=.25;sourceAt=b.sourceAt+16001;}
    if(mode==='QUIET_CURRENT_ROLLBACK'){base=b.base.slice(0,-1);sourceAt=b.sourceAt+16001;}
    if(mode==='QUIET_FROZEN_SOURCE_TIME')sourceAt=b.sourceAt;
    f.advance(mode.startsWith('QUIET')?16001:500);f.setRaw(frame({...b,bootstrap,base,sequence,sourceAt}));const output=f.read({bootstrap});
    assert.equal(output.messages.length,0,mode);assert.equal(output.resetRequired,true,mode);assert.ok(f.context.__arrowWindowFeedV2.series.every(series=>series.bars.length===0),mode+' must not use inactivity retention');
  }
});

test('a pending correction cannot become preserved history merely because the next frame follows a quiet interval',()=>{
  const b=readyFixture(),f=b.fixture,base=structuredClone(b.base);base.at(-1).high+=.25;
  f.advance(500);f.setRaw(frame({...b,base,sequence:22,sourceAt:b.sourceAt+500}));const correction=f.read();assert.ok(correction.reasonCodes.includes('WINDOW_CLOSED_BAR_CORRECTION'));assert.equal(correction.resetRequired,true);
  f.advance(16001);f.setRaw(frame({...b,base,sequence:23,sourceAt:b.sourceAt+16501}));const quiet=f.read();assert.equal(quiet.messages.length,0);assert.ok(f.context.__arrowWindowFeedV2.series.every(series=>series.bars.length===0));
});

test('repeated quiet re-primes before receiver ACK retain learned provider rows102/103 beyond the original seed',()=>{
  const bootstrap={...makeBootstrap(),wireVersion:3},seedBase=indexed(rows(21,minute),81),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)];
  const history={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:seedBase,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  let sequence=1,sourceAt=start+1000,base=[...seedBase];const f=makeWindowFixture({bootstrap,raw:frame({bootstrap,base,higher,sequence,sourceAt})});f.read({bootstrapHistory:history});
  f.advance(200);sourceAt+=200;f.setRaw(frame({bootstrap,base,higher,sequence:++sequence,sourceAt}));assert.equal(packets(f.read({needsSnapshot:true})).find(packet=>packet.kind==='snapshot').bars.length,21);
  for(const providerBarIndex of [102,103]){
    const learned={...openAfter(base.at(-1)),closed:true,sourceClosed:true};assert.equal(learned.providerBarIndex,providerBarIndex);base.push(learned);
    const nextAt=learned.closeTime+1000;f.advance(nextAt-sourceAt);sourceAt=nextAt;f.setRaw(frame({bootstrap,base,higher,sequence:++sequence,sourceAt}));assert.equal(f.read().reasonCodes[0],'WINDOW_COHERENCE_REPRIMING');
    f.read({needsSnapshot:true});f.advance(200);sourceAt+=200;f.setRaw(frame({bootstrap,base,higher,sequence:++sequence,sourceAt}));const accepted=packets(f.read({needsSnapshot:true}));assert.ok(accepted.find(packet=>packet.kind==='snapshot').bars.some(bar=>bar.providerBarIndex===providerBarIndex));
  }
  const before=JSON.parse(JSON.stringify(f.context.__arrowWindowFeedV2.series.map(series=>series.bars)));
  for(let repeat=0;repeat<2;repeat++){
    f.advance(16001);sourceAt+=16001;f.setRaw(frame({bootstrap,base,higher,sequence:++sequence,sourceAt}));const quiet=f.read();assert.equal(quiet.reasonCodes[0],'WINDOW_COHERENCE_REPRIMING');assert.equal(quiet.messages.length,0);assert.equal(quiet.resetRequired,true);assert.equal(f.read().messages.length,0,'duplicate priming frames do not satisfy coherence');
    assert.deepEqual(JSON.parse(JSON.stringify(f.context.__arrowWindowFeedV2.series.map(series=>series.bars))),before,'only benign pending re-prime must not fall back to the old seed');
  }
  assert.deepEqual(Array.from(f.context.__arrowWindowFeedV2.series[0].bars,bar=>bar.providerBarIndex),base.map(bar=>bar.providerBarIndex));
  f.read({needsSnapshot:true});f.advance(200);sourceAt+=200;f.setRaw(frame({bootstrap,base,higher,sequence:++sequence,sourceAt}));const resumed=f.read({needsSnapshot:true}),snapshot=packets(resumed).find(packet=>packet.kind==='snapshot');
  assert.equal(resumed.resetRequired,false);assert.equal(snapshot.bars.length,23);assert.ok(snapshot.bars.some(bar=>bar.providerBarIndex===102));assert.ok(snapshot.bars.some(bar=>bar.providerBarIndex===103));assert.equal(snapshot.sourceEmittedAt,sourceAt);assert.ok(snapshot.bars.every(bar=>bar.knownAt===undefined&&bar.firstObservedSourceAt===undefined),'fresh snapshot cannot backdate receiver availability using diagnostic provenance');
});

test('repeated quiet re-primes compare source and current time against the most recent coherent prime',()=>{
  for(const mode of ['SOURCE_FROZEN','SOURCE_ROLLBACK','CURRENT_ROLLBACK']){
    const b=readyFixture(),f=b.fixture,primeAt=b.sourceAt+16001;
    f.advance(16001);f.setRaw(frame({...b,sequence:22,sourceAt:primeAt}));f.read();assert.equal(f.context.__arrowWindowFeedV2.series[0].bars.length,20);
    f.advance(16001);f.setRaw(frame({...b,base:mode==='CURRENT_ROLLBACK'?b.base.slice(0,-1):b.base,sequence:23,sourceAt:mode==='SOURCE_FROZEN'?primeAt:mode==='SOURCE_ROLLBACK'?primeAt-1:primeAt+16001}));const invalid=f.read();
    assert.equal(invalid.messages.length,0);assert.equal(invalid.resetRequired,true);assert.ok(f.context.__arrowWindowFeedV2.series.every(series=>series.bars.length===0),mode+' cannot retain history through a priming boundary');
  }
});

test('recursive object-key reordering preserves the identical binding and every learned closed row',()=>{
  const b=readyFixture({extendBootstrap:bootstrap=>{bootstrap.metadata.extraSemantic={nested:{alpha:1,beta:2},ordered:[1,2]};bootstrap.higherTimeframes[0].extraSemantic={alpha:1,beta:2};}}),f=b.fixture;
  const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value;
  const reordered=reverseKeys(b.bootstrap),before=f.context.__arrowWindowFeedV2,rowsBefore=JSON.parse(JSON.stringify(before.series.map(series=>series.bars))),primeEvents=before.continuityDecisions.filter(item=>item.action==='COHERENCE_PRIME').length;
  f.advance(500);f.setRaw(frame({...b,bootstrap:reordered,sequence:22,sourceAt:b.sourceAt+500}));const result=f.read({bootstrap:reordered});
  assert.equal(result.status,'OK');assert.equal(result.resetRequired,false);assert.equal(f.context.__arrowWindowFeedV2,before);assert.deepEqual(JSON.parse(JSON.stringify(before.series.map(series=>series.bars))),rowsBefore);assert.equal(result.continuityDecisions.filter(item=>item.action==='COHERENCE_PRIME').length,primeEvents);assert.ok(result.history.every(series=>series.contiguousBars===20&&series.snapshotSent));
});

test('real known or additional binding values, ordered arrays and reader limits still reset with compact semantic diagnostics',()=>{
  const modes=['POINT_VALUE','CURRENCY','EXTRA_METADATA','METADATA_ARRAY_ORDER','EXTRA_HIGHER_METADATA','HIGHER_ARRAY_ORDER','MINIMUM','HISTORY_LIMIT','RUN'];
  for(const mode of modes){
    const b=readyFixture({extendBootstrap:bootstrap=>{bootstrap.metadata.extraSemantic={nested:{alpha:1,beta:2},ordered:[1,2]};bootstrap.higherTimeframes[0].extraSemantic={alpha:1,beta:2};}}),f=b.fixture,bootstrap=structuredClone(b.bootstrap),options={bootstrap};let higher=b.higher;
    if(mode==='POINT_VALUE')bootstrap.metadata.pointValue=40;
    if(mode==='CURRENCY')bootstrap.metadata.currency='EUR';
    if(mode==='EXTRA_METADATA')bootstrap.metadata.extraSemantic.nested.alpha=2;
    if(mode==='METADATA_ARRAY_ORDER')bootstrap.metadata.extraSemantic.ordered.reverse();
    if(mode==='EXTRA_HIGHER_METADATA')bootstrap.higherTimeframes[0].extraSemantic.alpha=2;
    if(mode==='HIGHER_ARRAY_ORDER'){bootstrap.higherTimeframes.reverse();higher=b.higher.slice().reverse();}
    if(mode==='MINIMUM')options.minBars=21;
    if(mode==='HISTORY_LIMIT')options.historyCount=99;
    if(mode==='RUN'){bootstrap.runEpoch++;bootstrap.runId=bootstrap.metadata.instrument+'|1|'+bootstrap.runEpoch;}
    f.advance(500);f.setRaw(frame({...b,bootstrap,higher,sequence:22,sourceAt:b.sourceAt+500}));const output=f.read(options),decision=output.continuityDecisions.at(-1);
    assert.equal(output.reasonCodes[0],'WINDOW_COHERENCE_PRIMING',mode);assert.equal(output.messages.length,0);assert.ok(f.context.__arrowWindowFeedV2.series.every(series=>series.bars.length===0),mode);assert.equal(decision.action,'COHERENCE_PRIME');assert.equal(decision.changedIdentity,true);assert.ok(decision.semanticBindingChanges.length>0,mode+' value difference is diagnosed without embedding metadata objects');
  }
});

test('continuity decisions remain bounded at16 and survive WAITING, duplicate and successful reads without full price arrays',()=>{
  const b=readyFixture(),f=b.fixture;let sourceAt=b.sourceAt,sequence=b.sequence,last;
  for(let index=0;index<20;index++){f.advance(16001);sourceAt+=16001;f.setRaw(frame({...b,sequence:++sequence,sourceAt}));last=f.read();}
  assert.equal(last.status,'WAITING');assert.equal(last.continuityDecisions.length,16);assert.ok(last.continuityDecisions.every(item=>item.action==='COHERENCE_REPRIME'&&item.preserve&&item.failedPreserveChecks.length===0));
  for(const item of last.continuityDecisions){assert.ok(Number.isSafeInteger(item.sourceEmittedAt));assert.ok(Number.isSafeInteger(item.observedAt));assert.equal(item.beforeSeries[0].retainedBars,20);assert.equal(item.afterSeries[0].retainedBars,20);assert.ok(item.beforeSeries.every(series=>!Object.hasOwn(series,'bars')&&!Object.hasOwn(series,'open')));}
  assert.deepEqual(f.read().continuityDecisions,last.continuityDecisions);f.read({needsSnapshot:true});f.advance(200);sourceAt+=200;f.setRaw(frame({...b,sequence:++sequence,sourceAt}));const resumed=f.read({needsSnapshot:true});assert.equal(resumed.status,'OK');assert.equal(resumed.continuityDecisions.length,16);assert.deepEqual(resumed.continuityDecisions,last.continuityDecisions);assert.ok(packets(resumed).filter(packet=>packet.kind.endsWith('snapshot')).every(packet=>packet.sourceEmittedAt===sourceAt));
});
