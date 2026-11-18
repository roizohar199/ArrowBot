import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveResearchUpgrades,RESEARCH_STORAGE_KEY} from '../live-research-upgrades.mjs';
import {createTradeComparison,RESEARCH_EXIT_VERSION} from '../research-trade-comparison.mjs';

// Artificial Paper records exercise controller lifecycle and scheduling, not
// broker fills, trading permission, a browser session or market profitability.
const minute=60000;
const metadata={tickSize:.25,pointValue:20,sourceId:'research-paper-source',instrument:'CME_MINI:NQ1!',timeframe:'1'};
const history=()=>[[99,100,98,99],[100,102,99,101],[102,106,101,103],[102,104,100,101],[101,103,99,100],[100,102,99,100]].map(([open,high,low,close],i)=>({time:i*minute,closeTime:(i+1)*minute,knownAt:(i+1)*minute,closed:true,open,high,low,close}));
function captureInput(orderId='entry-1'){
  return {metadata:structuredClone(metadata),bars:history(),signal:{eventId:'signal-'+orderId,direction:'LONG',confirmedAt:6*minute,confirmationBarCloseTime:6*minute,invalidation:94.75},
    fill:{fillVerified:true,latestClosedAt:6*minute,nativeFill:{kind:'NATIVE_EXECUTED_FILL_V1',provider:'TRADINGVIEW_PAPER',environment:'DEMO',synthetic:false,testOnly:false,nativeAccountId:'paper-account',nativeOrderId:orderId,price:100,filledAt:6*minute+1000,direction:'LONG',timestampPrecisionMs:1000,orderRow:{symbol:'CME_MINI:NQZ2026',qty:'1'}},
      nativePositionRow:{symbol:'CME_MINI:NQZ2026',qty:'1',avgPrice:'100',side:'Long',stopLoss:'98',takeProfit:'102'}}};
}
const record=id=>createTradeComparison(captureInput(id));
const analysisInput=(asOfTime=6*minute,patch={})=>({bars:history(),metadata:{...metadata,...patch},asOfTime});
const analysisResult=(job,comparisons=job.input.comparisons)=>({version:'research-upgrades-1',researchOnly:true,orderEligible:false,asOfTime:job.input.asOfTime,sourceId:job.input.metadata.sourceId,candles:{status:'OK',latest:[]},structure:{status:'OK',setups:[],events:[]},comparisons});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

class Node{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.textContent='';this.children=[];this.checked=false;this._value='';this.listeners=new Map();}
  set value(value){this._value=String(value);}get value(){return this._value;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  fire(type){for(const listener of this.listeners.get(type)??[])listener({type,target:this});}
  set innerHTML(_){throw Error('DOM HTML injection is not part of this UI');}
}
function harness({saved,load,readError,setError,workerConstructionError}={}){
  const ids=['research-upgrades','research-status','research-findings','research-comparison-summary','research-trades','research-enabled','research-commission','research-slippage','research-import','research-import-status'];
  const nodes=new Map(ids.map(id=>[id,new Node()])),workers=[],writes=[],reads=[];
  const document={getElementById:id=>nodes.get(id)??null,createElement:tag=>new Node(tag)};
  const storage={get:async key=>{reads.push(key);if(readError)throw Error('storage read unavailable');return load?load.promise:{[RESEARCH_STORAGE_KEY]:structuredClone(saved)};},set:value=>{writes.push(structuredClone(value));if(setError==='sync')throw Error('storage sync failure');return setError==='async'?Promise.reject(Error('storage async failure')):Promise.resolve();}};
  class WorkerMock{
    constructor(url,options){if(workerConstructionError)throw Error('worker unavailable');this.url=url;this.options=options;this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(job){this.messages.push(structuredClone(job));}
    reply(index,result,extra={}){const job=this.messages[index];assert.ok(job,'fixture must respond to a dispatched job');this.onmessage({data:{id:job.id,kind:job.kind,scope:job.scope,result,...extra}});}
    fail(){this.onerror({message:'fixture worker failed'});}
    terminate(){this.terminated=true;}
  }
  let executionCalls=0;
  const forbiddenExecution=()=>{executionCalls++;throw Error('research has no execution authority');};
  const controller=createLiveResearchUpgrades({document,storage,WorkerClass:WorkerMock,sendOrder:forbiddenExecution,setStop:forbiddenExecution,setTarget:forbiddenExecution});
  return {controller,worker:workers[0],workers,nodes,writes,reads,get executionCalls(){return executionCalls;}};
}
const savedState=(patch={})=>({version:1,enabled:true,costs:{commissionPerContract:null,slippageTicks:null},records:[],...patch});
const visibleText=node=>[node.textContent,...node.children.map(visibleText)].join(' ');

test('restores matching versioned records, preferences and cost inputs without replaying past fills',async t=>{
  const kept=record('saved'),wrong={...record('wrong'),version:'old-research-version'},notResearch={...record('not-research'),researchOnly:false};
  const h=harness({saved:savedState({enabled:false,costs:{commissionPerContract:3.1,slippageTicks:2},records:[kept,wrong,notResearch]})});t.after(()=>h.controller.dispose());
  await h.controller.ready;
  assert.deepEqual(h.reads,[RESEARCH_STORAGE_KEY]);assert.equal(h.nodes.get('research-enabled').checked,false);
  assert.equal(h.nodes.get('research-commission').value,'3.1');assert.equal(h.nodes.get('research-slippage').value,'2');
  const exported=h.controller.snapshot();assert.equal(exported.enabled,false);assert.deepEqual(exported.comparisons,[kept]);assert.equal(exported.summary.totalRecords,1);
  assert.equal(h.worker.messages.length,0,'restoring records must not manufacture fill or analysis jobs');
  kept.entry=1;assert.equal(h.controller.snapshot().comparisons[0].entry,100);
});

test('awaits asynchronous stored disabled preference before dispatch and disabling drops pending work',async t=>{
  const load=deferred(),h=harness({load});t.after(()=>h.controller.dispose());
  h.controller.observe(analysisInput());h.controller.capture(captureInput('before-load'));
  assert.equal(h.worker.messages.length,0,'no work should bypass preference hydration');
  load.resolve({[RESEARCH_STORAGE_KEY]:savedState({enabled:false})});await h.controller.ready;
  assert.equal(h.worker.messages.length,0);assert.equal(h.controller.snapshot().enabled,false);
  h.controller.observe(analysisInput(7*minute));h.controller.capture(captureInput('disabled'));
  assert.equal(h.worker.messages.length,0);assert.equal(h.executionCalls,0);
  const flag=h.nodes.get('research-enabled');flag.checked=true;flag.fire('change');
  assert.equal(h.worker.messages.length,1,'enabling may resume work that was staged before hydration');
  h.controller.observe(analysisInput(8*minute));h.controller.capture(captureInput('will-drop'));
  flag.checked=false;flag.fire('change');
  const inFlight=h.worker.messages[0];h.worker.reply(0,inFlight.kind==='fill'?record('before-load'):analysisResult(inFlight));
  assert.equal(h.worker.messages.length,1,'no queued scan or fill dispatched while feature disabled');
  assert.equal(h.controller.snapshot().entryVeto,false);assert.equal(h.executionCalls,0);
});

test('coalesces scans while preserving fills and refreshes pending comparison input after capture',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  h.controller.observe(analysisInput());h.controller.observe(analysisInput(7*minute));
  h.controller.capture(captureInput('first'));h.controller.observe(analysisInput(8*minute));
  assert.equal(h.worker.messages.length,1);
  h.worker.reply(0,analysisResult(h.worker.messages[0]));
  assert.equal(h.worker.messages[1].kind,'fill','capture has priority over the coalesced scan');
  h.worker.reply(1,record('first'));
  const scan=h.worker.messages[2];assert.equal(scan.kind,'analysis');assert.equal(scan.input.asOfTime,8*minute);
  assert.deepEqual(scan.input.comparisons.map(r=>r.id),[record('first').id],'the pending job must include the fill committed after it was staged');
  h.controller.capture(captureInput('second'));
  const progressed={...record('first'),lastBarCloseTime:8*minute};
  h.worker.reply(2,analysisResult(scan,[progressed]));assert.equal(h.worker.messages[3].kind,'fill');
  h.worker.reply(3,record('second'));
  assert.equal(h.controller.snapshot().comparisons.length,2);assert.equal(h.controller.snapshot().comparisons[0].lastBarCloseTime,8*minute);
  h.controller.capture(captureInput('first'));h.worker.reply(4,record('first'));
  assert.equal(h.controller.snapshot().comparisons.length,2,'the same native fill result is not appended twice');
});

test('captures immutable native fill and cost evidence, and future cost edits do not rewrite prior jobs',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  const cost=h.nodes.get('research-commission'),slip=h.nodes.get('research-slippage');cost.value='3.1';cost.fire('change');slip.value='2';slip.fire('change');
  const input=captureInput('costs');h.controller.capture(input);input.fill.nativeFill.price=999;input.signal.invalidation=999;input.bars[0].close=999;
  cost.value='7';cost.fire('change');slip.value='';slip.fire('change');
  const job=h.worker.messages[0];assert.equal(job.kind,'fill');assert.equal(job.input.fill.nativeFill.price,100);assert.equal(job.input.signal.invalidation,94.75);assert.equal(job.input.bars[0].close,99);
  assert.deepEqual(job.input.costs,{commissionPerContract:3.1,slippageTicks:2});
  h.worker.reply(0,createTradeComparison(job.input));
  assert.equal(h.controller.snapshot().comparisons[0].costs.commissionPerContract,3.1);
  assert.deepEqual(h.controller.snapshot().costs,{commissionPerContract:7,slippageTicks:null});
  cost.value='-1';cost.fire('change');assert.equal(h.controller.snapshot().costs.commissionPerContract,null,'invalid costs remain unknown rather than zero');
});

test('worker failure is isolated, visible, and cannot gain any execution API or queue orders',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  h.controller.observe(analysisInput());h.controller.capture(captureInput('queued'));h.worker.fail();
  assert.equal(h.worker.terminated,true);assert.match(h.controller.snapshot().error,/לא נטענו/);
  h.controller.observe(analysisInput(9*minute));h.controller.capture(captureInput('later'));
  assert.equal(h.worker.messages.length,1);assert.equal(h.executionCalls,0);
  for(const field of ['sendOrder','setStop','setTarget','arm','accept','execute'])assert.equal(Object.hasOwn(h.controller,field),false);
  const state=h.controller.snapshot();assert.equal(state.orderEligible,false);assert.equal(state.entryVeto,false);assert.equal(state.researchOnly,true);
  assert.equal(state.summary.actualUserPnlComputed,false);
});

test('job errors do not block the next job and obsolete source analysis does not repaint the current source',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  h.controller.observe(analysisInput());h.controller.observe(analysisInput(7*minute));
  h.worker.reply(0,null,{error:'research calculation unavailable'});
  assert.match(h.controller.snapshot().error,/calculation unavailable/);assert.equal(h.worker.messages.length,2);
  h.worker.reply(1,analysisResult(h.worker.messages[1]));
  assert.equal(h.controller.snapshot().latest.sourceId,metadata.sourceId);assert.equal(h.controller.snapshot().error,null);
  h.controller.observe(analysisInput(8*minute,{sourceId:'source-B'}));h.controller.observe(analysisInput(9*minute,{sourceId:'source-C'}));
  h.worker.reply(2,analysisResult(h.worker.messages[2]));assert.equal(h.controller.snapshot().latest.sourceId,metadata.sourceId,'obsolete B result must not be presented as source C');
  h.worker.reply(3,analysisResult(h.worker.messages[3]));assert.equal(h.controller.snapshot().latest.sourceId,'source-C');
});

test('snapshot is a detached export and the UI labels both simulated policies without counting uncertainty as a win',async t=>{
  const done=record('resolved'),uncertain=record('ambiguous');
  done.stochasticAtConfirmation={latest:{k:37.93,d:40.25,zone:'MID',cross:'DOWN'}};
  done.baseline.outcome={status:'TARGET_REACHED',grossPnl:40,netPnl:36.9};done.structural.outcome={status:'STOP_REACHED',grossPnl:-105,netPnl:-108.1};
  uncertain.baseline.outcome={status:'AMBIGUOUS'};uncertain.structural.outcome={status:'TARGET_REACHED',grossPnl:115,netPnl:null};
  const h=harness({saved:savedState({records:[done,uncertain]})});t.after(()=>h.controller.dispose());await h.controller.ready;
  h.controller.observe(analysisInput());const result=analysisResult(h.worker.messages[0]);result.candles.latest=[{label:'מרובוזו שורי'}];
  result.stochastic={latest:{k:14,d:12,zone:'LOW',cross:'UP'}};h.worker.reply(0,result);
  const exported=h.controller.snapshot();assert.equal(exported.summary.pairedResolved,1);assert.equal(exported.summary.excluded,1);assert.equal(exported.summary.baseline.netPnl,36.9);assert.equal(exported.summary.structural.netPnl,-108.1);
  assert.match(visibleText(h.nodes.get('research-trades')),/ניהול קיים/);assert.match(visibleText(h.nodes.get('research-trades')),/הצעה מבנית/);assert.match(visibleText(h.nodes.get('research-trades')),/סדר הנגיעות אינו ידוע/);
  assert.match(visibleText(h.nodes.get('research-findings')),/מרובוזו שורי/);assert.match(h.nodes.get('research-comparison-summary').textContent,/רווח מדומה/);
  assert.match(visibleText(h.nodes.get('research-findings')),/%K 14 · %D 12 · אזור נמוך · חצייה מעלה/);
  assert.match(visibleText(h.nodes.get('research-trades')),/%K 37\.93 · %D 40\.25 · אמצע הטווח · חצייה מטה/);
  exported.comparisons[0].baseline.plan.stop=0;exported.latest.candles.latest[0].label='changed';exported.costs.slippageTicks=900;
  const again=h.controller.snapshot();assert.equal(again.comparisons[0].baseline.plan.stop,98);assert.equal(again.latest.candles.latest[0].label,'מרובוזו שורי');assert.equal(again.costs.slippageTicks,null);
});

test('dispose immediately persists pending updates with bounded evidence and prevents later work',async()=>{
  const rows=Array.from({length:105},(_,i)=>({...record('row-'+i),observedBars:Array.from({length:20},(_,j)=>({time:j*minute}))}));
  const h=harness({saved:savedState({records:rows})});await h.controller.ready;
  assert.equal(h.controller.snapshot().comparisons.length,100);
  const flag=h.nodes.get('research-enabled');flag.checked=false;flag.fire('change');
  h.controller.dispose();assert.equal(h.worker.terminated,true);assert.equal(h.writes.length,1,'flush pending save before the debounce fires');
  const saved=h.writes[0][RESEARCH_STORAGE_KEY];assert.equal(saved.enabled,false);assert.equal(saved.records.length,100);assert.ok(saved.records.every(r=>r.observedBars.length===8));assert.equal(saved.records[0].version,RESEARCH_EXIT_VERSION);
  h.controller.observe(analysisInput());h.controller.capture(captureInput('after-dispose'));assert.equal(h.worker.messages.length,0);
});

test('closing before asynchronous hydration preserves prior storage and never flushes empty defaults',async()=>{
  const load=deferred(),prior=savedState({enabled:false,costs:{commissionPerContract:3.1,slippageTicks:2},records:[record('previous-session')]}),before=structuredClone(prior);
  const h=harness({load});
  h.controller.observe(analysisInput());h.controller.capture(captureInput('queued-before-close'));
  h.controller.dispose();
  assert.equal(h.worker.terminated,true);assert.equal(h.worker.messages.length,0);
  assert.equal(h.writes.length,0,'dispose cannot overwrite a stored journal it has not read yet');
  load.resolve({[RESEARCH_STORAGE_KEY]:prior});await h.controller.ready;
  assert.equal(h.writes.length,0,'late hydration cannot flush defaults or revive a closed controller');
  assert.deepEqual(prior,before,'loading the old session must not mutate its stored evidence');
  h.controller.observe(analysisInput(9*minute));h.controller.capture(captureInput('after-close'));
  assert.equal(h.worker.messages.length,0,'a deferred ready continuation cannot submit work after termination');
});

test('storage errors, malformed saved arrays and absent worker remain research diagnostics',async t=>{
  for(const setError of ['sync','async'])await t.test(setError+' storage failure',async t=>{
    const h=harness({setError});t.after(()=>h.controller.dispose());await h.controller.ready;
    h.nodes.get('research-commission').value='1';h.nodes.get('research-commission').fire('change');await pause(180);
    assert.match(h.controller.snapshot().error,/לא ניתן לשמור/);assert.equal(h.executionCalls,0);
    assert.doesNotThrow(()=>h.controller.observe(analysisInput()));assert.equal(h.worker.messages.length,1);
  });
  const broken=harness({readError:true});t.after(()=>broken.controller.dispose());await broken.controller.ready;assert.match(broken.controller.snapshot().error,/לא ניתן לקרוא/);assert.equal(broken.controller.snapshot().comparisons.length,0);
  broken.controller.dispose();assert.equal(broken.writes.length,0,'a failed storage read cannot authorize overwriting the unread prior journal');
  const malformed=harness({saved:savedState({records:{bad:'not an array'}})});t.after(()=>malformed.controller.dispose());await malformed.controller.ready;assert.equal(malformed.controller.snapshot().comparisons.length,0);
  const noWorker=harness({workerConstructionError:true});t.after(()=>noWorker.controller.dispose());await noWorker.controller.ready;assert.match(noWorker.controller.snapshot().error,/עובד רקע/);assert.doesNotThrow(()=>noWorker.controller.observe(analysisInput()));assert.equal(noWorker.executionCalls,0);
});

function originalRecording(orderId='imported-entry'){
  const input=captureInput(orderId);input.fill.direction='LONG';
  Object.assign(input.signal,{status:'CONFIRMED',instrument:metadata.instrument,timeframe:metadata.timeframe});
  return {schemaVersion:1,kind:'LIVE_OHLC_OBSERVATION',exportedAt:new Date(8*minute).toISOString(),selectedRun:metadata.sourceId,selectedTabId:19,
    observationSession:{sessionId:'original-observation'},analysisInputs:{bars:input.bars,options:{metadata:input.metadata,asOfTime:8*minute}},
    paperUserExecution:{lastVerifiedFill:input.fill},alerts:[{runId:metadata.sourceId,sourceTabId:19,sessionId:'original-observation',signal:input.signal}],
    account:{review:{profile:{commissionPerContract:999,slippageTicks:999}}}};
}
const importedRecord=job=>({...createTradeComparison(job.input),createdFrom:'IMPORTED_PAPER_EXPORT',importProvenance:structuredClone(job.input.provenance)});

test('explicit original Arrow import computes a historical Paper row without overwriting live scope or guessing costs',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  h.controller.observe(analysisInput(9*minute,{sourceId:'live-current'}));h.worker.reply(0,analysisResult(h.worker.messages[0]));
  const source=originalRecording(),before=structuredClone(source),promise=h.controller.importRecording(source,{filename:'C:\\history\\original-arrow.json'});
  await pause(0);
  const job=h.worker.messages[1];assert.equal(job.kind,'import');assert.equal(job.input.metadata.sourceId,metadata.sourceId);assert.equal(job.input.asOfTime,8*minute);
  assert.deepEqual(job.input.costs,{commissionPerContract:null,slippageTicks:null},'old profile costs are not silently treated as current assumptions');
  assert.equal(job.input.provenance.filename,'original-arrow.json');assert.equal(job.input.provenance.kind,'IMPORTED_ARROW_PAPER_EXPORT');
  assert.equal(job.input.fill.nativeFill.nativeOrderId,'imported-entry');
  source.paperUserExecution.lastVerifiedFill.nativeFill.price=999;
  assert.equal(job.input.fill.nativeFill.price,100,'worker receives a frozen original evidence copy');
  h.worker.reply(1,importedRecord(job));const result=await promise;
  assert.equal(result.ok,true);assert.equal(result.duplicate,false);assert.equal(h.controller.snapshot().comparisons.length,1);
  assert.equal(h.controller.snapshot().latest.sourceId,'live-current','old imported history cannot replace healthy live diagnostics');
  assert.match(visibleText(h.nodes.get('research-trades')),/תיעוד עבר מיובא/);assert.match(visibleText(h.nodes.get('research-trades')),/original-arrow.json/);
  assert.match(h.nodes.get('research-import-status').textContent,/נטען תיעוד עבר/);assert.equal(h.executionCalls,0);
  const second=await h.controller.importRecording(before,{filename:'same-entry-again.json'});assert.equal(second.duplicate,true);assert.equal(h.worker.messages.length,2);
  assert.equal(h.controller.snapshot().comparisons[0].importProvenance.filename,'original-arrow.json','duplicate import preserves the first frozen evidence');
});

test('historical import rejects wrong kind, simulated fills and mismatched original source, direction, session and time',async t=>{
  const mutations=[
    r=>{r.kind='CAPTURED_DATA_RESEARCH_DIAGNOSTIC';},
    r=>{r.analysisInputs.bars=[];},
    r=>{r.selectedRun='other-run';},
    r=>{r.paperUserExecution.lastVerifiedFill.fillVerified=false;},
    r=>{r.paperUserExecution.lastVerifiedFill.nativeFill.synthetic=true;},
    r=>{r.paperUserExecution.lastVerifiedFill.nativeFill.provider='TRADOVATE';},
    r=>{r.paperUserExecution.lastVerifiedFill.nativeFill.filledAt=10*minute;},
    r=>{r.alerts[0].runId='other-run';},
    r=>{r.alerts[0].sourceTabId=20;},
    r=>{r.alerts[0].sessionId='other-session';},
    r=>{r.alerts[0].signal.instrument='CME_MINI:MNQ1!';},
    r=>{r.alerts[0].signal.direction='SHORT';},
    r=>{r.alerts[0].signal.confirmationBarCloseTime=5*minute;},
    r=>{r.alerts[0].signal.confirmedAt=9*minute;},
  ];
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  for(const mutate of mutations){const original=originalRecording();mutate(original);const result=await h.controller.importRecording(original,{filename:'invalid.json'});assert.equal(result.ok,false);}
  assert.equal(h.worker.messages.length,0);assert.equal(h.controller.snapshot().comparisons.length,0);assert.equal(h.executionCalls,0);
});

test('import freezes explicit current costs and safely resolves worker errors, feature disable and disposal',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;
  h.nodes.get('research-commission').value='3.1';h.nodes.get('research-commission').fire('change');h.nodes.get('research-slippage').value='2';h.nodes.get('research-slippage').fire('change');
  const pending=h.controller.importRecording(originalRecording('failed-import'),{filename:'failure.json'});await pause(0);
  assert.deepEqual(h.worker.messages[0].input.costs,{commissionPerContract:3.1,slippageTicks:2});
  h.worker.reply(0,null,{error:'invalid source bars'});assert.equal((await pending).ok,false);assert.match(h.nodes.get('research-import-status').textContent,/invalid source bars/);
  h.controller.observe(analysisInput());const queued=h.controller.importRecording(originalRecording('cancelled-import'));await pause(0);
  h.nodes.get('research-enabled').checked=false;h.nodes.get('research-enabled').fire('change');assert.equal((await queued).ok,false);
  assert.equal((await h.controller.importRecording(originalRecording('disabled'))).ok,false);
  h.nodes.get('research-enabled').checked=true;h.nodes.get('research-enabled').fire('change');
  const disposed=h.controller.importRecording(originalRecording('disposed'));await pause(0);h.controller.dispose();assert.equal((await disposed).ok,false);assert.equal(h.executionCalls,0);
});

test('optional file input rejects oversize or malformed JSON before any worker import job',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.ready;const field=h.nodes.get('research-import');
  field.files=[{size:81*1024*1024,name:'large.json',text(){throw Error('must not read oversized file');}}];field.value='large.json';field.fire('change');await pause(0);
  assert.match(h.nodes.get('research-import-status').textContent,/80MB/);assert.equal(field.value,'');assert.equal(h.worker.messages.length,0);
  field.files=[{size:12,name:'broken.json',async text(){return '{not JSON';}}];field.fire('change');await pause(0);assert.match(h.nodes.get('research-import-status').textContent,/לא ניתן לטעון/);assert.equal(h.worker.messages.length,0);
});
