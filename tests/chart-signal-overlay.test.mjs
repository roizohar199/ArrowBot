import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chartSignalOverlayCommand} from '../chart-signal-overlay.mjs';
const allNodes=node=>[node,...node.children.flatMap(allNodes)];
const arrows=root=>allNodes(root).filter(node=>node.getAttribute('data-arrow-approved-direction'));

function surface(){
  let clock=0,serial=0,clicks=0;const frames=new Map(),timers=new Map(),pageListeners=new Map(),docListeners=new Map();
  class Element{
    constructor(tag='div',attributes={},rect={left:0,top:0,width:100,height:30}){this.tagName=tag.toUpperCase();this.attrs=attributes;this.style={};this.children=[];this.parentElement=null;this.rect=rect;this.id=attributes.id??'';this._text='';this.clientLeft=0;this.clientTop=0;this.clientWidth=rect.width;this.clientHeight=rect.height;}
    setAttribute(name,value){this.attrs[name]=String(value);if(name==='id')this.id=String(value);}getAttribute(name){return name==='id'?this.id:this.attrs[name]??null;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set innerHTML(_value){throw Error('Unsafe HTML mutation is forbidden');}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this._text='';this.children=[];this.append(...nodes);}
    remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
    click(){clicks++;}
    getBoundingClientRect(){
      if(this.style.position==='fixed'){
        const width=Number.parseFloat(this.style.width),height=190,left=Number.parseFloat(this.style.left),top=this.style.top==='auto'?800-Number.parseFloat(this.style.bottom)-height:Number.parseFloat(this.style.top);
        return {left,top,width,height,right:left+width,bottom:top+height};
      }
      return {...this.rect,right:this.rect.left+this.rect.width,bottom:this.rect.top+this.rect.height};
    }
  }
  const body=new Element('body',{}, {left:0,top:0,width:1200,height:800}),canvas=new Element('canvas',{'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'},{left:100,top:80,width:800,height:500});
  const foreign=new Element('button',{id:'broker-order'},{left:1000,top:100,width:100,height:40});foreign.textContent='Broker UI';body.append(canvas,foreign);
  const interval=new Element('button',{'data-value':'1','aria-checked':'true'}),replay=new Element('button',{'aria-pressed':'false'});body.append(interval,replay);
  const all=()=>{const values=[];const walk=node=>{values.push(node);for(const child of node.children)walk(child);};walk(body);return values;};
  const document={body,documentElement:body,visibilityState:'visible',hidden:false,getElementById(id){return all().find(node=>node.id===id)??null;},createElement:tag=>new Element(tag),createElementNS:(_namespace,tag)=>new Element(tag),querySelectorAll(selector){if(selector==='canvas[aria-label^="Chart for "]')return all().filter(node=>node.tagName==='CANVAS'&&node.getAttribute('aria-label')?.startsWith('Chart for '));return [];},querySelector(selector){if(selector==='#header-toolbar-intervals [aria-checked="true"]')return interval;if(selector==='#header-toolbar-replay')return replay;return null;},addEventListener(name,callback){docListeners.set(name,callback);},removeEventListener(name,callback){if(docListeners.get(name)===callback)docListeners.delete(name);}};
  const context=vm.createContext({document,location:{protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/example/'},innerWidth:1200,innerHeight:800,performance:{timeOrigin:1000000,now:()=>clock},
    getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',overflowX:'visible',overflowY:'visible',...node.style}),
    requestAnimationFrame:callback=>{const id=++serial;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(callback,delay)=>{const id=++serial;timers.set(id,{callback,due:clock+delay,delay});return id;},clearTimeout:id=>timers.delete(id),
    addEventListener:(name,callback)=>pageListeners.set(name,callback),removeEventListener:(name,callback)=>{if(pageListeners.get(name)===callback)pageListeners.delete(name);},
  });
  const signal={status:'CONFIRMED',execution:'OBSERVATION_ONLY',orderEligible:false,eventId:'signal:1',direction:'LONG',confirmationClose:20010.25,confirmationBarCloseTime:Date.UTC(2026,10,14,12),invalidation:20004,patternIds:['BULLISH_ENGULFING'],riskPlan:{status:'PLANNED',quantity:1}};
  const args={action:'show',sessionId:'session',mode:'LIVE',expectedInstrument:'CME_MINI:NQ1!',expectedTimeframe:'1',signal};
  const run=options=>{context.__args={...args,...options};return vm.runInContext('('+chartSignalOverlayCommand.toString()+')(__args)',context);};
  return {Element,body,foreign,canvas,interval,replay,document,context,frames,timers,pageListeners,docListeners,args,signal,run,
    get clicks(){return clicks;},roots(){return all().filter(node=>node.getAttribute('data-arrow-overlay-owned')==='v1');},
    async paint(ms=16){clock+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(clock);await Promise.resolve();},
    async timeout(ms=750){clock+=ms;for(const [id,timer]of [...timers])if(timer.due<=clock){timers.delete(id);timer.callback();}await Promise.resolve();},
    async shown(options={}){const promise=run(options);await this.paint();await this.paint();return JSON.parse(JSON.stringify(await promise));},
  };
}

test('serialized LIVE card uses exact chart proof, planned risk and two ordered local rendering opportunities',async()=>{
  const s=surface(),result=await s.shown();assert.equal(result.status,'RENDERED');assert.equal(result.mode,'LIVE');assert.equal(result.eventId,'signal:1');assert.equal(result.meaning,'renderopportunitynotphysical');assert.equal(result.physicalDisplayMeasured,false);
  assert.equal(result.documentTimeOrigin,1000000);assert.ok(result.renderReceiptEpoch<=result.mutationEpoch&&result.mutationEpoch<=result.firstPaintEpoch&&result.firstPaintEpoch<=result.secondPaintEpoch);
  const roots=s.roots();assert.equal(roots.length,1);const root=roots[0];assert.match(root.textContent,/איתות מחקר מאושר/);assert.match(root.textContent,/LONG/);assert.match(root.textContent,/20010.25/);assert.match(root.textContent,/20004/);assert.match(root.textContent,/כמות: 1/);assert.match(root.textContent,/2026-11-14T12:00:00.000Z/);assert.match(root.textContent,/CME_MINI:NQ1!/);assert.equal(root.style.pointerEvents,'none');assert.equal(root.style.position,'fixed');
  const box=root.getBoundingClientRect(),chart=s.canvas.getBoundingClientRect();assert.ok(box.left>=chart.left&&box.right<=chart.right&&box.top>=chart.top&&box.bottom<=chart.bottom);assert.equal(s.clicks,0);assert.equal(s.foreign.textContent,'Broker UI');
});

test('approved LIVE LONG and SHORT use medium directional arrows with the requested light-blue and orange colors',async()=>{
  for(const [direction,color,path]of [['LONG','#7dd3fc','M16 2L2 16H10V34H22V16H30Z'],['SHORT','#fb923c','M16 34L2 20H10V2H22V20H30Z']]){
    const s=surface(),result=await s.shown({signal:{...s.signal,direction}});assert.equal(result.status,'RENDERED');const markers=arrows(s.roots()[0]);assert.equal(markers.length,1);const marker=markers[0];assert.equal(marker.tagName,'SVG');assert.equal(marker.getAttribute('data-arrow-approved-direction'),direction);assert.equal(marker.getAttribute('data-arrow-size'),'medium');assert.equal(marker.getAttribute('data-arrow-placement'),'signal-card');assert.equal(marker.getAttribute('width'),'32');assert.equal(marker.getAttribute('height'),'36');assert.equal(marker.style.width,'32px');assert.equal(marker.style.height,'36px');assert.equal(marker.style.pointerEvents,'none');assert.equal(marker.children[0].getAttribute('fill'),color);assert.equal(marker.children[0].getAttribute('d'),path);assert.equal(s.clicks,0);
  }
});

test('provisional, rejected and order-eligible payloads cannot acquire an approved LIVE arrow even with a planned risk object',async()=>{
  for(const status of [undefined,'ARMED','CANDIDATE','REJECTED','EXPIRED']){const s=surface(),result=await s.run({signal:{...s.signal,status}});assert.equal(result.status,'CONFIRMED_SIGNAL_REQUIRED');assert.equal(s.roots().length,0);}
  for(const change of [{execution:'AUTOMATIC'},{orderEligible:true}]){const s=surface(),result=await s.run({signal:{...s.signal,...change}});assert.equal(result.status,'CONFIRMED_SIGNAL_REQUIRED');assert.equal(s.roots().length,0);}
});

test('TEST has separate owned root, strong visual-only text and never acquires an approved-market label',async()=>{
  const s=surface();await s.shown();const result=await s.shown({mode:'TEST',signal:{...s.signal,eventId:'test:1',instrument:'SYNTHETIC_TEST:NQ',riskPlan:undefined}});
  assert.equal(result.status,'RENDERED');assert.equal(result.mode,'TEST');assert.equal(s.roots().length,2);
  const root=s.document.getElementById('arrow-chart-signal-test-v1');assert.match(root.textContent,/בדיקת תצוגה בלבד · ללא איתות שוק/);assert.match(root.textContent,/נתוני בדיקה: SYNTHETIC_TEST:NQ/);assert.match(root.textContent,/גרף תצוגה: CME_MINI:NQ1!/);assert.doesNotMatch(root.textContent,/מאושר/);assert.equal(root.style.pointerEvents,'none');
  assert.equal(arrows(root).length,0,'synthetic display tests have no approved-market direction marker');
  const read=JSON.parse(JSON.stringify(await s.run({action:'read',mode:undefined})));assert.deepEqual(read.activeModes,['LIVE','TEST']);assert.equal(read.cards.length,2);assert.equal(read.cards.find(card=>card.mode==='LIVE').eventId,'signal:1');
});

test('wrong identity, replay, missing planned risk, hidden or too-small chart are excluded without other DOM changes',async()=>{
  for(const [modify,options,expected]of [
    [()=>{}, {expectedInstrument:'OTHER:NQ1!'},'CHART_IDENTITY_MISMATCH'],
    [()=>{}, {expectedTimeframe:'5'},'CHART_IDENTITY_MISMATCH'],
    [s=>{s.replay.attrs['aria-pressed']='true';},{},'REPLAY_ACTIVE'],
    [s=>{delete s.replay.attrs['aria-pressed'];},{},'REPLAY_STATUS_UNVERIFIED'],
    [s=>{s.document.visibilityState='hidden';},{},'DOCUMENT_HIDDEN'],
    [s=>{s.canvas.rect.width=200;},{},'CHART_VISIBLE_AREA_TOO_SMALL'],
    [s=>s.body.append(new s.Element('canvas',{'aria-label':'Chart for OTHER:ASSET, 1 minute'},{left:0,top:0,width:500,height:400})),{},'SINGLE_VISIBLE_CHART_REQUIRED'],
  ]){const s=surface();modify(s);const before=s.body.children.length,result=await s.run(options);assert.equal(result.status,expected);assert.equal(s.roots().length,0);assert.equal(s.body.children.length,before);assert.equal(s.clicks,0);assert.equal(s.foreign.textContent,'Broker UI');}
  for(const riskPlan of [undefined,{status:'REJECTED',quantity:1},{status:'PLANNED',quantity:0},{status:'PLANNED',quantity:1.5}]){const s=surface(),result=await s.run({signal:{...s.signal,riskPlan}});assert.equal(result.status,'PLANNED_RISK_REQUIRED');assert.equal(s.roots().length,0);}
});

test('duplicate and replacement events keep only the last card for each mode, with textContent sanitization',async()=>{
  const s=surface();await s.shown();const first=s.roots()[0],duplicate=await s.run({});assert.equal(duplicate.status,'DUPLICATE');assert.equal(s.roots().length,1);assert.equal(s.frames.size,0);
  const text='<img src=x onerror="alert(1)">';const replacement=await s.shown({signal:{...s.signal,eventId:'signal:2',direction:'SHORT',patternIds:[text]}});
  assert.equal(replacement.eventId,'signal:2');assert.equal(s.roots().length,1);assert.equal(s.roots()[0],first);assert.ok(first.textContent.includes(text));assert.match(first.textContent,/SHORT/);assert.equal(first.children.every(node=>['DIV','STRONG'].includes(node.tagName)),true);assert.equal(s.clicks,0);
});

test('old-session clear cannot erase replacement session; pending superseded calls resolve and stay bounded',async()=>{
  const s=surface(),oldPromise=s.run({});await s.paint();const nextPromise=s.run({sessionId:'replacement',signal:{...s.signal,eventId:'signal:new'}});
  const old=await oldPromise;assert.equal(old.status,'SUPERSEDED');assert.equal(s.roots().length,1);
  await s.paint();await s.paint();const next=await nextPromise;assert.equal(next.status,'RENDERED');
  const stale=await s.run({action:'clear',sessionId:'session'});assert.equal(stale.status,'STALE_SESSION');assert.equal(s.roots().length,1);
  const cleared=await s.run({action:'clear',sessionId:'replacement'});assert.equal(cleared.status,'CLEARED');assert.equal(s.roots().length,0);assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);
});

test('same-session pending replacement reuses its root and cannot receive stale paint callbacks',async()=>{
  const s=surface(),old=s.run({});const root=s.roots()[0];const next=s.run({signal:{...s.signal,eventId:'next'}});assert.equal((await old).status,'SUPERSEDED');assert.equal(s.roots()[0],root);assert.equal(s.roots().length,1);
  await s.paint();await s.paint();assert.equal((await next).status,'RENDERED');assert.match(root.textContent,/איתות מחקר מאושר/);assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);
});

test('visibility, replay changes, offscreen geometry, pagehide and bounded timeout exclude pending render receipts and clean owned DOM',async()=>{
  for(const cause of ['hidden','replay','offscreen','pagehide','timeout']){
    const s=surface(),promise=s.run({});
    if(cause==='hidden'){s.document.hidden=true;s.document.visibilityState='hidden';s.docListeners.get('visibilitychange')();}
    if(cause==='replay'){s.replay.attrs['aria-pressed']='true';await s.paint();}
    if(cause==='offscreen'){s.canvas.rect.left=1100;await s.paint();}
    if(cause==='pagehide')s.pageListeners.get('pagehide')();
    if(cause==='timeout'){assert.ok([...s.timers.values()].every(timer=>timer.delay<=1000));await s.timeout();}
    const result=await promise;assert.notEqual(result.status,'RENDERED',cause);assert.equal(result.secondPaintEpoch,null,cause);assert.equal(s.roots().length,0,cause);assert.equal(s.frames.size,0,cause);assert.equal(s.timers.size,0,cause);assert.equal(s.foreign.textContent,'Broker UI');
  }
});

test('completed LIVE/TEST cards are removed on pagehide and foreign id collisions are never modified',async()=>{
  const s=surface();await s.shown();await s.shown({mode:'TEST',signal:{...s.signal,eventId:'test'}});s.pageListeners.get('pagehide')();assert.equal(s.roots().length,0);assert.equal(s.context.__arrowChartSignalOverlayV1,undefined);assert.equal(s.docListeners.size,0);
  const collision=surface(),foreignRoot=new collision.Element('div',{id:'arrow-chart-signal-live-v1'});foreignRoot.textContent='Unrelated source content';collision.body.append(foreignRoot);const result=await collision.run({});assert.equal(result.status,'OWNED_ROOT_ID_COLLISION');assert.equal(foreignRoot.textContent,'Unrelated source content');assert.equal(foreignRoot.parentElement,collision.body);assert.equal(collision.roots().length,0);
});

test('optional source session/run guards bind LIVE to the owned reader before mutation and both rendering opportunities',async()=>{
  const epoch=Date.UTC(2026,10,14,12),binding={expectedSourceSession:'source-session',expectedSourceRunEpoch:epoch};
  const valid=surface();valid.context.__arrowWindowFeedV2={sessionId:'source-session',bootstrap:{runEpoch:epoch}};assert.equal((await valid.shown(binding)).status,'RENDERED');
  for(const [reader,expected]of [[{sessionId:'other',bootstrap:{runEpoch:epoch}},'SOURCE_SESSION_MISMATCH'],[{sessionId:'source-session',bootstrap:{runEpoch:epoch+1}},'SOURCE_RUN_EPOCH_MISMATCH']]){
    const s=surface();s.context.__arrowWindowFeedV2=reader;const result=await s.run(binding);assert.equal(result.status,expected);assert.equal(s.roots().length,0);
  }
  for(const changeAtSecondPaint of [false,true]){
    const s=surface();s.context.__arrowWindowFeedV2={sessionId:'source-session',bootstrap:{runEpoch:epoch}};const pending=s.run(binding);if(changeAtSecondPaint)await s.paint();s.context.__arrowWindowFeedV2.bootstrap.runEpoch=epoch+1;await s.paint();const result=await pending;assert.equal(result.status,'SOURCE_RUN_EPOCH_MISMATCH');assert.equal(result.secondPaintEpoch,null);assert.equal(s.roots().length,0);
  }
});
