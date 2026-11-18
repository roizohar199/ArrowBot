import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isUserManagedLiveMode,userManagedLiveAnalysisOptions,GUIDE_USER_CONTEXT_BALANCED} from '../live-user-mode.mjs';
import {verifyLiveChart} from '../live-ohlc.mjs';
import {analyzeGuideSignals,GUIDE_SIGNAL_DEFAULTS} from '../guide-signal-engine.mjs';
import {GUIDE_STRATEGY_POLICY,GUIDE_STRATEGY_PROFILES} from '../guide-strategy-policy.mjs';
import {selectGuideTechnicalDecision} from '../guide-technical-decision.mjs';
import {selectFreshLiveSignal} from '../live-signal-eligibility.mjs';
import {createLiveUserAccountControls} from '../live-user-account-controls.mjs';
import {createBrokerAccountRegistry,BROKER_ACCOUNT_REGISTRY_STORAGE_KEY as STORE} from '../broker-account-registry.mjs';

const candidate=JSON.parse(await readFile(new URL('../verification/0.22.0/natural-profile-1793355420000-SHORT.json',import.meta.url),'utf8'));
// Archived native OHLC tests exercise the current engine/helper configuration.
// They do not authenticate a LIVE feed, trading permission or native order.
const options={...candidate.analysisInputs.options,...userManagedLiveAnalysisOptions()};
const nativeAnalysis=analyzeGuideSignals(candidate.analysisInputs.bars,options);
const nativeDecision=selectGuideTechnicalDecision({analysis:nativeAnalysis,bars:candidate.analysisInputs.bars});
const URL1='https://www.tradingview.com/chart/ARROWRV1/';
const metadata={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,currency:'USD',tickSize:.25,pointValue:20,chartType:'standard'};
function chartFixture(count=3){
  return {visibleCharts:count,symbols:['CME_MINI:NQ1!'],interval:'1',replay:false,realtime:true,marketOpen:true,realtimeBasis:'EXPLICIT_REALTIME_DOM',
    chartLabels:count===2?['Chart for CME_MINI:NQ1!, 5 minutes','Chart for CME_MINI:NQ1!, 1 minute']:['Chart for CME_MINI:NQ1!, 5 minutes','Chart for CME_MINI:NQ1!, 1 minute','Chart for CME_MINI:NQ1!, 1 second'],
    researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:count,targetCharts:1,interval:'1',selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',researchLayoutVerified:true,liveMultiChartExplicit:true,statusLegendScoped:true,sourceMode:'LIVE'}};
}
const packet=()=>({metadata:structuredClone(metadata),runId:'native-source-run',realtime:true,sourceEmittedAt:1794636154411,bars:[{time:1794636120000,closeTime:1794636180000,closed:false}]});
const evidence=()=>({chart:chartFixture(),sourceUrl:URL1,observedAtWall:1794636154500});
const proof=(source=packet(),dom=evidence(),settings={allowResearchLiveMultiChart:true})=>verifyLiveChart(source,dom,17,settings);

test('the explicit query enables user-managed LIVE only once and leaves plain or conflicting routes in legacy mode',()=>{
  for(const query of ['?execution=user-managed','?x=1&execution=user-managed','?execution=user-managed&riskBudget=200'])assert.equal(isUserManagedLiveMode(query),true);
  for(const query of ['',undefined,null,{},'?execution=legacy','?execution=USER-MANAGED','?execution=user-managed%20','?execution=user-managed&execution=legacy','?execution=user-managed&execution=user-managed','?execution=user-managed#other'])assert.equal(isUserManagedLiveMode(query),false);
});

test('user-managed analysis options activate all strategy descriptors without any budget, costs or bot sizing gate',()=>{
  const first=userManagedLiveAnalysisOptions(),second=userManagedLiveAnalysisOptions();assert.equal(first.risk,null);assert.equal(first.config.requireRisk,false);assert.equal(first.config.strategyPolicy,GUIDE_STRATEGY_POLICY);
  for(const name of ['requireLocation','requireEma','requireFib','requireHigherTimeframe','requireTrendline','requireSupplyDemand'])assert.equal(first.config[name],true);
  assert.equal(first.contextConfig.roleReversalEnabled,true);assert.equal(first.contextConfig.supplyDemandEnabled,true);
  for(const field of ['riskBudget','commissionPerContract','slippageTicks','pointValue','maxContracts','stopLoss','takeProfit'])assert.equal(Object.hasOwn(first,field),false);
  first.config.requireRisk=true;first.contextConfig.supplyDemandEnabled=false;assert.equal(second.config.requireRisk,false);assert.equal(second.contextConfig.supplyDemandEnabled,true);assert.equal(GUIDE_SIGNAL_DEFAULTS.requireRisk,true);
});

test('actual archived ROLE analysis reaches current SHORT under the LIVE helper using its own two mandatory checks and null risk',()=>{
  assert.equal(nativeAnalysis.parameterSnapshot.risk,null);assert.equal(nativeAnalysis.parameterSnapshot.config.requireRisk,false);assert.equal(nativeAnalysis.strategyProfiles.length,18);assert.deepEqual(nativeAnalysis.strategyProfiles.map(p=>p.id),GUIDE_STRATEGY_PROFILES.map(p=>p.id));
  assert.equal(nativeDecision.status,'CONFIRMED');assert.equal(nativeDecision.direction,'SHORT');assert.equal(nativeDecision.signal.approvalPolicy,GUIDE_STRATEGY_POLICY);
  assert.deepEqual(nativeDecision.signal.strategyProofs.map(p=>p.profileId),['ROLE_REVERSAL_RETEST']);assert.deepEqual(nativeDecision.signal.requiredChecks.map(c=>c.id),['STRUCTURE','KNOWN_LOCATION']);
  assert.ok(nativeDecision.signal.requiredChecks.every(c=>c.required&&c.available&&c.passed&&c.enabled&&c.state==='PASS'));
  for(const id of nativeDecision.signal.sourceEventIds){const event=nativeAnalysis.events.find(e=>e.eventId===id);assert.equal(event.status,'CONFIRMED');assert.equal(event.riskPlan,null);assert.equal(event.parameterSnapshot.config.requireRisk,false);assert.ok(event.contextSnapshot.checks.some(c=>c.required===false&&c.state!=='PASS'));}
  for(const key of ['quantity','riskPlan','riskBudget','stopLoss','takeProfit'])assert.equal(Object.hasOwn(nativeDecision.signal,key),false);
  assert.equal(nativeDecision.orderEligible,false);assert.equal(nativeDecision.signal.execution,'OBSERVATION_ONLY');assert.equal(nativeDecision.profitabilityVerified,false);
});

test('the existing fresh-close gate accepts risk-null strategy signals only after bootstrap formation and a genuine eligible close',()=>{
  const candidateSignal=nativeAnalysis.signals.find(s=>s.confirmationBarCloseTime===nativeAnalysis.asOfTime&&s.direction==='SHORT');assert.ok(candidateSignal);
  const setup=nativeAnalysis.events.find(e=>nativeDecision.signal.sourceEventIds.includes(e.eventId)),context={bars:candidate.analysisInputs.bars,eligibleCloseTimes:[nativeAnalysis.asOfTime],bootstrapAsOfTime:setup.formationStartTime-1};
  const selected=selectFreshLiveSignal(candidateSignal,nativeAnalysis,context);assert.ok(selected);assert.equal(selected.riskPlan,null);assert.equal(selected.orderEligible,false);
  assert.equal(selectFreshLiveSignal(candidateSignal,nativeAnalysis,{...context,eligibleCloseTimes:[]}),null);
  assert.equal(selectFreshLiveSignal(candidateSignal,nativeAnalysis,{...context,bootstrapAsOfTime:nativeAnalysis.asOfTime}),null,'a historical bootstrap confirmation cannot become a fresh LIVE alert');
});

test('removing an actual strategy required proof or using an open/future bar still blocks technical direction without a risk gate',()=>{
  for(const mutate of [a=>{a.events.find(e=>nativeDecision.signal.sourceEventIds.includes(e.eventId)).strategyProof.requiredCheckIds=['STRUCTURE'];},a=>{a.events.find(e=>nativeDecision.signal.sourceEventIds.includes(e.eventId)).contextSnapshot.checks.find(c=>c.id==='KNOWN_LOCATION').available=false;}]){
    const analysis=structuredClone(nativeAnalysis);mutate(analysis);assert.equal(selectGuideTechnicalDecision({analysis}).status,'BLOCKED');
  }
  for(const mutate of [bars=>{bars.at(-1).closed=false;},bars=>{bars.at(-1).knownAt=nativeAnalysis.asOfTime+1;}]){const bars=structuredClone(candidate.analysisInputs.bars);mutate(bars);assert.equal(selectGuideTechnicalDecision({analysis:nativeAnalysis,bars}).status,'BLOCKED');}
});

test('opposite strategy evidence vetoes the current decision even under risk-null user-managed configuration',()=>{
  // Deliberate adversarial event-ledger composition, not a naturally occurring
  // opposing market signal or an order-eligible source fixture.
  const analysis=structuredClone(nativeAnalysis),source=analysis.events.find(e=>nativeDecision.signal.sourceEventIds.includes(e.eventId)),opposite=structuredClone(source);
  opposite.eventId+=':OPPOSITE_CONTRACT';opposite.direction='LONG';opposite.trigger=source.confirmationClose-.25;opposite.invalidation=source.confirmationClose-1;opposite.strategyProof.sourceEventIds=[opposite.eventId];analysis.events.push(opposite);
  const decision=selectGuideTechnicalDecision({analysis});assert.equal(decision.status,'AMBIGUOUS');assert.equal(decision.direction,null);assert.equal(decision.signal,null);assert.equal(decision.orderEligible,false);
});

test('LIVE two/three-chart research requires explicit permission and truthfully retains the selected unique NQ one-minute context',()=>{
  for(const count of [2,3]){const dom=evidence();dom.chart=chartFixture(count);assert.equal(proof(packet(),dom,{}).identityValid,false);
    const result=proof(packet(),dom);assert.equal(result.identityValid,true);assert.equal(result.liveVerified,true);assert.equal(result.metadata.instrument,'CME_MINI:NQ1!');assert.equal(result.metadata.tabId,17);assert.equal(result.metadata.sourceUrl,URL1);assert.equal(result.metadata.replay,false);assert.equal(result.metadata.realtimeVerification.exchangeEntitlementVerified,false);assert.equal(dom.chart.visibleCharts,count);
  }
});

test('LIVE multichart proof cannot trust contradictory canvas labels, counts or active timeframes',()=>{
  for(const mutate of [c=>{c.chartLabels[2]='Chart for CME_MINI:NQ1!, 1 minute';},c=>{c.chartLabels[2]='Chart for BINANCE:BTCUSDT, 1 minute';},c=>{c.chartLabels.pop();},c=>{delete c.chartLabels;},c=>{c.visibleCharts=4;c.researchSelection.visibleCharts=4;},c=>{c.interval='5';},c=>{c.researchSelection.interval='5';},c=>{c.researchSelection.targetCharts=2;},c=>{c.researchSelection.sourceMode='REPLAY';},c=>{c.researchSelection.liveMultiChartExplicit=false;},c=>{c.researchSelection.statusLegendScoped=false;},c=>{c.researchSelection.researchLayoutVerified=false;},c=>{c.researchSelection.selectedChartLabel='Chart for CME_MINI:NQ1!, 5 minutes';}]){
    const dom=evidence();mutate(dom.chart);const result=proof(packet(),dom);assert.equal(result.identityValid,false,mutate.toString());assert.equal(result.liveVerified,false);
  }
  const source=packet(),dom=evidence();source.metadata.timeframe='5';source.metadata.timeframeMs=300000;dom.chart.interval='5';assert.equal(proof(source,dom).identityValid,false);
});

test('Replay, explicit delayed status or a closed market cannot be promoted into LIVE by three-chart research permission',()=>{
  for(const mutate of [c=>{c.replay=true;},c=>{c.realtime=false;},c=>{c.marketOpen=false;}]){const dom=evidence();mutate(dom.chart);assert.equal(proof(packet(),dom).liveVerified,false);}
  const result=proof();assert.equal(result.metadata.realtimeVerification.exchangeEntitlementVerified,false);
});

test('new explicit LIVE multichart evidence must carry a valid current TradingView URL rather than omitting the account-source binding',()=>{
  for(const sourceUrl of [undefined,'https://evil.example/chart/Other/','https://www.tradingview.com/chart/Other/?extra=1','http://www.tradingview.com/chart/Other/',URL1+'?extra=1',URL1+'#other','https://someone@www.tradingview.com/chart/ARROWRV1/','https://www.tradingview.com:444/chart/ARROWRV1/']){
    const dom=evidence();if(sourceUrl===undefined)delete dom.sourceUrl;else dom.sourceUrl=sourceUrl;assert.equal(proof(packet(),dom).liveVerified,false,String(sourceUrl));
  }
});

test('actual chart-proof metadata preserves the reviewed native account source URL and a different valid chart revokes its review',async()=>{
  class Element{constructor(){this.children=[];this.dataset={};this.listeners=new Map();this.textContent='';}replaceChildren(...nodes){this.children=nodes;}addEventListener(k,v){this.listeners.set(k,v);}removeEventListener(k){this.listeners.delete(k);}}
  const nodes=new Map(['account-profile','account-summary','account-review-badge','account-storage-note'].map(id=>[id,new Element()])),document={getElementById:id=>nodes.get(id),createElement:()=>new Element()},at=2000000;
  const accounts=createBrokerAccountRegistry({now:()=>at,makeLeaseId:()=> 'live-user-mode-component'}),definition={id:'selected-PA',provider:'TRADOVATE',adapterId:'tradingview-account-ui',environment:'PA',nativeAccountId:'001-PA',label:'My PA',currency:'USD',enabled:true,userManagedRisk:true};accounts.upsert(definition);accounts.select(definition.id);
  const storage={async get(){return {[STORE]:accounts.snapshot().registry};}},controls=createLiveUserAccountControls({document,storage,now:()=>at,readNativeAccount:async()=>({kind:'TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1',status:'OBSERVED',provider:'TRADOVATE',nativeAccountId:'001-PA',environment:null,environmentVerified:false,nativeIdentityVerified:true,observedAt:at,readOnly:true,ordersCreated:false,submitted:false,synthetic:false,testOnly:false,source:{tabId:17,url:URL1}})});
  try{await controls.initialize();assert.ok(await controls.requestReview(17));const matched=proof();assert.equal(controls.evaluateMetadata(matched.metadata,17).ok,true);assert.equal(controls.snapshot().risk,null);assert.equal(controls.snapshot().ordersAuthorized,false);
    const other=evidence();other.sourceUrl='https://www.tradingview.com/chart/DifferentButValid/';const changed=proof(packet(),other);assert.equal(changed.metadata.sourceUrl,other.sourceUrl);assert.equal(controls.evaluateMetadata(changed.metadata,17).ok,false);assert.equal(controls.snapshot().reviewAccepted,false);
  }finally{controls.dispose();}
});
test('controlled leniency has fixed context bounds while preserving all source candle definitions and essential evidence',()=>{const options=userManagedLiveAnalysisOptions();assert.equal(Object.isFrozen(GUIDE_USER_CONTEXT_BALANCED),true);assert.equal(options.contextConfig.zoneToleranceTicks,4);assert.equal(options.contextConfig.emaProximityMode,'ticks');assert.equal(options.contextConfig.emaProximityTicks,6);assert.equal(options.contextConfig.rangeEdgeFraction,.25);assert.equal(options.config.confirmationBufferTicks,1);assert.equal(options.config.expiryBars,3);assert.equal(options.config.insideExpiryBars,5);assert.equal(options.config.entryMode,'close_confirmation');assert.equal(options.patternConfig,undefined);assert.equal(options.risk,null);});
test('controlled EMA leniency admits a nearby confirmed engulfing but rejects a distant one symmetrically, and never skips later-close confirmation',()=>{const start=Date.UTC(2026,0,1),bar=(i,o,h,l,c)=>({time:start+i*60000,closeTime:start+(i+1)*60000,open:o,high:h,low:l,close:c,closed:true}),prior=[100,105,110,105,101,106,110.5,106,102,107,111,107,103,108,111.5,108,104,109,112,109,105,110,112.5,110,106].map((v,i)=>bar(i,v,v+1,v-1,v)),metadata={source:'ohlc',instrument:'NODE_ONLY_BALANCED',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard',synthetic:true,testOnly:true};
 const make=offset=>[...prior,bar(25,108+offset,108.25+offset,107.25+offset,107.5+offset),bar(26,107.25+offset,108.5+offset,107+offset,108.25+offset),bar(27,108.25+offset,109.5+offset,108+offset,109+offset)];
 for(const inverse of [false,true])for(const offset of [1.5,3]){const bars=make(offset).map(b=>inverse?{...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}:b),options={...userManagedLiveAnalysisOptions(),metadata,asOfTime:bars.at(-1).closeTime},analysis=analyzeGuideSignals(bars,options),event=analysis.events.find(e=>e.strategyId==='ENGULFING_EMA'&&e.signalIndex===26);assert.ok(event);assert.equal(event.direction,inverse?'SHORT':'LONG');assert.equal(event.status,offset===1.5?'CONFIRMED':'REJECTED');assert.equal(event.contextSnapshot.checks.find(c=>c.id==='EMA').evidence.tolerance,1.5);if(offset===3)assert.ok(event.reasonCodes.includes('MISSING_EMA'));else{const tighter=analyzeGuideSignals(bars,{...options,contextConfig:{...options.contextConfig,emaProximityTicks:2}}).events.find(e=>e.strategyId==='ENGULFING_EMA'&&e.signalIndex===26);assert.equal(tighter.status,'REJECTED');const before=analyzeGuideSignals(bars.slice(0,-1),{...options,asOfTime:bars.at(-2).closeTime});assert.equal(before.events.some(e=>e.strategyId==='ENGULFING_EMA'&&e.signalIndex===26&&e.status==='CONFIRMED'),false);}}
});
