import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {analyzeGuideSignals,GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
import {selectFreshLiveSignal} from '../live-signal-eligibility.mjs';
import {normalizeAccountProfile} from '../account-profile.mjs';
import {planGuideRisk} from '../guide-risk.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';

// Offline evidence audit only. No browser, network, broker or order API is used.
// A self-consistent exported fixture can pass; this is not source authentication.
const finite=Number.isFinite;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const rows=value=>Array.isArray(value)?value:[];
const normalize=value=>Array.isArray(value)?value.map(normalize):plain(value)?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,normalize(value[key])])):value;
const json=value=>JSON.stringify(normalize(value));
const digest=value=>createHash('sha256').update(json(value)).digest('hex');
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-6,Math.max(Math.abs(a),Math.abs(b))*Number.EPSILON*8);
const semantic=analysis=>Object.fromEntries(Object.entries(analysis??{}).filter(([key])=>key!=='cache'));
const synthetic=value=>value?.testOnly===true||value?.marketData===false||/^SYNTHETIC_TEST:/.test(value?.instrument??'')||/^CONTROLLED_/.test(value?.provider??'')||/^CONTROLLED_DELIVERY_PROBE\|/.test(value?.sourceId??'');
const finish=(reasonCodes,unavailableReasons,extra={})=>({status:reasonCodes.length?'MISMATCH':unavailableReasons.length?'PARTIAL':'VERIFIED',reasonCodes:[...new Set(reasonCodes)],unavailableReasons:[...new Set(unavailableReasons)],...extra});

function replayAnalysis(recording){
  const input=recording.analysisInputs,analysis=recording.latestAnalysis;
  if(!plain(input)||!Array.isArray(input.bars)||!plain(input.options)||!finite(input.options.asOfTime)||!plain(analysis))return {report:{status:'UNAVAILABLE',reasonCodes:['EXACT_ANALYSIS_INPUTS_NOT_RECORDED']},recomputed:null};
  if(analysis.definitionVersion!==GUIDE_SIGNAL_VERSION)return {report:{status:'UNAVAILABLE',reasonCodes:['ENGINE_DEFINITION_VERSION_CHANGED'],recordedVersion:analysis.definitionVersion??null,recomputedVersion:GUIDE_SIGNAL_VERSION},recomputed:null};
  let recomputed;
  try{recomputed=analyzeGuideSignals(input.bars,input.options);}catch(error){return {report:{status:'MISMATCH',reasonCodes:['ANALYSIS_REPLAY_THREW'],message:String(error.message).slice(0,200)},recomputed:null};}
  if(recomputed.definitionVersion!==analysis.definitionVersion)return {report:{status:'UNAVAILABLE',reasonCodes:['ENGINE_DEFINITION_VERSION_CHANGED'],recordedVersion:analysis.definitionVersion,recomputedVersion:recomputed.definitionVersion},recomputed:null};
  const completeMatch=json(semantic(analysis))===json(semantic(recomputed));
  return {report:{status:completeMatch?'MATCH':'MISMATCH',completeMatch,inputBars:input.bars.length,asOfTime:input.options.asOfTime,recordedSignals:rows(analysis.signals).length,recomputedSignals:recomputed.signals.length,recordedEvents:rows(analysis.events).length,recomputedEvents:recomputed.events.length,analysisInputsSha256:digest(input),recordedAnalysisSha256:digest(semantic(analysis)),recomputedAnalysisSha256:digest(semantic(recomputed)),excludedOperationalFields:['cache']},recomputed};
}

function auditClock(delivery){
  const errors=[],unknown=[],source=delivery?.sourceObservation,paint=delivery?.chartOverlay;
  if(!plain(paint)||paint.status!=='RENDERED')unknown.push('CHART_RENDER_NOT_COMPLETED');
  if(paint&&paint.mode!=='LIVE')errors.push('CHART_RECEIPT_NOT_LIVE');
  if(paint&&paint.eventId!==delivery.eventId)errors.push('CHART_EVENT_ID_MISMATCH');
  if(paint&&(paint.meaning!=='renderopportunitynotphysical'||paint.physicalDisplayMeasured!==false))errors.push('CHART_BOUNDARY_MISLABELED');
  if(!source)unknown.push('EXACT_SOURCE_OBSERVATION_NOT_RECORDED');
  else{
    if(source.packetId!==delivery.sourcePacketId)errors.push('SOURCE_OBSERVATION_PACKET_ID_MISMATCH');
    if(source.sourceObservationMeaning!=='FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME'||source.sourceTransport!=='PUBLIC_DATA_WINDOW_V2')errors.push('SOURCE_BOUNDARY_NOT_COHERENT_WINDOW_FRAME');
  }
  const token=source?.sourceDocumentTimeOrigin,paintToken=paint?.documentTimeOrigin;
  if(!finite(token)||!finite(paintToken))unknown.push('SOURCE_CHART_DOCUMENT_TOKEN_MISSING');
  else if(token!==paintToken)errors.push('SOURCE_CHART_DOCUMENT_TOKEN_MISMATCH');
  const stamps=[paint?.renderReceiptEpoch,paint?.mutationEpoch,paint?.firstPaintEpoch,paint?.secondPaintEpoch];
  if(stamps.some(stamp=>!finite(stamp)))unknown.push('CHART_RENDER_TIMESTAMPS_INCOMPLETE');
  else if(stamps.some((stamp,index)=>index&&stamp<stamps[index-1]))errors.push('CHART_RENDER_CLOCK_ORDER_INVALID');
  const appearance=source?.sourceAppearanceEpochMs;
  if(!finite(appearance))unknown.push('SOURCE_APPEARANCE_TIME_MISSING');
  else if(finite(paint?.renderReceiptEpoch)&&appearance>paint.renderReceiptEpoch)errors.push('SOURCE_APPEARANCE_AFTER_RENDER_RECEIPT');
  let lower=null,upper=null;
  if(!errors.length&&!unknown.length){
    lower=paint.firstPaintEpoch-appearance;upper=paint.secondPaintEpoch-appearance;
    if(lower<0||upper<lower)errors.push('SOURCE_CHART_CLOCK_ORDER_INVALID');
    if(delivery.correlationStatus!=='SAME_SOURCE_DOCUMENT_CLOCK')errors.push('SOURCE_CHART_CORRELATION_NOT_VERIFIED');
    if(!near(lower,delivery.sourceToChartPaintLowerMs)||!near(upper,delivery.sourceToChartPaintUpperMs))errors.push('SOURCE_CHART_RECORDED_BOUNDS_MISMATCH');
  }
  return finish(errors,unknown,{sourcePacketId:delivery?.sourcePacketId??null,documentTimeOrigin:finite(token)?token:null,lowerMs:errors.length||unknown.length?null:lower,upperMs:errors.length||unknown.length?null:upper,meaning:'First extension-observed coherent visible Data Window frame to two chart rendering opportunities, on the same source document performance clock. Not market, capture, network or physical display latency.'});
}

function auditRisk(item,metadata){
  const errors=[],unknown=[],review=item.accountReview,signal=item.signal??{},risk=signal.riskPlan;
  if(!review)unknown.push('PER_ALERT_ACCOUNT_REVIEW_MISSING');
  const normalized=normalizeAccountProfile(review?.profile);
  if(!normalized.ok)unknown.push('VALID_REVIEWED_PROFILE_MISSING');
  if(review){
    if(typeof review.reviewId!=='string'||!review.reviewId)unknown.push('ACCOUNT_REVIEW_ID_MISSING');
    if(!finite(review.reviewedAt)||!finite(item.receivedAt))unknown.push('ACCOUNT_REVIEW_TIME_MISSING');
    else if(review.reviewedAt>item.receivedAt)errors.push('ACCOUNT_REVIEW_AFTER_ALERT');
    if(review.ordersAuthorized!==false)errors.push('ACCOUNT_ORDERS_NOT_DISABLED');
  }
  if(risk?.status!=='PLANNED'||!Number.isSafeInteger(risk?.quantity)||risk.quantity<1)errors.push('PLANNED_POSITIVE_QUANTITY_REQUIRED');
  if(risk?.ordersCreated!==false||risk?.fillInferred!==false)errors.push('RISK_PLAN_ORDER_OR_FILL_CLAIM');
  let recomputed=null;
  if(normalized.ok){
    const profile=normalized.profile;
    if(!metadata)unknown.push('PER_ALERT_SOURCE_METADATA_NOT_RETAINED');
    else for(const key of ['instrument','currency','tickSize','pointValue'])if(metadata[key]!==profile[key]||signal[key]!==undefined&&signal[key]!==profile[key])errors.push('ACCOUNT_SOURCE_MISMATCH:'+key);
    if(risk?.quantity>profile.maxContracts||risk?.totalPlannedRisk>profile.riskBudget+1e-8)errors.push('RISK_EXCEEDS_REVIEWED_LIMIT');
    const parameters=signal.parameterSnapshot?.risk;
    if(!parameters)unknown.push('SIGNAL_RISK_PARAMETER_SNAPSHOT_MISSING');
    else for(const key of ['riskBudget','pointValue','maxContracts','commissionPerContract','slippageTicks','rewardRisk'])if(parameters[key]!==profile[key])errors.push('ACCOUNT_RISK_PARAMETER_MISMATCH:'+key);
    if(signal.parameterSnapshot?.config?.requireRisk!==true)errors.push('RISK_NOT_REQUIRED_BY_SIGNAL_CONFIG');
    if(signal.definitionVersion!==GUIDE_SIGNAL_VERSION)unknown.push('SIGNAL_RISK_RULE_VERSION_UNAVAILABLE');
    else if(risk&&parameters&&metadata){
      const config=signal.parameterSnapshot?.config,filters=signal.contextSnapshot,context=filters?.context,range=context?.range,zones=context?.zones,freezeTime=filters?.freezeTime;
      const supportedPolicy=['fixed_r','range_midpoint','opposite_boundary'].includes(config?.rangeTargetPolicy),rangeSetup=['RANGE_EDGE','ENGULFING_RANGE_RECLAIM'].includes(filters?.setupKind),usesRange=rangeSetup&&config?.rangeTargetPolicy!=='fixed_r';
      let target=null,targetReference=null,policy='fixed_r',contextValid=true;
      if(!supportedPolicy){errors.push('RISK_TARGET_POLICY_NOT_SUPPORTED');contextValid=false;}
      if(!plain(context)||!Array.isArray(zones)||!finite(freezeTime)||freezeTime!==signal.formationStartTime){errors.push('FROZEN_RISK_CONTEXT_INVALID');contextValid=false;}
      if(usesRange){
        const support=rows(zones).find(zone=>zone.id===range?.supportId),resistance=rows(zones).find(zone=>zone.id===range?.resistanceId);
        if(!plain(range)||![range.lower,range.upper,range.knownAt].every(finite)||range.upper<=range.lower||range.knownAt>freezeTime||typeof range.supportId!=='string'||typeof range.resistanceId!=='string'||support?.type!=='SUPPORT'||resistance?.type!=='RESISTANCE'||support.active===false||resistance.active===false||support.invalidatedAt!=null||resistance.invalidatedAt!=null||![support?.center,resistance?.center,support?.knownAt,resistance?.knownAt,support?.upper,resistance?.lower].every(finite)||support.knownAt>freezeTime||resistance.knownAt>freezeTime||!near(range.lower,support.center)||!near(range.upper,resistance.center)||range.knownAt!==Math.max(support.knownAt,resistance.knownAt)){
          errors.push('FROZEN_RANGE_TARGET_CONTEXT_INVALID');contextValid=false;
        }else{
          target=config.rangeTargetPolicy==='range_midpoint'?(range.lower+range.upper)/2:signal.direction==='LONG'?resistance.lower:support.upper;
          policy=config.rangeTargetPolicy;targetReference={rangeId:range.supportId+':'+range.resistanceId,knownAt:range.knownAt,price:target};
        }
      }
      const obstacles=rows(zones).filter(zone=>zone.active!==false&&zone.invalidatedAt==null&&(signal.direction==='LONG'?zone.type==='RESISTANCE'&&zone.lower>signal.confirmationClose:zone.type==='SUPPORT'&&zone.upper<signal.confirmationClose)).sort((a,b)=>signal.direction==='LONG'?a.lower-b.lower:b.upper-a.upper),obstacle=obstacles[0],obstaclePrice=obstacle?(signal.direction==='LONG'?obstacle.lower:obstacle.upper):null;
      if(obstacle&&(!finite(obstacle.knownAt)||obstacle.knownAt>freezeTime)){errors.push('RISK_OBSTACLE_NOT_FROZEN_AT_FORMATION');contextValid=false;}
      if(risk.researchTargetPolicy!==policy)errors.push('RISK_TARGET_POLICY_DECORATION_MISMATCH');
      if(json(risk.targetReference)!==json(targetReference))errors.push('RISK_TARGET_REFERENCE_DECORATION_MISMATCH');
      if(contextValid){
        // v3 invalidation is already the canonical buffered/ticked stop. The
        // target and nearest obstacle are independently selected from frozen
        // context; copied targetReference/obstaclePrice are never trusted inputs.
        recomputed=planGuideRisk({...parameters,direction:signal.direction,entry:signal.confirmationClose,stop:signal.invalidation,stopBufferTicks:0,tickSize:metadata.tickSize,...(finite(target)?{target}:{}),...(finite(obstaclePrice)?{obstaclePrice}:{})});
        recomputed.researchTargetPolicy=policy;recomputed.targetReference=targetReference;
        if(json(risk)!==json(recomputed))errors.push('INDEPENDENT_RISK_PLAN_MISMATCH');
      }
    }
  }
  return finish(errors,unknown,{profile:normalized.ok?normalized.profile:null,reviewId:review?.reviewId??null,totalPlannedRisk:risk?.totalPlannedRisk??null,quantity:risk?.quantity??null,commissionAllowance:risk?.commissionAllowance??null,slippageAllowance:risk?.slippageAllowance??null,arithmeticReplayed:!!recomputed,brokerAccountVerified:review?.brokerAccountVerified===true,commissionVerified:review?.commissionVerified===true,slippageVerified:review?.slippageVerified===true,costScope:'Explicit user-reviewed round-trip allowances, not authenticated broker commission or measured future slippage.'});
}

function auditSource(recording,item){
  const errors=[],unknown=[],signal=item.signal??{},matches=rows(recording.rawEvidence).filter(entry=>entry.id===item.sourcePacketId),raw=matches[0];
  if(matches.length>1)errors.push('DUPLICATE_RAW_PACKET_ID');
  let packet=null;
  if(!raw)unknown.push('EXACT_RAW_PACKET_NOT_RETAINED');
  else{
    const parsed=parsePineOhlcMessage(raw.raw,{receivedAt:raw.receivedAt,tabId:recording.selectedTabId});
    if(!parsed.ok)errors.push('RAW_PACKET_PARSE_FAILED:'+parsed.reasonCodes.join(','));
    else{
      packet=parsed.packet;
      if(parsed.id!==item.sourcePacketId)errors.push('RAW_PACKET_ID_MISMATCH');
      if(packet.kind!=='update'||packet.sequence%8!==4||packet.realtime!==true)errors.push('NONLIVE_OR_BOOTSTRAP_PACKET');
      if(packet.runId!==recording.selectedRun)unknown.push('ALERT_FROM_PREVIOUS_SOURCE_RUN');
      if(packet.metadata.instrument!==signal.instrument||packet.metadata.timeframe!==signal.timeframe)errors.push('SIGNAL_SOURCE_IDENTITY_MISMATCH');
      if(packet.metadata.chartType!=='standard'||packet.metadata.source!=='ohlc')errors.push('STANDARD_SOURCE_OHLC_REQUIRED');
      if(packet.sourceEmittedAt!==item.sourceEmittedAt||raw.receivedAt!==item.receivedAt)errors.push('ALERT_RAW_RECEIPT_IDENTITY_MISMATCH');
      if(Math.abs(packet.receivedAt-packet.sourceEmittedAt)>3000)errors.push('SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED');
      const final=packet.bars.find(bar=>bar.closeTime===signal.confirmationBarCloseTime);
      if(!final)unknown.push('CONFIRMING_CLOSED_BAR_NOT_IN_EXACT_PACKET');
      else if(final.closed!==true||final.sourceClosed!==true||final.close!==signal.confirmationClose)errors.push('CONFIRMING_PACKET_BAR_NOT_FINAL_OR_PRICE_MISMATCH');
    }
    const chart=raw.chart;
    if(chart?.visibleCharts!==1||rows(chart?.symbols).length!==1||chart.symbols[0]!==signal.instrument||chart.interval!==signal.timeframe||chart.replay!==false||chart.documentVisible!==true)errors.push('RAW_CHART_IDENTITY_REPLAY_OR_VISIBILITY_INVALID');
    if(!Array.isArray(raw.proofReasonCodes)||!Array.isArray(raw.accountReasonCodes))unknown.push('SOURCE_OR_ACCOUNT_PROOF_NOT_RECORDED');
    else if(raw.proofReasonCodes.length||raw.accountReasonCodes.length)errors.push('SOURCE_OR_ACCOUNT_PROOF_REJECTED');
    if(raw.accountReviewId!==item.accountReview?.reviewId)errors.push('SOURCE_ACCOUNT_REVIEW_ID_MISMATCH');
  }
  const poll=rows(recording.pollEvidence).find(entry=>'read:'+entry.pollId===item.readEventId&&rows(entry.sourcePacketIds).includes(item.sourcePacketId));
  if(!poll)unknown.push('EXACT_POLL_ID_AND_PACKET_NOT_RETAINED');
  else if(poll.liveEligible!==true)errors.push('POLL_NOT_LIVE_ELIGIBLE');
  const close=rows(recording.closeBoundarySamples).find(entry=>entry.sourcePacketId===item.sourcePacketId&&entry.closeTime===signal.confirmationBarCloseTime&&'read:'+entry.pollId===item.readEventId);
  if(!close)unknown.push('EXACT_ELIGIBLE_CLOSED_BOUNDARY_NOT_RETAINED');
  else if(close.eligibleLive!==true)errors.push('CLOSED_BOUNDARY_NOT_LIVE_ELIGIBLE');
  const bootstrap=recording.windowEvidence?.bootstrapMetadata;
  if(!bootstrap)unknown.push('WINDOW_BOOTSTRAP_METADATA_NOT_RECORDED');
  else if(packet){
    if(bootstrap.runId!==packet.runId)unknown.push('ALERT_BOOTSTRAP_FROM_PREVIOUS_RUN');
    else for(const key of ['instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'])if(bootstrap.metadata?.[key]!==packet.metadata[key])errors.push('COHERENT_SOURCE_METADATA_MISMATCH:'+key);
  }
  return finish(errors,unknown,{rawPacketRetained:!!raw,metadata:packet?.metadata??null,packetSequence:packet?.sequence??null,rawSourceSequence:packet?Math.floor(packet.sequence/8):null,readEventId:item.readEventId??null,confirmationCloseTime:signal.confirmationBarCloseTime??null,independentPerPacketNumericChecksumReplayAvailable:false,scope:'Exact retained derived source packet, chart proof, poll and eligible-close record. The export does not retain all 64 numeric DOM values for an independent per-alert checksum replay.'});
}

function auditApproval(recording,item,recomputed){
  const errors=[],unknown=[],signal=item.signal??{},inputs=recording.analysisInputs;
  if(signal.status!=='CONFIRMED')errors.push('SIGNAL_NOT_CONFIRMED');
  if(signal.orderEligible!==false||signal.execution!=='OBSERVATION_ONLY')errors.push('SIGNAL_ORDER_INTENT_NOT_DISABLED');
  const bootstrap=signal.liveEligibility?.bootstrapAsOfTime;
  if(!finite(bootstrap)||signal.liveEligibility?.policy!=='POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE')unknown.push('PER_ALERT_BOOTSTRAP_ELIGIBILITY_MISSING');
  else if(!finite(signal.formationStartTime)||signal.formationStartTime<bootstrap||signal.confirmedAt<bootstrap)errors.push('SIGNAL_FORMATION_PREDATES_BOOTSTRAP');
  if(finite(recording.store?.bootstrapAsOfTime)&&recording.store.bootstrapAsOfTime!==bootstrap)unknown.push('ALERT_FROM_DIFFERENT_STORE_BOOTSTRAP');
  let selected=null;
  if(signal.definitionVersion!==GUIDE_SIGNAL_VERSION)unknown.push('ALERT_RULE_VERSION_REPLAY_UNAVAILABLE');
  else if(!recomputed||!inputs)unknown.push('LATEST_ENGINE_REPLAY_UNAVAILABLE');
  else{
    const candidate=recomputed.signals.find(event=>event.eventId===signal.eventId);
    if(!candidate)unknown.push('ALERT_NOT_COVERED_BY_LATEST_ANALYSIS_INPUTS');
    else{
      selected=selectFreshLiveSignal(candidate,recomputed,{bootstrapAsOfTime:bootstrap,eligibleCloseTimes:[signal.confirmationBarCloseTime],bars:inputs.bars});
      if(!selected)errors.push('REPLAY_POST_BOOTSTRAP_SELECTION_REJECTED');
      else if(json(selected)!==json(signal)){
        // Latest inputs can grow or roll after an older approval. They are not
        // necessarily that historical decision's exact input object.
        if(inputs.options.asOfTime!==signal.confirmedAt)unknown.push('PRIOR_ALERT_NOT_EXACTLY_REPRODUCED_FROM_LATEST_INPUTS');
        else errors.push('REPLAY_APPROVED_SIGNAL_MISMATCH');
      }
    }
  }
  return finish(errors,unknown,{bootstrapAsOfTime:bootstrap??null,formationStartTime:signal.formationStartTime??null,confirmedAt:signal.confirmedAt??null,exactSelectedSignalMatch:!!selected&&json(selected)===json(signal),scope:'Latest captured bars/options are independently replayed. Prior approvals not covered by those retained inputs remain partial; no per-alert decision input is invented.'});
}

export function verifyLiveDeliveryRecording(recording){
  if(!plain(recording))throw TypeError('RECORDING_OBJECT_REQUIRED');
  const globalErrors=[];
  if(recording.kind!=='LIVE_OHLC_OBSERVATION'||recording.sourceTransport!=='window')globalErrors.push('LIVE_WINDOW_RECORDING_REQUIRED');
  if(recording.orderEligible!==false)globalErrors.push('RECORDING_ORDERS_NOT_DISABLED');
  const sourceMetadata=recording.store?.metadata??recording.analysisInputs?.options?.metadata;
  if(synthetic(recording)||synthetic(sourceMetadata)||synthetic(recording.analysisInputs?.options?.metadata)||/^CONTROLLED_DELIVERY_PROBE\|/.test(recording.selectedRun??''))globalErrors.push('SYNTHETIC_OR_TEST_SOURCE');
  const replay=replayAnalysis(recording),alerts=rows(recording.alerts),deliveries=rows(recording.alertDelivery),checks=[];
  for(const delivery of deliveries){
    const errors=[],unknown=[];
    if(delivery.mode!=='LIVE'||delivery.testOnly!==false)errors.push('TEST_DELIVERY_CANNOT_PROVE_MARKET_SIGNAL');
    if(delivery.cancelled===true)errors.push('DELIVERY_CANCELLED');
    const matches=alerts.filter(item=>item.signal?.eventId===delivery.eventId&&item.sourcePacketId===delivery.sourcePacketId&&item.readEventId===delivery.readEventId),item=matches[0];
    if(matches.length!==1)errors.push(matches.length?'AMBIGUOUS_LIVE_ALERT_JOIN':'EXACT_LIVE_ALERT_NOT_RECORDED');
    let source=null,approval=null,risk=null;
    if(item){
      if(synthetic(item.signal))errors.push('SYNTHETIC_OR_TEST_SIGNAL');
      source=auditSource(recording,item);approval=auditApproval(recording,item,replay.recomputed);risk=auditRisk(item,source.metadata);
      if(!finite(item.approvedAtReceiverEpoch)||item.approvedAtReceiverEpoch!==delivery.approvedAtReceiverEpoch)errors.push('APPROVAL_RECEIVER_IDENTITY_MISMATCH');
      if(!finite(delivery.chartRequestEpoch)||delivery.chartRequestEpoch<delivery.approvedAtReceiverEpoch||!finite(delivery.chartReplyEpoch)||delivery.chartReplyEpoch<delivery.chartRequestEpoch)errors.push('RECEIVER_DELIVERY_CLOCK_ORDER_INVALID');
    }
    const timing=auditClock(delivery),parts=[source,approval,risk,timing].filter(Boolean);
    if(parts.some(part=>part.status==='MISMATCH'))errors.push('EVIDENCE_COMPONENT_MISMATCH');
    if(parts.some(part=>part.status==='PARTIAL'))unknown.push('EVIDENCE_COMPONENT_INCOMPLETE');
    if(replay.report.status==='MISMATCH')errors.push('LATEST_COMPLETE_ENGINE_REPLAY_MISMATCH');
    else if(replay.report.status!=='MATCH')unknown.push('LATEST_COMPLETE_ENGINE_REPLAY_UNAVAILABLE');
    checks.push(finish([...globalErrors,...errors],unknown,{eventId:delivery.eventId??null,sourcePacketId:delivery.sourcePacketId??null,source,approval,risk,timing}));
  }
  const verified=checks.filter(check=>check.status==='VERIFIED'),partial=checks.filter(check=>check.status==='PARTIAL'),mismatched=checks.filter(check=>check.status==='MISMATCH');
  const undelivered=alerts.filter(item=>!deliveries.some(delivery=>delivery.eventId===item.signal?.eventId&&delivery.sourcePacketId===item.sourcePacketId&&delivery.readEventId===item.readEventId));
  return {kind:'LIVE_DELIVERY_EVIDENCE_AUDIT',schemaVersion:1,status:globalErrors.length||mismatched.length?'MISMATCH':verified.length?'VERIFIED_RECORDED_LIVE_DELIVERY':checks.length||alerts.length?'PARTIAL':'NO_LIVE_DELIVERY_RECORDED',reasonCodes:globalErrors,extensionVersion:recording.extensionVersion??null,exportedAt:recording.exportedAt??null,inputSha256:digest(recording),instrument:sourceMetadata?.instrument??null,timeframe:sourceMetadata?.timeframe??null,liveAlerts:alerts.length,deliveryRecords:deliveries.length,verified:verified.length,partial:partial.length,mismatched:mismatched.length,alertsWithoutDeliveryRecord:undelivered.map(item=>({eventId:item.signal?.eventId??null,sourcePacketId:item.sourcePacketId??null})),testProbes:rows(recording.deliveryProbes).length,analysisReplay:replay.report,checks,verifiedSourceToChartBounds:verified.map(check=>({eventId:check.eventId,lowerMs:check.timing.lowerMs,upperMs:check.timing.upperMs})),scope:'Self-consistency of recorded ordinary LIVE approval, source/poll/close identities, independent engine/risk replay and same-document chart render-opportunity timestamps. TEST probes never establish a natural-market positive. Source authenticity, profitability, broker fees, order fills and physical pixels require separate evidence.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [inputPath,outputPath,...extra]=process.argv.slice(2);
  if(!inputPath||extra.length)throw Error('Usage: node scripts/verify-live-delivery.mjs LIVE.json [REPORT.json]');
  const text=await readFile(inputPath,'utf8'),report=verifyLiveDeliveryRecording(JSON.parse(text));
  report.inputFile=resolve(inputPath);report.inputFileSha256=createHash('sha256').update(text).digest('hex');
  if(outputPath)await writeFile(outputPath,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({status:report.status,liveAlerts:report.liveAlerts,verified:report.verified,partial:report.partial,mismatched:report.mismatched,testProbes:report.testProbes,analysisReplay:report.analysisReplay.status,verifiedSourceToChartBounds:report.verifiedSourceToChartBounds,...(outputPath?{report:resolve(outputPath)}:{})},null,2));
  if(report.status==='MISMATCH')process.exitCode=1;
}
