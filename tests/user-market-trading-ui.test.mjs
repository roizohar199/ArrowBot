import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {userMarketTradingUiCommand} from '../user-market-trading-ui.mjs';
import {GUIDE_STRATEGY_PROFILES} from '../guide-strategy-policy.mjs';

// Synthetic public-DOM component contract only. Approval rows below are test
// fixtures, not a natural market approval, actual native click or filled trade.
const sortRpcKeys=value=>Array.isArray(value)?value.map(sortRpcKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortRpcKeys(value[key])])):value;
function fixture({quantity=1,direction='LONG',sortTransport=false}={}){
  const s={now:Date.UTC(2026,10,15,15),perf:100,quantityRaw:String(quantity),quote:27939.25,buyClicks:0,sellClicks:0,mutations:0,onClick:null};
  class Node{
    constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.map=new Map();this.isConnected=true;this.disabled=false;this.width=100;this.height=30;}
    getAttribute(k){return this.attrs[k]??null;}getClientRects(){return [{width:this.width,height:this.height}];}
    getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
    querySelectorAll(k){const v=this.map.get(k)??[];return typeof v==='function'?v():v;}
    click(){this.onClick?.();}
  }
  const doc=new Node();doc.visibilityState='visible';doc.hidden=false;doc.listeners=new Map();
  doc.addEventListener=(type,fn)=>doc.listeners.set(type,[...(doc.listeners.get(type)??[]),fn]);
  doc.fire=(type,isTrusted=true)=>{for(const fn of doc.listeners.get(type)??[])fn({type,isTrusted});};
  const layout=new Node({'aria-label':'Logged in as test Active layout: Arrow research'}),chart=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),interval=new Node({'aria-checked':'true','data-value':'1'}),replay=new Node({'aria-pressed':'true'}),footer=new Node(),
    provider=new Node({},'Replay Trading'),panel=new Node(),orderRadio=new Node({'aria-checked':'false'},'Order'),domRadio=new Node({'aria-checked':'true'},'DOM'),title=new Node({title:'NQ1!'}),
    logo=new Node({src:'https://static.tradingview.com/static/bundles/replay-broker.fixture1.svg'}),play=new Node({title:'Play'}),dataTab=new Node({},'Data window'),study=new Node(),studyTitle=new Node({title:'Arrow OHLC Window v2 (test)'});
  play.parentElement=new Node({class:'controls__control-test'});
  for(const [sel,nodes] of [['[role="dialog"]',[]],['[aria-label^="Logged in as"]',[layout]],['canvas[aria-label^="Chart for "]',[chart]],['#header-toolbar-intervals [aria-checked="true"]',[interval]],['#header-toolbar-replay',[replay]],['#footer-chart-panel',[footer]],
    ['[aria-label="Account manager"],[data-qa-id="account-selector"]',[]],['button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]',[]],
    ['[aria-label="Trading panel"]',[panel]],['div[data-role="button"][title="Play"]',[play]],['[role="tab"][aria-selected="true"]',[dataTab]],['[role="treegrid"] [role="row"][data-role="menuitem"]',[study]]])doc.map.set(sel,nodes);
  footer.map.set('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',[provider]);panel.map.set('[role="radio"]',[orderRadio,domRadio]);panel.map.set('[title]',[title]);panel.map.set('img[src]',[logo]);
  const controls={};for(const [qa,txt] of [['buy-market-dom','Buy Mkt'],['sell-market-dom','Sell Mkt'],['cancel-all-buy-orders',''],['cancel-all-sell-orders',''],['position-DOM','—'],['switch-pl-view','—']]){
    controls[qa]=new Node({'data-qa-id':qa},txt);panel.map.set(`[data-qa-id="${qa}"]`,[controls[qa]]);
  }
  controls['cancel-all-buy-orders'].disabled=controls['cancel-all-sell-orders'].disabled=true;
  const qty=new Node({id:'dom-quantity-input','data-qa-id':'ui-lib-Input-input qty-dom-input'});qty.readOnly=false;
  Object.defineProperty(qty,'value',{get(){return s.quantityRaw;},set(v){s.mutations++;s.quantityRaw=String(v);}});
  panel.map.set('input#dom-quantity-input[data-qa-id~="qty-dom-input"]',[qty]);
  const prices=[0,1,2].map((i)=>new Node({'data-qa-id':`dom-cell-${i}-price`,class:i===1?'tv-dom-widget-main__value--highlighted-VBTMesvS':'price'},String(s.quote+(1-i)*.25)));
  panel.map.set('[data-qa-id^="dom-cell-"]',prices);study.map.set('span[title]',[studyTitle]);
  const currentTime=Date.UTC(2026,10,13,20,26),runEpoch=s.now-10000,raw={ARROW2_RUN_EPOCH:String(runEpoch),ARROW2_SEQ_BEGIN:'0',ARROW2_SEQ_END:'0',ARROW2_CURRENT_TIME:String(currentTime-1577836800000),ARROW2_CURRENT_CLOSE_TIME:'416',ARROW2_CHECKSUM_A:'111',ARROW2_CHECKSUM_B:'222'},cells={};
  for(const [key,value] of Object.entries(raw)){const t=new Node({},key),v=new Node({},value),p=new Node();p.children=[t,v];t.parentElement=p;v.parentElement=p;study.map.set(`[data-test-id-value-title="${key}"]`,[t]);cells[key]=v;}
  const binding={sourceTabId:17,runId:'CME_MINI:NQ1!|1|'+runEpoch,runEpoch,sequence:0,currentTime,currentCloseTime:currentTime+60000,asOfTime:currentTime+60000,closedBarRole:'current',eventId:'technical-event-1',fields:raw};
  const expected={researchUrl:'https://www.tradingview.com/chart/research-test/',sourceTabId:17,instrument:'CME_MINI:NQ1!',timeframe:'1'},storage=new Map();
  const fill=side=>{s[side==='LONG'?'buyClicks':'sellClicks']++;controls['position-DOM'].textContent=String(side==='SHORT'?-Number(s.quantityRaw):Number(s.quantityRaw))+' @ '+s.quote.toLocaleString('en-US',{minimumFractionDigits:2});
    controls['position-DOM'].attrs.class=side==='LONG'?'value buy-LVepUlEY':'value sell-LVepUlEY';controls['switch-pl-view'].textContent='0 ticks';s.onClick?.();};
  controls['buy-market-dom'].onClick=()=>fill('LONG');controls['sell-market-dom'].onClick=()=>fill('SHORT');
  const context=vm.createContext({document:doc,location:{protocol:'https:',hostname:'www.tradingview.com',origin:'https://www.tradingview.com',pathname:'/chart/research-test/'},URL,crypto:webcrypto,Uint32Array,
    Date:class extends Date{static now(){return s.now;}},performance:{timeOrigin:s.now-300000,now:()=>s.perf},getComputedStyle:n=>({visibility:'visible',display:'block',overflowX:n.overflowX??'visible',overflowY:n.overflowY??'visible'}),
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))}});
  const call=async args=>{context.command=sortTransport?sortRpcKeys({expected,...args}):{expected,...args};const result=JSON.parse(JSON.stringify(await vm.runInContext('('+userMarketTradingUiCommand.toString()+')(command)',context)));return sortTransport?sortRpcKeys(result):result;};
  const intent=r=>({kind:'USER_PRESET_REPLAY_MARKET_INTENT',definitionVersion:'user-market-intent-1',provider:'REPLAY_TRADING',orderType:'MARKET',symbol:'NQ1!',technicalApproved:true,testOnly:false,userManaged:true,
    realBrokerOrdersAuthorized:false,researchUrl:expected.researchUrl,sourceBinding:structuredClone(binding),direction,quantity:r.preset.quantity,preset:structuredClone(r.preset),leaseId:r.lease.id,preparedAt:s.now,expiresAt:s.now+2000,
    sourceDocumentTimeOrigin:context.performance.timeOrigin,sourceObservedEpochMs:context.performance.timeOrigin+s.perf,
    key:['user-market-intent-1',expected.researchUrl,17,binding.runId,binding.asOfTime,binding.eventId].map(encodeURIComponent).join(':'),
    sharedReservationKey:['replay-execution-intent-2',expected.researchUrl,17,binding.runId,binding.asOfTime,'CME_MINI:NQ1!:1:'+binding.asOfTime+':'+direction].map(encodeURIComponent).join(':'),
    technicalEntryWitness:{kind:'CURRENT_REPLAY_QUOTE_PRESERVES_FROZEN_SETUP',direction,quote:s.quote,asOfTime:binding.asOfTime,sourceEventIds:['source-pattern-event'],eligibleSetupIds:['source-pattern-event'],
      setups:[{eventId:'source-pattern-event',trigger:s.quote+(direction==='LONG'?-.25:.25),structuralInvalidation:s.quote+(direction==='LONG'?-10:10)}],pricesAdjusted:false},
    approvalProof:{engineDefinitionVersion:'guide-signals-5',technicalDecisionVersion:'guide-technical-decision-1',eventId:binding.eventId,asOfTime:binding.asOfTime,direction,confirmedAt:binding.asOfTime,confirmationBarCloseTime:binding.asOfTime,
      confirmationPolicy:'later_close_beyond_setup',roleReversalEnabled:true,supplyDemandEnabled:true,sourceEventIds:['source-pattern-event'],requiredFlags:Object.fromEntries(['requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'].map(k=>[k,true])),
      requiredChecks:['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'].map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'}))}});
  return {s,doc,layout,chart,interval,replay,footer,provider,panel,orderRadio,domRadio,title,logo,play,dataTab,study,controls,qty,prices,binding,cells,expected,storage,context,call,intent,Node};
}
async function ready(f){const r=await f.call({action:'read_preset',direction:f.intentDirection??'LONG',sourceBinding:f.binding});assert.equal(r.status,'USER_MARKET_NATIVE_READY');return f.intent(r);}

test('native controls diagnostic works without any approval or source binding and never mints a usable submission lease',async()=>{
  const f=fixture({quantity:3}),r=await f.call({action:'read_controls'});
  assert.equal(r.status,'USER_MARKET_CONTROLS_OBSERVED');assert.equal(r.controls.quantity.quantity,3);assert.equal(r.controls.quantity.quantityRaw,'3');
  assert.equal(r.controls.buy.label,'Buy Mkt');assert.equal(r.controls.sell.label,'Sell Mkt');assert.equal(r.inventory.status,'FLAT_NO_PENDING');
  assert.equal(r.sourceVerification,'UNBOUND_READ_ONLY');assert.equal(r.inventory.sourceBound,false);assert.equal(r.inventory.executionEligible,false);assert.equal(r.submitCapabilityCreated,false);assert.equal(r.leaseMinted,false);
  assert.equal(f.s.mutations,0);assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  const forged=f.intent({preset:{kind:'NATIVE_REPLAY_DOM_MARKET_QUANTITY_V1',quantity:3},lease:{id:'diagnostic-not-a-lease'}});
  assert.equal((await f.call({action:'submit',intent:forged})).status,'BLOCKED');assert.equal(f.s.buyClicks,0);
});

test('diagnostic exposes actual disabled Market states and unavailable source/inventory without guessing a preset or changing controls',async()=>{
  const f=fixture();f.controls['buy-market-dom'].disabled=true;f.doc.map.set('[role="tab"][aria-selected="true"]',[]);
  const r=await f.call({action:'read_controls'});assert.equal(r.status,'USER_MARKET_CONTROLS_OBSERVED');assert.equal(r.controls.buy.disabled,true);assert.equal(r.controls.sell.disabled,false);
  assert.equal(r.sourceVerification,'UNAVAILABLE');assert.equal(r.inventory,null);assert.equal(r.protectionVerified,false);assert.equal(r.userManaged,true);assert.equal(r.submitCapabilityCreated,false);
  assert.equal(f.s.mutations,0);assert.equal(f.s.buyClicks+f.s.sellClicks,0);
});

test('read-only Market preflight reads actual native quantity without a bot budget, size substitution or SLTP inheritance claim',async()=>{
  const f=fixture({quantity:3}),r=await f.call({action:'read_preset',direction:'LONG',sourceBinding:f.binding});
  assert.equal(r.status,'USER_MARKET_NATIVE_READY');assert.equal(r.preset.quantity,3);assert.equal(r.preset.quantityRaw,'3');assert.equal(r.inventory.flat,true);
  assert.equal(r.preset.bracketPresetVerified,false);assert.equal(r.preset.scope,'NATIVE_DOM_QUANTITY_ONLY_BRACKET_PRESET_UNVERIFIED');assert.equal(r.lease.maximumAgeMs,750);
  assert.equal(f.s.mutations,0);assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(r.realBrokerOrdersAuthorized,false);
});

test('an icon-only selected Data Window tab retains its public accessible source identity',async()=>{
  const f=fixture();f.dataTab.textContent='';f.dataTab.attrs['aria-label']='Data Window';
  const r=await f.call({action:'read_preset',direction:'LONG',sourceBinding:f.binding});assert.equal(r.status,'USER_MARKET_NATIVE_READY');assert.deepEqual(r.sourceFields,f.binding.fields);
  assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(f.s.mutations,0);
});

test('one approved Market gesture uses the frozen current user quantity and chosen native side, then proves only attributed fill and hands management to user',async()=>{
  for(const direction of ['LONG','SHORT']){
    const f=fixture({quantity:3,direction});f.intentDirection=direction;const i=await ready(f),r=await f.call({action:'submit',intent:i});
    assert.equal(r.status,'USER_MARKET_SUBMITTED_UNCONFIRMED');assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
    const verified=await f.call({action:'verify',intent:i,sourceBinding:f.binding});assert.equal(verified.status,'USER_MARKET_FILLED');assert.equal(verified.position.quantity,3);assert.equal(verified.position.direction,direction);
    assert.equal(verified.attribution.kind,'OWN_USER_MARKET_SUBMISSION');assert.equal(verified.attribution.key,i.key);assert.equal(verified.managementHandedToUser,true);
    assert.equal(verified.protectionVerified,false);assert.equal(verified.protectionState,'USER_MANAGED_NOT_VERIFIED');assert.equal(f.s.mutations,0);assert.equal(f.s.buyClicks+f.s.sellClicks,1);
    assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,1);
  }
});

test('recursively key-sorted Chrome RPC replies and arguments preserve exact native preset identity for either Market side',async()=>{
  for(const direction of ['LONG','SHORT']){
    const f=fixture({quantity:3,direction,sortTransport:true});f.intentDirection=direction;const intent=sortRpcKeys(await ready(f));
    assert.deepEqual(Object.keys(intent.preset),Object.keys(intent.preset).sort());
    assert.deepEqual(Object.keys(intent.sourceBinding.fields),Object.keys(intent.sourceBinding.fields).sort());
    const submitted=await f.call({action:'submit',intent});assert.equal(submitted.status,'USER_MARKET_SUBMITTED_UNCONFIRMED',JSON.stringify(submitted));
    const verified=await f.call({action:'verify',intent,sourceBinding:f.binding});assert.equal(verified.status,'USER_MARKET_FILLED');assert.equal(verified.position.direction,direction);assert.equal(verified.position.quantity,3);assert.equal(verified.attribution.key,intent.key);
    assert.equal(f.s.buyClicks+f.s.sellClicks,1);assert.equal(f.s.mutations,0);assert.equal(verified.protectionVerified,false);
  }
});

test('key-order independence cannot accept added, missing or changed native preset keys, raw quantity or fingerprint',async()=>{
  for(const change of [p=>{p.extra=true;},p=>{p.extra=undefined;},p=>{delete p.scope;},p=>{delete p.fingerprint;},p=>{p.fingerprint+='x';},p=>{p.quantityRaw='03';},p=>{p.quantity='3';},p=>{p.bracketPresetVerified=true;},p=>{p.sourceControl+='x';}]){
    const f=fixture({quantity:3,sortTransport:true}),intent=await ready(f);change(intent.preset);
    const result=await f.call({action:'submit',intent});assert.equal(result.status,'BLOCKED');assert.deepEqual(result.reasonCodes,['USER_MARKET_NATIVE_PRESET_SOURCE_OR_ZERO_CHANGED']);assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(f.s.mutations,0);
  }
});

test('attributed SHORT fill accepts the native leading Unicode minus and preserves the observed signed position text',async()=>{
  const f=fixture({quantity:3,direction:'SHORT'});f.intentDirection='SHORT';const i=await ready(f);
  assert.equal((await f.call({action:'submit',intent:i})).status,'USER_MARKET_SUBMITTED_UNCONFIRMED');
  f.controls['position-DOM'].textContent='\u22123 @ 27,939.25';
  const result=await f.call({action:'verify',intent:i,sourceBinding:f.binding});
  assert.equal(result.status,'USER_MARKET_FILLED');assert.equal(result.position.quantity,3);assert.equal(result.position.direction,'SHORT');assert.equal(result.position.entry,27939.25);
  assert.equal(result.position.nativePositionText,'\u22123 @ 27,939.25');assert.equal(result.attribution.key,i.key);assert.equal(result.protectionVerified,false);assert.equal(f.s.sellClicks,1);assert.equal(f.s.mutations,0);
});

test('position verification does not convert missing-value dashes or malformed minus text into a quantity',async()=>{
  for(const text of ['—','—3 @ 27,939.25','–3 @ 27,939.25','3\u2212 @ 27,939.25','\u2212\u22123 @ 27,939.25','-\u22123 @ 27,939.25']){
    const f=fixture({quantity:3,direction:'SHORT'});f.intentDirection='SHORT';const i=await ready(f);await f.call({action:'submit',intent:i});
    f.controls['position-DOM'].textContent=text;const result=await f.call({action:'verify',intent:i,sourceBinding:f.binding});
    assert.equal(result.status,'UNKNOWNLOCK',text);assert.equal(result.fillVerified,false);assert.equal(f.s.sellClicks,1);assert.equal(f.s.mutations,0);
  }
});

test('source/quantity/quote changes, trusted activity, stale leases and disarm cannot submit the old frozen native preset',async()=>{
  for(const change of [f=>{f.s.quantityRaw='2';},f=>{f.cells.ARROW2_CHECKSUM_A.textContent='333';},f=>{f.prices[1].textContent='27939.5';},
    f=>{f.doc.fire('pointerdown');},f=>{f.s.perf+=751;},f=>{f.s.now+=751;},async f=>{await f.call({action:'disarm'});}]){
    const f=fixture(),i=await ready(f);await change(f);const r=await f.call({action:'submit',intent:i});assert.equal(r.status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(f.s.mutations,0);
  }
});

test('a fake native preset cannot replace a private source-bound lease and source performance epochs are not compared with DateNow',async()=>{
  const f=fixture(),i=await ready(f);delete i.leaseId;assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks,0);
  const skew=fixture();skew.context.performance.timeOrigin-=4655;const ok=await ready(skew);assert.equal((await skew.call({action:'submit',intent:ok})).status,'USER_MARKET_SUBMITTED_UNCONFIRMED');
});

test('technical checks, exact event identity and explicit non-TEST approval remain required independently of user budget settings',async()=>{
  for(const change of [i=>{i.technicalApproved=false;},i=>{i.testOnly=true;},i=>{i.approvalProof.requiredChecks[0].passed=false;},i=>{i.approvalProof.requiredFlags.requireEma=false;},
    i=>{i.approvalProof.technicalDecisionVersion='old';},i=>{i.sharedReservationKey+='x';},i=>{i.quantity=2;},i=>{i.preset.quantity=2;}]){
    const f=fixture(),i=await ready(f);change(i);assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  }
  const f=fixture(),i=await ready(f);i.userSettings={riskBudget:25,maxContracts:99};assert.equal((await f.call({action:'submit',intent:i})).status,'USER_MARKET_SUBMITTED_UNCONFIRMED');assert.equal(f.s.mutations,0);
});

test('Market entry requires at least one merged frozen setup still valid at the actual current quote for either direction',async()=>{
  for(const direction of ['LONG','SHORT']){
    const f=fixture({direction});f.intentDirection=direction;const i=await ready(f);i.technicalEntryWitness.setups[0].trigger=f.s.quote;
    assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  }
  const f=fixture(),i=await ready(f);i.approvalProof.sourceEventIds.push('second-merged-setup');
  i.technicalEntryWitness.sourceEventIds.push('second-merged-setup');i.technicalEntryWitness.setups[0].trigger=f.s.quote+1;
  i.technicalEntryWitness.setups.push({eventId:'second-merged-setup',trigger:f.s.quote-.25,structuralInvalidation:f.s.quote-10});
  i.technicalEntryWitness.eligibleSetupIds=['second-merged-setup'];const r=await f.call({action:'submit',intent:i});
  assert.equal(r.status,'USER_MARKET_SUBMITTED_UNCONFIRMED');assert.deepEqual(r.technicalEntryWitness.eligibleSetupIds,['second-merged-setup']);
  assert.equal(f.s.mutations,0);assert.equal(f.s.buyClicks,1);
});

test('technical entry witness cannot forge eligible setup IDs, structural levels, direction, current quote or source cut-off',async()=>{
  for(const change of [w=>{w.eligibleSetupIds=[];},w=>{w.eligibleSetupIds=['foreign'];},w=>{w.setups[0].eventId='foreign';},w=>{w.setups[0].trigger+=.01;},
    w=>{w.setups[0].structuralInvalidation=w.quote+1;},w=>{w.direction='SHORT';},w=>{w.quote+=.25;},w=>{w.asOfTime-=60000;},w=>{w.pricesAdjusted=true;}]){
    const f=fixture(),i=await ready(f);change(i.technicalEntryWitness);assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  }
});

test('a native quote or source change during durable reservation fails the final setup recheck before Market and cannot be retried',async()=>{
  for(const change of [f=>{f.prices[1].textContent=String(f.s.quote-1);},f=>{f.cells.ARROW2_CHECKSUM_A.textContent='999';},f=>{f.doc.fire('pointerdown');},f=>{f.s.perf+=751;},f=>{f.s.now+=751;}]){
    const f=fixture(),i=await ready(f);f.context.sessionStorage.setItem=(key,value)=>{f.storage.set(key,String(value));if(key==='arrow.userMarketAttempts.v1')change(f);};
    const r=await f.call({action:'submit',intent:i});assert.equal(r.status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);
    assert.equal(JSON.parse(f.storage.get('arrow.replayExecutionAttempts.v2')).entries[0].key,i.sharedReservationKey);
  }
});

test('old native Replay/Paper capabilities or unknown attempts block Market without clearing private state',async()=>{
  for(const expression of ["({busy:true})","({locked:true})","({prepared:{key:'old'}})","({lastSubmission:{key:'old'}})"]){
    const f=fixture();vm.runInContext("globalThis[Symbol.for('arrow.replay-trading-ui.v1')]="+expression,f.context);
    const r=await f.call({action:'read_preset',direction:'LONG',sourceBinding:f.binding});assert.equal(r.status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  }
  const f=fixture();vm.runInContext("globalThis[Symbol.for('arrow.paper-ui-driver.v1')]={prepared:{key:'paper'}}",f.context);
  assert.equal((await f.call({action:'read_preset',direction:'LONG',sourceBinding:f.binding})).status,'BLOCKED');
});

test('native shared old/new event ledgers prevent a second attempt even after isolated memory is replaced',async()=>{
  const f=fixture(),i=await ready(f);assert.equal((await f.call({action:'submit',intent:i})).submitted,true);
  const old=JSON.parse(f.storage.get('arrow.replayExecutionAttempts.v2'));assert.equal(old.entries[0].key,i.sharedReservationKey);
  vm.runInContext("delete globalThis[Symbol.for('arrow.user-market-ui.v1')]",f.context);f.controls['position-DOM'].textContent=f.controls['switch-pl-view'].textContent='—';
  const retry=await ready(f),r=await f.call({action:'submit',intent:retry});assert.equal(r.status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,1);
  const prior=fixture(),j=await ready(prior);prior.storage.set('arrow.replayExecutionAttempts.v2',JSON.stringify({version:2,entries:[{key:j.sharedReservationKey,at:prior.s.now,state:'ATTEMPTED'}]}));
  assert.equal((await prior.call({action:'submit',intent:j})).status,'BLOCKED');assert.equal(prior.s.buyClicks,0);
});

test('concurrent/reentrant submit and uncertain native click never trigger a blind retry or a second side click',async()=>{
  const f=fixture(),i=await ready(f);let nested;f.s.onClick=()=>{nested=f.call({action:'submit',intent:i});throw Error('native result uncertain');};
  const r=await f.call({action:'submit',intent:i});assert.equal(r.status,'UNKNOWNLOCK');assert.equal((await nested).status,'BLOCKED');assert.equal(f.s.buyClicks,1);
  assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks,1);
});

test('a click or matching caller position cannot establish fill without private submission and exact native direction/quantity',async()=>{
  const f=fixture(),i=await ready(f);assert.equal((await f.call({action:'verify',intent:i})).status,'BLOCKED');
  for(const change of [x=>{x.controls['position-DOM'].textContent='2 @ 27,939.25';},x=>{x.controls['position-DOM'].attrs.class='sell-LVepUlEY';},x=>{x.doc.fire('pointerdown');},x=>{x.doc.map.set('[role="dialog"]',[new x.Node()]);}]){
    const x=fixture(),j=await ready(x);await x.call({action:'submit',intent:j});change(x);const r=await x.call({action:'verify',intent:j});assert.equal(r.status,'UNKNOWNLOCK');assert.equal(r.fillVerified,false);assert.equal(x.s.buyClicks,1);
  }
});

test('wrong layouts, multiple charts, Replay off, Paper provider, nonflat states and collapsed native panels block before side clicks',async()=>{
  for(const change of [f=>{f.layout.attrs['aria-label']='Active layout: Personal charts';},f=>{f.doc.map.set('canvas[aria-label^="Chart for "]',[f.chart,f.chart]);},
    f=>{f.replay.attrs['aria-pressed']='false';},f=>{f.provider.textContent='Paper Trading';},f=>{f.controls['position-DOM'].textContent='1 @ 27,939.25';},
    f=>{f.controls['cancel-all-buy-orders'].disabled=false;},f=>{f.panel.width=0;},f=>{f.s.quantityRaw='0';},f=>{f.s.quantityRaw='1.5';}]){
    const f=fixture();change(f);const r=await f.call({action:'read_preset',direction:'LONG',sourceBinding:f.binding});assert.equal(r.status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  }
});

test('no command edits native quantity/SLTP, guesses a full preset, or implements position-management actions',async()=>{
  const f=fixture();for(const action of ['move_stop','remove_stop','set_quantity','flatten','reverse','cancel_all'])assert.equal((await f.call({action})).status,'BLOCKED');
  assert.equal(f.s.mutations,0);assert.equal(f.s.buyClicks+f.s.sellClicks,0);
  assert.equal((await f.call({action:'read_preset',direction:'LONG'})).status,'BLOCKED');
});

test('explicit Arrow research multichart policy selects the unique NQ one-minute canvas without touching the other charts',async()=>{
  const f=fixture({quantity:3});f.expected.allowResearchMultiChart=true;
  const first=new f.Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),third=new f.Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'});
  f.doc.map.set('canvas[aria-label^="Chart for "]',[first,f.chart,third]);
  const observed=await f.call({action:'read_controls'});assert.equal(observed.status,'USER_MARKET_CONTROLS_OBSERVED');assert.equal(observed.visibleCharts,3);assert.equal(observed.researchSelection.targetCharts,1);assert.equal(observed.researchSelection.selectedChartLabel,'Chart for CME_MINI:NQ1!, 1 minute');
  const i=await ready(f),submitted=await f.call({action:'submit',intent:i});assert.equal(submitted.status,'USER_MARKET_SUBMITTED_UNCONFIRMED');assert.equal(f.s.buyClicks,1);assert.equal(f.s.mutations,0);
  assert.equal(first.getAttribute('aria-label'),'Chart for CME_MINI:NQ1!, 5 minutes');assert.equal(third.getAttribute('aria-label'),'Chart for CME_MINI:NQ1!, 1 second');
});

test('multichart consent never permits personal layouts, unpinned URLs, other symbols, duplicate targets or a different active interval',async()=>{
  for(const edit of [f=>{delete f.expected.allowResearchMultiChart;},f=>{f.expected.allowResearchMultiChart='true';},f=>{f.layout.attrs['aria-label']='Logged in as test Active layout: PERSONAL';},f=>{f.context.location.pathname='/chart/PersonalNew/';},f=>{f.interval.attrs['data-value']='5';},f=>{f.doc.map.get('canvas[aria-label^="Chart for "]')[0].attrs['aria-label']='Chart for CME:BTC1!, 5 minutes';},f=>{f.doc.map.get('canvas[aria-label^="Chart for "]')[0].attrs['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';},f=>{f.doc.map.get('canvas[aria-label^="Chart for "]').push(new f.Node({'aria-label':'Chart for CME_MINI:NQ1!, 15 minutes'}));}]){
    const f=fixture();f.expected.allowResearchMultiChart=true;f.doc.map.set('canvas[aria-label^="Chart for "]',[new f.Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.chart,new f.Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})]);edit(f);
    const r=await f.call({action:'read_preset',direction:'LONG',sourceBinding:f.binding});assert.equal(r.status,'BLOCKED',edit.toString());assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(f.s.mutations,0);
  }
});

function useStrategy(intent,profileId='CANDLE_TREND_AT_ZONE'){
  const p=GUIDE_STRATEGY_PROFILES.find(profile=>profile.id===profileId),a=intent.approvalProof;a.approvalPolicy='guide_scenarios_v1';delete a.requiredFlags;
  a.requiredChecks=p.requiredCheckIds.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'}));
  a.strategyProofs=[{profileId,requiredCheckIds:[...p.requiredCheckIds],requiredChecks:p.requiredCheckIds.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),sourceEventIds:[...a.sourceEventIds]}];return intent;
}

test('serialized native strategy catalogue exactly matches every authoritative public profile requirement',()=>{
  const match=/const strategyProfiles=(\{[\s\S]*?\n    \});/.exec(userMarketTradingUiCommand.toString());assert.ok(match,'self-contained public native catalogue literal');
  const native=JSON.parse(JSON.stringify(vm.runInNewContext('('+match[1]+')'))),expected=Object.fromEntries(GUIDE_STRATEGY_PROFILES.map(p=>[p.id,[...p.requiredCheckIds]]));assert.deepEqual(native,expected);assert.equal(Object.keys(native).length,18);
});

test('each explicit strategy can submit with its own required conditions while other context diagnostics remain optional',async()=>{
  for(const profile of GUIDE_STRATEGY_PROFILES){
    const f=fixture({quantity:3}),i=useStrategy(await ready(f),profile.id),r=await f.call({action:'submit',intent:i});
    assert.equal(r.status,'USER_MARKET_SUBMITTED_UNCONFIRMED',profile.id+': '+JSON.stringify(r));assert.equal(f.s.buyClicks,1);assert.equal(f.s.mutations,0);assert.equal(i.approvalProof.requiredFlags,undefined);
    assert.ok(i.approvalProof.requiredChecks.length<7,'not a disguised global seven-check AND');
  }
});

test('unknown strategy policy, wrong profile requirements, incomplete checks and invalid source partitions cannot reach Market',async()=>{
  for(const edit of [a=>{a.approvalPolicy='unknown_policy';},a=>{a.strategyProofs=[];},a=>{a.strategyProofs[0].profileId='UNKNOWN_PROFILE';},a=>{a.strategyProofs[0].requiredCheckIds.pop();},a=>{a.strategyProofs[0].requiredCheckIds.reverse();},a=>{a.strategyProofs[0].requiredChecks.pop();},a=>{a.strategyProofs[0].requiredChecks[0].passed=false;},a=>{a.strategyProofs[0].requiredChecks[0].available=false;},a=>{a.strategyProofs[0].requiredChecks[0].required=false;},a=>{a.strategyProofs[0].requiredChecks[0].state='FAIL';},a=>{a.strategyProofs[0].requiredChecks[0].pendingConfirmation=true;},a=>{a.requiredChecks.pop();},a=>{a.requiredChecks.push({id:'FIB',required:true,enabled:true,available:true,passed:true,state:'PASS'});},a=>{a.requiredChecks[0].passed=false;},a=>{a.strategyProofs[0].sourceEventIds=['foreign'];},a=>{a.strategyProofs[0].sourceEventIds=[];},a=>{a.strategyProofs[0].sourceEventIds.push(a.strategyProofs[0].sourceEventIds[0]);},a=>{a.sourceEventIds.push('uncovered-source');},a=>{a.strategyProofs.push(structuredClone(a.strategyProofs[0]));}]){
    const f=fixture(),i=useStrategy(await ready(f));edit(i.approvalProof);const r=await f.call({action:'submit',intent:i});assert.equal(r.status,'BLOCKED',edit.toString());assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(f.s.mutations,0);
  }
});

test('multiple strategies must prove every required condition and form a disjoint complete source-event partition',async()=>{
  const f=fixture(),i=useStrategy(await ready(f)),a=i.approvalProof,p=GUIDE_STRATEGY_PROFILES.find(p=>p.id==='ENGULFING_EMA');
  a.sourceEventIds.push('second-profile-event');a.strategyProofs.push({profileId:p.id,requiredCheckIds:[...p.requiredCheckIds],requiredChecks:p.requiredCheckIds.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),sourceEventIds:['second-profile-event']});
  a.requiredChecks.push({id:'EMA',required:true,enabled:true,available:true,passed:true,state:'PASS'});
  i.technicalEntryWitness.sourceEventIds.push('second-profile-event');i.technicalEntryWitness.eligibleSetupIds.push('second-profile-event');i.technicalEntryWitness.setups.push({...i.technicalEntryWitness.setups[0],eventId:'second-profile-event'});
  assert.equal((await f.call({action:'submit',intent:i})).status,'USER_MARKET_SUBMITTED_UNCONFIRMED');assert.equal(f.s.buyClicks,1);
  for(const overlap of [false,true]){
    const q=fixture(),other=useStrategy(await ready(q));other.approvalProof.strategyProofs.push({profileId:p.id,requiredCheckIds:[...p.requiredCheckIds],requiredChecks:p.requiredCheckIds.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),sourceEventIds:[overlap?'source-pattern-event':'unproven-source']});
    assert.equal((await q.call({action:'submit',intent:other})).status,'BLOCKED');assert.equal(q.s.buyClicks,0);
  }
});

test('explicit synthetic or TEST flags at either serialized intent or approval proof boundary cannot reach Market',async()=>{
  for(const edit of [i=>{i.synthetic=true;},i=>{i.approvalProof.testOnly=true;},i=>{i.approvalProof.synthetic=true;}]){
    const f=fixture(),i=useStrategy(await ready(f));edit(i);assert.equal((await f.call({action:'submit',intent:i})).status,'BLOCKED');assert.equal(f.s.buyClicks+f.s.sellClicks,0);assert.equal(f.s.mutations,0);
  }
});
