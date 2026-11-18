// Explicitly synthetic mathematical reachability inputs. These tests do not
// authenticate market data, authorize orders or claim profitable directions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {selectGuideTechnicalDecision,corroborateGuideTechnicalDecision} from '../guide-technical-decision.mjs';
const model=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
function run({direction='LONG',budget=200,missingRisk=false}={}){
  const f=structuredClone(model);f.options.risk.riskBudget=budget;
  if(direction==='SHORT'){const mirror=b=>({...b,open:56676-b.open,high:56676-b.low,low:56676-b.high,close:56676-b.close});f.bars=f.bars.map(mirror);for(const h of Object.values(f.options.higherTimeframes))h.bars=h.bars.map(mirror);}
  if(missingRisk)f.options.risk=null;
  const analysis=analyzeGuideSignals(f.bars,f.options);return {f,analysis,decision:selectGuideTechnicalDecision({analysis,bars:f.bars})};
}
const latestEvent=a=>a.events.find(e=>e.confirmationBarCloseTime===a.asOfTime);

test('unchanged complete engine LONG and SHORT all-seven examples yield directional observations without sizing or order authority',()=>{
  for(const direction of ['LONG','SHORT']){const {analysis,decision}=run({direction});assert.equal(analysis.signals.length,1);assert.equal(decision.status,'CONFIRMED');assert.equal(decision.direction,direction);
    assert.equal(decision.signal.sourceEventIds.length,1);assert.equal(decision.signal.sourceEventIds[0],latestEvent(analysis).eventId);assert.equal(decision.signal.confirmationClose,analysis.signals[0].confirmationClose);
    assert.equal(decision.signal.orderEligible,false);assert.equal(decision.profitabilityVerified,false);assert.equal(decision.synthetic,true);assert.equal(decision.testOnly,true);assert.ok(Object.isFrozen(decision.signal));
    for(const forbidden of ['quantity','riskPlan','riskBudget','stop','target'])assert.equal(Object.hasOwn(decision.signal,forbidden),false);
    assert.equal(corroborateGuideTechnicalDecision(decision,analysis.signals[0]).passed,true);
  }
});
test('real full-engine risk-budget rejection and missing risk parameters do not erase a completed all-seven technical confirmation',()=>{
  for(const options of [{budget:50},{missingRisk:true}]){const {analysis,decision}=run(options),event=latestEvent(analysis);
    assert.equal(analysis.signals.length,0);assert.equal(event.status,'REJECTED');assert.ok(event.confirmedAt);assert.ok(event.contextSnapshot.checks.every(c=>c.required&&c.enabled&&c.available&&c.passed));
    assert.equal(decision.status,'CONFIRMED');assert.equal(decision.signal.setups[0].riskDiagnostic.rejectedByRisk,true);assert.equal(decision.signal.setups[0].riskDiagnostic.sizingOrRiskApprovalGranted,false);
    assert.equal(event.status,'REJECTED','derivation does not rewrite the execution engine event');assert.equal(corroborateGuideTechnicalDecision(decision,event).passed,false);
  }
});
test('bars omitted derive exact closed pattern-ledger fields and explicit mismatched/open/future data cannot approve',()=>{
  const {analysis,f,decision}=run();assert.deepEqual(selectGuideTechnicalDecision({analysis}),decision);
  for(const change of [x=>{x.bars.at(-1).close+=.25;},x=>{x.bars.at(-1).closed=false;},x=>{x.bars.at(-1).knownAt=x.analysis.asOfTime+1;},x=>{x.bars.at(-1).sourceClosed=false;},x=>{x.analysis.patterns.byBar.at(-1).available=false;}]){
    const x={analysis:structuredClone(analysis),bars:structuredClone(f.bars)};change(x);assert.equal(selectGuideTechnicalDecision(x).status,'BLOCKED');
  }
});
test('all seven frozen technical contexts remain mandatory even when sizing is excluded',()=>{
  const {analysis}=run({budget:50});
  for(const id of ['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME'])for(const flag of ['required','enabled','available','passed']){
    const a=structuredClone(analysis);latestEvent(a).contextSnapshot.checks.find(c=>c.id===id)[flag]=false;assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'BLOCKED');
  }
  const a=structuredClone(analysis);a.parameterSnapshot.config.requireEma=false;assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'BLOCKED');
});
test('only completed confirmation or an exact risk-only rejection can become technical evidence',()=>{
  const {analysis}=run({budget:50});
  for(const status of ['ARMED','EXPIRED','INVALIDATED','REJECTED']){const a=structuredClone(analysis),e=latestEvent(a);e.status=status;e.reasonCodes=['MISSING_EMA'];assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'NO_APPROVAL');}
  for(const change of [e=>{e.confirmedAt=null;},e=>{e.confirmationIndex=e.signalIndex;},e=>{e.confirmationClose+=.25;},e=>{e.detectedAt=e.confirmedAt;},e=>{e.invalidatedAt=e.confirmedAt;},e=>{e.expiresAfterBars=0;}]){
    const a=structuredClone(analysis);change(latestEvent(a));assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'BLOCKED');
  }
  const a=structuredClone(analysis),e=latestEvent(a);e.riskPlan.reasonCodes=['MISSING_EMA'];e.reasonCodes=['RISK_REJECTED','MISSING_EMA'];assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'NO_APPROVAL');
});
test('compatible synthetic descriptions merge without selecting a best setup, while an opposing risk-rejected contract vetoes execution',()=>{
  const {analysis}=run(),before=structuredClone(analysis),first=latestEvent(analysis),second=structuredClone(first);second.eventId+=':compatible';second.setupId='SYNTHETIC_COMPATIBLE_DESCRIPTION';analysis.events.push(second);
  const compatible=selectGuideTechnicalDecision({analysis});assert.equal(compatible.status,'CONFIRMED');assert.equal(compatible.signal.sourceEventIds.length,2);assert.equal(corroborateGuideTechnicalDecision(compatible,analysis.signals[0]).passed,true);
  // Compose independent full-engine LONG/SHORT event contracts to exercise the
  // aggregator boundary. This composition is not one authentic market series.
  const opposite=latestEvent(run({direction:'SHORT',budget:50}).analysis);assert.equal(opposite.status,'REJECTED');assert.ok(opposite.reasonCodes.includes('RISK_REJECTED'));
  analysis.events.push(structuredClone(opposite));const conflict=selectGuideTechnicalDecision({analysis});assert.equal(conflict.status,'AMBIGUOUS');assert.equal(conflict.signal,null);assert.equal(conflict.direction,null);
  assert.equal(conflict.conflicts.length,1);assert.equal(corroborateGuideTechnicalDecision(conflict,before.signals[0]).passed,false);
});
test('the current decision never promotes an older approval, and engine ambiguity remains blocked',()=>{
  const {f}=run(),last=f.bars.at(-1);f.bars.push({time:last.closeTime,closeTime:last.closeTime+60000,knownAt:last.closeTime+60000,open:last.close,high:last.close+.25,low:last.close-.25,close:last.close,closed:true,chartType:'standard'});f.options.asOfTime=f.bars.at(-1).closeTime;
  const a=analyzeGuideSignals(f.bars,f.options),d=selectGuideTechnicalDecision({analysis:a});assert.equal(d.status,'NO_APPROVAL');assert.equal(d.historicalSignals.length,1);assert.equal(d.signal,null);
  const current=run(),e=latestEvent(current.analysis);e.status='AMBIGUOUS';e.reasonCodes=['CONFLICTING_CONFIRMED_DIRECTIONS'];assert.equal(selectGuideTechnicalDecision({analysis:current.analysis}).status,'AMBIGUOUS');
});
test('version/data-quality/duplicate-ledger failures and mismatching execution membership cannot grant authority',()=>{
  assert.equal(selectGuideTechnicalDecision(null).status,'BLOCKED');
  const {analysis,decision}=run();for(const change of [a=>{a.definitionVersion='guide-signals-old';},a=>{a.dataQuality.valid=false;},a=>{a.events.push(structuredClone(a.events[0]));}]){const a=structuredClone(analysis);change(a);assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'BLOCKED');}
  for(const change of [s=>{s.direction='SHORT';},s=>{s.confirmationClose+=.25;},s=>{s.setupEventIds=['foreign-event'];},s=>{s.confirmedAt++;}]){const s=structuredClone(analysis.signals[0]);change(s);assert.equal(corroborateGuideTechnicalDecision(decision,s).passed,false);}
  assert.equal(corroborateGuideTechnicalDecision(decision,analysis.signals[0]).orderAuthorizationGranted,false);
});
