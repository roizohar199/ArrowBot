import {planGuideRisk} from './guide-risk.mjs';
import {GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from './guide-technical-decision.mjs';

export const CANDLE_MARKER_SCHEMA='ARROW_CANDLE_MARKERS_V1';
export const TECHNICAL_CANDLE_MARKER_SCHEMA='ARROW_TECHNICAL_MARKERS_V1';
export const CANDLE_MARKER_LIMITS=Object.freeze({maxMarkers:20,maxCharacters:8192,maxBars:600,maxTechnicalBars:3000});
export const LIVE_DIRECTION_MARKER_LIMITS=Object.freeze({maxMarkers:100,maxCharacters:32768});
export const CANDLE_MARKER_COLORS=Object.freeze({LONG:'#7dd3fc',SHORT:'#fb923c'});
export const CANDLE_MARKER_NATIVE_FIELDS=Object.freeze(['ARROW_MARKER_SCHEMA','ARROW_MARKER_SIGNATURE','ARROW_MARKER_EXPECTED_COUNT','ARROW_MARKER_MATCHED_COUNT','ARROW_MARKER_DRAWN_COUNT','ARROW_MARKER_MODE','ARROW_MARKER_LAST_TIME','ARROW_MARKER_LAST_PRICE_TICKS','ARROW_MARKER_LAST_DIRECTION','ARROW_MARKER_CUTOFF','ARROW_MARKER_CONTEXT_VALID']);
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_!:.|-/\n';
const flags=['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const checkIds=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value),finite=Number.isFinite,integer=Number.isSafeInteger;
const equal=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-7;
const tick=value=>finite(value)&&integer(value/.25)&&value>0;
const validTime=value=>integer(value)&&value>=0&&value<=8640000000000000;
const eventId=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\u0000-\u001f\u007f]/.test(value);
const clone=value=>structuredClone(value);

// This bounded, non-security checksum is independently recomputed in Pine.
// It binds UI delivery to the exact text; it does not authenticate market data.
export function candleMarkerPayloadSignature(text){
  if(typeof text!=='string'||text.length>LIVE_DIRECTION_MARKER_LIMITS.maxCharacters)throw TypeError('INVALID_CANDLE_MARKER_TEXT');
  let hash=17;
  for(const char of text){const position=alphabet.indexOf(char);if(position<0)throw TypeError('UNREPRESENTABLE_CANDLE_MARKER_CHARACTER');hash=(hash*31+position+1)%1000000007;}
  return hash;
}
function shortId(text){let hash=17;for(let i=0;i<text.length;i++)hash=(hash*31+text.charCodeAt(i)+1)%1000000007;return hash;}
function strictFilters(value){
  return flags.every(key=>value?.parameterSnapshot?.config?.[key]===true)&&value.parameterSnapshot.contextConfig?.roleReversalEnabled===true&&value.parameterSnapshot.contextConfig?.supplyDemandEnabled===true&&value.contextSnapshot?.passed===true&&Array.isArray(value.contextSnapshot.checks)&&checkIds.every(id=>{
    const rows=value.contextSnapshot.checks.filter(row=>row?.id===id);
    return rows.length===1&&['required','enabled','available','passed'].every(key=>rows[0][key]===true)&&rows[0].state==='PASS';
  });
}
function riskFor(signal,metadata){
  const risk=signal.parameterSnapshot?.risk,plan=signal.riskPlan;
  if(!plain(risk)||risk.riskBudget!==200||risk.maxContracts!==1||risk.pointValue!==20||![risk.commissionPerContract,risk.slippageTicks].every(n=>finite(n)&&n>=0)||!plain(plan)||plan.status!=='PLANNED'||plan.quantity!==1||plan.ordersCreated!==false||plan.fillInferred!==false||plan.actualEntry!==null||plan.plannedEntry!==signal.confirmationClose||plan.effectiveEntry!==plan.plannedEntry||plan.initialStop!==signal.invalidation||![plan.plannedEntry,plan.initialStop,plan.target].every(tick))return null;
  const calculated=planGuideRisk({direction:signal.direction,entry:plan.plannedEntry,stop:plan.initialStop,target:plan.target,tickSize:metadata.tickSize,pointValue:20,riskBudget:200,maxContracts:1,commissionPerContract:risk.commissionPerContract,slippageTicks:risk.slippageTicks,rewardRisk:risk.rewardRisk,stopBufferTicks:0});
  return calculated.status==='PLANNED'&&calculated.quantity===1&&calculated.totalPlannedRisk>0&&calculated.totalPlannedRisk<=200&&equal(calculated.totalPlannedRisk,plan.totalPlannedRisk)&&equal(calculated.perContractRisk,plan.perContractRisk)&&equal(calculated.commissionAllowance,plan.commissionAllowance)&&equal(calculated.slippageAllowance,plan.slippageAllowance)?calculated:null;
}

/** Native drawing payload only. Analysis/source provenance remains the caller's
 * responsibility, as in the recorded LIVE/Replay paths. This function does not
 * convert a component fixture into independently verified market evidence.
 */
export function buildApprovedCandleMarkerPayload(input={}){
  const {analysis,bars,metadata=analysis?.metadata,sourceMode,asOfTime=analysis?.asOfTime,approvedSignals,testOnly=false,maxMarkers=CANDLE_MARKER_LIMITS.maxMarkers}=input??{};
  const base={schemaVersion:1,kind:'APPROVED_NATIVE_CANDLE_MARKER_PAYLOAD',status:'BLOCKED',sourceMode,records:[],textPayload:null,payloadSignature:null,reasonCodes:[],ordersCreated:false,orderEligible:false,fillInferred:false,physicalPixelsVerified:false,markerPlacement:'NATIVE_BAR_TIME_AND_PRICE',nativeSize:'normal',colors:CANDLE_MARKER_COLORS};
  const block=reason=>({...base,reasonCodes:[reason]});
  if(testOnly!==false||analysis?.testOnly===true||metadata?.synthetic===true||metadata?.testOnly===true)return block('TEST_OR_SYNTHETIC_MARKER_SOURCE_REJECTED');
  if(!['LIVE','REPLAY'].includes(sourceMode)||!validTime(asOfTime)||!integer(maxMarkers)||maxMarkers<1||maxMarkers>CANDLE_MARKER_LIMITS.maxMarkers)return block('EXPLICIT_BOUNDED_MARKER_SCOPE_REQUIRED');
  if(!plain(metadata)||metadata.source!=='ohlc'||!/^CME_MINI:NQ(?:1!|[HMUZ]20\d\d)$/.test(metadata.instrument??'')||metadata.timeframe!=='1'||metadata.timeframeMs!==60000||metadata.tickSize!==.25||metadata.pointValue!==20||metadata.currency!=='USD'||!['standard','candles'].includes(metadata.chartType)||metadata.replay!==(sourceMode==='REPLAY')||metadata.realtime!==(sourceMode==='LIVE'))return block('EXACT_NATIVE_NQ_ONE_MINUTE_SOURCE_REQUIRED');
  if(!plain(analysis)||analysis.definitionVersion!==GUIDE_SIGNAL_VERSION||analysis.sourceKind!=='original_research_definition'||analysis.execution!=='OBSERVATION_ONLY'||analysis.orderEligible!==false||analysis.dataQuality?.valid!==true||analysis.asOfTime!==asOfTime||analysis.status==='BLOCKED'||!Array.isArray(analysis.events)||!Array.isArray(analysis.signals)||['instrument','timeframe','timeframeMs','tickSize','pointValue','currency','chartType','replay','realtime'].some(key=>analysis.metadata?.[key]!==metadata[key]))return block('VALID_SCOPED_ENGINE_ANALYSIS_REQUIRED');
  if(flags.some(key=>analysis.parameterSnapshot?.config?.[key]!==true)||analysis.parameterSnapshot?.contextConfig?.roleReversalEnabled!==true||analysis.parameterSnapshot.contextConfig?.supplyDemandEnabled!==true)return block('ALL_MANDATORY_MARKER_FILTERS_REQUIRED');
  if(!Array.isArray(bars)||bars.length<1||bars.length>CANDLE_MARKER_LIMITS.maxBars)return block('BOUNDED_CLOSED_MARKER_BARS_REQUIRED');
  for(let i=0;i<bars.length;i++){
    const bar=bars[i];
    if(!plain(bar)||bar.closed!==true||bar.sourceClosed===false||sourceMode==='LIVE'&&bar.finalOhlcVerified!==true||!validTime(bar.time)||!validTime(bar.closeTime)||bar.closeTime-bar.time!==60000||!validTime(bar.knownAt??bar.closeTime)||(bar.knownAt??bar.closeTime)<bar.closeTime||(bar.knownAt??bar.closeTime)>asOfTime||bar.closeTime>asOfTime||!['open','high','low','close'].every(key=>tick(bar[key]))||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high)||i>0&&bar.time<=bars[i-1].time)return block('CLOSED_CAUSAL_ON_TICK_MARKER_BARS_REQUIRED');
  }
  if(sourceMode==='LIVE'&&!Array.isArray(approvedSignals))return block('SELECTED_POST_BASELINE_LIVE_SIGNALS_REQUIRED');
  const candidates=approvedSignals??analysis.signals;
  if(!Array.isArray(candidates)||candidates.length>600)return block('BOUNDED_APPROVED_MARKER_SIGNALS_REQUIRED');
  if(analysis.events.length>10000||analysis.events.some(event=>!plain(event)||!eventId(event.eventId)))return block('BOUNDED_MARKER_EVENT_LEDGER_REQUIRED');
  const events=new Map(analysis.events.map(event=>[event.eventId,event]));
  if(events.size!==analysis.events.length)return block('DUPLICATE_MARKER_EVENT_ID');
  const records=[],seen=new Set(),directions=new Map();
  for(const signal of candidates){
    if(signal?.status!=='CONFIRMED')continue;
    if(signal.testOnly===true||signal.synthetic===true)return block('TEST_OR_SYNTHETIC_MARKER_SIGNAL_REJECTED');
    if(!eventId(signal.eventId)||seen.has(signal.eventId)||signal.execution!=='OBSERVATION_ONLY'||signal.orderEligible!==false||!['LONG','SHORT'].includes(signal.direction)||signal.instrument!==metadata.instrument||signal.timeframe!=='1'||signal.confirmationPolicy!=='later_close_beyond_setup'||!integer(signal.confirmationIndex)||!integer(signal.signalIndex)||!integer(signal.signalStartIndex)||signal.signalStartIndex<0||signal.signalIndex<signal.signalStartIndex||signal.confirmationIndex<=signal.signalIndex)return block('STRICT_CONFIRMED_MARKER_SIGNAL_REQUIRED');
    seen.add(signal.eventId);
    const bar=bars[signal.confirmationIndex],formation=bars[signal.signalStartIndex];
    if(!bar||!formation||signal.confirmationBarCloseTime!==bar.closeTime||signal.confirmedAt!==(bar.knownAt??bar.closeTime)||signal.confirmationClose!==bar.close||signal.formationStartTime!==formation.time||!validTime(signal.detectedAt)||signal.detectedAt>=signal.confirmedAt||signal.confirmedAt>asOfTime)return block('MARKER_CONFIRMATION_BAR_OHLC_BINDING_REQUIRED');
    if(!strictFilters(signal))return block('ALL_MANDATORY_FROZEN_MARKER_FILTERS_REQUIRED');
    const ids=signal.setupEventIds?.length?signal.setupEventIds:[signal.eventId],representative=events.get(signal.liveEligibility?.representativeSetupEventId??ids[0]);
    if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length||!representative||ids.some(id=>{const e=events.get(id);return !e||e.status!=='CONFIRMED'||e.direction!==signal.direction||e.instrument!==signal.instrument||e.timeframe!==signal.timeframe||e.confirmedAt!==signal.confirmedAt||e.confirmationIndex!==signal.confirmationIndex||e.confirmationBarCloseTime!==bar.closeTime||e.confirmationClose!==bar.close||!strictFilters(e);})||representative.invalidation!==signal.invalidation||representative.riskPlan?.initialStop!==signal.riskPlan?.initialStop||representative.riskPlan?.target!==signal.riskPlan?.target)return block('MARKER_CONSTITUENT_APPROVAL_REQUIRED');
    if(sourceMode==='LIVE'){
      const eligibility=signal.liveEligibility;
      if(eligibility?.policy!=='POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE'||!validTime(eligibility.bootstrapAsOfTime)||signal.formationStartTime<eligibility.bootstrapAsOfTime||eligibility.confirmationBarCloseTime!==bar.closeTime)return block('POST_BASELINE_MARKER_APPROVAL_REQUIRED');
    }
    const risk=riskFor(signal,metadata);if(!risk)return block('ONE_NQ_ALL_IN_MARKER_RISK_REQUIRED');
    if(directions.has(bar.time))return block(directions.get(bar.time)!==signal.direction?'AMBIGUOUS_MARKER_DIRECTIONS_AT_CANDLE':'DUPLICATE_CONFIRMED_MARKER_CANDLE');
    directions.set(bar.time,signal.direction);
    records.push({eventId:signal.eventId,time:bar.time,closeTime:bar.closeTime,confirmedAt:signal.confirmedAt,openTicks:bar.open/.25,highTicks:bar.high/.25,lowTicks:bar.low/.25,closeTicks:bar.close/.25,direction:signal.direction,directionCode:signal.direction==='LONG'?1:-1,price:signal.confirmationClose,priceTicks:signal.confirmationClose/.25,totalPlannedRisk:risk.totalPlannedRisk,riskMicros:Math.round(risk.totalPlannedRisk*1000000),quantity:1,sourceMode,patternIds:clone(signal.patternIds??[])});
  }
  records.sort((a,b)=>a.time-b.time||a.eventId.localeCompare(b.eventId));
  const selected=records.slice(-maxMarkers).map((record,i)=>({...record,markerId:'m'+i+'_'+shortId(record.eventId)}));
  const header=[CANDLE_MARKER_SCHEMA,metadata.instrument,'1',sourceMode,asOfTime].join('|');
  const textPayload=[header,...selected.map(r=>[r.markerId,r.time,r.closeTime,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.priceTicks,r.riskMicros].join('|'))].join('\n');
  if(textPayload.length>CANDLE_MARKER_LIMITS.maxCharacters)return block('NATIVE_MARKER_TEXT_LIMIT');
  return {...base,status:selected.length?'READY':'EMPTY',reasonCodes:selected.length?[]:['NO_STRICT_APPROVED_MARKERS'],instrument:metadata.instrument,timeframe:'1',asOfTime,records:selected,totalApprovedSignals:records.length,truncatedApprovedSignals:records.length-selected.length,textPayload,payloadSignature:candleMarkerPayloadSignature(textPayload)};
}

export function validateApprovedCandleMarkerPayload(text,context={}){
  const expected=buildApprovedCandleMarkerPayload(context);
  if(expected.status==='BLOCKED')return {valid:false,status:'BLOCKED',reasonCodes:expected.reasonCodes};
  const normalized=typeof text==='string'?text.replace(/\r\n?/g,'\n'):null;
  return normalized===expected.textPayload?{valid:true,status:expected.status,reasonCodes:[],payloadSignature:expected.payloadSignature,records:clone(expected.records)}:{valid:false,status:'BLOCKED',reasonCodes:['APPROVED_MARKER_PAYLOAD_CHANGED']};
}

/** Technical closed-candle drawings only. This distinct nine-column schema
 * contains no risk amount, sizing, bracket or execution approval. Replay source
 * authentication remains the caller's responsibility; LIVE delivery requires a
 * separate post-baseline policy and is deliberately unavailable here.
 */
export function buildTechnicalCandleMarkerPayload(input={}){
  input=input??{};
  const analysis=input.analysis,bars=input.bars??input.analysisInputs?.bars;
  const metadata=input.metadata??input.analysisInputs?.options?.metadata??analysis?.metadata;
  const sourceMode=input.sourceMode??input.mode,asOfTime=input.asOfTime??input.cutoff?.asOfTime??analysis?.asOfTime,maxMarkers=input.maxMarkers??CANDLE_MARKER_LIMITS.maxMarkers;
  const base={schemaVersion:2,kind:'TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD',approvalKind:'TECHNICAL',status:'BLOCKED',sourceMode,records:[],textPayload:null,payloadSignature:null,reasonCodes:[],ordersCreated:false,orderEligible:false,fillInferred:false,physicalPixelsVerified:false,markerPlacement:'NATIVE_BAR_TIME_AND_PRICE',nativeSize:'normal',colors:CANDLE_MARKER_COLORS,riskApprovalGranted:false,profitabilityVerified:false};
  const block=reason=>({...base,reasonCodes:[reason]});
  const live=sourceMode==='LIVE'&&input.displayPolicy==='LIVE_AND_HISTORICAL_TECHNICAL';
  if(input.testOnly===true||input.synthetic===true||analysis?.testOnly===true||analysis?.synthetic===true||metadata?.synthetic===true||metadata?.testOnly===true||analysis?.metadata?.synthetic===true||analysis?.metadata?.testOnly===true||Array.isArray(analysis?.events)&&analysis.events.some(event=>event?.testOnly===true||event?.synthetic===true))return block('TEST_OR_SYNTHETIC_MARKER_SOURCE_REJECTED');
  if(sourceMode!=='REPLAY'&&!live)return block('TECHNICAL_REPLAY_MARKER_SCOPE_REQUIRED');
  if(!validTime(asOfTime)||!integer(maxMarkers)||maxMarkers<1||maxMarkers>CANDLE_MARKER_LIMITS.maxMarkers)return block('EXPLICIT_BOUNDED_MARKER_SCOPE_REQUIRED');
  if(input.cutoff&&input.cutoff.asOfTime!==asOfTime||input.analysisInputs?.options&&input.analysisInputs.options.asOfTime!==asOfTime)return block('TECHNICAL_MARKER_CUTOFF_MISMATCH');
  if(!plain(metadata)||metadata.source!=='ohlc'||!/^CME_MINI:NQ(?:1!|[HMUZ]20\d\d)$/.test(metadata.instrument??'')||metadata.timeframe!=='1'||metadata.timeframeMs!==60000||metadata.tickSize!==.25||metadata.pointValue!==20||metadata.currency!=='USD'||!['standard','candles'].includes(metadata.chartType)||metadata.replay!==!live||metadata.realtime!==live||['instrument','timeframe','timeframeMs','tickSize','pointValue','currency','chartType','replay','realtime'].some(key=>analysis?.metadata?.[key]!==metadata[key]))return block('EXACT_NATIVE_NQ_ONE_MINUTE_SOURCE_REQUIRED');
  if(!Array.isArray(bars)||bars.length<1||bars.length>CANDLE_MARKER_LIMITS.maxTechnicalBars)return block('BOUNDED_CLOSED_MARKER_BARS_REQUIRED');
  if(live&&bars.some(bar=>bar.finalOhlcVerified!==true))return block('FINAL_LIVE_MARKER_OHLC_REQUIRED');
  const technical=selectGuideTechnicalDecision({analysis,bars,asOfTime});
  // LIVE analysis availability can follow the candle close. It is not the
  // candle's x-axis timestamp; retain both clocks instead of equating them.
  if(technical.status==='BLOCKED'||technical.currentClosedBarCloseTime!==(live?bars.at(-1).closeTime:asOfTime))return block('VALID_CLOSED_TECHNICAL_MARKER_DECISION_REQUIRED');
  const signals=[...technical.historicalSignals,...(technical.signal?[technical.signal]:[])];
  if(signals.length>600)return block('BOUNDED_APPROVED_MARKER_SIGNALS_REQUIRED');
  const byClose=new Map(bars.map(bar=>[bar.closeTime,bar])),seen=new Set(),records=[];
  for(const signal of signals){
    const bar=byClose.get(signal.confirmationBarCloseTime);
    if(signal.status!=='CONFIRMED'||signal.orderEligible!==false||signal.synthetic===true||signal.testOnly===true||signal.instrument!==metadata.instrument||signal.timeframe!=='1'||!eventId(signal.eventId)||seen.has(signal.eventId)||!bar||signal.confirmationClose!==bar.close||signal.confirmedAt!==(bar.knownAt??bar.closeTime)||signal.confirmedAt>asOfTime||!Array.isArray(signal.sourceEventIds)||signal.sourceEventIds.length<1||!['LONG','SHORT'].includes(signal.direction))return block('TECHNICAL_MARKER_CONFIRMATION_BINDING_REQUIRED');
    seen.add(signal.eventId);
    records.push({approvalKind:'TECHNICAL',eventId:signal.eventId,sourceEventIds:clone(signal.sourceEventIds),time:bar.time,closeTime:bar.closeTime,confirmedAt:signal.confirmedAt,openTicks:bar.open/.25,highTicks:bar.high/.25,lowTicks:bar.low/.25,closeTicks:bar.close/.25,direction:signal.direction,directionCode:signal.direction==='LONG'?1:-1,price:bar.close,priceTicks:bar.close/.25,sourceMode,patternIds:clone(signal.patternIds),setupIds:clone(signal.setupIds)});
  }
  records.sort((a,b)=>a.time-b.time||a.eventId.localeCompare(b.eventId));
  const selected=records.slice(-maxMarkers).map((record,index)=>({...record,markerId:'m'+index+'_'+shortId(record.eventId)}));
  if(live)return formatLiveDirectionMarkerPayload({...base,schemaVersion:3,instrument:metadata.instrument,timeframe:'1',analysisAsOfTime:asOfTime,asOfTime:bars.at(-1).closeTime},selected.map(record=>({...record,liveApproved:input.approvedSignals?.some(signal=>signal.status==='CONFIRMED'&&signal.direction===record.direction&&signal.confirmationBarCloseTime===record.closeTime&&signal.liveEligibility?.policy==='POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE'&&record.sourceEventIds.some(id=>signal.setupEventIds?.includes(id)))===true})),{totalApprovedSignals:records.length,truncatedApprovedSignals:records.length-selected.length});
  const header=[TECHNICAL_CANDLE_MARKER_SCHEMA,metadata.instrument,'1',sourceMode,asOfTime].join('|');
  const textPayload=[header,...selected.map(record=>[record.markerId,record.time,record.closeTime,record.openTicks,record.highTicks,record.lowTicks,record.closeTicks,record.directionCode,record.priceTicks].join('|'))].join('\n');
  if(textPayload.length>CANDLE_MARKER_LIMITS.maxCharacters)return block('NATIVE_MARKER_TEXT_LIMIT');
  return {...base,status:selected.length?'READY':'EMPTY',reasonCodes:selected.length?[]:['NO_STRICT_TECHNICAL_MARKERS'],instrument:metadata.instrument,timeframe:'1',asOfTime,records:selected,totalApprovedSignals:records.length,truncatedApprovedSignals:records.length-selected.length,currentTechnicalStatus:technical.status,currentTechnicalDirection:technical.direction,excludedConflictCutoffs:technical.conflicts.map(conflict=>conflict.confirmationBarCloseTime),textPayload,payloadSignature:candleMarkerPayloadSignature(textPayload)};
}

export function validateTechnicalCandleMarkerPayload(text,context={}){
  const expected=buildTechnicalCandleMarkerPayload(context);
  if(expected.status==='BLOCKED')return {valid:false,status:'BLOCKED',reasonCodes:expected.reasonCodes};
  const normalized=typeof text==='string'?text.replace(/\r\n?/g,'\n'):null;
  return normalized===expected.textPayload?{valid:true,status:expected.status,reasonCodes:[],payloadSignature:expected.payloadSignature,records:clone(expected.records)}:{valid:false,status:'BLOCKED',reasonCodes:['TECHNICAL_MARKER_PAYLOAD_CHANGED']};
}

export function verifyNativeCandleMarkerFields(payload,fields){
  const fail=reason=>({verified:false,status:'BLOCKED',reasonCodes:[reason],physicalPixelsVerified:false,ordersCreated:false});
  let signature;try{signature=candleMarkerPayloadSignature(payload?.textPayload);}catch{return fail('VALID_APPROVED_MARKER_PAYLOAD_REQUIRED');}
  if(!['READY','EMPTY'].includes(payload?.status)||payload.payloadSignature!==signature||!Array.isArray(payload.records))return fail('VALID_APPROVED_MARKER_PAYLOAD_REQUIRED');
  const values={};
  for(const name of CANDLE_MARKER_NATIVE_FIELDS){const raw=fields?.[name],text=typeof raw==='string'?raw.trim().replace(/^\u2212/,'-'):null,value=typeof raw==='number'?raw:text!==null&&/^-?[\d,]+(?:\.0+)?$/.test(text)?Number(text.replace(/,/g,'')):NaN;if(!integer(value))return fail('NATIVE_MARKER_FIELDS_REQUIRED');values[name]=value;}
  const technical=payload.kind==='TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD'&&payload.approvalKind==='TECHNICAL';
  const last=payload.records.at(-1),expected={ARROW_MARKER_SCHEMA:technical?payload.schemaVersion:1,ARROW_MARKER_SIGNATURE:payload.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:payload.records.length,ARROW_MARKER_MATCHED_COUNT:payload.records.length,ARROW_MARKER_DRAWN_COUNT:payload.records.length,ARROW_MARKER_MODE:payload.sourceMode==='LIVE'?1:2,ARROW_MARKER_LAST_TIME:payload.schemaVersion===5&&last?.entryFilled?last.fillTime:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:payload.schemaVersion===5&&last?.entryFilled?last.fillPriceTicks:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:payload.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};
  const mismatches=CANDLE_MARKER_NATIVE_FIELDS.filter(name=>values[name]!==expected[name]);
  return mismatches.length?{...fail('NATIVE_CANDLE_MARKER_PROOF_MISMATCH'),mismatches,expected,observed:values}:{verified:true,status:payload.records.length?'NATIVE_MARKERS_BOUND_TO_CONFIRMED_CANDLES':'NATIVE_EMPTY_MARKERS_VERIFIED',reasonCodes:[],count:payload.records.length,sourceMode:payload.sourceMode,expected,observed:values,physicalPixelsVerified:false,ordersCreated:false,fillInferred:false};
}

// Schema3 is presentation-only. Its final column distinguishes observed live
// approvals from recomputed history; neither classification is a fill receipt.
export function formatLiveDirectionMarkerPayload(base,records,extra={}){
  const selected=records.slice(-LIVE_DIRECTION_MARKER_LIMITS.maxMarkers).map((record,index)=>({...clone(record),markerId:'m'+index+'_'+shortId(record.eventId)}));
  const textPayload=[['ARROW_DIRECTION_MARKERS_V1',base.instrument,'1','LIVE',base.asOfTime].join('|'),...selected.map(r=>[r.markerId,r.time,r.closeTime,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.priceTicks,r.liveApproved===true?1:0].join('|'))].join('\n');
  if(textPayload.length>LIVE_DIRECTION_MARKER_LIMITS.maxCharacters)return {...base,status:'BLOCKED',records:[],textPayload:null,payloadSignature:null,reasonCodes:['NATIVE_MARKER_TEXT_LIMIT']};
  return {...base,...extra,schemaVersion:3,sourceMode:'LIVE',status:selected.length?'READY':'EMPTY',reasonCodes:selected.length?[]:['NO_CONFIRMED_TECHNICAL_MARKERS'],records:selected,textPayload,payloadSignature:candleMarkerPayloadSignature(textPayload),historyMeaning:'RECOMPUTED_CONFIRMED_SCENARIO_NOT_A_MISSED_FILL',ordersCreated:false,orderEligible:false,fillInferred:false};
}
