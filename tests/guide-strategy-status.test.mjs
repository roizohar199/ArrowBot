import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from '../guide-technical-decision.mjs';
import {GUIDE_STRATEGY_POLICY,GUIDE_STRATEGY_PROFILES} from '../guide-strategy-policy.mjs';
import {describeGuideStrategyStatus,renderGuideStrategyStatus} from '../guide-strategy-status.mjs';
// Explicit artificial complete-engine model; no native market approval claim.
const fixture=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
const options={...fixture.options,config:{...fixture.options.config,strategyPolicy:GUIDE_STRATEGY_POLICY,requireRisk:false},risk:null};
const analysis=analyzeGuideSignals(fixture.bars,options),decision=selectGuideTechnicalDecision({analysis}),model=describeGuideStrategyStatus(analysis,{technicalDecision:decision});

test('all18 runtime rows come from the explicit engine descriptors and each shows only its own required conditions',()=>{
  assert.equal(model.status,'ACTIVE');assert.equal(model.rows.length,18);assert.equal(model.orderEligible,false);assert.equal(model.probabilityComputed,false);
  assert.deepEqual(model.rows.map(row=>row.profileId),GUIDE_STRATEGY_PROFILES.map(p=>p.id));
  for(const row of model.rows)assert.deepEqual(row.requiredCheckIds,GUIDE_STRATEGY_PROFILES.find(p=>p.id===row.profileId).requiredCheckIds);
});

test('only a full-proof event in the current technical decision is shown as current confirmation',()=>{
  assert.equal(decision.status,'CONFIRMED');const current=model.rows.filter(row=>row.status==='CURRENT_CONFIRMED');assert.ok(current.length);
  for(const row of current)for(const id of row.eventIds){const event=analysis.events.find(e=>e.eventId===id);assert.equal(event.confirmationBarCloseTime,analysis.asOfTime);assert.ok(decision.signal.sourceEventIds.includes(id));assert.equal(row.direction,decision.direction);}
  const later={...analysis,asOfTime:analysis.asOfTime+60000},old=describeGuideStrategyStatus(later,{technicalDecision:decision});assert.equal(old.rows.some(row=>row.status==='CURRENT_CONFIRMED'),false,'a saved historical decision cannot turn into a current approval');
});

test('a genuine prior-prefix pending setup is pending rather than a current approved direction',()=>{
  const bars=fixture.bars.slice(0,-1),a=analyzeGuideSignals(bars,{...options,asOfTime:bars.at(-1).closeTime}),d=selectGuideTechnicalDecision({analysis:a}),m=describeGuideStrategyStatus(a,{technicalDecision:d});
  const pending=m.rows.filter(row=>row.status==='ARMED');assert.ok(pending.length);for(const row of pending)for(const id of row.eventIds){const event=a.events.find(e=>e.eventId===id);assert.equal(event.status,'ARMED');assert.equal(event.confirmedAt,null);}
});

test('missing required context is named without treating optional checks as a universal gate',()=>{
  const event=analysis.events.find(e=>decision.signal.sourceEventIds.includes(e.eventId)),profile=GUIDE_STRATEGY_PROFILES.find(p=>p.id===event.strategyId),missing=profile.requiredCheckIds[0];
  const changed={...event,status:'REJECTED',contextSnapshot:{...event.contextSnapshot,checks:event.contextSnapshot.checks.map(c=>c.id===missing?{...c,passed:false,state:'FAIL'}:c)}};
  const m=describeGuideStrategyStatus({...analysis,events:[changed]},{technicalDecision:{...decision,status:'NO_APPROVAL',signal:null}}),row=m.rows.find(row=>row.profileId===profile.id);
  assert.equal(row.status,'MISSING_CONDITIONS');assert.deepEqual(row.missingRequiredCheckIds,[missing]);assert.equal(row.orderEligible,false);
});

class Element{constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.textContent='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}set innerHTML(_){throw Error('HTML parsing forbidden');}}
const nodes=root=>[root,...root.children.flatMap(nodes)],text=root=>nodes(root).map(n=>n.textContent).join('\n');
function surface(){const doc={createElement(tag){return new Element(tag,this);}};return doc.createElement('div');}
test('status table uses literal text, names its close time and never represents counts as probabilities',()=>{
  const container=surface(),hostile='<img src=x onerror=alert(1)>',rows=model.rows.map((row,index)=>index?row:{...row,label:hostile});renderGuideStrategyStatus(container,{...model,rows});
  assert.equal(nodes(container).filter(n=>n.tagName==='TR'&&n.dataset.strategyId).length,18);assert.ok(text(container).includes(hostile));assert.equal(nodes(container).some(n=>['IMG','SCRIPT'].includes(n.tagName)),false);assert.match(text(container),/אינם הסתברות להצלחה/);assert.ok(text(container).includes(new Date(analysis.asOfTime).toISOString()));
});

test('missing or altered profile descriptors remove previous direction rows instead of claiming18 strategies are active',()=>{
  const unavailable=describeGuideStrategyStatus({...analysis,strategyProfiles:analysis.strategyProfiles.slice(1)},{technicalDecision:decision});assert.equal(unavailable.status,'UNAVAILABLE');assert.deepEqual(unavailable.rows,[]);
  const container=surface();renderGuideStrategyStatus(container,model);renderGuideStrategyStatus(container,unavailable);assert.equal(nodes(container).some(n=>n.dataset.strategyId),false);assert.match(text(container),/ממתין לניתוח תקף/);
});
