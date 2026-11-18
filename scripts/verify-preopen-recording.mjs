import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseWindowBootstrapEvidence} from '../window-bootstrap.mjs';
import {deriveVerifiedSessionGaps} from '../session-gap-proof.mjs';
import {normalizeAccountProfile} from '../account-profile.mjs';
import {planGuideRisk} from '../guide-risk.mjs';

// Offline closed-history audit. Re-encoding retained parsed seed rows validates
// their schema/proof and exact pairing; it does not authenticate original logs,
// replay unretained64-field checksums or claim a natural live signal/latency.
const finite=Number.isFinite,integer=Number.isSafeInteger;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const rows=value=>Array.isArray(value)?value:[];
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(canonical(value));
const sha=value=>createHash('sha256').update(json(value)).digest('hex');
const metaKeys=['source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'];
const metaEqual=(a,b)=>metaKeys.every(key=>a?.[key]===b?.[key]);

export function verifyPreopenRecording(recording,{expectedBars=100,expectedInstrument='CME_MINI:NQ1!'}={}){
  if(!plain(recording)||!integer(expectedBars)||expectedBars<20||expectedBars>100)throw TypeError('PREOPEN_RECORDING_AND_BOUNDED_EXPECTED_COUNT_REQUIRED');
  const errors=[],check=(value,code)=>{if(!value)errors.push(code);},p=recording.preopenContext,w=recording.windowEvidence,h=p?.bootstrapHistory,b=p?.bootstrap,frame=w?.windowFrame??w?.frame,chart=w?.chart,session=recording.observationSession;
  check(recording.kind==='LIVE_OHLC_OBSERVATION'&&recording.sourceTransport==='window','PUBLIC_WINDOW_RECORDING_REQUIRED');
  check(recording.orderEligible===false&&recording.account?.ordersAuthorized===false&&recording.account?.review?.ordersAuthorized===false,'ORDERS_MUST_REMAIN_DISABLED');
  check(p?.kind==='PREOPEN_CONTEXT_ONLY'&&p.status==='CONTEXT_READY'&&p.contextOnly===true&&p.liveEligible===false&&p.ordersAuthorized===false&&p.seedSent===true,'PREOPEN_CONTEXT_READY_ONLY_REQUIRED');
  check(w?.status==='WAITING'&&w.contextOnly===true&&w.contextReady===true&&w.liveEligible===false&&rows(w.reasonCodes).includes('WINDOW_PRESESSION_CONTEXT_ONLY')&&Array.isArray(w.messages)&&w.messages.length===0,'READER_MUST_REMAIN_PRESESSION_NONLIVE');
  check(chart?.visibleCharts===1&&chart.documentVisible===true&&chart.replay===false&&chart.marketOpen===false&&chart.realtime!==true&&json(chart.symbols)===json([expectedInstrument])&&chart.interval==='1','EXACT_VISIBLE_CLOSED_MARKET_CHART_REQUIRED');
  check(frame?.coherent===true&&frame.realtime===false&&frame.sequence===0,'NONREALTIME_COHERENT_INITIAL_FRAME_REQUIRED');
  check(integer(p?.runEpoch)&&p.runEpoch>=1577836800000&&p.runEpoch===b?.runEpoch&&p.runEpoch===h?.runEpoch&&p.runEpoch===frame?.runEpoch&&p.runEpoch===w?.bootstrapMetadata?.runEpoch,'SOURCE_RUN_EPOCH_PAIRING_MISMATCH');
  check(p?.runId===b?.runId&&p?.runId===h?.runId&&p?.runId===w?.bootstrapMetadata?.runId&&p?.runId===expectedInstrument+'|1|'+p?.runEpoch,'SOURCE_RUN_ID_PAIRING_MISMATCH');
  check(b?.wireVersion===3&&b?.schemaVersion===2&&json(b)===json(w?.bootstrapMetadata),'EXACT_V3_BOOTSTRAP_METADATA_REQUIRED');
  check(p?.metadata?.instrument===expectedInstrument&&p.metadata.timeframe==='1'&&p.metadata.timeframeMs===60000&&p.metadata.tickSize===.25&&p.metadata.pointValue===20&&p.metadata.currency==='USD'&&p.metadata.source==='ohlc'&&p.metadata.chartType==='standard'&&metaEqual(p.metadata,b?.metadata)&&metaEqual(p.metadata,h?.metadata),'SOURCE_CONTRACT_METADATA_MISMATCH');
  check(integer(h?.sourceEmittedAt)&&h.sourceEmittedAt>=p?.runEpoch&&h.sourceEmittedAt<=frame?.sourceEmittedAt,'SEED_SOURCE_TIME_NOT_PAIRED_WITH_FRAME');
  check(integer(recording.selectedTabId)&&p?.tabId===recording.selectedTabId&&session?.sourceTabId===recording.selectedTabId&&p?.readSource?.chartTabId===recording.selectedTabId&&p?.readSource?.contextOnly===true,'SOURCE_TAB_PAIRING_MISMATCH');
  check(typeof session?.sessionId==='string'&&!!session.sessionId&&p?.sessionId===session.sessionId&&recording.sourceDomLatency?.sessionId===session.sessionId&&recording.pollScheduler?.sessionId===session.sessionId&&recording.sourceWakeDiagnostics?.sessionId===session.sessionId,'CURRENT_OBSERVATION_SESSION_MISMATCH');
  check(recording.active===true&&recording.selectedRun===null&&session?.runId===null&&recording.settingsDirty===false,'NO_LIVE_RUN_MAY_BE_SELECTED_PREOPEN');
  for(const state of [recording.store,recording.retainedStoreClockState])check(state?.ready===false&&state.liveEligible===false&&state.connected===false&&state.orderEligible===false&&rows(state.bars).length===0&&state.current===null&&state.metadata===null,'CURRENT_LIVE_STORE_MUST_REMAIN_EMPTY');
  check(recording.timeframes?.ready===false&&rows(recording.timeframes.series).length===2&&recording.timeframes.series.every(entry=>entry.ready===false&&entry.closedBars===0&&entry.retainedBars===0),'HISTORICAL_CONTEXT_MUST_NOT_BECOME_LIVE_HTF_BASELINE');
  for(const key of ['alerts','alertDelivery','deliveryProbes','rawEvidence','pollEvidence','closeBoundarySamples'])check(Array.isArray(recording[key])&&recording[key].length===0,'CURRENT_NONLIVE_LEDGER_NOT_EMPTY:'+key);
  for(const key of ['formingPreview','analysisInputs','latestAnalysis','explanation'])check(recording[key]===null,'NO_CURRENT_LIVE_ANALYSIS_OR_APPROVAL:'+key);
  for(const [name,timing]of [['latency',recording.latency],['sourceDomLatency',recording.sourceDomLatency]]){
    check(plain(timing)&&Array.isArray(timing.samples)&&timing.samples.length===0&&timing.marketToDisplayMeasured===false&&timing.captureToDisplayMeasured===false&&timing.physicalDisplayMeasured===false,'NO_LIVE_TIMING_SAMPLES_ALLOWED:'+name);
    check(plain(timing?.metrics)&&Object.values(timing.metrics).every(metric=>metric?.count===0&&metric.p50Ms===null&&metric.p95Ms===null&&metric.maxMs===null),'NO_FABRICATED_ZERO_MS_PERCENTILES:'+name);
  }
  check(recording.latency?.completed===0&&recording.latency?.retainedSamples===0&&recording.sourceWakeDiagnostics?.counts?.sent===0&&recording.pollScheduler?.counts?.wakes===0,'NO_REALTIME_WAKE_OR_COMPLETED_RENDER_ALLOWED');
  const required=['requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe','requireRisk'],options=recording.appliedOptions;
  check(required.every(key=>options?.config?.[key]===true)&&options.config.entryMode==='close_confirmation'&&options.config.minConditions>=2&&options.contextConfig?.supplyDemandEnabled===true,'STRICT_RESEARCH_FILTER_CONFIGURATION_REQUIRED');
  const reviewed=normalizeAccountProfile(recording.account?.review?.profile),profile=reviewed.ok?reviewed.profile:null;
  check(recording.account?.reviewAccepted===true&&profile?.mode==='RESEARCH'&&recording.account.review.brokerAccountVerified===false&&recording.account.review.commissionVerified===false&&recording.account.review.slippageVerified===false,'EXPLICIT_UNVERIFIED_RESEARCH_ACCOUNT_REVIEW_REQUIRED');
  check(integer(recording.account?.review?.reviewedAt)&&integer(session?.startedAtWall)&&recording.account.review.reviewedAt<=session.startedAtWall&&finite(Date.parse(recording.exportedAt))&&session.startedAtWall<=Date.parse(recording.exportedAt),'RECEIVER_REVIEW_SESSION_CLOCK_ORDER_INVALID');
  check(profile?.instrument===expectedInstrument&&profile.currency==='USD'&&profile.tickSize===.25&&profile.pointValue===20&&profile.riskBudget===200&&profile.maxContracts===1&&profile.commissionPerContract===3.1&&profile.slippageTicks===2,'EXPECTED_NQ_RESEARCH_RISK_ASSUMPTIONS_REQUIRED');
  check(['riskBudget','pointValue','maxContracts','commissionPerContract','slippageTicks','rewardRisk'].every(key=>options?.risk?.[key]===profile?.[key]),'APPLIED_AND_REVIEWED_RISK_MISMATCH');
  const summaries=[],series=[{timeframe:p?.metadata?.timeframe,timeframeMs:p?.metadata?.timeframeMs,bars:h?.baseBars},...rows(h?.higherTimeframes)];
  check(series.length===3&&json(series.map(entry=>entry.timeframe))===json(['1','5','15'])&&json(series.map(entry=>entry.timeframeMs))===json([60000,300000,900000]),'EXACT_1_5_15_SERIES_REQUIRED');
  check(json(rows(p?.series).map(entry=>({timeframe:entry.timeframe,bars:entry.bars})))===json(series.map(entry=>({timeframe:entry.timeframe,bars:rows(entry.bars).length}))),'REPORTED_CONTEXT_COUNTS_MISMATCH');
  for(const entry of series){
    const bars=rows(entry.bars),proof=deriveVerifiedSessionGaps(bars);check(Array.isArray(entry.bars)&&bars.length===expectedBars,'CONTEXT_COUNT_MISMATCH:'+entry.timeframe);check(proof.valid,'PROVIDER_SESSION_PROOF_INVALID:'+entry.timeframe);
    const valid=bars.every(bar=>integer(bar.time)&&integer(bar.closeTime)&&bar.closeTime-bar.time===entry.timeframeMs&&bar.closeTime<=h.sourceEmittedAt&&bar.closed===true&&bar.sourceClosed===true&&integer(bar.providerBarIndex)&&bar.providerBarIndex>=0&&typeof bar.sessionFirst==='boolean'&&typeof bar.sessionLast==='boolean'&&['open','high','low','close'].every(key=>finite(bar[key])&&Math.abs(bar[key]/.25-Math.round(bar[key]/.25))<=Math.max(1,Math.abs(bar[key]/.25))*Number.EPSILON*32)&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=bar.low&&(bar.volume===null||finite(bar.volume)&&bar.volume>=0&&bar.volume<=999999.999998&&Math.abs(bar.volume*1e6-Math.round(bar.volume*1e6))<=Math.max(1,Math.abs(bar.volume*1e6))*Number.EPSILON*32));check(valid,'CLOSED_OHLC_AND_TICK_ROWS_INVALID:'+entry.timeframe);
    if(entry.timeframe!=='1')check(json(entry.sessionGaps)===json(proof.gaps),'DECLARED_PROVIDER_GAPS_MISMATCH:'+entry.timeframe);
    summaries.push({timeframe:entry.timeframe,timeframeMs:entry.timeframeMs,bars:bars.length,firstOpenTime:bars[0]?.time??null,lastCloseTime:bars.at(-1)?.closeTime??null,firstProviderIndex:bars[0]?.providerBarIndex??null,lastProviderIndex:bars.at(-1)?.providerBarIndex??null,verifiedSessionGaps:proof.gaps,historySha256:sha(bars)});
  }
  let seedReparsed=false;
  if(plain(h)&&plain(b)&&series.length===3&&series.every(entry=>Array.isArray(entry.bars))){
    const gaps=deriveVerifiedSessionGaps(h.baseBars),header={schemaVersion:1,runId:h.runId,sourceEmittedAt:h.sourceEmittedAt,realtime:false,dataDelayUnverified:true,bootstrapOnly:true,reasonCodes:[]};
    const packets=[{...header,kind:'snapshot',sequence:1,metadata:{...h.metadata,sessionGaps:gaps.gaps},bars:h.baseBars},...h.higherTimeframes.map((entry,index)=>({...header,kind:'timeframe_snapshot',sequence:index+2,metadata:h.metadata,bars:[],higherTimeframes:[entry]}))],parsed=parseWindowBootstrapEvidence(packets.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet)),{tabId:recording.selectedTabId,receivedAt:p.capturedAt});
    seedReparsed=parsed.ok===true&&parsed.ready===true&&json(parsed.bootstrap)===json(b)&&json(parsed.bootstrapHistory)===json(h);check(seedReparsed,'RETAINED_PARSED_SEED_NOT_EXACTLY_REVALIDATED');
  }else check(false,'RETAINED_PARSED_SEED_REQUIRED');
  const riskExamples=[37,38].map(stopTicks=>{const plan=profile?planGuideRisk({...options?.risk,direction:'LONG',entry:28000,stop:28000-stopTicks*.25,tickSize:.25,stopBufferTicks:0}):null;return {stopTicks,priceRiskUsd:stopTicks*5,commissionAllowanceUsd:profile?.commissionPerContract??null,slippageAllowanceUsd:profile?profile.slippageTicks*5:null,perContractRiskUsd:plan?.perContractRisk??null,status:plan?.status??'UNAVAILABLE',quantity:plan?.quantity??null,reasonCodes:plan?.reasonCodes??[]};});
  check(riskExamples[0].perContractRiskUsd===198.1&&riskExamples[0].status==='PLANNED'&&riskExamples[0].quantity===1&&riskExamples[1].perContractRiskUsd===203.1&&riskExamples[1].status==='BLOCKED'&&riskExamples[1].quantity===0&&riskExamples[1].reasonCodes.includes('RISK_BUDGET_BELOW_ONE_CONTRACT'),'37_38_TICK_BUDGET_BOUNDARY_MISMATCH');
  return {kind:'PREOPEN_CONTEXT_EVIDENCE_AUDIT',schemaVersion:1,status:errors.length?'MISMATCH':'VERIFIED_PREOPEN_CONTEXT_ONLY',reasonCodes:[...new Set(errors)],extensionVersion:recording.extensionVersion??null,inputSha256:sha(recording),instrument:p?.metadata?.instrument??null,baseTimeframe:p?.metadata?.timeframe??null,runId:p?.runId??null,runEpoch:p?.runEpoch??null,contextReady:p?.status==='CONTEXT_READY',contextOnly:true,liveSignalVerified:false,naturalLivePositive:false,ordersAuthorized:false,series:summaries,retainedSeedSchemaAndProofReparsed:seedReparsed,bootstrapSha256:sha(b??null),seedSha256:sha(h??null),requiredContextFilters:['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME'],riskRequired:options?.config?.requireRisk===true,riskAssumptions:{riskBudget:profile?.riskBudget??null,maxContracts:profile?.maxContracts??null,pointValue:profile?.pointValue??null,tickSize:profile?.tickSize??null,commissionRoundTrip:profile?.commissionPerContract??null,slippageRoundTripTicks:profile?.slippageTicks??null,brokerVerified:false,commissionVerified:false,slippageVerified:false},riskExamples,currentLiveAlerts:rows(recording.alerts).length,currentDeliveries:rows(recording.alertDelivery).length,testProbes:rows(recording.deliveryProbes).length,sourceLatencySamples:rows(recording.sourceDomLatency?.samples).length,panelLatencySamples:rows(recording.latency?.samples).length,liveLatencyMs:null,limitations:['Retained parsed history is independently schema/proof checked and re-encoded for validation; original three raw bootstrap messages and all64 numeric frame values are not retained for original-wire/checksum replay.','Paired public-chart/run metadata and provider session flags establish recorded self-consistency, not independent source authentication.','Historical context readiness does not authorize live eligibility, approve a signal, imply a fill or measure live/source-to-display milliseconds.','Commission and round-trip slippage are explicit research assumptions, not authenticated account fees or observed execution costs.'],scope:'Closed historical NQ1/5/15 context and current-session fail-closed preopen state only. No account identifiers are included in this report.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [inputPath,outputPath,...extra]=process.argv.slice(2);if(!inputPath||extra.length)throw Error('Usage: node scripts/verify-preopen-recording.mjs RECORDING.json [REPORT.json]');
  const source=await readFile(inputPath,'utf8'),report=verifyPreopenRecording(JSON.parse(source));report.inputFile=resolve(inputPath);report.inputFileSha256=createHash('sha256').update(source).digest('hex');
  if(outputPath)await writeFile(outputPath,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({status:report.status,reasonCodes:report.reasonCodes,runEpoch:report.runEpoch,series:report.series.map(({timeframe,bars,verifiedSessionGaps})=>({timeframe,bars,verifiedSessionGaps:verifiedSessionGaps.length})),liveLatencyMs:report.liveLatencyMs,riskExamples:report.riskExamples,...(outputPath?{report:resolve(outputPath)}:{})},null,2));if(report.status==='MISMATCH')process.exitCode=1;
}
