import {analyzeGuideSignals,GUIDE_SIGNAL_DEFAULTS,GUIDE_ALL_SCENARIO_CONTEXT} from './guide-signal-engine.mjs';
import {describeGuideAnalysis} from './guide-explanations.mjs';
import {renderGuideAnalysis} from './guide-analysis-view.mjs';
import {selectGuideTechnicalDecision,corroborateGuideTechnicalDecision} from './guide-technical-decision.mjs';
import {readTradingViewWindowEvidence} from './tradingview-window-reader.mjs';
import {replayChartOverlayCommand} from './replay-chart-overlay.mjs';
import {readReplayTradingPublicControls} from './replay-ui-inspection.mjs';
import {buildApprovedCandleMarkerPayload,buildTechnicalCandleMarkerPayload,verifyNativeCandleMarkerFields} from './candle-marker-payload.mjs';
import {nativeCandleMarkerUiCommand} from './candle-marker-ui.mjs';
import {replayTradingUiCommand} from './replay-trading-ui.mjs';
import {prepareTradingViewWindowUi} from './tradingview-window-controls.mjs';
import {createReplayExecutionFlow} from './replay-execution-flow.mjs';
import {createReplayReservationLedger} from './replay-execution-ledger.mjs';

export const REPLAY_SCOPE=Object.freeze({instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',riskBudget:200,maxContracts:1});
export const REPLAY_REQUIRED_FLAGS=Object.freeze(['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand']);
export const REPLAY_EXTENSION_VERSION='0.30.5';
export const REPLAY_IDLE_SOURCE_RECOVERY_LIMIT=3;
const fields=['open','high','low','close'],plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const fail=reason=>{throw Error(reason);};
export function canProbeIdleReplaySourceRecovery({code,stage,automaticEnabled,executionState,sourceRun,consecutive=0}={}){
  return code==='REPLAY_WITNESS_CHANGED'&&stage==='CHART_OVERLAY'&&automaticEnabled===true
    &&typeof sourceRun==='string'&&sourceRun.length>0&&consecutive<REPLAY_IDLE_SOURCE_RECOVERY_LIMIT
    &&executionState?.armed===true&&executionState.locked===false&&executionState.busy===false
    &&executionState.submissionAttempted===false&&executionState.intent===null
    &&['ARMED','BLOCKED'].includes(executionState.state);
}
function validateMetadata(meta,timeframe='1'){
  if(!plain(meta)||meta.source!=='ohlc'||meta.instrument!==REPLAY_SCOPE.instrument||meta.timeframe!==timeframe||meta.timeframeMs!==Number(timeframe)*60000||meta.tickSize!==.25||meta.pointValue!==20||meta.currency!=='USD'||meta.chartType!=='standard'||meta.synthetic===true)fail('NQ_STANDARD_TIMEFRAME_METADATA_REQUIRED');
  if(typeof meta.timezone!=='string'||typeof meta.session!=='string'||!meta.session)fail('HISTORICAL_SESSION_METADATA_REQUIRED');
  try{new Intl.DateTimeFormat('en',{timeZone:meta.timezone});}catch{fail('HISTORICAL_TIMEZONE_INVALID');}
}
function normalizeBars(bars,duration){
  if(!Array.isArray(bars)||!bars.length||bars.length>10000)fail('HISTORICAL_BAR_LIMIT_1_TO_10000');
  return bars.map((bar,index)=>{
    if(!plain(bar)||!Number.isSafeInteger(bar.time)||bar.time<0||!Number.isSafeInteger(bar.closeTime)||bar.closeTime-bar.time!==duration||bar.closed!==true||index&&bar.time!==bars[index-1].closeTime)fail('CLOSED_CONTIGUOUS_HISTORICAL_BARS_REQUIRED');
    if(fields.some(key=>!Number.isFinite(bar[key])||Math.abs(bar[key]/.25-Math.round(bar[key]/.25))>1e-8)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low)fail('HISTORICAL_OHLC_INVALID');
    if(bar.volume!==undefined&&bar.volume!==null&&(!Number.isFinite(bar.volume)||bar.volume<0))fail('HISTORICAL_VOLUME_INVALID');
    return {time:bar.time,closeTime:bar.closeTime,...Object.fromEntries(fields.map(key=>[key,bar[key]])),...(bar.volume===undefined?{}:{volume:bar.volume}),closed:true,knownAt:bar.closeTime,chartType:'standard'};
  });
}
export function normalizeReplayDataset(value){
  if(!plain(value))fail('HISTORICAL_JSON_OBJECT_REQUIRED');validateMetadata(value.metadata);
  if(!plain(value.higherTimeframes)||Object.keys(value.higherTimeframes).length!==2||!value.higherTimeframes['5']||!value.higherTimeframes['15'])fail('BOTH_5_AND_15_MINUTE_SERIES_REQUIRED');
  const metadata={...copy(value.metadata),replay:true,realtime:false,synthetic:false},bars=normalizeBars(value.bars,60000),higherTimeframes={};
  for(const timeframe of ['5','15']){
    const entry=value.higherTimeframes[timeframe];validateMetadata(entry?.metadata,timeframe);
    if(entry.timeframe!==timeframe||entry.timeframeMs!==Number(timeframe)*60000||entry.instrument!==undefined&&entry.instrument!==metadata.instrument||['timezone','session'].some(key=>entry.metadata[key]!==metadata[key]))fail('HISTORICAL_HIGHER_IDENTITY_MISMATCH');
    higherTimeframes[timeframe]={timeframe,timeframeMs:Number(timeframe)*60000,instrument:metadata.instrument,metadata:{...copy(entry.metadata),replay:true,realtime:false,synthetic:false},bars:normalizeBars(entry.bars,Number(timeframe)*60000)};
  }
  return {kind:'NATIVE_HISTORICAL_REPLAY_DATASET',metadata,bars,higherTimeframes,provenance:copy(value.provenance??null),availabilityAssumption:'Historical CSV bar becomes known at its recorded closeTime. This is a research assumption, not a recorded live availability timestamp.',liveEligible:false,orderEligible:false};
}
export function buildReplayAnalysisInput(dataset,evidence,{commissionPerContract=3.10,slippageTicks=2,userManagedRisk=false}={}){
  if(typeof userManagedRisk!=='boolean')fail('EXPLICIT_REPLAY_RISK_POLICY_REQUIRED');
  const witness=evidence?.replayWitness,chart=evidence?.chart;
  const selection=chart?.researchSelection,labels=chart?.chartLabels,multi=userManagedRisk===true&&chart?.visibleCharts>=2&&chart.visibleCharts<=3&&selection?.kind==='UNIQUE_ACTIVE_RESEARCH_NQ_1M'&&selection.researchLayoutVerified===true&&selection.visibleCharts===chart.visibleCharts&&selection.targetCharts===1&&selection.interval==='1'&&selection.selectedChartLabel==='Chart for CME_MINI:NQ1!, 1 minute'&&Array.isArray(labels)&&labels.length===chart.visibleCharts&&labels.every(label=>/^Chart for CME_MINI:NQ1!, /.test(label))&&labels.filter(label=>label===selection.selectedChartLabel).length===1;
  if(chart?.replay!==true||chart.visibleCharts!==1&&!multi||chart.documentVisible!==true||chart.symbols?.length!==1||chart.symbols[0]!==REPLAY_SCOPE.instrument||chart.interval!=='1')fail('EXPLICIT_SINGLE_NQ_1M_REPLAY_REQUIRED');
  if(evidence.contextOnly!==true||evidence.liveEligible!==false||evidence.messages?.length!==0)fail('REPLAY_SOURCE_NOT_READY');
  if(witness?.kind!=='TRADINGVIEW_REPLAY_WINDOW_WITNESS'||witness.mode!=='REPLAY'||witness.replay!==true||witness.liveEligible!==false||witness.checksumsVerified!==true)fail('COHERENT_REPLAY_WITNESS_REQUIRED');validateMetadata(witness.metadata);
  for(const key of ['timezone','session'])if(witness.metadata[key]!==dataset.metadata[key])fail('REPLAY_DATASET_SESSION_MISMATCH');
  const current=witness.current,previous=witness.previous;
  if(!Number.isSafeInteger(current?.time)||!Number.isSafeInteger(current.closeTime)||current.closeTime-current.time!==60000||witness.currentTime!==current.time||witness.currentCloseTime!==current.closeTime)fail('REPLAY_CURRENT_CURSOR_INVALID');
  if(typeof current.closed!=='boolean'||typeof current.sourceClosed!=='boolean'||current.closed!==current.sourceClosed)fail('REPLAY_CURRENT_FINALITY_INVALID');
  const currentFinal=current.closed===true&&current.sourceClosed===true,closed=currentFinal?current:previous,closedRole=currentFinal?'current':'previous';
  if(closed?.closed!==true||closed.sourceClosed!==true||!Number.isSafeInteger(closed.time)||!Number.isSafeInteger(closed.closeTime)||closed.closeTime-closed.time!==60000)fail('REPLAY_SOURCE_CLOSED_BAR_REQUIRED');
  // Paused Replay can expose an unfinished CURRENT row. Only its contiguous,
  // provider-final PREVIOUS row may define the historical decision cutoff.
  if(!currentFinal&&closed.closeTime!==current.time)fail('REPLAY_PREVIOUS_BAR_NOT_CONTIGUOUS');
  const imported=dataset.bars.find(bar=>bar.time===closed.time);
  if(!imported||imported.closeTime!==closed.closeTime||fields.some(key=>imported[key]!==closed[key]))fail('REPLAY_IMPORTED_CLOSED_OHLC_MISMATCH');
  const importedPrevious=currentFinal&&previous&&dataset.bars.find(bar=>bar.time===previous.time);
  if(importedPrevious&&(previous.closed!==true||previous.sourceClosed!==true||importedPrevious.closeTime!==previous.closeTime||fields.some(key=>importedPrevious[key]!==previous[key])))fail('REPLAY_IMPORTED_PREVIOUS_OHLC_MISMATCH');
  if(!userManagedRisk&&![commissionPerContract,slippageTicks].every(value=>Number.isFinite(value)&&value>=0&&value<=100000))fail('EXPLICIT_NONNEGATIVE_RESEARCH_COSTS_REQUIRED');
  const asOfTime=closed.closeTime,eligibleBase=dataset.bars.filter(bar=>bar.closeTime<=asOfTime),bars=eligibleBase.slice(-600).map(copy),higherTimeframes=Object.fromEntries(['5','15'].map(timeframe=>[timeframe,{...copy(dataset.higherTimeframes[timeframe]),bars:dataset.higherTimeframes[timeframe].bars.filter(bar=>bar.closeTime<=asOfTime).slice(-600).map(copy)}]));
  const config={...GUIDE_SIGNAL_DEFAULTS,...Object.fromEntries(REPLAY_REQUIRED_FLAGS.map(key=>[key,true])),requireRisk:!userManagedRisk,...(userManagedRisk?{strategyPolicy:'guide_scenarios_v1'}:{})},risk=userManagedRisk?null:{riskBudget:200,maxContracts:1,pointValue:20,commissionPerContract,slippageTicks,rewardRisk:2};
  return {bars,options:{metadata:copy(dataset.metadata),higherTimeframes,config,contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT,supplyDemandEnabled:true},risk,asOfTime},cutoff:{asOfTime,observedCurrentTime:current.time,observedCurrentCloseTime:current.closeTime,observedCurrentProviderFinal:currentFinal,selectedClosedBarRole:closedRole,matchedClosedBarTime:closed.time,matchedClosedBarCloseTime:closed.closeTime,openCurrentExcluded:!currentFinal,exactTimeAndOhlcMatch:true,additionalPreviousWitnessMatched:!!importedPrevious,excludedFutureBaseBars:dataset.bars.length-eligibleBase.length,excludedOlderBaseBars:Math.max(0,eligibleBase.length-bars.length),excludedFutureHigherBars:Object.fromEntries(['5','15'].map(tf=>[tf,dataset.higherTimeframes[tf].bars.filter(bar=>bar.closeTime>asOfTime).length]))},availabilityAssumption:dataset.availabilityAssumption,mode:'REPLAY',liveEligible:false,orderEligible:false};
}
export function selectReplayDecision(analysis,asOfTime){
  const requiredChecks=['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME'];
  const technicalDecision=selectGuideTechnicalDecision({analysis,asOfTime});
  const confirmed=(analysis.signals??[]).filter(signal=>signal.status==='CONFIRMED'&&signal.confirmationBarCloseTime===asOfTime&&signal.confirmedAt===asOfTime&&signal.riskPlan?.status==='PLANNED'&&signal.riskPlan.quantity===1&&signal.riskPlan.totalPlannedRisk>0&&signal.riskPlan.totalPlannedRisk<=200&&signal.parameterSnapshot?.risk?.riskBudget===200&&signal.parameterSnapshot?.risk?.maxContracts===1&&signal.parameterSnapshot?.risk?.pointValue===20&&REPLAY_REQUIRED_FLAGS.every(key=>signal.parameterSnapshot?.config?.[key]===true)&&requiredChecks.every(id=>{const checks=(signal.contextSnapshot?.checks??[]).filter(check=>check.id===id);return checks.length===1&&checks[0].required===true&&checks[0].enabled===true&&checks[0].available===true&&checks[0].passed===true&&checks[0].state==='PASS';})&&corroborateGuideTechnicalDecision(technicalDecision,signal).passed);
  const pending=(analysis.events??[]).filter(event=>event.status==='ARMED'&&event.detectedAt<=asOfTime);
  return {status:confirmed.length?'CONFIRMED':pending.length?'PENDING':'NO_APPROVAL',asOfTime,currentChecks:copy(analysis.currentChecks??null),technicalDecision,signal:confirmed[0]?copy(confirmed[0]):null,confirmedAtCurrentClose:confirmed.length,pending:pending.length,mode:'REPLAY',liveEligible:false,orderEligible:false,execution:'REPLAY_RESEARCH_ONLY'};
}
export function readReplayChartGate({allowResearchMultiChart=false}={}){
  const visible=node=>{const box=node?.getBoundingClientRect?.(),style=node&&getComputedStyle(node);return box?.width>0&&box.height>0&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);};
  const canvases=Array.from(document.querySelectorAll('canvas[aria-label^="Chart for "]')).filter(visible),symbols=canvases.map(node=>/^Chart for (.+), [^,]+$/.exec(node.getAttribute('aria-label')??'')?.[1]),interval=document.querySelector('#header-toolbar-intervals [aria-checked="true"]')?.getAttribute('data-value'),replay=document.querySelector('#header-toolbar-replay'),replayValue=replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked');
  const locationValid=location.protocol==='https:'&&(location.hostname==='tradingview.com'||location.hostname.endsWith('.tradingview.com'))&&location.pathname.startsWith('/chart/'),documentVisible=document.visibilityState==='visible'&&document.hidden!==true,reasonCodes=[];
  const researchLayout=document.querySelector('button[aria-label*="Active layout: Arrow "]'),researchMultiChart=allowResearchMultiChart===true&&canvases.length>=2&&canvases.length<=3&&researchLayout&&visible(researchLayout)&&symbols.every(symbol=>symbol==='CME_MINI:NQ1!')&&canvases.filter(node=>node.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length===1&&interval==='1'&&replayValue==='true';
  if(typeof allowResearchMultiChart!=='boolean')reasonCodes.push('EXPLICIT_RESEARCH_CHART_POLICY_REQUIRED');
  if(!locationValid)reasonCodes.push('TRADINGVIEW_CHART_REQUIRED');if(!documentVisible)reasonCodes.push('SOURCE_DOCUMENT_HIDDEN');if(canvases.length!==1&&!researchMultiChart)reasonCodes.push('SINGLE_VISIBLE_CHART_REQUIRED');if((!researchMultiChart&&symbols.length!==1)||symbols.some(symbol=>symbol!=='CME_MINI:NQ1!'))reasonCodes.push('EXACT_NQ_SOURCE_REQUIRED');if(interval!=='1')reasonCodes.push('ONE_MINUTE_SOURCE_REQUIRED');if(replayValue!=='true')reasonCodes.push('REPLAY_MUST_BE_ACTIVE');
  return {ok:reasonCodes.length===0,reasonCodes,locationValid,documentVisible,replay:replayValue==='true',replayAttribute:replayValue??null,symbols:researchMultiChart?['CME_MINI:NQ1!']:symbols,interval:interval??null,visibleCharts:canvases.length,mode:'REPLAY',liveEligible:false,...(researchMultiChart?{researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:canvases.length,targetCharts:1,selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',interval:'1',researchLayoutVerified:true}}:{})};
}

// Bounded public chart diagnostics only. Never export page text, titles, URLs,
// raw DOM, account data or the browser's unrestricted error message here.
export function describeReplayReadDiagnostics({stage,sourceTabId,gate,evidence,error}={}){
  const code=value=>typeof value==='string'&&/^[A-Z0-9_:-]{1,120}$/.test(value)?value:null;
  const symbols=value=>Array.isArray(value)?value.slice(0,4).map(item=>typeof item==='string'&&/^[A-Z0-9_!:./-]{1,100}$/.test(item)?item:'UNRECOGNIZED_PUBLIC_SYMBOL'):[];
  const chart=value=>value?{symbols:symbols(value.symbols),interval:typeof value.interval==='string'&&/^[0-9A-Z]{1,12}$/.test(value.interval)?value.interval:null,visibleCharts:Number.isSafeInteger(value.visibleCharts)?value.visibleCharts:null,documentVisible:typeof value.documentVisible==='boolean'?value.documentVisible:null,replay:typeof value.replay==='boolean'?value.replay:null}:null;
  const reasons=value=>Array.isArray(value)?value.slice(0,12).map(code).filter(Boolean):[];
  return {kind:'BOUNDED_PUBLIC_REPLAY_READ_DIAGNOSTICS',stage:['CHART_GATE','SOURCE_READER','INPUT_VALIDATION','ANALYSIS','CHART_OVERLAY'].includes(stage)?stage:'UNKNOWN',sourceTabId:Number.isSafeInteger(sourceTabId)?sourceTabId:null,mode:'REPLAY',liveEligible:false,orderEligible:false,errorCode:code(error?.message??error)??'REPLAY_OPERATION_FAILED',gate:gate?{...chart(gate),ok:gate.ok===true,locationValid:gate.locationValid===true,reasonCodes:reasons(gate.reasonCodes)}:null,reader:evidence?{status:code(evidence.status),reasonCodes:reasons(evidence.reasonCodes),chart:chart(evidence.chart),contextOnly:evidence.contextOnly===true,liveEligible:evidence.liveEligible===true,messagesCount:Array.isArray(evidence.messages)?evidence.messages.length:null,hasCoherentReplayWitness:evidence.replayWitness?.kind==='TRADINGVIEW_REPLAY_WINDOW_WITNESS'&&evidence.replayWitness.checksumsVerified===true}:null};
}

// The automatic presentation is one awaited operation. Every chart mutation
// keeps the original OHLC witness; preparing its public Data Window never
// creates a newer capture timestamp or turns historical research into LIVE.
export async function presentReplayAnalysis({record,researchUrl,execute,isCurrent=()=>true,now=()=>performance.now(),deliveryMode='AUTOMATIC_ANALYSIS'}={}){
  if(typeof execute!=='function'||typeof isCurrent!=='function'||!['AUTOMATIC_ANALYSIS','MANUAL_REDELIVERY'].includes(deliveryMode))fail('INVALID_REPLAY_PRESENTATION_REQUEST');
  const witness=record?.replayWitness,sessionId=record?.sessionId;
  if(!witness||typeof sessionId!=='string'||!sessionId)fail('REPLAY_PRESENTATION_WITNESS_REQUIRED');
  const started=now(),result={kind:'REPLAY_PRESENTATION_PIPELINE',deliveryMode,status:'PENDING',initialCardReceipt:null,nativeCandleMarkers:null,restoreWitnessChecks:[],restorePreparations:[],finalCardReceipt:null,reasonCodes:[],timing:{pipelineOperationMs:null,initialCardRoundTripMs:null,nativeMarkerRoundTripMs:null,restoreRoundTripMs:null,finalCardRoundTripMs:null,sourceToFinalCardLowerMs:null,sourceToFinalCardUpperMs:null,sourceToNativeReadbackPaintOpportunityMs:null,sameSourceDocumentClockVerified:false,operatorWaitIncluded:deliveryMode==='MANUAL_REDELIVERY',marketToDisplayMeasured:false,physicalDisplayMeasured:false,ordersCreated:false}};
  const lease=()=>{if(!isCurrent())fail('REPLAY_PRESENTATION_CANCELLED');};
  const run=async(func,args)=>{lease();const response=await execute(func,args);lease();return response??null;};
  const blocked=reason=>{result.status='BLOCKED';result.reasonCodes=Array.isArray(reason)?reason:[reason];result.timing.pipelineOperationMs=now()-started;return result;};
  const allowResearchMultiChart=record.executionPolicy==='USER_PRESET_MARKET'&&record.chart?.researchSelection?.kind==='UNIQUE_ACTIVE_RESEARCH_NQ_1M';
  const chartPolicy=allowResearchMultiChart?{allowResearchMultiChart:true,expectedResearchUrl:researchUrl}:{};
  const cardCommand={action:'show',sessionId,expectedInstrument:REPLAY_SCOPE.instrument,expectedTimeframe:'1',replayWitness:witness,decision:record.decision,testOnly:false,...chartPolicy};
  const expected={researchUrl,instrument:REPLAY_SCOPE.instrument,timeframe:'1',sourceMode:'REPLAY',runEpoch:witness.runEpoch,fields:witness.fields,...chartPolicy};
  lease();const markerBuilder=record.executionPolicy==='USER_PRESET_MARKET'?buildTechnicalCandleMarkerPayload:buildApprovedCandleMarkerPayload;
  const payload=markerBuilder({analysis:record.analysis,bars:record.analysisInputs?.bars,metadata:record.analysisInputs?.options?.metadata,sourceMode:'REPLAY',asOfTime:record.cutoff?.asOfTime});
  result.nativeCandleMarkers={payload,receipt:null,verification:null,deliveryMode};
  if(payload.status==='BLOCKED')return blocked(payload.reasonCodes);
  let step=now();result.initialCardReceipt=await run(replayChartOverlayCommand,[cardCommand]);result.timing.initialCardRoundTripMs=now()-step;
  if(result.initialCardReceipt?.status!=='RENDERED')return blocked(result.initialCardReceipt?.status??'INITIAL_REPLAY_CARD_UNVERIFIED');
  step=now();const receipt=await run(nativeCandleMarkerUiCommand,[{action:'deliver',expected,payload}]);result.timing.nativeMarkerRoundTripMs=now()-step;
  const verification=verifyNativeCandleMarkerFields(payload,receipt?.fields);Object.assign(result.nativeCandleMarkers,{receipt,verification});
  if(!['NATIVE_MARKERS_VERIFIED','NATIVE_EMPTY_MARKERS_VERIFIED'].includes(receipt?.status)||!verification.verified)return blocked(receipt?.reasonCodes?.length?receipt.reasonCodes:verification.reasonCodes?.length?verification.reasonCodes:['NATIVE_MARKER_DELIVERY_UNVERIFIED']);
  step=now();let prepared=false;
  for(let attempt=0;attempt<5;attempt++){
    // This read validates the SAME source fields before each bounded public
    // preparation; it does not read a new OHLC capture or freshen the witness.
    const check=await run(nativeCandleMarkerUiCommand,[{action:'read',expected,payload}]);result.restoreWitnessChecks.push(check);
    if(!['NATIVE_MARKERS_VERIFIED','NATIVE_EMPTY_MARKERS_VERIFIED'].includes(check?.status)||!verifyNativeCandleMarkerFields(payload,check?.fields).verified)return blocked(check?.reasonCodes?.length?check.reasonCodes:['REPLAY_RESTORE_WITNESS_UNVERIFIED']);
    const preparation=await run(prepareTradingViewWindowUi,allowResearchMultiChart?[chartPolicy]:[]);result.restorePreparations.push(preparation);
    if(preparation?.status==='READY'){prepared=true;break;}
    if(!['ACTION_TAKEN','WAITING'].includes(preparation?.status))return blocked(preparation?.reasonCodes?.length?preparation.reasonCodes:['REPLAY_DATA_WINDOW_RESTORE_BLOCKED']);
  }
  result.timing.restoreRoundTripMs=now()-step;
  if(!prepared)return blocked('REPLAY_DATA_WINDOW_RESTORE_LIMIT');
  step=now();result.finalCardReceipt=await run(replayChartOverlayCommand,[cardCommand]);result.timing.finalCardRoundTripMs=now()-step;result.timing.pipelineOperationMs=now()-started;
  if(result.finalCardReceipt?.status!=='RENDERED')return blocked(result.finalCardReceipt?.status??'FINAL_REPLAY_CARD_UNVERIFIED');
  const initial=result.initialCardReceipt,final=result.finalCardReceipt,source=witness.sourceObservedEpochMs,origin=witness.sourceDocumentTimeOrigin;
  const epochs=[source,initial.renderReceiptEpoch,initial.mutationEpoch,initial.firstPaintEpoch,initial.secondPaintEpoch,receipt.renderReceiptEpoch,receipt.nativeVerifiedEpoch,receipt.firstPaintEpoch,receipt.secondPaintEpoch,final.renderReceiptEpoch,final.mutationEpoch,final.firstPaintEpoch,final.secondPaintEpoch];
  const sameClock=Number.isFinite(origin)&&Number.isFinite(source)&&source>=origin&&initial.sourceObservedEpochMs===source&&final.sourceObservedEpochMs===source&&[initial,receipt,final].every(item=>item.documentTimeOrigin===origin)&&epochs.every(Number.isFinite)&&epochs.every((value,index)=>index===0||value>=epochs[index-1]);
  if(sameClock){result.timing.sameSourceDocumentClockVerified=true;result.timing.sourceToFinalCardLowerMs=final.firstPaintEpoch-source;result.timing.sourceToFinalCardUpperMs=final.secondPaintEpoch-source;result.timing.sourceToNativeReadbackPaintOpportunityMs=receipt.secondPaintEpoch-source;result.nativeCandleMarkers.sourceToNativeReadbackPaintOpportunityMs=receipt.secondPaintEpoch-source;}
  result.status='REPLAY_PRESENTATION_RENDERED';return result;
}

if(typeof document!=='undefined'&&document.getElementById('replay-research-root'))initializeReplayResearchPage();
function initializeReplayResearchPage(){
  const $=id=>document.getElementById(id),extension=!!globalThis.chrome?.scripting;let dataset=null,inputFile=null,session=null,serial=0,entrySerial=0,busy=false,latest=null,lastFailure=null,journal=[],uiInspection=null,replayTradingRead=null,replayTestDraft=null;
  let executionCandidate=null,executionSourceKey=null,autoEnabled=false,watchTimer=null,replayTestInspection=null,replayTestCancellation=null,replayTestProtection=null,sourceRecoveryEpisodes=[];
  const sourceKey=w=>JSON.stringify([w?.runId,w?.sequence,w?.currentTime,w?.currentCloseTime,w?.current?.closed,w?.current?.close,w?.fields]);
  const status=(text,state='')=>{$('replay-status').textContent=text;$('replay-status').dataset.state=state;};
  const lock=()=>{const state=executionFlow.snapshot();$('inspect-replay-test-protection').disabled=!extension||busy||autoEnabled||state.submissionAttempted;for(const id of ['replay-tab','replay-file','replay-fee','replay-slippage','refresh-replay-tabs'])$(id).disabled=!!session||busy;$('start-replay').disabled=!extension||!dataset||!!session||busy;$('analyze-replay').disabled=!session||busy;$('stop-replay').disabled=!session;$('export-replay').disabled=busy||!latest&&!journal.length&&!lastFailure&&!uiInspection&&!replayTestDraft&&!state.journal.length;$('inspect-replay-ui').disabled=!extension||busy;$('inspect-replay-inventory').disabled=!extension||busy;$('deliver-replay-markers').disabled=!extension||busy||!latest;$('prepare-replay-test').disabled=!extension||busy||autoEnabled||state.submissionAttempted;$('inspect-replay-test-parent').disabled=!extension||busy||autoEnabled||state.submissionAttempted||replayTestDraft?.result?.status!=='TICKET_PREPARED_TEST';$('cancel-replay-test-parent').disabled=!extension||busy||autoEnabled||state.submissionAttempted||!replayTestInspection?.parentOrderId;$('arm-replay-execution').disabled=!extension||!session||busy||autoEnabled||state.locked;$('disarm-replay-execution').disabled=!extension||!session||!autoEnabled&&!state.submissionAttempted;$('reconcile-replay-execution').disabled=!extension||!session||busy||!state.submissionAttempted;};
  const native=async command=>(await chrome.scripting.executeScript({target:{tabId:command.expected.sourceTabId},func:replayTradingUiCommand,args:[command],world:'ISOLATED'}))[0]?.result??null;
  const executionFlow=createReplayExecutionFlow({
    getContext:()=>({active:!!session,generation:serial,target:session?.target??null}),
    readSource:async({expected,reason})=>{
      const active=session,token=serial;if(!active||active.tabId!==expected.sourceTabId||active.target?.researchUrl!==expected.researchUrl)fail('REPLAY_ACTIVE_PINNED_RESEARCH_TARGET_REQUIRED');
      if(reason==='ENTRY'){
        if(!executionCandidate||executionCandidate.sourceTabId!==active.tabId||executionCandidate.sessionId!==active.id)fail('REPLAY_CURRENT_ANALYSIS_BUNDLE_REQUIRED');
        return executionCandidate;
      }
      let evidence;
      for(let attempt=0;attempt<5;attempt++){
        evidence=(await chrome.scripting.executeScript({target:{tabId:active.tabId},func:readTradingViewWindowEvidence,args:[{sessionId:active.id}],world:'ISOLATED'}))[0]?.result;
        if(session!==active||serial!==token)fail('REPLAY_LIFECYCLE_CONTEXT_CHANGED');
        if(evidence?.replayWitness)break;
        if(!(evidence?.reasonCodes??[]).some(code=>['WINDOW_STUDY_NOT_VISIBLE','WINDOW_FIELDS_NOT_MOUNTED','DATA_WINDOW_NOT_SELECTED','WINDOW_STUDY_NOT_FOUND'].includes(code)))break;
        await chrome.scripting.executeScript({target:{tabId:active.tabId},func:prepareTradingViewWindowUi,args:[],world:'ISOLATED'});
      }
      if(!evidence?.replayWitness||evidence.chart?.replay!==true||evidence.chart?.visibleCharts!==1)fail('REPLAY_COHERENT_LIFECYCLE_SOURCE_REQUIRED');
      return {replayWitness:evidence.replayWitness};
    },
    preflight:command=>native({action:'preflight',...command}),
    executeApproved:async(command,{isCurrent})=>{if(!isCurrent())return {status:'BLOCKED',submitted:false,reasonCodes:['REPLAY_ENTRY_CONTEXT_CHANGED']};return native({action:'execute_approved',...command});},
    verifyResult:command=>native({action:'verify',...command}),
    cancelOwn:command=>native({action:'cancel_own',...command}),
    disarmDriver:command=>native({action:'disarm',...command}),
    reserve:createReplayReservationLedger({storage:globalThis.chrome?.storage?.local,locks:globalThis.navigator?.locks}),
    onChange:renderExecution
  });
  function renderExecution(state){
    autoEnabled=state.armed===true;
    const labels={DISARMED:'כניסה אוטומטית כבויה.',ARMED:'כניסה אוטומטית ב־Replay פעילה; ממתין לאישור מלא בנר סגור.',PREFLIGHT:'בודק ציטוט, מצב פקודות ותוכנית סיכון לפני כניסה.',SUBMITTING:'ניסיון שיגור יחיד של Limit ממתין בסימולטור.',WORKING:'אומתה פקודת Limit ממתינה עם סטופ ויעד; טרם אומת מילוי.',FILLED_PROTECTED:'אומתה פוזיציה של חוזה אחד עם סטופ ויעד התואמים לתוכנית.',CANCELLING:'מבטל את פקודת הכניסה הממתינה של הבוט.',CANCELLED:'פקודת הבוט בוטלה ואומת מצב NQ ריק.',BLOCKED:'הכניסה נחסמה: תנאי ביצוע או מקור נתונים לא אומתו.',UNKNOWNLOCK:'מצב הביצוע אינו מאומת. כניסות נוספות נעצרו עד בדיקה.'};
    $('replay-execution-status').textContent=labels[state.state]??'מצב הביצוע דורש בדיקה.';
    const t=state.timing??{},parts=[];
    if(Number.isFinite(t.sourceToRegisteredVerificationMs))parts.push(`מקור → אימות פקודה ממתינה: ${t.sourceToRegisteredVerificationMs.toFixed(1)} ms`);
    if(Number.isFinite(t.sourceToProtectedVerificationMs))parts.push(`מקור → אימות מילוי והגנות: ${t.sourceToProtectedVerificationMs.toFixed(1)} ms`);
    $('replay-execution-timing').textContent=parts.length?parts.join(' · ')+'. מדידת בדיקת Replay כוללת המתנה להתקדמות Replay; אינה זמן בורסה או הבטחת הפסד מרבי.':'עדיין אין מדידה מאומתת של איתות מאושר עד מילוי מוגן.';
    $('replay-execution-evidence').textContent=JSON.stringify(state,null,2);
    if(!autoEnabled&&watchTimer!==null){clearTimeout(watchTimer);watchTimer=null;}
    lock();
  }
  function scheduleWatch(){
    if(watchTimer!==null)clearTimeout(watchTimer);watchTimer=null;
    if(!autoEnabled||!session)return;
    watchTimer=setTimeout(()=>{watchTimer=null;void analyze({automatic:true}).finally(scheduleWatch);},500);
  }
  function recoveryEpisode(active,evidence){
    if(active.recoveryEpisode)return active.recoveryEpisode;
    const witness=evidence?.replayWitness;
    const episode={kind:'IDLE_REPLAY_SOURCE_RECOVERY_EPISODE',sessionId:active.id,sourceTabId:active.tabId,sourceRun:active.sourceRun,
      status:'PENDING',startedAt:Date.now(),firstWitness:copy(witness??null),attempts:[],maximumConsecutiveRecoveries:REPLAY_IDLE_SOURCE_RECOVERY_LIMIT,
      requestedRetryDelayMs:500,ordersAttempted:false,marketLatencyMeasured:false,physicalDisplayMeasured:false};
    active.recoveryEpisode=episode;sourceRecoveryEpisodes.push(episode);if(sourceRecoveryEpisodes.length>10)sourceRecoveryEpisodes.shift();return episode;
  }
  async function recoverIdleSourceRace({error,stage,active,requestSerial,evidence,presentation,readStarted,analysisMs}){
    const eligible=()=>session===active&&serial===requestSerial&&canProbeIdleReplaySourceRecovery({code:error?.message,stage,automaticEnabled:autoEnabled,executionState:executionFlow.snapshot(),sourceRun:active.sourceRun,consecutive:active.idleSourceRecoveries??0});
    if(!eligible()){
      if(active.recoveryEpisode){const state=executionFlow.snapshot();active.recoveryEpisode.status='STOPPED_RECOVERY_LIMIT_OR_UNSAFE_CONTEXT';active.recoveryEpisode.ordersAttempted=state.submissionAttempted;active.recoveryEpisode.eventReservationConsumed=state.intent!==null;active.recoveryEpisode.terminalFailure={code:String(error?.message??'UNKNOWN').slice(0,120),failedWitness:copy(evidence?.replayWitness??null),observedAt:Date.now(),consecutive:active.idleSourceRecoveries??0};}
      return {recovered:false,reason:'REPLAY_IDLE_SOURCE_RECOVERY_NOT_ELIGIBLE'};
    }
    const episode=recoveryEpisode(active,evidence),attempt={failureCode:'REPLAY_WITNESS_CHANGED',failedWitness:copy(evidence.replayWitness),failureObservedAt:Date.now(),failedAnalysisMs:analysisMs,failedReceiverElapsedMs:performance.now()-readStarted,presentationTiming:copy(presentation?.timing??null),freshProbe:null};
    episode.attempts.push(attempt);
    executionCandidate=null;executionSourceKey=null;latest=null;
    $('replay-decision').textContent='REPLAY · המקור התקדם; בודק מקור חדש, ללא אישור כניסה';$('replay-cutoff').textContent='';$('replay-timing').textContent='';$('replay-explanation').replaceChildren();
    try{
      await clearOverlay(active);if(!eligible())fail('REPLAY_RECOVERY_CONTEXT_CHANGED');
      const target=active.target;if(target?.sourceTabId!==active.tabId||target.instrument!==REPLAY_SCOPE.instrument||target.timeframe!=='1')fail('REPLAY_RECOVERY_PINNED_TARGET_REQUIRED');
      const tab=await chrome.tabs.get(active.tabId);if(!eligible())fail('REPLAY_RECOVERY_CONTEXT_CHANGED');
      if(tab.id!==active.tabId||tab.url!==target.researchUrl)fail('REPLAY_RECOVERY_RESEARCH_URL_CHANGED');
      const gate=(await chrome.scripting.executeScript({target:{tabId:active.tabId},func:readReplayChartGate,args:[],world:'ISOLATED'}))[0]?.result;
      if(!eligible())fail('REPLAY_RECOVERY_CONTEXT_CHANGED');
      if(gate?.ok!==true||gate.replay!==true||gate.documentVisible!==true||gate.visibleCharts!==1||gate.interval!=='1'||gate.symbols?.length!==1||gate.symbols[0]!==REPLAY_SCOPE.instrument)fail('REPLAY_RECOVERY_CHART_GATE_REJECTED');
      const fresh=(await chrome.scripting.executeScript({target:{tabId:active.tabId},func:readTradingViewWindowEvidence,args:[{sessionId:active.id}],world:'ISOLATED'}))[0]?.result;
      if(!eligible())fail('REPLAY_RECOVERY_CONTEXT_CHANGED');
      const witness=fresh?.replayWitness,at=Date.now();
      if(witness?.runId!==active.sourceRun)fail('REPLAY_SOURCE_RUN_CHANGED');
      if(!Number.isSafeInteger(witness.observedAt)||witness.observedAt>at||at-witness.observedAt>2000)fail('REPLAY_RECOVERY_FRESH_WITNESS_REQUIRED');
      const input=buildReplayAnalysisInput(dataset,fresh,active.costs);
      attempt.freshProbe={witness:copy(witness),cutoff:copy(input.cutoff),chart:copy(gate),samePinnedUrlAndTab:true,coherentSameRun:true};
      if(!eligible())fail('REPLAY_RECOVERY_CONTEXT_CHANGED');
      active.idleSourceRecoveries=(active.idleSourceRecoveries??0)+1;episode.status='WAITING_FOR_FRESH_FULL_ANALYSIS';attempt.retryNumber=active.idleSourceRecoveries;
      lastFailure={observedAt:new Date().toISOString(),diagnostics:describeReplayReadDiagnostics({stage,sourceTabId:active.tabId,evidence,error}),presentation,recovery:{status:episode.status,retryNumber:active.idleSourceRecoveries,maximum:REPLAY_IDLE_SOURCE_RECOVERY_LIMIT,sourceRun:active.sourceRun,ordersAttempted:false}};
      $('replay-decision').textContent='REPLAY · המקור התקדם; ממתין לניתוח חדש, ללא אישור כניסה';$('replay-cutoff').textContent='';$('replay-timing').textContent='';$('replay-explanation').replaceChildren();
      $('replay-marker-status').textContent='הכרטיס הקודם הוסר. ממתין לקריאת מקור חדשה וניתוח מלא; אין אישור תצוגה לנר החדש.';
      $('replay-evidence').textContent=JSON.stringify({failure:lastFailure,sourceRecoveryEpisode:episode},null,2);
      status('המקור התקדם במהלך הצגת הכרטיס. כניסה נשארת דרוכה ללא ניסיון פקודה; ניתוח מלא חדש בעוד 500ms.','waiting');scheduleWatch();return {recovered:true};
    }catch(probeError){episode.status='STOPPED_UNVERIFIED';attempt.probeFailure=String(probeError?.message??'REPLAY_RECOVERY_PROBE_FAILED').slice(0,160);return {recovered:false,reason:attempt.probeFailure};}
  }
  function finishRecoveryEpisode(active,presentation,witness){
    const episode=active.recoveryEpisode;if(!episode||episode.status!=='WAITING_FOR_FRESH_FULL_ANALYSIS'||episode.sourceRun!==active.sourceRun)return null;
    const first=episode.firstWitness,final=presentation.finalCardReceipt,origin=first?.sourceDocumentTimeOrigin,source=first?.sourceObservedEpochMs;
    const sourceEpochs=[source,...episode.attempts.flatMap(attempt=>[attempt.failedWitness?.sourceObservedEpochMs,attempt.freshProbe?.witness?.sourceObservedEpochMs]),witness.sourceObservedEpochMs,final?.firstPaintEpoch,final?.secondPaintEpoch];
    const sameClock=Number.isFinite(origin)&&Number.isFinite(source)&&source>=origin&&witness.sourceDocumentTimeOrigin===origin&&final?.documentTimeOrigin===origin
      &&Number.isFinite(final.firstPaintEpoch)&&Number.isFinite(final.secondPaintEpoch)&&final.firstPaintEpoch>=source&&final.secondPaintEpoch>=final.firstPaintEpoch
      &&sourceEpochs.every((value,index)=>Number.isFinite(value)&&(!index||value>=sourceEpochs[index-1]))
      &&episode.attempts.every(attempt=>attempt.failedWitness?.sourceDocumentTimeOrigin===origin&&attempt.freshProbe?.witness?.sourceDocumentTimeOrigin===origin);
    episode.status='RECOVERED_FULL_ANALYSIS_AND_FINAL_CARD';episode.completedAt=Date.now();episode.finalSourceWitness=copy(witness);
    const state=executionFlow.snapshot();episode.ordersAttempted=state.submissionAttempted;episode.eventReservationConsumed=state.intent!==null;
    episode.timing={sameSourceDocumentClockVerified:sameClock,sourceToFinalCardLowerMs:sameClock?final.firstPaintEpoch-source:null,sourceToFinalCardUpperMs:sameClock?final.secondPaintEpoch-source:null,
      wallFirstObservationToCompletionMs:Number.isSafeInteger(first?.observedAt)&&episode.completedAt>=first.observedAt?episode.completedAt-first.observedAt:null,scope:'First failed coherent source capture through all failed analyses, recovery probes, actual poll waits and recovered final-card render opportunities. Performance epochs are compared only within the same source document; wall observation age is a separate Date.now duration.',marketToDisplayMeasured:false,physicalDisplayMeasured:false};
    active.recoveryEpisode=null;return copy(episode);
  }
  async function clearOverlay(active=session){if(!active||!extension)return;try{await chrome.scripting.executeScript({target:{tabId:active.tabId},func:replayChartOverlayCommand,args:[{action:'clear',sessionId:active.id,expectedInstrument:REPLAY_SCOPE.instrument,expectedTimeframe:'1'}],world:'ISOLATED'});}catch{}}
  async function stop(){const previous=session;if(previous?.recoveryEpisode?.status==='WAITING_FOR_FRESH_FULL_ANALYSIS'){previous.recoveryEpisode.status='STOPPED_WITH_RESEARCH_SESSION';previous.recoveryEpisode.completedAt=Date.now();}serial++;if(watchTimer!==null){clearTimeout(watchTimer);watchTimer=null;}if(autoEnabled||executionFlow.snapshot().submissionAttempted)await executionFlow.disarm('REPLAY_RESEARCH_STOPPED');autoEnabled=false;executionCandidate=null;session=null;if(previous)$('replay-marker-status').textContent='מחקר Replay נעצר; לא מתבצע עדכון נוסף או שחזור כרטיס.';await clearOverlay(previous);if(previous)try{await chrome.scripting.executeScript({target:{tabId:previous.tabId},func:readTradingViewWindowEvidence,args:[{stop:true,sessionId:previous.id}],world:'ISOLATED'});}catch{}lock();}
  async function refreshTabs(){if(!extension){status('פתחו את מסך המחקר מתוך הרחבת Arrow.');return;}const previous=$('replay-tab').value;const tabs=(await chrome.tabs.query({url:['https://tradingview.com/*','https://*.tradingview.com/*']})).filter(tab=>{try{return new URL(tab.url).pathname.startsWith('/chart/');}catch{return false;}});$('replay-tab').replaceChildren(new Option('בחרו את גרף המחקר בלבד',''));for(const tab of tabs)$('replay-tab').append(new Option(`${tab.title??'TradingView'} · ${tab.id}`,String(tab.id)));const chosen=tabs.find(tab=>String(tab.id)===previous)??tabs.filter(tab=>/Arrow OHLC Live Verification/.test(tab.title??'')).at(0);if(chosen)$('replay-tab').value=String(chosen.id);}
  $('inspect-replay-ui').addEventListener('click',()=>{void (async()=>{
    if(busy||!extension)return;busy=true;lock();
    try{
      const tabId=Number($('replay-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)fail('RESEARCH_TAB_REQUIRED');
      uiInspection=(await chrome.scripting.executeScript({target:{tabId},func:readReplayTradingPublicControls,args:[],world:'ISOLATED'}))[0]?.result??null;
      const tab=await chrome.tabs.get(tabId),expectedPlan=replayTestDraft?.result?.status==='TICKET_PREPARED_TEST'?replayTestDraft.testDraft:undefined;
      replayTradingRead=(await chrome.scripting.executeScript({target:{tabId},func:replayTradingUiCommand,args:[{action:'read',expected:{researchUrl:tab.url,instrument:REPLAY_SCOPE.instrument,timeframe:'1',sourceTabId:tabId},...(expectedPlan?{expectedPlan}: {})}],world:'ISOLATED'}))[0]?.result??null;
      const position=replayTradingRead?.protectedPosition,parent=replayTradingRead?.registeredParent;
      $('replay-ui-status').textContent=position?.protectionVerified?`אומתה פוזיציית Replay קיימת של חוזה אחד, עם סטופ ויעד התואמים לתכנית TEST. סיכון מתוכנן כולל: $${position.totalPlannedRisk.toFixed(2)}. זו בדיקת מנגנון, ללא אישור איתות שוק.`:
        position?.configurationVerified?'נקראו הגנות פוזיציה קיימת. ללא תכנית כניסה שמורה אין אימות עלויות או סיכון כולל.':
        parent?.configurationVerified?'אומתו סטופ ויעד בתוך פקודת Limit קיימת. זו פקודה ממתינה, ולא הוכחת מילוי.':
        uiInspection?.status==='OBSERVED'?'נקראו בקרי Replay Trading הגלויים בלבד. לא נשלחה פקודה.':'הקריאה נחסמה: '+(replayTradingRead?.reasonCodes??uiInspection?.reasonCodes??['NO_RESPONSE']).join(' · ');
    }catch(error){$('replay-ui-status').textContent='הקריאה נעצרה: '+String(error.message??error).slice(0,160);}
    finally{busy=false;lock();}
  })();});
  $('inspect-replay-inventory').addEventListener('click',()=>{void (async()=>{
    if(busy||!extension)return;busy=true;lock();
    try{
      const tabId=Number($('replay-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)fail('RESEARCH_TAB_REQUIRED');
      const tab=await chrome.tabs.get(tabId),expected={researchUrl:tab.url,instrument:REPLAY_SCOPE.instrument,timeframe:'1',sourceTabId:tabId};
      replayTradingRead=(await chrome.scripting.executeScript({target:{tabId},func:replayTradingUiCommand,args:[{action:'read_inventory',expected}],world:'ISOLATED'}))[0]?.result??null;
      $('replay-ui-status').textContent=replayTradingRead?.status==='REPLAY_SYMBOL_FLAT_NO_PENDING_VERIFIED'?'בקרי DOM של Replay אישרו כעת: אין פוזיציה ואין פקודות ממתינות ב־NQ הנבחר. זו קריאה נקודתית ללא שיגור.':'מצב NQ ריק לא אומת: '+(replayTradingRead?.reasonCodes??[replayTradingRead?.status??'NO_RESPONSE']).join(' · ');
    }catch(error){$('replay-ui-status').textContent='קריאת מצב הפקודות נעצרה: '+String(error.message??error).slice(0,180);}
    finally{busy=false;lock();}
  })();});
  $('prepare-replay-test').addEventListener('click',()=>{void (async()=>{
    if(busy||!extension)return;busy=true;lock();
    try{
      const tabId=Number($('replay-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)fail('RESEARCH_TAB_REQUIRED');
      const tab=await chrome.tabs.get(tabId),expected={researchUrl:tab.url,instrument:REPLAY_SCOPE.instrument,timeframe:'1',sourceTabId:tabId};
      const read=(await chrome.scripting.executeScript({target:{tabId},func:replayTradingUiCommand,args:[{action:'read',expected}],world:'ISOLATED'}))[0]?.result;replayTradingRead=read??null;
      const quote=read?.ticket?.quote;if(!Number.isFinite(quote)||read.ticket.tickValue!==5)fail('EXACT_REPLAY_QUOTE_REQUIRED');
      const entry=quote-.25;
      const testDraft={direction:'LONG',quantity:1,entry,stop:entry-37*.25,target:entry+74*.25,commissionPerContract:Number($('replay-fee').value),slippageTicks:Number($('replay-slippage').value)};
      const result=(await chrome.scripting.executeScript({target:{tabId},func:replayTradingUiCommand,args:[{action:'prepare',expected,testOnly:true,testDraft}],world:'ISOLATED'}))[0]?.result;
      replayTestDraft={scope:'PASSIVE_TEST_DRAFT_ONLY_NO_SIGNAL_NO_SUBMISSION',at:Date.now(),nativeQuote:quote,passiveOffsetTicks:1,testDraft,result};replayTestInspection=null;replayTestCancellation=null;
      $('replay-ui-status').textContent=result?.status==='TICKET_PREPARED_TEST'?'טיוטת TEST ממתינה הוכנה: לונג טיק אחד מתחת לציטוט, ללא שיגור וללא אישור שוק. אין שינוי במחיר כניסה של איתות אמיתי.':'הכנת TEST נחסמה: '+(result?.reasonCodes??[result?.status??'NO_RESPONSE']).join(' · ');
    }catch(error){$('replay-ui-status').textContent='הכנת TEST נעצרה: '+String(error.message??error).slice(0,180);}
    finally{busy=false;lock();}
  })();});
  for(const [id,action] of [['inspect-replay-test-parent','inspect_parent'],['cancel-replay-test-parent','cancel_own']])$(id).addEventListener('click',()=>{void (async()=>{
    if(busy||autoEnabled||executionFlow.snapshot().submissionAttempted||replayTestDraft?.result?.status!=='TICKET_PREPARED_TEST')return;busy=true;lock();
    try{
      const tabId=Number($('replay-tab').value),tab=await chrome.tabs.get(tabId),expected={researchUrl:tab.url,sourceTabId:tabId,instrument:REPLAY_SCOPE.instrument,timeframe:'1'};
      const result=await native({action,expected,testOnly:true,expectedPlan:replayTestDraft.testDraft,...(action==='cancel_own'?{parentOrderId:replayTestInspection?.parentOrderId}:{})});
      if(action==='inspect_parent'){replayTestInspection=result;$('replay-ui-status').textContent=result?.status==='REGISTERED_PARENT_VERIFIED'?'אומתה פקודת TEST רשומה עם מזהה, סטופ ויעד. אין אישור איתות שוק.':'אימות פקודת TEST נחסם: '+(result?.reasonCodes??[result?.status??'NO_RESPONSE']).join(' · ');}
      else{replayTestCancellation=result;$('replay-ui-status').textContent=result?.status==='OWN_PARENT_CANCELLED'?'פקודת TEST שנבדקה בוטלה ואומת מצב NQ ריק.':'ביטול TEST לא אומת: '+(result?.reasonCodes??[result?.status??'NO_RESPONSE']).join(' · ');if(result?.status==='OWN_PARENT_CANCELLED')replayTestInspection=null;}
    }catch(error){$('replay-ui-status').textContent='בדיקת פקודת TEST נעצרה: '+String(error.message??error).slice(0,150);}
    finally{busy=false;lock();}
  })();});
  $('inspect-replay-test-protection').addEventListener('click',()=>{void (async()=>{
    if(busy||!extension||autoEnabled||executionFlow.snapshot().submissionAttempted)return;busy=true;lock();
    try{
      const ids=['test-protection-entry','test-protection-stop','test-protection-target'],prices=ids.map(id=>Number($(id).value));
      if(ids.some(id=>!$(id).value.trim())||prices.some(price=>!Number.isFinite(price)||price<=0||!Number.isSafeInteger(price/.25)))fail('EXPLICIT_TEST_PROTECTION_PRICES_REQUIRED');
      const tabId=Number($('replay-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)fail('RESEARCH_TAB_REQUIRED');
      const tab=await chrome.tabs.get(tabId),expected={researchUrl:tab.url,sourceTabId:tabId,instrument:REPLAY_SCOPE.instrument,timeframe:'1'},expectedPlan={direction:$('test-protection-direction').value,quantity:1,entry:prices[0],stop:prices[1],target:prices[2],commissionPerContract:Number($('replay-fee').value),slippageTicks:Number($('replay-slippage').value)};
      await chrome.scripting.executeScript({target:{tabId},func:prepareTradingViewWindowUi,args:[],world:'ISOLATED'});
      uiInspection=(await chrome.scripting.executeScript({target:{tabId},func:readReplayTradingPublicControls,args:[],world:'ISOLATED'}))[0]?.result??null;
      const result=await native({action:'inspect_protection',expected,testOnly:true,expectedPlan});
      replayTestProtection={scope:'READ_ONLY_TEST_POSITION_NO_SIGNAL_NO_SUBMISSION',expectedPlan,result};
      $('test-protection-status').textContent=result?.protectionVerified===true?'אומתו הגנות פוזיציית TEST לפי המחירים שהוזנו. זו בדיקת מנגנון בלבד, ללא אישור שוק.':'הגנות TEST לא אומתו: '+(result?.reasonCodes??[result?.status??'NO_RESPONSE']).join(' · ');
    }catch(error){$('test-protection-status').textContent='קריאת הגנות TEST נעצרה: '+String(error.message??error).slice(0,150);}
    finally{busy=false;lock();}
  })();});
  $('arm-replay-execution').addEventListener('click',()=>{void (async()=>{
    if(busy||!extension||!session)return;busy=true;lock();const active=session,token=serial;let enabled=false;
    try{
      const tab=await chrome.tabs.get(active.tabId);if(session!==active||serial!==token)return;
      active.target={researchUrl:tab.url,sourceTabId:active.tabId,instrument:REPLAY_SCOPE.instrument,timeframe:'1'};
      const result=await executionFlow.arm(active.target);enabled=result?.ok===true;
    }catch(error){$('replay-execution-status').textContent='הפעלת הכניסה נעצרה: '+String(error.message??error).slice(0,150);}
    finally{busy=false;lock();}
    if(enabled){await analyze();scheduleWatch();}
  })();});
  $('disarm-replay-execution').addEventListener('click',()=>{void (async()=>{
    serial++;executionCandidate=null;if(watchTimer!==null){clearTimeout(watchTimer);watchTimer=null;}
    await executionFlow.disarm('REPLAY_OPERATOR_STOPPED_ENTRIES');autoEnabled=false;lock();
  })();});
  $('reconcile-replay-execution').addEventListener('click',()=>{void (async()=>{
    if(busy||!session)return;busy=true;lock();try{await executionFlow.reconcile();}finally{busy=false;lock();scheduleWatch();}
  })();});
  async function deliverMarkers(){
    if(busy||!latest||!session||!extension)return;busy=true;lock();const active=session,requestSerial=serial,record=latest;
    try{
      const tab=await chrome.tabs.get(active.tabId);if(session!==active||serial!==requestSerial)return;
      const requestedEpoch=performance.timeOrigin+performance.now(),presentation=await presentReplayAnalysis({record,researchUrl:tab.url,isCurrent:()=>session===active&&serial===requestSerial,deliveryMode:'MANUAL_REDELIVERY',execute:async(func,args)=>(await chrome.scripting.executeScript({target:{tabId:active.tabId},func,args,world:'ISOLATED'}))[0]?.result});
      if(session!==active||serial!==requestSerial)return;
      presentation.operatorWaitBeforeDeliveryMs=Number.isFinite(record.timing?.receiverCompletedEpochMs)?Math.max(0,requestedEpoch-record.timing.receiverCompletedEpochMs):null;
      (record.manualMarkerDeliveries??=[]).push(presentation);if(record.manualMarkerDeliveries.length>10)record.manualMarkerDeliveries.shift();record.nativeCandleMarkers=presentation.nativeCandleMarkers;
      showMarkerResult(presentation,true);if(presentation.status!=='REPLAY_PRESENTATION_RENDERED')await clearOverlay(active);
    }catch(error){if(session!==active||serial!==requestSerial)return;$('replay-marker-status').textContent='עדכון החצים נעצר: '+String(error.message??error).slice(0,180);}
    finally{busy=false;lock();}
  }
  function showMarkerResult(presentation,manual=false){
    const payload=presentation.nativeCandleMarkers?.payload;
    $('replay-marker-status').textContent=presentation.status==='REPLAY_PRESENTATION_RENDERED'?(payload?.records.length?`${payload.records.length} חצים מוצמדים לנרות אומתו לפי שדות Pine, וכרטיס המחקר הוחזר לגרף.`:'אומתו אפס חצים וכרטיס המחקר הוחזר: לא נמצא איתות היסטורי שעבר את כל המסננים.')+(manual?' עדכון ידני נפרד; זמן המתנת המפעיל אינו חלק ממדידת הניתוח האוטומטית.':' העדכון בוצע אוטומטית כחלק מהניתוח.'):'עדכון החצים או החזרת כרטיס המחקר לא אומתו: '+presentation.reasonCodes.join(' · ');
  }
  $('deliver-replay-markers').addEventListener('click',()=>{void deliverMarkers();});
  async function loadFile(){await stop();dataset=null;latest=null;lastFailure=null;journal=[];sourceRecoveryEpisodes=[];const file=$('replay-file').files?.[0];if(!file){lock();return;}try{if(file.size>5*1024*1024)fail('JSON_SIZE_LIMIT_5MB');const text=await file.text();dataset=normalizeReplayDataset(JSON.parse(text));const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));inputFile={name:file.name,bytes:file.size,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};$('replay-data-status').textContent=`נטענו ${dataset.bars.length} נרות דקה, ${dataset.higherTimeframes['5'].bars.length} נרות 5 דקות ו־${dataset.higherTimeframes['15'].bars.length} נרות 15 דקות. תאריכים עתידיים ביחס ל־Replay ייחתכו בכל ניתוח.`;status('הנתונים נטענו. בחרו גרף מחקר NQ של דקה שבו Replay פעיל.');}catch(error){status('ייבוא הנתונים נדחה: '+error.message,'error');}lock();}
  async function analyze({automatic=false}={}){
    if(!session||busy||!dataset)return;busy=true;lastFailure=null;lock();const active=session,requestSerial=serial,readStarted=performance.now();let stage='CHART_GATE',gate=null,evidence=null,presentation=null,analysisMs=null;
    try{
      if(autoEnabled&&executionFlow.snapshot().submissionAttempted){await executionFlow.reconcile();if(session!==active||serial!==requestSerial)return;}
      gate=(await chrome.scripting.executeScript({target:{tabId:active.tabId},func:readReplayChartGate,args:[],world:'ISOLATED'}))[0]?.result;if(!gate?.ok)fail('REPLAY_CHART_GATE_REJECTED');
      stage='SOURCE_READER';
      for(let preparation=0;preparation<5;preparation++){
        evidence=(await chrome.scripting.executeScript({target:{tabId:active.tabId},func:readTradingViewWindowEvidence,args:[{sessionId:active.id}],world:'ISOLATED'}))[0]?.result;
        if(session!==active||serial!==requestSerial)return;
        if(evidence?.replayWitness||!(evidence?.reasonCodes??[]).some(code=>['WINDOW_STUDY_NOT_VISIBLE','WINDOW_FIELDS_NOT_MOUNTED','DATA_WINDOW_NOT_SELECTED','WINDOW_STUDY_NOT_FOUND'].includes(code)))break;
        await chrome.scripting.executeScript({target:{tabId:active.tabId},func:prepareTradingViewWindowUi,args:[],world:'ISOLATED'});
      }
      const readFinished=performance.now();if(session!==active||serial!==requestSerial)return;
      stage='INPUT_VALIDATION';
      const input=buildReplayAnalysisInput(dataset,evidence,active.costs);
      // Keep the source run pinned independently of latest: a recoverable
      // presentation race clears latest and must not authorize a new run.
      if((autoEnabled||automatic)&&(!active.sourceRun||active.sourceRun!==evidence.replayWitness.runId))fail('REPLAY_SOURCE_RUN_CHANGED');
      if(!autoEnabled&&!automatic){
        if(active.recoveryEpisode){if(active.recoveryEpisode.status==='WAITING_FOR_FRESH_FULL_ANALYSIS')active.recoveryEpisode.status='STOPPED_BY_EXPLICIT_MANUAL_ANALYSIS';active.recoveryEpisode=null;}
        active.sourceRun=evidence.replayWitness.runId;active.idleSourceRecoveries=0;
      }
      if(automatic&&latest?.cutoff?.asOfTime===input.options.asOfTime&&latest.replayWitness?.runId===evidence.replayWitness.runId){
        // A newly forming CURRENT candle can make the unchanged confirmed
        // PREVIOUS entry passive. Reuse its audited analysis, but keep this
        // genuinely new source capture and let the flow recompute the engine.
        const state=executionFlow.snapshot(),key=sourceKey(evidence.replayWitness);
        if(autoEnabled&&!state.submissionAttempted&&!state.locked&&latest.decision?.status==='CONFIRMED'&&key!==executionSourceKey){
          executionSourceKey=key;
          executionCandidate={sessionId:active.id,sourceTabId:active.tabId,decision:latest.decision,analysis:latest.analysis,analysisInput:input,replayWitness:evidence.replayWitness};
          const result=await executionFlow.accept(executionCandidate);if(session!==active||serial!==requestSerial)return;
          latest.replayExecution=result;
          latest.executionReread={replayWitness:evidence.replayWitness,cutoff:input.cutoff};
        }
        return;
      }
      $('replay-marker-status').textContent='ממתין לניתוח ואימות חדש של אותו מקור לפני עדכון החצים…';
      stage='ANALYSIS';const analysisStarted=performance.now(),analysis=analyzeGuideSignals(input.bars,input.options),analysisFinished=performance.now(),decision=selectReplayDecision(analysis,input.options.asOfTime),explanation=describeGuideAnalysis(analysis);
      analysisMs=analysisFinished-analysisStarted;
      renderGuideAnalysis($('replay-explanation'),explanation);$('replay-decision').textContent=decision.status==='CONFIRMED'?`REPLAY · אישור היסטורי ${decision.signal.direction} בנר הסגור האחרון · אינו איתות חי`:decision.status==='PENDING'?'REPLAY · תרחיש ממתין לנר סגור מאשר':'REPLAY · אין אישור בנר הסגור האחרון לפי כל מסנני החובה';$('replay-cutoff').textContent=`הנר הסגור שנבדק: ${new Date(input.cutoff.matchedClosedBarTime).toISOString()} · חיתוך בסגירת ${new Date(input.options.asOfTime).toISOString()}. התאמת זמן ו־OHLC מדויקת; ${input.cutoff.openCurrentExcluded?'הנר הפתוח הוצא מהניתוח. ':''}${input.cutoff.excludedFutureBaseBars} נרות דקה עתידיים לא נכללו.`;
      stage='CHART_OVERLAY';const record={kind:'NQ_REPLAY_RESEARCH_OBSERVATION',extensionVersion:REPLAY_EXTENSION_VERSION,mode:'REPLAY',liveEligible:false,orderEligible:false,testOnly:false,sessionId:active.id,sourceTabId:active.tabId,observedAt:new Date().toISOString(),inputFile,availabilityAssumption:input.availabilityAssumption,cutoff:input.cutoff,replayWitness:evidence.replayWitness,chart:evidence.chart,analysisInputs:{bars:input.bars,options:input.options},analysis,decision};
      executionCandidate={sessionId:active.id,sourceTabId:active.tabId,decision,analysis,analysisInput:input,replayWitness:evidence.replayWitness};
      executionSourceKey=sourceKey(evidence.replayWitness);
      if(autoEnabled){record.replayExecution=await executionFlow.accept(executionCandidate);if(session!==active||serial!==requestSerial)return;}
      const tab=await chrome.tabs.get(active.tabId);if(session!==active||serial!==requestSerial)return;
      $('replay-marker-status').textContent='מעדכן אוטומטית את אינדיקטור החצים ומחזיר את כרטיס המחקר באותו רצף מדוד…';
      presentation=await presentReplayAnalysis({record,researchUrl:tab.url,isCurrent:()=>session===active&&serial===requestSerial,execute:async(func,args)=>(await chrome.scripting.executeScript({target:{tabId:active.tabId},func,args,world:'ISOLATED'}))[0]?.result});
      if(session!==active||serial!==requestSerial)return;showMarkerResult(presentation);
      if(presentation.status!=='REPLAY_PRESENTATION_RENDERED')fail(presentation.reasonCodes[0]??'REPLAY_PRESENTATION_UNVERIFIED');
      active.idleSourceRecoveries=0;
      const sourceRecoveryEpisode=finishRecoveryEpisode(active,presentation,evidence.replayWitness);if(sourceRecoveryEpisode)record.sourceRecoveryEpisode=sourceRecoveryEpisode;
      const completed=performance.now(),timing={receiverReadMs:readFinished-readStarted,analysisMs:analysisFinished-analysisStarted,overlayRoundTripMs:presentation.timing.initialCardRoundTripMs,receiverOperationMs:completed-readStarted,receiverReadStartedEpochMs:performance.timeOrigin+readStarted,receiverCompletedEpochMs:performance.timeOrigin+completed,chartReceipt:presentation.finalCardReceipt,initialChartReceipt:presentation.initialCardReceipt,nativeMarkerReceipt:presentation.nativeCandleMarkers.receipt,finalChartReceipt:presentation.finalCardReceipt,...presentation.timing,...(sourceRecoveryEpisode?{sourceRecoveryEpisodeTiming:sourceRecoveryEpisode.timing}:{}),scope:'Automatic historical research pipeline: coherent source-DOM OHLC capture, analysis, initial card, native Pine fields, Data Window restoration and final card render opportunities. Receiver total also includes any execution or reconciliation performed earlier in this operation. Native order registration and protected-fill timings are reported separately in replayExecution. No operator delivery click is included. Market/Pine production before source-DOM capture and physical pixels are unmeasured.',marketToDisplayMeasured:false,captureToPhysicalDisplayMeasured:false};
      latest={...record,timing,presentation,nativeCandleMarkers:presentation.nativeCandleMarkers};
      journal.push({id:active.id+':'+(++entrySerial),asOfTime:decision.asOfTime,status:decision.status,signal:decision.signal,cutoff:input.cutoff,timing,liveEligible:false});if(journal.length>100)journal.shift();$('replay-evidence').textContent=JSON.stringify({mode:'REPLAY',liveEligible:false,cutoff:input.cutoff,decision:{status:decision.status,confirmedAtCurrentClose:decision.confirmedAtCurrentClose,pending:decision.pending},timing},null,2);const episodeTiming=sourceRecoveryEpisode?.timing,bounds=episodeTiming?.sameSourceDocumentClockVerified?`מהצילום הראשון עד כרטיס REPLAY סופי, כולל הניסיונות והמתנות ההתאוששות: ${episodeTiming.sourceToFinalCardLowerMs.toFixed(1)}–${episodeTiming.sourceToFinalCardUpperMs.toFixed(1)} ms. `:timing.sameSourceDocumentClockVerified?`לכידת OHLC עקבית → כרטיס REPLAY סופי, כולל עדכון החצים: ${timing.sourceToFinalCardLowerMs.toFixed(1)}–${timing.sourceToFinalCardUpperMs.toFixed(1)} ms. `:'';$('replay-timing').textContent=bounds+`${sourceRecoveryEpisode?'הניסיון האחרון':'כל הרצף האוטומטי'} מהתחלת הקריאה עד החזרת הכרטיס: ${timing.receiverOperationMs.toFixed(1)} ms · ניתוח: ${timing.analysisMs.toFixed(1)} ms · עדכון Pine: ${timing.nativeMarkerRoundTripMs.toFixed(1)} ms. הרצף כולל בדיקות ביצוע אם בוצעו; זמני פקודות מאומתים מוצגים בנפרד. אין מדידת בורסה או פיקסלים פיזיים.`;status('הניתוח, עדכון החצים והחזרת כרטיס REPLAY הושלמו אוטומטית על הגרף.','ok');
    }catch(error){
      if(session!==active||serial!==requestSerial)return;
      const recovery=await recoverIdleSourceRace({error,stage,active,requestSerial,evidence,presentation,readStarted,analysisMs});
      if(recovery.recovered||session!==active||serial!==requestSerial)return;
      if(autoEnabled)await executionFlow.disarm('REPLAY_ANALYSIS_OR_SOURCE_FAILED');
      executionCandidate=null;executionSourceKey=null;latest=null;
      lastFailure={observedAt:new Date().toISOString(),diagnostics:describeReplayReadDiagnostics({stage,sourceTabId:active.tabId,gate,evidence,error}),presentation,recovery};
      if(!presentation)$('replay-marker-status').textContent='אין עדכון חצים מאומת למקור הנוכחי; הניתוח נעצר.';
      await clearOverlay(active);if(session!==active||serial!==requestSerial)return;
      $('replay-decision').textContent='REPLAY · אין החלטה תקפה לנר הנראה';$('replay-cutoff').textContent='';$('replay-timing').textContent='';$('replay-explanation').replaceChildren();$('replay-evidence').textContent=JSON.stringify(lastFailure,null,2);
      const diagnosis=lastFailure.diagnostics,codes=diagnosis.reader?.reasonCodes?.length?diagnosis.reader.reasonCodes:diagnosis.gate?.reasonCodes;
      status('הניתוח נחסם בשלב '+diagnosis.stage+': '+diagnosis.errorCode+(codes?.length?' · '+codes.join(' · '):'')+(codes?.includes('WINDOW_STUDY_NOT_VISIBLE')?' · גללו בחלון הנתונים עד שכותרת Arrow ושדותיו נראים.':''),'error');
    }
    finally{busy=false;lock();}
  }
  $('replay-file').addEventListener('change',()=>{void loadFile();});$('refresh-replay-tabs').addEventListener('click',()=>{void refreshTabs();});$('start-replay').addEventListener('click',()=>{const tabId=Number($('replay-tab').value),commissionPerContract=Number($('replay-fee').value),slippageTicks=Number($('replay-slippage').value);if(!Number.isSafeInteger(tabId)||tabId<1||!$('replay-fee').value.trim()||!$('replay-slippage').value.trim()||![commissionPerContract,slippageTicks].every(v=>Number.isFinite(v)&&v>=0)){status('בחרו גרף והזינו עלויות מחקר מפורשות.','error');return;}session={id:'REPLAY:'+crypto.randomUUID(),tabId,costs:{commissionPerContract,slippageTicks}};serial++;lock();void analyze();});$('analyze-replay').addEventListener('click',()=>{void analyze();});$('stop-replay').addEventListener('click',()=>{void stop().then(()=>{const state=executionFlow.snapshot();status(state.result?.status==='OWN_PARENT_CANCELLED'?'מחקר Replay נעצר. פקודת הכניסה של הבוט בוטלה ואומת מצב NQ ריק.':state.state==='UNKNOWNLOCK'?'מחקר Replay נעצר. מצב הפקודה לא אומת; נדרשת בדיקה לפני כניסה נוספת.':state.state==='FILLED_PROTECTED'?'מחקר Replay נעצר. הפוזיציה המוגנת נשארה פתוחה.':'מחקר Replay נעצר. כניסות אוטומטיות חדשות כבויות.');});});$('export-replay').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({kind:'NQ_REPLAY_RESEARCH_EXPORT',schemaVersion:1,extensionVersion:REPLAY_EXTENSION_VERSION,exportedAt:new Date().toISOString(),mode:'REPLAY',liveEligible:false,orderEligible:false,latest,journal,failure:lastFailure,uiInspection,replayTradingRead,replayTestDraft,replayTestInspection,replayTestCancellation,replayTestProtection,sourceRecovery:{maximumConsecutive:REPLAY_IDLE_SOURCE_RECOVERY_LIMIT,episodes:sourceRecoveryEpisodes},replayExecution:executionFlow.snapshot()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='arrow-nq-replay-'+Date.now()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});window.addEventListener('pagehide',()=>{void stop();});lock();void refreshTabs();
}
