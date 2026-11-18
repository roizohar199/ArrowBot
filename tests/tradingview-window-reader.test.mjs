import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseTradingViewWindowMetadata} from '../tradingview-window-reader.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';
import {makeBootstrap,encodeFrame,encodeMetadataFrame,makeWindowFixture,recalculateChecksums,fieldNames,taggedFields,rows,SCALAR_BASE,PRICE_BASE} from './window-reader-fixture.mjs';

test('source and reader have exactly64 plot fields in the same canonical order',async()=>{
  const source=await readFile(new URL('../tradingview-data-window-bridge.pine',import.meta.url),'utf8'),plots=[...source.matchAll(/plot\([^\n]+, "(ARROW2_[A-Z0-9_]+)"/g)].map(match=>match[1]);
  assert.equal(taggedFields.length,58);assert.equal(fieldNames.length,64);assert.deepEqual(plots,fieldNames);
});
test('metadata log parser and serialized capture validate exact primitives, encoding, run identity and price precision',()=>{
  const value=makeBootstrap(),text='[info] ARROW_WINDOW_META_V2 '+JSON.stringify(value),fixture=makeWindowFixture();
  assert.deepEqual(parseTradingViewWindowMetadata(text).bootstrap,value);fixture.metadataNode(text);assert.equal(fixture.readMetadata().status,'OK');assert.deepEqual(fixture.readMetadata().bootstrap,value);
  for(const change of [item=>item.runEpoch++,item=>item.metadata.tickSize=.00015,item=>item.metadata.tickSize=1e-20,item=>item.metadata.timezone='Invalid/Zone',item=>item.encoding.tagModulo=1024,item=>item.encoding.volumeQuantized=false,item=>item.encoding.checksumPrimes.reverse()]){
    const invalid=structuredClone(value);change(invalid);const raw='ARROW_WINDOW_META_V2 '+JSON.stringify(invalid);assert.equal(parseTradingViewWindowMetadata(raw).ok,false);
    const bad=makeWindowFixture();bad.metadataNode(raw);assert.equal(bad.readMetadata().status,'UNAVAILABLE');
  }
  const hidden=makeWindowFixture();hidden.metadataNode(text,{visible:false});hidden.metadataNode(text,{excluded:true});assert.equal(hidden.readMetadata().status,'UNAVAILABLE');
});
test('a coherent Data Window frame primes once, then exposes exact current OHLC and volume while historical warmup stays nonactionable',()=>{
  const fixture=makeWindowFixture();const first=fixture.read();assert.equal(first.status,'WAITING');assert.equal(first.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.equal(first.messages.length,0);assert.equal(first.windowFrame.current.close,20010.25);
  fixture.advance();fixture.setRaw(encodeFrame({sequence:2}));const second=fixture.read();assert.equal(second.status,'OK');assert.equal(second.frame.checksumsVerified,true);assert.equal(second.windowFrame.current.volume,120.123456);assert.ok(second.reasonCodes.includes('WINDOW_HISTORY_WARMUP'));assert.equal(second.messages.length,0);
  assert.equal(fixture.read().reasonCodes[0],'NO_FRESH_SOURCE_PACKET');
});

test('real study header text without optional tooltip decodes coherent fields but retains visibility and ambiguity gates',()=>{
  const f=makeWindowFixture();delete f.header.attrs.title;f.header.textContent='Arrow OHLC Window v2 (100, 5, 15, 102)';
  assert.equal(f.read().reasonCodes[0],'WINDOW_COHERENCE_PRIMING');f.advance();f.setRaw(encodeFrame({sequence:2}));assert.equal(f.read().status,'OK');
  f.header.rect={top:1000,bottom:1020};assert.equal(f.read().reasonCodes[0],'WINDOW_STUDY_NOT_VISIBLE');delete f.header.rect;
  f.document.studies.push(f.study);assert.equal(f.read().reasonCodes[0],'WINDOW_STUDY_AMBIGUOUS');f.document.studies.pop();
  f.header.textContent='Arrow OHLC Window v20';f.study.textContent='Arrow OHLC Window v2 ARROW2_PROTOCOL 3';assert.equal(f.read().reasonCodes[0],'WINDOW_STUDY_NOT_FOUND');
  f.header.textContent='Arrow OHLC Window v2';f.header.attrs.title='Unrelated study';assert.equal(f.read().reasonCodes[0],'WINDOW_STUDY_NOT_FOUND');
});
test('full contiguous provider history is collected newest-first, emits V1 baselines once and repeats verified prior close after bootstrap',()=>{
  const fixture=makeWindowFixture(),base=rows(20,60000),higher=[rows(20,300000),rows(20,900000)];fixture.read();let result;
  for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot,base,higher}));result=fixture.read({needsSnapshot:true});if(slot<19)assert.equal(result.messages.length,0);}
  const packets=result.messages.map(raw=>parsePineOhlcMessage(raw,{receivedAt:Date.UTC(2026,10,14,12)+20000,tabId:17}));assert.ok(packets.every(item=>item.ok));
  assert.deepEqual(packets.map(item=>item.packet.kind),['snapshot','timeframe_snapshot','timeframe_snapshot','update','timeframe_update','timeframe_update']);
  assert.equal(packets[0].packet.bars.length,20);assert.equal(packets[0].packet.bars[0].time,base[0].time);assert.equal(packets[0].packet.bars.at(-1).close,base.at(-1).close);
  assert.equal(packets[1].packet.higherTimeframes[0].bars.length,20);assert.equal(packets[2].packet.higherTimeframes[0].bars.length,20);
  assert.ok(result.history.every(entry=>entry.snapshotSent));assert.ok(result.history.every(entry=>entry.firstObservations.length===20));assert.ok(fixture.timings.every(item=>item.id.startsWith(fixture.bootstrap.runId+':')));
  fixture.advance();fixture.setRaw(encodeFrame({sequence:22,slot:0,base,higher}));const next=fixture.read();assert.deepEqual(next.messages.map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)).kind),['update','timeframe_update','timeframe_update']);
  assert.equal(JSON.parse(next.messages[0].slice('ARROW_OHLC_V1 '.length)).bars[0].close,base.at(-1).close);
});
test('receiver ACKs filter cached packets numerically without reparsing warmups and recovery uses new source sequences',()=>{
  const fixture=makeWindowFixture();fixture.read();for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot}));fixture.mutate();}
  const initial=fixture.read(),sequences=initial.messages.map(raw=>JSON.parse(raw.slice(14)).sequence),ack=Math.max(...sequences),runId=fixture.bootstrap.runId;assert.deepEqual(sequences,[...sequences].sort((a,b)=>a-b));assert.equal(fixture.context.__arrowWindowFeedV2.pendingMessages.size,6);
  vm.runInContext('globalThis.__parseCalls=0;const originalParse=JSON.parse;JSON.parse=(...args)=>{globalThis.__parseCalls++;return originalParse(...args);};',fixture.context);
  assert.deepEqual(fixture.read({afterRunId:runId,afterSequence:0}).messages,initial.messages);assert.equal(fixture.context.__parseCalls,0,'sorting the cache does not parse100-bar JSON envelopes');
  assert.equal(fixture.read({afterRunId:runId,afterSequence:ack}).messages.length,0);assert.equal(fixture.context.__arrowWindowFeedV2.pendingMessages.size,6,'ACK never erases retained recovery baselines');
  fixture.advance();fixture.setRaw(encodeFrame({sequence:22,slot:0}));fixture.mutate();const fresh=fixture.read({afterRunId:runId,afterSequence:ack});assert.deepEqual(fresh.messages.map(raw=>JSON.parse(raw.slice(14)).kind),['update','timeframe_update','timeframe_update']);
  const nextAck=Math.max(...fresh.messages.map(raw=>JSON.parse(raw.slice(14)).sequence));fixture.read({afterRunId:runId,afterSequence:nextAck,needsSnapshot:true});fixture.advance();fixture.setRaw(encodeFrame({sequence:23,slot:0}));fixture.mutate();const recovery=fixture.read({afterRunId:runId,afterSequence:nextAck,needsSnapshot:true});assert.equal(recovery.messages.filter(raw=>['snapshot','timeframe_snapshot'].includes(JSON.parse(raw.slice(14)).kind)).length,3);assert.ok(recovery.messages.every(raw=>JSON.parse(raw.slice(14)).sequence>nextAck));
});
test('an ACK from another source run cannot suppress a new run with lower sequence numbers',()=>{
  const fixture=makeWindowFixture();fixture.read();const oldRunId=fixture.bootstrap.runId,newBootstrap=structuredClone(fixture.bootstrap);newBootstrap.runEpoch++;newBootstrap.runId=newBootstrap.metadata.instrument+'|1|'+newBootstrap.runEpoch;
  fixture.advance();fixture.setRaw(encodeMetadataFrame({bootstrap:newBootstrap,sequence:1,slot:99}));fixture.read({bootstrap:undefined,afterRunId:oldRunId,afterSequence:999999});fixture.read({bootstrap:undefined,afterRunId:oldRunId,afterSequence:999999,needsSnapshot:true});fixture.read({bootstrap:undefined,afterRunId:oldRunId,afterSequence:999999,needsSnapshot:true});
  let result;for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({bootstrap:newBootstrap,sequence:slot+2,slot}));result=fixture.read({bootstrap:undefined,afterRunId:oldRunId,afterSequence:999999,needsSnapshot:true});}
  assert.ok(result.messages.length>0);assert.ok(result.messages.every(raw=>{const packet=JSON.parse(raw.slice(14));return packet.runId===newBootstrap.runId&&packet.sequence<999999;}));const cached=fixture.read({bootstrap:undefined,afterRunId:oldRunId,afterSequence:999999});assert.equal(cached.messages.length,6);
});
test('all64 fields require one owned visible study and a selected Data Window, without using another indicator or offscroll omission',()=>{
  const missing=makeWindowFixture();missing.document.tabs=[];assert.equal(missing.read().reasonCodes[0],'DATA_WINDOW_NOT_SELECTED');
  const multiple=makeWindowFixture();multiple.document.studies.push(multiple.study);assert.equal(multiple.read().reasonCodes[0],'WINDOW_STUDY_AMBIGUOUS');
  const absent=makeWindowFixture();absent.labelNodes.pop();assert.equal(absent.read().reasonCodes[0],'WINDOW_FIELDS_NOT_MOUNTED');
  const duplicate=makeWindowFixture();duplicate.labelNodes.push(duplicate.labelNodes[0]);assert.equal(duplicate.read().reasonCodes[0],'WINDOW_DUPLICATE_OR_UNKNOWN_FIELD');
  const charts=makeWindowFixture();charts.document.canvases.push(charts.canvas);assert.equal(charts.read().reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  const grouped=makeWindowFixture();grouped.setRaw(encodeFrame(),{grouped:true});assert.equal(grouped.read().status,'WAITING');
});
test('tag mismatch, dual checksum mismatch, numeric abbreviation and mixed full-sequence headers fail before any history commit',()=>{
  for(const mutate of [raw=>raw.ARROW2_CURRENT_OPEN-=PRICE_BASE,raw=>raw.ARROW2_CURRENT_OPEN++,raw=>raw.ARROW2_CHECKSUM_B++,raw=>raw.ARROW2_SEQ_END++]){
    const fixture=makeWindowFixture(),raw=encodeFrame();mutate(raw);fixture.setRaw(raw);const result=fixture.read();assert.equal(result.status,'UNAVAILABLE');assert.equal(result.messages.length,0);assert.equal(fixture.context.__arrowWindowFeedV2.series,undefined);
  }
  const forged=encodeFrame();forged.ARROW2_CURRENT_OPEN-=PRICE_BASE;recalculateChecksums(forged);const fixture=makeWindowFixture({raw:forged});assert.equal(fixture.read().reasonCodes[0],'WINDOW_PAYLOAD_TAG_MISMATCH');
  const rounded=makeWindowFixture();rounded.fieldNodes.get('ARROW2_CURRENT_OPEN').textContent='82.3T';assert.equal(rounded.read().reasonCodes[0],'WINDOW_NONINTEGER_RENDERED_VALUE');
  const changing=makeWindowFixture();let reads=0;Object.defineProperty(changing.fieldNodes.get('ARROW2_SEQ_BEGIN'),'textContent',{get:()=>++reads===1?'1':'2'});assert.equal(changing.read().reasonCodes[0],'WINDOW_MIXED_FRAME');
});
test('MutationObserver records the first coherent DOM frame before polling and retains bounded bootstraps plus latest updates',()=>{
  const fixture=makeWindowFixture();fixture.read();assert.equal(fixture.observers.filter(observer=>observer.active).length,1);
  assert.equal(fixture.sourceTimingReads,1);
  for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot}));fixture.mutate();}
  assert.equal(fixture.sourceTimingReads,1,'MutationObserver callbacks cannot renew the source timing lease');
  assert.equal(fixture.timings.length,6,'source packets were observed before the next RPC read');
  const count=fixture.timings.length,result=fixture.read();assert.equal(fixture.timings.length,count,'reading cached evidence never stamps another source appearance');assert.equal(fixture.sourceTimingReads,2);assert.equal(result.messages.length,6);assert.ok(result.packetObservations.every(item=>item.observedByMutationObserver));
  fixture.advance();fixture.setRaw(encodeFrame({sequence:22,slot:0}));fixture.mutate();assert.equal(fixture.context.__arrowWindowFeedV2.pendingMessages.size,6);
  assert.equal(fixture.read().messages.length,6);assert.equal(fixture.read({observationOnly:true}).reasonCodes[0],'WINDOW_OBSERVER_CONTEXT_REQUIRED');
});
test('source observation has a60second real-poll lease and stop disconnects only the owned observer',()=>{
  const fixture=makeWindowFixture();fixture.read();fixture.advance(30000);fixture.setRaw(encodeFrame({sequence:2}));fixture.mutate();
  fixture.advance(30001);assert.ok(fixture.observers.every(observer=>!observer.active));assert.equal(fixture.context.__arrowWindowFeedV2.active,false,'observer callbacks do not renew the lease');
  fixture.read();assert.equal(fixture.observers.filter(observer=>observer.active).length,1);assert.equal(fixture.read({stop:true}).status,'STOPPED');assert.equal(fixture.context.__arrowWindowFeedV2,undefined);assert.ok(fixture.observers.every(observer=>!observer.active));
});
test('a READY feed stops emitting and recording source appearance when its header or pane becomes invisible',()=>{
  for(const hide of [fixture=>fixture.panel.style.opacity='0',fixture=>fixture.panel.style.display='none',fixture=>fixture.panel.style.visibility='hidden',fixture=>fixture.panel.style.contentVisibility='hidden',fixture=>fixture.header.rect={top:1000,bottom:1020},fixture=>{fixture.panel.style.overflowY='hidden';fixture.panel.rect={top:100,bottom:120};}]){
    const fixture=makeWindowFixture();fixture.read();for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot}));fixture.mutate();}
    assert.equal(fixture.context.__arrowWindowFeedV2.series[0].snapshotSent,true);const recorded=fixture.timings.length;
    hide(fixture);fixture.advance();fixture.setRaw(encodeFrame({sequence:22,slot:0}));fixture.mutate();const unavailable=fixture.read();
    assert.equal(unavailable.status,'UNAVAILABLE');assert.equal(unavailable.reasonCodes[0],'WINDOW_STUDY_NOT_VISIBLE');assert.equal(unavailable.messages.length,0);assert.equal(fixture.timings.length,recorded);
  }
  const offscrollValues=makeWindowFixture();for(const value of offscrollValues.fieldNodes.values())value.rect={top:1500,bottom:1520};assert.equal(offscrollValues.read().reasonCodes[0],'WINDOW_COHERENCE_PRIMING','plot values may remain mounted below the fold when their study header is visible');
});
test('an observer-detected correction remains a hard reset until a real poll reports it and the receiver requests a snapshot',()=>{
  const fixture=makeWindowFixture();fixture.read();fixture.advance();fixture.setRaw(encodeFrame({sequence:2}));fixture.mutate();
  const base=rows(20,60000);base.at(-1).close+=.25;
  fixture.advance();fixture.setRaw(encodeFrame({sequence:3,base}));fixture.mutate();fixture.advance();fixture.setRaw(encodeFrame({sequence:4,slot:1,base}));fixture.mutate();
  const fault=fixture.read();assert.equal(fault.resetRequired,true);assert.ok(fault.reasonCodes.includes('WINDOW_CLOSED_BAR_CORRECTION'));assert.equal(fault.messages.length,0);
  const acknowledged=fixture.read({needsSnapshot:true});assert.equal(acknowledged.resetRequired,false);assert.equal(acknowledged.messages.length,0);
});
test('receiver recovery republishes every complete healthy HTF after a different series was invalidated',()=>{
  const fixture=makeWindowFixture();fixture.read();for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot}));fixture.read();}
  const higher=[rows(20,300000),rows(20,900000)];higher[0].at(-1).close+=.25;
  fixture.advance();fixture.setRaw(encodeFrame({sequence:22,slot:0,higher}));const invalidated=fixture.read();assert.equal(invalidated.resetRequired,true);
  fixture.read({needsSnapshot:true});fixture.advance();fixture.setRaw(encodeFrame({sequence:23,slot:0,higher}));const recovered=fixture.read({needsSnapshot:true});
  const snapshots=recovered.messages.map(raw=>JSON.parse(raw.slice(14))).filter(packet=>packet.kind==='timeframe_snapshot');
  assert.deepEqual(snapshots.map(packet=>packet.higherTimeframes[0].timeframe),['15']);assert.equal(snapshots[0].higherTimeframes[0].bars.length,20);assert.ok(recovered.messages.some(raw=>JSON.parse(raw.slice(14)).kind==='snapshot'));
  assert.deepEqual(recovered.bootstrapMetadata,fixture.bootstrap);assert.deepEqual(fixture.read().bootstrapMetadata,fixture.bootstrap);
});
test('historical hover has no payload, source run changes require metadata rebinding, and sequence gaps re-prime without retaining history',()=>{
  const hover=makeWindowFixture();hover.setRaw(Object.fromEntries(fieldNames.map(name=>[name,null])));assert.equal(hover.read().reasonCodes[0],'WINDOW_LAST_BAR_REQUIRED');
  const changed=makeWindowFixture(),raw=encodeFrame();raw.ARROW2_RUN_EPOCH++;recalculateChecksums(raw);changed.setRaw(raw);assert.equal(changed.read().reasonCodes[0],'WINDOW_METADATA_FRAME_REQUIRED');
  const gap=makeWindowFixture();gap.read();gap.advance();gap.setRaw(encodeFrame({sequence:2}));gap.read();assert.equal(gap.context.__arrowWindowFeedV2.series[0].bars.length,1);
  gap.advance();gap.setRaw(encodeFrame({sequence:4098}));const result=gap.read();assert.equal(result.reasonCodes[0],'WINDOW_COHERENCE_REPRIMING');assert.ok(gap.context.__arrowWindowFeedV2.series.every(entry=>entry.bars.length===0));
});
test('a brief coherent historical hover preserves a healthy100-bar baseline and the next fresh frame resumes immediately',()=>{
  const counts=[100,100,100],base=rows(100,60000),higher=[rows(100,300000),rows(100,900000)],sourceStart=Date.UTC(2026,10,14,12)+1000;
  const fixture=makeWindowFixture({raw:encodeFrame({counts,base,higher,sourceAt:sourceStart})});fixture.read();let older;
  for(let slot=0;slot<100;slot++){
    fixture.advance();const raw=encodeFrame({sequence:slot+2,slot,counts,base,higher,sourceAt:sourceStart+(slot+1)*500});if(slot===30)older=structuredClone(raw);fixture.setRaw(raw);fixture.mutate();
  }
  const ready=fixture.read();assert.ok(ready.history.every(series=>series.contiguousBars===100&&series.snapshotSent));
  const state=fixture.context.__arrowWindowFeedV2,before=JSON.stringify(state.series),lastSequence=state.lastSequence,lastSourceAt=state.lastSourceAt,lastObservedAt=state.lastObservedAt,records=fixture.timings.length,clockBefore=JSON.stringify(state.clockWitnesses);
  fixture.advance(10);fixture.setRaw(older);fixture.mutate();const hovered=fixture.read();
  assert.equal(hovered.reasonCodes[0],'WINDOW_LAST_BAR_REQUIRED');assert.equal(hovered.messages.length,0);assert.notEqual(hovered.resetRequired,true);assert.equal(fixture.context.__arrowWindowFeedV2,state);assert.equal(state.lastSequence,lastSequence);assert.equal(state.lastSourceAt,lastSourceAt);assert.equal(state.lastObservedAt,lastObservedAt);assert.equal(JSON.stringify(state.series),before);assert.equal(fixture.timings.length,records);assert.equal(JSON.stringify(state.clockWitnesses),clockBefore,'historical hover must be rejected before it can append a clock witness');
  fixture.advance(10);fixture.setRaw(encodeFrame({sequence:102,slot:0,counts,base,higher,sourceAt:lastSourceAt+20}));fixture.mutate();const resumed=fixture.read();
  assert.equal(resumed.status,'OK');assert.equal(resumed.resetRequired,false);assert.equal(resumed.windowFrame.sequence,102);assert.ok(resumed.history.every(series=>series.contiguousBars===100&&series.snapshotSent));assert.equal(state.lastSequence,102);assert.ok(resumed.messages.some(raw=>JSON.parse(raw.slice(14)).kind==='update'));assert.ok(resumed.messages.filter(raw=>JSON.parse(raw.slice(14)).kind==='snapshot').every(raw=>JSON.parse(raw.slice(14)).sequence<102*8));
});
test('an old historical frame cannot erase a warming prefix or append clock witnesses before a snapshot exists',()=>{
  const f=makeWindowFixture();f.read();f.advance();f.setRaw(encodeFrame({sequence:2}));f.read();
  const state=f.context.__arrowWindowFeedV2,before=JSON.stringify(state.series),witnesses=JSON.stringify(state.clockWitnesses),sequence=state.lastSequence;
  assert.equal(state.series[0].snapshotSent,false);
  f.advance(120000);f.setRaw(encodeFrame({sequence:1}));const result=f.read({needsSnapshot:true});
  assert.equal(result.reasonCodes[0],'WINDOW_LAST_BAR_REQUIRED');assert.equal(result.messages.length,0);assert.notEqual(result.resetRequired,true);
  assert.equal(f.context.__arrowWindowFeedV2,state);assert.equal(JSON.stringify(state.series),before);assert.equal(JSON.stringify(state.clockWitnesses),witnesses);assert.equal(state.lastSequence,sequence);
});
test('inband metadata bootstraps without logs, is checksummed and never becomes a fabricated historical OHLC row',()=>{
  const fixture=makeWindowFixture();assert.equal(fixture.read({bootstrap:undefined}).reasonCodes[0],'WINDOW_METADATA_FRAME_REQUIRED');
  fixture.advance();fixture.setRaw(encodeMetadataFrame({sequence:2,slot:99}));const metadata=fixture.read({bootstrap:undefined});
  assert.equal(metadata.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.deepEqual(metadata.bootstrapMetadata,fixture.bootstrap);assert.ok(metadata.history.every(entry=>entry.retainedBars===0));
  fixture.advance();fixture.setRaw(encodeFrame({sequence:3,slot:0}));const data=fixture.read({bootstrap:undefined});assert.equal(data.status,'OK');assert.equal(data.history[0].retainedBars,1);
  fixture.advance();fixture.setRaw(encodeMetadataFrame({sequence:4,slot:99}));const repeated=fixture.read({bootstrap:undefined});assert.equal(repeated.status,'OK');assert.equal(repeated.resetRequired,false);assert.equal(repeated.history[0].retainedBars,1);assert.ok(!repeated.reasonCodes.includes('WINDOW_HISTORY_ROW_UNAVAILABLE'));
});
test('inband metadata enforces ASCII padding, chart identity, the run epoch and unsupported-text flag',()=>{
  const invalid=encodeMetadataFrame();invalid.ARROW2_HISTORY_BASE_TIME=SCALAR_BASE+4278190080;recalculateChecksums(invalid);const fixture=makeWindowFixture({raw:invalid});assert.equal(fixture.read({bootstrap:undefined}).reasonCodes[0],'WINDOW_INVALID_METADATA_BYTES');
  const wrong=makeBootstrap();wrong.metadata.instrument='OTHER:NQ';const mismatched=makeWindowFixture({raw:encodeMetadataFrame({bootstrap:wrong})});assert.equal(mismatched.read({bootstrap:undefined}).reasonCodes[0],'WINDOW_CHART_METADATA_MISMATCH');
  const unsupported=makeWindowFixture({raw:encodeMetadataFrame({flags:6})});assert.equal(unsupported.read({bootstrap:undefined}).reasonCodes[0],'WINDOW_METADATA_TEXT_UNREPRESENTABLE');
});
test('a provider session gap never joins old historical bars to a distant current bar',()=>{
  const fixture=makeWindowFixture();fixture.read();const base=rows(20,60000),higher=[rows(20,300000),rows(20,900000)];
  const current={...base.at(-1),time:base.at(-1).closeTime+2*86400000,closeTime:base.at(-1).closeTime+2*86400000+60000,closed:false,sourceClosed:false};
  fixture.advance();fixture.setRaw(encodeFrame({sequence:2,slot:0,base,higher,current,sourceAt:current.time+1000}));const result=fixture.read();assert.equal(result.resetRequired,true);assert.ok(result.reasonCodes.includes('WINDOW_CURRENT_BASE_GAP'));assert.equal(result.messages.length,0);assert.equal(result.history[0].retainedBars,0);
});
test('a changed provider-final row invalidates the baseline and suppresses every outgoing message',()=>{
  const fixture=makeWindowFixture();fixture.read();fixture.advance();fixture.setRaw(encodeFrame({sequence:2,slot:0}));fixture.read();
  const corrected=rows(20,60000);corrected.at(-1).close+=.25;
  fixture.advance();fixture.setRaw(encodeFrame({sequence:3,slot:0,base:corrected}));const result=fixture.read();assert.equal(result.resetRequired,true);assert.ok(result.reasonCodes.includes('WINDOW_CLOSED_BAR_CORRECTION'));assert.equal(result.messages.length,0);
});
test('a closing realtime tick remains realtime even with current.closed=true and is delivered as verified final OHLC',()=>{
  const fixture=makeWindowFixture(),base=rows(20,60000),higher=[rows(20,300000),rows(20,900000)];fixture.read();
  for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot,base,higher}));fixture.read();}
  const last=base.at(-1),current={...last,time:last.closeTime,closeTime:last.closeTime+60000,closed:true,sourceClosed:true};
  fixture.advance();fixture.setRaw(encodeFrame({sequence:22,slot:0,sourceAt:current.closeTime,base,higher,current,flags:3}));const result=fixture.read();
  const update=result.messages.map(raw=>parsePineOhlcMessage(raw,{receivedAt:current.closeTime+100,tabId:17})).find(item=>item.packet?.kind==='update');
  assert.ok(update?.ok);assert.equal(update.packet.realtime,true);assert.equal(update.packet.bars.at(-1).closed,true);assert.equal(update.packet.bars.at(-1).close,current.close);
});
test('volume missing sentinel is explicit null and cannot be confused with zero volume',()=>{
  const raw=encodeFrame();raw.ARROW2_CURRENT_VOLUME=SCALAR_BASE+(SCALAR_BASE-1);recalculateChecksums(raw);const missing=makeWindowFixture({raw});assert.equal(missing.read().windowFrame.current.volume,null);
  const zero=encodeFrame();zero.ARROW2_CURRENT_VOLUME=SCALAR_BASE;recalculateChecksums(zero);const fixture=makeWindowFixture({raw:zero});assert.equal(fixture.read().windowFrame.current.volume,0);
});
