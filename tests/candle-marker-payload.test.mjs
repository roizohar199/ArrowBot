import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildApprovedCandleMarkerPayload,buildTechnicalCandleMarkerPayload,validateApprovedCandleMarkerPayload,validateTechnicalCandleMarkerPayload,verifyNativeCandleMarkerFields,candleMarkerPayloadSignature,CANDLE_MARKER_NATIVE_FIELDS} from '../candle-marker-payload.mjs';
import {makePaperExecutionFixture} from './fixtures/paper-execution.mjs';
import {GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
import {analyzeCandlePatterns} from '../candle-patterns.mjs';

// Explicit component contracts, not natural market/full-engine approval proof.
function fixture({direction='LONG',mode='REPLAY'}={}){
  const f=makePaperExecutionFixture({direction}),metadata={...f.state.metadata,replay:mode==='REPLAY',realtime:mode==='LIVE',synthetic:false};
  Object.assign(f.analysis,{definitionVersion:GUIDE_SIGNAL_VERSION,sourceKind:'original_research_definition',metadata,parameterSnapshot:structuredClone(f.alert.signal.parameterSnapshot),status:'SIGNALS'});
  return {analysis:f.analysis,bars:f.state.bars,metadata,sourceMode:mode,asOfTime:f.analysis.asOfTime,fixtureScope:f.fixtureScope};
}
function native(payload){const last=payload.records.at(-1);return {ARROW_MARKER_SCHEMA:payload.approvalKind==='TECHNICAL'?2:1,ARROW_MARKER_SIGNATURE:payload.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:payload.records.length,ARROW_MARKER_MATCHED_COUNT:payload.records.length,ARROW_MARKER_DRAWN_COUNT:payload.records.length,ARROW_MARKER_MODE:payload.sourceMode==='LIVE'?1:2,ARROW_MARKER_LAST_TIME:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:payload.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};}
function mutateSignal(input,fn){fn(input.analysis.signals[0]);input.analysis.events=[structuredClone(input.analysis.signals[0])];}

test('strict LONG/SHORT component records bind native arrows to exact confirmation candle time/OHLC/price',()=>{
  for(const direction of ['LONG','SHORT']){
    const input=fixture({direction}),before=structuredClone(input),payload=buildApprovedCandleMarkerPayload(input);assert.equal(payload.status,'READY',JSON.stringify(payload));
    assert.equal(payload.records.length,1);const record=payload.records[0],bar=input.bars[2];
    assert.equal(record.time,bar.time);assert.equal(record.closeTime,bar.closeTime);assert.equal(record.price,bar.close);assert.equal(record.openTicks,bar.open/.25);assert.equal(record.highTicks,bar.high/.25);assert.equal(record.lowTicks,bar.low/.25);assert.equal(record.closeTicks,bar.close/.25);
    assert.equal(record.quantity,1);assert.equal(record.totalPlannedRisk,198.1);assert.equal(payload.colors[direction],direction==='LONG'?'#7dd3fc':'#fb923c');assert.equal(payload.nativeSize,'normal');assert.equal(payload.ordersCreated,false);assert.equal(payload.fillInferred,false);assert.deepEqual(input,before);
    assert.equal(validateApprovedCandleMarkerPayload(payload.textPayload,input).valid,true);assert.equal(verifyNativeCandleMarkerFields(payload,native(payload)).verified,true);
  }
});
test('all seven frozen checks and configured rules are mandatory; partial shapes cannot create native arrows',()=>{
  for(const flag of ['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand']){const f=fixture();mutateSignal(f,s=>{s.parameterSnapshot.config[flag]=false;});assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED',flag);}
  for(const id of ['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'])for(const property of ['required','enabled','available','passed']){const f=fixture();mutateSignal(f,s=>{s.contextSnapshot.checks.find(c=>c.id===id)[property]=false;});assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED',id+property);}
  for(const property of ['roleReversalEnabled','supplyDemandEnabled']){const f=fixture();f.analysis.parameterSnapshot.contextConfig[property]=false;assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED');}
});
test('no strict approval produces a valid empty native payload, without a fabricated arrow',()=>{
  const f=fixture();f.analysis.events=[];f.analysis.signals=[];f.analysis.status='NO_SIGNAL';const payload=buildApprovedCandleMarkerPayload(f);
  assert.equal(payload.status,'EMPTY');assert.equal(payload.records.length,0);assert.equal(payload.textPayload.split('\n').length,1);assert.equal(verifyNativeCandleMarkerFields(payload,native(payload)).status,'NATIVE_EMPTY_MARKERS_VERIFIED');
  const pending=fixture();pending.analysis.signals[0].status='ARMED';assert.equal(buildApprovedCandleMarkerPayload(pending).status,'EMPTY');
});
test('TEST/synthetic sources and Replay/LIVE ambiguity cannot be represented as market approvals',()=>{
  for(const edit of [f=>{f.testOnly=true;},f=>{f.metadata.synthetic=true;},f=>{f.analysis.testOnly=true;},f=>{f.metadata.replay=false;},f=>{f.metadata.realtime=true;},f=>{f.sourceMode='TEST';},f=>{f.analysis.signals[0].testOnly=true;}]){const f=fixture();edit(f);assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED');}
  const live=fixture({mode:'LIVE'});assert.equal(buildApprovedCandleMarkerPayload(live).status,'BLOCKED','raw historical LIVE signals cannot become fresh approvals');
  live.approvedSignals=structuredClone(live.analysis.signals);live.approvedSignals[0].liveEligibility={policy:'POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE',bootstrapAsOfTime:live.bars[1].time,confirmationBarCloseTime:live.bars[2].closeTime,representativeSetupEventId:live.analysis.events[0].eventId};
  assert.equal(buildApprovedCandleMarkerPayload(live).status,'READY');live.approvedSignals[0].liveEligibility.bootstrapAsOfTime=live.bars[1].time+1;assert.equal(buildApprovedCandleMarkerPayload(live).status,'BLOCKED');
});
test('open/future/mismatched/off-tick bars and confirmation-index changes fail before rendering',()=>{
  for(const edit of [f=>{f.bars[2].closed=false;},f=>{f.bars[2].sourceClosed=false;},f=>{f.bars[2].knownAt=f.asOfTime+1;},f=>{f.bars[2].closeTime++;},f=>{f.bars[2].high=19999;},f=>{f.bars[2].close+=.1;},f=>{f.analysis.signals[0].confirmationIndex=1;},f=>{f.analysis.signals[0].confirmationClose+=.25;},f=>{f.analysis.signals[0].confirmedAt++;},f=>{f.analysis.signals[0].formationStartTime++;},f=>{f.metadata.instrument='CME_MINI:MNQ1!';},f=>{f.analysis.events=[null];}]){const f=fixture();edit(f);assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED',edit.toString());}
});
test('one NQ all-in risk is independently recomputed and cannot be relabelled affordable',()=>{
  for(const edit of [s=>{s.parameterSnapshot.risk.commissionPerContract=undefined;},s=>{s.parameterSnapshot.risk.slippageTicks=undefined;},s=>{s.riskPlan.quantity=2;},s=>{s.riskPlan.totalPlannedRisk=1;},s=>{s.invalidation-=.25;s.riskPlan.initialStop=s.invalidation;},s=>{s.riskPlan.ordersCreated=true;}]){const f=fixture();mutateSignal(f,edit);assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED');}
});
test('constituent approvals cannot be borrowed from a rejected setup or conflicting direction',()=>{
  const rejected=fixture();rejected.analysis.events[0].status='REJECTED';assert.equal(buildApprovedCandleMarkerPayload(rejected).status,'BLOCKED');
  const duplicate=fixture();duplicate.analysis.signals.push(structuredClone(duplicate.analysis.signals[0]));assert.equal(buildApprovedCandleMarkerPayload(duplicate).status,'BLOCKED');
  const conflict=fixture(),short=fixture({direction:'SHORT'}).analysis.signals[0];short.eventId='different-short-event';conflict.analysis.events.push(structuredClone(short));conflict.analysis.signals.push(short);assert.deepEqual(buildApprovedCandleMarkerPayload(conflict).reasonCodes,['AMBIGUOUS_MARKER_DIRECTIONS_AT_CANDLE']);
});
test('payload delivery and native fields must match exact signature, time, price, cutoff, mode and complete count',async()=>{
  const f=fixture(),payload=buildApprovedCandleMarkerPayload(f),fields=native(payload);
  assert.equal(validateApprovedCandleMarkerPayload(payload.textPayload.replace(/\n/g,'\r\n'),f).valid,true);
  assert.equal(validateApprovedCandleMarkerPayload(payload.textPayload+'0',f).valid,false);
  for(const name of CANDLE_MARKER_NATIVE_FIELDS){const changed={...fields,[name]:fields[name]+1};assert.equal(verifyNativeCandleMarkerFields(payload,changed).verified,false,name);}
  const formatted=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.toLocaleString('en-US',{maximumFractionDigits:0})]));assert.equal(verifyNativeCandleMarkerFields(payload,formatted).verified,true);
  assert.equal(verifyNativeCandleMarkerFields({...payload,textPayload:'הוזן טקסט אחר'},fields).verified,false);assert.equal(verifyNativeCandleMarkerFields(payload,{}).verified,false);
  assert.throws(()=>candleMarkerPayloadSignature('unrepresentable ☃'),/UNREPRESENTABLE/);
  // Static Pine contract; actual compiler/native readback remains a UI check.
  const pine=await readFile(new URL('../tradingview-approved-candle-markers.pine',import.meta.url),'utf8');
  assert.match(pine,/ticker\.standard\(syminfo\.tickerid\)\s*==\s*expectedInstrument/);
  assert.doesNotMatch(pine,/sourceIdentity\s*=\s*syminfo\.tickerid\s*==/);
});
test('native payload is bounded to the newest twenty independently approved candles',()=>{
  const seed=fixture(),bars=[],signals=[],events=[];
  for(let n=0;n<25;n++){
    const offset=n*180000,part=seed.bars.map(bar=>({...bar,time:bar.time+offset,closeTime:bar.closeTime+offset,knownAt:bar.knownAt+offset})),s=structuredClone(seed.analysis.signals[0]);
    Object.assign(s,{eventId:'bounded-event-'+n,confirmationIndex:n*3+2,signalIndex:n*3+1,signalStartIndex:n*3+1,formationStartTime:part[1].time,detectedAt:part[1].knownAt,confirmedAt:part[2].knownAt,confirmationBarCloseTime:part[2].closeTime});bars.push(...part);signals.push(s);events.push(structuredClone(s));
  }
  const asOfTime=bars.at(-1).closeTime,analysis={...seed.analysis,events,signals,asOfTime},payload=buildApprovedCandleMarkerPayload({...seed,analysis,bars,asOfTime});
  assert.equal(payload.status,'READY',JSON.stringify(payload));assert.equal(payload.records.length,20);assert.equal(payload.totalApprovedSignals,25);assert.equal(payload.truncatedApprovedSignals,5);assert.equal(payload.records[0].eventId,'bounded-event-5');assert.equal(payload.textPayload.split('\n').length,21);assert.ok(payload.textPayload.length<=8192);
});

function technicalFixture({direction='LONG'}={}){
  // Component contract with declared context evidence, not natural/full-engine
  // market approval. The actual pattern ledger is computed on its exact bars.
  const f=fixture({direction});f.fixtureScope='TECHNICAL_COMPONENT_CONTRACT_NOT_MARKET_EVIDENCE';
  f.analysis.parameterSnapshot.config.requireRisk=false;delete f.analysis.parameterSnapshot.risk;
  const event=f.analysis.events[0];Object.assign(event,{definitionVersion:GUIDE_SIGNAL_VERSION,knownAt:event.detectedAt,reasonCodes:['LATER_CLOSED_BAR_CONFIRMED'],trigger:event.confirmationClose+(direction==='LONG'?-.25:.25),expiresAfterBars:3,patternIds:[direction==='LONG'?'BULLISH_ENGULFING':'BEARISH_ENGULFING'],setupId:'COMPONENT_TECHNICAL_SETUP'});
  event.parameterSnapshot=structuredClone(f.analysis.parameterSnapshot);delete event.riskPlan;f.analysis.signals=[];
  f.analysis.patterns=analyzeCandlePatterns(f.bars,{tickSize:.25,asOfTime:f.asOfTime});
  return f;
}

test('LIVE direction schema separates recomputed history from received live approvals without any risk invention',()=>{
  for(const direction of ['LONG','SHORT']){
    const f=technicalFixture({direction});f.sourceMode='LIVE';f.metadata.replay=false;f.metadata.realtime=true;f.analysis.metadata=structuredClone(f.metadata);f.bars.forEach(b=>b.finalOhlcVerified=true);
    assert.equal(buildTechnicalCandleMarkerPayload(f).status,'BLOCKED','LIVE requires its own explicit display policy');
    const history=buildTechnicalCandleMarkerPayload({...f,displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL'});assert.equal(history.status,'READY',JSON.stringify(history));assert.equal(history.schemaVersion,3);assert.equal(history.records[0].liveApproved,false);assert.equal(history.textPayload.split('\n')[1].split('|').at(-1),'0');assert.equal(history.asOfTime,f.bars.at(-1).closeTime);
    const r=history.records[0],approvedSignals=[{status:'CONFIRMED',direction,confirmationBarCloseTime:r.closeTime,setupEventIds:r.sourceEventIds,liveEligibility:{policy:'POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE'}}];
    const live=buildTechnicalCandleMarkerPayload({...f,displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL',approvedSignals});assert.equal(live.records[0].liveApproved,true);assert.equal(live.textPayload.split('\n')[1].split('|').length,10);assert.equal(live.fillInferred,false);assert.equal(live.orderEligible,false);assert.equal(live.riskApprovalGranted,false);assert.equal(Object.hasOwn(live.records[0],'riskMicros'),false);
    const fields=native(live);fields.ARROW_MARKER_SCHEMA=3;assert.equal(verifyNativeCandleMarkerFields(live,fields).verified,true);fields.ARROW_MARKER_SCHEMA=2;assert.equal(verifyNativeCandleMarkerFields(live,fields).verified,false);
    f.bars[0].finalOhlcVerified=false;assert.equal(buildTechnicalCandleMarkerPayload({...f,displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL'}).reasonCodes[0],'FINAL_LIVE_MARKER_OHLC_REQUIRED');
  }
});

test('LIVE analysis observed after candle close retains the availability clock while native cutoff uses the confirmed candle boundary',()=>{
  const f=technicalFixture();f.sourceMode='LIVE';f.metadata.replay=false;f.metadata.realtime=true;f.analysis.metadata=structuredClone(f.metadata);f.bars.forEach(b=>b.finalOhlcVerified=true);f.asOfTime+=541;f.analysis.asOfTime=f.asOfTime;
  const p=buildTechnicalCandleMarkerPayload({...f,displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL'});assert.equal(p.status,'READY',JSON.stringify(p));assert.equal(p.analysisAsOfTime,f.asOfTime);assert.equal(p.asOfTime,f.bars.at(-1).closeTime);assert.notEqual(p.asOfTime,p.analysisAsOfTime);assert.equal(p.records[0].time,f.bars.at(-1).time);
});

test('technical-only LONG and SHORT payloads use a distinct nine-column schema without sizing or risk inventions',()=>{
  for(const direction of ['LONG','SHORT']){
    const f=technicalFixture({direction}),before=structuredClone(f),payload=buildTechnicalCandleMarkerPayload(f);
    assert.equal(payload.status,'READY',JSON.stringify(payload));assert.equal(payload.kind,'TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD');assert.equal(payload.approvalKind,'TECHNICAL');assert.equal(payload.schemaVersion,2);
    assert.ok(payload.textPayload.startsWith('ARROW_TECHNICAL_MARKERS_V1|CME_MINI:NQ1!|1|REPLAY|'));
    assert.equal(payload.textPayload.split('\n')[1].split('|').length,9);assert.equal(payload.records[0].direction,direction);
    for(const property of ['quantity','riskPlan','totalPlannedRisk','riskMicros'])assert.equal(Object.hasOwn(payload.records[0],property),false,property);
    assert.equal(payload.riskApprovalGranted,false);assert.equal(payload.orderEligible,false);assert.equal(payload.ordersCreated,false);assert.equal(payload.fillInferred,false);assert.deepEqual(f,before);
    assert.equal(validateTechnicalCandleMarkerPayload(payload.textPayload,f).valid,true);assert.equal(verifyNativeCandleMarkerFields(payload,native(payload)).verified,true);
    assert.equal(verifyNativeCandleMarkerFields(payload,{...native(payload),ARROW_MARKER_SCHEMA:1}).verified,false,'old installed Pine cannot prove a technical payload');
    assert.equal(buildApprovedCandleMarkerPayload(f).status,'BLOCKED','technical direction never enters the strict risk-reviewed builder');
  }
});

test('native short readback accepts TradingView leading Unicode minus while rejecting malformed or wrong-direction values',()=>{
  const payload=buildTechnicalCandleMarkerPayload(technicalFixture({direction:'SHORT'})),fields=native(payload);
  assert.equal(fields.ARROW_MARKER_LAST_DIRECTION,-1);
  assert.equal(verifyNativeCandleMarkerFields(payload,{...fields,ARROW_MARKER_LAST_DIRECTION:'−1'}).verified,true);
  for(const value of ['—1','1−','−−1','−2','1'])assert.equal(verifyNativeCandleMarkerFields(payload,{...fields,ARROW_MARKER_LAST_DIRECTION:value}).verified,false,value);
});

test('technical marker survives a coherent risk-only rejection and contains no claimed risk approval',()=>{
  const f=technicalFixture(),event=f.analysis.events[0];event.status='REJECTED';event.reasonCodes=['RISK_REJECTED','RISK_BUDGET_BELOW_ONE_CONTRACT'];event.riskPlan={status:'BLOCKED',perContractRisk:1000,quantity:0,totalPlannedRisk:0,reasonCodes:['RISK_BUDGET_BELOW_ONE_CONTRACT']};
  const payload=buildTechnicalCandleMarkerPayload(f);assert.equal(payload.status,'READY',JSON.stringify(payload));assert.equal(payload.currentTechnicalStatus,'CONFIRMED');assert.equal(payload.records.length,1);assert.equal(payload.riskApprovalGranted,false);assert.equal(Object.hasOwn(payload.records[0],'riskPlan'),false);assert.equal(Object.hasOwn(payload.records[0],'totalPlannedRisk'),false);
});

test('technical source proof rejects synthetic/test, disabled checks, incomplete closed ledger, future data and different identity',()=>{
  for(const edit of [f=>{f.testOnly=true;},f=>{f.analysis.metadata.synthetic=true;},f=>{f.analysis.events[0].testOnly=true;},f=>{f.analysis.events[0].contextSnapshot.checks.pop();},f=>{f.analysis.parameterSnapshot.config.requireFib=false;},f=>{f.analysis.events[0].contextSnapshot.checks[0].available=false;},f=>{f.bars.at(-1).closed=false;},f=>{f.bars.at(-1).knownAt=f.asOfTime+1;},f=>{f.bars.at(-1).close+=.25;},f=>{f.metadata.timeframe='5';},f=>{f.metadata.instrument='CME_MINI:MNQ1!';},f=>{f.sourceMode='LIVE';},f=>{f.asOfTime++;},f=>{f.analysis.events={};}]){
    const f=technicalFixture();edit(f);assert.equal(buildTechnicalCandleMarkerPayload(f).status,'BLOCKED',edit.toString());
  }
});

test('a technical conflict draws no current arrow while retaining a distinct earlier unambiguous candle',()=>{
  const f=technicalFixture(),earlier=structuredClone(f.analysis.events[0]),last=f.bars.at(-1),next={...last,time:last.closeTime,closeTime:last.closeTime+60000,knownAt:last.closeTime+60000};
  f.bars.push(next);f.asOfTime=next.closeTime;f.analysis.asOfTime=f.asOfTime;
  const current={...structuredClone(earlier),eventId:'component-current-long',signalStartIndex:2,signalIndex:2,confirmationIndex:3,formationStartTime:last.time,detectedAt:last.knownAt,knownAt:last.knownAt,confirmedAt:next.knownAt,confirmationBarCloseTime:next.closeTime,confirmationClose:next.close};
  const opposite={...structuredClone(current),eventId:'component-current-short',direction:'SHORT',trigger:next.close+.25,invalidation:next.close+1};
  f.analysis.events=[earlier,current,opposite];f.analysis.patterns=analyzeCandlePatterns(f.bars,{tickSize:.25,asOfTime:f.asOfTime});
  const payload=buildTechnicalCandleMarkerPayload(f);assert.equal(payload.status,'READY',JSON.stringify(payload));assert.equal(payload.currentTechnicalStatus,'AMBIGUOUS');assert.equal(payload.currentTechnicalDirection,null);
  assert.deepEqual(payload.excludedConflictCutoffs,[next.closeTime]);assert.equal(payload.records.length,1);assert.equal(payload.records[0].closeTime,earlier.confirmationBarCloseTime);assert.ok(payload.records.every(record=>record.closeTime!==next.closeTime));
});

test('technical record wrapper binds its imported cutoff and empty native proof without an invented direction',()=>{
  const f=technicalFixture();f.analysis.events=[];
  const record={analysis:f.analysis,analysisInputs:{bars:f.bars,options:{metadata:f.metadata,asOfTime:f.asOfTime}},cutoff:{asOfTime:f.asOfTime},mode:'REPLAY'};
  const payload=buildTechnicalCandleMarkerPayload(record);assert.equal(payload.status,'EMPTY');assert.equal(payload.records.length,0);assert.equal(payload.currentTechnicalStatus,'NO_APPROVAL');assert.equal(verifyNativeCandleMarkerFields(payload,native(payload)).verified,true);
  record.cutoff.asOfTime++;assert.equal(buildTechnicalCandleMarkerPayload(record).status,'BLOCKED');
});

test('Pine additive technical contract distinguishes native schema and never prints its unused risk slot as planned risk',async()=>{
  const pine=await readFile(new URL('../tradingview-approved-candle-markers.pine',import.meta.url),'utf8');
  assert.match(pine,/technicalPayload := schemaName == "ARROW_TECHNICAL_MARKERS_V1"/);assert.match(pine,/payloadSchemaCode := fillPayload \? 5 : entryPayload \? 4 : directionPayload \? 3 : technicalPayload \? 2 : 1/);
  assert.match(pine,/array\.size\(values\) != \(fillPayload \? 13 : technicalPayload and not directionPayload \? 9 : 10\)/);assert.match(pine,/technicalPayload \? "technical direction \| user-managed risk \| NOT A FILL"/);
  assert.match(pine,/riskMicros > 0 and riskMicros <= 200000000/);assert.match(pine,/plot\(payloadSchemaCode, "ARROW_MARKER_SCHEMA"/);
});

test('Pine preserves legacy payload support while schema4 draws entry arrows at confirmation time and price',async()=>{
  const pine=await readFile(new URL('../tradingview-approved-candle-markers.pine',import.meta.url),'utf8');
  assert.match(pine,/entryPayload \? yloc.price : marker.direction == 1 \? yloc.belowbar : yloc.abovebar/);
  assert.match(pine,/entryPayload \? marker.closeTime : marker.openTime/);
  assert.match(pine,/entryPayload and not submittedEntry \? size.small : size.huge/);
  assert.match(pine,/nativeLastPriceTicks := drawingPriceTicks/);
  assert.doesNotMatch(pine,/\bstrategy\.(?:entry|order|exit|close)\s*\(/);
});
