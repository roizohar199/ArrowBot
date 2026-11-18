import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyLiveReadiness} from '../scripts/verify-live-readiness.mjs';
import {analyzeGuideSignals,GUIDE_SIGNAL_DEFAULTS,GUIDE_ALL_SCENARIO_CONTEXT} from '../guide-signal-engine.mjs';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {describeGuideFormingPreview} from '../guide-forming-view.mjs';

const extensionVersion=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8')).version;
const minute=60000,start=Date.UTC(2026,10,13,18),instrument='CME_MINI:NQ1!',runId='controlled-fixture-run';
const flags=['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
function fixture(){
  const metadata={source:'ohlc',instrument,timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'research',chartType:'standard',tabId:17,sourceId:runId,provider:'Controlled unit fixture',realtime:true,replay:false};
  const bars=Array.from({length:25},(_,index)=>({time:start+(index-25)*minute,closeTime:start+(index-24)*minute,knownAt:start+(index-24)*minute,open:100,high:101,low:99,close:100,closed:true}));
  const now=start+2000,current={time:start,closeTime:start+minute,open:100,high:101,low:99.5,close:100.5,closed:false,receivedAt:now};
  const config={...GUIDE_SIGNAL_DEFAULTS,...Object.fromEntries(flags.map(key=>[key,true]))},risk={riskBudget:200,maxContracts:1,pointValue:20,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2},contextConfig={...GUIDE_ALL_SCENARIO_CONTEXT,supplyDemandEnabled:true};
  const appliedOptions={config,risk,contextConfig},options={metadata,...appliedOptions,higherTimeframes:{},asOfTime:now};
  const analysis=analyzeGuideSignals(bars,options),preview=createGuideFormingPreview().analyze(current,{...options,closedBars:bars,closedAnalysis:analysis});
  const display=describeGuideFormingPreview(preview,{eligible:true,sourceId:runId,sourceObservedAt:now,now});
  return {schemaVersion:1,kind:'LIVE_OHLC_OBSERVATION',extensionVersion,sourceTransport:'window',orderEligible:false,active:true,settingsDirty:false,selectedTabId:17,selectedRun:runId,observationSession:{sessionId:'controlled-unit-session',sourceTabId:17},appliedOptions,account:{reviewAccepted:true,ordersAuthorized:false,review:{ordersAuthorized:false,profile:{instrument,mode:'RESEARCH',...risk}}},store:{status:'READY',metadata,ready:true,liveEligible:true,stale:false,requiresSnapshot:false,contextOnly:false,bars,current,decisionAsOfTime:now},windowEvidence:{chart:{replay:false,visibleCharts:1,symbols:[instrument]},continuityDecisions:[]},analysisInputs:{bars,options},latestAnalysis:analysis,formingPreview:preview,formingPreviewReceivedAt:now,formingDisplay:display,timeframes:{higherTimeframes:{}},alerts:[],alertDelivery:[]};
}

test('offline audit independently reproduces strict closed decisions, provisional preview and display without claiming orders or market authentication',()=>{
  const recording=fixture(),before=structuredClone(recording),report=verifyLiveReadiness(recording);
  assert.equal(report.status,'RECORDED_CONFIGURATION_AND_INTRABAR_PREVIEW_SELF_CONSISTENT');assert.deepEqual(report.reasonCodes,[]);
  assert.deepEqual(report.independentRecomputation,{closedDecisionSemantics:true,intrabarPreview:true,provisionalDisplay:true});
  assert.equal(report.recovery.status,'NOT_RECORDED');assert.equal(report.ordersAuthorized,false);assert.equal(report.recordedCurrentAlerts,0);assert.match(report.limits[0],/not independent market-source authentication/);
  assert.deepEqual(recording,before);
});

test('audit rejects turned-off scenarios or mandatory filters, fabricated approval and tampered preview prices',()=>{
  for(const [mutate,reason]of[
    [r=>{r.appliedOptions.contextConfig.roleReversalEnabled=false;},'ALL_SCENARIOS_AND_SUPPLY_DEMAND_MUST_BE_ENABLED'],
    [r=>{r.appliedOptions.config.requireTrendline=false;},'ALL_MANDATORY_FILTERS_AND_CLOSED_CONFIRMATION_REQUIRED'],
    [r=>{r.formingPreview.signalApproved=true;},'FORMING_PREVIEW_SCOPE_INVALID'],
    [r=>{r.formingPreview.directions.LONG.levels.invalidation-=.25;},'INTRABAR_PREVIEW_DID_NOT_REPRODUCE']
  ]){const recording=fixture();mutate(recording);const report=verifyLiveReadiness(recording);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.includes(reason),reason);}
});

test('context-only recording must remove every provisional row and cannot be reported as a live recovery',()=>{
  const recording=fixture();Object.assign(recording.store,{status:'CONTEXT_READY',contextOnly:true,ready:false,liveEligible:false});recording.formingPreview=null;recording.formingDisplay=describeGuideFormingPreview(null,{eligible:false});
  recording.windowEvidence.continuityDecisions=[{action:'RECOVERY_CONTEXT_PUBLISHED',liveEligible:false,requiredFreshFrames:2,baselineSourceAt:start}];
  const report=verifyLiveReadiness(recording);assert.equal(report.status,'RECORDED_CONFIGURATION_AND_CONTEXT_ONLY_SELF_CONSISTENT');assert.equal(report.recovery.status,'CONTEXT_PUBLISHED_NOT_LIVE');
  recording.formingDisplay=fixture().formingDisplay;assert.ok(verifyLiveReadiness(recording).reasonCodes.includes('PROVISIONAL_ROWS_VISIBLE_WITHOUT_ELIGIBLE_SOURCE'));
});

test('recorded fresh-pair recovery remains a bounded self-consistency result and rejects one-frame recovery',()=>{
  const recording=fixture();recording.windowEvidence.continuityDecisions=[{action:'RECOVERY_CONTEXT_PUBLISHED',liveEligible:false,requiredFreshFrames:2,baselineSourceAt:start},{action:'RECOVERY_FRESH_PAIR_VERIFIED',freshFrames:2,baselineSourceAt:start,newBaselineSourceAt:start+400}];
  const report=verifyLiveReadiness(recording);assert.equal(report.recovery.status,'RECORDED_FRESH_PAIR_SELF_CONSISTENT');assert.deepEqual(report.reasonCodes,[]);
  recording.windowEvidence.continuityDecisions[1].freshFrames=1;assert.ok(verifyLiveReadiness(recording).reasonCodes.includes('RECOVERY_FRESH_PAIR_INVALID'));
});
