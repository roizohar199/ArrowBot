import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWindowFixture,encodeFrame} from './window-reader-fixture.mjs';

// Synthetic public-DOM contracts, not real-time exchange or account proof.
function researchFixture(){
  const f=makeWindowFixture(),Element=f.canvas.constructor,doc=f.document;
  const interval=doc.querySelector('#header-toolbar-intervals [aria-checked="true"]');
  const layout=new Element({'aria-label':'Logged in as local-test\nActive layout: Arrow OHLC Live Verification'});
  const first=new Element({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),third=new Element({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'});
  const ownLegend=doc.querySelectorAll('[data-qa-id="legend-series-item"]')[0],foreignLegends=[new Element(),new Element()];
  const statuses=[f.statuses,...foreignLegends.map(()=>{const value=new Element({},'Real-time data');value.outerHTML='<span class="marketStatusOpen-x dataStatusRealtime"></span>';return value;})];
  const legends=[foreignLegends[0],ownLegend,foreignLegends[1]],wrappers=[new Element(),new Element(),new Element()],charts=[first,f.canvas,third];
  for(let index=0;index<3;index++){
    charts[index].parentElement=wrappers[index];legends[index].parentElement=wrappers[index];wrappers[index].parentElement=doc.body;
    const status=index===1?statuses[0]:statuses[index===0?1:2];status.parentElement=legends[index];
    legends[index].querySelectorAll=selector=>selector==='[data-qa-id="legend-statuses-wrapper"]'?[status]:[];
    wrappers[index].querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?[charts[index]]:selector==='[data-qa-id="legend-series-item"]'?[legends[index]]:[];
  }
  doc.body.querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?doc.canvases:selector==='[data-qa-id="legend-series-item"]'?doc.legends:[];
  doc.canvases=charts;doc.legends=legends;doc.layouts=[layout];doc.intervals=[interval];doc.replayNodes=[f.replay];
  layout.parentElement=doc.body;interval.parentElement=doc.body;f.replay.parentElement=doc.body;
  const oldAll=doc.querySelectorAll.bind(doc),oldOne=doc.querySelector.bind(doc);
  doc.querySelectorAll=selector=>selector==='[data-qa-id="legend-series-item"]'?doc.legends:(selector==='button[aria-label*="Active layout: Arrow "]'||selector==='button[aria-label*="Active layout: "]')?doc.layouts:selector==='#header-toolbar-intervals [aria-checked="true"]'?doc.intervals:selector==='#header-toolbar-replay'?doc.replayNodes:oldAll(selector);
  doc.querySelector=selector=>(selector==='button[aria-label*="Active layout: Arrow "]'||selector==='button[aria-label*="Active layout: "]')?doc.layouts[0]??null:oldOne(selector);
  f.context.location.pathname='/chart/ARROWRV1/';f.context.location.href='https://www.tradingview.com/chart/ARROWRV1/';
  return {...f,layout,interval,first,third,ownLegend,foreignLegends,statuses,wrappers,Element};
}
const options={allowResearchLiveMultiChart:true};

test('LIVE three-chart research is opt-in and separate from the legacy Replay-only flag',()=>{
  const f=researchFixture();assert.equal(f.read().reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  assert.equal(f.read({allowResearchMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  const allowed=f.read(options);assert.notEqual(allowed.reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  assert.equal(allowed.chart.visibleCharts,3);assert.equal(allowed.chart.replay,false);assert.equal(allowed.chart.researchSelection.targetCharts,1);
  assert.equal(allowed.chart.researchSelection.sourceMode,'LIVE');assert.equal(allowed.chart.researchSelection.liveMultiChartExplicit,true);assert.equal(allowed.chart.researchSelection.statusLegendScoped,true);
  const replay=researchFixture();replay.replay.attrs['aria-pressed']='true';assert.equal(replay.read(options).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  assert.notEqual(replay.read({allowResearchMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
});

test('two charts are allowed only with the same unique active NQ minute',()=>{
  const f=researchFixture();f.document.canvases.pop();f.document.legends.pop();
  assert.equal(f.read(options).chart.researchSelection.visibleCharts,2);
});

for(const [name,change]of [
  ['personal URL',f=>{f.context.location.pathname='/chart/Personal/';}],
  ['personal layout',f=>{f.layout.attrs['aria-label']='Active layout: Personal';}],
  ['other Arrow layout',f=>{f.layout.attrs['aria-label']='Active layout: Arrow Personal';}],
  ['duplicate layout controls',f=>{f.document.layouts.push(f.layout);}],
  ['hidden layout',f=>{f.layout.visible=false;}],
  ['mixed symbol',f=>{f.first.attrs['aria-label']='Chart for CME_MINI:MNQ1!, 5 minutes';}],
  ['malformed chart label',f=>{f.first.attrs['aria-label']='Chart for unknown';}],
  ['duplicate minute',f=>{f.third.attrs['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';}],
  ['four visible charts',f=>{f.document.canvases.push(new f.Element({'aria-label':'Chart for CME_MINI:NQ1!, 15 minutes'}));}],
  ['inactive minute header',f=>{f.interval.attrs['data-value']='5';}],
  ['ambiguous checked intervals',f=>{f.document.intervals.push(f.interval);}],
  ['unknown Replay state',f=>{delete f.replay.attrs['aria-pressed'];}],
  ['offscreen minute canvas',f=>{f.canvas.rect={left:2000,right:2100};}]
])test(name+' cannot open the LIVE multichart exception',()=>{
  const f=researchFixture();change(f);const result=f.read(options);assert.equal(result.reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.equal(result.chart.researchSelection,undefined);
});

test('closed selected-minute status is not replaced by another chart’s open/realtime legend',()=>{
  const f=researchFixture();f.statuses[0].outerHTML='<span class="marketStatusClosed-x"></span>';f.statuses[0].textContent='Market closed';
  const r=f.read(options);assert.equal(r.chart.marketOpen,false);assert.equal(r.chart.realtime,null);assert.equal(r.chart.realtimeBasis,'UNVERIFIED');
  f.advance();f.setRaw(encodeFrame({sequence:2}));f.mutate();assert.equal((f.context.__arrowWindowFeedV2.clockWitnesses??[]).length,0);
});

test('selected-minute delayed status is retained despite realtime legends in both neighboring charts',()=>{
  const f=researchFixture();f.statuses[0].outerHTML='<span class="marketStatusOpen-x dataStatusDelayed"></span>';f.statuses[0].textContent='Data is delayed';
  const r=f.read(options);assert.equal(r.chart.marketOpen,true);assert.equal(r.chart.realtime,false);assert.equal(r.chart.realtimeBasis,'EXPLICIT_DELAYED_DOM');
});

test('contradictory selected-minute open/closed status is unknown during a LIVE DOM transition',()=>{
  const f=researchFixture();f.statuses[0].outerHTML='<span class="marketStatusOpen-x marketStatusClosed-x"></span>';f.statuses[0].textContent='';
  const r=f.read(options);assert.equal(r.chart.marketOpen,null);assert.equal(r.chart.realtime,null);
});

test('unavailable scoped legend leaves market/realtime unknown even with a single foreign global legend',()=>{
  const f=researchFixture();f.wrappers[1].querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?[f.canvas]:[];
  f.document.legends=[f.foreignLegends[0]];
  const r=f.read(options);assert.equal(r.chart.marketOpen,null);assert.equal(r.chart.realtime,null);assert.equal(r.chart.researchSelection.statusLegendScoped,false);
});

test('multiple scoped legends or status wrappers never select the first match',()=>{
  for(const ambiguousStatuses of [false,true]){
    const f=researchFixture();
    if(ambiguousStatuses)f.ownLegend.querySelectorAll=()=>[f.statuses[0],f.statuses[1]];
    else f.wrappers[1].querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?[f.canvas]:selector==='[data-qa-id="legend-series-item"]'?[f.ownLegend,f.foreignLegends[0]]:[];
    const r=f.read(options);assert.equal(r.chart.marketOpen,null);assert.equal(r.chart.realtime,null);assert.equal(r.chart.researchSelection.statusLegendScoped,false);
  }
});

test('the scoped legend walk is bounded and cannot cross into a shared chart ancestor',()=>{
  const f=researchFixture();let parent=f.wrappers[1];
  for(let index=0;index<33;index++){const node=new f.Element();node.parentElement=parent;node.querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?[f.canvas]:[];parent=node;}
  f.canvas.parentElement=parent;
  const r=f.read(options);assert.equal(r.chart.realtime,null);assert.equal(r.chart.marketOpen,null);
});

test('observer callbacks retain the explicit LIVE research flag without changing decoded frame genealogy',()=>{
  const f=researchFixture(),single=makeWindowFixture();f.read(options);single.read();
  assert.equal(f.context.__arrowWindowFeedV2.currentArgs.allowResearchLiveMultiChart,true);assert.equal(f.context.__arrowWindowFeedV2.currentArgs.allowResearchMultiChart,false);
  f.advance();single.advance();const raw=encodeFrame({sequence:2});f.setRaw(raw);single.setRaw(raw);f.mutate();single.mutate();
  const observed=f.context.__arrowWindowFeedV2.latestEvidence;assert.equal(observed.chart.researchSelection.sourceMode,'LIVE');assert.equal(observed.chart.marketOpen,true);assert.equal(observed.chart.realtime,true);
  assert.deepEqual(f.read(options).windowFrame,single.read().windowFrame);
});

test('the new LIVE flag is boolean and never changes legacy single-chart behavior',()=>{
  const f=researchFixture();assert.equal(f.read({allowResearchLiveMultiChart:'true'}).reasonCodes[0],'WINDOW_READER_CONFIGURATION_INVALID');
  const single=makeWindowFixture(),r=single.read();assert.equal(r.chart.visibleCharts,1);assert.equal(r.chart.realtime,true);assert.equal(r.chart.researchSelection,undefined);
});

function fullScreensFixture(){const f=researchFixture();f.context.location.pathname='/chart/ARROWFR1/';f.context.location.href='https://www.tradingview.com/chart/ARROWFR1/';f.layout.attrs['aria-label']='Logged in as local-test Active layout: Full Screens Live';return f;}
test('FULL SCREENS admits only its exact existing three-chart NQ scope and preserves protocol2 decoding without fabricated session proof',()=>{
  const f=fullScreensFixture();assert.equal(f.read().reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.equal(f.read({allowResearchMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  const initial=f.read(options);assert.equal(initial.chart.researchSelection.layoutName,'Full Screens Live');assert.equal(initial.chart.researchSelection.statusLegendScoped,true);assert.equal(initial.windowFrame.current.providerBarIndex,undefined);
  f.advance();f.setRaw(encodeFrame({sequence:2}));f.mutate();const next=f.read(options);assert.equal(next.status,'OK');assert.equal(next.windowFrame.checksumsVerified,true);assert.equal(next.chart.marketOpen,true);assert.equal(next.chart.realtime,true);assert.equal(next.chart.visibleCharts,3);assert.equal(next.windowFrame.current.providerBarIndex,undefined);
});
test('FULL SCREENS URL/name pairs, sourceURL components and hard faults remain exact',()=>{
  for(const edit of [
    f=>{f.context.location.pathname='/chart/ARROWRV1/';f.context.location.href='https://www.tradingview.com/chart/ARROWRV1/';},
    f=>{f.layout.attrs['aria-label']='Active layout: Arrow OHLC Live Verification';},
    f=>{f.layout.attrs['aria-label']='Active layout: Full Screens Live COPY';},
    f=>{f.context.location.href+='?extra=1';},f=>{f.context.location.href+='#extra';},
    f=>{f.context.location.href='https://user@www.tradingview.com/chart/ARROWFR1/';},
    f=>{f.context.location.href='https://www.tradingview.com:444/chart/ARROWFR1/';},
    f=>{f.context.location.hostname='other.tradingview.com';f.context.location.href='https://other.tradingview.com/chart/ARROWFR1/';},
    f=>{f.replay.attrs['aria-pressed']='true';},f=>{f.interval.attrs['data-value']='5';},f=>{f.third.attrs['aria-label']=f.canvas.attrs['aria-label'];}
  ]){const f=fullScreensFixture();edit(f);assert.equal(f.read(options).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED',edit.toString());}
  const delayed=fullScreensFixture();delayed.statuses[0].outerHTML='<span class="marketStatusOpen-x dataStatusDelayed"></span>';assert.equal(delayed.read(options).chart.realtime,false);
  const malformed=fullScreensFixture();const raw=encodeFrame();raw.ARROW2_CHECKSUM_A++;malformed.setRaw(raw);assert.equal(malformed.read(options).reasonCodes[0],'WINDOW_FRAME_CHECKSUM_MISMATCH');
});

test('same-session navigation between the two approved pairs resets reader context rather than reusing the old source identity',()=>{
  const f=researchFixture();f.read(options);f.advance();f.setRaw(encodeFrame({sequence:2}));f.read(options);
  f.context.location.pathname='/chart/ARROWFR1/';f.context.location.href='https://www.tradingview.com/chart/ARROWFR1/';f.layout.attrs['aria-label']='Active layout: Full Screens Live';
  const changed=f.read(options);assert.equal(changed.resetRequired,true);assert.equal(changed.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.equal(changed.messages.length,0);assert.ok(changed.history.every(series=>series.retainedBars===0));
});
