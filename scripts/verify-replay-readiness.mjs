import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {normalizeReplayDataset,buildReplayAnalysisInput,selectReplayDecision,REPLAY_REQUIRED_FLAGS,REPLAY_EXTENSION_VERSION} from '../replay-research.mjs';

// Offline only. Native historical CSV availability is assumed at bar close;
// source authenticity, live execution, fees, fills and physical pixels are not
// established by a self-consistency replay.
const here=dirname(fileURLToPath(import.meta.url)),canonicalPath=resolve(here,'..','verification','nq-replay','native-NQ-merged-replay.json');
const expectedCanonicalHash='00979f9dff5941ba51094b163a4f8e5bee4d6e44f31d14b8895863ea7d964983';
const witnessFields=['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END','ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'];
const sha=value=>createHash('sha256').update(value).digest('hex'),json=value=>JSON.parse(JSON.stringify(value)),near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-5;
const rows=value=>Array.isArray(value)?value:[];
export function verifyReplayReadiness(recording,canonicalBytes,{previous=null}={}){
  const errors=[],check=(ok,reason)=>{if(!ok)errors.push(reason);},latest=recording.latest,w=latest?.replayWitness,receipt=latest?.timing?.chartReceipt;
  if(!latest||!w||!receipt)throw Error('COMPLETE_REPLAY_CAPTURE_REQUIRED');
  check(recording.kind==='NQ_REPLAY_RESEARCH_EXPORT'&&latest.kind==='NQ_REPLAY_RESEARCH_OBSERVATION','REPLAY_EXPORT_KIND');
  check(recording.schemaVersion===1&&typeof latest.sessionId==='string'&&latest.sessionId.startsWith('REPLAY:')&&Number.isSafeInteger(latest.sourceTabId)&&latest.sourceTabId>0,'OWNED_REPLAY_SESSION_BINDING');
  check(recording.extensionVersion===REPLAY_EXTENSION_VERSION&&latest.extensionVersion===REPLAY_EXTENSION_VERSION,'EXTENSION_VERSION_MISMATCH');
  check(recording.mode==='REPLAY'&&latest.mode==='REPLAY'&&receipt.mode==='REPLAY','DEDICATED_REPLAY_MODE');
  check([recording,latest].every(item=>item.liveEligible===false&&item.orderEligible===false)&&latest.testOnly===false,'HISTORICAL_RESEARCH_NOT_LIVE_OR_TEST');
  const canonicalHash=sha(canonicalBytes),dataset=normalizeReplayDataset(JSON.parse(canonicalBytes.toString('utf8')));
  check(canonicalHash===expectedCanonicalHash&&canonicalBytes.length===248728,'KNOWN_CANONICAL_NATIVE_IMPORT_HASH');
  check(latest.inputFile?.sha256===canonicalHash&&latest.inputFile.bytes===canonicalBytes.length,'CANONICAL_IMPORT_BYTE_HASH');
  const risk=latest.analysisInputs?.options?.risk;
  check(risk?.riskBudget===200&&risk.maxContracts===1&&risk.pointValue===20&&risk.commissionPerContract===3.10&&risk.slippageTicks===2,'EXPLICIT_NQ_ONE_CONTRACT_200_COST_ASSUMPTIONS');
  check(REPLAY_REQUIRED_FLAGS.every(flag=>latest.analysisInputs?.options?.config?.[flag]===true)&&latest.analysisInputs?.options?.contextConfig?.supplyDemandEnabled===true,'ALL_SEVEN_MANDATORY_FLAGS');
  check(latest.analysisInputs?.options?.contextConfig?.roleReversalEnabled===true,'ALL_NINE_SCENARIO_FAMILIES_ENABLED');
  const evidence={chart:latest.chart,replayWitness:w,messages:[],contextOnly:true,liveEligible:false},rebuilt=buildReplayAnalysisInput(dataset,evidence,{commissionPerContract:risk.commissionPerContract,slippageTicks:risk.slippageTicks});
  check(isDeepStrictEqual(json(latest.analysisInputs),json({bars:rebuilt.bars,options:rebuilt.options})),'EXACT_NATIVE_IMPORT_PREFIX_REBUILD');
  check(isDeepStrictEqual(json(latest.cutoff),json(rebuilt.cutoff)),'RECORDED_CUTOFF_REBUILD');
  check(rebuilt.bars.every(bar=>bar.closed&&bar.knownAt===bar.closeTime&&bar.closeTime<=rebuilt.options.asOfTime)&&Object.values(rebuilt.options.higherTimeframes).every(tf=>tf.bars.every(bar=>bar.closed&&bar.knownAt===bar.closeTime&&bar.closeTime<=rebuilt.options.asOfTime)),'FUTURE_BASE_AND_HIGHER_EXCLUDED');
  if(!w.current.closed)check(!rebuilt.bars.some(bar=>bar.time===w.current.time)&&rebuilt.options.asOfTime===w.current.time&&w.previous.sourceClosed===true,'FORMING_CURRENT_EXCLUDED');
  const analysis=analyzeGuideSignals(rebuilt.bars,rebuilt.options),decision=selectReplayDecision(analysis,rebuilt.options.asOfTime);
  check(isDeepStrictEqual(json(analysis),json(latest.analysis)),'UNCHANGED_ENGINE_FULL_ANALYSIS_REPLAY');
  check(isDeepStrictEqual(json(decision),json(latest.decision)),'UNCHANGED_CURRENT_CLOSE_DECISION_REPLAY');
  const numberField=name=>{const text=w.fields?.[name];if(typeof text!=='string'||!/^\d+$/.test(text.replace(/[,\s\u00a0\u202f]/g,'')))return NaN;const value=Number(text.replace(/[,\s\u00a0\u202f]/g,''));return Number.isSafeInteger(value)?value:NaN;};
  check(w.fields&&Object.keys(w.fields).length===7&&witnessFields.every(name=>Object.hasOwn(w.fields,name)&&typeof w.fields[name]==='string'&&w.fields[name].length>0&&w.fields[name].length<=128),'EXACT_SEVEN_RAW_WITNESS_FIELDS');
  check(Number.isSafeInteger(w.runEpoch)&&w.runEpoch>=1577836800000&&w.runId==='CME_MINI:NQ1!|1|'+w.runEpoch&&Number.isSafeInteger(w.sequence)&&w.sequence>=0,'EXACT_PUBLIC_SOURCE_RUN_BINDING');
  check(numberField('ARROW2_RUN_EPOCH')===w.runEpoch&&numberField('ARROW2_SEQ_BEGIN')===w.sequence&&numberField('ARROW2_SEQ_END')===w.sequence,'PUBLIC_WITNESS_RUN_AND_SEQUENCE_FIELDS');
  const tag=w.sequence%4096;
  check(numberField('ARROW2_CURRENT_TIME')-tag*1e12+1577836800000===w.current.time&&w.currentTime===w.current.time&&w.currentCloseTime===w.current.closeTime,'PUBLIC_WITNESS_CURRENT_TIME');
  check(numberField('ARROW2_CURRENT_CLOSE_TIME')-tag*1e12===w.current.providerBarIndex*4+(w.current.sessionFirst?1:0)+(w.current.sessionLast?2:0),'PUBLIC_V3_PROVIDER_CLOSE_CARRIER');
  check(w.kind==='TRADINGVIEW_REPLAY_WINDOW_WITNESS'&&w.mode==='REPLAY'&&w.replay===true&&w.liveEligible===false&&w.checksumsVerified===true&&['ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'].every(name=>Number.isSafeInteger(numberField(name))),'RECORDED_VALIDATED_WITNESS');
  check(receipt.status==='RENDERED'&&receipt.live===false&&receipt.orderEligible===false&&receipt.ordersCreated===false&&receipt.testOnly===false&&receipt.approvedHistorical===(decision.status==='CONFIRMED')&&receipt.decisionStatus===decision.status,'HISTORICAL_CHART_RECEIPT_STATUS');
  check(receipt.eventId==='REPLAY:'+(decision.status==='CONFIRMED'?decision.signal.eventId:w.runId+':'+w.sequence+':'+w.currentTime+':'+decision.asOfTime+':'+decision.status)&&receipt.sourceRunId===w.runId&&receipt.sourceSequence===w.sequence,'EXACT_REPLAY_EVENT_AND_SOURCE_JOIN');
  const times=[w.sourceObservedEpochMs,receipt.renderReceiptEpoch,receipt.mutationEpoch,receipt.firstPaintEpoch,receipt.secondPaintEpoch];
  check(times.every(Number.isFinite)&&times.every((value,index)=>index===0||value>=times[index-1])&&receipt.documentTimeOrigin===w.sourceDocumentTimeOrigin&&receipt.sourceObservedEpochMs===w.sourceObservedEpochMs,'SAME_SOURCE_DOCUMENT_ORDERED_TIMESTAMPS');
  check(Number.isFinite(w.sourceDocumentTimeOrigin)&&w.sourceDocumentTimeOrigin>0&&times.every(value=>value>=w.sourceDocumentTimeOrigin),'VALID_SOURCE_DOCUMENT_TIME_ORIGIN');
  check(near(receipt.sourceToChartLowerMs,receipt.firstPaintEpoch-w.sourceObservedEpochMs)&&near(receipt.sourceToChartUpperMs,receipt.secondPaintEpoch-w.sourceObservedEpochMs),'SOURCE_TO_CHART_BOUND_ARITHMETIC');
  check(receipt.meaning==='HISTORICAL_REPLAY_UI_RENDER_OPPORTUNITIES_NOT_LIVE_LATENCY'&&receipt.marketToDisplayMeasured===false&&receipt.networkLatencyMeasured===false&&receipt.physicalDisplayMeasured===false&&latest.timing.marketToDisplayMeasured===false&&latest.timing.captureToPhysicalDisplayMeasured===false,'EXPLICIT_HISTORICAL_UI_TIMING_SCOPE');
  const t=latest.timing;check([t.receiverReadMs,t.analysisMs,t.overlayRoundTripMs,t.receiverOperationMs].every(value=>Number.isFinite(value)&&value>=0)&&t.receiverOperationMs+1e-5>=t.receiverReadMs+t.analysisMs+t.overlayRoundTripMs,'RECEIVER_OPERATION_DURATION_CONSISTENCY');
  check(rows(recording.journal).every(entry=>entry.liveEligible===false&&entry.timing?.chartReceipt?.mode==='REPLAY'&&entry.timing.chartReceipt.live===false),'REPLAY_ONLY_JOURNAL');
  const journalLast=rows(recording.journal).at(-1);
  check(!!journalLast&&journalLast.asOfTime===decision.asOfTime&&journalLast.status===decision.status&&isDeepStrictEqual(json(journalLast.cutoff),json(latest.cutoff))&&isDeepStrictEqual(json(journalLast.timing),json(latest.timing)),'LATEST_JOURNAL_ENTRY_MATCHES_CURRENT_DECISION');
  let progression=null;
  if(previous){const p=previous.latest;check(previous.extensionVersion===REPLAY_EXTENSION_VERSION&&p?.extensionVersion===REPLAY_EXTENSION_VERSION,'PREVIOUS_CAPTURE_VERSION_MISMATCH');check(!!p&&p.sessionId===latest.sessionId&&p.sourceTabId===latest.sourceTabId&&p.replayWitness.runId===w.runId&&p.replayWitness.runEpoch===w.runEpoch&&p.inputFile.sha256===canonicalHash,'SAME_OWNED_REPLAY_SESSION_AND_METADATA_BINDING');check(decision.asOfTime===p.decision.asOfTime+60000&&w.currentTime===p.replayWitness.currentTime+60000,'ONE_REAL_REPLAY_BAR_FORWARD');check(receipt.eventId!==p.timing.chartReceipt.eventId,'DISTINCT_REPLAY_STEP_EVENT_ID');progression={previousCutoff:p.decision.asOfTime,currentCutoff:decision.asOfTime,cutoffAdvanceMs:decision.asOfTime-p.decision.asOfTime,sameSession:latest.sessionId===p.sessionId,sameSourceRun:w.runId===p.replayWitness.runId,previousSequence:p.replayWitness.sequence,currentSequence:w.sequence,currentPineRealtimeExecution:w.pineRealtimeExecution};}
  const currentDirections=Object.fromEntries(['LONG','SHORT'].map(side=>{const d=analysis.currentChecks?.directions?.[side];return [side,{conditionsMet:d?.conditionsMet??0,passed:d?.passed??false,reasonCodes:d?.reasonCodes??[],checks:rows(d?.checks).map(({id,required,enabled,available,passed,state,reasonCodes})=>({id,required,enabled,available,passed,state,reasonCodes}))}];}));
  return {kind:'INDEPENDENT_NQ_REPLAY_CAPTURE_AUDIT',schemaVersion:1,status:errors.length?'MISMATCH':'VERIFIED_HISTORICAL_REPLAY_UI_DECISION',reasonCodes:errors,extensionVersion:recording.extensionVersion,exportedAt:recording.exportedAt,canonicalImportSha256:canonicalHash,sessionId:latest.sessionId,sourceRunId:w.runId,sourceSequence:w.sequence,pineRealtimeExecution:w.pineRealtimeExecution,cutoff:rebuilt.cutoff,data:{importedBaseBars:dataset.bars.length,analyzedBaseBars:rebuilt.bars.length,analyzedHigherBars:Object.fromEntries(Object.entries(rebuilt.options.higherTimeframes).map(([name,tf])=>[name,tf.bars.length]))},riskAssumptions:risk,allSevenMandatoryFlags:REPLAY_REQUIRED_FLAGS.every(flag=>latest.analysisInputs?.options?.config?.[flag]===true),allNineScenarioFamiliesEnabled:latest.analysisInputs?.options?.contextConfig?.roleReversalEnabled===true,ordersAuthorized:false,engineReplay:{fullAnalysisMatched:!errors.includes('UNCHANGED_ENGINE_FULL_ANALYSIS_REPLAY'),decisionMatched:!errors.includes('UNCHANGED_CURRENT_CLOSE_DECISION_REPLAY'),analysisStatus:analysis.status,stats:analysis.stats,currentDirections},decision:{status:decision.status,currentHistoricalApprovals:decision.confirmedAtCurrentClose,pending:decision.pending},chartReceipt:{status:receipt.status,mode:receipt.mode,eventId:receipt.eventId,approvedHistorical:receipt.approvedHistorical,sourceDocumentTimeOrigin:w.sourceDocumentTimeOrigin,sourceObservedEpochMs:w.sourceObservedEpochMs,renderReceiptEpoch:receipt.renderReceiptEpoch,mutationEpoch:receipt.mutationEpoch,firstPaintEpoch:receipt.firstPaintEpoch,secondPaintEpoch:receipt.secondPaintEpoch,sourceToChartLowerMs:receipt.sourceToChartLowerMs,sourceToChartUpperMs:receipt.sourceToChartUpperMs},manualTimingMs:{read:t.receiverReadMs,engine:t.analysisMs,overlayRoundTrip:t.overlayRoundTripMs,wholeOperation:t.receiverOperationMs},progression,limits:{historicalAvailabilityAssumedAtBarClose:true,liveMarketApprovalProven:false,brokerFeesVerifiedForUser:false,slippageVerifiedForUser:false,fullRawChecksumRecomputedFromExport:false,networkLatencyMeasured:false,physicalDisplayMeasured:false,profitabilityProven:false},scope:'Same recorded canonical native historical import, causal bar-close assumptions, unchanged strict engine and exact current-close decision, plus self-consistency of public source witness and historical Replay UI rendering opportunities. No LIVE or TEST approval is substituted.'};
}
async function main(){
  const [captureArg,reportArg,previousArg,...extra]=process.argv.slice(2);if(!captureArg||!reportArg||extra.length)throw Error('Usage: node scripts/verify-replay-readiness.mjs CAPTURE.json NEW_REPORT.json [PREVIOUS_CAPTURE.json]');
  const capturePath=resolve(captureArg),reportPath=resolve(reportArg),outputRoot=resolve(here,'..','verification'),child=relative(outputRoot,reportPath);
  if(!child||isAbsolute(child)||child==='..'||child.startsWith('..\\')||child.startsWith('../')||reportPath.toLowerCase()===capturePath.toLowerCase()||reportPath.toLowerCase()===canonicalPath.toLowerCase()||previousArg&&reportPath.toLowerCase()===resolve(previousArg).toLowerCase())throw Error('NEW_REPORT_MUST_STAY_IN_VERIFICATION_AND_NOT_OVERWRITE_INPUT');
  if((await stat(capturePath)).size>80*1024*1024||previousArg&&(await stat(resolve(previousArg))).size>80*1024*1024)throw Error('CAPTURE_TOO_LARGE');
  const [bytes,canonicalBytes,previousBytes]=await Promise.all([readFile(capturePath),readFile(canonicalPath),previousArg?readFile(resolve(previousArg)):Promise.resolve(null)]),report=verifyReplayReadiness(JSON.parse(bytes),canonicalBytes,{previous:previousBytes?JSON.parse(previousBytes):null});
  report.inputFile=capturePath;report.inputFileSha256=sha(bytes);
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  console.log(JSON.stringify({status:report.status,reasonCodes:report.reasonCodes,analyzedBaseBars:report.data.analyzedBaseBars,decision:report.decision,sourceToChartLowerMs:report.chartReceipt.sourceToChartLowerMs,sourceToChartUpperMs:report.chartReceipt.sourceToChartUpperMs,manualTimingMs:report.manualTimingMs,progression:report.progression,reportPath},null,2));if(report.reasonCodes.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
