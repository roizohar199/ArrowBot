import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyReplayReadiness} from '../scripts/verify-replay-readiness.mjs';
import {normalizeReplayDataset,buildReplayAnalysisInput,selectReplayDecision,REPLAY_EXTENSION_VERSION} from '../replay-research.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';

const canonicalBytes=await readFile(new URL('../verification/nq-replay/native-NQ-merged-replay.json',import.meta.url));
const dataset=normalizeReplayDataset(JSON.parse(canonicalBytes)),hash=createHash('sha256').update(canonicalBytes).digest('hex');
// Synthetic receipt/witness around genuine imported bars tests the auditor;
// this fixture is never written or described as an actual UI observation.
function fixture(index=195,sequence=8){
  const runEpoch=Date.UTC(2026,10,14,19),runId='CME_MINI:NQ1!|1|'+runEpoch,origin=runEpoch-10000,sourceObservedEpochMs=origin+1000;
  const current={...dataset.bars[index],closed:false,sourceClosed:false,providerBarIndex:100+index,sessionFirst:false,sessionLast:false},previous={...dataset.bars[index-1],sourceClosed:true,providerBarIndex:99+index,sessionFirst:false,sessionLast:false},tag=sequence%4096;
  const witness={kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,checksumsVerified:true,metadata:dataset.metadata,current,previous,currentTime:current.time,currentCloseTime:current.closeTime,runEpoch,runId,sequence,sourceEmittedAt:runEpoch,sourceDocumentTimeOrigin:origin,sourceObservedEpochMs,pineRealtimeExecution:false,fields:{ARROW2_RUN_EPOCH:String(runEpoch),ARROW2_SEQ_BEGIN:String(sequence),ARROW2_SEQ_END:String(sequence),ARROW2_CURRENT_TIME:String(tag*1e12+current.time-1577836800000),ARROW2_CURRENT_CLOSE_TIME:String(tag*1e12+current.providerBarIndex*4),ARROW2_CHECKSUM_A:'123456',ARROW2_CHECKSUM_B:'456789'}};
  const chart={symbols:[dataset.metadata.instrument],interval:'1',visibleCharts:1,documentVisible:true,replay:true};
  const input=buildReplayAnalysisInput(dataset,{chart,replayWitness:witness,messages:[],contextOnly:true,liveEligible:false}),analysis=analyzeGuideSignals(input.bars,input.options),decision=selectReplayDecision(analysis,input.options.asOfTime);
  const receipt={status:'RENDERED',mode:'REPLAY',live:false,orderEligible:false,ordersCreated:false,testOnly:false,approvedHistorical:decision.status==='CONFIRMED',decisionStatus:decision.status,eventId:'REPLAY:'+(decision.status==='CONFIRMED'?decision.signal.eventId:runId+':'+sequence+':'+current.time+':'+decision.asOfTime+':'+decision.status),sourceRunId:runId,sourceSequence:sequence,documentTimeOrigin:origin,sourceObservedEpochMs,renderReceiptEpoch:sourceObservedEpochMs+30,mutationEpoch:sourceObservedEpochMs+31,firstPaintEpoch:sourceObservedEpochMs+50,secondPaintEpoch:sourceObservedEpochMs+66,sourceToChartLowerMs:50,sourceToChartUpperMs:66,meaning:'HISTORICAL_REPLAY_UI_RENDER_OPPORTUNITIES_NOT_LIVE_LATENCY',marketToDisplayMeasured:false,networkLatencyMeasured:false,physicalDisplayMeasured:false};
  const timing={receiverReadMs:10,analysisMs:20,overlayRoundTripMs:10,receiverOperationMs:70,chartReceipt:receipt,marketToDisplayMeasured:false,captureToPhysicalDisplayMeasured:false};
  const latest={kind:'NQ_REPLAY_RESEARCH_OBSERVATION',extensionVersion:REPLAY_EXTENSION_VERSION,mode:'REPLAY',liveEligible:false,orderEligible:false,testOnly:false,sessionId:'REPLAY:controlled-unit-session',sourceTabId:17,inputFile:{sha256:hash,bytes:canonicalBytes.length},cutoff:input.cutoff,replayWitness:witness,chart,analysisInputs:{bars:input.bars,options:input.options},analysis,decision,timing};
  return {kind:'NQ_REPLAY_RESEARCH_EXPORT',schemaVersion:1,extensionVersion:REPLAY_EXTENSION_VERSION,exportedAt:new Date(runEpoch).toISOString(),mode:'REPLAY',liveEligible:false,orderEligible:false,latest,journal:[{id:latest.sessionId+':1',asOfTime:decision.asOfTime,status:decision.status,signal:decision.signal,cutoff:input.cutoff,timing,liveEligible:false}]};
}
let baseline;
const fresh=()=>structuredClone(baseline??=fixture());

test('Replay audit reconstructs the complete strict causal input, current-close decision and same-source timing without claiming LIVE',()=>{
  const recording=fresh(),report=verifyReplayReadiness(recording,canonicalBytes);
  assert.equal(report.status,'VERIFIED_HISTORICAL_REPLAY_UI_DECISION');assert.deepEqual(report.reasonCodes,[]);
  assert.equal(report.allSevenMandatoryFlags,true);assert.equal(report.engineReplay.fullAnalysisMatched,true);assert.equal(report.engineReplay.decisionMatched,true);
  assert.equal(report.cutoff.openCurrentExcluded,true);assert.ok(report.cutoff.excludedFutureBaseBars>0);assert.equal(report.chartReceipt.sourceToChartUpperMs,66);
  assert.equal(report.limits.liveMarketApprovalProven,false);assert.equal(report.limits.fullRawChecksumRecomputedFromExport,false);
});

test('Replay audit detects changed version, missing mandatory filter, disabled role reversal and a changed cost assumption',()=>{
  for(const [mutate,code]of[
    [r=>{r.extensionVersion='0.14.2';},'EXTENSION_VERSION_MISMATCH'],
    [r=>{r.latest.analysisInputs.options.config.requireTrendline=false;},'ALL_SEVEN_MANDATORY_FLAGS'],
    [r=>{r.latest.analysisInputs.options.contextConfig.roleReversalEnabled=false;},'ALL_NINE_SCENARIO_FAMILIES_ENABLED'],
    [r=>{r.latest.analysisInputs.options.risk.commissionPerContract=0;},'EXPLICIT_NQ_ONE_CONTRACT_200_COST_ASSUMPTIONS']
  ]){const recording=fresh();mutate(recording);const report=verifyReplayReadiness(recording,canonicalBytes);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.includes(code),code);}
});

test('Replay audit detects raw-field sequence/time tampering, missing witness fields and altered render clocks',()=>{
  for(const [mutate,code]of[
    [r=>{r.latest.replayWitness.fields.ARROW2_SEQ_BEGIN='9';},'PUBLIC_WITNESS_RUN_AND_SEQUENCE_FIELDS'],
    [r=>{r.latest.replayWitness.fields.ARROW2_CURRENT_TIME=String(Number(r.latest.replayWitness.fields.ARROW2_CURRENT_TIME)+60000);},'PUBLIC_WITNESS_CURRENT_TIME'],
    [r=>{delete r.latest.replayWitness.fields.ARROW2_CHECKSUM_B;},'EXACT_SEVEN_RAW_WITNESS_FIELDS'],
    [r=>{r.latest.timing.chartReceipt.sourceToChartUpperMs+=1;},'SOURCE_TO_CHART_BOUND_ARITHMETIC'],
    [r=>{r.latest.timing.chartReceipt.documentTimeOrigin+=1;},'SAME_SOURCE_DOCUMENT_ORDERED_TIMESTAMPS']
  ]){const recording=fresh();mutate(recording);const report=verifyReplayReadiness(recording,canonicalBytes);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.includes(code),code);}
});

test('Replay audit rejects imported future base/HTF bars and any byte change to the pinned native dataset',()=>{
  const base=fresh();base.latest.analysisInputs.bars.push(dataset.bars[195]);
  assert.ok(verifyReplayReadiness(base,canonicalBytes).reasonCodes.includes('EXACT_NATIVE_IMPORT_PREFIX_REBUILD'));
  const higher=fresh(),series=higher.latest.analysisInputs.options.higherTimeframes['5'];series.bars.push(dataset.higherTimeframes['5'].bars[series.bars.length]);
  assert.ok(verifyReplayReadiness(higher,canonicalBytes).reasonCodes.includes('EXACT_NATIVE_IMPORT_PREFIX_REBUILD'));
  const changedBytes=Buffer.concat([canonicalBytes,Buffer.from('\n')]);assert.ok(verifyReplayReadiness(fresh(),changedBytes).reasonCodes.includes('KNOWN_CANONICAL_NATIVE_IMPORT_HASH'));
});

test('Replay progression requires the same owned session and exactly one bar forward with a distinct event',()=>{
  const previous=fresh(),next=fixture(196,16),report=verifyReplayReadiness(next,canonicalBytes,{previous});
  assert.deepEqual(report.reasonCodes,[]);assert.equal(report.progression.cutoffAdvanceMs,60000);assert.equal(report.progression.sameSession,true);
  const skipped=fixture(197,24);assert.ok(verifyReplayReadiness(skipped,canonicalBytes,{previous}).reasonCodes.includes('ONE_REAL_REPLAY_BAR_FORWARD'));
});
