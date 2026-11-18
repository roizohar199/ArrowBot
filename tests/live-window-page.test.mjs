import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LIVE_RULE_SETTINGS_KEY} from '../live-ohlc-settings.mjs';

const html=await readFile(new URL('../live-ohlc.html',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Node{
  constructor(id='',doc){Object.assign(this,{id,doc,ownerDocument:doc,value:'',textContent:'',disabled:false,hidden:false,checked:false,open:false,dataset:{},children:[],listeners:new Map()});}
  addEventListener(name,callback){const list=this.listeners.get(name)??[];list.push(callback);this.listeners.set(name,list);}
  removeEventListener(name,callback){this.listeners.set(name,(this.listeners.get(name)??[]).filter(item=>item!==callback));}
  async emit(name,extra={}){const event={type:name,target:this,preventDefault(){this.defaultPrevented=true;},...extra};for(const callback of this.listeners.get(name)??[])await callback(event);return event;}
  append(...nodes){this.children.push(...nodes);}after(node){this.doc.created.push(node);}replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this[name]=String(value);}removeAttribute(name){delete this[name];}focus(){this.doc.activeElement=this;}scrollIntoView(){}remove(){}
  showModal(){this.open=true;}close(){this.open=false;void this.emit('close');}
  getBoundingClientRect(){return {top:0,left:0,right:300,bottom:300,width:300,height:300};}
  click(){if(!this.disabled)return this.emit('click');}
}
const metadata={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
const chart={symbols:[metadata.instrument],interval:'1',replay:false,marketOpen:true,realtime:true,visibleCharts:1,documentVisible:true};
const runId='CME_MINI:NQ1!|1|window-page-test';
const makeBar=(time,closed,close=20000.5)=>({time,closeTime:time+60000,open:20000,high:20002,low:19999,close,volume:100,closed,sourceClosed:closed});
function message(kind,rawSequence,bars,sourceAt=Date.now()){
  const slot=kind==='snapshot'?1:4;
  return 'ARROW_OHLC_V1 '+JSON.stringify({schemaVersion:1,kind,runId,sequence:rawSequence*8+slot,sourceEmittedAt:sourceAt,realtime:true,dataDelayUnverified:true,metadata,bars,reasonCodes:[]});
}
function preview({offset=0,realtime=true,status='WAITING'}={}){
  const sourceAt=Date.now()+offset,time=Math.floor(sourceAt/60000)*60000;
  return {status,reasonCodes:['WINDOW_COHERENCE_PRIMING'],messages:[],chart,bootstrapMetadata:{runId,metadata},windowFrame:{sequence:10,sourceEmittedAt:sourceAt,realtime,coherent:true,checksumsVerified:true,current:makeBar(time,false)},history:[]};
}

// Run the real root page module and its real account/store/trace code. Only the
// external Chrome read and browser DOM/timer surfaces are replaced.
async function pageFixture(readers,{pineLogEvidence,tabs=[{id:17,title:'NQ chart',url:'https://www.tradingview.com/chart/test/'}],selectTabId=17}={}){
  const doc={nodes:new Map(),created:[],hidden:false,visibilityState:'visible',activeElement:null,getElementById(id){return this.nodes.get(id);},createElement(tag){const node=new Node('',this);node.tagName=tag.toUpperCase();return node;},createElementNS(_namespace,tag){return this.createElement(tag);}};
  for(const id of ids)doc.nodes.set(id,new Node(id,doc));doc.body=new Node('body',doc);const $=id=>doc.getElementById(id);
  for(const [id,value] of Object.entries({'risk-budget':'200','point-value':'20','max-contracts':'1','reward-risk':'2','account-mode':'PAPER','account-currency':'USD','account-instrument':metadata.instrument,'account-tick-size':'.25','live-transport':'window'}))$(id).value=value;
  $('require-risk').checked=true;$('require-location').checked=true;$('account-form-error').hidden=true;$('stop-live').disabled=true;$('export-live').disabled=true;
  const data={[LIVE_RULE_SETTINGS_KEY]:{schemaVersion:1,fields:{'risk-budget':'200','point-value':'20',commission:'0',slippage:'0','max-contracts':'1','reward-risk':'2'},checks:{'require-risk':true,'require-location':true,'require-ema':false,'require-fib':false},savedAt:1}};
  const storage={async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}};
  const events=new Map(),timers=new Map(),exports=[],windowReads=[],pineLogReads=[],overlayCommands=[];let timerSerial=0,readIndex=0;
  const win={innerWidth:400,innerHeight:900,scrollTo(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(name,callback){events.set(name,callback);}};
  const chrome={storage:{local:storage},tabs:{async query(){return structuredClone(tabs);}},scripting:{async executeScript(command){
    if(command.func.name==='sourceDomTimingCommand')return [{result:{status:'OK'}}];
    if(command.func.name==='prepareTradingViewWindowUi')return [{result:{status:'READY'}}];
    if(command.func.name==='chartSignalOverlayCommand'){overlayCommands.push(structuredClone(command.args?.[0]??{}));return [{result:{status:'CLEARED'}}];}
    if(command.args?.[0]?.stop)return [{result:{status:'STOPPED'}}];
    if(command.func.name==='readPineLogsEvidence'){pineLogReads.push({tabId:command.target.tabId,args:structuredClone(command.args?.[0]??{})});return [{result:typeof pineLogEvidence==='function'?await pineLogEvidence(command):structuredClone(pineLogEvidence)}];}
    assert.equal(command.func.name,'readTradingViewWindowEvidence');windowReads.push({tabId:command.target.tabId,args:structuredClone(command.args?.[0]??{})});
    const reader=readers[readIndex++];return [{result:reader?await reader():{status:'OK',reasonCodes:['NO_FRESH_SOURCE_PACKET'],messages:[],chart}}];
  }}};
  const before={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome,Option:globalThis.Option,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  const Option=class extends Node{constructor(text='',value=''){super('',doc);this.textContent=text;this.value=String(value);}};
  Object.assign(globalThis,{document:doc,window:win,chrome,Option,setTimeout:(callback,delay)=>{const id=++timerSerial;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});
  URL.createObjectURL=blob=>{exports.push(blob);return 'blob:window-test';};URL.revokeObjectURL=()=>{};
  await import('../live-ohlc.mjs?window-page-test='+Math.random());await flush();if(selectTabId!==null)$('live-tab').value=String(selectTabId);
  async function settle(){await flush();await flush();await flush();}
  return {doc,$,windowReads,pineLogReads,overlayCommands,readCount:()=>readIndex,evidence:()=>JSON.parse($('live-evidence').textContent),async prepareHistory(){await $('prepare-window-history').emit('click');await settle();},async start(){
    const beforeReads=readIndex;
    await $('connect-live').emit('click');await settle();assert.equal($('account-dialog').open,true);
    $('commission').value='0';await $('commission').emit('input');$('slippage').value='0';await $('slippage').emit('input');$('account-costs-reviewed').checked=true;await $('account-costs-reviewed').emit('change');await $('account-form').emit('submit');await settle();assert.equal(readIndex,beforeReads+1);
  },async nextPoll(){const entry=[...timers].find(([,timer])=>timer.delay===50);assert.ok(entry,'root schedules next source poll');timers.delete(entry[0]);entry[1].callback();await settle();},async exported(){await $('export-live').emit('click');assert.ok(exports.length,'root exports its actual observation state');return JSON.parse(await exports.at(-1).text());},async cleanup(){
    events.get('pagehide')?.();await settle();timers.clear();
    URL.createObjectURL=before.createObjectURL;URL.revokeObjectURL=before.revokeObjectURL;
    for(const key of ['document','window','chrome','Option','setTimeout','clearTimeout'])if(before[key]===undefined)delete globalThis[key];else globalThis[key]=before[key];await flush();
  }};
}

test('reload defaults to the unique research chart when no supported FULL SCREENS URL is open, and preserves an existing manual selection',async()=>{
  const tabs=[{id:17,title:'NQ1! Full Screens Live',url:'https://www.tradingview.com/chart/personal-layout/'},{id:42,title:'NQ1! Arrow OHLC Live Verification',url:'https://www.tradingview.com/chart/research-layout/'}];
  const f=await pageFixture([()=>preview()],{tabs,selectTabId:null});
  try{
    assert.equal(f.$('live-tab').value,'42','initial default selects the unique research chart without changing either layout');
    assert.equal(f.readCount(),0,'default selection does not start a chart read or trade');
    f.$('live-tab').value='17';await f.$('refresh-tabs').emit('click');await flush();await flush();
    assert.equal(f.$('live-tab').value,'17','an existing explicit choice is preserved');assert.equal(f.readCount(),0);
    f.$('live-tab').value='42';await f.start();assert.equal(f.windowReads[0].tabId,42);assert.equal(f.windowReads.some(read=>read.tabId===17),false);
  }finally{await f.cleanup();}
});

test('the original FULL SCREENS tab is the initial default and choosing research explicitly is preserved without reading either chart',async()=>{
  const tabs=[{id:17,title:'NQ1! Full Screens Live',url:'https://www.tradingview.com/chart/ARROWFR1/'},{id:42,title:'NQ1! Arrow OHLC Live Verification',url:'https://www.tradingview.com/chart/ARROWRV1/'}];
  const f=await pageFixture([()=>preview()],{tabs,selectTabId:null});
  try{assert.equal(f.$('live-tab').value,'17');assert.equal(f.readCount(),0);f.$('live-tab').value='42';await f.$('refresh-tabs').emit('click');await flush();await flush();assert.equal(f.$('live-tab').value,'42');assert.equal(f.readCount(),0);}finally{await f.cleanup();}
});

test('root Window warmup rejects stale/future/nonrealtime cursor previews while fresh preview stays nonactionable',async()=>{
  const f=await pageFixture([()=>preview({offset:-60000}),()=>preview({offset:60000}),()=>preview({realtime:false}),()=>preview({status:'OK'})]);
  try{
    await f.start();assert.equal(f.$('live-close').textContent,'—');assert.equal(f.evidence().store.liveEligible,false);assert.match(f.$('source-proof').textContent,/חותמת המקור רחוקה/);
    await f.nextPoll();assert.equal(f.$('live-close').textContent,'—');assert.equal(f.evidence().store.liveEligible,false);assert.match(f.$('source-proof').textContent,/חותמת המקור רחוקה/);
    await f.nextPoll();assert.equal(f.$('live-close').textContent,'—');assert.equal(f.evidence().store.liveEligible,false);assert.match(f.$('source-proof').textContent,/נתוני זמן אמת טרם אומתו/);
    await f.nextPoll();assert.notEqual(f.$('live-close').textContent,'—');assert.equal(f.evidence().store.ready,false);assert.equal(f.evidence().store.liveEligible,false);assert.equal(f.evidence().analysis,null);
  }finally{await f.cleanup();}
});

test('root Window trace recovers each packet raw sequence, ignores bootstrap gaps and counts only actual missing frames',async()=>{
  const openedAt=Math.floor(Date.now()/60000)*60000,closed=Array.from({length:3},(_,index)=>makeBar(openedAt-(3-index)*60000,true));
  const frame=(rawSequence,close,headerSequence)=>()=>({status:'OK',reasonCodes:[],chart,messages:[message('update',rawSequence,[closed.at(-1),makeBar(openedAt,false,close)])],windowFrame:{sequence:headerSequence,sourceEmittedAt:Date.now(),realtime:true,current:makeBar(openedAt,false,close)}});
  const f=await pageFixture([
    ()=>({status:'OK',reasonCodes:[],chart,messages:[message('snapshot',100,closed)],windowFrame:{sequence:800,realtime:true}}),
    frame(500,20000.5,900),frame(501,20000.75,950),frame(503,20001,999),
  ]);
  try{
    await f.start();let exported=await f.exported();assert.equal(exported.intrabar.runId,null);assert.equal(exported.intrabar.missingSequences,0);
    await f.nextPoll();exported=await f.exported();assert.equal(exported.intrabar.latest.sequence,500);assert.equal(exported.intrabar.missingSequences,0);
    await f.nextPoll();exported=await f.exported();assert.equal(exported.intrabar.latest.sequence,501);assert.equal(exported.intrabar.missingSequences,0);
    await f.nextPoll();exported=await f.exported();assert.deepEqual(exported.intrabar.points.map(point=>point.sequence),[500,501,503]);assert.equal(exported.intrabar.missingSequences,1);assert.equal(exported.intrabar.completeTickHistory,false);
  }finally{await f.cleanup();}
});

function preopenFixture(){
  const sourceAt=Date.now(),runEpoch=sourceAt-1000,end=Math.floor(sourceAt/3600000)*3600000-86400000,sourceRun=metadata.instrument+'|1|'+runEpoch;
  const sourceChart={...chart,marketOpen:false,realtime:false};
  const bars=duration=>Array.from({length:20},(_,index)=>({...makeBar(end-(20-index)*duration,true),closeTime:end-(19-index)*duration,providerBarIndex:index+1,sessionFirst:false,sessionLast:index===19}));
  const header={schemaVersion:1,runId:sourceRun,sourceEmittedAt:sourceAt,realtime:false,dataDelayUnverified:true,bootstrapOnly:true,reasonCodes:[]};
  const messages=[{...header,kind:'snapshot',sequence:1,metadata:{...metadata,sessionGaps:[]},bars:bars(60000)},...['5','15'].map((timeframe,index)=>({...header,kind:'timeframe_snapshot',sequence:index+2,metadata,bars:[],higherTimeframes:[{timeframe,timeframeMs:Number(timeframe)*60000,bars:bars(Number(timeframe)*60000),sessionGaps:[],reasonCodes:[]}]}))].map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet));
  const evidence={status:'WAITING',reasonCodes:['WINDOW_PRESESSION_CONTEXT_ONLY'],contextOnly:true,contextReady:true,liveEligible:false,messages:[],chart:sourceChart,bootstrapMetadata:{runId:sourceRun,runEpoch,metadata},windowFrame:{sequence:1,runEpoch,sourceEmittedAt:sourceAt,realtime:false,coherent:true,checksumsVerified:true}};
  return {runEpoch,messages,evidence,pineLogEvidence:{status:'OK',messages,chart:sourceChart}};
}

test('explicit pre-open preparation passes bounded closed history to Window exactly once per connection without creating live approval or latency',async()=>{
  const source=preopenFixture(),f=await pageFixture([()=>source.evidence,()=>source.evidence,()=>source.evidence],source);
  try{
    await f.prepareHistory();let out=await f.exported();
    assert.equal(f.pineLogReads.length,1);assert.equal(f.pineLogReads[0].tabId,17);assert.deepEqual(f.pineLogReads[0].args,{followLatest:true});assert.equal(f.readCount(),0,'history preparation does not start live polling');
    assert.equal(out.preopenContext.status,'CONTEXT_READY');assert.deepEqual(out.preopenContext.series.map(series=>[series.timeframe,series.bars]),[['1',20],['5',20],['15',20]]);assert.equal(out.preopenContext.contextOnly,true);assert.equal(out.preopenContext.liveEligible,false);assert.equal(out.preopenContext.ordersAuthorized,false);assert.equal(out.preopenContext.seedSent,false);assert.match(f.$('preopen-history-status').textContent,/CONTEXT_READY.*הקשר בלבד/);
    assert.equal(out.active,false);assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.rawEvidence.length,0);assert.equal(out.latestAnalysis,null);assert.equal(out.latency.samples.length,0);assert.equal(out.sourceDomLatency.samples.length,0);
    await f.start();out=await f.exported();
    const seed=f.windowReads[0].args;assert.equal(seed.bootstrap.runEpoch,source.runEpoch);assert.equal(seed.bootstrapHistory.baseBars.length,20);assert.deepEqual(seed.bootstrapHistory.higherTimeframes.map(series=>[series.timeframe,series.bars.length]),[['5',20],['15',20]]);assert.equal(seed.bootstrapHistory.baseBars[0].providerBarIndex,1);assert.equal(seed.bootstrapHistory.baseBars.at(-1).sessionLast,true);assert.equal(out.preopenContext.seedSent,true);
    await f.nextPoll();assert.equal(f.windowReads[1].args.bootstrap,undefined);assert.equal(f.windowReads[1].args.bootstrapHistory,undefined);assert.equal(f.pineLogReads.length,1,'ordinary Window polling never polls price Logs');
    out=await f.exported();assert.equal(out.store.liveEligible,false);assert.equal(out.store.ready,false,'prepared context is not silently inserted into the live store');assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.latestAnalysis,null);assert.equal(out.latency.samples.length,0);assert.equal(out.sourceDomLatency.samples.length,0);assert.equal(out.orderEligible,false);assert.equal(f.overlayCommands.filter(command=>command.action==='show').length,0);
    await f.$('stop-live').emit('click');await f.start();assert.equal(f.windowReads[2].args.bootstrap.runEpoch,source.runEpoch,'same reviewed source may seed a new connection once');assert.notEqual(f.windowReads[2].args.sessionId,seed.sessionId);assert.equal(f.pineLogReads.length,1);
  }finally{await f.cleanup();}
});

test('a source run change or closed-bar correction invalidates prepared context and later reads cannot reseed it',async()=>{
  for(const change of ['RUN_CHANGED','CLOSED_BAR_CORRECTION']){
    const source=preopenFixture(),invalid=change==='RUN_CHANGED'?{...source.evidence,windowFrame:{...source.evidence.windowFrame,runEpoch:source.runEpoch+1}}:{...source.evidence,reasonCodes:['WINDOW_CLOSED_BAR_CORRECTION'],resetRequired:true};
    const f=await pageFixture([()=>source.evidence,()=>invalid,()=>source.evidence],source);
    try{
      await f.prepareHistory();await f.start();assert.ok(f.windowReads[0].args.bootstrapHistory);
      await f.nextPoll();let out=await f.exported();assert.equal(out.preopenContext.status,'NOT_PREPARED',change);assert.equal(out.preopenContext.bootstrapHistory,undefined);assert.match(out.preopenContext.reason,/BOOTSTRAP_SOURCE_(RUN_CHANGED|INVALIDATED)/);assert.doesNotMatch(f.$('preopen-history-status').textContent,/CONTEXT_READY/);
      await f.nextPoll();assert.equal(f.windowReads[2].args.bootstrap,undefined);assert.equal(f.windowReads[2].args.bootstrapHistory,undefined);out=await f.exported();assert.equal(out.preopenContext.status,'NOT_PREPARED');assert.equal(out.store.liveEligible,false);assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.latency.samples.length,0);
    }finally{await f.cleanup();}
  }
});

const pairedTabs=[{id:17,title:'NQ research chart',url:'https://www.tradingview.com/chart/test/'},{id:18,title:'Arrow research Pine Editor',url:'https://www.tradingview.com/pine/'},{id:19,title:'Other detached Pine Editor',url:'https://www.tradingview.com/pine/'}];
const detachedLogs=source=>({status:'OK',messages:source.messages,chart:null,bootstrapLogsOnly:true,editorLinked:true,contextOnly:true,liveEligible:false});

test('paired detached Logs use an independently verified chart and seed only that selected chart once',async()=>{
  const source=preopenFixture(),f=await pageFixture([()=>source.evidence,()=>source.evidence],{tabs:pairedTabs,pineLogEvidence:command=>command.target.tabId===18?detachedLogs(source):{status:'OK',messages:[],chart:source.evidence.chart}});
  try{
    assert.deepEqual(f.$('live-tab').children.map(option=>option.value),['17'],'detached editors cannot become the live chart');
    assert.ok(f.$('bootstrap-log-tab').children.some(option=>option.value==='18'),'detached helper is offered separately');
    f.$('bootstrap-log-tab').value='18';await f.prepareHistory();let out=await f.exported();
    assert.equal(out.preopenContext.status,'CONTEXT_READY');assert.equal(out.preopenContext.tabId,17);assert.equal(out.preopenContext.liveEligible,false);assert.equal(f.readCount(),0);
    assert.deepEqual({...out.preopenContext.readSource,observedAt:0},{chartTabId:17,logTabId:18,detachedEditor:true,editorLinked:true,observedAt:0,contextOnly:true});assert.ok(Number.isFinite(out.preopenContext.readSource.observedAt));
    assert.deepEqual(f.pineLogReads.map(read=>[read.tabId,read.args]),[[18,{bootstrapOnly:true,followLatest:true}],[17,{followLatest:false}]],'helper logs and independent parent chart proof are distinct reads');
    await f.start();assert.equal(f.windowReads[0].tabId,17);assert.equal(f.windowReads[0].args.bootstrap.runEpoch,source.runEpoch);assert.equal(f.windowReads[0].args.bootstrapHistory.baseBars.length,20);
    await f.nextPoll();assert.equal(f.windowReads[1].args.bootstrapHistory,undefined);assert.equal(f.pineLogReads.length,2,'the paired helper is not polled during ordinary Window monitoring');
    out=await f.exported();assert.equal(out.selectedTabId,17);assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.latency.samples.length,0);assert.equal(out.sourceDomLatency.samples.length,0);assert.equal(out.orderEligible,false);
  }finally{await f.cleanup();}
});

test('unlinked or non-bootstrap helpers, changed selections and mismatched parent charts cannot prepare or seed context',async()=>{
  for(const mode of ['UNLINKED','NOT_BOOTSTRAP_ONLY','SELECTION_CHANGED','SELECTION_CHANGED_DURING_CHART_PROOF','CHART_IDENTITY_MISMATCH']){
    const source=preopenFixture();let release;const held=new Promise(resolve=>{release=resolve;});
    const parentProof={status:'OK',messages:[],chart:mode==='CHART_IDENTITY_MISMATCH'?{...source.evidence.chart,symbols:['CME_MINI:MNQ1!']}:source.evidence.chart};
    const f=await pageFixture([()=>source.evidence],{tabs:pairedTabs,pineLogEvidence:command=>{
      if(command.target.tabId===17)return mode==='SELECTION_CHANGED_DURING_CHART_PROOF'?held:parentProof;
      if(mode==='UNLINKED')return {...detachedLogs(source),editorLinked:false};
      if(mode==='NOT_BOOTSTRAP_ONLY')return {...detachedLogs(source),bootstrapLogsOnly:false};
      return mode==='SELECTION_CHANGED'?held:detachedLogs(source);
    }});
    try{
      f.$('bootstrap-log-tab').value='18';await f.prepareHistory();
      if(mode.startsWith('SELECTION_CHANGED')){assert.equal(f.$('prepare-window-history').disabled,true);f.$('bootstrap-log-tab').value='19';release(mode==='SELECTION_CHANGED'?detachedLogs(source):parentProof);await flush();await flush();await flush();}
      let out=await f.exported();assert.equal(out.preopenContext.status,'NOT_PREPARED',mode);assert.equal(out.preopenContext.bootstrapHistory,undefined);assert.notEqual(out.preopenContext.reason,'HISTORICAL_CONTEXT_ONLY');assert.doesNotMatch(f.$('preopen-history-status').textContent,/CONTEXT_READY/);
      assert.equal(out.preopenContext.readSource,null);assert.equal(out.preopenContext.reason,mode==='SELECTION_CHANGED'?'BOOTSTRAP_LOG_TAB_CHANGED_DURING_READ':mode==='SELECTION_CHANGED_DURING_CHART_PROOF'?'BOOTSTRAP_SOURCE_CHANGED_DURING_READ':mode==='CHART_IDENTITY_MISMATCH'?'BOOTSTRAP_CHART_IDENTITY_MISMATCH':'BOOTSTRAP_EDITOR_NOT_LINKED');
      await f.start();assert.equal(f.windowReads[0].args.bootstrap,undefined);assert.equal(f.windowReads[0].args.bootstrapHistory,undefined);out=await f.exported();assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.store.liveEligible,false);
    }finally{release?.(detachedLogs(source));await f.cleanup();}
  }
});
