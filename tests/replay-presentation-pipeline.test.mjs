import test from 'node:test';
import assert from 'node:assert/strict';
import {presentReplayAnalysis} from '../replay-research.mjs';
import {GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
import {makePaperExecutionFixture} from './fixtures/paper-execution.mjs';

// Controlled component contracts only. These approvals are not evidence of a
// naturally occurring signal, an actual TradingView render or a market fill.
function recordFixture({empty=false}={}){
  const f=makePaperExecutionFixture(),metadata={...f.state.metadata,replay:true,realtime:false,synthetic:false};
  Object.assign(f.analysis,{definitionVersion:GUIDE_SIGNAL_VERSION,sourceKind:'original_research_definition',metadata,parameterSnapshot:structuredClone(f.alert.signal.parameterSnapshot),status:'SIGNALS'});
  if(empty){f.analysis.signals=[];f.analysis.events=[];}
  return {sessionId:'REPLAY:component-contract',analysis:f.analysis,analysisInputs:{bars:f.state.bars,options:{metadata}},cutoff:{asOfTime:f.analysis.asOfTime},replayWitness:{runEpoch:1794696402010,fields:{ARROW2_RUN_EPOCH:'1794696402010',ARROW2_CHECKSUM_A:'777'},sourceDocumentTimeOrigin:1000000,sourceObservedEpochMs:1000100},decision:{status:empty?'NO_APPROVAL':'CONFIRMED',asOfTime:f.analysis.asOfTime}};
}
function fields(payload){const last=payload.records.at(-1);return {ARROW_MARKER_SCHEMA:1,ARROW_MARKER_SIGNATURE:payload.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:payload.records.length,ARROW_MARKER_MATCHED_COUNT:payload.records.length,ARROW_MARKER_DRAWN_COUNT:payload.records.length,ARROW_MARKER_MODE:2,ARROW_MARKER_LAST_TIME:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:payload.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};}
function pipelineFixture(options={}){
  const record=recordFixture(options),calls=[];let time=0,current=true,cardCount=0;
  const f={record,calls,setCurrent:value=>{current=value;},alter:null,
    async execute(func,args){
      const call={name:func.name,args};calls.push(call);time+=10;
      if(f.alter){const override=await f.alter(call);if(override!==undefined)return override;}
      if(func.name==='replayChartOverlayCommand'){
        const initial=++cardCount===1,at=initial?1000110:1000230;
        return {status:'RENDERED',documentTimeOrigin:1000000,sourceObservedEpochMs:1000100,renderReceiptEpoch:at,mutationEpoch:at+1,firstPaintEpoch:at+10,secondPaintEpoch:at+26,ordersCreated:false};
      }
      if(func.name==='nativeCandleMarkerUiCommand'){
        const payload=args[0].payload;return {status:payload.records.length?'NATIVE_MARKERS_VERIFIED':'NATIVE_EMPTY_MARKERS_VERIFIED',fields:fields(payload),documentTimeOrigin:1000000,renderReceiptEpoch:1000150,nativeVerifiedEpoch:1000180,firstPaintEpoch:1000196,secondPaintEpoch:1000212,ordersCreated:false};
      }
      if(func.name==='prepareTradingViewWindowUi')return {status:'READY',reasonCodes:['DATA_WINDOW_OWN_PLOTS_READY']};
      assert.fail('unexpected or order-capable callback '+func.name);
    },
    run(extra={}){return presentReplayAnalysis({record,researchUrl:'https://www.tradingview.com/chart/Research123/',execute:f.execute,isCurrent:()=>current,now:()=>time,...extra});}
  };return f;
}
test('one automatic awaited pipeline renders initial card, delivers strict native payload, restores Data Window and final card',async()=>{
  const f=pipelineFixture(),source=structuredClone(f.record.replayWitness),result=await f.run();
  assert.equal(result.status,'REPLAY_PRESENTATION_RENDERED');assert.equal(result.deliveryMode,'AUTOMATIC_ANALYSIS');
  assert.deepEqual(f.calls.map(call=>call.name),['replayChartOverlayCommand','nativeCandleMarkerUiCommand','nativeCandleMarkerUiCommand','prepareTradingViewWindowUi','replayChartOverlayCommand']);
  const cards=f.calls.filter(call=>call.name==='replayChartOverlayCommand');assert.equal(cards[0].args[0],cards[1].args[0]);assert.equal(cards[0].args[0].replayWitness,f.record.replayWitness);assert.deepEqual(f.record.replayWitness,source,'restoration cannot freshen capture time');
  for(const call of f.calls.filter(call=>call.name==='nativeCandleMarkerUiCommand')){assert.equal(call.args[0].expected.fields,f.record.replayWitness.fields);assert.equal(call.args[0].expected.runEpoch,f.record.replayWitness.runEpoch);}
  assert.equal(result.nativeCandleMarkers.payload.status,'READY');assert.equal(result.nativeCandleMarkers.verification.verified,true);assert.equal(result.restorePreparations.length,1);
  assert.equal(result.timing.sourceToFinalCardLowerMs,140);assert.equal(result.timing.sourceToFinalCardUpperMs,156);assert.equal(result.timing.sourceToNativeReadbackPaintOpportunityMs,112);assert.equal(result.timing.sameSourceDocumentClockVerified,true);assert.equal(result.timing.operatorWaitIncluded,false);assert.equal(result.timing.marketToDisplayMeasured,false);assert.equal(result.timing.physicalDisplayMeasured,false);assert.equal(result.timing.ordersCreated,false);
});
test('valid EMPTY analysis automatically delivers the zero-marker payload and restores the NO_APPROVAL card',async()=>{
  const f=pipelineFixture({empty:true}),result=await f.run();assert.equal(result.status,'REPLAY_PRESENTATION_RENDERED');assert.equal(result.nativeCandleMarkers.payload.status,'EMPTY');assert.equal(result.nativeCandleMarkers.payload.records.length,0);assert.equal(f.calls[1].args[0].action,'deliver');assert.equal(f.calls.at(-1).args[0].decision.status,'NO_APPROVAL');
});
test('native source change or wrong native fields cannot prepare or restore an approval card',async()=>{
  for(const response of [{status:'BLOCKED',reasonCodes:['MARKER_SOURCE_WITNESS_CHANGED']},{status:'NATIVE_MARKERS_VERIFIED',fields:{ARROW_MARKER_SIGNATURE:0}}]){
    const f=pipelineFixture();f.alter=call=>call.name==='nativeCandleMarkerUiCommand'?response:undefined;const result=await f.run();assert.equal(result.status,'BLOCKED');assert.equal(result.finalCardReceipt,null);assert.equal(result.timing.sourceToFinalCardUpperMs,null);assert.equal(f.calls.length,2);assert.equal(f.calls.some(call=>call.name==='prepareTradingViewWindowUi'),false);
  }
});
test('stop or replacement serial during delivery prevents preparation and final restoration',async()=>{
  const f=pipelineFixture();f.alter=call=>{if(call.name==='nativeCandleMarkerUiCommand')f.setCurrent(false);};await assert.rejects(f.run(),/REPLAY_PRESENTATION_CANCELLED/);assert.equal(f.calls.length,2);assert.equal(f.calls.some(call=>call.name==='prepareTradingViewWindowUi'),false);
  const alreadyStopped=pipelineFixture();alreadyStopped.setCurrent(false);await assert.rejects(alreadyStopped.run(),/REPLAY_PRESENTATION_CANCELLED/);assert.equal(alreadyStopped.calls.length,0);
});
test('restoration has at most five guarded own-study preparation actions and never captures replacement OHLC',async()=>{
  const f=pipelineFixture();f.alter=call=>call.name==='prepareTradingViewWindowUi'?{status:'WAITING',reasonCodes:['WINDOW_OWN_PLOTS_MOUNTING']}:undefined;
  const result=await f.run();assert.equal(result.status,'BLOCKED');assert.deepEqual(result.reasonCodes,['REPLAY_DATA_WINDOW_RESTORE_LIMIT']);assert.equal(result.restorePreparations.length,5);assert.equal(result.restoreWitnessChecks.length,5);assert.equal(result.finalCardReceipt,null);assert.equal(f.calls.filter(call=>call.name==='replayChartOverlayCommand').length,1);assert.equal(f.calls.some(call=>call.name==='readTradingViewWindowEvidence'),false);
});
test('witness recheck failure or cancellation during preparation stops restoration without another action',async()=>{
  const changed=pipelineFixture();changed.alter=call=>call.name==='nativeCandleMarkerUiCommand'&&call.args[0].action==='read'?{status:'BLOCKED',reasonCodes:['MARKER_SOURCE_WITNESS_CHANGED']}:undefined;assert.equal((await changed.run()).status,'BLOCKED');assert.equal(changed.calls.length,3);
  const stopped=pipelineFixture();stopped.alter=call=>{if(call.name==='prepareTradingViewWindowUi')stopped.setCurrent(false);};await assert.rejects(stopped.run(),/REPLAY_PRESENTATION_CANCELLED/);assert.equal(stopped.calls.filter(call=>call.name==='replayChartOverlayCommand').length,1);
});
test('an unverified final card or mismatched document clock produces no final latency bound',async()=>{
  const failed=pipelineFixture();let count=0;failed.alter=call=>call.name==='replayChartOverlayCommand'&&++count===2?{status:'REPLAY_WITNESS_CHANGED'}:undefined;const blocked=await failed.run();assert.equal(blocked.status,'BLOCKED');assert.equal(blocked.timing.sourceToFinalCardUpperMs,null);
  const wrongClock=pipelineFixture();let nativeCount=0;wrongClock.alter=call=>{if(call.name==='nativeCandleMarkerUiCommand'&&++nativeCount===1)return {status:'NATIVE_MARKERS_VERIFIED',fields:fields(call.args[0].payload),documentTimeOrigin:999999,renderReceiptEpoch:1000150,nativeVerifiedEpoch:1000180,firstPaintEpoch:1000196,secondPaintEpoch:1000212};};const result=await wrongClock.run();assert.equal(result.status,'REPLAY_PRESENTATION_RENDERED');assert.equal(result.timing.sameSourceDocumentClockVerified,false);assert.equal(result.timing.sourceToFinalCardUpperMs,null);
});
test('manual re-delivery is explicitly separate and cannot masquerade as the automatic pipeline sample',async()=>{
  const f=pipelineFixture(),result=await f.run({deliveryMode:'MANUAL_REDELIVERY'});assert.equal(result.status,'REPLAY_PRESENTATION_RENDERED');assert.equal(result.deliveryMode,'MANUAL_REDELIVERY');assert.equal(result.nativeCandleMarkers.deliveryMode,'MANUAL_REDELIVERY');assert.equal(result.timing.operatorWaitIncluded,true);
});
