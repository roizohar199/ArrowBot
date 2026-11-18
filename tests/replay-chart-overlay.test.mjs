import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {replayChartOverlayCommand} from '../replay-chart-overlay.mjs';
import {planGuideRisk} from '../guide-risk.mjs';
const allNodes=node=>[node,...node.children.flatMap(allNodes)];
const arrows=root=>allNodes(root).filter(node=>node.getAttribute('data-arrow-approved-direction'));

// Component-contract fixtures are synthetic. They never establish a market
// approval or feed a production LIVE/REPLAY journal.
const at=Date.UTC(2026,10,13,18),minute=60000,epoch=Date.UTC(2026,10,14,12),instrument='CME_MINI:NQ1!';
const ids=['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME'];
const flags=['requireRisk','requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'];
function approved(direction='LONG'){
  const risk={riskBudget:200,maxContracts:1,pointValue:20,commissionPerContract:3.10,slippageTicks:2,rewardRisk:2};
  const riskPlan=planGuideRisk({...risk,direction,entry:20010,stop:direction==='LONG'?20005:20015,tickSize:.25});assert.equal(riskPlan.status,'PLANNED');assert.equal(riskPlan.quantity,1);
  return {status:'CONFIRMED',execution:'OBSERVATION_ONLY',orderEligible:false,eventId:'synthetic-component-contract',instrument,timeframe:'1',direction,confirmationClose:20010,invalidation:direction==='LONG'?20005:20015,confirmationBarCloseTime:at+minute,confirmedAt:at+minute,patternIds:['HAMMER_SHAPE'],contextSnapshot:{checks:ids.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'}))},parameterSnapshot:{config:Object.fromEntries(flags.map(id=>[id,true])),risk},riskPlan};
}
function surface(){
  let clock=0,serial=0,clicks=0;const frames=new Map(),timers=new Map(),pageListeners=new Map(),docListeners=new Map(),observers=[],resizeObservers=[];
  class Element{
    constructor(tag='div',attrs={},rect={left:0,top:0,width:100,height:30}){Object.assign(this,{tagName:tag.toUpperCase(),attrs,rect,style:{},dataset:{},children:[],parentElement:null,id:attrs.id??'',_text:'',clientLeft:0,clientTop:0,clientWidth:rect.width,clientHeight:rect.height});}
    setAttribute(name,value){this.attrs[name]=String(value);if(name==='id')this.id=String(value);}getAttribute(name){return name==='id'?this.id:this.attrs[name]??null;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
    set innerHTML(_value){throw Error('Unsafe HTML mutation forbidden');}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
    click(){clicks++;}
    getBoundingClientRect(){if(this.style.position==='fixed'){const left=parseFloat(this.style.left),top=parseFloat(this.style.top),width=parseFloat(this.style.width),height=Math.min(220,parseFloat(this.style.maxHeight)||220);return {left,top,width,height,right:left+width,bottom:top+height};}return {...this.rect,right:this.rect.left+this.rect.width,bottom:this.rect.top+this.rect.height};}
    querySelectorAll(){return [];}
  }
  const body=new Element('body',{}, {left:0,top:0,width:1200,height:900}),canvas=new Element('canvas',{'aria-label':'Chart for '+instrument+', 1 minute'},{left:60,top:60,width:800,height:650}),interval=new Element('button',{'data-value':'1','aria-checked':'true'}),replay=new Element('button',{'aria-pressed':'true'}),tab=new Element('button',{'aria-label':'Data window','aria-selected':'true'}),study=new Element(),header=new Element('span',{title:'Arrow OHLC Window v2 (104,5,15)'}),foreign=new Element('button',{id:'broker-order'});
  foreign.textContent='Foreign broker UI';study.append(header);body.append(canvas,interval,replay,tab,study,foreign);
  const fieldNames=['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END','ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'],fieldValues=[epoch,17,17,17e12+at-1577836800000,17e12+at+minute-1577836800000,12345,67890],fieldNodes=new Map(),labels=[];
  for(let i=0;i<fieldNames.length;i++){const name=fieldNames[i],parent=new Element(),label=new Element('span',{'data-test-id-value-title':name}),value=new Element();value.textContent=String(fieldValues[i]);parent.append(label,value);study.append(parent);labels.push(label);fieldNodes.set(name,value);}
  study.querySelectorAll=selector=>selector==='span[title]'?[header]:selector==='[data-test-id-value-title]'?labels:[];
  const all=()=>{const rows=[];const visit=node=>{rows.push(node);node.children.forEach(visit);};visit(body);return rows;};
  const document={body,visibilityState:'visible',hidden:false,getElementById:id=>all().find(node=>node.id===id)??null,createElement:tag=>new Element(tag),createElementNS:(_namespace,tag)=>new Element(tag),querySelector(selector){if(selector.startsWith('#header-toolbar-intervals'))return interval;if(selector==='#header-toolbar-replay')return replay;return null;},querySelectorAll(selector){if(selector==='canvas[aria-label^="Chart for "]')return all().filter(node=>node.tagName==='CANVAS');if(selector==='[role="tab"][aria-selected="true"]')return [tab];if(selector==='[role="treegrid"] [role="row"][data-role="menuitem"]')return [study];return [];},addEventListener:(name,fn)=>docListeners.set(name,fn),removeEventListener:(name,fn)=>{if(docListeners.get(name)===fn)docListeners.delete(name);}};
  class Observer{constructor(callback){this.callback=callback;this.active=false;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}}
  class Resize{constructor(callback){this.callback=callback;this.targets=new Set();resizeObservers.push(this);}observe(target){this.targets.add(target);}disconnect(){this.targets.clear();}}
  const context=vm.createContext({document,location:{protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/research/'},innerWidth:1200,innerHeight:900,performance:{timeOrigin:1000000,now:()=>clock},MutationObserver:Observer,ResizeObserver:Resize,getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',overflowX:'visible',overflowY:'visible',...node.style}),requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,due:clock+delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>pageListeners.set(name,fn),removeEventListener:(name,fn)=>{if(pageListeners.get(name)===fn)pageListeners.delete(name);}});
  const witness={kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',runEpoch:epoch,runId:instrument+'|1|'+epoch,sequence:17,sourceEmittedAt:epoch,observedAt:epoch,currentTime:at,currentCloseTime:at+minute,current:{time:at,closeTime:at+minute},metadata:{source:'ohlc',instrument,timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,currency:'USD',chartType:'standard'},checksumsVerified:true,replay:true,liveEligible:false,fields:Object.fromEntries(fieldNodes.entries().map(([name,node])=>[name,node.textContent])),sourceDocumentTimeOrigin:1000000,sourceObservedEpochMs:999980};
  const decision={status:'NO_APPROVAL',asOfTime:at+minute,currentChecks:{directions:{LONG:{checks:[]},SHORT:{checks:[]}}}},args={action:'show',sessionId:'replay-session',expectedInstrument:instrument,expectedTimeframe:'1',replayWitness:witness,decision,testOnly:false};
  const run=overrides=>{context.__args={...args,...overrides};return vm.runInContext('('+replayChartOverlayCommand.toString()+')(__args)',context);};
  return {body,canvas,interval,replay,tab,study,header,foreign,Element,fieldNodes,witness,decision,args,document,context,frames,timers,docListeners,pageListeners,observers,resizeObservers,run,get clicks(){return clicks;},root:()=>document.getElementById('arrow-replay-research-overlay-v1'),mutate(){for(const o of observers)if(o.active)o.callback();},resize(){for(const o of resizeObservers)if(o.targets.size)o.callback();},async paint(ms=16){clock+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(clock);await Promise.resolve();},async timeout(ms=750){clock+=ms;for(const [id,timer]of [...timers])if(timer.due<=clock){timers.delete(id);timer.fn();}await Promise.resolve();},async shown(options={}){const promise=run(options);await this.paint();await this.paint();return JSON.parse(JSON.stringify(await promise));}};
}

test('REPLAY neutral and pending decisions stay nonapproved, pointer-transparent and outside LIVE/TEST roots',async()=>{
  for(const status of ['NO_APPROVAL','PENDING']){const s=surface(),r=await s.shown({decision:{...s.decision,status}});assert.equal(r.status,'RENDERED');assert.equal(r.mode,'REPLAY');assert.equal(r.live,false);assert.equal(r.orderEligible,false);assert.equal(r.approvedHistorical,false);assert.equal(s.root().dataset.approved,'false');assert.equal(s.root().style.background,'#1b2436');assert.match(s.root().textContent,/REPLAY/);assert.match(s.root().textContent,/HISTORICAL/);assert.match(s.root().textContent,/אין איתות מאושר/);assert.match(s.root().textContent,/ללא פקודות/);assert.equal(s.root().style.pointerEvents,'none');assert.equal(s.document.getElementById('arrow-chart-signal-live-v1'),null);assert.equal(s.document.getElementById('arrow-chart-signal-test-v1'),null);assert.equal(s.clicks,0);assert.equal(s.foreign.textContent,'Foreign broker UI');}
});
test('neutral card exposes actual required-filter states and reason codes without a historical approval label',async()=>{
  const s=surface(),checks=ids.map(id=>({id,required:true,available:true,enabled:true,passed:false,state:'FAIL',reasonCodes:['FILTER_CONDITION_NOT_MET']}));checks[4].state='UNAVAILABLE';checks[4].reasonCodes=['INSUFFICIENT_CONFIRMED_TRENDLINE'];
  const r=await s.shown({decision:{...s.decision,currentChecks:{directions:{LONG:{checks},SHORT:{checks}}}}});assert.equal(r.status,'RENDERED');assert.equal(r.approvedHistorical,false);assert.match(s.root().textContent,/INSUFFICIENT_CONFIRMED_TRENDLINE/);assert.match(s.root().textContent,/FILTER_CONDITION_NOT_MET/);assert.match(s.root().textContent,/סיבות LONG/);assert.doesNotMatch(s.root().textContent,/איתות היסטורי מאושר/);assert.equal(s.root().style.background,'#1b2436');
});
test('historical sequence zero still produces distinct decision IDs for different Replay bar cutoffs',async()=>{
  const s=surface();s.witness.sequence=0;for(const name of ['ARROW2_SEQ_BEGIN','ARROW2_SEQ_END']){s.witness.fields[name]='0';s.fieldNodes.get(name).textContent='0';}const first=await s.shown();
  s.witness.currentTime+=minute;s.witness.currentCloseTime+=minute;s.witness.current.time+=minute;s.witness.current.closeTime+=minute;s.decision.asOfTime+=minute;
  for(const name of ['ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME']){s.witness.fields[name]=String(Number(s.witness.fields[name])+minute);s.fieldNodes.get(name).textContent=s.witness.fields[name];}
  const second=await s.shown();assert.equal(first.status,'RENDERED');assert.equal(second.status,'RENDERED');assert.notEqual(first.eventId,second.eventId);assert.equal(first.sourceSequence,0);assert.equal(second.sourceSequence,0);assert.match(second.eventId,new RegExp(':'+s.witness.currentTime+':'+s.decision.asOfTime+':NO_APPROVAL$'));
});
test('historical approval needs all seven frozen checks and an independently calculated one-contract all-in plan',async()=>{
  const s=surface(),signal=approved(),r=await s.shown({decision:{...s.decision,status:'CONFIRMED',signal}});assert.equal(r.status,'RENDERED');assert.equal(r.approvedHistorical,true);assert.match(r.eventId,/^REPLAY:/);assert.equal(s.root().dataset.approved,'true');assert.match(s.root().textContent,/איתות היסטורי מאושר/);assert.match(s.root().textContent,/כמות: 1/);assert.match(s.root().textContent,/113.1/);assert.match(s.root().textContent,/ללא אימות חשבון/);for(const id of ['EMA','FIB','HTF'])assert.ok(s.root().textContent.includes(id));assert.match(s.root().textContent,/2026-11-13T18:01:00.000Z/);
  assert.ok(r.renderReceiptEpoch<=r.mutationEpoch&&r.mutationEpoch<=r.firstPaintEpoch&&r.firstPaintEpoch<=r.secondPaintEpoch);assert.equal(r.sourceToChartLowerMs,36);assert.equal(r.sourceToChartUpperMs,52);assert.equal(r.networkLatencyMeasured,false);assert.equal(r.physicalDisplayMeasured,false);assert.match(r.meaning,/NOT_LIVE_LATENCY/);
});

test('strict historical LONG and SHORT approvals share the medium blue/orange arrows while retaining explicit REPLAY scope',async()=>{
  for(const [direction,color,path]of [['LONG','#7dd3fc','M16 2L2 16H10V34H22V16H30Z'],['SHORT','#fb923c','M16 34L2 20H10V2H22V20H30Z']]){
    const s=surface(),signal=approved(direction),result=await s.shown({decision:{...s.decision,status:'CONFIRMED',signal}});assert.equal(result.status,'RENDERED');assert.equal(result.approvedHistorical,true);assert.equal(result.live,false);const markers=arrows(s.root());assert.equal(markers.length,1);const marker=markers[0];assert.equal(marker.getAttribute('data-arrow-approved-direction'),direction);assert.equal(marker.getAttribute('data-arrow-size'),'medium');assert.equal(marker.getAttribute('data-arrow-placement'),'signal-card');assert.equal(marker.getAttribute('width'),'32');assert.equal(marker.getAttribute('height'),'36');assert.match(marker.getAttribute('aria-label'),/Replay היסטורי/);assert.equal(marker.children[0].getAttribute('fill'),color);assert.equal(marker.children[0].getAttribute('d'),path);assert.match(s.root().textContent,/REPLAY/);assert.match(s.root().textContent,/HISTORICAL/);assert.match(s.root().textContent,/ללא פקודות/);assert.equal(s.clicks,0);
  }
  for(const status of ['NO_APPROVAL','PENDING']){const s=surface();await s.shown({decision:{...s.decision,status}});assert.equal(arrows(s.root()).length,0,'unapproved replay decisions must not look like approved directional signals');}
});
test('each disabled, unavailable or failed mandatory filter and invalid risk cannot acquire a positive card',async()=>{
  for(const id of ids){const s=surface(),signal=approved();signal.contextSnapshot.checks.find(c=>c.id===id).passed=false;const r=await s.run({decision:{...s.decision,status:'CONFIRMED',signal}});assert.equal(r.status,'STRICT_HISTORICAL_APPROVAL_REQUIRED',id);assert.equal(s.root(),null);}
  for(const edit of [s=>{s.parameterSnapshot.config.requireEma=false;},s=>{s.contextSnapshot.checks[0].available=false;},s=>{s.contextSnapshot.checks[0].enabled=false;},s=>{s.confirmationBarCloseTime+=minute;s.confirmedAt+=minute;},s=>{s.orderEligible=true;}]){const v=surface(),signal=approved();edit(signal);assert.equal((await v.run({decision:{...v.decision,status:'CONFIRMED',signal}})).status,'STRICT_HISTORICAL_APPROVAL_REQUIRED');assert.equal(v.root(),null);}
  for(const edit of [s=>{s.riskPlan.quantity=2;},s=>{s.riskPlan.totalPlannedRisk=201;},s=>{s.parameterSnapshot.risk.riskBudget=201;},s=>{s.riskPlan.ordersCreated=true;}]){const v=surface(),signal=approved();edit(signal);assert.equal((await v.run({decision:{...v.decision,status:'CONFIRMED',signal}})).status,'ONE_CONTRACT_ALL_IN_RESEARCH_RISK_REQUIRED');assert.equal(v.root(),null);}
  const s=surface(),signal=approved();signal.riskPlan.totalPlannedRisk=1;assert.equal((await s.run({decision:{...s.decision,status:'CONFIRMED',signal}})).status,'HISTORICAL_RISK_ARITHMETIC_MISMATCH');assert.equal(s.root(),null);
});
test('actual Replay DOM, exact NQ timeframe and exact public witness are mandatory; refusal clears only the owned replay card',async()=>{
  for(const [change,options,status]of [[s=>{s.replay.attrs['aria-pressed']='false';},{},'REPLAY_NOT_ACTIVE'],[s=>{delete s.replay.attrs['aria-pressed'];},{},'REPLAY_STATUS_UNVERIFIED'],[s=>{s.interval.attrs['data-value']='5';},{},'CHART_IDENTITY_MISMATCH'],[s=>{s.canvas.attrs['aria-label']='Chart for CME:MBT1!, 1 minute';},{},'CHART_IDENTITY_MISMATCH'],[s=>{s.fieldNodes.get('ARROW2_CHECKSUM_A').textContent='777';},{},'REPLAY_WITNESS_CHANGED'],[s=>{s.tab.attrs['aria-label']='Pine Logs';},{},'REPLAY_DATA_WINDOW_REQUIRED'],[()=>{},{mode:'LIVE'},'INVALID_REPLAY_COMMAND'],[()=>{},{testOnly:true},'SYNTHETIC_TEST_NOT_HISTORICAL_MARKET_EVIDENCE']]){const s=surface();await s.shown();change(s);const r=await s.run(options);assert.equal(r.status,status);assert.equal(s.root(),null);assert.equal(s.foreign.textContent,'Foreign broker UI');assert.equal(s.clicks,0);}
});
test('a witness changing before either rAF never receives a rendered receipt; completed cards invalidate on source mutation',async()=>{
  for(const second of [false,true]){const s=surface(),promise=s.run({});if(second)await s.paint();s.fieldNodes.get('ARROW2_SEQ_END').textContent='18';await s.paint();const r=await promise;assert.equal(r.status,'REPLAY_WITNESS_CHANGED');assert.equal(r.secondPaintEpoch,null);assert.equal(s.root(),null);assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);}
  const s=surface();await s.shown();s.replay.attrs['aria-pressed']='false';s.mutate();assert.equal(s.root(),null);assert.equal(s.context.__arrowReplayResearchOverlayV1,undefined);
});
test('same-session and new-session supersession resolve pending work; stale clear cannot erase a replacement',async()=>{
  for(const sessionId of ['replay-session','new-session']){const s=surface(),old=s.run({}),next=s.run({sessionId,decision:{...s.decision,status:'PENDING'}});assert.equal((await old).status,'SUPERSEDED');await s.paint();await s.paint();assert.equal((await next).status,'RENDERED');assert.ok(s.root());assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);if(sessionId==='new-session'){assert.equal((await s.run({action:'clear'})).status,'STALE_SESSION');assert.ok(s.root());}assert.equal((await s.run({action:'clear',sessionId})).status,'CLEARED');assert.equal(s.root(),null);}
});
test('hidden, pagehide, offscreen, timeout and foreign-id collisions never mutate other UI or produce a successful timing sample',async()=>{
  for(const cause of ['hidden','pagehide','offscreen','timeout']){const s=surface(),promise=s.run({});if(cause==='hidden'){s.document.hidden=true;s.document.visibilityState='hidden';s.docListeners.get('visibilitychange')();}if(cause==='pagehide')s.pageListeners.get('pagehide')();if(cause==='offscreen'){s.canvas.rect.left=1199;await s.paint();}if(cause==='timeout')await s.timeout();const r=await promise;assert.notEqual(r.status,'RENDERED');assert.equal(r.sourceToChartUpperMs,null);assert.equal(s.root(),null);assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);assert.equal(s.clicks,0);}
  const s=surface(),foreign=new s.Element('div',{id:'arrow-replay-research-overlay-v1'});foreign.textContent='Unrelated content';s.body.append(foreign);assert.equal((await s.run({})).status,'OWNED_ROOT_ID_COLLISION');assert.equal(foreign.textContent,'Unrelated content');assert.equal(foreign.parentElement,s.body);
});
test('missing or wrong same-document source clock does not substitute Date.now or producer timestamps',async()=>{
  for(const edit of [w=>{delete w.sourceObservedEpochMs;},w=>{w.sourceDocumentTimeOrigin++;},w=>{w.sourceObservedEpochMs=2000000;}]){const s=surface(),witness=structuredClone(s.witness);edit(witness);const r=await s.shown({replayWitness:witness});assert.equal(r.status,'RENDERED');assert.equal(r.sourceToChartLowerMs,null);assert.equal(r.sourceToChartUpperMs,null);}
  const s=surface();assert.equal((await s.run({decision:{...s.decision,asOfTime:at-1}})).status,'INVALID_REPLAY_DECISION');
});

function multichartResearchSurface(){
  const s=surface();s.context.URL=URL;s.context.location.origin='https://www.tradingview.com';
  const layout=new s.Element('button',{'aria-label':'Logged in as test Active layout: Arrow OHLC Live Verification'});s.body.append(layout);
  const query=s.document.querySelectorAll;s.document.querySelectorAll=selector=>selector==='[aria-label^="Logged in as"]'?[layout]:query(selector);
  const first=new s.Element('canvas',{'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'},{left:0,top:50,width:350,height:650}),third=new s.Element('canvas',{'aria-label':'Chart for CME_MINI:NQ1!, 1 second'},{left:920,top:50,width:250,height:650});
  s.canvas.rect={left:400,top:50,width:480,height:650};s.body.children=s.body.children.filter(node=>node!==s.canvas);s.body.append(first,s.canvas,third);
  return {...s,layout,first,third,policy:{allowResearchMultiChart:true,expectedResearchUrl:'https://www.tradingview.com/chart/research/'}};
}

test('explicit research multichart card anchors geometry to the unique selected NQ one-minute canvas instead of the first canvas',async()=>{
  const s=multichartResearchSurface(),r=await s.shown(s.policy);assert.equal(r.status,'RENDERED');assert.equal(r.researchSelection.visibleCharts,3);assert.equal(r.researchSelection.targetCharts,1);
  const card=s.root().getBoundingClientRect(),selected=s.canvas.getBoundingClientRect();assert.ok(card.left>=selected.left&&card.right<=selected.right);assert.ok(card.left>s.first.getBoundingClientRect().right,'card cannot cover the earlier five-minute chart');
  assert.equal(s.resizeObservers.some(observer=>observer.targets.has(s.canvas)),true);assert.equal(s.resizeObservers.some(observer=>observer.targets.has(s.first)),false);assert.equal(s.clicks,0);
  assert.equal(s.first.getAttribute('aria-label'),'Chart for CME_MINI:NQ1!, 5 minutes');assert.equal(s.third.getAttribute('aria-label'),'Chart for CME_MINI:NQ1!, 1 second');
});

test('multichart overlay rejects personal or unpinned research targets and ambiguity before any card mutation',async()=>{
  for(const edit of [s=>{s.policy.allowResearchMultiChart=false;},s=>{s.policy.allowResearchMultiChart='true';},s=>{delete s.policy.expectedResearchUrl;},s=>{s.policy.expectedResearchUrl='https://www.tradingview.com/chart/PersonalNew/';},s=>{s.layout.attrs['aria-label']='Logged in as test Active layout: PERSONAL';},s=>{s.interval.attrs['data-value']='5';},s=>{s.first.attrs['aria-label']='Chart for CME_MINI:MNQ1!, 5 minutes';},s=>{s.first.attrs['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';},s=>{s.body.append(new s.Element('canvas',{'aria-label':'Chart for CME_MINI:NQ1!, 15 minutes'}));}]){
    const s=multichartResearchSurface();edit(s);assert.notEqual((await s.shown(s.policy)).status,'RENDERED',edit.toString());assert.equal(s.root(),null);assert.equal(s.clicks,0);
  }
});

test('a selected one-minute pane that shrinks below usable dimensions clears only the owned multichart card',async()=>{
  const s=multichartResearchSurface();await s.shown(s.policy);s.canvas.rect.width=250;s.resize();assert.equal(s.root(),null);assert.equal(s.first.parentElement,s.body);assert.equal(s.third.parentElement,s.body);assert.equal(s.foreign.textContent,'Foreign broker UI');assert.equal(s.clicks,0);
});

test('opening the native trade panel shrinks the plot and repositions only the owned card without refreshing its approval or source time',async()=>{
  const s=surface(),signal=approved(),receipt=await s.shown({decision:{...s.decision,status:'CONFIRMED',signal}}),root=s.root(),before=root.getBoundingClientRect(),foreignBefore=JSON.stringify(s.foreign.style);
  assert.ok(before.right>470,'old geometry would cover the newly opened ticket');assert.equal(s.resizeObservers.length,1);assert.deepEqual([...s.resizeObservers[0].targets],[s.canvas]);
  // Observed research geometry: price plot ends at470; native ticket starts542.
  s.canvas.rect={left:0,top:42,width:470,height:429};s.resize();
  const rect=root.getBoundingClientRect();assert.equal(rect.left,68);assert.equal(rect.right,458);assert.ok(rect.top>=42&&rect.bottom<=471);assert.equal(s.root(),root);assert.equal(root.dataset.approved,'true');assert.equal(root.style.boxShadow,'inset 0 0 0 1px #0007');
  const read=JSON.parse(JSON.stringify(await s.run({action:'read'})));assert.equal(read.status,'OK');assert.equal(read.card.eventId,receipt.eventId);assert.deepEqual(read.card.receipt,receipt,'repositioning must not issue a fresh signal receipt');assert.equal(read.card.placement.repositions,1);assert.equal(read.card.placement.sourceObservedEpochMs,s.witness.sourceObservedEpochMs);assert.equal(s.frames.size,0);assert.equal(s.clicks,0);assert.equal(JSON.stringify(s.foreign.style),foreignBefore);assert.equal(s.foreign.textContent,'Foreign broker UI');
});

test('plot resize between render frames clamps the pending card before its render receipt',async()=>{
  const s=surface(),promise=s.run({});await s.paint();s.canvas.rect={left:0,top:42,width:470,height:429};s.resize();await s.paint();const receipt=await promise;
  assert.equal(receipt.status,'RENDERED');assert.ok(s.root().getBoundingClientRect().right<470);assert.equal(receipt.sourceObservedEpochMs,s.witness.sourceObservedEpochMs);assert.equal(receipt.sourceToChartUpperMs,52);
});

test('an undersized chart or changed source during resize clears the card and releases geometry listeners',async()=>{
  for(const change of [s=>{s.canvas.rect.width=259;},s=>{s.canvas.rect.height=239;},s=>{s.fieldNodes.get('ARROW2_CHECKSUM_A').textContent='777';}]){
    const s=surface();await s.shown({decision:{...s.decision,status:'CONFIRMED',signal:approved()}});change(s);s.resize();assert.equal(s.root(),null);assert.equal(s.context.__arrowReplayResearchOverlayV1,undefined);assert.equal(s.pageListeners.has('resize'),false);assert.ok(s.resizeObservers.every(observer=>observer.targets.size===0));assert.ok(s.observers.every(observer=>observer.active===false));assert.equal(s.foreign.textContent,'Foreign broker UI');assert.equal(s.clicks,0);
  }
});

test('window resize and bounded DOM geometry changes reposition the card even without ResizeObserver',async()=>{
  const s=surface();delete s.context.ResizeObserver;await s.shown();s.canvas.rect={left:10,top:75,width:400,height:500};s.pageListeners.get('resize')();let rect=s.root().getBoundingClientRect();assert.equal(rect.left,22);assert.equal(rect.right,398);assert.ok(rect.top>=75&&rect.bottom<=575);
  s.canvas.rect={left:20,top:90,width:300,height:450};s.mutate();rect=s.root().getBoundingClientRect();assert.equal(rect.left,32);assert.equal(rect.right,308);assert.equal(rect.width,276);assert.equal(s.canvas.style.width,undefined,'no TradingView layout CSS is changed');
  await s.run({action:'clear'});assert.equal(s.pageListeners.has('resize'),false);assert.ok(s.observers.every(observer=>observer.active===false));
});

test('superseding a card keeps one canvas observer and final clear releases all geometry work',async()=>{
  const s=surface();await s.shown();await s.shown({decision:{...s.decision,status:'PENDING'}});assert.equal(s.resizeObservers.length,1);assert.deepEqual([...s.resizeObservers[0].targets],[s.canvas]);assert.equal(s.pageListeners.has('resize'),true);await s.run({action:'clear'});assert.equal(s.resizeObservers[0].targets.size,0);assert.equal(s.pageListeners.has('resize'),false);assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);
});
