import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseGuideCsv} from '../guide-import.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';

// Compare recorded evidence only. The CLI never controls a chart, changes the
// recording, contacts a provider, or treats a historical match as global accuracy.
const finite=Number.isFinite;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const priceFields=['open','high','low','close'];
const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const iso=value=>finite(value)?new Date(value).toISOString():null;
function summary(values){
  const sorted=values.filter(finite).sort((a,b)=>a-b),at=p=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;
  return {count:sorted.length,minMs:at(0),p50Ms:at(.5),p95Ms:at(.95),maxMs:at(1),negativeCount:sorted.filter(value=>value<0).length};
}
function windowOf(bars){
  if(!bars.length)return {count:0,firstOpenTime:null,lastOpenTime:null,lastCloseTime:null,firstOpenUtc:null,lastOpenUtc:null,lastCloseUtc:null};
  const sorted=bars.slice().sort((a,b)=>a.time-b.time),first=sorted[0],last=sorted.at(-1);
  return {count:bars.length,firstOpenTime:first.time,lastOpenTime:last.time,lastCloseTime:last.closeTime??null,firstOpenUtc:iso(first.time),lastOpenUtc:iso(last.time),lastCloseUtc:iso(last.closeTime)};
}
function csvIntervalOf(bars){const counts=new Map();for(let i=1;i<bars.length;i++){const interval=bars[i].time-bars[i-1].time;counts.set(interval,(counts.get(interval)??0)+1);}return [...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??null;}
function normalized(value){
  if(Array.isArray(value))return value.map(normalized);
  if(plain(value))return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,normalized(value[key])]));
  return value;
}
const json=value=>JSON.stringify(normalized(value));
const digest=value=>createHash('sha256').update(json(value)).digest('hex');
const priceTolerance=(a,b,tick)=>Math.max(tick*1e-6,Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*8);
const volumeTolerance=(a,b,quantizedSixDecimals=false)=>Math.max(1e-8,Math.max(1,Math.abs(a),Math.abs(b))*1e-8,
  quantizedSixDecimals?5e-7+Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*8:0);
function recordedVolumePolicy(recording){
  const encoding=recording.windowEvidence?.bootstrapMetadata?.encoding;
  return recording.sourceTransport==='window'&&encoding?.volumeQuantized===true&&encoding.volumeDecimals===6?
    {applied:true,volumeDecimals:6,maximumAbsoluteQuantizationError:5e-7,provenance:'sourceTransport=window and windowEvidence.bootstrapMetadata.encoding.volumeQuantized=true,volumeDecimals=6'}:{applied:false};
}
function priceDifferences(recorded,reference,tick){
  return priceFields.flatMap(field=>{const absoluteDifference=Math.abs(recorded[field]-reference[field]),tolerance=priceTolerance(recorded[field],reference[field],tick);return !finite(recorded[field])||absoluteDifference>tolerance?[{field,recorded:recorded[field],csv:reference[field],absoluteDifference,tolerance}]:[];});
}
function volumeAudit(csvIncluded,quantization={applied:false}){return {status:'UNAVAILABLE',csvIncluded,compared:0,matched:0,mismatched:0,invalidRecorded:0,unavailable:0,maximumAbsoluteDifference:0,mismatches:[],quantization:{...quantization},tolerancePolicy:quantization.applied?
  'max(1e-8 volume units,1e-8*max(1,absolute volumes),5e-7+8*Number.EPSILON*max(1,absolute volumes)); six-decimal quantization requires recorded Window provenance; null/absent is missing, never zero':
  'max(1e-8 volume units,1e-8*max(1,absolute volumes)); null/absent is missing, never zero'};}
function compareVolume(a,b,time,audit){
  if(!audit.csvIncluded)return [];
  if(a!==undefined&&a!==null&&(!finite(a)||a<0)){const item={field:'volume',time,recorded:a,csv:b,reason:'INVALID_RECORDED_VOLUME'};audit.invalidRecorded++;audit.compared++;audit.mismatched++;audit.mismatches.push(item);return [item];}
  if(!finite(a)||a<0||!finite(b)||b<0){audit.unavailable++;return [];}
  audit.compared++;const difference=Math.abs(a-b),tolerance=volumeTolerance(a,b,audit.quantization.applied);audit.maximumAbsoluteDifference=Math.max(audit.maximumAbsoluteDifference,difference);
  if(difference<=tolerance){audit.matched++;return [];}
  const item={field:'volume',time,recorded:a,csv:b,absoluteDifference:difference,tolerance};audit.mismatched++;audit.mismatches.push(item);return [item];
}
function finishVolume(audit){audit.status=!audit.csvIncluded?'UNAVAILABLE':audit.mismatched?'MISMATCH':audit.compared?audit.unavailable?'PARTIAL':'MATCH':'UNAVAILABLE';return audit;}

export function readTradingViewCsv(text){
  const rows=parseGuideCsv(text.replace(/^\uFEFF/,'')),headers=rows.shift()?.map(value=>value.trim().toLowerCase());
  if(!headers||!['time',...priceFields].every(key=>headers.includes(key)))throw Error('CSV_REQUIRED_COLUMNS_MISSING');
  if(headers.some((key,index)=>!key||headers.indexOf(key)!==index))throw Error('CSV_DUPLICATE_OR_EMPTY_HEADER');
  const indexes=Object.fromEntries(['time',...priceFields,'volume'].map(key=>[key,headers.indexOf(key)])),bars=[];
  for(let index=0;index<rows.length;index++){
    const row=rows[index];if(row.length!==headers.length)throw Error('CSV_ROW_WIDTH:'+String(index+2));
    const values={};
    for(const key of ['time',...priceFields]){
      const value=row[indexes[key]].trim();if(!numeric.test(value)||!finite(Number(value)))throw Error('CSV_INVALID_NUMBER:'+String(index+2)+':'+key);values[key]=Number(value);
    }
    const time=values.time*1000;
    if(!Number.isSafeInteger(time)||time<0||bars.length&&time<=bars.at(-1).time)throw Error('CSV_INVALID_UNIX_SECONDS_OR_ORDER:'+String(index+2));
    if(values.high<Math.max(values.open,values.close)||values.low>Math.min(values.open,values.close)||values.high<values.low)throw Error('CSV_INVALID_OHLC:'+String(index+2));
    if(indexes.volume>=0){
      const value=row[indexes.volume].trim();
      if(!value||/^(?:na|nan|null)$/i.test(value))values.volume=null;
      else if(!numeric.test(value)||!finite(Number(value))||Number(value)<0)throw Error('CSV_INVALID_VOLUME:'+String(index+2));
      else values.volume=Number(value);
    }
    bars.push({...values,time});
  }
  return bars;
}

function compareBars(store,csvBars,volumePolicy){
  const all=Array.isArray(store?.bars)?store.bars:[],tick=store?.metadata?.tickSize;
  const closed=all.filter(bar=>bar?.closed===true),verified=closed.filter(bar=>bar.finalOhlcVerified===true),unverified=closed.filter(bar=>bar.finalOhlcVerified!==true);
  const base={comparedFields:['time',...priceFields],timeMatching:'CSV Unix seconds multiplied by1000 exactly; bar-open epoch milliseconds must match',reportedClosedBars:closed.length,verifiedClosedBars:verified.length,unverifiedClosedExcluded:unverified.length,currentOpenExcluded:store?.current?.closed===false?1:0,csvRows:csvBars.length,
    reportedWindow:windowOf(closed),csvWindow:windowOf(csvBars),scope:'Only the retained provider-final closed bars overlapping this manually exported TradingView CSV; no global detector accuracy, profitability or future performance inference.'};
  if(!finite(tick)||tick<=0)return {...base,status:'UNAVAILABLE',reasonCodes:['TICK_SIZE_REQUIRED'],compared:0,matched:0,mismatched:0};
  const observedCsvIntervalMs=csvIntervalOf(csvBars);
  if(observedCsvIntervalMs!==null&&observedCsvIntervalMs!==store.metadata.timeframeMs)return {...base,status:'UNAVAILABLE',reasonCodes:['CSV_TIMEFRAME_UNVERIFIED_OR_MISMATCH'],sourceTimeframeMs:store.metadata.timeframeMs,observedCsvIntervalMs,compared:0,matched:0,mismatched:0,
    limitation:'CSV lacks explicit timeframe metadata; its modal consecutive open-time interval differs from the source. Refuse to compare differently aggregated bars or infer that missing rows prove another timeframe.'};
  const volume=volumeAudit(csvBars.some(bar=>Object.hasOwn(bar,'volume')),volumePolicy),byTime=new Map(csvBars.map(bar=>[bar.time,bar])),matched=[],mismatches=[],nonoverlap=[];let maximumAbsoluteDifference=0;
  for(const bar of verified){
    const reference=byTime.get(bar.time);
    if(!reference){nonoverlap.push({time:bar.time,closeTime:bar.closeTime,reason:bar.time<csvBars[0]?.time?'BEFORE_CSV':bar.time>csvBars.at(-1)?.time?'AFTER_CSV':'MISSING_CSV_ROW'});continue;}
    const differences=[];
    for(const key of priceFields){
      const difference=Math.abs(bar[key]-reference[key]),tolerance=priceTolerance(bar[key],reference[key],tick);
      maximumAbsoluteDifference=Math.max(maximumAbsoluteDifference,difference);
      if(!finite(bar[key])||difference>tolerance)differences.push({field:key,recorded:bar[key],csv:reference[key],absoluteDifference:difference,tolerance});
    }
    differences.push(...compareVolume(bar.volume,reference.volume,bar.time,volume));
    if(differences.length)mismatches.push({time:bar.time,closeTime:bar.closeTime,timeUtc:iso(bar.time),differences});else matched.push(bar);
  }
  const overlap=[...matched,...mismatches].sort((a,b)=>a.time-b.time),compared=matched.length+mismatches.length;
  return {...base,comparedFields:[...base.comparedFields,...(volume.csvIncluded?['volume']:[])],volume:finishVolume(volume),status:mismatches.length?'MISMATCH':compared?'MATCH':'NO_OVERLAP',sourceTimeframeMs:store.metadata.timeframeMs,observedCsvIntervalMs,tickSize:tick,tolerancePolicy:'max(tickSize*1e-6,8*Number.EPSILON*max(1,absolute prices)); equality in time is exact',compared,matched:matched.length,mismatched:mismatches.length,maximumAbsoluteDifference,
    overlapWindow:windowOf(overlap),nonoverlapCount:nonoverlap.length,nonoverlapWindow:windowOf(nonoverlap),nonoverlap,mismatches};
}

const ordered=events=>(events??[]).slice().sort((a,b)=>String(a.eventId).localeCompare(String(b.eventId)));
const analysisCore=analysis=>({status:analysis.status,reasonCodes:analysis.reasonCodes??[],signals:ordered(analysis.signals),events:ordered(analysis.events)});
// createGuideAnalyzer adds runtime cache counters after the pure calculation.
// They are operational diagnostics, not an output of analyzeGuideSignals.
const analysisSemantic=analysis=>Object.fromEntries(Object.entries(analysis).filter(([key])=>key!=='cache'));
function compareAnalysis(recording){
  const analysis=recording.latestAnalysis,store=recording.store;
  if(!plain(analysis))return {status:'UNAVAILABLE',reasonCodes:['NO_RECORDED_ANALYSIS'],scope:'No analysis is not a failed verification; the source may not have reached a usable close.'};
  const exact=recording.analysisInputs!==undefined&&recording.analysisInputs!==null;
  let inputBars,inputOptions,inputMode;
  if(exact){
    const input=recording.analysisInputs;
    if(!plain(input)||!Array.isArray(input.bars)||!plain(input.options)||!finite(input.options.asOfTime))return {status:'UNAVAILABLE',reasonCodes:['EXACT_ANALYSIS_REPLAY_INPUTS_INVALID']};
    inputBars=input.bars;inputOptions=input.options;inputMode='EXACT_RECORDED_ANALYSIS_INPUTS';
  }else{
    if(!plain(recording.appliedOptions)||!Array.isArray(store?.bars)||!plain(analysis.metadata)||!finite(analysis.asOfTime))return {status:'UNAVAILABLE',reasonCodes:['ANALYSIS_REPLAY_INPUTS_MISSING']};
    inputBars=store.bars;inputOptions={metadata:analysis.metadata,...recording.appliedOptions,asOfTime:analysis.asOfTime};inputMode='LEGACY_RETAINED_STORE_PREFIX';
    // Older exports did not freeze all analysis arguments. A current exported
    // provider series is a bounded fallback; knownAt still limits its past use.
    if(!Object.hasOwn(inputOptions,'higherTimeframes')&&plain(recording.timeframes?.higherTimeframes))inputOptions.higherTimeframes=recording.timeframes.higherTimeframes;
  }
  const available=inputBars.filter(bar=>bar.closed===true&&(bar.knownAt??bar.closeTime)<=inputOptions.asOfTime);
  if(!exact&&Number.isSafeInteger(analysis.stats?.closedBars)&&analysis.stats.closedBars!==available.length)return {status:'UNAVAILABLE',reasonCodes:['RETAINED_HISTORY_DOES_NOT_COVER_ANALYSIS_PREFIX'],reportedClosedBars:analysis.stats.closedBars,availablePrefix:available.length,asOfTime:analysis.asOfTime,inputMode};
  let recomputed;
  try{recomputed=analyzeGuideSignals(inputBars,inputOptions);}
  catch(error){return {status:'ERROR',reasonCodes:['ANALYSIS_REPLAY_ERROR'],detail:String(error?.message??error)};}
  if(analysis.definitionVersion!==recomputed.definitionVersion)return {status:'UNAVAILABLE',reasonCodes:['ENGINE_DEFINITION_VERSION_MISMATCH'],inputMode,recordedDefinitionVersion:analysis.definitionVersion??null,recomputedDefinitionVersion:recomputed.definitionVersion??null,analysisInputsSha256:digest({bars:inputBars,options:inputOptions}),scope:'A prior engine definition cannot be deterministically validated by comparing it with another engine version. The original implementation is required; no trading-result match is claimed.'};
  const original=analysisCore(analysis),replay=analysisCore(recomputed),differences=[];
  const originalEvents=new Map(original.events.map(event=>[event.eventId,event])),replayedEvents=new Map(replay.events.map(event=>[event.eventId,event]));
  for(const id of new Set([...originalEvents.keys(),...replayedEvents.keys()])){
    const recorded=originalEvents.get(id),expected=replayedEvents.get(id);
    if(json(recorded)!==json(expected))differences.push({eventId:id,recordedStatus:recorded?.status??null,recomputedStatus:expected?.status??null,recordedReasons:recorded?.reasonCodes??null,recomputedReasons:expected?.reasonCodes??null,presence:!recorded?'ONLY_RECOMPUTED':!expected?'ONLY_RECORDED':'CHANGED'});
  }
  const signalMatch=json(original.signals)===json(replay.signals),eventMatch=json(original.events)===json(replay.events),statusMatch=original.status===replay.status&&json(original.reasonCodes)===json(replay.reasonCodes);
  const completeAnalysisMatch=exact?json(analysisSemantic(analysis))===json(analysisSemantic(recomputed)):null;
  return {status:signalMatch&&eventMatch&&statusMatch&&completeAnalysisMatch!==false?'MATCH':'MISMATCH',inputMode,recordedDefinitionVersion:analysis.definitionVersion,recomputedDefinitionVersion:recomputed.definitionVersion,completeAnalysisMatch,analysisInputsSha256:digest({bars:inputBars,options:inputOptions}),asOfTime:analysis.asOfTime,asOfUtc:iso(analysis.asOfTime),availableClosedPrefix:available.length,inputBars:inputBars.length,appliedOptions:inputOptions,
    recordedStatus:analysis.status,recomputedStatus:recomputed.status,signalMatch,eventMatch,statusMatch,recordedSignals:original.signals.length,recomputedSignals:replay.signals.length,recordedEvents:original.events.length,recomputedEvents:replay.events.length,
    recordedCoreSha256:digest(original),recomputedCoreSha256:digest(replay),...(exact?{recordedAnalysisSha256:digest(analysisSemantic(analysis)),recomputedAnalysisSha256:digest(analysisSemantic(recomputed)),excludedOperationalFields:['cache']}:{}),eventDifferences:differences,scope:exact?'Complete semantic analysis output is compared against recomputation from exact captured bars and options, including context, live checks, shapes and events. Wrapper cache counters are excluded explicitly. A deterministic match is not a validation of trading profitability.':'Legacy signal/event objects including context, thresholds, parameter snapshots, statuses and reasons are compared at the recorded decision cutoff. A deterministic match is not a validation of trading profitability.'};
}

function compareHigherTimeframes(recording,csvBars,volumePolicy){
  const exported=recording.timeframes?.higherTimeframes,inputs=recording.analysisInputs?.options?.higherTimeframes;
  const source=plain(exported)?exported:plain(inputs)?inputs:null,sourceBasis=plain(exported)?'EXPORTED_PROVIDER_SERIES':plain(inputs)?'CAPTURED_ANALYSIS_INPUTS':null;
  const scope='Provider-confirmed higher bars compared only to complete, contiguous 1-minute CSV rows whose corresponding recorded base bars are explicitly provider-final and match the CSV OHLC. Bucket boundaries come from each provider bar; missing history is unknown, never padded or treated as market closure.';
  if(!source)return {status:'UNAVAILABLE',reasonCodes:['HIGHER_TIMEFRAME_SERIES_NOT_RECORDED'],series:{},scope};
  const meta=recording.store.metadata??{},tick=meta.tickSize,asOf=recording.timeframes?.asOfTime??recording.analysisInputs?.options?.asOfTime??recording.store.decisionAsOfTime;
  if(meta.timeframeMs!==60000||!finite(tick)||tick<=0)return {status:'UNAVAILABLE',reasonCodes:['VERIFIED_ONE_MINUTE_BASE_REQUIRED'],sourceBasis,series:{},scope};
  if(csvIntervalOf(csvBars)!==60000)return {status:'UNAVAILABLE',reasonCodes:['CSV_ONE_MINUTE_INTERVAL_UNVERIFIED'],sourceBasis,series:{},scope};
  const csvByTime=new Map(csvBars.map(bar=>[bar.time,bar])),baseByTime=new Map((recording.store.bars??[]).filter(bar=>bar?.closed===true&&bar.finalOhlcVerified===true&&bar.closeTime-bar.time===60000&&finite(bar.knownAt)&&bar.knownAt>=bar.closeTime&&bar.knownAt<=asOf&&bar.closeTime<=asOf).map(bar=>[bar.time,bar]));
  const series={},unavailableSeries=[];let compared=0,matched=0,mismatched=0,unknown=0;
  for(const [name,entry] of Object.entries(source)){
    const bars=Array.isArray(entry?.bars)?entry.bars:[],duration=entry?.timeframeMs??entry?.metadata?.timeframeMs,checks=[],volume=volumeAudit(csvBars.some(bar=>Object.hasOwn(bar,'volume')),volumePolicy);
    const metadataReasons=[];
    if(!Number.isSafeInteger(duration)||duration<=60000||duration%60000!==0)metadataReasons.push('UNSUPPORTED_HIGHER_DURATION');
    for(const key of ['instrument','timezone','session','tickSize','currency'])if(entry?.metadata?.[key]!==undefined&&meta[key]!==undefined&&entry.metadata[key]!==meta[key])metadataReasons.push('HIGHER_METADATA_MISMATCH:'+key);
    for(const bar of bars){
      const reasons=[...metadataReasons],expectedBuckets=Number.isSafeInteger(duration)?duration/60000:null;
      if(bar?.closed!==true||bar.sourceClosed!==true&&bar.finalOhlcVerified!==true)reasons.push('HIGHER_FINAL_NOT_VERIFIED');
      if(!Number.isSafeInteger(bar?.time)||!Number.isSafeInteger(bar?.closeTime)||bar.closeTime-bar.time!==duration)reasons.push('HIGHER_BAR_TIMES_INVALID');
      if(!finite(asOf)||!finite(bar?.knownAt)||bar.knownAt<bar.closeTime||bar.knownAt>asOf||bar.closeTime>asOf)reasons.push('HIGHER_AVAILABILITY_UNVERIFIED');
      if(expectedBuckets>10000)reasons.push('BASE_BUCKET_COUNT_LIMIT');
      const reference=[],missingCsv=[],missingVerifiedBase=[],baseMismatches=[];
      if(!reasons.length)for(let index=0;index<expectedBuckets;index++){
        const time=bar.time+index*60000,csv=csvByTime.get(time),base=baseByTime.get(time);
        if(!csv)missingCsv.push(time);
        if(!base)missingVerifiedBase.push(time);
        if(csv&&base&&priceDifferences(base,csv,tick).length)baseMismatches.push(time);
        if(csv)reference.push(csv);
      }
      if(missingCsv.length)reasons.push('INCOMPLETE_CSV_BUCKET');
      if(missingVerifiedBase.length)reasons.push('INCOMPLETE_VERIFIED_BASE_BUCKET');
      if(baseMismatches.length)reasons.push('BASE_CSV_VALUES_MISMATCH');
      if(reasons.length){checks.push({time:bar?.time??null,closeTime:bar?.closeTime??null,status:'UNKNOWN',reasonCodes:reasons,expectedBaseBars:expectedBuckets,availableCsvBars:reference.length,missingCsv,missingVerifiedBase,baseMismatches});continue;}
      const aggregate={time:bar.time,closeTime:bar.closeTime,open:reference[0].open,high:Math.max(...reference.map(row=>row.high)),low:Math.min(...reference.map(row=>row.low)),close:reference.at(-1).close};
      if(volume.csvIncluded)aggregate.volume=reference.every(row=>finite(row.volume))?reference.reduce((sum,row)=>sum+row.volume,0):null;
      const differences=[...priceDifferences(bar,aggregate,tick),...compareVolume(bar.volume,aggregate.volume,bar.time,volume)];
      checks.push({time:bar.time,closeTime:bar.closeTime,status:differences.length?'MISMATCH':'MATCH',verifiedBaseBars:expectedBuckets,aggregate,differences});
    }
    const counts={reported:bars.length,compared:checks.filter(check=>check.status!=='UNKNOWN').length,matched:checks.filter(check=>check.status==='MATCH').length,mismatched:checks.filter(check=>check.status==='MISMATCH').length,unknown:checks.filter(check=>check.status==='UNKNOWN').length};
    compared+=counts.compared;matched+=counts.matched;mismatched+=counts.mismatched;unknown+=counts.unknown;
    if(!counts.compared)unavailableSeries.push(name);
    series[name]={timeframe:entry?.timeframe??name,timeframeMs:duration??null,status:counts.mismatched?'MISMATCH':counts.compared?counts.unknown?'PARTIAL':'MATCH':'UNAVAILABLE',...counts,coverageFraction:bars.length?counts.compared/bars.length:null,volume:finishVolume(volume),reasonCodes:bars.length?metadataReasons:['HIGHER_TIMEFRAME_BARS_MISSING'],checks};
  }
  return {status:mismatched?'MISMATCH':compared?unknown||unavailableSeries.length?'PARTIAL':'MATCH':'UNAVAILABLE',sourceBasis,baseIntervalMs:60000,verifiedBaseBars:baseByTime.size,compared,matched,mismatched,unknown,unavailableSeries,series,scope};
}

function compareNativeHigherCsv(recording,higherCsvByTimeframe,higherCsvPaths,volumePolicy){
  if(!plain(higherCsvByTimeframe)||Object.keys(higherCsvByTimeframe).length>3)throw Error('HIGHER_CSV_OPTIONS_INVALID');
  const entries=Object.entries(higherCsvByTimeframe),exported=recording.timeframes?.higherTimeframes,source=plain(exported)?exported:recording.analysisInputs?.options?.higherTimeframes;
  const scope='Direct comparison of retained provider-final higher bars with manually exported native TradingView timeframe CSV files. No reconstruction from 1-minute data is involved. CSV files do not independently encode/verify the exchange, symbol or session; those are declared by the recording and the selected exports, and this is not an independent exchange feed.';
  if(!entries.length)return {status:'UNAVAILABLE',reasonCodes:['NATIVE_HIGHER_CSV_NOT_PROVIDED'],series:{},scope};
  const base=recording.store.metadata??{},asOf=recording.timeframes?.asOfTime??recording.analysisInputs?.options?.asOfTime??recording.store.decisionAsOfTime,series={};
  let compared=0,matched=0,mismatched=0,unavailable=0,partial=false;
  for(const [name,text] of entries){
    if(typeof text!=='string')throw Error('HIGHER_CSV_TEXT_REQUIRED:'+name);
    const entry=source?.[name],duration=entry?.timeframeMs??entry?.metadata?.timeframeMs,meta={...base,...entry?.metadata,timeframe:entry?.timeframe??name,timeframeMs:duration};
    const reasonCodes=[];
    if(!plain(entry)||!Array.isArray(entry.bars))reasonCodes.push('PROVIDER_HIGHER_SERIES_NOT_RECORDED');
    if(!Number.isSafeInteger(duration)||duration<=base.timeframeMs||entry?.timeframe!==undefined&&entry.timeframe!==name)reasonCodes.push('PROVIDER_HIGHER_TIMEFRAME_UNVERIFIED');
    for(const key of ['instrument','timezone','session','tickSize','currency'])if(entry?.metadata?.[key]!==undefined&&base[key]!==undefined&&entry.metadata[key]!==base[key])reasonCodes.push('HIGHER_METADATA_MISMATCH:'+key);
    if(reasonCodes.length){series[name]={status:'UNAVAILABLE',reasonCodes,csvPath:higherCsvPaths?.[name]??null};unavailable++;continue;}
    const eligible=bar=>bar?.closed===true&&(bar.sourceClosed===true||bar.finalOhlcVerified===true)&&Number.isSafeInteger(bar.time)&&Number.isSafeInteger(bar.closeTime)&&bar.closeTime-bar.time===duration&&finite(asOf)&&finite(bar.knownAt)&&bar.knownAt>=bar.closeTime&&bar.knownAt<=asOf&&bar.closeTime<=asOf;
    const excludedUnverifiedSourceBars=entry.bars.filter(bar=>!eligible(bar)).length;
    const comparison=compareBars({metadata:meta,bars:entry.bars.map(bar=>({...bar,finalOhlcVerified:eligible(bar)}))},readTradingViewCsv(text),volumePolicy);
    let status=comparison.status;
    if(status==='NO_OVERLAP')status='UNAVAILABLE';
    else if(status==='MATCH'&&(comparison.nonoverlapCount||excludedUnverifiedSourceBars||comparison.volume?.csvIncluded&&comparison.volume.unavailable))status='PARTIAL';
    if(status==='UNAVAILABLE')unavailable++;if(status==='PARTIAL')partial=true;
    compared+=comparison.compared;matched+=comparison.matched;mismatched+=comparison.mismatched;
    series[name]={...comparison,status,csvPath:higherCsvPaths?.[name]??null,sourceBasis:'MANUALLY_EXPORTED_TRADINGVIEW_NATIVE_TIMEFRAME_CSV',providerInstrument:meta.instrument,providerTimeframe:meta.timeframe,excludedUnverifiedSourceBars,coverageFraction:entry.bars.length?comparison.compared/entry.bars.length:null,scope};
  }
  return {status:mismatched?'MISMATCH':compared?partial||unavailable?'PARTIAL':'MATCH':'UNAVAILABLE',compared,matched,mismatched,unavailableSeries:unavailable,series,scope};
}

function auditAlerts(recording){
  const alerts=Array.isArray(recording.alerts)?recording.alerts:[],store=recording.store??{},bars=store.bars??[],checks=[];
  for(const item of alerts){
    const signal=item.signal??{},reasons=[],unknown=[];
    const sameRun=typeof item.sourcePacketId==='string'&&typeof recording.selectedRun==='string'&&item.sourcePacketId.startsWith(recording.selectedRun+':');
    if(!sameRun)unknown.push('ALERT_SOURCE_RUN_NOT_IN_CURRENT_STORE');
    const confirmation=bars[signal.confirmationIndex],formationStart=bars[signal.signalStartIndex??signal.signalIndex];
    if(!confirmation||confirmation.knownAt!==signal.confirmedAt)unknown.push('CONFIRMATION_INDEX_NOT_COVERED_BY_CURRENT_STORE');
    if(!formationStart||!finite(store.bootstrapAsOfTime))unknown.push('FORMATION_BOOTSTRAP_CONTEXT_UNAVAILABLE');
    if(signal.status!=='CONFIRMED')reasons.push('ALERT_NOT_CONFIRMED');
    if(signal.orderEligible!==false||signal.execution!=='OBSERVATION_ONLY')reasons.push('ALERT_ORDER_INTENT_NOT_DISABLED');
    if(!unknown.length){
      if(confirmation.closed!==true||confirmation.finalOhlcVerified!==true||confirmation.closeTime>signal.confirmedAt||confirmation.knownAt>signal.confirmedAt)reasons.push('CONFIRMATION_BAR_NOT_CLOSED_AVAILABLE');
      if(formationStart.time<store.bootstrapAsOfTime||signal.confirmedAt<store.bootstrapAsOfTime)reasons.push('ALERT_PREDATES_BOOTSTRAP');
      if(!finite(item.receivedAt)||confirmation.receivedAt>item.receivedAt)reasons.push('CONFIRMATION_NOT_RECEIVED_BEFORE_ALERT');
    }
    checks.push({id:item.id??null,status:reasons.length?'MISMATCH':unknown.length?'UNVERIFIED':'VERIFIED',reasonCodes:reasons,unavailableReasons:unknown,confirmedAt:signal.confirmedAt??null,confirmationBarTime:confirmation?.time??null,formationStartTime:formationStart?.time??null,bootstrapAsOfTime:store.bootstrapAsOfTime??null});
  }
  const orderFlagsDisabled=recording.orderEligible===false&&store.orderEligible===false&&alerts.every(item=>item.signal?.orderEligible===false);
  return {status:!orderFlagsDisabled||checks.some(check=>check.status==='MISMATCH')?'MISMATCH':checks.some(check=>check.status==='UNVERIFIED')?'UNVERIFIED':checks.length?'VERIFIED':'NO_ALERTS_RECORDED',count:checks.length,verified:checks.filter(check=>check.status==='VERIFIED').length,unverified:checks.filter(check=>check.status==='UNVERIFIED').length,mismatched:checks.filter(check=>check.status==='MISMATCH').length,orderFlagsDisabled,checks,
    scope:'Recorded alert guards and observation-only flags only. An empty alert ledger does not prove that a positive live alert path executed, and this CLI does not inspect broker activity.'};
}

function summarizeLatency(recording){
  const latency=recording.latency??{},samples=Array.isArray(latency.samples)?latency.samples:[],bad=[];
  for(const [index,sample] of samples.entries())if(!['receivedAt','analysisStartedAt','analysisFinishedAt','mutationAt','firstPaintOpportunityAt','secondPaintOpportunityAt'].every(key=>finite(sample[key]))||sample.analysisStartedAt<sample.receivedAt||sample.analysisFinishedAt<sample.analysisStartedAt||sample.mutationAt<sample.analysisFinishedAt||sample.firstPaintOpportunityAt<sample.mutationAt||sample.secondPaintOpportunityAt<sample.firstPaintOpportunityAt)bad.push(index);
  const metrics={};
  for(const key of ['queueMs','analysisMs','receiptToMutationMs','receiptToPaintOpportunityLowerMs','receiptToPaintOpportunityUpperMs'])metrics[key]=summary(samples.map(sample=>sample[key]));
  const raw=(recording.rawEvidence??[]).filter(item=>finite(item.receivedAt)&&finite(item.sourceEmittedAt)),clockDifferences=raw.map(item=>item.receivedAt-item.sourceEmittedAt);
  const boundaries=(recording.closeBoundarySamples??[]).map(item=>item.sourceBoundaryToConfirmationMs);
  return {local:{status:bad.length?'INVALID_STAGE_ORDER':samples.length?'MEASURED':'UNAVAILABLE',samples:samples.length,invalidSampleIndexes:bad,metrics,reportedMetrics:latency.metrics??null,receiptBoundary:latency.receiptBoundary??null,discarded:latency.discarded??{},sourceUnavailable:latency.sourceUnavailable??{},scope:'Local source-DOM-read start to two receiving-panel animation-frame opportunities; excludes exchange/network-before-read, capture and physical screen presentation.'},
    sourceClockDifferences:{status:clockDifferences.length?'UNSYNCHRONIZED_OBSERVATIONS':'UNAVAILABLE',summary:summary(clockDifferences),firstReceivedAt:raw[0]?.receivedAt??null,lastReceivedAt:raw.at(-1)?.receivedAt??null,synchronized:false,meaning:'receiver receipt epoch ms minus Pine sourceEmittedAt; includes unknown clock offset plus unmeasured transport/queue time. This is not network or market latency.'},
    sourceCloseBoundary:{summary:summary(boundaries),meaning:'Expected source-clock bar-close boundary to source-script confirmation/log emission on the same producer clock. This does not include transport, DOM polling or receiving-panel paint.'},
    sourceDom:summarizeSourceDomLatency(recording),marketToDisplayMeasured:false,captureToDisplayMeasured:false,physicalDisplayMeasured:false};
}

function summarizeSourceDomLatency(recording){
  const source=recording.sourceDomLatency,samples=Array.isArray(source?.samples)?source.samples:[],checks=[],seen=new Set();
  const localById=new Map((recording.latency?.samples??[]).map(sample=>[sample.eventId,sample]));
  const scope='Recorded bounds from the stated source observation boundary to receiving-result DOM mutation and rendering opportunities: visible source-log DOM appearance for Logs, or first extension observation of a checksum-verified coherent visible Data Window frame. Data Window samples do not start at exchange/Pine emission or an earlier unobserved frame appearance. Calibration is an asymmetric round-trip bracket, not synchronized Pine/browser clocks. Exchange, prior network/render stages, screenshot capture and physical display remain unmeasured.';
  if(!plain(source))return {status:'UNAVAILABLE',reasonCodes:['SOURCE_DOM_TIMING_NOT_RECORDED'],samples:0,scope};
  const scopeReasons=[];
  if(source.kind!=='SOURCE_VISIBLE_LOG_DOM_TO_RESULT_PAINT_OPPORTUNITIES')scopeReasons.push('SOURCE_DOM_TIMING_KIND_UNSUPPORTED');
  if(['marketToDisplayMeasured','captureToDisplayMeasured','physicalDisplayMeasured'].some(key=>source[key]!==false))scopeReasons.push('UNSUPPORTED_LATENCY_SCOPE_CLAIM');
  for(const [index,sample] of samples.entries()){
    const reasons=[],unknown=[],key=String(sample.eventId)+'|'+String(sample.packetId),values=['calibrationBracketMs','sourceToMutationLowerMs','sourceToMutationUpperMs','sourceToPaintLowerMs','sourceToPaintUpperMs'];
    if(typeof sample.eventId!=='string'||!sample.eventId||typeof sample.packetId!=='string'||!sample.packetId||seen.has(key))reasons.push('SOURCE_DOM_CORRELATION_ID_INVALID');seen.add(key);
    if(!finite(sample.sourceAppearanceEpochMs)||sample.sourceAppearanceEpochMs<0||values.some(field=>!finite(sample[field])||sample[field]<0))reasons.push('SOURCE_DOM_TIMING_VALUE_INVALID');
    if(!reasons.length){
      if(sample.calibrationBracketMs>1000)reasons.push('SOURCE_DOM_CALIBRATION_EXCEEDS_CURRENT_LIMIT');
      if(sample.sourceToMutationLowerMs>sample.sourceToMutationUpperMs||sample.sourceToPaintLowerMs>sample.sourceToPaintUpperMs||sample.sourceToPaintLowerMs<sample.sourceToMutationLowerMs||sample.sourceToPaintUpperMs<sample.sourceToMutationUpperMs||sample.sourceToMutationUpperMs-sample.sourceToMutationLowerMs>sample.calibrationBracketMs+1e-5)reasons.push('SOURCE_DOM_BOUND_ORDER_INVALID');
      const local=localById.get(sample.eventId);
      if(!local)unknown.push('CORRESPONDING_LOCAL_SAMPLE_NOT_RETAINED');
      else if(!['mutationAt','firstPaintOpportunityAt','secondPaintOpportunityAt'].every(field=>finite(local[field]))||local.firstPaintOpportunityAt<local.mutationAt||local.secondPaintOpportunityAt<local.firstPaintOpportunityAt)reasons.push('CORRELATED_LOCAL_RENDER_ORDER_INVALID');
      else{
        const earliest=local.mutationAt-sample.sourceToMutationUpperMs,latest=earliest+sample.calibrationBracketMs;
        const expected={sourceToMutationLowerMs:Math.max(0,local.mutationAt-latest),sourceToPaintLowerMs:Math.max(0,local.firstPaintOpportunityAt-latest),sourceToPaintUpperMs:local.secondPaintOpportunityAt-earliest};
        if(Object.entries(expected).some(([field,value])=>Math.abs(sample[field]-value)>1e-5))reasons.push('SOURCE_DOM_CALIBRATION_REPLAY_MISMATCH');
      }
    }
    checks.push({index,eventId:sample.eventId??null,packetId:sample.packetId??null,sourceObservationMeaning:sample.sourceObservationMeaning??null,sourceMeaning:sample.sourceObservationMeaning??null,sourceTransport:sample.sourceTransport??null,sourceSequence:sample.sourceSequence??null,status:reasons.length?'INVALID':unknown.length?'BOUNDS_ONLY':'VALIDATED',reasonCodes:reasons,unavailableReasons:unknown});
  }
  const invalid=checks.filter(check=>check.status==='INVALID'),validated=checks.filter(check=>check.status==='VALIDATED'),boundedOnly=checks.filter(check=>check.status==='BOUNDS_ONLY');
  const metrics=Object.fromEntries(['calibrationBracketMs','sourceToMutationLowerMs','sourceToMutationUpperMs','sourceToPaintLowerMs','sourceToPaintUpperMs'].map(field=>[field,summary(samples.filter((_,index)=>checks[index].status!=='INVALID').map(sample=>sample[field]))]));
  return {status:scopeReasons.length||invalid.length?'INVALID':samples.length?boundedOnly.length?'BOUNDED_PARTIAL':'MEASURED_BOUNDED':'UNAVAILABLE',reasonCodes:scopeReasons,samples:samples.length,validated:validated.length,boundsOnly:boundedOnly.length,invalid:invalid.length,calibrationLimitMs:1000,metrics,reportedMetrics:source.metrics??null,observerLimitEvents:source.observerLimitEvents??null,excluded:source.excluded??{},checks,scope,marketToDisplayMeasured:false,captureToDisplayMeasured:false,physicalDisplayMeasured:false};
}

export function verifyLiveOhlcRecording(recording,csvText,{recordingPath=null,csvPath=null,higherCsvByTimeframe={},higherCsvPaths={},verifiedAt=new Date().toISOString()}={}){
  if(!plain(recording)||recording.kind!=='LIVE_OHLC_OBSERVATION'||!plain(recording.store))throw Error('LIVE_OHLC_RECORDING_REQUIRED');
  const volumePolicy=recordedVolumePolicy(recording),csv=readTradingViewCsv(csvText),ohlc=compareBars(recording.store,csv,volumePolicy),analysis=compareAnalysis(recording),higherTimeframes=compareHigherTimeframes(recording,csv,volumePolicy),higherTimeframeNativeCsv=compareNativeHigherCsv(recording,higherCsvByTimeframe,higherCsvPaths,volumePolicy),alerts=auditAlerts(recording),latency=summarizeLatency(recording);
  const failed=[ohlc,analysis,higherTimeframes,higherTimeframeNativeCsv,alerts].some(section=>['MISMATCH','ERROR'].includes(section.status))||latency.local.status==='INVALID_STAGE_ORDER'||latency.sourceDom.status==='INVALID';
  const complete=ohlc.status==='MATCH'&&analysis.status==='MATCH'&&['VERIFIED','NO_ALERTS_RECORDED'].includes(alerts.status)&&latency.local.status==='MEASURED';
  return {schemaVersion:1,kind:'LIVE_OHLC_RECORDED_SUBSET_VERIFICATION',status:failed?'MISMATCH':complete?'VERIFIED_SUBSET':'PARTIAL',verifiedAt,recordingPath,csvPath,recordedAt:recording.exportedAt??null,instrument:recording.store.metadata?.instrument??null,timeframe:recording.store.metadata?.timeframe??null,
    ohlc,analysis,higherTimeframes,higherTimeframeNativeCsv,alerts,latency,limitations:['CSV comparison covers only overlapping, retained, provider-final closed bars; open current bars and unverified finals are excluded explicitly.','HTF aggregation coverage requires every 1-minute constituent in both CSV and verified retained source history; unavailable buckets remain unknown.','Native higher CSV comparisons are separate from aggregation and require explicit provider-final recorded bars and exact open timestamps.','Volume comparison requires numeric volume on both sides; null or absent volume is not zero. Six-decimal rounding tolerance applies only with explicit Window transport and quantization provenance.','Manually exported CSV is a second extraction from TradingView, not an independent exchange feed, and does not independently prove symbol/session identity.','A replayed engine match verifies deterministic behavior on recorded inputs, not profitability or all market conditions.','Source/browser clock differences are unsynchronized observations, not full end-to-end latency.','Source DOM bounds begin at the sample\'s stated boundary: observed visible log appearance or first extension-observed coherent visible Data Window frame. Earlier market/Pine/render stages and physical pixels are unmeasured.','No-alert recordings cannot verify a positive live alert delivery.']};
}

async function main(){
  const args=process.argv.slice(2),positional=[],higherCsvPaths={};
  for(let index=0;index<args.length;index++){
    const value=args[index],flag=/^--higher-(5|15)$/.exec(value);
    if(flag){if(higherCsvPaths[flag[1]]||!args[index+1]||args[index+1].startsWith('--'))throw Error('HIGHER_CSV_FLAG_REQUIRES_UNIQUE_FILE:'+value);higherCsvPaths[flag[1]]=resolve(args[++index]);}
    else if(value.startsWith('--'))throw Error('UNKNOWN_FLAG:'+value);
    else positional.push(value);
  }
  const [recordingArg,csvArg,reportArg]=positional;
  if(!recordingArg||!csvArg||positional.length>3)throw Error('USAGE: node tests/verify-live-ohlc-recording.mjs LIVE_EXPORT.json TRADINGVIEW.csv [REPORT.json] [--higher-5 FILE.csv] [--higher-15 FILE.csv]');
  const recordingPath=resolve(recordingArg),csvPath=resolve(csvArg),higherEntries=Object.entries(higherCsvPaths),[recordingText,csvText,...higherTexts]=await Promise.all([readFile(recordingPath,'utf8'),readFile(csvPath,'utf8'),...higherEntries.map(([,path])=>readFile(path,'utf8'))]);
  const higherCsvByTimeframe=Object.fromEntries(higherEntries.map(([tf],index)=>[tf,higherTexts[index]]));
  const report=verifyLiveOhlcRecording(JSON.parse(recordingText),csvText,{recordingPath,csvPath,higherCsvByTimeframe,higherCsvPaths});
  const output=JSON.stringify(report,null,2)+'\n';if(reportArg)await writeFile(resolve(reportArg),output);process.stdout.write(output);if(report.status==='MISMATCH')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({status:'ERROR',reason:String(error?.message??error)})+'\n');process.exitCode=1;});
