import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {GUIDE_STRATEGY_POLICY,getGuideStrategyProfile} from '../guide-strategy-policy.mjs';
import {describeClosestGuideStrategy,createClosestGuideStrategyView,CLOSEST_STRATEGIES_COLLAPSED_KEY} from '../guide-closest-strategy-view.mjs';

// Artificial complete-engine fixture, not a claim of native market execution.
const fixture=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
const closedBars=fixture.bars.slice(0,-1),last=fixture.bars.at(-1),openBar={...last,closed:false},now=openBar.time+2000;
const options={...fixture.options,metadata:{...fixture.options.metadata,sourceId:'closest-fixture'},config:{...fixture.options.config,strategyPolicy:GUIDE_STRATEGY_POLICY,requireRisk:false},risk:null,asOfTime:openBar.time};
const analysis=analyzeGuideSignals(closedBars,options);
const preview=createGuideFormingPreview().analyze(openBar,{...options,closedBars,closedAnalysis:analysis});
const viewOptions={analysis,eligible:true,sourceId:analysis.metadata.sourceId,barTime:openBar.time,sourceObservedAt:now,now};

test('closest strategy uses a real armed per-strategy event and only its required context checks',()=>{
  const before=JSON.stringify({analysis,preview}),model=describeClosestGuideStrategy(preview,viewOptions),c=model.candidate;
  assert.equal(model.status,'TRACKING');assert.ok(c);const event=analysis.events.find(e=>e.eventId===c.eventId),profile=getGuideStrategyProfile(c.profileId);
  assert.equal(event.status,'ARMED');assert.equal(c.phase,'PENDING_CONFIRMATION');assert.equal(c.requiredCount,profile.requiredCheckIds.length);assert.ok(c.requiredCount<7);assert.equal(c.passedCount,c.requiredCount);
  assert.ok(!c.missingCheckIds.includes('RISK'));assert.equal(model.orderEligible,false);assert.equal(model.signalApproved,false);assert.equal(model.probabilityComputed,false);assert.equal(JSON.stringify({analysis,preview}),before);
});

test('live price crossing updates proximity while a close is still required',()=>{
  const model=describeClosestGuideStrategy(preview,viewOptions),event=analysis.events.find(e=>e.eventId===model.candidate.eventId),price=event.direction==='LONG'?event.trigger+1:event.trigger-1;
  const bar={...openBar,close:price,high:Math.max(openBar.high,price),low:Math.min(openBar.low,price)};
  const updated=createGuideFormingPreview().analyze(bar,{...options,closedBars,closedAnalysis:analysis});
  const next=describeClosestGuideStrategy(updated,viewOptions);assert.equal(next.candidate.priceMet,true);assert.equal(next.candidate.distancePoints,0);assert.equal(next.signalApproved,false);
});

test('a real open-bar shape is ranked before its first close using the matching profile requirements',()=>{
  const bars=fixture.bars.slice(0,-2),bar={...fixture.bars.at(-2),closed:false},opts={...options,asOfTime:bar.time},a=analyzeGuideSignals(bars,opts),p=createGuideFormingPreview().analyze(bar,{...opts,closedBars:bars,closedAnalysis:a});
  const m=describeClosestGuideStrategy({...p,pendingConfirmations:[]},{...viewOptions,analysis:{...a,events:[]},barTime:bar.time,sourceObservedAt:bar.time+2000,now:bar.time+2000});
  assert.equal(m.status,'TRACKING');assert.equal(m.candidate.phase,'FORMING_PATTERN');assert.ok(getGuideStrategyProfile(m.candidate.profileId).patterns.some(id=>p.matchedPatternIds.includes(id)));assert.equal(m.signalApproved,false);assert.equal(m.candidate.trigger,null);
});

test('stale data, another source, a new bar, disabled monitoring and an old context clear the candidate',()=>{
  for(const changed of [{now:now+15001},{sourceId:'different'},{barTime:openBar.time+60000},{eligible:false},{analysis:{...analysis,asOfTime:openBar.time-60000}}]){
    const m=describeClosestGuideStrategy(preview,{...viewOptions,...changed});assert.equal(m.candidate,null);assert.ok(['STALE','UNAVAILABLE'].includes(m.status));
  }
});

test('invalidated intrabar setups and expired or consumed events never compete',()=>{
  const changed=structuredClone(preview);for(const entry of changed.pendingConfirmations)entry.state='FORMING_PRICE_BEYOND_INVALIDATION';
  const armedOnly={...analysis,events:analysis.events.filter(e=>e.status==='ARMED')};assert.equal(describeClosestGuideStrategy(changed,{...viewOptions,analysis:armedOnly}).status,'WAITING_PATTERN');
  const old={...analysis,events:analysis.events.map(e=>({...e,status:'EXPIRED'}))};assert.equal(describeClosestGuideStrategy(preview,{...viewOptions,analysis:old}).candidate,null);
});

test('a rejected latest pattern reports its own missing conditions, excluding optional checks and risk',()=>{
  const original=analysis.events.find(e=>e.status==='ARMED'),profile=getGuideStrategyProfile(original.strategyId),id=profile.requiredCheckIds[0];
  const event={...original,status:'REJECTED',barCloseTime:openBar.time,contextSnapshot:{...original.contextSnapshot,checks:original.contextSnapshot.checks.map(c=>c.id===id?{...c,passed:false,state:'FAIL'}:c)}};
  const p={...preview,pendingConfirmations:[]},a={...analysis,events:[event]},model=describeClosestGuideStrategy(p,{...viewOptions,analysis:a});
  assert.equal(model.candidate.phase,'MISSING_CONTEXT');assert.deepEqual(model.candidate.missingCheckIds,[id]);assert.equal(model.candidate.requiredCount,profile.requiredCheckIds.length);
  const between={...a,asOfTime:a.asOfTime+2223};assert.deepEqual(describeClosestGuideStrategy(p,{...viewOptions,analysis:between}).candidate.missingCheckIds,[id],'source observation inside the minute still retains the latest closed pattern');
});

class Element{constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.dataset={};this.children=[];this.textContent='';this.hidden=false;this.replacements=0;this.listeners={};this.open=false;}addEventListener(name,fn){this.listeners[name]=fn;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this.replacements++;}set innerHTML(_){throw Error('HTML parsing forbidden');}}
const allNodes=root=>[root,...root.children.flatMap(allNodes)];
function surface(){const doc={createElement(tag){return new Element(tag,this);}};return doc.createElement('div');}
test('compact rendering keeps nodes stable across ticks and clears old direction on stop',()=>{
  const root=surface(),view=createClosestGuideStrategyView(root);view.render(preview,viewOptions);const nodes=[...root.children],text=allNodes(root).map(n=>n.textContent).join(' ');
  assert.match(text,/לא איתות כניסה/);assert.match(text,/תנאי האסטרטגיה/);assert.doesNotMatch(text,/%/);view.render(preview,{...viewOptions,now:now+1});assert.deepEqual(root.children,nodes);assert.equal(root.replacements,1);
  view.clear('המעקב כבוי');assert.equal(root.dataset.direction,'');assert.equal(view.snapshot().candidate,null);assert.ok(allNodes(root).some(n=>n.textContent==='המעקב כבוי'));
});

test('new summary is directly below warmup and the live page pairs its resets and exports its state',async()=>{
  const html=await readFile(new URL('../live-ohlc.html',import.meta.url),'utf8'),page=await readFile(new URL('../live-ohlc.mjs',import.meta.url),'utf8');
  assert.match(html,/id="warmup3000-panel"[\s\S]*?<\/section>\s*<section class="panel closest-strategy-panel"/);
  assert.match(page,/closestView\.render\(preview,\{\.\.\.options,analysis:lastAnalysis\}\)/);assert.match(page,/closestView\.clear\(message\)/);assert.match(page,/closestStrategy:closestView\.snapshot\(\)/);
});

test('all close strategies are returned in rank order, with one row per strategy and direction',()=>{
  const model=describeClosestGuideStrategy(preview,viewOptions);
  assert.ok(model.candidates.length>1,'real engine fixture has several qualifying profiles');
  assert.equal(new Set(model.candidates.map(c=>c.profileId+'|'+c.direction)).size,model.candidates.length);
  assert.deepEqual(model.candidate,model.candidates[0]);
  for(let i=1;i<model.candidates.length;i++)assert.ok(model.candidates[i-1].rank>=model.candidates[i].rank);
  const doubled={...analysis,events:[...analysis.events,...analysis.events]};
  assert.equal(describeClosestGuideStrategy(preview,{...viewOptions,analysis:doubled}).candidates.length,model.candidates.length);
  assert.deepEqual(describeClosestGuideStrategy(preview,{...viewOptions,now:now+15001}).candidates,[]);
});

test('rendered list contains every qualifying profile, preserves live row nodes and removes stale rows',()=>{
  const root=surface(),view=createClosestGuideStrategyView(root),model=view.render(preview,viewOptions),rows=allNodes(root).filter(n=>n.dataset.strategyId);
  assert.equal(rows.length,model.candidates.length);assert.ok(rows.length>1);
  view.render(preview,{...viewOptions,now:now+1});assert.deepEqual(allNodes(root).filter(n=>n.dataset.strategyId),rows);
  view.clear();assert.equal(allNodes(root).filter(n=>n.dataset.strategyId).length,0);
});

test('collapse is persisted, survives live updates and a new view, and storage failures do not break monitoring',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},root=surface(),view=createClosestGuideStrategyView(root,{storage}),details=root.children[0];
  assert.equal(details.open,true);details.open=false;details.listeners.toggle();assert.equal(values.get(CLOSEST_STRATEGIES_COLLAPSED_KEY),'true');
  view.render(preview,viewOptions);assert.equal(details.open,false);assert.equal(view.snapshot().collapsed,true);
  const next=surface(),nextView=createClosestGuideStrategyView(next,{storage});assert.equal(next.children[0].open,false);
  next.children[0].open=true;next.children[0].listeners.toggle();assert.equal(values.get(CLOSEST_STRATEGIES_COLLAPSED_KEY),'false');assert.equal(nextView.snapshot().collapsed,false);
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},fallback=surface();assert.doesNotThrow(()=>{const v=createClosestGuideStrategyView(fallback,{storage:blocked});fallback.children[0].listeners.toggle();v.render(preview,viewOptions);});
});
