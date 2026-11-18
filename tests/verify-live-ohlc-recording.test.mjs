import test from 'node:test';
import assert from 'node:assert/strict';
import {readTradingViewCsv,verifyLiveOhlcRecording} from './verify-live-ohlc-recording.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';

const start=Date.UTC(2026,10,14,8),minute=60000;
const metadata={source:'ohlc',provider:'TradingView Pine Logs',sourceId:'run',instrument:'BITSTAMP:BTCUSD',timeframe:'1',timeframeMs:minute,tickSize:.01,pointValue:1,currency:'USD',timezone:'Etc/UTC',session:'regular',chartType:'standard'};
const baseBars=(count=30)=>Array.from({length:count},(_,index)=>({time:start+index*minute,closeTime:start+(index+1)*minute,knownAt:start+(index+1)*minute,open:100+index,high:103+index,low:99+index,close:102+index,volume:index+1,closed:true,sourceClosed:true,finalOhlcVerified:true,receivedAt:start+(index+1)*minute+10}));
function csv(bars,{volume=true}={}){return ['time,open,high,low,close'+(volume?',Volume':''),...bars.map(bar=>[bar.time/1000,bar.open,bar.high,bar.low,bar.close,...(volume?[bar.volume??'']:[])].join(','))].join('\n');}
function higher(bars,tf){
  const output=[];
  for(let index=0;index+tf<=bars.length;index+=tf){const block=bars.slice(index,index+tf);output.push({time:block[0].time,closeTime:block.at(-1).closeTime,knownAt:block.at(-1).closeTime,open:block[0].open,high:Math.max(...block.map(bar=>bar.high)),low:Math.min(...block.map(bar=>bar.low)),close:block.at(-1).close,volume:block.reduce((sum,bar)=>sum+bar.volume,0),closed:true,sourceClosed:true});}
  return {timeframe:String(tf),timeframeMs:tf*minute,metadata:{...metadata,timeframe:String(tf),timeframeMs:tf*minute},bars:output};
}
function fixture({exact=true,higherData=true}={}){
  const bars=baseBars(),asOfTime=bars.at(-1).closeTime+100,appliedOptions={config:{requireRisk:false,requireLocation:false,requireHigherTimeframe:true}},higherTimeframes={'5':higher(bars,5),'15':higher(bars,15)};
  const options={metadata,...appliedOptions,...(higherData?{higherTimeframes}:{}),asOfTime},latestAnalysis=analyzeGuideSignals(bars,options);
  const local={eventId:'read:1',receivedAt:100,analysisStartedAt:101,analysisFinishedAt:110,mutationAt:112,firstPaintOpportunityAt:120,secondPaintOpportunityAt:128,queueMs:1,analysisMs:9,receiptToMutationMs:12,receiptToPaintOpportunityLowerMs:20,receiptToPaintOpportunityUpperMs:28};
  const recording={schemaVersion:1,kind:'LIVE_OHLC_OBSERVATION',orderEligible:false,selectedRun:'run',appliedOptions,store:{metadata,bars:structuredClone(bars),current:null,orderEligible:false,decisionAsOfTime:asOfTime,sourceDecisionTime:asOfTime,bootstrapAsOfTime:start-1},latestAnalysis,alerts:[],latency:{samples:[local]}};
  if(exact)recording.analysisInputs={bars:structuredClone(bars),options:structuredClone(options)};
  if(higherData)recording.timeframes={asOfTime,higherTimeframes:structuredClone(higherTimeframes)};
  return {recording,bars,csv:csv(bars)};
}
function attachDom(recording){recording.sourceDomLatency={kind:'SOURCE_VISIBLE_LOG_DOM_TO_RESULT_PAINT_OPPORTUNITIES',marketToDisplayMeasured:false,captureToDisplayMeasured:false,physicalDisplayMeasured:false,observerLimitEvents:0,samples:[{eventId:'read:1',packetId:'run:123',sourceAppearanceEpochMs:start,calibrationBracketMs:5,sourceToMutationLowerMs:27,sourceToMutationUpperMs:32,sourceToPaintLowerMs:35,sourceToPaintUpperMs:48}]};}

test('exact captured analysis inputs replay independently of later retained store and edited current options',()=>{
  const f=fixture();f.recording.store.bars=baseBars(40).slice(10);f.recording.appliedOptions.config.requireHigherTimeframe=false;
  const report=verifyLiveOhlcRecording(f.recording,f.csv);
  assert.equal(report.analysis.status,'MATCH');assert.equal(report.analysis.completeAnalysisMatch,true);assert.equal(report.analysis.inputMode,'EXACT_RECORDED_ANALYSIS_INPUTS');assert.equal(report.analysis.inputBars,30);assert.equal(report.analysis.recordedAnalysisSha256,report.analysis.recomputedAnalysisSha256);
  f.recording.latestAnalysis.cache={hit:false,computations:9,hits:3};assert.equal(verifyLiveOhlcRecording(f.recording,f.csv).analysis.status,'MATCH');assert.deepEqual(report.analysis.excludedOperationalFields,['cache']);
  f.recording.latestAnalysis.currentChecks.directions.LONG.reasonCodes.push('ALTERED');
  const changed=verifyLiveOhlcRecording(f.recording,f.csv);assert.equal(changed.analysis.completeAnalysisMatch,false);assert.equal(changed.analysis.status,'MISMATCH');assert.equal(changed.status,'MISMATCH');
});

test('legacy analysis uses retained prefix and exported higher series; malformed exact inputs do not silently fall back',()=>{
  const f=fixture({exact:false});const report=verifyLiveOhlcRecording(f.recording,f.csv);assert.equal(report.analysis.status,'MATCH');assert.equal(report.analysis.inputMode,'LEGACY_RETAINED_STORE_PREFIX');assert.deepEqual(report.analysis.appliedOptions.higherTimeframes,f.recording.timeframes.higherTimeframes);
  f.recording.store.bars.shift();assert.equal(verifyLiveOhlcRecording(f.recording,f.csv).analysis.reasonCodes[0],'RETAINED_HISTORY_DOES_NOT_COVER_ANALYSIS_PREFIX');
  f.recording.analysisInputs={bars:[],options:{}};assert.equal(verifyLiveOhlcRecording(f.recording,f.csv).analysis.reasonCodes[0],'EXACT_ANALYSIS_REPLAY_INPUTS_INVALID');
  const older=fixture({exact:false});older.recording.latestAnalysis.definitionVersion='older-engine-definition';const unavailable=verifyLiveOhlcRecording(older.recording,older.csv).analysis;assert.equal(unavailable.status,'UNAVAILABLE');assert.deepEqual(unavailable.reasonCodes,['ENGINE_DEFINITION_VERSION_MISMATCH']);
});

test('complete verified1-minute buckets reproduce exact provider5/15-minute OHLC and summed volume',()=>{
  const f=fixture(),report=verifyLiveOhlcRecording(f.recording,f.csv),higherReport=report.higherTimeframes;
  assert.equal(higherReport.status,'MATCH');assert.equal(higherReport.compared,8);assert.equal(higherReport.matched,8);assert.equal(higherReport.unknown,0);
  assert.equal(higherReport.series['5'].compared,6);assert.equal(higherReport.series['15'].compared,2);assert.equal(higherReport.series['15'].coverageFraction,1);assert.equal(higherReport.series['5'].volume.status,'MATCH');assert.equal(higherReport.series['5'].checks[0].aggregate.volume,15);
  delete f.recording.timeframes;assert.equal(verifyLiveOhlcRecording(f.recording,f.csv).higherTimeframes.sourceBasis,'CAPTURED_ANALYSIS_INPUTS');
  const missing=fixture();missing.recording.timeframes.higherTimeframes['15'].bars=[];const partial=verifyLiveOhlcRecording(missing.recording,missing.csv).higherTimeframes;assert.equal(partial.status,'PARTIAL');assert.deepEqual(partial.unavailableSeries,['15']);
});

test('CSV holes, absent final base history and future availability stay unknown without padded buckets or market-gap assumptions',()=>{
  for(const mode of ['csvHole','baseHole','unverified','futureBase']){
    const f=fixture(),rows=structuredClone(f.bars);
    if(mode==='csvHole')rows.splice(3,1);
    if(mode==='baseHole')f.recording.store.bars.splice(3,1);
    if(mode==='unverified')f.recording.store.bars[3].finalOhlcVerified=false;
    if(mode==='futureBase')f.recording.store.bars[3].knownAt=f.recording.timeframes.asOfTime+1;
    const report=verifyLiveOhlcRecording(f.recording,csv(rows)).higherTimeframes;
    assert.equal(report.status,'PARTIAL');assert.equal(report.unknown,2);assert.equal(report.compared,6);assert.equal(report.series['5'].checks[0].status,'UNKNOWN');assert.equal(report.series['15'].checks[0].status,'UNKNOWN');assert.ok(report.series['5'].checks[0].reasonCodes.includes(mode==='csvHole'?'INCOMPLETE_CSV_BUCKET':'INCOMPLETE_VERIFIED_BASE_BUCKET'));
  }
});

test('higher mismatches are failures, while unconfirmed higher rows and mismatched base rows cannot be used to verify aggregates',()=>{
  const f=fixture();f.recording.timeframes.higherTimeframes['5'].bars[0].high+=1;
  const bad=verifyLiveOhlcRecording(f.recording,f.csv);assert.equal(bad.status,'MISMATCH');assert.equal(bad.higherTimeframes.mismatched,1);assert.equal(bad.higherTimeframes.series['5'].checks[0].differences[0].field,'high');
  const open=fixture();open.recording.timeframes.higherTimeframes['5'].bars[0].sourceClosed=false;assert.ok(verifyLiveOhlcRecording(open.recording,open.csv).higherTimeframes.series['5'].checks[0].reasonCodes.includes('HIGHER_FINAL_NOT_VERIFIED'));
  const changed=fixture(),rows=structuredClone(changed.bars);rows[3].high+=1;
  const mismatch=verifyLiveOhlcRecording(changed.recording,csv(rows));assert.equal(mismatch.ohlc.status,'MISMATCH');assert.ok(mismatch.higherTimeframes.series['5'].checks[0].reasonCodes.includes('BASE_CSV_VALUES_MISMATCH'));
  const interval=fixture();interval.recording.store.metadata={...metadata,timeframe:'5S',timeframeMs:5000};assert.equal(verifyLiveOhlcRecording(interval.recording,interval.csv).higherTimeframes.status,'UNAVAILABLE');
});

test('nullable volume stays unknown, floating rounding uses explicit volume tolerance, and numeric differences are reported',()=>{
  const f=fixture(),rows=structuredClone(f.bars);f.recording.store.bars[0].volume=null;delete f.recording.store.bars[1].volume;rows[2].volume+=1e-10;
  const report=verifyLiveOhlcRecording(f.recording,csv(rows));assert.equal(report.ohlc.status,'MATCH');assert.equal(report.ohlc.volume.status,'PARTIAL');assert.equal(report.ohlc.volume.unavailable,2);assert.equal(report.ohlc.volume.compared,28);
  rows[4].volume+=1;const bad=verifyLiveOhlcRecording(f.recording,csv(rows));assert.equal(bad.ohlc.status,'MISMATCH');assert.equal(bad.ohlc.volume.mismatched,1);assert.equal(bad.higherTimeframes.series['5'].volume.mismatched,1);
  const missing=fixture(),unknown=structuredClone(missing.bars);unknown[4].volume=null;assert.equal(verifyLiveOhlcRecording(missing.recording,csv(unknown)).higherTimeframes.series['5'].volume.unavailable,1);
  assert.equal(verifyLiveOhlcRecording(missing.recording,csv(missing.bars,{volume:false})).ohlc.volume.status,'UNAVAILABLE');
  const parsed=readTradingViewCsv('time,open,high,low,close,volume\n1,1,2,0,1,NaN\n2,1,2,0,1,');assert.equal(parsed[0].volume,null);assert.equal(parsed[1].volume,null);
  assert.throws(()=>readTradingViewCsv('time,open,high,low,close,volume\n1,1,2,0,1,-1'),/CSV_INVALID_VOLUME/);
  for(const volume of [-1,NaN,'42']){const invalid=fixture();invalid.recording.store.bars[0].volume=volume;const report=verifyLiveOhlcRecording(invalid.recording,invalid.csv);assert.equal(report.ohlc.volume.status,'MISMATCH');assert.equal(report.ohlc.volume.invalidRecorded,1);}
});

test('source-DOM bounds replay against recorded local render stages and retain explicit scope limits',()=>{
  const f=fixture();attachDom(f.recording);const report=verifyLiveOhlcRecording(f.recording,f.csv),source=report.latency.sourceDom;
  assert.equal(source.status,'MEASURED_BOUNDED');assert.equal(source.validated,1);assert.equal(source.metrics.sourceToPaintLowerMs.p50Ms,35);assert.equal(source.metrics.sourceToPaintUpperMs.p50Ms,48);assert.equal(source.metrics.calibrationBracketMs.maxMs,5);
  assert.equal(source.marketToDisplayMeasured,false);assert.equal(source.captureToDisplayMeasured,false);assert.equal(source.physicalDisplayMeasured,false);assert.equal(report.latency.marketToDisplayMeasured,false);
});

test('invalid source calibration, bound order, duplicates or inflated market/capture claims fail verification',()=>{
  for(const mutate of [source=>source.samples[0].calibrationBracketMs=6,source=>source.samples[0].calibrationBracketMs=1001,source=>source.samples[0].sourceToPaintUpperMs=-1,source=>source.samples[0].sourceToMutationLowerMs=40,source=>source.samples.push(structuredClone(source.samples[0])),source=>source.marketToDisplayMeasured=true,source=>source.captureToDisplayMeasured=true]){
    const f=fixture();attachDom(f.recording);mutate(f.recording.sourceDomLatency);const report=verifyLiveOhlcRecording(f.recording,f.csv);assert.equal(report.latency.sourceDom.status,'INVALID');assert.equal(report.status,'MISMATCH');
  }
});

test('a bounded timing sample without retained local stages is partial; no source samples never become a measured result',()=>{
  const f=fixture();attachDom(f.recording);f.recording.sourceDomLatency.samples[0].eventId='older-read';const partial=verifyLiveOhlcRecording(f.recording,f.csv).latency.sourceDom;assert.equal(partial.status,'BOUNDED_PARTIAL');assert.equal(partial.boundsOnly,1);
  f.recording.sourceDomLatency.samples=[];assert.equal(verifyLiveOhlcRecording(f.recording,f.csv).latency.sourceDom.status,'UNAVAILABLE');delete f.recording.sourceDomLatency;assert.equal(verifyLiveOhlcRecording(f.recording,f.csv).latency.sourceDom.status,'UNAVAILABLE');
});

test('native higher CSVs directly verify all retained provider finals independently of limited1-minute retained history',()=>{
  const f=fixture(),options={higherCsvByTimeframe:{'5':csv(f.recording.timeframes.higherTimeframes['5'].bars),'15':csv(f.recording.timeframes.higherTimeframes['15'].bars)},higherCsvPaths:{'5':'/declared/tradingview-5.csv','15':'/declared/tradingview-15.csv'}};
  f.recording.store.bars=f.recording.store.bars.slice(-3);
  const report=verifyLiveOhlcRecording(f.recording,f.csv,options);assert.equal(report.higherTimeframes.status,'UNAVAILABLE');assert.equal(report.higherTimeframeNativeCsv.status,'MATCH');assert.equal(report.higherTimeframeNativeCsv.matched,8);assert.equal(report.higherTimeframeNativeCsv.series['5'].coverageFraction,1);assert.equal(report.higherTimeframeNativeCsv.series['15'].volume.status,'MATCH');assert.equal(report.higherTimeframeNativeCsv.series['5'].csvPath,options.higherCsvPaths['5']);
});

test('native higher CSV missing rows and missing source volume are partial; price or volume differences fail',()=>{
  const f=fixture(),five=structuredClone(f.recording.timeframes.higherTimeframes['5'].bars),fifteen=f.recording.timeframes.higherTimeframes['15'].bars;
  const options={higherCsvByTimeframe:{'5':csv(five.slice(1)),'15':csv(fifteen)}};
  const partial=verifyLiveOhlcRecording(f.recording,f.csv,options).higherTimeframeNativeCsv;assert.equal(partial.status,'PARTIAL');assert.equal(partial.series['5'].nonoverlapCount,1);assert.equal(partial.series['5'].compared,5);assert.equal(partial.series['15'].matched,2);
  f.recording.timeframes.higherTimeframes['5'].bars.forEach(bar=>bar.volume=null);options.higherCsvByTimeframe['5']=csv(five);assert.equal(verifyLiveOhlcRecording(f.recording,f.csv,options).higherTimeframeNativeCsv.series['5'].status,'PARTIAL');
  f.recording.timeframes.higherTimeframes['5'].bars=structuredClone(five);five[0].high+=1;options.higherCsvByTimeframe['5']=csv(five);const mismatch=verifyLiveOhlcRecording(f.recording,f.csv,options);assert.equal(mismatch.higherTimeframeNativeCsv.status,'MISMATCH');assert.equal(mismatch.status,'MISMATCH');
});

test('native higher comparisons reject unknown provider series, wrong CSV intervals and unverified closes',()=>{
  const f=fixture();const wrong=verifyLiveOhlcRecording(f.recording,f.csv,{higherCsvByTimeframe:{'5':f.csv}}).higherTimeframeNativeCsv;assert.equal(wrong.status,'UNAVAILABLE');assert.ok(wrong.series['5'].reasonCodes.includes('CSV_TIMEFRAME_UNVERIFIED_OR_MISMATCH'));
  const missing=verifyLiveOhlcRecording(f.recording,f.csv,{higherCsvByTimeframe:{'30':f.csv}}).higherTimeframeNativeCsv;assert.equal(missing.status,'UNAVAILABLE');assert.ok(missing.series['30'].reasonCodes.includes('PROVIDER_HIGHER_SERIES_NOT_RECORDED'));
  const text=csv(f.recording.timeframes.higherTimeframes['5'].bars);f.recording.timeframes.higherTimeframes['5'].bars[0].sourceClosed=false;
  const unverified=verifyLiveOhlcRecording(f.recording,f.csv,{higherCsvByTimeframe:{'5':text}}).higherTimeframeNativeCsv;assert.equal(unverified.series['5'].status,'PARTIAL');assert.equal(unverified.series['5'].excludedUnverifiedSourceBars,1);assert.equal(unverified.series['5'].compared,5);
  assert.throws(()=>verifyLiveOhlcRecording(f.recording,f.csv,{higherCsvByTimeframe:null}),/HIGHER_CSV_OPTIONS_INVALID/);
});

function declareWindowQuantization(recording){recording.sourceTransport='window';recording.windowEvidence={bootstrapMetadata:{encoding:{volumeQuantized:true,volumeDecimals:6}}};}

test('explicit Window six-decimal volume quantization passes legitimate half-unit rounding in base and native HTF CSVs',()=>{
  const f=fixture(),reference=structuredClone(f.bars);declareWindowQuantization(f.recording);
  reference[0].volume=.1234565;f.recording.store.bars[0].volume=.123457;
  const native={};for(const tf of ['5','15']){const rows=structuredClone(f.recording.timeframes.higherTimeframes[tf].bars);rows[0].volume=.3333335;f.recording.timeframes.higherTimeframes[tf].bars[0].volume=.333334;native[tf]=csv(rows);}
  const report=verifyLiveOhlcRecording(f.recording,csv(reference),{higherCsvByTimeframe:native});
  assert.equal(report.ohlc.status,'MATCH');assert.equal(report.ohlc.volume.mismatched,0);assert.equal(report.ohlc.volume.quantization.applied,true);assert.equal(report.ohlc.volume.quantization.maximumAbsoluteQuantizationError,5e-7);
  for(const tf of ['5','15']){assert.equal(report.higherTimeframeNativeCsv.series[tf].status,'MATCH');assert.equal(report.higherTimeframeNativeCsv.series[tf].volume.quantization.applied,true);}
  reference[0].volume=.1234563;assert.equal(verifyLiveOhlcRecording(f.recording,csv(reference)).ohlc.status,'MISMATCH','a larger rounding error is not forgiven');
});

test('Window label alone, incomplete precision provenance, or Logs transport cannot relax volume verification',()=>{
  for(const mode of ['window_only','wrong_decimals','missing_flag','logs']){
    const f=fixture(),reference=structuredClone(f.bars);reference[0].volume=.1234565;f.recording.store.bars[0].volume=.123457;declareWindowQuantization(f.recording);
    if(mode==='window_only')delete f.recording.windowEvidence;
    if(mode==='wrong_decimals')f.recording.windowEvidence.bootstrapMetadata.encoding.volumeDecimals=5;
    if(mode==='missing_flag')delete f.recording.windowEvidence.bootstrapMetadata.encoding.volumeQuantized;
    if(mode==='logs')f.recording.sourceTransport='logs';
    const report=verifyLiveOhlcRecording(f.recording,csv(reference));assert.equal(report.ohlc.status,'MISMATCH',mode);assert.equal(report.ohlc.volume.quantization.applied,false,mode);
  }
});

test('Window quantization keeps missing volume distinct from observed zero',()=>{
  const f=fixture(),reference=structuredClone(f.bars);declareWindowQuantization(f.recording);
  reference[0].volume=0;reference[1].volume=0;reference[2].volume=0;f.recording.store.bars[0].volume=null;delete f.recording.store.bars[1].volume;f.recording.store.bars[2].volume=0;
  const audit=verifyLiveOhlcRecording(f.recording,csv(reference)).ohlc.volume;
  assert.equal(audit.status,'PARTIAL');assert.equal(audit.unavailable,2);assert.equal(audit.compared,28);assert.equal(audit.matched,28);assert.equal(audit.mismatched,0);
});

test('Window timing retains its explicit coherent-frame boundary despite the legacy timing-kind name',()=>{
  const f=fixture();attachDom(f.recording);f.recording.sourceTransport='window';const sample=f.recording.sourceDomLatency.samples[0];
  sample.sourceObservationMeaning='FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME';sample.sourceTransport='PUBLIC_DATA_WINDOW_V2';sample.sourceSequence=123;
  const report=verifyLiveOhlcRecording(f.recording,f.csv),source=report.latency.sourceDom;
  assert.equal(source.status,'MEASURED_BOUNDED');assert.equal(source.checks[0].sourceObservationMeaning,sample.sourceObservationMeaning);assert.equal(source.checks[0].sourceMeaning,sample.sourceObservationMeaning);assert.equal(source.checks[0].sourceTransport,'PUBLIC_DATA_WINDOW_V2');assert.equal(source.checks[0].sourceSequence,123);
  assert.match(source.scope,/first extension observation of a checksum-verified coherent visible Data Window frame/);
  assert.equal(source.marketToDisplayMeasured,false);assert.equal(source.captureToDisplayMeasured,false);assert.equal(source.physicalDisplayMeasured,false);
});
