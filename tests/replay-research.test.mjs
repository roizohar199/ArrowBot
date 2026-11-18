import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeReplayDataset,buildReplayAnalysisInput,selectReplayDecision,readReplayChartGate,describeReplayReadDiagnostics,REPLAY_REQUIRED_FLAGS} from '../replay-research.mjs';
import {analyzeGuideSignals,GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
import {verifyLiveChart} from '../live-ohlc.mjs';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';

const end=Date.UTC(2026,10,13,18),metadata={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard',replay:true,realtime:false,synthetic:false};
function datasetFixture(){const bars=rows(30,60000,end),higherTimeframes=Object.fromEntries(['5','15'].map(timeframe=>[timeframe,{timeframe,timeframeMs:Number(timeframe)*60000,instrument:metadata.instrument,bars:rows(30,Number(timeframe)*60000,end),metadata:{...metadata,timeframe,timeframeMs:Number(timeframe)*60000}}]));return {metadata:structuredClone(metadata),bars,higherTimeframes,provenance:{kind:'CONTROLLED_UNIT_FIXTURE_NOT_MARKET_EVIDENCE'}};}
function evidenceFor(dataset,index=20){const bar=dataset.bars[index];return {messages:[],contextOnly:true,liveEligible:false,chart:{symbols:[metadata.instrument],interval:'1',visibleCharts:1,documentVisible:true,replay:true},replayWitness:{kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,checksumsVerified:true,metadata:dataset.metadata,current:{...bar,sourceClosed:true},previous:index?{...dataset.bars[index-1],sourceClosed:true}:null,currentTime:bar.time,currentCloseTime:bar.closeTime}};}
function replayReaderFixture({replay=true}={}){
  const bootstrap={...makeBootstrap(),wireVersion:3},indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false})),base=indexed(rows(20,60000,end-60000),100),higher=[indexed(rows(20,300000,end),200),indexed(rows(20,900000,end),300)],current={...base.at(-1),time:end-60000,closeTime:end,providerBarIndex:120,closed:true,sourceClosed:true};
  const raw=encodeFrame({bootstrap,base,higher,current,sequence:0,sourceAt:Date.UTC(2026,10,14,12)+1000,flags:1});raw.ARROW2_PROTOCOL=3;
  const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
  for(const [group,bar] of Object.entries(groups))raw['ARROW2_'+group+'_CLOSE_TIME']=bar.providerBarIndex*4;
  const f=makeWindowFixture({bootstrap,raw:recalculateChecksums(raw)});f.replay.attrs['aria-pressed']=String(replay);return f;
}

test('Replay input cuts every timeframe at the exact witnessed close and forces all mandatory flags with explicit historical availability',()=>{
  const raw=datasetFixture();raw.bars[0].knownAt=raw.bars[0].time-1;raw.config={requireRisk:false,requireHigherTimeframe:false};raw.risk={riskBudget:99999,maxContracts:100};const dataset=normalizeReplayDataset(raw),evidence=evidenceFor(dataset,20),input=buildReplayAnalysisInput(dataset,evidence);
  assert.equal(input.bars.length,21);assert.equal(input.cutoff.excludedFutureBaseBars,9);assert.equal(input.options.asOfTime,evidence.replayWitness.current.closeTime);assert.ok(input.bars.every(bar=>bar.closeTime<=input.options.asOfTime&&bar.knownAt===bar.closeTime));assert.ok(Object.values(input.options.higherTimeframes).every(series=>series.bars.every(bar=>bar.closeTime<=input.options.asOfTime&&bar.knownAt===bar.closeTime)));assert.ok(REPLAY_REQUIRED_FLAGS.every(key=>input.options.config[key]===true));assert.equal(input.options.risk.riskBudget,200);assert.equal(input.options.risk.maxContracts,1);assert.equal(input.options.risk.pointValue,20);assert.equal(input.options.risk.commissionPerContract,3.1);assert.equal(input.options.risk.slippageTicks,2);assert.match(input.availabilityAssumption,/research assumption/);assert.equal(input.liveEligible,false);assert.equal(input.orderEligible,false);
  assert.equal(input.options.contextConfig.roleReversalEnabled,true);
});

test('explicit user-managed Market input has no bot risk plan or cost requirement while preserving all technical source gates',()=>{
  const dataset=normalizeReplayDataset(datasetFixture()),evidence=evidenceFor(dataset,20);
  const strict=buildReplayAnalysisInput(dataset,evidence),managed=buildReplayAnalysisInput(dataset,evidence,{userManagedRisk:true,commissionPerContract:null,slippageTicks:NaN});
  assert.equal(managed.options.risk,null);assert.equal(managed.options.config.requireRisk,false);
  for(const flag of REPLAY_REQUIRED_FLAGS.filter(flag=>flag!=='requireRisk'))assert.equal(managed.options.config[flag],true,flag);
  assert.equal(managed.options.contextConfig.roleReversalEnabled,true);assert.equal(managed.options.contextConfig.supplyDemandEnabled,true);
  assert.deepEqual(managed.bars,strict.bars);assert.deepEqual(managed.options.higherTimeframes,strict.options.higherTimeframes);assert.deepEqual(managed.cutoff,strict.cutoff);
  assert.equal(managed.liveEligible,false);assert.equal(managed.orderEligible,false);
  const wrong=structuredClone(evidence);wrong.replayWitness.current.close+=.25;assert.throws(()=>buildReplayAnalysisInput(dataset,wrong,{userManagedRisk:true}),/IMPORTED_CLOSED_OHLC_MISMATCH/);
  for(const userManagedRisk of ['true',1,null])assert.throws(()=>buildReplayAnalysisInput(dataset,evidence,{userManagedRisk}),/EXPLICIT_REPLAY_RISK_POLICY_REQUIRED/);
  assert.equal(strict.options.config.requireRisk,true);assert.equal(strict.options.risk.riskBudget,200,'legacy strict mode remains independent');
});

function researchMultiFixture(){
  const f=replayReaderFixture(),Element=f.canvas.constructor,layout=new Element({'aria-label':'Logged in Active layout: Arrow OHLC Live Verification'}),query=f.document.querySelector.bind(f.document);
  f.document.querySelector=selector=>selector==='button[aria-label*="Active layout: Arrow "]'?layout:query(selector);
  f.document.canvases=[new Element({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,new Element({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})];
  return {...f,layout,gate:args=>JSON.parse(JSON.stringify(vm.runInContext('('+readReplayChartGate.toString()+')('+JSON.stringify(args??{})+')',f.context)))};
}

test('explicit research mode reads the unique active one-minute NQ in three charts without changing chart count or LIVE eligibility',()=>{
  const f=researchMultiFixture();assert.equal(f.gate().ok,false);assert.equal(f.read().reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  const gate=f.gate({allowResearchMultiChart:true});assert.equal(gate.ok,true);assert.equal(gate.visibleCharts,3);assert.deepEqual(gate.symbols,['CME_MINI:NQ1!']);
  const result=f.read({allowResearchMultiChart:true});assert.ok(result.replayWitness);assert.equal(result.chart.visibleCharts,3);assert.equal(result.chart.researchSelection.targetCharts,1);assert.equal(result.chart.researchSelection.selectedChartLabel,'Chart for CME_MINI:NQ1!, 1 minute');assert.equal(result.liveEligible,false);assert.deepEqual(result.messages,[]);assert.equal(f.document.canvases.length,3);
});

test('multiple-chart opt-in does not accept personal layouts, duplicate one-minute charts, wrong symbols, inactive one-minute header or Replay off',()=>{
  for(const change of [
    f=>{f.layout.visible=false;},
    f=>{f.document.canvases[0].attrs['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';},
    f=>{f.document.canvases[0].attrs['aria-label']='Chart for COINBASE:BTCUSD, 5 minutes';},
    f=>{f.document.querySelector('#header-toolbar-intervals [aria-checked="true"]').attrs['data-value']='5';},
    f=>{f.replay.attrs['aria-pressed']='false';},
  ]){const f=researchMultiFixture();change(f);assert.equal(f.gate({allowResearchMultiChart:true}).ok,false);assert.equal(f.read({allowResearchMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');}
});

test('only user-managed Replay accepts a complete unique selected-chart proof; strict risk mode and ambiguous proofs still reject',()=>{
  const dataset=normalizeReplayDataset(datasetFixture()),e=evidenceFor(dataset),f=researchMultiFixture(),source=f.read({allowResearchMultiChart:true});e.chart=source.chart;
  assert.equal(buildReplayAnalysisInput(dataset,e,{userManagedRisk:true}).options.risk,null);assert.throws(()=>buildReplayAnalysisInput(dataset,e),/EXPLICIT_SINGLE_NQ_1M_REPLAY_REQUIRED/);
  for(const change of [v=>{delete v.chart.researchSelection;},v=>{v.chart.researchSelection.researchLayoutVerified=false;},v=>{v.chart.chartLabels[0]=v.chart.chartLabels[1];},v=>{v.chart.chartLabels[0]='Chart for CME:ES1!, 5 minutes';},v=>{v.chart.researchSelection.visibleCharts=1;}]){const bad=structuredClone(e);change(bad);assert.throws(()=>buildReplayAnalysisInput(dataset,bad,{userManagedRisk:true}),/EXPLICIT_SINGLE_NQ_1M_REPLAY_REQUIRED/);}
});

test('mismatched closed OHLC, LIVE charts, other instruments and absence of a provider-final candle fail closed',()=>{
  const dataset=normalizeReplayDataset(datasetFixture());
  for(const mutate of [e=>{e.replayWitness.current.high+=.25;},e=>{e.replayWitness.previous.close+=.25;},e=>{e.chart.replay=false;},e=>{e.chart.symbols=['CME:MBT1!'];},e=>{e.chart.visibleCharts=3;},e=>{e.replayWitness.current.closed=false;e.replayWitness.current.sourceClosed=false;e.replayWitness.previous.sourceClosed=false;},e=>{e.messages=['unrelated LIVE packet'];}]){const evidence=evidenceFor(dataset);mutate(evidence);assert.throws(()=>buildReplayAnalysisInput(dataset,evidence));}
  assert.throws(()=>buildReplayAnalysisInput(dataset,evidenceFor(dataset),{commissionPerContract:-1,slippageTicks:2}),/RESEARCH_COSTS/);
});

test('native dataset rejects holes, duplicate times, nonstandard charts and mismatched higher metadata',()=>{
  for(const mutate of [r=>r.bars.splice(3,1),r=>{r.bars[3].time=r.bars[2].time;},r=>{r.metadata.chartType='heikin_ashi';},r=>{r.higherTimeframes['5'].metadata.currency='EUR';},r=>{r.bars[0].closed=false;},r=>{r.metadata.synthetic=true;}]){const raw=datasetFixture();mutate(raw);assert.throws(()=>normalizeReplayDataset(raw));}
});

test('long genuine archives retain a bounded causal analysis window and distinguish old from future bars',()=>{
  const raw=datasetFixture();raw.bars=rows(900,60000,end);
  const dataset=normalizeReplayDataset(raw),evidence=evidenceFor(dataset,750),input=buildReplayAnalysisInput(dataset,evidence);
  assert.equal(dataset.bars.length,900);assert.equal(input.bars.length,600);
  assert.equal(input.bars[0].time,dataset.bars[151].time);
  assert.equal(input.bars.at(-1).closeTime,dataset.bars[750].closeTime);
  assert.equal(input.cutoff.excludedOlderBaseBars,151);
  assert.equal(input.cutoff.excludedFutureBaseBars,149);
  assert.ok(input.bars.every(bar=>bar.closeTime<=input.options.asOfTime));
  assert.ok(Object.values(input.options.higherTimeframes).every(series=>series.bars.length<=600&&series.bars.every(bar=>bar.closeTime<=input.options.asOfTime)));
  raw.bars=rows(10001,60000,end);assert.throws(()=>normalizeReplayDataset(raw),/HISTORICAL_BAR_LIMIT_1_TO_10000/);
});

test('read-only chart gate rejects the original multi-chart or Replay-off chart before creating any source observer',()=>{
  const f=replayReaderFixture({replay:false});const readGate=()=>JSON.parse(JSON.stringify(vm.runInContext('('+readReplayChartGate.toString()+')()',f.context)));
  assert.equal(readGate().ok,false);assert.equal(f.context.__arrowWindowFeedV2,undefined);f.replay.attrs['aria-pressed']='true';f.document.canvases.push(f.canvas,f.canvas);assert.equal(readGate().ok,false);assert.equal(f.context.__arrowWindowFeedV2,undefined);f.document.canvases=[f.canvas];assert.equal(readGate().ok,true);assert.equal(f.context.__arrowWindowFeedV2,undefined);
});

test('validated Replay witness is read-only, binds exact public fields and never creates a LIVE packet or passes the LIVE proof',()=>{
  const f=replayReaderFixture(),output=f.read(),witness=output.replayWitness;
  assert.equal(output.reasonCodes[0],'WINDOW_PRESESSION_CONTEXT_ONLY');assert.deepEqual(output.messages,[]);assert.equal(output.liveEligible,false);assert.equal(output.contextOnly,true);assert.equal(witness.kind,'TRADINGVIEW_REPLAY_WINDOW_WITNESS');assert.equal(witness.current.closed,true);assert.equal(witness.currentCloseTime,end);assert.equal(output.historicalContext.mode,'REPLAY');assert.ok(Number.isFinite(witness.sourceObservedEpochMs));assert.equal(witness.sourceDocumentTimeOrigin,f.context.performance.timeOrigin);
  for(const [key,value] of Object.entries(witness.fields))assert.equal(value,f.fieldNodes.get(key).textContent);
  const live=verifyLiveChart({metadata:witness.metadata,runId:witness.runId,realtime:false,sourceEmittedAt:witness.sourceEmittedAt,bars:[witness.current]},output,7);assert.equal(live.liveVerified,false);assert.ok(live.reasonCodes.includes('REPLAY_SOURCE'));
  const closed=replayReaderFixture({replay:false}).read();assert.equal(closed.replayWitness,undefined);assert.equal(closed.historicalContext,undefined);assert.equal(closed.liveEligible,false);assert.deepEqual(closed.messages,[]);
});

test('an offscreen Arrow header is a source-read failure after a valid chart gate, with bounded actionable diagnostics',()=>{
  const f=replayReaderFixture(),gate=JSON.parse(JSON.stringify(vm.runInContext('('+readReplayChartGate.toString()+')()',f.context)));
  assert.equal(gate.ok,true);assert.equal(gate.documentVisible,true);assert.deepEqual(gate.reasonCodes,[]);
  f.header.rect={top:-120,bottom:-100};const evidence=f.read();
  assert.equal(evidence.status,'UNAVAILABLE');assert.deepEqual(evidence.reasonCodes,['WINDOW_STUDY_NOT_VISIBLE']);assert.equal(evidence.chart.visibleCharts,1);assert.equal(evidence.chart.replay,true);
  let error;try{buildReplayAnalysisInput(normalizeReplayDataset(datasetFixture()),evidence);}catch(value){error=value;}
  assert.equal(error.message,'REPLAY_SOURCE_NOT_READY');
  const diagnosis=describeReplayReadDiagnostics({stage:'INPUT_VALIDATION',sourceTabId:17,gate,evidence,error});
  assert.equal(diagnosis.gate.ok,true);assert.equal(diagnosis.reader.chart.documentVisible,true);assert.deepEqual(diagnosis.reader.reasonCodes,['WINDOW_STUDY_NOT_VISIBLE']);assert.equal(diagnosis.reader.hasCoherentReplayWitness,false);assert.equal(diagnosis.liveEligible,false);assert.equal(diagnosis.orderEligible,false);
  f.header.rect={top:20,bottom:40};assert.ok(f.read().replayWitness,'showing the owned header restores the unchanged reader proof');
});

test('Replay diagnostics omit private/free-form page data and hidden documents fail the first gate without creating an observer',()=>{
  const secret='private account 123456789',diagnosis=describeReplayReadDiagnostics({stage:'SOURCE_READER',sourceTabId:17,gate:{ok:false,reasonCodes:['SOURCE_DOCUMENT_HIDDEN'],url:secret,title:secret},evidence:{status:'UNAVAILABLE',reasonCodes:['WINDOW_STUDY_NOT_VISIBLE',secret],raw:secret,account:secret,chart:{symbols:[metadata.instrument],interval:'1',visibleCharts:1,documentVisible:false,replay:true,title:secret}},error:new Error(secret)});
  assert.equal(JSON.stringify(diagnosis).includes(secret),false);assert.equal(diagnosis.errorCode,'REPLAY_OPERATION_FAILED');assert.deepEqual(diagnosis.reader.reasonCodes,['WINDOW_STUDY_NOT_VISIBLE']);
  const f=replayReaderFixture();f.document.hidden=true;const gate=JSON.parse(JSON.stringify(vm.runInContext('('+readReplayChartGate.toString()+')()',f.context)));
  assert.equal(gate.ok,false);assert.ok(gate.reasonCodes.includes('SOURCE_DOCUMENT_HIDDEN'));assert.equal(f.context.__arrowWindowFeedV2,undefined);
});

test('strict risk-mode historical selector uses complete engine technical evidence and retains every original risk guard',async()=>{
  // Deliberately synthetic full-engine reachability, not native market evidence.
  const f=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
  assert.equal(f.synthetic,true);assert.equal(f.neverUseInTradingView,true);
  const analysis=analyzeGuideSignals(f.bars,f.options),asOf=f.options.asOfTime,decision=selectReplayDecision(analysis,asOf);
  assert.equal(decision.status,'CONFIRMED');assert.equal(decision.technicalDecision.status,'CONFIRMED');assert.equal(decision.technicalDecision.direction,'LONG');
  assert.notEqual(selectReplayDecision(analysis,asOf+60000).status,'CONFIRMED');
  for(const mutate of [s=>{s.riskPlan.totalPlannedRisk=200.01;},s=>{s.contextSnapshot.checks.pop();},s=>{s.contextSnapshot.checks[0].available=false;},s=>{s.parameterSnapshot.config.requireTrendline=false;},s=>{s.parameterSnapshot.risk.maxContracts=2;}]){
    const changed={...analysis,signals:analysis.signals.map(signal=>structuredClone(signal))};mutate(changed.signals.find(signal=>signal.confirmationBarCloseTime===asOf));
    const rejected=selectReplayDecision(changed,asOf);assert.notEqual(rejected.status,'CONFIRMED');assert.equal(rejected.signal,null);
  }
  const noSource={...analysis};delete noSource.patterns;assert.notEqual(selectReplayDecision(noSource,asOf).status,'CONFIRMED');
});

test('technical LONG survives full-engine risk rejection without becoming an automatic execution approval',async()=>{
  const f=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
  Object.assign(f.bars.at(-1),{high:28345,close:28344});
  const analysis=analyzeGuideSignals(f.bars,f.options),decision=selectReplayDecision(analysis,f.options.asOfTime);
  const rejected=analysis.events.find(event=>event.signalIndex===427&&event.setupId==='TREND_CONTINUATION');
  assert.equal(rejected.status,'REJECTED');assert.ok(rejected.reasonCodes.includes('RISK_REJECTED'));assert.equal(rejected.riskPlan.perContractRisk,218.1);
  assert.equal(decision.technicalDecision.status,'CONFIRMED');assert.equal(decision.technicalDecision.direction,'LONG');
  assert.notEqual(decision.status,'CONFIRMED');assert.equal(decision.signal,null);assert.equal(decision.confirmedAtCurrentClose,0);assert.equal(decision.orderEligible,false);
  assert.ok(decision.technicalDecision.signal.setups.some(setup=>setup.riskDiagnostic.rejectedByRisk===true));
});

test('strict risk-mode selector vetoes an approved risk side when the technical event contract contains an opposing risk-rejected direction',async()=>{
  const f=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
  const analysis=analyzeGuideSignals(f.bars,f.options),asOf=f.options.asOfTime;
  assert.equal(selectReplayDecision(analysis,asOf).status,'CONFIRMED');
  // Adversarial merge contract only: an explicitly injected opposing record
  // verifies the selector veto. It is not a claim of engine or market approval.
  const source=analysis.events.find(event=>event.status==='CONFIRMED'&&event.confirmationBarCloseTime===asOf),opposite=structuredClone(source);
  opposite.eventId+=':OPPOSING_COMPONENT_CONTRACT';opposite.direction='SHORT';opposite.status='REJECTED';
  opposite.trigger=opposite.confirmationClose+.25;opposite.invalidation=opposite.confirmationClose+1;
  opposite.reasonCodes=['RISK_REJECTED','RISK_BUDGET_BELOW_ONE_CONTRACT'];
  opposite.riskPlan={...opposite.riskPlan,status:'BLOCKED',quantity:0,totalPlannedRisk:0,perContractRisk:218.1,reasonCodes:['RISK_BUDGET_BELOW_ONE_CONTRACT']};
  analysis.events.push(opposite);
  const decision=selectReplayDecision(analysis,asOf);
  assert.equal(analysis.signals.find(signal=>signal.confirmationBarCloseTime===asOf).riskPlan.status,'PLANNED');
  assert.equal(decision.technicalDecision.status,'AMBIGUOUS');assert.equal(decision.technicalDecision.direction,null);
  assert.notEqual(decision.status,'CONFIRMED');assert.equal(decision.signal,null);assert.equal(decision.confirmedAtCurrentClose,0);
});

test('genuine merged NQ data feeds the unchanged engine at the witnessed18:00UTC cutoff without revealing later candles',async()=>{
  const raw=JSON.parse(await readFile(new URL('../verification/nq-replay/native-NQ-merged-replay.json',import.meta.url),'utf8')),dataset=normalizeReplayDataset(raw),index=dataset.bars.findIndex(bar=>bar.closeTime===end),input=buildReplayAnalysisInput(dataset,evidenceFor(dataset,index)),analysis=analyzeGuideSignals(input.bars,input.options),decision=selectReplayDecision(analysis,end);
  assert.equal(dataset.bars.length,540);assert.equal(input.bars.length,300);assert.equal(input.cutoff.excludedFutureBaseBars,240);assert.ok(input.options.config.requireRisk&&input.options.config.requireTrendline&&input.options.config.requireHigherTimeframe);assert.equal(analysis.definitionVersion,GUIDE_SIGNAL_VERSION);assert.equal(decision.status,'NO_APPROVAL');assert.equal(decision.confirmedAtCurrentClose,0);assert.equal(decision.liveEligible,false);assert.equal(decision.orderEligible,false);
});

test('actual forming16:14Replay cursor analyzes only source-final16:13 and never reads the imported16:14 final candle',async()=>{
  const raw=JSON.parse(await readFile(new URL('../verification/nq-replay/native-NQ-merged-replay.json',import.meta.url),'utf8')),dataset=normalizeReplayDataset(raw),cursorTime=Date.UTC(2026,10,13,16,14),index=dataset.bars.findIndex(bar=>bar.time===cursorTime),evidence=evidenceFor(dataset,index);
  Object.assign(evidence.replayWitness.current,{closed:false,sourceClosed:false,high:evidence.replayWitness.current.open,low:evidence.replayWitness.current.open,close:evidence.replayWitness.current.open});
  const input=buildReplayAnalysisInput(dataset,evidence),analysis=analyzeGuideSignals(input.bars,input.options),decision=selectReplayDecision(analysis,cursorTime);
  assert.equal(input.options.asOfTime,cursorTime);assert.equal(input.cutoff.selectedClosedBarRole,'previous');assert.equal(input.cutoff.matchedClosedBarTime,cursorTime-60000);assert.equal(input.cutoff.observedCurrentTime,cursorTime);assert.equal(input.cutoff.observedCurrentProviderFinal,false);assert.equal(input.cutoff.openCurrentExcluded,true);assert.equal(input.bars.length,194);assert.equal(input.cutoff.excludedFutureBaseBars,346);assert.equal(input.bars.at(-1).closeTime,cursorTime);assert.ok(input.bars.every(bar=>bar.time<cursorTime&&bar.knownAt===bar.closeTime));assert.ok(Object.values(input.options.higherTimeframes).every(series=>series.bars.every(bar=>bar.closeTime<=cursorTime)));assert.ok(REPLAY_REQUIRED_FLAGS.every(key=>input.options.config[key]===true));assert.equal(decision.liveEligible,false);assert.equal(decision.orderEligible,false);
  const mismatched=structuredClone(evidence);mismatched.replayWitness.previous.close+=.25;assert.throws(()=>buildReplayAnalysisInput(dataset,mismatched),/IMPORTED_CLOSED_OHLC_MISMATCH/);
  const unverified=structuredClone(evidence);unverified.replayWitness.previous.sourceClosed=false;assert.throws(()=>buildReplayAnalysisInput(dataset,unverified),/SOURCE_CLOSED_BAR_REQUIRED/);
  const inconsistent=structuredClone(evidence);inconsistent.replayWitness.current.sourceClosed=true;assert.throws(()=>buildReplayAnalysisInput(dataset,inconsistent),/CURRENT_FINALITY_INVALID/);
  const gap=structuredClone(evidence);gap.replayWitness.previous.time-=60000;gap.replayWitness.previous.closeTime-=60000;assert.throws(()=>buildReplayAnalysisInput(dataset,gap),/PREVIOUS_BAR_NOT_CONTIGUOUS/);
});
