import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePatternStudy} from '../research-pattern-study.mjs';

const minute=60_000;
function fixture(){
  const bars=Array.from({length:3000},(_,i)=>({
    time:i*minute,closeTime:(i+1)*minute,providerBarIndex:i,
    open:100,high:102,low:99,close:101,closed:true,sourceClosed:true,
    finalOhlcVerified:true,sessionFirst:false,sessionLast:false,
  }));
  Object.assign(bars[42],{open:103,high:103,low:99.75,close:100});
  Object.assign(bars[2997],{open:100,high:106,low:99,close:105});
  Object.assign(bars[2998],{open:104,high:109,low:103,close:107});
  Object.assign(bars[2999],{open:107,high:112,low:106,close:108.5});
  return {kind:'LIVE_OHLC_OBSERVATION',schemaVersion:1,selectedRun:'fixture',analysisInputs:{
    bars,options:{metadata:{instrument:'CME_MINI:NQ1!',timeframe:'1',tickSize:.25,sourceId:'fixture'},asOfTime:3000*minute},
  }};
}

test('the 3,000-bar report retains early and late detections at their candle close',()=>{
  const report=analyzePatternStudy(fixture());
  assert.equal(report.barCount,3000);
  assert.deepEqual(report.groups.map(group=>group.times),[[3000*minute],[43*minute]]);
});

test('research follow-ups use later bars only, and a final candle has no complete future window',()=>{
  const recording=fixture(),bars=recording.analysisInputs.bars;
  Object.assign(bars[47],{open:99,close:98,low:97});
  const report=analyzePatternStudy(recording);
  const [[advance],[belt]]=report.groups.map(group=>group.detections);
  assert.equal(report.candles.length,3000);
  assert.equal(belt.chartStart,31);
  assert.deepEqual(belt.checks,['longBody','bear','openAtHigh','lowClose']);
  assert.deepEqual(belt.horizons[0],{status:'AVAILABLE',close:98,change:-2,mfe:3,mae:2});
  assert.deepEqual(belt.horizons[1],{status:'AVAILABLE',close:101,change:1,mfe:3,mae:2});
  assert.deepEqual(advance.horizons,[{status:'OUTSIDE_WINDOW'},{status:'OUTSIDE_WINDOW'}]);
});

test('a verified market closure censors only the horizons that need to cross it',()=>{
  const recording=fixture(),bars=recording.analysisInputs.bars;
  bars[47].sessionLast=true;
  bars[48].sessionFirst=true;
  for(const bar of bars.slice(48)){
    bar.time+=30*minute;
    bar.closeTime+=30*minute;
  }
  recording.analysisInputs.options.asOfTime+=30*minute;
  const hit=analyzePatternStudy(recording).groups[1].detections[0];
  assert.equal(hit.horizons[0].status,'AVAILABLE');
  assert.equal(hit.horizons[1].status,'SESSION_BOUNDARY');
});

test('the report requires exactly 3,000 available verified minute bars with no missing provider rows',()=>{
  const recording=fixture(),bars=recording.analysisInputs.bars;
  bars[30].providerBarIndex+=1;
  assert.throws(()=>analyzePatternStudy(recording),/פער לא מאומת/);
  bars[30].providerBarIndex-=1;
  bars.at(-1).knownAt=3000*minute+1;
  assert.throws(()=>analyzePatternStudy(recording),/נר שלא היה זמין/);
  bars.pop();
  assert.throws(()=>analyzePatternStudy(recording),/3,000 נרות/);
});
