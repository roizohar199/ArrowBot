import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovedDeliveryProbe} from '../live-delivery-probe.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {selectFreshLiveSignal} from '../live-signal-eligibility.mjs';
import {verifyLiveDeliveryRecording} from '../scripts/verify-live-delivery.mjs';

// All prices and source/chart receipts in this file are fabricated unit-test
// fixtures. Passing this verifier is never evidence of an actual market event.
function syntheticExportFixture({rangeTargetPolicy='fixed_r',stopBufferTicks}={}){
  const at=Date.UTC(2026,10,14,12),probe=createApprovedDeliveryProbe({now:()=>at}),instrument='CME_MINI:NQ1!',runEpoch=at-1000000,runId=instrument+'|1|'+runEpoch;
  const wireMeta={source:'ohlc',instrument,timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'regular',chartType:'standard'};
  const metadata={...wireMeta,provider:'TradingView public Data Window v2',sourceId:runId,tabId:17,realtime:true,replay:false,chartIdentityVerified:true};
  const inputs=structuredClone({bars:probe.replayInputs.bars,options:probe.replayInputs.options});inputs.options.metadata=metadata;
  inputs.options.config={...inputs.options.config,rangeTargetPolicy};
  if(rangeTargetPolicy==='range_midpoint')inputs.options.risk.minRewardRisk=.5;
  if(stopBufferTicks!==undefined)inputs.options.risk.stopBufferTicks=stopBufferTicks;
  for(const entry of Object.values(inputs.options.higherTimeframes))entry.metadata={...metadata,timeframe:entry.timeframe,timeframeMs:entry.timeframeMs};
  const analysis=analyzeGuideSignals(inputs.bars,inputs.options),bootstrapAsOfTime=probe.replayInputs.bootstrapAsOfTime;
  const selected=analysis.signals.map(signal=>selectFreshLiveSignal(signal,analysis,{bootstrapAsOfTime,eligibleCloseTimes:probe.replayInputs.eligibleCloseTimes,bars:inputs.bars})).filter(Boolean);
  assert.equal(selected.length,1);const signal=selected[0],sequence=4004,sourcePacketId=runId+':'+sequence,readEventId='read:900';
  const profile={schemaVersion:1,id:'fixture',label:'Unit fixture only',brokerLabel:'',mode:'RESEARCH',instrument,currency:'USD',tickSize:.25,pointValue:20,riskBudget:200,maxContracts:1,commissionPerContract:4,slippageTicks:2,rewardRisk:2,costBasis:'USER_SPECIFIED'};
  const accountReview={reviewId:'local-review-fixture',reviewedAt:at-1000,profile,ordersAuthorized:false,brokerAccountVerified:false,commissionVerified:false,slippageVerified:false};
  const final=inputs.bars.at(-1),packet={schemaVersion:1,kind:'update',runId,sequence,sourceEmittedAt:at,realtime:true,dataDelayUnverified:true,metadata:wireMeta,bars:[{time:final.time,closeTime:final.closeTime,open:final.open,high:final.high,low:final.low,close:final.close,closed:true,sourceClosed:true}],reasonCodes:[]};
  const approvedAtReceiverEpoch=at+30,item={id:runId+':'+signal.eventId,sourcePacketId,readEventId,signal,receivedAt:at+20,sourceEmittedAt:at,sourceClockVerified:false,accountReview,approvedAtReceiverEpoch};
  const origin=at-300000,appearance=at+10,chartOverlay={status:'RENDERED',mode:'LIVE',eventId:signal.eventId,documentTimeOrigin:origin,renderReceiptEpoch:at+40,mutationEpoch:at+41,firstPaintEpoch:at+56,secondPaintEpoch:at+72,meaning:'renderopportunitynotphysical',physicalDisplayMeasured:false};
  const delivery={mode:'LIVE',testOnly:false,eventId:signal.eventId,sourcePacketId,readEventId,approvedAtReceiverEpoch,chartRequestEpoch:at+31,chartReplyEpoch:at+80,chartOverlay,sourceObservation:{packetId:sourcePacketId,sourceAppearanceEpochMs:appearance,sourceDocumentTimeOrigin:origin,sourceObservationMeaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME',sourceTransport:'PUBLIC_DATA_WINDOW_V2'},correlationStatus:'SAME_SOURCE_DOCUMENT_CLOCK',sourceToChartPaintLowerMs:46,sourceToChartPaintUpperMs:62};
  return {schemaVersion:1,extensionVersion:'0.13.0',kind:'LIVE_OHLC_OBSERVATION',sourceTransport:'window',orderEligible:false,selectedTabId:17,selectedRun:runId,exportedAt:new Date(at+100).toISOString(),store:{metadata,bars:inputs.bars,bootstrapAsOfTime,orderEligible:false},analysisInputs:inputs,latestAnalysis:{...analysis,cache:{arbitraryWrapperCounter:999}},alerts:[item],alertDelivery:[delivery],deliveryProbes:[],windowEvidence:{bootstrapMetadata:{runId,runEpoch,metadata:wireMeta}},rawEvidence:[{id:sourcePacketId,receivedAt:at+20,sourceEmittedAt:at,raw:'ARROW_OHLC_V1 '+JSON.stringify(packet),chart:{symbols:[instrument],interval:'1',replay:false,documentVisible:true,visibleCharts:1,marketOpen:true,realtime:true},proofReasonCodes:[],accountReasonCodes:[],accountReviewId:accountReview.reviewId}],pollEvidence:[{pollId:900,sourcePacketIds:[sourcePacketId],liveEligible:true}],closeBoundarySamples:[{pollId:900,sourcePacketId,closeTime:final.closeTime,eligibleLive:true}]};
}

test('offline synthetic export fixture verifies exact LIVE joins, complete replay, costs and same-document chart bounds',()=>{
  const recording=syntheticExportFixture(),before=JSON.stringify(recording),report=verifyLiveDeliveryRecording(recording);
  assert.equal(report.status,'VERIFIED_RECORDED_LIVE_DELIVERY');assert.equal(report.verified,1);assert.equal(report.partial,0);assert.equal(report.mismatched,0);assert.equal(report.analysisReplay.status,'MATCH');assert.equal(report.analysisReplay.completeMatch,true);
  const check=report.checks[0];assert.equal(check.source.rawSourceSequence,500);assert.equal(check.source.independentPerPacketNumericChecksumReplayAvailable,false);assert.equal(check.approval.exactSelectedSignalMatch,true);assert.equal(check.risk.arithmeticReplayed,true);assert.equal(check.risk.totalPlannedRisk,84);assert.equal(check.risk.commissionAllowance,4);assert.equal(check.risk.slippageAllowance,10);assert.equal(check.risk.brokerAccountVerified,false);
  assert.deepEqual(report.verifiedSourceToChartBounds,[{eventId:recording.alerts[0].signal.eventId,lowerMs:46,upperMs:62}]);assert.match(report.scope,/Source authenticity/);assert.equal(JSON.stringify(recording),before,'audit never mutates source evidence');
});

test('TEST-only positive probe never qualifies as an ordinary LIVE approval',()=>{
  const fixture=syntheticExportFixture();fixture.alerts=[];fixture.alertDelivery=[];fixture.deliveryProbes=[{mode:'TEST',testOnly:true,marketData:false,probe:createApprovedDeliveryProbe({now:()=>Date.UTC(2026,10,14,12)})}];
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'NO_LIVE_DELIVERY_RECORDED');assert.equal(report.testProbes,1);assert.equal(report.verified,0);assert.deepEqual(report.verifiedSourceToChartBounds,[]);
  fixture.alertDelivery=[{mode:'TEST',testOnly:true,eventId:'test',chartOverlay:{mode:'TEST'}}];assert.equal(verifyLiveDeliveryRecording(fixture).status,'MISMATCH');
});

test('same event and read from another packet cannot borrow the source appearance timestamp',()=>{
  const fixture=syntheticExportFixture();fixture.alertDelivery[0].sourceObservation.packetId+='-wrong';
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.ok(report.checks[0].timing.reasonCodes.includes('SOURCE_OBSERVATION_PACKET_ID_MISMATCH'));assert.equal(report.checks[0].timing.lowerMs,null);assert.deepEqual(report.verifiedSourceToChartBounds,[]);
});

test('navigation clock mismatch and missing clock token never become numeric latency',()=>{
  for(const edit of [delivery=>{delivery.chartOverlay.documentTimeOrigin++;},delivery=>{delete delivery.chartOverlay.documentTimeOrigin;}]){
    const fixture=syntheticExportFixture();edit(fixture.alertDelivery[0]);const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.verified,0);assert.equal(report.checks[0].timing.lowerMs,null);assert.equal(report.checks[0].timing.upperMs,null);assert.deepEqual(report.verifiedSourceToChartBounds,[]);
  }
});

test('reversed paint chronology and tampered reported bounds are rejected',()=>{
  for(const edit of [delivery=>{delivery.chartOverlay.secondPaintEpoch=delivery.chartOverlay.firstPaintEpoch-1;},delivery=>{delivery.sourceToChartPaintUpperMs=1;}]){
    const fixture=syntheticExportFixture();edit(fixture.alertDelivery[0]);const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.equal(report.checks[0].timing.status,'MISMATCH');
  }
});

test('retention loss is partial, and a delivery without a matching ordinary alert is rejected',()=>{
  const fixture=syntheticExportFixture();fixture.rawEvidence=[];fixture.pollEvidence=[];fixture.closeBoundarySamples=[];
  let report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'PARTIAL');assert.ok(report.checks[0].source.unavailableReasons.includes('EXACT_RAW_PACKET_NOT_RETAINED'));assert.equal(report.verified,0);
  fixture.alerts=[];report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.ok(report.checks[0].reasonCodes.includes('EXACT_LIVE_ALERT_NOT_RECORDED'));
});

test('source replay, stale packet and noneligible closed boundary prevent live verification',()=>{
  for(const edit of [fixture=>{fixture.rawEvidence[0].chart.replay=true;},fixture=>{fixture.closeBoundarySamples[0].eligibleLive=false;},fixture=>{fixture.rawEvidence[0].receivedAt+=5000;}]){
    const fixture=syntheticExportFixture();edit(fixture);const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.equal(report.checks[0].source.status,'MISMATCH');
  }
});

test('formation before bootstrap and all-in costs beyond reviewed account are rejected',()=>{
  for(const edit of [fixture=>{fixture.alerts[0].signal.liveEligibility.bootstrapAsOfTime=fixture.alerts[0].signal.formationStartTime+1;},fixture=>{fixture.alerts[0].accountReview.profile.riskBudget=83;},fixture=>{fixture.alerts[0].signal.riskPlan.slippageAllowance=0;}]){
    const fixture=syntheticExportFixture();edit(fixture);const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.equal(report.verified,0);
  }
});

test('complete latest analysis semantic mismatch fails even with intact positive receipts',()=>{
  const fixture=syntheticExportFixture();fixture.latestAnalysis.events[0].reasonCodes.push('TAMPERED');
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.analysisReplay.status,'MISMATCH');assert.equal(report.status,'MISMATCH');assert.equal(report.verified,0);
});

test('prior approval absent from the latest retained inputs remains partial, not invented as a replay failure',()=>{
  const fixture=syntheticExportFixture();fixture.analysisInputs.bars=fixture.analysisInputs.bars.slice(0,24);fixture.analysisInputs.options.asOfTime=fixture.analysisInputs.bars.at(-1).knownAt;fixture.latestAnalysis=analyzeGuideSignals(fixture.analysisInputs.bars,fixture.analysisInputs.options);
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.analysisReplay.status,'MATCH');assert.equal(report.status,'PARTIAL');assert.ok(report.checks[0].approval.unavailableReasons.includes('ALERT_NOT_COVERED_BY_LATEST_ANALYSIS_INPUTS'));
});

test('a retained prior alert uses its own exact packet metadata after the current source changes',()=>{
  const fixture=syntheticExportFixture();fixture.selectedRun='COINBASE:BTCUSD|1|1794657600000';
  const currentMetadata={...fixture.store.metadata,instrument:'COINBASE:BTCUSD',pointValue:1,tickSize:.01,sourceId:fixture.selectedRun};
  fixture.store.metadata=currentMetadata;fixture.windowEvidence.bootstrapMetadata={...fixture.windowEvidence.bootstrapMetadata,runId:fixture.selectedRun,metadata:currentMetadata};
  fixture.analysisInputs.options.metadata=currentMetadata;fixture.latestAnalysis=analyzeGuideSignals(fixture.analysisInputs.bars,fixture.analysisInputs.options);
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'PARTIAL');assert.equal(report.mismatched,0);assert.equal(report.checks[0].risk.status,'VERIFIED');assert.equal(report.checks[0].risk.profile.instrument,'CME_MINI:NQ1!');assert.equal(report.checks[0].source.metadata.instrument,'CME_MINI:NQ1!');assert.ok(report.checks[0].source.unavailableReasons.includes('ALERT_FROM_PREVIOUS_SOURCE_RUN'));
});

test('synthetic source provenance is rejected even when mislabeled as LIVE',()=>{
  const fixture=syntheticExportFixture();fixture.store.metadata.testOnly=true;
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.includes('SYNTHETIC_OR_TEST_SOURCE'));assert.equal(report.verified,0);
});

test('an empty ordinary ledger is explicitly not proof of natural positive delivery',()=>{
  const recording=syntheticExportFixture();recording.alerts=[];recording.alertDelivery=[];
  const report=verifyLiveDeliveryRecording(recording);assert.equal(report.status,'NO_LIVE_DELIVERY_RECORDED');assert.equal(report.liveAlerts,0);assert.equal(report.verified,0);assert.equal(report.analysisReplay.status,'MATCH');
});

test('v3 independently reconstructs range target policies and does not buffer the canonical event stop again',()=>{
  for(const [policy,target]of [['fixed_r',110.5],['range_midpoint',105],['opposite_boundary',110.75]]){
    const fixture=syntheticExportFixture({rangeTargetPolicy:policy,stopBufferTicks:4}),signal=fixture.alerts[0].signal,report=verifyLiveDeliveryRecording(fixture);
    assert.equal(report.status,'VERIFIED_RECORDED_LIVE_DELIVERY',policy);assert.equal(report.checks[0].risk.arithmeticReplayed,true);assert.equal(signal.invalidation,97.75);assert.equal(signal.riskPlan.initialStop,97.75);assert.equal(signal.riskPlan.parameterSnapshot.stopBufferTicks,0);assert.equal(signal.riskPlan.target,target);assert.equal(signal.riskPlan.researchTargetPolicy,policy);
  }
});

test('an arithmetically valid risk plan from a different range policy cannot forge the recorded policy or reference',()=>{
  const fixture=syntheticExportFixture({rangeTargetPolicy:'range_midpoint'}),other=syntheticExportFixture({rangeTargetPolicy:'opposite_boundary'});
  fixture.alerts[0].signal.riskPlan=structuredClone(other.alerts[0].signal.riskPlan);
  const report=verifyLiveDeliveryRecording(fixture),risk=report.checks[0].risk;
  assert.equal(report.analysisReplay.status,'MATCH','the separately recorded current analysis is intact');assert.equal(report.status,'MISMATCH');assert.equal(risk.status,'MISMATCH');assert.ok(risk.reasonCodes.includes('RISK_TARGET_POLICY_DECORATION_MISMATCH'));assert.ok(risk.reasonCodes.includes('RISK_TARGET_REFERENCE_DECORATION_MISMATCH'));assert.ok(risk.reasonCodes.includes('INDEPENDENT_RISK_PLAN_MISMATCH'));assert.equal(report.verified,0);
});

test('forged range anchor references, future range context and omitted obstacles are independently rejected',()=>{
  for(const edit of [
    signal=>{signal.riskPlan.targetReference.rangeId+=':forged';},
    signal=>{signal.riskPlan.targetReference.knownAt++;},
    signal=>{signal.riskPlan.targetReference.price+=.25;},
    signal=>{signal.contextSnapshot.context.range.knownAt=signal.formationStartTime+1;},
    signal=>{delete signal.riskPlan.obstaclePrice;delete signal.riskPlan.availableRewardRisk;},
  ]){
    const fixture=syntheticExportFixture({rangeTargetPolicy:'range_midpoint'});edit(fixture.alerts[0].signal);const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'MISMATCH');assert.equal(report.checks[0].risk.status,'MISMATCH');assert.equal(report.verified,0);
  }
});

test('a historical v2 rule version remains unavailable instead of being silently replayed as v3',()=>{
  const fixture=syntheticExportFixture();fixture.extensionVersion='0.12.0';fixture.latestAnalysis.definitionVersion='guide-signals-2';fixture.alerts[0].signal.definitionVersion='guide-signals-2';delete fixture.alerts[0].signal.riskPlan.researchTargetPolicy;delete fixture.alerts[0].signal.riskPlan.targetReference;
  const report=verifyLiveDeliveryRecording(fixture);assert.equal(report.status,'PARTIAL');assert.equal(report.verified,0);assert.equal(report.analysisReplay.status,'UNAVAILABLE');assert.ok(report.analysisReplay.reasonCodes.includes('ENGINE_DEFINITION_VERSION_CHANGED'));assert.equal(report.checks[0].risk.arithmeticReplayed,false);assert.ok(report.checks[0].risk.unavailableReasons.includes('SIGNAL_RISK_RULE_VERSION_UNAVAILABLE'));assert.ok(report.checks[0].approval.unavailableReasons.includes('ALERT_RULE_VERSION_REPLAY_UNAVAILABLE'));
});
