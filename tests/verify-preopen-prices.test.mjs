import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPreopenPrices} from '../scripts/verify-preopen-prices.mjs';

const sourceAt=Date.UTC(2026,10,14,12),end=Date.UTC(2026,10,13,22);
const metadata={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
const bars=duration=>Array.from({length:20},(_,index)=>({time:end-(20-index)*duration,closeTime:end-(19-index)*duration,open:28000,high:28002,low:27999,close:28001,volume:100,closed:true,sourceClosed:true,providerBarIndex:index+1,sessionFirst:false,sessionLast:index===19}));
const csv=rows=>['time,open,high,low,close,ARROW2_CURRENT_VOLUME',...rows.map(bar=>[bar.time/1000,bar.open,bar.high,bar.low,bar.close,bar.volume].join(','))].join('\n');
function fixture(){
  const history={runEpoch:sourceAt-1000,runId:metadata.instrument+'|1|'+(sourceAt-1000),sourceEmittedAt:sourceAt,metadata,baseBars:bars(60000),higherTimeframes:['5','15'].map(timeframe=>({timeframe,timeframeMs:Number(timeframe)*60000,bars:bars(Number(timeframe)*60000)}))};
  const recording={kind:'LIVE_OHLC_OBSERVATION',extensionVersion:'0.13.0',preopenContext:{kind:'PREOPEN_CONTEXT_ONLY',contextOnly:true,liveEligible:false,bootstrapHistory:history}};
  return {recording,history,csvs:{'1':csv(history.baseBars),...Object.fromEntries(history.higherTimeframes.map(series=>[series.timeframe,csv(series.bars)]))}};
}

test('pre-open exact prices match every1/5/15minute seed bar while indicator volume remains unavailable',()=>{
  const f=fixture(),report=verifyPreopenPrices(f.recording,f.csvs);
  assert.equal(report.status,'MATCH_ALL_RECORDED_PRICES');assert.equal(report.sourceBars,60);assert.equal(report.matched,60);assert.equal(report.missing,0);assert.equal(report.liveSignalVerified,false);assert.equal(report.exchangeAccuracyVerified,false);
  for(const series of Object.values(report.series)){assert.equal(series.matched,20);assert.equal(series.pricePolicy,'EXACT_NUMERIC_EQUALITY_NO_TOLERANCE');assert.equal(series.volume.status,'UNAVAILABLE');assert.equal(series.volume.csvColumnIncluded,false);assert.equal(series.maximumAbsoluteDifference,0);}
  assert.equal(report.series['1'].checks[0].time,f.history.baseBars[0].time,'native seconds convert exactly to recorded UTC milliseconds');
});

test('one missing native row produces partial coverage instead of a complete price match',()=>{
  const f=fixture();f.csvs['5']=csv(f.history.higherTimeframes[0].bars.slice(1));const report=verifyPreopenPrices(f.recording,f.csvs);
  assert.equal(report.status,'PARTIAL');assert.equal(report.matched,59);assert.equal(report.missing,1);assert.equal(report.series['5'].coverageFraction,.95);assert.equal(report.series['5'].checks[0].status,'MISSING_CSV_ROW');
});

test('price differences have no trading tick tolerance and are reported with their exact field',()=>{
  const f=fixture(),changed=structuredClone(f.history.higherTimeframes[1].bars);changed[4].close+=1e-8;f.csvs['15']=csv(changed);const report=verifyPreopenPrices(f.recording,f.csvs);
  assert.equal(report.status,'MISMATCH');assert.equal(report.matched,59);assert.equal(report.mismatched,1);assert.equal(report.series['15'].checks[4].differences[0].field,'close');assert.ok(report.series['15'].checks[4].differences[0].absoluteDifference>0);
});

test('wrong CSV interval and unconfirmed source bars remain unavailable without fabricated matches',()=>{
  const f=fixture();f.csvs['5']=f.csvs['1'];let report=verifyPreopenPrices(f.recording,f.csvs);assert.equal(report.status,'PARTIAL');assert.deepEqual(report.series['5'].reasonCodes,['CSV_TIMEFRAME_UNVERIFIED_OR_MISMATCH']);assert.equal(report.series['5'].matched,0);
  const invalid=fixture();invalid.history.baseBars[0].sourceClosed=false;report=verifyPreopenPrices(invalid.recording,invalid.csvs);assert.equal(report.status,'PARTIAL');assert.ok(report.series['1'].reasonCodes.includes('SEED_PROVIDER_FINAL_REQUIRED'));assert.equal(report.series['1'].matched,0);
  invalid.history.baseBars.push(...bars(60000));invalid.history.baseBars.push(...bars(60000));invalid.history.baseBars.push(...bars(60000));invalid.history.baseBars.push(...bars(60000));invalid.history.baseBars.push(...bars(60000));report=verifyPreopenPrices(invalid.recording,invalid.csvs);assert.deepEqual(report.series['1'].reasonCodes,['SEED_BAR_COUNT_INVALID']);
});

test('a live or nonstandard cache cannot be relabeled as a prepared historical source',()=>{
  const f=fixture();f.recording.preopenContext.liveEligible=true;assert.throws(()=>verifyPreopenPrices(f.recording,f.csvs),/BOUNDED_PREOPEN_CONTEXT_REQUIRED/);
  f.recording.preopenContext.liveEligible=false;f.history.metadata.chartType='heikin_ashi';assert.throws(()=>verifyPreopenPrices(f.recording,f.csvs),/STANDARD_ONE_MINUTE_PREOPEN_SOURCE_REQUIRED/);
});
