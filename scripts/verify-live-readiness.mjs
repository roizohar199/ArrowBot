import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {describeGuideFormingPreview} from '../guide-forming-view.mjs';

const currentExtensionVersion=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8')).version;
const flags=['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const checkIds=['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME','RISK'];
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const rows=value=>Array.isArray(value)?value:[];
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(canonical(value));
const same=(a,b)=>json(a)===json(b);
const sha=value=>createHash('sha256').update(json(value)).digest('hex');
const semantics=event=>Object.fromEntries(['eventId','setupId','direction','status','barOpenTime','barCloseTime','formationStartTime','detectedAt','confirmedAt','confirmationBarCloseTime','confirmationClose','trigger','invalidation','patternIds','reasonCodes','riskPlan'].map(key=>[key,event[key]]));
const noCache=value=>{if(!plain(value))return value;const {cache,...rest}=value;return rest;};
const provisional=value=>value?.candidateOnly===true&&value.final===false&&value.signalApproved===false&&value.orderEligible===false;

// This audits consistency of a recorded research export. It cannot authenticate
// market origin, physically visible pixels, broker state or profitable trading.
export function verifyLiveReadiness(recording,{expectedVersion=currentExtensionVersion,expectedInstrument}={}){
  const errors=[],warnings=[],check=(ok,code)=>{if(!ok)errors.push(code);};
  if(!plain(recording))throw TypeError('LIVE_RECORDING_REQUIRED');
  const options=recording.appliedOptions,state=recording.store,session=recording.observationSession;
  check(recording.schemaVersion===1&&recording.kind==='LIVE_OHLC_OBSERVATION'&&recording.sourceTransport==='window','PUBLIC_WINDOW_RECORDING_REQUIRED');
  check(recording.extensionVersion===expectedVersion,'EXTENSION_VERSION_MISMATCH');
  check(recording.orderEligible===false,'ORDERS_MUST_REMAIN_DISABLED');
  check(recording.account?.ordersAuthorized===false&&recording.account?.review?.ordersAuthorized===false,'ACCOUNT_ORDERS_MUST_REMAIN_DISABLED');
  check(recording.account?.reviewAccepted===true&&recording.account?.review?.profile?.mode==='RESEARCH','REVIEWED_RESEARCH_PROFILE_REQUIRED');
  check(flags.every(key=>options?.config?.[key]===true)&&options.config.entryMode==='close_confirmation','ALL_MANDATORY_FILTERS_AND_CLOSED_CONFIRMATION_REQUIRED');
  check(options?.contextConfig?.roleReversalEnabled===true&&options?.contextConfig?.supplyDemandEnabled===true,'ALL_SCENARIOS_AND_SUPPLY_DEMAND_MUST_BE_ENABLED');
  check(options?.risk?.riskBudget===200&&options?.risk?.maxContracts===1,'200_DOLLAR_ONE_CONTRACT_CONFIGURATION_REQUIRED');
  check(['pointValue','commissionPerContract','slippageTicks','rewardRisk'].every(key=>Number.isFinite(options?.risk?.[key])),'EXPLICIT_RESEARCH_RISK_INPUTS_REQUIRED');
  check(['riskBudget','maxContracts','pointValue','commissionPerContract','slippageTicks','rewardRisk'].every(key=>options?.risk?.[key]===recording.account?.review?.profile?.[key]),'APPLIED_AND_REVIEWED_RISK_MISMATCH');
  check(Number.isSafeInteger(recording.selectedTabId)&&recording.selectedTabId===session?.sourceTabId&&typeof session?.sessionId==='string','CURRENT_RESEARCH_SESSION_BINDING_REQUIRED');
  if(expectedInstrument)check(recording.account?.review?.profile?.instrument===expectedInstrument,'EXPECTED_INSTRUMENT_MISMATCH');
  if(state?.metadata){
    check(state.metadata.instrument===recording.account?.review?.profile?.instrument,'SOURCE_AND_ACCOUNT_INSTRUMENT_MISMATCH');
    check(state.metadata.pointValue===options?.risk?.pointValue,'SOURCE_AND_RISK_POINT_VALUE_MISMATCH');
    check(state.metadata.tabId===recording.selectedTabId&&state.metadata.sourceId===recording.selectedRun,'STORE_AND_CURRENT_SOURCE_BINDING_MISMATCH');
  }
  if(state?.contextOnly===true)check(state.ready===false&&state.liveEligible===false,'CONTEXT_ONLY_CANNOT_BECOME_LIVE');
  if(state?.liveEligible===true){
    check(recording.active===true&&state.ready===true&&state.stale===false&&state.requiresSnapshot===false&&state.contextOnly!==true&&recording.settingsDirty===false,'LIVE_STATE_GUARDS_INCONSISTENT');
    check(state.metadata?.realtime===true&&state.metadata?.replay===false,'LIVE_METADATA_GUARDS_INCONSISTENT');
    check(recording.windowEvidence?.chart?.replay===false&&recording.windowEvidence.chart.visibleCharts===1&&recording.windowEvidence.chart.symbols?.[0]===state.metadata.instrument,'LIVE_CHART_PROOF_INCONSISTENT');
  }
  let analysisReproduced=false,formingReproduced=false,displayReproduced=false;
  if(recording.analysisInputs&&recording.latestAnalysis){
    const input=recording.analysisInputs,captured=recording.latestAnalysis;
    check(flags.every(key=>input.options?.config?.[key]===true)&&input.options?.contextConfig?.roleReversalEnabled===true,'ANALYZED_OPTIONS_NOT_FULLY_ENABLED');
    try{
      const independent=analyzeGuideSignals(input.bars,input.options);
      analysisReproduced=independent.status===captured.status&&same(independent.stats,captured.stats)&&same(rows(independent.events).map(semantics),rows(captured.events).map(semantics))&&same(rows(independent.signals).map(semantics),rows(captured.signals).map(semantics));
      check(analysisReproduced,'CLOSED_ANALYSIS_DECISIONS_DID_NOT_REPRODUCE');
      check(captured.orderEligible===false&&rows(captured.events).every(event=>event.orderEligible===false),'ANALYSIS_ORDERS_MUST_REMAIN_DISABLED');
    }catch(error){check(false,'CLOSED_ANALYSIS_RECOMPUTATION_FAILED:'+error.message);}
  }else warnings.push('NO_CLOSED_ANALYSIS_RECORDED');
  const preview=recording.formingPreview,display=recording.formingDisplay;
  if(preview){
    check(provisional(preview)&&preview.ordersCreated===false&&preview.fillInferred===false,'FORMING_PREVIEW_SCOPE_INVALID');
    check(['LONG','SHORT'].every(direction=>provisional(preview.directions?.[direction])&&checkIds.every(id=>rows(preview.directions[direction].checks).filter(entry=>entry.id===id).length===1)),'FORMING_DIRECTION_CHECKLIST_INCOMPLETE');
    check([...rows(preview.scenarios),...rows(preview.pendingConfirmations)].every(provisional),'FORMING_SCENARIO_SCOPE_INVALID');
    if(state?.current&&recording.latestAnalysis){
      try{
        const independent=createGuideFormingPreview().analyze(state.current,{closedBars:state.bars,closedAnalysis:recording.latestAnalysis,metadata:state.metadata,...options,higherTimeframes:recording.timeframes?.higherTimeframes??{},asOfTime:state.decisionAsOfTime});
        formingReproduced=same(noCache(independent),noCache(preview));
        check(formingReproduced,'INTRABAR_PREVIEW_DID_NOT_REPRODUCE');
      }catch(error){check(false,'INTRABAR_RECOMPUTATION_FAILED:'+error.message);}
    }else check(false,'PREVIEW_WITHOUT_CURRENT_BAR_AND_CLOSED_ANALYSIS');
  }
  if(display?.status==='PREVIEW'){
    check(state?.liveEligible===true&&recording.active===true&&recording.settingsDirty===false&&!!preview,'PROVISIONAL_ROWS_VISIBLE_WITHOUT_ELIGIBLE_SOURCE');
    check(display.candidateOnly===true&&display.signalApproved===false&&display.orderEligible===false,'DISPLAY_SCOPE_INVALID');
    check(Number.isFinite(display.sourceAgeMs)&&display.sourceAgeMs>=0&&display.sourceAgeMs<=15000,'DISPLAY_SOURCE_AGE_INVALID');
    const renderedAt=display.sourceObservedAt+display.sourceAgeMs;
    const independent=describeGuideFormingPreview(preview,{sourceId:state?.metadata?.sourceId,sourceObservedAt:recording.formingPreviewReceivedAt,now:renderedAt,eligible:true});
    displayReproduced=same(independent,display);check(displayReproduced,'PROVISIONAL_DISPLAY_DID_NOT_REPRODUCE');
  }else if(display)check(rows(display.directions).length===0&&rows(display.scenarios).length===0&&rows(display.pendingConfirmations).length===0,'INELIGIBLE_DISPLAY_RETAINED_OLD_CONDITION_ROWS');
  else warnings.push('NO_FORMING_DISPLAY_SNAPSHOT_RECORDED');
  const continuity=rows(recording.windowEvidence?.continuityDecisions),context=continuity.filter(item=>item.action==='RECOVERY_CONTEXT_PUBLISHED').at(-1),recovered=continuity.filter(item=>item.action==='RECOVERY_FRESH_PAIR_VERIFIED').at(-1);
  let recoveryStatus='NOT_RECORDED';
  if(context){check(context.liveEligible===false&&context.requiredFreshFrames===2,'RECOVERY_CONTEXT_SCOPE_INVALID');recoveryStatus='CONTEXT_PUBLISHED_NOT_LIVE';}
  if(recovered){check(recovered.freshFrames>=2&&recovered.newBaselineSourceAt>recovered.baselineSourceAt,'RECOVERY_FRESH_PAIR_INVALID');recoveryStatus='RECORDED_FRESH_PAIR_SELF_CONSISTENT';}
  check(rows(recording.alerts).every(alert=>alert.signal?.orderEligible===false),'RECORDED_ALERT_ORDERS_MUST_REMAIN_DISABLED');
  const status=errors.length?'MISMATCH':display?.status==='PREVIEW'?'RECORDED_CONFIGURATION_AND_INTRABAR_PREVIEW_SELF_CONSISTENT':state?.contextOnly?'RECORDED_CONFIGURATION_AND_CONTEXT_ONLY_SELF_CONSISTENT':'RECORDED_CONFIGURATION_SELF_CONSISTENT';
  return {kind:'ARROW_LIVE_READINESS_RECORDING_AUDIT',status,reasonCodes:[...new Set(errors)],warnings,extensionVersion:recording.extensionVersion,instrument:state?.metadata?.instrument??recording.account?.review?.profile?.instrument??null,allNineScenarioFamiliesEnabled:options?.contextConfig?.roleReversalEnabled===true,mandatoryFlags:Object.fromEntries(flags.map(key=>[key,options?.config?.[key]===true])),risk:{riskBudget:options?.risk?.riskBudget??null,maxContracts:options?.risk?.maxContracts??null,commissionVerified:false,slippageVerified:false},recordedState:{status:state?.status??null,ready:state?.ready??false,liveEligible:state?.liveEligible??false,contextOnly:state?.contextOnly??false,closedBars:rows(state?.bars).length,formingStatus:preview?.status??null,displayStatus:display?.status??null},independentRecomputation:{closedDecisionSemantics:analysisReproduced,intrabarPreview:formingReproduced,provisionalDisplay:displayReproduced},recovery:{status:recoveryStatus,contextBaselineSourceAt:context?.baselineSourceAt??null,freshFrames:recovered?.freshFrames??null,newBaselineSourceAt:recovered?.newBaselineSourceAt??null},recordedCurrentAlerts:rows(recording.alerts).length,recordedCurrentLiveDeliveries:rows(recording.alertDelivery).filter(item=>item.mode==='LIVE'&&item.testOnly===false).length,ordersAuthorized:false,inputSemanticSha256:sha(recording),limits:['Recorded JSON self-consistency and independent deterministic recomputation only; not independent market-source authentication.','Configuration and provisional conditions do not approve an entry; an eligible later provider-final close remains mandatory.','A recorded recovery event is not a promise of recovery on every future outage.','No broker connection, account drawdown enforcement, execution, profitability, exchange latency, capture latency or physical-pixel visibility is verified.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [inputPath,outputPath,...extra]=process.argv.slice(2);
  if(!inputPath||extra.length)throw Error('Usage: node scripts/verify-live-readiness.mjs RECORDING.json [NEW_REPORT.json]');
  if((await stat(inputPath)).size>80*1024*1024)throw Error('RECORDING_SIZE_LIMIT_80MB');
  const source=await readFile(inputPath,'utf8'),report=verifyLiveReadiness(JSON.parse(source));
  report.inputFileSha256=createHash('sha256').update(source).digest('hex');
  if(outputPath){
    const root=resolve('verification'),target=resolve(outputPath),child=relative(root,target);
    if(!child||isAbsolute(child)||child==='..'||child.startsWith('..\\')||child.startsWith('../')||target===resolve(inputPath))throw Error('NEW_REPORT_MUST_STAY_IN_VERIFICATION_AND_NOT_OVERWRITE_INPUT');
    await writeFile(target,JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  }
  console.log(JSON.stringify({status:report.status,reasonCodes:report.reasonCodes,warnings:report.warnings,instrument:report.instrument,recordedState:report.recordedState,independentRecomputation:report.independentRecomputation,recovery:report.recovery,recordedCurrentAlerts:report.recordedCurrentAlerts,ordersAuthorized:false,...(outputPath?{report:resolve(outputPath)}:{})},null,2));
  if(report.status==='MISMATCH')process.exitCode=1;
}
