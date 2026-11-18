import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLiveChart} from '../live-ohlc.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
import {createLiveTimeframes} from '../live-timeframes.mjs';
import {createGuideAnalyzer,analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';
import {renderGuideAnalysis} from '../guide-analysis-view.mjs';
import {selectFreshLiveSignal} from '../live-signal-eligibility.mjs';

const minute=60000,start=Date.UTC(2026,0,1);
const bar=(i,open,high,low,close)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true});
const metadata={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
const risk={riskBudget:200,pointValue:20,commissionPerContract:4,slippageTicks:2,maxContracts:1,rewardRisk:2};
function fixture(){const closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];return [...closes.map((value,index)=>bar(index,value,value+1,value-1,value)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];}
const evidence=at=>({observedAtWall:at,chart:{visibleCharts:1,symbols:[metadata.instrument],interval:'1',replay:false,realtime:true,marketOpen:true,realtimeBasis:'EXPLICIT_REALTIME_DOM'}});
const packet=(kind,bars,sequence,sourceEmittedAt,runId='run-a')=>({kind,bars,sequence,runId,sourceEmittedAt,realtime:true,receivedAt:sourceEmittedAt+100,metadata:structuredClone(metadata)});
const proofPacket=source=>({...source,metadata:verifyLiveChart(source,evidence(source.receivedAt),17).metadata});
const withoutCache=({cache,...rest})=>rest;
const pin=analysis=>analysis.events.find(event=>event.signalIndex===25&&event.direction==='LONG');

test('real chart observation proof timestamps do not defeat append caching, while semantic gate changes invalidate it',()=>{
  const data=fixture(),analyzer=createGuideAnalyzer(),first=proofPacket(packet('snapshot',data.slice(0,26),1,data[25].closeTime));
  const one=analyzer.analyze(first.bars,{metadata:first.metadata,risk,asOfTime:first.sourceEmittedAt});assert.equal(one.cache.hit,false);
  const next=proofPacket(packet('update',data,2,data[26].closeTime));
  const settings={metadata:next.metadata,risk,asOfTime:next.sourceEmittedAt},two=analyzer.analyze(data,settings);
  assert.equal(two.cache.appendOnly,true);assert.ok(two.cache.reusedContexts>0);assert.deepEqual(withoutCache(two),analyzeGuideSignals(data,settings));
  const reread={...next.metadata,realtimeVerification:{...next.metadata.realtimeVerification,observedAtWall:next.receivedAt+500}};
  const hit=analyzer.analyze(data,{...settings,metadata:reread});assert.equal(hit.cache.hit,true);assert.equal(hit.metadata.realtimeVerification.observedAtWall,next.receivedAt+500);
  assert.equal(one.metadata.realtimeVerification.observedAtWall,first.receivedAt,'new proof does not rewrite prior evidence');
  for(const change of [{realtime:false},{replay:true},{sourceId:'different-source'},{currency:'EUR'},{realtimeVerification:{...reread.realtimeVerification,basis:'DIFFERENT_EVIDENCE'}}]){
    const changed=analyzer.analyze(data,{...settings,metadata:{...reread,...change}});assert.equal(changed.cache.hit,false);assert.equal(changed.cache.appendOnly,false);
  }
});

test('new HTF bootstrap cannot retroactively approve an older formation, while later frozen checks may use it',()=>{
  const data=fixture(),bootstrapAt=data[24].closeTime,manager=createLiveTimeframes(),analyzer=createGuideAnalyzer();
  let wall=bootstrapAt+100;const store=createLiveOhlcStore({now:()=>wall,staleAfterMs:120000});
  const initial=proofPacket(packet('snapshot',data.slice(0,25),1,bootstrapAt));
  manager.ingest(initial,{observedAsOfTime:bootstrapAt});const seeded=store.ingest(initial,{sourceAsOfTime:bootstrapAt});assert.equal(seeded.bootstrap,true);assert.equal(seeded.eligibleCloseTimes.length,0);
  const values=[100,102,104,102,101,103,105,103,102,104,106,104,103,105,107,105,104,106,108,106,105,107,109,107,106];
  for(const [index,tf] of ['5','15'].entries()){
    const duration=Number(tf)*minute,rows=values.map((value,i)=>({time:start-(25-i)*duration,closeTime:start-(24-i)*duration,open:value,high:value+1,low:value-1,close:value,closed:true,sourceClosed:true,volume:100+i}));
    const source={...proofPacket(packet('timeframe_snapshot',[],index+2,bootstrapAt+1000)),higherTimeframes:[{timeframe:tf,timeframeMs:duration,bars:rows}]};
    manager.ingest(source,{observedAsOfTime:bootstrapAt+1000});
  }
  let state;
  for(let i=25;i<=26;i++){
    const source=proofPacket(packet('update',[data[i]],i+1,data[i].closeTime));wall=source.receivedAt;
    manager.ingest(source,{observedAsOfTime:source.sourceEmittedAt});state=store.ingest(source,{sourceAsOfTime:source.sourceEmittedAt});assert.equal(state.ready,true);
  }
  const higher=manager.snapshot({asOfTime:state.decisionAsOfTime}).higherTimeframes;
  const settings={metadata:state.metadata,risk,config:{requireHigherTimeframe:true},higherTimeframes:higher,asOfTime:state.decisionAsOfTime};
  const analysis=analyzer.analyze(state.bars,settings),event=pin(analysis);
  assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));
  assert.ok(Object.values(event.contextSnapshot.higherTimeframe.availability).every(entry=>entry.availableClosedBars===0));
  const current=analysis.currentChecks.directions.LONG.checks.find(check=>check.id==='HIGHER_TIMEFRAME');assert.equal(current.state,'PASS');assert.equal(current.evidence.alignment,'ALIGNED_UP');
  assert.ok(Object.values(current.evidence.availability).every(entry=>entry.lastAvailableKnownAt===bootstrapAt+1000));
  const changed=structuredClone(higher);changed['5'].bars=[];
  const invalidated=analyzer.analyze(state.bars,{...settings,higherTimeframes:changed});assert.equal(invalidated.cache.appendOnly,false);assert.equal(invalidated.currentChecks.directions.LONG.checks.find(check=>check.id==='HIGHER_TIMEFRAME').state,'UNAVAILABLE');
  const sourceB=proofPacket(packet('snapshot',data.slice(0,25),100,state.decisionAsOfTime,'run-b'));manager.ingest(sourceB,{observedAsOfTime:sourceB.sourceEmittedAt});
  assert.equal(manager.snapshot().sourceId,'run-b');assert.ok(Object.values(manager.snapshot().higherTimeframes).every(entry=>entry.bars.length===0));
});

class TextNode{
  constructor(tag,ownerDocument){this.tagName=tag.toUpperCase();this.ownerDocument=ownerDocument;this.children=[];this.dataset={};this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  set innerHTML(_value){throw Error('HTML injection is not allowed in explanation rendering');}
}
const flatten=node=>[node,...node.children.flatMap(flatten)];
test('the actual explanation renderer produces all 20 label cards, both direction filters and every scenario family',()=>{
  const doc={createElement(tag){return new TextNode(tag,this);}},container=new TextNode('section',doc),data=fixture();
  const analysis=analyzeGuideSignals(data,{metadata,risk,asOfTime:data.at(-1).closeTime}),view=describeGuideAnalysis(analysis);
  renderGuideAnalysis(container,view);const nodes=flatten(container),patternCards=nodes.filter(node=>node.tagName==='ARTICLE'&&node.children.some(child=>child.tagName==='H3'&&view.patternChecks.some(pattern=>child.textContent.startsWith(pattern.label+' · '))));
  assert.equal(patternCards.length,20);assert.equal(nodes.filter(node=>node.tagName==='A'&&node.href?.includes('guide-library.html#topic=')).length,20);
  assert.equal(nodes.filter(node=>node.tagName==='H3'&&node.textContent.startsWith('תנאי כיוון')).length,2);
  for(const family of view.scenarioFamilies)assert.ok(nodes.some(node=>node.tagName==='SUMMARY'&&node.textContent===family.label));
  renderGuideAnalysis(container,describeGuideAnalysis());assert.equal(flatten(container).filter(node=>node.tagName==='ARTICLE').length,22,'20 label cards and two directional filter cards remain visible without data');
  renderGuideAnalysis(container,null);assert.equal(container.children.length,1);
});

function mergedFixture(){
  const data=fixture(),analysis=analyzeGuideSignals(data,{metadata,risk,asOfTime:data.at(-1).closeTime}),source=pin(analysis);
  const old={...structuredClone(source),eventId:'setup-old',formationStartTime:data[24].time,signalStartIndex:24,patternIds:['OLD_PATTERN'],riskPlan:{...source.riskPlan,target:999,initialStop:90},contextSnapshot:{...source.contextSnapshot,tag:'old-context'}};
  const fresh={...structuredClone(source),eventId:'setup-fresh',formationStartTime:data[25].time,patternIds:['BULLISH_PIN_SHAPE'],contextSnapshot:{...source.contextSnapshot,tag:'fresh-context'}};
  const signal={...structuredClone(old),eventId:'merged-alert',setupEventIds:[old.eventId,fresh.eventId],setupFormations:[old,fresh].map(event=>({eventId:event.eventId,formationStartTime:event.formationStartTime,confirmedAt:event.confirmedAt})),patternIds:['OLD_PATTERN','BULLISH_PIN_SHAPE']};
  return {analysis:{...analysis,events:[old,fresh],signals:[signal]},signal,old,fresh,bars:data,bootstrapAsOfTime:data[25].time,eligibleCloseTimes:[data[26].closeTime]};
}
test('live merged eligibility rebuilds the alert from fresh constituents and never borrows old stop, target, pattern or context',()=>{
  const fixture=mergedFixture(),before=structuredClone(fixture),selected=selectFreshLiveSignal(fixture.signal,fixture.analysis,fixture);
  assert.ok(selected);assert.equal(selected.eventId,'merged-alert');assert.deepEqual(selected.setupEventIds,['setup-fresh']);assert.deepEqual(selected.patternIds,['BULLISH_PIN_SHAPE']);
  assert.equal(selected.riskPlan.initialStop,fixture.fresh.riskPlan.initialStop);assert.equal(selected.riskPlan.target,fixture.fresh.riskPlan.target);assert.equal(selected.contextSnapshot.tag,'fresh-context');
  assert.deepEqual(selected.setupRiskPlans,[{eventId:'setup-fresh',riskPlan:fixture.fresh.riskPlan}]);assert.equal(selected.liveEligibility.excludedConstituentCount,1);assert.equal(selected.orderEligible,false);
  selected.riskPlan.initialStop=1;assert.deepEqual(fixture,before);
});
test('stale, ineligible, rejected-risk, future and mismatched-source-close constituents cannot create a fresh live alert',()=>{
  for(const edit of [fixture=>fixture.bootstrapAsOfTime+=minute,fixture=>fixture.eligibleCloseTimes=[],fixture=>fixture.analysis.events[1].status='REJECTED',fixture=>fixture.analysis.events[1].riskPlan.status='BLOCKED',fixture=>fixture.analysis.events[1].confirmationBarCloseTime+=minute,fixture=>fixture.analysis.events[1].confirmedAt+=1,fixture=>fixture.analysis.asOfTime-=1]){
    const fixture=mergedFixture();edit(fixture);assert.equal(selectFreshLiveSignal(fixture.signal,fixture.analysis,fixture),null);
  }
  const fixture=mergedFixture();fixture.analysis.events[1].instrument='OTHER';assert.equal(selectFreshLiveSignal(fixture.signal,fixture.analysis,fixture),null);
});
test('multiple fresh constituents retain all current risk plans while selecting an eligible representative',()=>{
  const fixture=mergedFixture();fixture.analysis.events[0].formationStartTime=fixture.bootstrapAsOfTime;
  const selected=selectFreshLiveSignal(fixture.signal,fixture.analysis,fixture);assert.equal(selected.setupEventIds.length,2);assert.equal(selected.setupRiskPlans.length,2);assert.equal(selected.liveEligibility.excludedConstituentCount,0);
});
