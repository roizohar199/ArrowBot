import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';
import {renderGuideAnalysis} from '../guide-analysis-view.mjs';

// Real complete engine calculations on explicitly artificial OHLC. These tests
// prove view semantics, never native market approval or order authorization.
const fixture=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
function engine({riskRejected=false}={}){
  const f=structuredClone(fixture);
  if(riskRejected)Object.assign(f.bars.at(-1),{high:28345,close:28344});
  return analyzeGuideSignals(f.bars,f.options);
}
class Element{
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.dataset={};this.children=[];this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  set innerHTML(_){throw Error('HTML parsing is forbidden for explanation text');}
  set outerHTML(_){throw Error('HTML replacement is forbidden for explanation text');}
  insertAdjacentHTML(){throw Error('HTML insertion is forbidden for explanation text');}
}
function dom(){const document={createElement(tag){return new Element(tag,this);}};return document.createElement('section');}
const nodes=element=>[element,...element.children.flatMap(nodes)];
const text=element=>nodes(element).map(node=>node.textContent).join('\n');
const technicalCard=container=>nodes(container).find(node=>node.dataset.kind==='technical-direction-decision');

test('real engine technical approval remains visible when its own planned-risk diagnostic is rejected',()=>{
  const analysis=engine({riskRejected:true}),description=describeGuideAnalysis(analysis),container=dom();
  assert.equal(analysis.metadata.synthetic,true);assert.equal(analysis.metadata.testOnly,true);
  const event=analysis.events.find(event=>event.signalIndex===427&&event.setupId==='TREND_CONTINUATION');
  assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('RISK_REJECTED'));assert.equal(event.riskPlan.perContractRisk,218.1);
  assert.equal(analysis.signals.filter(signal=>signal.confirmationBarCloseTime===analysis.asOfTime).length,0);
  assert.equal(description.technicalDecision.status,'CONFIRMED');assert.equal(description.technicalDecision.direction,'LONG');
  assert.equal(description.technicalDecision.orderEligible,false);assert.equal(description.orderEligible,false);
  renderGuideAnalysis(container,description);
  const card=technicalCard(container);assert.ok(card);assert.equal(card.dataset.state,'CONFIRMED');assert.equal(card.dataset.direction,'LONG');
  assert.match(text(card),/אישור טכני ללונג/);assert.match(text(card),/ניהול הסיכון בידיך/);assert.match(text(card),/בנפרד/);
  assert.match(text(container),/תוכנית סיכון: BLOCKED/);
  assert.ok(nodes(card).some(node=>node.dataset.state==='PASS'));
  assert.doesNotMatch(text(card),/עסקה נפתחה|פקודה נשלחה|מילוי מוגן|סיכון מאושר/);
});

test('normal all-seven engine approval is labeled technical and does not assert execution or profitability',()=>{
  const analysis=engine(),description=describeGuideAnalysis(analysis),container=dom();
  assert.equal(description.technicalDecision.status,'CONFIRMED');assert.equal(description.technicalDecision.direction,'LONG');
  assert.equal(description.technicalDecision.execution,'OBSERVATION_ONLY');assert.equal(description.technicalDecision.profitabilityVerified,false);
  renderGuideAnalysis(container,description);
  const card=technicalCard(container);assert.match(text(card),/כל תנאי החובה של האסטרטגיות המאושרות התקיימו/);
  assert.doesNotMatch(text(card),/שבעת מסנני ההקשר|שבעה מסננים/);
  assert.match(text(card),/שיעור ההצלחה שלו טרם אומת/);assert.match(text(card),new RegExp(new Date(analysis.asOfTime).toISOString().replaceAll('.','\\.')));
  assert.equal(Object.hasOwn(description.technicalDecision.signal,'riskPlan'),false);
  assert.equal(Object.hasOwn(description.technicalDecision.signal,'quantity'),false);
});

test('native ROLE strategy approval with exactly two required conditions does not claim seven context filters passed',async()=>{
  // Recompute the native history candidate; this is a view-only regression,
  // not a substitute for the separately captured actual Replay execution.
  const candidate=JSON.parse(await readFile(new URL('../verification/0.22.0/natural-profile-1793355420000-SHORT.json',import.meta.url),'utf8'));
  const analysis=analyzeGuideSignals(candidate.analysisInputs.bars,candidate.analysisInputs.options),description=describeGuideAnalysis(analysis),container=dom();
  const technical=description.technicalDecision;assert.equal(technical.status,'CONFIRMED');assert.equal(technical.direction,'SHORT');assert.equal(technical.signal.approvalPolicy,'guide_scenarios_v1');
  assert.deepEqual(technical.signal.strategyProofs.map(proof=>proof.profileId),['ROLE_REVERSAL_RETEST']);
  assert.deepEqual(technical.signal.requiredChecks.map(check=>check.id),['STRUCTURE','KNOWN_LOCATION']);
  renderGuideAnalysis(container,description);const card=technicalCard(container);
  assert.match(text(card),/אישור טכני לשורט/);assert.match(text(card),/כל תנאי החובה של האסטרטגיות המאושרות התקיימו/);
  assert.doesNotMatch(text(card),/שבעת מסנני ההקשר|שבעה מסננים|כל שבעת|עסקה נפתחה|מילוי מוגן/);
});

test('waiting technical direction describes each strategy conditions without presenting all seven as a universal gate',()=>{
  const container=dom();renderGuideAnalysis(container,{technicalDecision:{status:'NO_APPROVAL',direction:null,asOfTime:fixture.options.asOfTime,approvalPolicy:'guide_scenarios_v1'}});
  const card=technicalCard(container);assert.match(text(card),/לפי תנאי החובה של כל אסטרטגיה/);assert.doesNotMatch(text(card),/שבעת|שבעה|כל שבעת/);
  assert.equal(nodes(card).some(node=>node.dataset.state==='PASS'),false);
});

test('opposing technical approval is displayed as ambiguous with no affirmative direction or PASS row',()=>{
  // Component-level conflict presentation, not a fabricated engine proof.
  const container=dom();renderGuideAnalysis(container,{technicalDecision:{status:'AMBIGUOUS',direction:null,asOfTime:fixture.options.asOfTime,orderEligible:false}});
  const card=technicalCard(container);assert.equal(card.dataset.state,'AMBIGUOUS');assert.equal(card.dataset.direction,'');
  assert.match(text(card),/אושרו תרחישי לונג ושורט/);assert.match(text(card),/אין כיוון יחיד לכניסה/);
  assert.equal(nodes(card).some(node=>node.dataset.state==='PASS'),false);
  assert.doesNotMatch(text(card),/אישור טכני ללונג|אישור טכני לשורט/);
});

test('a blocked or unavailable latest decision removes the prior confirmed technical direction',()=>{
  const description=describeGuideAnalysis(engine()),container=dom();renderGuideAnalysis(container,description);
  const previous=technicalCard(container);assert.equal(previous.dataset.direction,'LONG');
  renderGuideAnalysis(container,{technicalDecision:{status:'BLOCKED',direction:null,asOfTime:fixture.options.asOfTime}});
  const blocked=technicalCard(container);assert.notEqual(blocked,previous);assert.equal(blocked.dataset.direction,'');assert.match(text(blocked),/אין אישור כיוון/);
  assert.equal(nodes(blocked).some(node=>node.dataset.state==='PASS'),false);assert.doesNotMatch(text(container),/אישור טכני ללונג/);
  renderGuideAnalysis(container,null);assert.equal(technicalCard(container),undefined);assert.match(text(container),/ממתין לניתוח חדש/);
});

test('historical explanation cannot present its technical direction as the latest closed decision',()=>{
  const analysis=engine(),latest=describeGuideAnalysis(analysis);assert.equal(latest.technicalDecision.status,'CONFIRMED');
  const historical=describeGuideAnalysis(analysis,{barIndex:analysis.patterns.byBar.length-2});assert.equal(historical.technicalDecision,null);
  const container=dom();renderGuideAnalysis(container,historical);assert.equal(technicalCard(container),undefined);
});

test('untrusted market, condition and scenario text remains literal DOM text without HTML parsing',()=>{
  const hostile='<img src=x onerror="globalThis.directionViewInjected=true"><script>throw 1</script>',container=dom();
  renderGuideAnalysis(container,{
    technicalDecision:{status:'NO_APPROVAL',direction:null,asOfTime:fixture.options.asOfTime},
    market:{stateLabel:hostile,barsUsed:1},
    directions:{LONG:{conditionsMet:0,passed:false,checks:[{label:hostile,state:'FAIL',required:true,rule:hostile,evidence:{raw:hostile},reasonDetails:[{label:hostile}]}]}},
    patternChecks:[{label:hostile,state:'NO_MATCH',interpretation:hostile,conditions:[{label:hostile,actual:hostile,expected:hostile,passed:false}],reasonDetails:[{label:hostile}]}],
    scenarioFamilies:[{label:hostile,directions:[{direction:hostile,state:hostile,candidateIds:[]}]}],
    scenarios:[{patternLabels:[hostile],direction:hostile,label:hostile,timing:{},levels:{},reasonDetails:[{label:hostile}],risk:{status:hostile}}],
  });
  assert.ok(text(container).includes(hostile));assert.equal(nodes(container).some(node=>['IMG','SCRIPT'].includes(node.tagName)),false);
  assert.equal(nodes(container).some(node=>Object.keys(node).some(key=>/^on/i.test(key))),false);assert.equal(globalThis.directionViewInjected,undefined);
  assert.equal(technicalCard(container).dataset.state,'NO_APPROVAL');assert.equal(nodes(technicalCard(container)).some(node=>node.dataset.state==='PASS'),false);
});


test('per-strategy display shows partial mandatory progress without presenting seven global diagnostics as entry requirements',()=>{
  const container=dom(),description={market:{state:'TREND_DOWN',barsUsed:101},directions:{SHORT:{conditionsMet:0,passed:false,checks:[{label:'EMA',state:'FAIL',required:true}]}},strategyScan:{profiles:[{label:'בליעה עם EMA',latest:{direction:'SHORT',requiredPassed:1,requiredTotal:2,statusLabel:'נדחה',barCloseTime:fixture.options.asOfTime,afterBaseline:false,checks:[{label:'מבנה',state:'PASS',evidence:{state:'TREND_DOWN'}},{label:'EMA',state:'FAIL',evidence:{distance:12.77,tolerance:1.5}}],reasonDetails:[{text:'מרחק מהממוצע גדול מדי'}]}}],closedBars:101,shapeDetections:87,candidateEvaluations:265,confirmedCandles:0,signalTimeframe:'1',contextTimeframes:['5','15'],afterBaselineCandidates:0}};
  renderGuideAnalysis(container,description);const output=text(container);assert.match(output,/1\/2 תנאי חובה/);assert.match(output,/87 זיהויי צורה/);assert.match(output,/265 בדיקות מועמד/);assert.match(output,/הקשר בלבד: 5, 15 דקות/);assert.match(output,/מלפני בסיס החיבור הנוכחי/);assert.match(output,/מרחק מהממוצע גדול מדי/);assert.match(output,/סקירת הקשר כללית בלבד/);assert.doesNotMatch(output,/0 תנאים התקיימו/);assert.equal(nodes(container).some(n=>n.dataset.kind==='per-strategy-scan'),true);
});
