import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGuideSignals,validateGuideSignalConfig} from '../guide-signal-engine.mjs';

const minute=60000,start=Date.UTC(2026,0,1);
const bar=(i,open,high,low,close,extra={})=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true,...extra});
const metadata={source:'ohlc',instrument:'SYNTHETIC_DEMO',timeframe:'1m',timeframeMs:minute,tickSize:.25,timezone:'Asia/Jerusalem',session:'synthetic',chartType:'standard'};
const risk={riskBudget:100,pointValue:20,commissionPerContract:0,slippageTicks:0,maxContracts:2,rewardRisk:2};
function fixture(){
  const closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];
  return [...closes.map((v,i)=>bar(i,v,v+1,v-1,v)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];
}
const run=(bars=fixture(),extra={})=>analyzeGuideSignals(bars,{metadata,risk,...extra});
const pin=result=>result.events.find(e=>e.signalIndex===25&&e.direction==='LONG');

test('known support plus overlapping rejection shapes produce one later-close research alert',()=>{
  const data=fixture(),armed=run(data.slice(0,26));
  assert.equal(pin(armed)?.status,'ARMED');assert.equal(armed.signals.length,0);
  const result=run(data),event=pin(result);
  assert.equal(event.status,'CONFIRMED');assert.ok(event.patternIds.includes('HAMMER_SHAPE'));assert.ok(event.patternIds.includes('BULLISH_PIN_SHAPE'));
  assert.equal(event.confirmedAt,data[26].closeTime);assert.equal(event.knownAt,data[25].closeTime);
  assert.equal(event.contextSnapshot.context.asOf,data[25].time);assert.ok(event.contextSnapshot.location.zones.length>0);
  assert.equal(event.riskPlan.quantity,1);assert.equal(event.riskPlan.initialStop,98.5);assert.equal(event.riskPlan.target,109);
  assert.equal(result.signals.filter(s=>s.confirmedAt===event.confirmedAt).length,1);
  assert.equal(result.orderEligible,false);assert.equal(event.orderEligible,false);assert.equal(event.execution,'OBSERVATION_ONLY');
});

test('an open confirmation bar or future availability cannot confirm an alert',()=>{
  const data=fixture();data[26].closed=false;
  assert.equal(pin(run(data)).status,'ARMED');assert.equal(run(data).signals.length,0);
  data[26].closed=true;
  const asOfTime=data[25].closeTime;
  assert.equal(pin(run(data,{asOfTime})).status,'ARMED');assert.equal(run(data,{asOfTime}).signals.length,0);
  data[26].knownAt=data[26].closeTime+minute;
  assert.equal(run(data,{asOfTime:data[26].closeTime}).signals.length,0);
});

test('appended future prices cannot rewrite frozen context, thresholds or prior confirmed alerts',()=>{
  const data=fixture(),before=run(data),original=before.signals[0];
  data.push(bar(27,102,10000,-1000,5000),bar(28,5000,5001,4000,4500));
  const after=run(data),same=after.signals.find(s=>s.eventId===original.eventId);
  assert.deepEqual(same,original);
  const replay=run(data,{asOfTime:fixture().at(-1).closeTime});
  assert.deepEqual(replay.signals,before.signals);
});

test('confirmation expiry is counted in later bars and does not revive on a late breakout',()=>{
  const data=fixture().slice(0,26);
  for(let i=26;i<=28;i++)data.push(bar(i,101,101.25,100.75,101));
  const expiredAtDeadline=pin(run(data));assert.equal(expiredAtDeadline.status,'EXPIRED');assert.equal(expiredAtDeadline.expiresAt,data[28].closeTime);
  data.push(bar(29,101,103,100.75,102));
  const event=pin(run(data));assert.equal(event.status,'EXPIRED');assert.ok(event.reasonCodes.includes('CONFIRMATION_EXPIRED'));assert.equal(event.confirmedAt,null);
});

test('a closing invalidation prevents later confirmation',()=>{
  const data=fixture().slice(0,26);data.push(bar(26,101,101.25,97,98),bar(27,98,104,97,103));
  const event=pin(run(data));assert.equal(event.status,'INVALIDATED');assert.equal(event.confirmedAt,null);
});

test('a frozen range that breaks before confirmation cannot revive on a return rally',()=>{
  const data=fixture();data[25]=bar(25,100.5,101.25,97,101);data[26]=bar(26,101,101.25,97,98);data.push(bar(27,98,103,97,102));
  const event=pin(run(data,{config:{requireRisk:false}}));
  assert.equal(event.status,'INVALIDATED');assert.deepEqual(event.reasonCodes,['FROZEN_RANGE_BROKEN']);
  assert.equal(event.invalidatedAt,data[26].closeTime);assert.equal(event.confirmedAt,null);
  assert.equal(event.contextSnapshot.context.state,'RANGE');
});

test('a quantity-zero risk plan rejects an otherwise confirmed setup without shrinking the stop',()=>{
  const result=run(fixture(),{risk:{...risk,riskBudget:10}}),event=pin(result);
  assert.equal(event.status,'REJECTED');assert.equal(event.riskPlan.quantity,0);assert.equal(event.riskPlan.initialStop,98.5);
  assert.ok(event.reasonCodes.includes('RISK_BUDGET_BELOW_ONE_CONTRACT'));assert.equal(result.signals.length,0);
  assert.equal(pin(run(fixture(),{risk:null})).reasonCodes[0],'RISK_PARAMETERS_REQUIRED');
  const research=run(fixture(),{risk:null,config:{requireRisk:false}});assert.equal(pin(research).status,'CONFIRMED');assert.equal(research.orderEligible,false);
});

test('source quality rejects pixels, nonstandard candles, missing sessions, gaps and malformed prices',()=>{
  for(const edit of [{source:'visual'},{chartType:'heikin_ashi'},{instrument:''},{tickSize:null},{timezone:'Bad/Timezone'},{session:''}]){
    const result=run(fixture(),{metadata:{...metadata,...edit}});assert.equal(result.status,'BLOCKED');assert.equal(result.signals.length,0);
  }
  const gap=fixture();gap.splice(5,1);assert.ok(run(gap).reasonCodes.includes('UNDECLARED_DATA_GAP'));
  const malformed=fixture();malformed[4].low=999;assert.ok(run(malformed).reasonCodes.includes('INVALID_OHLC'));
  const duplicate=fixture();duplicate[2]={...duplicate[1]};assert.ok(run(duplicate).reasonCodes.includes('INVALID_BAR_TIMES'));
  const missing=fixture();delete missing[4].closed;assert.ok(run(missing).reasonCodes.includes('UNVERIFIED_BAR_CLOSE'));
});

test('a visually attractive rejection shape with no confirmed context remains rejected',()=>{
  const data=[bar(0,100,101,99,100),bar(1,100.5,101.25,98.75,101),bar(2,101,103,100,102)];
  const result=run(data,{config:{requireRisk:false}});assert.equal(result.signals.length,0);
  assert.ok(result.events.some(e=>e.reasonCodes.includes('MISSING_STRUCTURE')));
});

test('guide confirmation configuration does not silently switch to a stop/limit execution model',()=>{
  assert.throws(()=>validateGuideSignalConfig({entryMode:'stop_order'}),/UNSUPPORTED_ENTRY_MODE/);
  assert.throws(()=>validateGuideSignalConfig({expiryBars:0}),/expiryBars/);
  assert.throws(()=>validateGuideSignalConfig({minConditions:0}),/LIMITS/);
  assert.throws(()=>validateGuideSignalConfig({expiryBar:2}),/INVALID_SIGNAL_CONFIG/);
});

test('invalid context or pattern parameters block even when no directional shapes exist',()=>{
  const data=[bar(0,100,100.5,99.5,100.5)];
  for(const contextConfig of [{pivotLeft:0},{unknown:true},null,[]]){
    const result=run(data,{contextConfig});assert.equal(result.status,'BLOCKED');assert.ok(result.reasonCodes.includes('INVALID_CONTEXT_CONFIG'));assert.equal(result.signals.length,0);
  }
  for(const patternConfig of [{dojiBodyMaxRatio:-1},{unknown:true},null]){
    const result=run(data,{patternConfig});assert.equal(result.status,'BLOCKED');assert.ok(result.reasonCodes.includes('INVALID_PATTERN_CONFIG'));
  }
});

test('overlapping patterns with different spans keep their own context, trigger and identity',()=>{
  const data=fixture();data[24]=bar(24,105,106,99,100);
  const result=run(data),one=result.events.find(e=>e.signalIndex===25&&e.signalStartIndex===25&&e.direction==='LONG'),two=result.events.find(e=>e.signalIndex===25&&e.signalStartIndex===24&&e.direction==='LONG');
  assert.ok(one.patternIds.includes('BULLISH_PIN_SHAPE'));assert.ok(two.patternIds.includes('BULLISH_HARAMI'));
  assert.equal(one.signalHigh,101.25);assert.equal(two.signalHigh,106);assert.equal(one.status,'CONFIRMED');assert.notEqual(two.status,'CONFIRMED');
  assert.equal(one.contextSnapshot.freezeTime,data[25].time);assert.equal(two.contextSnapshot.freezeTime,data[24].time);
  assert.notEqual(one.eventId,two.eventId);assert.equal(new Set(result.events.map(e=>e.eventId)).size,result.events.length);
});

test('higher-timeframe filter excludes unavailable bars and rejects duration or instrument mismatches',()=>{
  const makeHigher=()=>fixture().slice(0,25).map((b,i)=>({...b,time:start-((25-i)*5*minute),closeTime:start-((24-i)*5*minute)}));
  const higherTimeframes={m5:{bars:makeHigher(),timeframeMs:5*minute,instrument:metadata.instrument}};
  const valid=pin(run(fixture(),{higherTimeframes,config:{requireHigherTimeframe:true}}));
  assert.equal(valid.contextSnapshot.higherTimeframe.availability.m5.availableClosedBars,25);
  assert.equal(valid.contextSnapshot.higherTimeframe.asOf,fixture()[25].time);
  for(const entry of [{...higherTimeframes.m5,timeframeMs:minute},{...higherTimeframes.m5,instrument:'OTHER'}]){
    const event=pin(run(fixture(),{higherTimeframes:{m5:entry},config:{requireHigherTimeframe:true}}));
    assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));assert.equal(event.contextSnapshot.higherTimeframe.valid,false);
  }
  const future=makeHigher();future.push({...future.at(-1),time:start,closeTime:start+5*minute,knownAt:start+30*minute,high:10000,low:-1000});
  const withFuture=pin(run(fixture(),{higherTimeframes:{m5:{...higherTimeframes.m5,bars:future}},config:{requireHigherTimeframe:true}}));
  assert.deepEqual(withFuture.contextSnapshot.higherTimeframe.states,valid.contextSnapshot.higherTimeframe.states);
  assert.equal(withFuture.contextSnapshot.higherTimeframe.availability.m5.availableClosedBars,25);
});

test('explicit close-then-reclaim Inside formation can recover its boundary before a later-close confirmation',()=>{
  const data=fixture().slice(0,25);
  data.push(bar(25,100,102,99,101),bar(26,100,101,99.5,100.5),bar(27,100,100.5,98,98.25),bar(28,98.25,101,98,100.5),bar(29,100.5,104,100,103));
  const result=run(data,{risk:null,contextConfig:{falseBreakMode:'close_then_reclaim'},config:{requireRisk:false}});
  const event=result.events.find(e=>e.patternIds.includes('INSIDE_FALSE_BREAK')&&e.signalIndex===28&&e.direction==='LONG');
  assert.equal(event.status,'CONFIRMED');assert.equal(event.detectedAt,data[28].closeTime);assert.equal(event.confirmedAt,data[29].closeTime);
  assert.equal(event.confirmationPolicy,'later_close_beyond_setup');
  const before=run(data.slice(0,29),{risk:null,contextConfig:{falseBreakMode:'close_then_reclaim'},config:{requireRisk:false}});
  assert.equal(before.events.find(e=>e.eventId===event.eventId).status,'ARMED');
});

test('each event records effective policy separately from requested overrides',()=>{
  const requested={mode:'preview',unit:'pixels',tickSize:1,requireTimestamps:false};
  const result=run(fixture(),{patternConfig:requested}),event=pin(result),saved=event.parameterSnapshot;
  assert.deepEqual(saved.requested.patternConfig,requested);
  assert.equal(saved.patternConfig.mode,'closed');assert.equal(saved.patternConfig.unit,'price');assert.equal(saved.patternConfig.tickSize,metadata.tickSize);assert.equal(saved.patternConfig.requireTimestamps,true);
  assert.equal(saved.patternConfig.asOfTime,event.knownAt);assert.equal(saved.contextConfig.asOf,fixture()[25].time);
  assert.equal(saved.patternConfig.dojiBodyMaxRatio,.1);assert.equal(saved.contextConfig.pivotRight,2);
});
