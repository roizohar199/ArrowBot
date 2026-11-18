// Artificial causal component fixtures only. These do not establish natural
// all-seven market approval, order execution or profitability.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGuideSignals,createGuideAnalyzer} from '../guide-signal-engine.mjs';

const minute=60000,start=Date.UTC(2026,0,1);
const bar=(i,open,high,low,close)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true});
const range=()=>[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105].map((v,i)=>bar(i,v,v+1,v-1,v));
const fixture=()=>[...range(),bar(25,100,101,95,96),bar(26,99,100,96,99.5),bar(27,97,98,94,95)];
const mirror=bars=>bars.map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}));
const metadata={source:'ohlc',instrument:'SYNTHETIC_ROLE_CONTEXT_AUDIT',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard',synthetic:true,testOnly:true};
const options={metadata,config:{requireRisk:false,requireLocation:false,minConditions:1},contextConfig:{roleReversalEnabled:true,zoneToleranceTicks:4}};
const rows=[{direction:'SHORT',pattern:'HANGING_MAN_SHAPE',family:'HANGING_MAN_REVERSAL',required:'TREND_UP',name:'HANGING_MAN',inverse:false},{direction:'LONG',pattern:'INVERTED_HAMMER_SHAPE',family:'INVERTED_HAMMER_REVERSAL',required:'TREND_DOWN',name:'INVERTED_HAMMER',inverse:true}];

test('role-reversal aliases retain Hanging Man and Inverted Hammer prior-trend requirements',()=>{
  for(const item of rows){
    const bars=item.inverse?mirror(fixture()):fixture(),analysis=analyzeGuideSignals(bars,{...options,asOfTime:bars.at(-1).closeTime});
    const find=family=>analysis.events.find(e=>e.signalIndex===26&&e.setupId===family&&e.patternIds.includes(item.pattern));
    const named=find(item.family),alias=find('ROLE_REVERSAL_RETEST');assert.ok(named);assert.ok(alias);
    assert.equal(alias.contextSnapshot.context.state,'TRANSITION');
    // The source price geometry, the known retest and the later price break
    // really exist; missing named-pattern context is the decisive rejection.
    assert.equal(alias.contextSnapshot.checks.find(c=>c.id==='KNOWN_LOCATION').passed,true);
    assert.ok(alias.contextSnapshot.location.zones.some(z=>z.roleReversal));
    assert.ok(item.direction==='LONG'?bars.at(-1).close>alias.trigger:bars.at(-1).close<alias.trigger);
    for(const event of [named,alias]){
      assert.equal(event.status,'REJECTED');assert.equal(event.confirmedAt,null);
      assert.ok(event.reasonCodes.includes('CONTEXTUAL_PATTERN_REQUIRES_'+item.required));
      assert.equal(event.contextSnapshot.checks.find(c=>c.id==='STRUCTURE').state,'FAIL');
      assert.equal(event.scenarioApplicability.requiredPriorState,item.required);
      assert.equal(event.scenarioApplicability.contextualName,item.name);
      assert.equal(event.scenarioApplicability.applicable,false);
    }
    assert.ok(!analysis.signals.some(s=>s.setupEventIds.includes(alias.eventId)));
  }
});

test('strict mandatory flags remain intact while source-pattern context also rejects a role alias',()=>{
  const flags=['requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
  for(const item of rows){
    const bars=item.inverse?mirror(fixture()):fixture();
    const analysis=analyzeGuideSignals(bars,{...options,config:{...options.config,...Object.fromEntries(flags.map(k=>[k,true]))},contextConfig:{...options.contextConfig,supplyDemandEnabled:true},asOfTime:bars.at(-1).closeTime});
    const event=analysis.events.find(e=>e.setupId==='ROLE_REVERSAL_RETEST'&&e.signalIndex===26&&e.patternIds.includes(item.pattern));assert.ok(event);
    assert.ok(flags.every(k=>event.parameterSnapshot.config[k]===true));
    assert.equal(event.parameterSnapshot.contextConfig.roleReversalEnabled,true);
    assert.equal(event.parameterSnapshot.contextConfig.trendlineMinTouches,3);
    assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('CONTEXTUAL_PATTERN_REQUIRES_'+item.required));
    assert.equal(event.confirmedAt,null);assert.equal(event.riskPlan,null);
  }
});

test('cached later bars cannot revive a rejected contextual role alias',()=>{
  const bars=fixture(),analyzer=createGuideAnalyzer(),atFormation=analyzer.analyze(bars.slice(0,27),{...options,asOfTime:bars[26].closeTime});
  const prior=atFormation.events.find(e=>e.setupId==='ROLE_REVERSAL_RETEST'&&e.signalIndex===26&&e.patternIds.includes('HANGING_MAN_SHAPE'));assert.ok(prior);assert.equal(prior.status,'REJECTED');
  const after=analyzer.analyze([...bars,bar(28,95,96,92,93)],{...options,asOfTime:start+29*minute});
  assert.equal(after.cache.appendOnly,true);assert.deepEqual(after.events.find(e=>e.eventId===prior.eventId),prior);
});
