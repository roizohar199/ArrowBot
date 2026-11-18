import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {createGuideFormingView,describeGuideFormingPreview} from '../guide-forming-view.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';

const minute=60000,start=Date.UTC(2026,0,1),metadata={source:'ohlc',sourceId:'forming-view-source',instrument:'SYNTHETIC_PREVIEW',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard'};
const values=[100,104,108,104,101,105,110,105,102,106,112,106,103,107,114,107,104,108,116,108,105,109,118,109,106];
const risk={riskBudget:200,maxContracts:1,pointValue:20,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2};
const config={requireRisk:true,requireLocation:false,minConditions:1};
const bar=(index,open,high,low,close,closed=true)=>({time:start+index*minute,closeTime:start+(index+1)*minute,open,high,low,close,closed});
function fixture({pending=false,riskValue=risk}={}){
  const closedBars=values.map((value,index)=>bar(index,value,value+1,value-1,value));if(pending)closedBars.push(bar(25,105.5,107,100,106));
  const index=closedBars.length,openBar=pending?bar(index,106,109,105,108,false):bar(index,105.5,107,100,106,false),now=openBar.time+2000;
  const closedAnalysis=analyzeGuideSignals(closedBars,{metadata,config,risk:riskValue,asOfTime:now});
  const engine=createGuideFormingPreview(),preview=engine.analyze(openBar,{closedBars,closedAnalysis,metadata,config,risk:riskValue,asOfTime:now});
  return {engine,preview,closedBars,closedAnalysis,openBar,now,options:{eligible:true,sourceId:metadata.sourceId,sourceObservedAt:now,now}};
}
class Element{
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.dataset={};this.children=[];this.textContent='';this.hidden=false;this.open=false;this.replacements=0;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;this.replacements++;}
}
function dom(){const document={createElement(tag){return new Element(tag,this);}};return document.createElement('div');}
const allNodes=element=>[element,...element.children.flatMap(allNodes)];
const textTree=element=>allNodes(element).map(node=>node.textContent).join('\n');

test('intrabar checks include explicit all-cost risk plus structure and sixcontext checks, never an approval',()=>{
  const f=fixture(),model=describeGuideFormingPreview(f.preview,f.options);assert.equal(model.status,'PREVIEW');
  for(const direction of model.directions){assert.deepEqual(new Set(direction.checks.map(check=>check.id)),new Set(['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','RISK']));assert.ok(direction.checks.every(check=>check.provisional));}
  const long=f.preview.directions.LONG,check=long.checks.find(check=>check.id==='RISK');assert.equal(check.state,'PASS');assert.equal(check.evidence.perContractRisk,138.1);assert.equal(check.evidence.commission,3.1);assert.equal(check.evidence.slippageAllowance,10);assert.equal(check.evidence.quantity,1);assert.equal(long.levels.confirmationTrigger,107.25);assert.equal(long.levels.invalidation,99.75);
  assert.equal(model.candidateOnly,true);assert.equal(model.signalApproved,false);assert.equal(model.orderEligible,false);assert.ok(model.message.includes('נר פתוח'));
});

test('a risk over budget stays visible as failure without totalPlannedRisk zero concealing the per-contract cost',()=>{
  const f=fixture({riskValue:{...risk,riskBudget:100}}),check=f.preview.directions.LONG.checks.find(check=>check.id==='RISK');assert.equal(check.state,'FAIL');assert.equal(check.evidence.quantity,0);assert.equal(check.evidence.perContractRisk,138.1);
  const model=describeGuideFormingPreview(f.preview,f.options).directions[0].checks.find(check=>check.id==='RISK');assert.ok(model.evidenceText.includes('138.1'));assert.equal(f.preview.signalApproved,false);
  const noCosts=fixture({riskValue:null}),unavailable=noCosts.preview.directions.LONG.checks.find(check=>check.id==='RISK');assert.equal(unavailable.state,'UNAVAILABLE');assert.ok(unavailable.reasonCodes.includes('RISK_PARAMETERS_REQUIRED'));
});

test('pending closed setups show an intrabar trigger crossing with frozen levels and still require a provider-final later close',()=>{
  const f=fixture({pending:true}),armed=f.closedAnalysis.events.find(event=>event.status==='ARMED');assert.ok(armed,'real engine produces an armed closed Hammer');
  const pending=f.preview.pendingConfirmations.find(entry=>entry.eventId===armed.eventId);assert.ok(pending);assert.equal(pending.state,'FORMING_PRICE_BEYOND_TRIGGER');assert.equal(pending.levels.confirmationTrigger,armed.trigger);assert.equal(pending.levels.invalidation,armed.invalidation);assert.equal(pending.checks.find(check=>check.id==='CONFIRMATION_PRICE').state,'PASS');assert.ok(pending.reasonCodes.includes('LATER_CLOSED_CONFIRMATION_REQUIRED'));
  assert.equal(pending.signalApproved,false);assert.equal(pending.final,false);assert.equal(pending.orderEligible,false);assert.equal(f.closedAnalysis.signals.length,0);
  const model=describeGuideFormingPreview(f.preview,f.options);assert.ok(model.pendingConfirmations.length);assert.ok(model.pendingConfirmations.every(entry=>entry.signalApproved===false&&entry.orderEligible===false));
});

test('pending previews preserve frozen structure failures and missing frozen risk context rather than showing ready',()=>{
  const f=fixture({pending:true}),armed=f.closedAnalysis.events.find(event=>event.status==='ARMED'),pivot=armed.contextSnapshot.context.pivots.filter(pivot=>pivot.type==='LOW').at(-1),price=pivot.price-(armed.contextSnapshot.context.config.breakBufferTicks+1)*metadata.tickSize;
  const changed={...f.openBar,low:Math.min(f.openBar.low,price),close:price},preview=f.engine.analyze(changed,{closedBars:f.closedBars,closedAnalysis:f.closedAnalysis,metadata,config,risk,asOfTime:f.now});
  const pending=preview.pendingConfirmations.find(entry=>entry.eventId===armed.eventId);assert.equal(pending.state,'FORMING_FROZEN_CONTEXT_BROKEN');assert.equal(pending.checks.find(check=>check.id==='FROZEN_CONTEXT').state,'FAIL');assert.ok(pending.reasonCodes.includes('FROZEN_STRUCTURE_BROKEN'));assert.equal(pending.signalApproved,false);
  const incomplete=structuredClone(f.closedAnalysis);delete incomplete.events.find(event=>event.eventId===armed.eventId).contextSnapshot.context;
  const unavailable=f.engine.analyze(f.openBar,{closedBars:f.closedBars,closedAnalysis:incomplete,metadata,config,risk,asOfTime:f.now}).pendingConfirmations.find(entry=>entry.eventId===armed.eventId);assert.equal(unavailable.checks.find(check=>check.id==='RISK').state,'UNAVAILABLE');assert.equal(unavailable.checks.find(check=>check.id==='FROZEN_CONTEXT').state,'UNAVAILABLE');
});

test('Inside provisional levels and context include the known mother formation rather than just the current candle',()=>{
  const f=fixture(),closedBars=[...f.closedBars,bar(25,109,112,100,108),bar(26,108,111,102,107)],openBar=bar(27,108,114,106,113,false),now=openBar.time+2000,closedAnalysis=analyzeGuideSignals(closedBars,{metadata,config,risk,asOfTime:now});
  const preview=createGuideFormingPreview().analyze(openBar,{closedBars,closedAnalysis,metadata,config,risk,asOfTime:now}),inside=preview.scenarios.find(entry=>entry.patternId==='INSIDE_BREAKOUT'&&entry.direction==='LONG');assert.ok(inside);assert.equal(inside.formationStartIndex,25);assert.equal(inside.freezeTime,closedBars[25].time);assert.equal(inside.levels.invalidation,99.75);assert.equal(inside.levels.confirmationTrigger,112.25);assert.equal(inside.signalApproved,false);
});

test('requested supply-demand remains unavailable during a causal midbar bootstrap, while an intentionally disabled calculation stays disabled',()=>{
  const f=fixture(),closedBars=f.closedBars.map(bar=>({...bar,knownAt:f.now})),requested={...config,requireSupplyDemand:true},contextConfig={supplyDemandEnabled:true},closedAnalysis=analyzeGuideSignals(closedBars,{metadata,config:requested,contextConfig,risk,asOfTime:f.now}),preview=createGuideFormingPreview().analyze(f.openBar,{closedBars,closedAnalysis,metadata,config:requested,contextConfig,risk,asOfTime:f.now});
  assert.equal(preview.status,'PREVIEW');assert.equal(preview.frozenContext.barsUsed,0,'midbar receipt cannot be backdated before forming start');
  for(const direction of ['LONG','SHORT']){const check=preview.directions[direction].checks.find(check=>check.id==='SUPPLY_DEMAND');assert.equal(check.required,true);assert.equal(check.available,false);assert.equal(check.state,'UNAVAILABLE');}
  const disabledAnalysis=analyzeGuideSignals(closedBars,{metadata,config,contextConfig:{supplyDemandEnabled:false},risk,asOfTime:f.now}),disabled=createGuideFormingPreview().analyze(f.openBar,{closedBars,closedAnalysis:disabledAnalysis,metadata,config,contextConfig:{supplyDemandEnabled:false},risk,asOfTime:f.now});assert.equal(disabled.directions.LONG.checks.find(check=>check.id==='SUPPLY_DEMAND').state,'DISABLED');
});

test('stale, reset, missing receipt clock, source mismatch and forged approval remove all previous condition rows',()=>{
  const f=fixture(),container=dom(),view=createGuideFormingView(container);view.render(f.preview,f.options);assert.ok(allNodes(container).some(node=>node.dataset.condition==='RISK'));
  const stale=view.render(f.preview,{...f.options,now:f.now+15001});assert.equal(stale.status,'STALE');assert.equal(view.snapshot().directions.length,0);assert.ok(!allNodes(container).some(node=>node.dataset.condition));assert.ok(textTree(container).includes('הוסרו'));
  for(const override of [{eligible:false},{sourceObservedAt:undefined},{sourceObservedAt:f.now+1},{sourceId:'other-source'},{barTime:f.openBar.time+minute}]){view.render(f.preview,f.options);view.render(f.preview,{...f.options,...override});assert.equal(view.snapshot().status,'UNAVAILABLE');assert.ok(!allNodes(container).some(node=>node.dataset.condition));}
  view.render({...f.preview,signalApproved:true},f.options);assert.equal(view.snapshot().status,'UNAVAILABLE');view.clear('המקור אופס.');assert.ok(textTree(container).includes('המקור אופס.'));assert.equal(view.snapshot().signalApproved,false);
});

test('age updates and observed-price changes preserve condition nodes and open scenario explanations',()=>{
  const f=fixture({pending:true}),container=dom(),view=createGuideFormingView(container),first=view.render(f.preview,f.options),riskNode=allNodes(container).find(node=>node.dataset.condition==='RISK'),scenario=allNodes(container).find(node=>node.className==='forming-scenario'),evidence=allNodes(container).find(node=>node.className==='forming-check-evidence');assert.ok(scenario);scenario.open=true;assert.equal(evidence.tagName,'DETAILS');assert.ok(evidence.children[0].title);evidence.open=true;
  const age=view.render(f.preview,{...f.options,now:f.now+500});assert.equal(age.changed,false);assert.equal(age.contentWrites,first.contentWrites);assert.equal(allNodes(container).find(node=>node.dataset.condition==='RISK'),riskNode);assert.ok(textTree(container).includes('500 ms'));
  const changed=f.engine.analyze({...f.openBar,close:108.25},{closedBars:f.closedBars,closedAnalysis:f.closedAnalysis,metadata,config,risk,asOfTime:f.now+600});view.render(changed,{...f.options,sourceObservedAt:f.now+600,now:f.now+600});assert.equal(allNodes(container).find(node=>node.dataset.condition==='RISK'),riskNode);assert.ok(allNodes(container).includes(scenario));assert.equal(scenario.open,true);assert.ok(allNodes(container).includes(evidence));assert.equal(evidence.open,true);assert.ok(textTree(container).includes('108.25'));
});

test('LIVE pane contains provisional conditions inside focused result and all required filter controls default on',async()=>{
  const html=await readFile(new URL('../live-ohlc.html',import.meta.url),'utf8'),start=html.indexOf('id="live-result"'),view=html.indexOf('id="forming-conditions"'),next=html.indexOf('כללי איתות וסיכון');assert.ok(start<view&&view<next);
  const focusExport=html.indexOf('id="export-live-focus"');assert.ok(start<focusExport&&focusExport<view);assert.match(html,/id="export-live-focus" disabled>ייצוא מצב המעקב/);
  const liveOutput=html.indexOf('id="live-output"'),formingPreview=html.indexOf('id="forming-preview-status"'),volume=html.indexOf('id="live-volume"'),trace=html.indexOf('id="intrabar-trace"');assert.ok(liveOutput<formingPreview&&formingPreview<view&&view<volume&&volume<trace,'conditions precede volume and intrabar trace in the focused reading order');
  for(const id of ['require-risk','require-location','require-higher-timeframe','require-ema','require-fib','require-trendline','enable-supply-demand','require-supply-demand'])assert.match(html,new RegExp('id="'+id+'"[^>]*\\bchecked\\b'));
});
