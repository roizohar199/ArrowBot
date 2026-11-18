import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {replayChartOverlayCommand} from '../replay-chart-overlay.mjs';
import {planGuideRisk} from '../guide-risk.mjs';
import {GUIDE_STRATEGY_PROFILES} from '../guide-strategy-policy.mjs';
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

function technicalSurface(direction='LONG'){
  const s=surface();
  Object.assign(s.witness.current,{closed:true,sourceClosed:true,open:20009.5,high:20010.25,low:20009.25,close:20010});
  const decision={kind:'GUIDE_TECHNICAL_DIRECTION_DECISION',definitionVersion:'guide-technical-decision-1',engineVersion:'guide-signals-5',status:'CONFIRMED',direction,
    asOfTime:at+minute,currentClosedBarCloseTime:at+minute,execution:'OBSERVATION_ONLY',orderEligible:false,synthetic:false,testOnly:false,conflicts:[],
    signal:{kind:'GUIDE_TECHNICAL_DIRECTION_SIGNAL',definitionVersion:'guide-technical-decision-1',engineVersion:'guide-signals-5',status:'CONFIRMED',eventId:'technical-component-contract',instrument,timeframe:'1',direction,
      confirmationClose:20010,confirmedAt:at+minute,confirmationBarCloseTime:at+minute,execution:'OBSERVATION_ONLY',orderEligible:false,synthetic:false,testOnly:false,
      requiredChecks:ids.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),patternIds:['HAMMER_SHAPE'],sourceEventIds:['component-setup'],setups:[{eventId:'component-setup',direction,structuralInvalidation:direction==='LONG'?20005:20015}]}};
  return {...s,technical:decision};
}

test('technical LONG/SHORT card renders a medium direction arrow with user management and no invented budget or sizing',async()=>{
  for(const [direction,color] of [['LONG','#7dd3fc'],['SHORT','#fb923c']]){
    const s=technicalSurface(direction),result=await s.shown({decision:s.technical});
    assert.equal(result.status,'RENDERED');assert.equal(result.live,false);assert.equal(result.ordersCreated,false);assert.equal(result.orderEligible,false);
    const root=s.root(),markers=arrows(root);assert.equal(markers.length,1);assert.equal(markers[0].getAttribute('data-arrow-approved-direction'),direction);assert.equal(markers[0].getAttribute('data-arrow-size'),'medium');assert.equal(markers[0].children[0].getAttribute('fill'),color);
    assert.match(root.textContent,/אישור כיוון טכני/);assert.match(root.textContent,/ניהול העסקה בידיך/);assert.match(root.textContent,/רמות ביטול מבניות/);
    assert.doesNotMatch(root.textContent,/כמות: 1|\$200|סיכון כולל מתוכנן|עמלה והחלקה/);assert.equal(s.clicks,0);assert.equal(s.foreign.textContent,'Foreign broker UI');
  }
});

function strategySurface(profile=GUIDE_STRATEGY_PROFILES.find(p=>p.id==='ENGULFING_EMA')){
  const s=technicalSurface(),signal=s.technical.signal,checks=profile.requiredCheckIds.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'}));
  signal.approvalPolicy='guide_scenarios_v1';signal.requiredChecks=structuredClone(checks);signal.strategyProofs=[{profileId:profile.id,requiredCheckIds:[...profile.requiredCheckIds],requiredChecks:checks,sourceEventIds:[...signal.sourceEventIds]}];return s;
}

test('serialized overlay agrees with all source strategy profiles and accepts their complete required subset without unrelated filters',async()=>{
  for(const profile of GUIDE_STRATEGY_PROFILES){const s=strategySurface(profile),result=await s.shown({decision:s.technical});assert.equal(result.status,'RENDERED',profile.id);assert.equal(arrows(s.root()).length,1);assert.equal(s.clicks,0);}
  const s=strategySurface();await s.shown({decision:s.technical});assert.match(s.root().textContent,/EMA:✓/);assert.doesNotMatch(s.root().textContent,/FIB:\?|קו מגמה:\?/);
});

test('strategy subset cannot omit a mandatory check, invent a profile, orphan an event or reuse a source constituent',async()=>{
  for(const change of [
    s=>{s.strategyProofs[0].requiredChecks[0].passed=false;},s=>{s.strategyProofs[0].requiredCheckIds.pop();},
    s=>{s.strategyProofs[0].profileId='UNKNOWN';},s=>{s.strategyProofs[0].profileId='__proto__';},
    s=>{s.strategyProofs[0].sourceEventIds=['foreign'];},s=>{s.sourceEventIds.push('orphan');},
    s=>{s.strategyProofs.push(structuredClone(s.strategyProofs[0]));},s=>{s.requiredChecks.pop();},
    s=>{s.approvalPolicy='unknown_policy';},
  ]){const s=strategySurface();change(s.technical.signal);assert.notEqual((await s.shown({decision:s.technical})).status,'RENDERED');assert.equal(s.root(),null);assert.equal(s.clicks,0);}
});

test('every missing, disabled, unavailable or failed technical context blocks a positive overlay',async()=>{
  for(const id of ids)for(const key of ['required','enabled','available','passed']){
    const s=technicalSurface();s.technical.signal.requiredChecks.find(check=>check.id===id)[key]=false;
    const result=await s.shown({decision:s.technical});assert.notEqual(result.status,'RENDERED',id+key);assert.equal(s.root(),null);
  }
  for(const edit of [d=>{d.signal.requiredChecks.pop();},d=>{d.signal.requiredChecks.push({...d.signal.requiredChecks[0]});},d=>{d.synthetic=true;},d=>{d.testOnly=true;},d=>{d.engineVersion='old';}]){
    const s=technicalSurface();edit(s.technical);assert.notEqual((await s.shown({decision:s.technical})).status,'RENDERED');assert.equal(s.root(),null);
  }
});

test('technical confirmation must match current source-final close, cutoff and direction before any positive card mutation',async()=>{
  for(const edit of [d=>{d.signal.confirmationClose+=.25;},d=>{d.signal.confirmationBarCloseTime-=minute;d.signal.confirmedAt-=minute;},d=>{d.currentClosedBarCloseTime-=minute;},d=>{d.direction='SHORT';},d=>{d.signal.testOnly=true;},d=>{d.signal.synthetic=true;}]){
    const s=technicalSurface();edit(s.technical);const result=await s.shown({decision:s.technical});assert.notEqual(result.status,'RENDERED',edit.toString());assert.equal(s.root(),null);
  }
  for(const edit of [w=>{w.current.closed=false;w.current.sourceClosed=false;},w=>{w.current.sourceClosed=false;}]){
    const s=technicalSurface();edit(s.witness);assert.notEqual((await s.shown({decision:s.technical})).status,'RENDERED');assert.equal(s.root(),null);
  }
  for(const edit of [w=>{w.synthetic=true;},w=>{w.testOnly=true;},w=>{w.metadata.synthetic=true;},w=>{w.metadata.testOnly=true;}]){const s=technicalSurface();edit(s.witness);assert.equal((await s.shown({decision:s.technical})).status,'SYNTHETIC_TEST_NOT_HISTORICAL_MARKET_EVIDENCE');assert.equal(s.root(),null);}
});

test('AMBIGUOUS and NO_APPROVAL technical decisions never borrow a directional arrow from the previous card',async()=>{
  for(const status of ['AMBIGUOUS','NO_APPROVAL']){
    const s=technicalSurface();await s.shown({decision:s.technical});assert.equal(arrows(s.root()).length,1);
    const decision={...s.technical,status,direction:null,signal:null};const result=await s.shown({decision});assert.equal(result.status,'RENDERED');assert.equal(result.approvedHistorical,false);assert.equal(arrows(s.root()).length,0);assert.equal(s.root().dataset.approved,'false');
    if(status==='AMBIGUOUS')assert.match(s.root().textContent,/אין כיוון יחיד לכניסה/);
  }
});

test('legacy strict historical overlay retains its separate quantity/risk arithmetic contract',async()=>{
  const s=surface(),signal=approved();assert.equal((await s.shown({decision:{...s.decision,status:'CONFIRMED',signal}})).status,'RENDERED');assert.match(s.root().textContent,/כמות: 1/);assert.match(s.root().textContent,/\$200/);
  signal.riskPlan.quantity=2;assert.equal((await s.shown({decision:{...s.decision,status:'CONFIRMED',signal}})).status,'ONE_CONTRACT_ALL_IN_RESEARCH_RISK_REQUIRED');assert.equal(s.root(),null);
});

