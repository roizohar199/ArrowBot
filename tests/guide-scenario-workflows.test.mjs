import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGuideSignals,GUIDE_ALL_SCENARIO_CONTEXT} from '../guide-signal-engine.mjs';
import {analyzeMarketContext,DEFAULT_CONTEXT_CONFIG} from '../market-context.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';

// Controlled fixtures prove rule reachability, not real-market profitability.
const minute=60000,start=Date.UTC(2026,0,1),metadata={source:'ohlc',instrument:'SYNTHETIC_WORKFLOW',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard'};
const bar=(i,open,high,low,close)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true});
const rows=values=>values.map((v,i)=>bar(i,v,v+1,v-1,v));
const range=()=>rows([105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105]);
const rise=()=>rows([100,105,110,105,101,106,110.5,106,102,107,111,107,103,108,111.5,108,104,109,112,109,105,110,112.5,110,106]);
const mirror=bars=>bars.map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}));
const run=(bars,extra={})=>analyzeGuideSignals(bars,{metadata,config:{requireRisk:false,requireLocation:false,minConditions:1},contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT,zoneToleranceTicks:4},...extra});
const roleFixture=()=>[...range(),bar(25,100,101,95,96),bar(26,98.5,102,97.25,97.5),bar(27,97.5,98,95.5,96.5)];

test('standard-workflow preset enables role reversal without changing low-level historical research defaults',()=>{
  assert.equal(GUIDE_ALL_SCENARIO_CONTEXT.roleReversalEnabled,true);
  assert.equal(Object.isFrozen(GUIDE_ALL_SCENARIO_CONTEXT),true);
  assert.equal(DEFAULT_CONTEXT_CONFIG.roleReversalEnabled,false);
  assert.equal(run(roleFixture()).parameterSnapshot.contextConfig.roleReversalEnabled,true);
});

test('the same standard-workflow preset reaches all nine implemented scenario families without per-family switches',()=>{
  const hanging=[...rise(),bar(25,112,113,109,112.5),bar(26,112.5,113,108,108.5)];
  const fixtures=[
    [...range(),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)],
    hanging,mirror(hanging),
    [...rise(),bar(25,105.5,107,100,106),bar(26,106,109,105,108)],
    roleFixture(),
    [...range(),bar(25,100,101,96,97),bar(26,96.75,103,96.5,102),bar(27,102,104,101,103.5)],
    [...rise(),bar(25,105,114,104,110),bar(26,110,112,106,111),bar(27,111,115,110,114.5),bar(28,114.5,117,114,116)],
    [...range(),bar(25,104,110,100,105),bar(26,105,108,102,106),bar(27,106,111,103,107),bar(28,107,108,101,102)]
  ];
  const actual=new Set(),expected=['TREND_CONTINUATION','REVERSAL_AT_ZONE','RANGE_EDGE','INSIDE_BREAKOUT','INSIDE_FALSE_BREAK','HANGING_MAN_REVERSAL','INVERTED_HAMMER_REVERSAL','ENGULFING_RANGE_RECLAIM','ROLE_REVERSAL_RETEST'];
  for(const data of fixtures){
    const analysis=run(data);assert.notEqual(analysis.status,'BLOCKED');
    assert.equal(analysis.orderEligible,false);
    const explained=describeGuideAnalysis(analysis);
    assert.deepEqual(explained.scenarioFamilies.map(item=>item.id).sort(),[...expected].sort());
    for(const event of analysis.events.filter(item=>item.signalIndex>=25)){
      assert.equal(event.orderEligible,false);assert.equal(event.execution,'OBSERVATION_ONLY');
      if(event.patternIds.includes('INSIDE_BREAKOUT'))actual.add('INSIDE_BREAKOUT');
      else if(event.patternIds.includes('INSIDE_FALSE_BREAK'))actual.add('INSIDE_FALSE_BREAK');
      else if(expected.includes(event.setupId))actual.add(event.setupId);
    }
  }
  assert.deepEqual([...actual].sort(),[...expected].sort());
});

test('enabled role reversal still needs a previously closed break, a retest and later-close confirmation',()=>{
  const data=roleFixture(),beforeBreak=analyzeMarketContext(data.slice(0,25),{tickSize:.25,...GUIDE_ALL_SCENARIO_CONTEXT});
  assert.equal(beforeBreak.zones.some(zone=>zone.roleReversal),false);
  const atRetest=run(data.slice(0,27)),armed=atRetest.events.find(event=>event.setupId==='ROLE_REVERSAL_RETEST'&&event.signalIndex===26&&event.direction==='SHORT');
  assert.equal(armed.status,'ARMED');assert.equal(armed.confirmedAt,null);assert.equal(armed.scenarioApplicability.applicable,true);
  const zone=armed.contextSnapshot.location.zones.find(zone=>zone.roleReversal);
  assert.equal(zone.knownAt,data[25].closeTime);assert.ok(zone.knownAt<=data[26].time);
  const complete=run(data),confirmed=complete.events.find(event=>event.eventId===armed.eventId);
  assert.equal(confirmed.status,'CONFIRMED');assert.equal(confirmed.confirmedAt,data[27].closeTime);
  const opposite=run(mirror(data)).events.find(event=>event.setupId==='ROLE_REVERSAL_RETEST'&&event.signalIndex===26&&event.direction==='LONG');
  assert.equal(opposite.status,'CONFIRMED');assert.equal(opposite.confirmedAt,data[27].closeTime);
  assert.ok(opposite.contextSnapshot.location.zones.some(zone=>zone.roleReversal&&zone.type==='SUPPORT'&&zone.knownAt<=data[26].time));
  const forming=structuredClone(data);forming[27].closed=false;
  assert.equal(run(forming).events.find(event=>event.eventId===armed.eventId).status,'ARMED');
  const noRole=run([...range(),bar(25,100.5,101.25,98.75,101)]).events.filter(event=>event.setupId==='ROLE_REVERSAL_RETEST');
  assert.ok(noRole.length>0);assert.ok(noRole.every(event=>event.status==='REJECTED'&&event.scenarioApplicability.applicable===false));
  const after=run([...data,bar(28,96.5,9000,1,8000)]).events.find(event=>event.eventId===armed.eventId);
  assert.deepEqual(after,confirmed);
  const broken=run([...data.slice(0,27),bar(27,97.5,101,97,100.5),bar(28,100.5,101,94,95)]).events.find(event=>event.eventId===armed.eventId);
  assert.equal(broken.status,'INVALIDATED');assert.ok(broken.reasonCodes.includes('FROZEN_ROLE_REVERSAL_BROKEN'));assert.equal(broken.confirmedAt,null);
});

test('enabling a scenario does not bypass any mandatory context filter or the one-contract200-dollar risk settings',()=>{
  const flags=['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
  const config={...Object.fromEntries(flags.map(key=>[key,true])),minConditions:2};
  const risk={riskBudget:200,maxContracts:1,pointValue:20,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2};
  const analysis=run(roleFixture(),{config,risk}),event=analysis.events.find(event=>event.setupId==='ROLE_REVERSAL_RETEST'&&event.signalIndex===26&&event.direction==='SHORT');
  assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));
  assert.ok(flags.every(key=>event.parameterSnapshot.config[key]===true));
  assert.deepEqual(event.parameterSnapshot.risk,risk);assert.equal(event.riskPlan,null);
  assert.equal(analysis.signals.length,0);assert.equal(analysis.orderEligible,false);
});
