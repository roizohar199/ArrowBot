import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBrokerAccountRegistry,BROKER_ACCOUNT_REGISTRY_STORAGE_KEY as ACCOUNT_KEY} from '../broker-account-registry.mjs';
import {EXECUTION_ATTEMPT_STORAGE_KEY} from '../execution-attempt-ledger.mjs';
import {GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
import {GUIDE_TECHNICAL_DECISION_VERSION} from '../guide-technical-decision.mjs';

// Actual root-page initialization with a fake Chrome/native transport. The
// closed-market fixtures cannot authenticate a live signal or any real order.
const html=await readFile(new URL('../live-ohlc.html',import.meta.url),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const SOURCE_URL='https://www.tradingview.com/chart/ARROWRV1/',OTHER_URL='https://www.tradingview.com/chart/DifferentResearch/';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Node{
  constructor(id='',doc){Object.assign(this,{id,doc,ownerDocument:doc,value:'',textContent:'',disabled:false,hidden:false,checked:false,open:false,dataset:{},children:[],listeners:new Map(),modalCalls:0});}
  addEventListener(name,fn){const listeners=this.listeners.get(name)??[];listeners.push(fn);this.listeners.set(name,listeners);}removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)??[]).filter(f=>f!==fn));}
  async emit(name){for(const fn of this.listeners.get(name)??[])await fn({type:name,target:this,preventDefault(){}});}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}after(node){this.doc.created.push(node);}closest(){return this.label??null;}setAttribute(key,value){this[key]=String(value);}removeAttribute(key){delete this[key];}scrollIntoView(){}focus(){this.doc.activeElement=this;}remove(){}
  showModal(){this.modalCalls++;throw Error('LEGACY_APPROVAL_MODAL_OPENED');}close(){this.open=false;void this.emit('close');}getBoundingClientRect(){return {left:0,top:0,right:300,bottom:300,width:300,height:300};}click(){if(!this.disabled)return this.emit('click');}
}
function closedContext(wall){
  const meta={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'regular',chartType:'standard'},end=Math.floor(wall/60000)*60000-60000;
  const rows=duration=>Array.from({length:20},(_,i)=>({time:end-(20-i)*duration,closeTime:end-(19-i)*duration,open:28000,high:28002,low:27999,close:28001,closed:true,sourceClosed:true}));
  const runId='READ_ONLY_PAGE_CONTRACT|NQ|1794657590000',base=rows(60000),higher=['5','15'].map(timeframe=>({timeframe,timeframeMs:Number(timeframe)*60000,bars:rows(Number(timeframe)*60000)}));
  const envelope=(kind,sequence,extra)=>({schemaVersion:1,kind,runId,sequence,sourceEmittedAt:end,realtime:false,dataDelayUnverified:true,metadata:meta,bars:[],reasonCodes:[],...extra});
  const packets=[envelope('snapshot',801,{bootstrapOnly:true,bars:base}),...higher.map((series,i)=>envelope('timeframe_snapshot',802+i,{higherTimeframes:[series]}))];
  return {status:'OK',reasonCodes:['WINDOW_PRESESSION_CONTEXT_ONLY'],contextOnly:true,contextReady:true,liveEligible:false,
    chart:{symbols:['CME_MINI:NQ1!'],interval:'1',replay:false,marketOpen:false,realtime:false,visibleCharts:3,documentVisible:true,chartLabels:['Chart for CME_MINI:NQ1!, 5 minutes','Chart for CME_MINI:NQ1!, 1 minute','Chart for CME_MINI:NQ1!, 1 second'],researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:3,targetCharts:1,interval:'1',selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',researchLayoutVerified:true,liveMultiChartExplicit:true,statusLegendScoped:true,sourceMode:'LIVE'}},
    messages:packets.map(p=>'ARROW_OHLC_V1 '+JSON.stringify(p)),bootstrapMetadata:{runId,metadata:meta},windowFrame:{sequence:100,sourceEmittedAt:end,runEpoch:1794657590000,realtime:false,current:base.at(-1),coherent:true,checksumsVerified:true}};
}
function liveTape(){
  // Artificial complete-engine reachability transport. Only Chrome replies are
  // simulated; neither these OHLC nor simulated orders leave this Node test.
  const minute=60000,start=Date.UTC(2026,10,16,8),values=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];
  const bar=(i,o,h,l,c)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open:o,high:h,low:l,close:c,closed:true,sourceClosed:true}),bars=[...values.map((v,i)=>bar(i,v,v+1,v-1,v)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)],initialWall=bars[23].closeTime,meta={...closedContext(initialWall).bootstrapMetadata.metadata},runEpoch=start-1000,runId='CME_MINI:NQ1!|1|'+runEpoch;
  let sequence=100,cursor=0,lastFrame;
  const queue=[{kind:'snapshot',bars:bars.slice(0,24),at:initialWall}];
  for(let i=24;i<=26;i++){for(let elapsed=1000;elapsed<minute;elapsed+=1000){const b=bars[i],close=Math.round((b.open+(b.close-b.open)*elapsed/minute)/.25)*.25;queue.push({kind:'update',bars:[{...b,high:Math.max(b.open,close),low:Math.min(b.open,close),close,closed:false,sourceClosed:false}],at:b.time+elapsed});}queue.push({kind:'update',bars:[bars[i]],at:bars[i].closeTime});}
  return {initialWall,length:queue.length,next(){const item=queue[cursor++];const chart={...closedContext(initialWall).chart,marketOpen:true,realtime:true};if(!item)return {at:null,evidence:{status:'OK',reasonCodes:['NO_FRESH_SOURCE_PACKET'],chart,messages:[],bootstrapMetadata:{runId,metadata:meta},windowFrame:lastFrame}};
    const seq=++sequence,envelope=(kind,slot,extra)=>({schemaVersion:1,kind,runId,sequence:seq*8+slot,sourceEmittedAt:item.at,realtime:true,dataDelayUnverified:true,metadata:meta,bars:[],reasonCodes:[],...extra}),packets=[envelope(item.kind,item.kind==='snapshot'?1:4,{bars:item.bars})];
    if(item.kind==='snapshot')for(const [index,tf]of ['5','15'].entries()){const duration=Number(tf)*minute,end=Math.floor(item.at/duration)*duration,higher=Array.from({length:20},(_,n)=>({time:end-(20-n)*duration,closeTime:end-(19-n)*duration,open:105,high:110,low:100,close:106,closed:true,sourceClosed:true}));packets.push(envelope('timeframe_snapshot',index+2,{higherTimeframes:[{timeframe:tf,timeframeMs:duration,bars:higher}]}));}
    lastFrame={sequence:seq,runEpoch,sourceEmittedAt:item.at,realtime:true,current:item.bars.at(-1),coherent:true,checksumsVerified:true};return {at:item.at,evidence:{status:'OK',reasonCodes:[],chart,messages:packets.map(p=>'ARROW_OHLC_V1 '+JSON.stringify(p)),bootstrapMetadata:{runId,metadata:meta},windowFrame:lastFrame}};
  }};
}
async function pageFixture({navigateDuringRead=false,nativeMismatch=false,paper=false,live=false,userManaged=true,sourceTiming=false,nativeReplyPatch=null,additionalPaProfile=false,mixedBootstrapBatch=false}={}){
  const tape=live?liveTape():null;
  let wall=tape?.initialWall??Date.UTC(2026,10,15,12),perf=1000,url=SOURCE_URL,timerId=0,sessionId=null,lockTail=Promise.resolve(),nativeSerial=0;
  const timers=new Map(),frames=new Map(),events=new Map(),documentEvents=new Map(),calls=[],blobs=[],writes=[],storageListeners=[],sourceOrigins=new Map(),sourceDocumentTimeOrigin=wall-100000;
  const advance=ms=>{wall+=ms;perf+=ms;};
  const doc={nodes:new Map(),created:[],hidden:false,visibilityState:'visible',hasFocus:()=>true,getElementById(id){return this.nodes.get(id);},createElement(tag){const n=new Node('',this);n.tagName=tag.toUpperCase();return n;},createElementNS(_ns,tag){return this.createElement(tag);},addEventListener(name,fn){documentEvents.set(name,[...(documentEvents.get(name)??[]),fn]);},removeEventListener(){}};
  for(const id of ids)doc.nodes.set(id,new Node(id,doc));doc.body=new Node('body',doc);const $=id=>doc.getElementById(id);$('live-transport').value='window';$('stop-live').disabled=true;$('stop-focus-live').disabled=true;$('export-live').disabled=true;$('paper-user-panel').hidden=true;
  for(const id of ['risk-budget','point-value','max-contracts','commission','slippage','reward-risk']){const n=$(id);n.label=new Node('',doc);if(userManaged)Object.defineProperty(n,'value',{configurable:true,get(){throw Error('LEGACY_COST_OR_BUDGET_READ:'+id);},set(){throw Error('LEGACY_COST_OR_BUDGET_WRITE:'+id);}});else n.value=({'risk-budget':'200','point-value':'20','max-contracts':'1',commission:'0',slippage:'0','reward-risk':'2'})[id];}
  const provider=paper?'TRADINGVIEW_PAPER':'TRADOVATE',environment=paper?'DEMO':'PA',nativeAccountId=paper?'PaperPageContract':'001-PA-Exact';
  const registry=createBrokerAccountRegistry({now:()=>wall,makeLeaseId:()=> 'user-page-contract'});registry.upsert({id:'native-pa',provider,adapterId:'tradingview-account-ui',environment,nativeAccountId,label:paper?'Paper component account':'PA user managed',currency:'USD',enabled:true,userManagedRisk:true});registry.select('native-pa');
  if(additionalPaProfile)registry.upsert({id:'second-pa',provider:'TRADOVATE',adapterId:'tradingview-account-ui',environment:'PA',nativeAccountId:'PA-secondary-exact',label:'Second PA',currency:'USD',enabled:true,userManagedRisk:true});
  const data={[ACCOUNT_KEY]:registry.snapshot().registry},storage={async get(key){return {[key]:structuredClone(data[key])};},async set(value){const changes=Object.fromEntries(Object.keys(value).map(key=>[key,{oldValue:structuredClone(data[key]),newValue:structuredClone(value[key])}]));writes.push(structuredClone(value));Object.assign(data,structuredClone(value));for(const listener of [...storageListeners])listener(changes,'local');}};
  const win={location:{search:userManaged?'?execution=user-managed':''},innerWidth:400,innerHeight:900,scrollTo(){},requestAnimationFrame(fn){const id=++timerId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),addEventListener(name,fn){events.set(name,[...(events.get(name)??[]),fn]);},removeEventListener(){}};
  const presetName='Node-only saved native preset',nativeConnection=source=>({status:'NATIVE_USER_CONNECTION_VERIFIED',provider,environment,environmentVerified:paper,environmentBasis:paper?'NATIVE_PAPER_PROVIDER_DEMO':'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED',nativeIdentityVerified:true,nativeAccountId,sourceVerified:true,observedAt:wall,sampleId:'native-'+(++nativeSerial),symbol:'NQZ2026',quantity:1,executionSurface:'USER_MANAGED_CHART_MARKET',nativePreset:{kind:'NATIVE_CHART_USER_MANAGED_MARKET_PRESET_V1',fingerprint:'node-only-native-preset-fingerprint',sideNames:{LONG:presetName,SHORT:presetName},stopTargetRead:false,inheritanceVerified:false,inputValuesSetByDriver:false},protectionVerified:false,latestClosedAt:source.asOfTime,flat:true,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],synthetic:false,testOnly:false,...structuredClone(nativeReplyPatch??{})});
  const tab=()=>({id:17,windowId:23,status:'complete',title:'NQ · Arrow OHLC Live Verification',url});
  const chrome={storage:{local:storage,onChanged:{addListener:fn=>storageListeners.push(fn),removeListener:fn=>{const i=storageListeners.indexOf(fn);if(i>=0)storageListeners.splice(i,1);}}},tabs:{async query(){return [tab()];},async get(id){assert.equal(id,17);calls.push({name:'tabs.get',url});return tab();},async update(id,change){assert.equal(id,17);assert.deepEqual(change,{active:true},'quick Start can focus only the existing research tab');calls.push({name:'tabs.update',id,change});return tab();}},windows:{async update(id,change){assert.equal(id,23);assert.deepEqual(change,{focused:true});calls.push({name:'windows.update',id,change});return {id};},async create(){throw Error('EXISTING_RESEARCH_WINDOW_MUST_BE_REUSED');}},scripting:{async executeScript(command){
    const name=command.func.name,args=command.args?.[0]??{};calls.push({name,args:structuredClone(args),tabId:command.target.tabId});
    if(name==='readTradingViewExecutionAccount')return [{result:{kind:'TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1',status:'OBSERVED',provider,nativeAccountId:nativeMismatch?'another-account':nativeAccountId,environment:paper?'DEMO':null,environmentVerified:paper,nativeIdentityVerified:true,readOnly:true,ordersCreated:false,submitted:false,synthetic:false,testOnly:false,observedAt:wall,source:{tabId:17,url}}}];
    if(name==='sourceDomTimingCommand'){if(args.action==='install')sessionId=args.sessionId;return [{result:{status:'OK'}}];}
    if(name==='windowWakeSourceCommand')return [{result:{status:'STOPPED'}}];
    if(name==='prepareTradingViewWindowUi')return [{result:{status:'READY'}}];
    if(name==='prepareNativeUserAccountPanel'){assert.equal(url,SOURCE_URL);assert.deepEqual(args,{provider,nativeAccountId,sourceUrl:url});return [{result:{kind:'NATIVE_USER_START_PANEL_V1',status:'READY',reasonCodes:[],ordersCreated:false,submitted:false,numericInputsSet:false,presetApplied:false,layoutChanged:false,timeframeChanged:false,accountChanged:false}}];}
    if(name==='chartSignalOverlayCommand'){assert.equal(args.action,'clear','closed context cannot draw a positive chart signal');return [{result:{status:'CLEARED'}}];}
    if(name==='paperTradingUiCommand'){assert.equal(args.action,'disarm');return [{result:{status:'DISARMED',submitted:false,ordersCreated:false}}];}
    if(name==='nativeUserMarketUiCommand'){
      assert.equal(args.expected.provider,provider);assert.equal(args.expected.environment,environment);assert.equal(args.expected.nativeAccountId,nativeAccountId);assert.equal(args.expected.researchUrl,SOURCE_URL);assert.equal(args.expected.sourceTabId,17);assert.ok(Number.isSafeInteger(args.expected.accountRevision)&&args.expected.accountRevision>0);assert.ok(args.expected.selectionKey);
      if(args.action==='disarm')return [{result:{status:'DISARMED',ordersCreated:false}}];
      if(['inspect','read_connection'].includes(args.action))return [{result:nativeConnection(args.sourceBinding)}];
      if(args.action==='prepare')return [{result:{kind:'EXECUTION_SESSION_NATIVE_PREPARATION_V1',status:'READY',binding:structuredClone(args.permit.binding),direction:args.permit.signal.direction,quantity:1,privateLeaseId:'node-only-native-lease',expiresAt:Math.min(wall+750,args.permit.expiresAt),connection:nativeConnection(args.sourceBinding)}}];
      if(args.action==='submit'){assert.equal(args.expected.executionAuthorized,true);assert.equal(data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.at(-1).status,'UNKNOWN');return [{result:{status:'NATIVE_USER_SUBMITTED_UNCONFIRMED',provider,environment,nativeIdentityVerified:true,submitted:true,ordersCreated:null,protectionVerified:false}}];}
      assert.equal(args.action,'reconcile');return [{result:{status:'UNKNOWN'}}];
    }
    assert.equal(name,'readTradingViewWindowEvidence','no market submission or broker adapter is called');if(args.stop)return [{result:{status:'STOPPED'}}];
    const step=tape?.next();if(step?.at!==null&&step?.at!==undefined)advance(step.at-wall);const result=step?.evidence??closedContext(wall);
    if(mixedBootstrapBatch&&result.messages?.[0]?.includes('"kind":"snapshot"')){
      const packets=result.messages.map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length))),base=packets[0],at=base.sourceEmittedAt+1000;
      for(const packet of packets.slice(1))packet.sourceEmittedAt=at;
      const current={time:base.sourceEmittedAt,closeTime:base.sourceEmittedAt+60000,open:105,high:105.25,low:104.75,close:105,closed:false,sourceClosed:false};
      packets.push({...base,kind:'update',sequence:base.sequence+3,sourceEmittedAt:at,bars:[current]});
      result.messages=packets.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet));result.windowFrame={...result.windowFrame,sourceEmittedAt:at,current};advance(1000);
    }
    if(sourceTiming){
      const sourceEpoch=wall-7000,records=result.messages.map(raw=>{const packet=JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)),id=packet.runId+':'+packet.sequence;let item=sourceOrigins.get(id);if(!item){item={id,appearanceEpochMs:packet.kind==='update'?sourceEpoch-27:null,initial:packet.kind!=='update',documentVisible:true,transport:'PUBLIC_DATA_WINDOW_V2',sourceSequence:Math.floor(packet.sequence/8),meaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME'};sourceOrigins.set(id,item);}return structuredClone(item);});
      // An unrelated retained observation comes last. The root must join the
      // actual approval packet, rather than whichever record was read last.
      records.push({id:result.bootstrapMetadata.runId+':'+(result.windowFrame.sequence*8+7),appearanceEpochMs:sourceEpoch-11,initial:false,documentVisible:true,transport:'PUBLIC_DATA_WINDOW_V2',sourceSequence:result.windowFrame.sequence,meaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME'});
      result.sourceDomTiming={status:'OK',sessionId,sourceEpoch,documentTimeOrigin:sourceDocumentTimeOrigin,documentVisible:true,records};
    }
    if(navigateDuringRead)url=OTHER_URL;return [{result}];
  }}};
  const previous={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),dateNow:Date.now,performance:Object.getOwnPropertyDescriptor(globalThis,'performance'),create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  Object.assign(globalThis,{document:doc,window:win,chrome,setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay,due:perf+delay});return id;},clearTimeout:id=>timers.delete(id)});Date.now=()=>wall;
  Object.defineProperty(globalThis,'performance',{configurable:true,writable:true,value:{timeOrigin:wall-perf,now:()=>perf}});URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:user-live-page';};URL.revokeObjectURL=()=>{};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request(_name,_options,fn){const next=lockTail.then(fn);lockTail=next.catch(()=>{});return next;}}}});
  const settle=async()=>{for(let i=0;i<5;i++)await flush();};
  await import('../live-ohlc.mjs?user-page-integration='+Math.random());await settle();$('live-tab').value='17';
  return {$,doc,calls,writes,data,tapeLength:tape?.length??0,sessionId:()=>sessionId,sourceOrigin:id=>structuredClone(sourceOrigins.get(id)),sourceDocumentTimeOrigin,sourceReads:()=>calls.filter(c=>c.name==='readTradingViewWindowEvidence'&&!c.args.stop),navigate:()=>{url=OTHER_URL;},settle,
    async start(){await $('connect-live').emit('click');await settle();},
    async nextPoll(){const reads=calls.filter(c=>c.name==='readTradingViewWindowEvidence'&&!c.args.stop).length;for(let turns=0;turns<20;turns++){const pair=[...timers].filter(([,t])=>t.delay<=250).sort((a,b)=>a[1].due-b[1].due)[0];if(!pair&&turns>0)return;assert.ok(pair,'next source poll is scheduled');timers.delete(pair[0]);const delta=Math.max(0,pair[1].due-perf);wall+=delta;perf+=delta;pair[1].fn();await settle();if(calls.filter(c=>c.name==='readTradingViewWindowEvidence'&&!c.args.stop).length>reads||!timers.size)return;}throw Error('SOURCE_POLL_STARVED_BY_BACKGROUND_WORK');},
    async paperPulse(){const pair=[...timers].filter(([,t])=>t.delay===0||t.delay===500).sort((a,b)=>a[1].due-b[1].due)[0];assert.ok(pair,'Paper runner pulse scheduled');timers.delete(pair[0]);advance(Math.max(0,pair[1].due-perf));pair[1].fn();await settle();},
    changeStoredAccount(){for(const fn of [...storageListeners])fn({[ACCOUNT_KEY]:{oldValue:data[ACCOUNT_KEY],newValue:data[ACCOUNT_KEY]}},'local');},
    async exported(){await $('export-live').emit('click');await settle();assert.ok(blobs.length);return JSON.parse(await blobs.at(-1).text());},
    async cleanup(){for(const fn of events.get('pagehide')??[])fn();await settle();timers.clear();frames.clear();Date.now=previous.dateNow;Object.defineProperty(globalThis,'performance',previous.performance);if(previous.navigator)Object.defineProperty(globalThis,'navigator',previous.navigator);else delete globalThis.navigator;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;for(const key of ['document','window','chrome','setTimeout','clearTimeout'])if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];await flush();}
  };
}

test('the first base snapshot analysis receives both same-batch confirmed higher-timeframe histories without waiting another minute',async()=>{
  const f=await pageFixture({paper:true,live:true});
  try{
    await f.start();const out=await f.exported();
    assert.equal(out.store.ready,true);assert.ok(out.latestAnalysis);
    for(const tf of ['5','15']){
      const supplied=out.analysisInputs.options.higherTimeframes[tf];
      assert.equal(supplied.ready,true);assert.equal(supplied.bars.length,20);
      assert.ok(supplied.bars.every(bar=>bar.knownAt<=out.analysisInputs.options.asOfTime));
    }
    assert.equal(out.alerts.length,0);assert.equal(out.paperUserExecution.armed,false);
    assert.equal(paperCalls(f,'submit').length,0);
  }finally{await f.cleanup();}
});

test('an older retained baseline followed by a newer open update uses the complete causal batch for context without a historical order',async()=>{
  const f=await pageFixture({paper:true,live:true,mixedBootstrapBatch:true});
  try{
    await f.start();const out=await f.exported();assert.equal(out.store.ready,true);assert.ok(out.store.current);
    assert.equal(out.analysisInputs.options.asOfTime,out.store.decisionAsOfTime);
    for(const tf of ['5','15'])assert.equal(out.analysisInputs.options.higherTimeframes[tf].bars.length,20);
    assert.equal(out.alerts.length,0);assert.equal(out.paperUserExecution.armed,false);assert.equal(paperCalls(f,'submit').length,0);
  }finally{await f.cleanup();}
});

test('own profile selection commits through the real root storage guard and cannot revert the visible account or grant execution',async()=>{
  const f=await pageFixture({paper:true,additionalPaProfile:true});
  try{f.$('account-profile').value='second-pa';await f.$('account-profile').emit('change');await f.settle();const out=await f.exported();assert.equal(f.data[ACCOUNT_KEY].selectedProfileId,'second-pa');assert.equal(f.$('account-profile').value,'second-pa');assert.equal(out.account.brokerProfile.id,'second-pa');assert.equal(out.account.reviewAccepted,false);assert.equal(out.active,false);assert.equal(out.paperUserExecution.armed,false);assert.equal(out.paperUserExecution.running,false);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.$('paper-user-arm').textContent,'הפעלת הבוט');assert.equal(f.calls.some(c=>c.name==='nativeUserMarketUiCommand'),false);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);}finally{await f.cleanup();}
});

test('actual LIVE user-managed page starts from selected PA/native identity with closed context, no cost form and no execution',async()=>{
  const f=await pageFixture();try{
    assert.equal(f.doc.body.dataset.executionMode,'USER_MANAGED_ANALYSIS');assert.equal(f.$('account-dialog').hidden,true);assert.equal(f.$('paper-execution-panel').hidden,true);assert.equal(f.$('account-dialog').modalCalls,0);assert.equal(f.sourceReads().length,0);
    await f.start();assert.ok(f.sessionId());assert.equal(f.sourceReads().length,1);const out=await f.exported();
    assert.equal(out.executionMode,'USER_MANAGED_ANALYSIS');assert.equal(out.active,true);assert.equal(out.appliedOptions.risk,null);assert.equal(out.appliedOptions.config.requireRisk,false);assert.equal(out.appliedOptions.config.strategyPolicy,'guide_scenarios_v1');
    assert.equal(out.account.reviewAccepted,true);assert.equal(out.account.review.brokerProfile.environment,'PA');assert.equal(out.account.review.profile.mode,'USER_MANAGED');assert.equal(out.account.review.sourceUrl,SOURCE_URL);assert.equal(out.account.ordersAuthorized,false);
    assert.equal(out.store.contextOnly,true);assert.equal(out.store.bars.length,20);assert.equal(out.store.liveEligible,false);assert.equal(out.store.ready,false);assert.equal(out.windowEvidence.sourceUrl,SOURCE_URL);assert.equal(out.store.metadata.sourceUrl,SOURCE_URL);
    assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.orderEligible,false);assert.equal(out.latestAnalysis,null);assert.equal(f.$('account-dialog').modalCalls,0);assert.equal(f.writes.length,0);
    for(const call of f.calls.filter(c=>['prepareTradingViewWindowUi','readTradingViewWindowEvidence'].includes(c.name)&&!c.args.stop))assert.equal(call.args.allowResearchLiveMultiChart,true);
    const before=f.sourceReads().length;f.navigate();await f.nextPoll();const stopped=await f.exported();assert.equal(stopped.active,false);assert.equal(stopped.account.reviewAccepted,false);assert.equal(f.sourceReads().length,before,'navigation is rejected before another source read');assert.equal(stopped.alerts.length,0);
  }finally{await f.cleanup();}
});

test('navigation during the actual root source await invalidates PA binding before context can enter the store',async()=>{
  const f=await pageFixture({navigateDuringRead:true});try{await f.start();const out=await f.exported();assert.equal(f.sourceReads().length,1);assert.equal(out.active,false);assert.equal(out.account.reviewAccepted,false);assert.equal(out.store.bars.length,0);assert.equal(out.alerts.length,0);assert.equal(out.rawEvidence.length,0);assert.equal(out.orderEligible,false);}finally{await f.cleanup();}
});

test('a configured PA cannot start the real root source pipeline when a different native account is observed',async()=>{
  const f=await pageFixture({nativeMismatch:true});try{await f.start();assert.equal(f.sourceReads().length,0);assert.equal(f.sessionId(),null);assert.equal(f.$('account-dialog').modalCalls,0);assert.equal(f.$('stop-live').disabled,true);assert.match(f.$('account-summary').textContent,/אינו תואם/);assert.equal(f.calls.some(c=>c.name==='prepareTradingViewWindowUi'),false);}finally{await f.cleanup();}
});

const paperCalls=(f,action)=>f.calls.filter(c=>c.name==='nativeUserMarketUiCommand'&&(!action||c.args.action===action));
async function inspectAndArmPaper(f){await f.$('paper-user-inspect').emit('click');await f.settle();f.$('paper-user-consent').checked=true;await f.$('paper-user-consent').emit('change');assert.equal(f.$('paper-user-arm').disabled,false);await f.$('paper-user-arm').emit('click');await f.settle();}

test('new Paper controls are mounted only for the explicit user-managed page and Connect never arms or inspects execution',async()=>{
  for(const userManaged of [false,true]){
    const f=await pageFixture({userManaged,paper:true});try{
      assert.equal(f.$('paper-user-panel').hidden,!userManaged);assert.equal(f.$('paper-execution-panel').hidden,userManaged);assert.equal(paperCalls(f).length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);
      if(userManaged){await f.start();const out=await f.exported();assert.equal(out.paperUserExecution.armed,false);assert.equal(out.paperUserExecution.running,false);assert.equal(out.paperUserExecution.realBrokerOrdersAuthorized,false);assert.equal(paperCalls(f).length,0);}
    }finally{await f.cleanup();}
  }
});

test('closed-market context cannot initialize either selected native account runner merely from consent and inspection',async()=>{
  for(const args of [{paper:true},{paper:false}]){
    const f=await pageFixture(args);try{await f.start();f.$('paper-user-consent').checked=true;await f.$('paper-user-consent').emit('change');await f.$('paper-user-inspect').emit('click');await f.settle();
      assert.equal(f.$('paper-user-arm').disabled,false,'Start remains available to prepare the source; availability is not arming');assert.equal(f.$('paper-user-arm').textContent,'הפעלת הבוט');const out=await f.exported();assert.equal(out.paperUserExecution.armed,false);assert.equal(paperCalls(f).filter(c=>c.args.action!=='disarm').length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);
    }finally{await f.cleanup();}
  }
});

test('one PA Start prepares the exact selected source and account, then arms through the genuine native adapter without an order',async()=>{
  const f=await pageFixture({live:true});try{
    assert.equal(f.$('paper-user-arm').textContent,'הפעלת הבוט');assert.equal(f.$('paper-user-arm').disabled,false);
    const activation=f.$('paper-user-arm').emit('click');await f.settle();let out=await f.exported();
    for(let i=0;i<6&&!out.paperUserExecution.armed;i++){await f.nextPoll();out=await f.exported();}
    await activation;out=await f.exported();const p=out.paperUserExecution;
    assert.equal(out.active,true);assert.equal(out.account.reviewAccepted,true);assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);
    assert.equal(p.armed,true);assert.equal(p.running,true);assert.equal(p.lifecycle.entryAllowed,true);assert.equal(p.status,'WAITING_NEW_SIGNAL');assert.equal(p.dispatchCount,0);
    assert.equal(p.otherAccountPreparation,null);assert.equal(p.connection.provider,'TRADOVATE');assert.equal(p.connection.environment,'PA');assert.equal(p.connection.nativeAccountId,'001-PA-Exact');
    assert.equal(p.connection.environmentVerified,false);assert.equal(p.connection.environmentBasis,'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');assert.equal(p.connection.nativeIdentityVerified,true);assert.equal(p.realBrokerOrdersAuthorized,true);
    assert.equal(f.calls.filter(c=>c.name==='prepareNativeUserAccountPanel').length,1);assert.equal(f.calls.filter(c=>c.name==='readTradingViewExecutionAccount').length,2);assert.equal(paperCalls(f,'inspect').length,1);
    assert.equal(paperCalls(f,'prepare').length,0);assert.equal(paperCalls(f,'submit').length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);assert.equal(f.$('paper-user-consent').checked,true);
    assert.equal(f.$('account-dialog').modalCalls,0);assert.equal(f.calls.some(c=>['readTradovateNativeReadiness','paperUserMarketUiCommand','prepareLivePaperStartUi'].includes(c.name)),false);assert.equal(f.$('paper-user-power-bar').dataset.state,'active');
  }finally{await f.cleanup();}
});

test('wrong PA native identity or falsely attested selected environment cannot arm through the actual root Start button',async()=>{
  for(const args of [{live:true,nativeReplyPatch:{environmentVerified:true}},{live:true,nativeMismatch:true}]){
    const f=await pageFixture(args);try{
      let finished=false;const activation=f.$('paper-user-arm').emit('click').finally(()=>{finished=true;});await f.settle();
      for(let i=0;i<6&&!finished;i++)await f.nextPoll();await activation;const out=await f.exported(),p=out.paperUserExecution;
      assert.equal(f.calls.filter(c=>c.name==='prepareNativeUserAccountPanel').length,1);assert.equal(p.otherAccountPreparation,null);
      assert.equal(p.armed,false);assert.equal(p.running,false);assert.equal(p.lifecycle.entryAllowed,false);assert.equal(p.dispatchCount,0);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(paperCalls(f,'submit').length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);assert.notEqual(f.$('paper-user-power-bar').dataset.state,'active');
      if(args.nativeMismatch){assert.equal(f.sourceReads().length,0);assert.equal(paperCalls(f).length,0);}else{assert.ok(f.sourceReads().length>0);assert.equal(paperCalls(f,'inspect').length,1);}
    }finally{await f.cleanup();}
  }
});

test('ready Paper source still needs explicit Start and fresh native inspection, and user Stop or stored-account change revokes the root runner',async()=>{
  for(const stop of ['USER_STOP','ACCOUNT_CHANGED']){
    const f=await pageFixture({paper:true,live:true});try{
      await f.start();let out=await f.exported();assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.paperUserExecution.armed,false);assert.equal(f.$('paper-user-arm').disabled,false,'Start now owns the preparation flow; availability is not arming');assert.equal(paperCalls(f).length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);
      await f.$('paper-user-inspect').emit('click');await f.settle();assert.equal(paperCalls(f,'inspect').length,1);assert.equal(out.paperUserExecution.armed,false,'native inspection does not start the bot');assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);
      f.$('paper-user-consent').checked=true;await f.$('paper-user-consent').emit('change');assert.equal(f.$('paper-user-arm').disabled,false);await f.$('paper-user-arm').emit('click');await f.settle();out=await f.exported();
      assert.equal(out.paperUserExecution.armed,true);assert.equal(out.paperUserExecution.running,true);assert.equal(out.paperUserExecution.status,'WAITING_NEW_SIGNAL');assert.equal(out.paperUserExecution.connection.quantity,1);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);assert.equal(paperCalls(f,'submit').length,0);
      assert.equal(f.calls.filter(c=>c.name==='prepareNativeUserAccountPanel').length,1);assert.equal(paperCalls(f,'inspect').length,2,'Start performs a new native inspection rather than authorizing from the earlier optional read');assert.equal(out.paperQuickStart.status,'SOURCE_READY');assert.equal(out.paperQuickStart.sourceTabId,17);assert.equal(out.paperQuickStart.sourceUrl,SOURCE_URL);
      if(stop==='USER_STOP')await f.$('stop-live').emit('click');else f.changeStoredAccount();await f.settle();out=await f.exported();assert.equal(out.active,false);assert.equal(out.account.reviewAccepted,false);assert.equal(out.paperUserExecution.armed,false);assert.equal(out.paperUserExecution.running,false);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);assert.equal(paperCalls(f,'submit').length,0);
    }finally{await f.cleanup();}
  }
});

test('one explicit Paper Start uses the actual root connection and source gates from a disconnected page, without a manual Connect or an order',async()=>{
  const f=await pageFixture({paper:true,live:true});try{
    assert.equal(f.sourceReads().length,0);assert.equal(paperCalls(f).length,0);assert.equal(f.$('paper-user-arm').disabled,false);
    const activation=f.$('paper-user-arm').emit('click');await f.settle();let out=await f.exported();
    for(let i=0;i<6&&!out.paperUserExecution.armed;i++){await f.nextPoll();out=await f.exported();}
    await activation;out=await f.exported();assert.equal(out.active,true);assert.equal(out.account.reviewAccepted,true);assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.paperUserExecution.armed,true);assert.equal(out.paperUserExecution.running,true);assert.equal(out.paperUserExecution.status,'WAITING_NEW_SIGNAL');assert.equal(out.paperUserExecution.connection.executionSurface,'USER_MANAGED_CHART_MARKET');assert.equal(out.paperQuickStart.status,'SOURCE_READY');
    assert.equal(f.calls.filter(c=>c.name==='prepareNativeUserAccountPanel').length,1);assert.equal(f.calls.filter(c=>c.name==='readTradingViewExecutionAccount').length,2);assert.equal(paperCalls(f,'inspect').length,1);assert.ok(f.sourceReads().every(c=>c.args.allowResearchLiveMultiChart===true));assert.equal(paperCalls(f,'prepare').length,0);assert.equal(paperCalls(f,'submit').length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);assert.equal(f.$('account-dialog').modalCalls,0);
  }finally{await f.cleanup();}
});

test('a production-engine post-bootstrap root alert reaches either selected native runner once with the user preset and UNKNOWN persisted before the simulated Market callback',async()=>{
  for(const paper of [true,false]){const f=await pageFixture({paper,live:true});try{
    await f.start();await inspectAndArmPaper(f);
    for(let i=1;i<f.tapeLength;i++)await f.nextPoll();await f.settle();let out=await f.exported();
    assert.equal(out.alerts.length,1,'only the genuinely new component-engine confirmation reaches the root alert journal');assert.equal(out.alerts[0].signal.status,'CONFIRMED');assert.equal(out.alerts[0].signal.riskPlan,null);assert.equal(out.alerts[0].signal.parameterSnapshot.config.requireRisk,false);
    if(!paperCalls(f,'submit').length){assert.equal(out.paperUserExecution.armed,true,JSON.stringify(out.paperUserExecution));await f.paperPulse();out=await f.exported();}
    assert.equal(paperCalls(f,'prepare').length,1,JSON.stringify(out.paperUserExecution));assert.equal(paperCalls(f,'submit').length,1,JSON.stringify(out.paperUserExecution));
    const prepared=paperCalls(f,'prepare')[0].args,submitted=paperCalls(f,'submit')[0].args,claims=f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts;
    assert.equal(prepared.approvalProof.engineDefinitionVersion,GUIDE_SIGNAL_VERSION);assert.equal(prepared.approvalProof.technicalDecisionVersion,GUIDE_TECHNICAL_DECISION_VERSION);assert.equal(prepared.approvalProof.approvalPolicy,'guide_scenarios_v1');assert.ok(prepared.approvalProof.requiredChecks.length<7);assert.ok(prepared.approvalProof.sourceEventIds.every(id=>out.alerts[0].signal.setupEventIds.includes(id)));assert.equal(prepared.sourceBinding.sessionId,out.observationSession.sessionId);assert.equal(prepared.sourceBinding.runId,out.selectedRun);assert.equal(prepared.sourceBinding.mode,'LIVE');assert.equal(prepared.sourceBinding.researchUrl,SOURCE_URL);assert.equal(prepared.sourceBinding.sourceTabId,17);
    assert.equal(submitted.permit.binding.accountIdentity.provider,paper?'TRADINGVIEW_PAPER':'TRADOVATE');assert.equal(submitted.permit.binding.accountIdentity.environment,paper?'DEMO':'PA');assert.equal(submitted.permit.binding.accountIdentity.nativeAccountId,paper?'PaperPageContract':'001-PA-Exact');assert.equal(submitted.permit.binding.accountRevision,out.account.brokerProfile.revision);assert.equal(submitted.expected.nativePresetFingerprint,'node-only-native-preset-fingerprint');assert.equal(submitted.expected.executionSurface,'USER_MANAGED_CHART_MARKET');assert.equal(submitted.permit.binding.quantity,1);assert.equal(claims.length,1);assert.equal(claims[0].status,'UNKNOWN');assert.equal(claims[0].key,submitted.attemptKey);assert.equal(out.paperUserExecution.realBrokerOrdersAuthorized,!paper);assert.equal(out.paperUserExecution.protectionVerified,false);
    assert.equal(out.paperUserExecution.connection.environmentVerified,paper);assert.equal(out.paperUserExecution.connection.environmentBasis,paper?'NATIVE_PAPER_PROVIDER_DEMO':'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');assert.equal(out.paperUserExecution.connection.nativePreset.stopTargetRead,false);assert.equal(out.paperUserExecution.connection.nativePreset.inheritanceVerified,false);
    await f.paperPulse();assert.equal(paperCalls(f,'submit').length,1,'uncertain acknowledgement cannot retry or create another order');assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,1);
    assert.equal(f.calls.some(c=>/tradovate|placeOrder|api|fetch/i.test(c.name)),false);for(const key of ['riskBudget','riskPlan','stopTicks','targetTicks'])assert.equal(Object.hasOwn(submitted.permit,key),false);
  }finally{await f.cleanup();}}
});

test('genuine component-engine approval pins its exact original source packet before any panel paint, independently of the last timing record',async()=>{
  const f=await pageFixture({paper:true,live:true,sourceTiming:true});try{
    await f.start();await inspectAndArmPaper(f);for(let i=1;i<f.tapeLength;i++)await f.nextPoll();await f.settle();let out=await f.exported();
    assert.equal(out.alerts.length,1);const item=out.alerts[0],origin=item.sourceObservation,observed=f.sourceOrigin(item.sourcePacketId);
    assert.equal(item.signal.status,'CONFIRMED');assert.equal(item.signal.parameterSnapshot.config.strategyPolicy,'guide_scenarios_v1');assert.equal(origin.kind,'OWNED_SOURCE_PACKET_ORIGIN_V1');assert.equal(origin.sessionId,out.observationSession.sessionId);assert.equal(origin.packetId,item.sourcePacketId);assert.equal(origin.sourceSequence,Math.floor(Number(item.sourcePacketId.split(':').at(-1))/8));assert.equal(origin.sourceAppearanceEpochMs,observed.appearanceEpochMs);assert.equal(origin.sourceDocumentTimeOrigin,f.sourceDocumentTimeOrigin);assert.equal(origin.sourceTransport,'PUBLIC_DATA_WINDOW_V2');
    assert.equal(out.sourceDomLatency.samples.length,0,'no result-panel rendering opportunities have run in this fixture');assert.equal(out.latency.marketToDisplayMeasured,false);assert.ok(origin.calibration.sourceAppearanceLatestReceiverPerformanceMs>=origin.calibration.sourceAppearanceEarliestReceiverPerformanceMs);assert.equal(origin.calibration.receiverTimeOrigin,performance.timeOrigin);assert.ok(origin.calibrationBracketMs<=1000);
    if(!paperCalls(f,'submit').length){await f.paperPulse();out=await f.exported();}
    assert.equal(paperCalls(f,'submit').length,1,'the existing component transport still performs only its one simulated callback');
    const submission=out.paperUserExecution.journal.find(row=>row.phase==='NATIVE_SUBMISSION_REPLY');assert.ok(submission);assert.equal(submission.measurementAnchor.sourceObservationStatus,'MATCHED_OWNED_PACKET');assert.deepEqual(submission.measurementAnchor.sourceObservation,origin);assert.equal(submission.measurementAnchor.sourcePacketId,item.sourcePacketId);assert.equal(out.paperUserExecution.timing.sourceToClickMs,null,'an acknowledgement without native click-clock evidence cannot invent full latency');assert.equal(out.paperUserExecution.timing.sourceToVerifiedFillMs,null);assert.equal(out.paperUserExecution.protectionVerified,false);
  }finally{await f.cleanup();}
});
