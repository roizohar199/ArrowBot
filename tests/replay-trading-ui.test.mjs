import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {replayTradingUiCommand} from '../replay-trading-ui.mjs';
import {planGuideRisk} from '../guide-risk.mjs';

// Public control names are transcribed from replay-ticket-inspection.json.
// This is a synthetic DOM component fixture, not an actual UI, engine signal,
// natural market event, Replay order registration, fill or protection proof.
function fixture(){
  const state={now:Date.UTC(2026,10,15,7),perf:0,side:'Buy',type:'LIMIT',quote:28369,submitClicks:0,sideClicks:0,mutations:0,focuses:0,blurs:0,onFrame:null,onInput:null};
  class Node{
    constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.isConnected=true;this.shown=true;this.selectors=new Map();this.children=[];this.disabled=false;this.readOnly=false;this.clickHandler=null;}
    get innerText(){return this.textContent;}get id(){return this.attrs.id??'';}
    getAttribute(key){return this.attrs[key]??null;}setAttribute(key,value){this.attrs[key]=String(value);}
    getClientRects(){return this.shown?[{width:this.rectWidth??100,height:this.rectHeight??30}]:[];}
    getBoundingClientRect(){const left=this.rectLeft??0,top=this.rectTop??0,width=this.rectWidth??100,height=this.rectHeight??30;return {left,top,width,height,right:left+width,bottom:top+height};}
    querySelectorAll(selector){const value=this.selectors.get(selector)??[];return typeof value==='function'?value():value;}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    click(){this.clickHandler?.();}focus(){state.focuses++;doc.activeElement=this;}blur(){if(doc.activeElement===this){doc.activeElement=null;state.blurs++;}}dispatchEvent(event){
      if(['input','change'].includes(event.type)){state.mutations++;state.onInput?.(this);refresh();}this.eventHandler?.(event);if(event.type==='click')this.clickHandler?.();return true;}
  }
  class Input extends Node{
    constructor(attrs,value){super(attrs);this._value=String(value);this.checked=false;}
    get value(){return this._value;}set value(value){this._value=String(value);}
  }
  const doc=new Node();doc.visibilityState='visible';doc.hidden=false;doc.listeners=new Map();
  doc.addEventListener=(type,listener)=>{const listeners=doc.listeners.get(type)??[];listeners.push(listener);doc.listeners.set(type,listeners);};
  doc.fireActivity=(type,isTrusted=true)=>{for(const listener of doc.listeners.get(type)??[])listener({type,isTrusted});};
  const layout=new Node({'aria-label':'Logged in as component Active layout: Arrow Replay research'}),
    chart=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),replay=new Node({'aria-pressed':'true'}),footer=new Node(),
    provider=new Node({'aria-label':'Collapse Replay Trading','data-qa-id':'replay_trading'},'Replay Trading'),brokerIcon=new Node(),
    panel=new Node({'aria-label':'Trading panel'}),ticket=new Node({'aria-label':'Order ticket'}),symbol=new Node({title:'NQ1!'}),
    dataTab=new Node({'aria-selected':'true'},'Data window'),study=new Node(),header=new Node({title:'Arrow OHLC Window v2 (100, 5, 15, 104)'});
  const entry=new Input({},28368.75),quantity=new Input({'aria-label':'Units'},1),stop=new Input({},28362.5),target=new Input({},28387.5);
  stop.readOnly=true;target.readOnly=true;
  const buy=new Node({'data-name':'side-control-buy'}),sell=new Node({'data-name':'side-control-sell'}),
    limit=new Node({role:'tab','aria-selected':'true'},'Limit'),market=new Node({role:'tab','aria-selected':'false'},'Market'),
    stopMode=new Node({},'Stop loss price'),targetMode=new Node({},'Take profit price'),submit=new Node({'data-name':'place-and-modify-button'}),
    stopToggle=new Input({'aria-checked':'false'},''),targetToggle=new Input({'aria-checked':'false'},'');
  buy.clickHandler=()=>{state.side='Buy';state.sideClicks++;refresh();};sell.clickHandler=()=>{state.side='Sell';state.sideClicks++;refresh();};
  limit.clickHandler=()=>{state.type='LIMIT';refresh();};market.clickHandler=()=>{state.type='MARKET';refresh();};
  submit.clickHandler=()=>{state.submitClicks++;};
  stopToggle.clickHandler=()=>{stopToggle.checked=!stopToggle.checked;stopToggle.attrs['aria-checked']=String(stopToggle.checked);stop.readOnly=!stopToggle.checked;};
  targetToggle.clickHandler=()=>{targetToggle.checked=!targetToggle.checked;targetToggle.attrs['aria-checked']=String(targetToggle.checked);target.readOnly=!targetToggle.checked;};
  function refresh(){
    buy.textContent='Buy '+state.quote.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});sell.textContent='Sell '+state.quote.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    submit.textContent=state.side+' 1 NQ1! @ '+Number(entry.value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+state.type;
    ticket.textContent='Tick value 5.00 USD '+submit.textContent;
    limit.attrs['aria-selected']=String(state.type==='LIMIT');market.attrs['aria-selected']=String(state.type==='MARKET');
  }
  refresh();
  const controlList=[buy,sell,limit,market,stopMode,targetMode,submit];
  for(const [selector,nodes] of [
    ['[role="dialog"]',[]],['[aria-label^="Logged in as"]',[layout]],['canvas[aria-label^="Chart for "]',[chart]],
    ['#header-toolbar-replay',[replay]],['#footer-chart-panel',[footer]],
    ['[aria-label="Account manager"],[data-qa-id="account-selector"]',[]],
    ['button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]',[brokerIcon]],
    ['[aria-label="Trading panel"]',[panel]],['[role="tab"][aria-selected="true"]',[dataTab]],
    ['[role="treegrid"] [role="row"][data-role="menuitem"]',[study]],['table[data-name]',[]]
  ])doc.selectors.set(selector,nodes);
  footer.selectors.set('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',[provider]);
  panel.selectors.set('[aria-label="Order ticket"]',[ticket]);panel.selectors.set('[title]',[symbol]);
  panel.selectors.set('button,[role="button"],[role="tab"]',()=>controlList);
  study.selectors.set('span[title]',[header]);
  const epoch=state.now-60000,currentTime=Date.UTC(2026,10,13,18),sequence=0,
    sourceFields={ARROW2_RUN_EPOCH:String(epoch),ARROW2_SEQ_BEGIN:'0',ARROW2_SEQ_END:'0',
      ARROW2_CURRENT_TIME:String(currentTime-1577836800000),ARROW2_CURRENT_CLOSE_TIME:'492',ARROW2_CHECKSUM_A:'424242',ARROW2_CHECKSUM_B:'656565'};
  const fieldValues={};
  for(const [key,value] of Object.entries(sourceFields)){
    const title=new Node({'data-test-id-value-title':key},key),cell=new Node({},value),parent=new Node();
    parent.children=[title,cell];title.parentElement=parent;cell.parentElement=parent;fieldValues[key]=cell;
    study.selectors.set(`[data-test-id-value-title="${key}"]`,[title]);
  }
  ticket.selectors.set('[data-name="side-control-buy"]',[buy]);ticket.selectors.set('[data-name="side-control-sell"]',[sell]);
  ticket.selectors.set('[role="tab"][aria-selected="true"]',()=>state.type==='LIMIT'?[limit]:[market]);
  ticket.selectors.set('[data-qa-id="order-ticket-stop-loss-checkbox-bracket"]',[stopToggle]);
  ticket.selectors.set('[data-qa-id="order-ticket-take-profit-checkbox-bracket"]',[targetToggle]);
  ticket.selectors.set('button,[role="button"],[role="tab"]',()=>controlList);
  ticket.selectors.set('input[data-qa-id~="order-ticket-absolute-price-input"]',[entry]);
  ticket.selectors.set('input[aria-label="Units"]',[quantity]);
  ticket.selectors.set('input[data-qa-id~="order-ticket-stop-loss-input"]',[stop]);
  ticket.selectors.set('input[data-qa-id~="order-ticket-take-profit-input"]',[target]);
  ticket.selectors.set('[data-name="place-and-modify-button"]',[submit]);
  const expected={researchUrl:'https://www.tradingview.com/chart/research-fixture/',sourceTabId:17,instrument:'CME_MINI:NQ1!',timeframe:'1'};
  const draft={direction:'LONG',quantity:1,entry:28368.75,stop:28359.5,target:28387.25,commissionPerContract:3.1,slippageTicks:2};
  const sourceBinding={sourceTabId:17,runEpoch:epoch,runId:'CME_MINI:NQ1!|1|'+epoch,sequence,currentTime,currentCloseTime:currentTime+60000,
    asOfTime:currentTime+60000,eventId:'CME_MINI:NQ1!:1:'+(currentTime+60000)+':LONG',closedBarRole:'current',fields:sourceFields};
  const riskPlan=planGuideRisk({direction:'LONG',entry:draft.entry,stop:draft.stop,target:draft.target,
    tickSize:.25,pointValue:20,riskBudget:200,maxContracts:1,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2});
  const intent={kind:'TRADINGVIEW_REPLAY_TRADING_LIMIT_INTENT',definitionVersion:'replay-execution-intent-2',provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',
    scope:'VIRTUAL_REPLAY_TRADING_INTENT_ONLY',unsigned:true,signalApproved:true,testOnly:false,submissionAuthorized:false,
    ordersCreated:false,orderEligible:false,realBrokerOrdersAuthorized:false,requiresReplayUiRevalidation:true,quantity:1,orderType:'LIMIT',symbol:'NQ1!',
    instrument:'CME_MINI:NQ1!',timeframe:'1',direction:'LONG',entry:draft.entry,stop:draft.stop,target:draft.target,stopTicks:37,targetTicks:74,
    stopMode:'PRICE',targetMode:'PRICE',preparedAt:state.now,expiresAt:state.now+2000,researchUrl:expected.researchUrl,sourceBinding,riskPlan,
    quoteProof:{kind:'PASSIVE_NATIVE_REPLAY_QUOTE',quote:state.quote,bid:state.quote,ask:state.quote,sourceCurrentClose:state.quote,documentTimeOrigin:state.now-300000,observedAt:state.now,minimumDistanceTicks:1,distanceTicks:1,pricesAdjusted:false},
    pendingPolicy:{kind:'KNOWN_PARENT_ONLY_CLOSED_REPLAY_BAR_EXPIRY',expiresAfterClosedBars:3,afterConfirmationClose:sourceBinding.asOfTime,
      expiresAtReplayCloseTime:sourceBinding.asOfTime+180000,cancelOnlyWhileReplayPaused:true,neverCancelAll:true},
    approvalProof:{engineDefinitionVersion:'guide-signals-5',eventId:sourceBinding.eventId,asOfTime:sourceBinding.asOfTime,direction:'LONG',
      confirmationPolicy:'later_close_beyond_setup',detectedAt:sourceBinding.asOfTime-60000,confirmationBarCloseTime:sourceBinding.asOfTime,signalApproved:true,testOnly:false,
      requiredFlags:Object.fromEntries(['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'].map(key=>[key,true])),
      roleReversalEnabled:true,supplyDemandEnabled:true,requiredChecks:['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'].map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'}))}};
  intent.key=['replay-execution-intent-2',intent.researchUrl,17,sourceBinding.runId,sourceBinding.asOfTime,sourceBinding.eventId].map(encodeURIComponent).join(':');
  const context=vm.createContext({document:doc,location:{protocol:'https:',hostname:'www.tradingview.com',origin:'https://www.tradingview.com',pathname:'/chart/research-fixture/'},
    Date:class extends Date{static now(){return state.now;}},URL,HTMLInputElement:Input,Event:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},
    MouseEvent:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},PointerEvent:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},
    WheelEvent:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},
    getComputedStyle:node=>({visibility:node.shown?'visible':'hidden',overflowX:node.overflowX??'visible',overflowY:node.overflowY??'visible',display:node.display??'block'}),performance:{now:()=>state.perf,timeOrigin:state.now-300000},
    requestAnimationFrame:callback=>{queueMicrotask(()=>{state.perf++;state.now++;state.onFrame?.();callback(state.perf);});},
    setTimeout:(callback,ms)=>{state.perf+=ms;state.now+=ms;queueMicrotask(()=>{state.onTimer?.();callback();});}});
  const call=async(command={})=>{context.command={expected,...command};const value=await vm.runInContext('('+replayTradingUiCommand.toString()+')(command)',context);return JSON.parse(JSON.stringify(value));};
  return {state,doc,layout,chart,replay,provider,brokerIcon,panel,ticket,stopMode,targetMode,entry,quantity,stop,target,
    stopToggle,targetToggle,submit,expected,draft,intent,sourceBinding,sourceFields,fieldValues,controlList,Node,context,call,
    setQuote:value=>{state.quote=value;refresh();}};
}

test('public Replay read identifies the actual control contract but does not invent a flat account from missing tables',async()=>{
  const f=fixture(),r=await f.call({action:'read',sourceBinding:f.sourceBinding});
  assert.equal(r.status,'REPLAY_TRADING_UI_INCOMPLETE');assert.equal(r.provider,'REPLAY_TRADING');
  assert.equal(r.flat,null);assert.equal(r.positions,null);assert.equal(r.workingOrders,null);
  assert.equal(r.ticket.symbol,'NQ1!');assert.equal(r.ticket.entry,28368.75);assert.equal(r.ticket.quote,28369);
  assert.equal(r.ticket.stopMode,'PRICE');assert.equal(r.ticket.stopEnabled,false);assert.equal(r.ticket.tickValue,5);
  assert.equal(r.sourceBinding.eventId,f.sourceBinding.eventId);assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
});

test('TEST draft prepares absolute SL/TP prices and one unit without any submission capability',async()=>{
  const f=fixture(),r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(r.status,'TICKET_PREPARED_TEST');assert.equal(r.signalApproved,false);assert.equal(r.submitCapabilityCreated,false);
  assert.equal(Number(f.entry.value),28368.75);assert.equal(Number(f.stop.value),28359.5);assert.equal(Number(f.target.value),28387.25);
  assert.equal(Number(f.quantity.value),1);assert.equal(f.stopToggle.checked,true);assert.equal(f.targetToggle.checked,true);
  assert.equal(r.evidence.ticket.stopTicks,37);assert.equal(r.evidence.ticket.targetTicks,74);
  assert.equal(f.state.submitClicks,0);assert.equal(r.ordersCreated,false);
  assert.equal(r.executionConstraint.minimumDistanceTicks,1);assert.equal(r.executionConstraint.pricesAdjustedByDriver,false);
  const rejected=await f.call({action:'submit',testOnly:false,intent:f.intent});
  assert.equal(rejected.status,'BLOCKED');assert.deepEqual(rejected.reasonCodes,['REPLAY_APPROVED_EXECUTION_SEQUENCE_REQUIRED']);
  assert.equal(f.state.submitClicks,0);
});

test('native form writes use actual focus before input/change and actual blur before reporting a settled TEST draft',async()=>{
  const f=fixture();let focusedEdits=0;
  f.state.onInput=input=>{assert.equal(f.doc.activeElement,input);focusedEdits++;};
  const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(r.status,'TICKET_PREPARED_TEST');assert.equal(focusedEdits,8);
  assert.equal(f.state.focuses,6);assert.equal(f.state.blurs,6);assert.equal(f.doc.activeElement,null);
  assert.equal(f.state.submitClicks,0);assert.equal(r.executionConstraint.registeredBracketsVerified,false);
});

test('marketable and equal-price LIMIT entries are rejected before edits without repricing approved or TEST plans',async()=>{
  for(const [direction,quote] of [['LONG',28368.75],['LONG',28368.5],['SHORT',28368.75],['SHORT',28369]]){
    const f=fixture();f.draft.direction=direction;
    if(direction==='SHORT'){f.draft.stop=f.draft.entry+9.25;f.draft.target=f.draft.entry-18.5;}
    const original=JSON.stringify(f.draft);f.setQuote(quote);
    const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
    assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['MARKETABLE_LIMIT_BRACKET_UNSAFE']);
    assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.focuses,0);assert.equal(f.state.submitClicks,0);
    assert.equal(JSON.stringify(f.draft),original);assert.equal(Number(f.entry.value),f.draft.entry);
  }
});

test('strict passive LONG below quote and SHORT above quote are allowed at the exact one-tick boundary',async()=>{
  for(const direction of ['LONG','SHORT']){
    const f=fixture();f.draft.direction=direction;
    if(direction==='SHORT'){f.draft.stop=f.draft.entry+9.25;f.draft.target=f.draft.entry-18.5;f.setQuote(f.draft.entry-.25);}
    else f.setQuote(f.draft.entry+.25);
    const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
    assert.equal(r.status,'TICKET_PREPARED_TEST');assert.equal(r.executionConstraint.distanceTicks,1);
    assert.equal(Number(f.entry.value),f.draft.entry);assert.equal(Number(f.stop.value),f.draft.stop);assert.equal(Number(f.target.value),f.draft.target);
    assert.equal(f.state.submitClicks,0);assert.equal(r.submitCapabilityCreated,false);
  }
});

test('a quote that drifts across the frozen limit during preparation aborts instead of changing entry or granting submission',async()=>{
  const f=fixture();f.state.onFrame=()=>{f.setQuote(f.draft.entry);};
  const original=JSON.stringify(f.draft),r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['MARKETABLE_LIMIT_BRACKET_UNSAFE']);
  assert.equal(f.state.sideClicks,1);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);assert.equal(JSON.stringify(f.draft),original);
});

test('a lost focus or replaced input before native blur commit cannot be reported as settled preparation',async()=>{
  const f=fixture();f.state.onFrame=()=>{if(f.doc.activeElement===f.entry)f.doc.activeElement=null;};
  const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['REPLAY_FOCUSED_INPUT_REPLACED_BEFORE_COMMIT']);assert.equal(f.state.submitClicks,0);
});

test('strict natural intent remains blocked on complete pending inventory after mechanical bracket preservation was independently verified',async()=>{
  const f=fixture(),r=await f.call({action:'prepare',testOnly:false,intent:f.intent});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['REPLAY_APPROVED_EXECUTION_SEQUENCE_REQUIRED']);
  assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
});

// This schema is transcribed from the actual existing-parent public captures
// verification/0.18.0/registered-parent-{public,header}-dom.json. These fixture
// tests remain synthetic; the actual captures carry the registration evidence.
function registeredFixture(){
  const f=fixture(),orderId='order_76342874-b3a5-4f0a-bf25-50dff6e2e9b1',
    title=new f.Node({title:'NQ1!, order '+orderId},'NQ1!, order '+orderId),
    logo=new f.Node({src:'https://static.tradingview.com/static/bundles/replay-broker.b8d7b478b6b3548063d9.svg'}),
    description=new f.Node({class:'description-eXazYeWn'},'Buy Limit 1 @ 27,720.50'),
    orderPanel=new f.Node({'data-name':'order-panel'}),discard=new f.Node({'data-name':'button-back'},'Discard');
  f.panel.selectors.set('[title]',[title]);f.panel.selectors.set('img[src]',[logo]);
  f.panel.selectors.set('div[class*="description-"]',[description]);f.panel.selectors.set('[data-name="order-panel"]',[orderPanel]);
  f.entry.value=27720.5;f.stop.value=27711.25;f.target.value=27739;
  f.stopToggle.checked=f.targetToggle.checked=true;f.stopToggle.attrs['aria-checked']=f.targetToggle.attrs['aria-checked']='true';
  f.stop.readOnly=f.target.readOnly=false;
  f.submit.textContent='Confirm';f.submit.attrs['aria-disabled']='true';f.submit.disabled=false;
  f.ticket.selectors.set('[role="tab"][aria-selected="true"]',[]);
  f.ticket.selectors.set('[data-name="side-control-buy"]',[]);f.ticket.selectors.set('[data-name="side-control-sell"]',[]);
  f.ticket.selectors.set('[data-name="button-back"]',[discard]);
  f.ticket.selectors.set('button,[role="button"],[role="tab"]',[f.stopMode,f.targetMode,f.submit,discard]);
  f.ticket.textContent='Price Quantity type Units 185.00 USD risk Tick value 5.00 USD Exits Take profit price 74 ticks Stop loss price 37 ticks Risk / Reward 2 Confirm Discard';
  const expectedPlan={direction:'LONG',quantity:1,entry:27720.5,stop:27711.25,target:27739,commissionPerContract:3.1,slippageTicks:2};
  return {...f,orderId,title,logo,description,orderPanel,discard,expectedPlan};
}

test('actual existing-parent schema independently verifies registered bracket configuration without order tabs or a fresh Buy draft',async()=>{
  const f=registeredFixture(),r=await f.call({action:'read',expectedPlan:f.expectedPlan});
  assert.equal(r.status,'REPLAY_TRADING_UI_INCOMPLETE');assert.equal(r.registeredParent.status,'REGISTERED_PARENT_BRACKETS_VERIFIED');
  assert.equal(r.registeredParent.orderId,f.orderId);assert.equal(r.registeredParent.configurationVerified,true);
  assert.equal(r.registeredParent.expectedPlanComparison.matches,true);assert.equal(r.registeredParent.expectedPlanComparison.totalPlannedRisk,198.1);
  assert.equal(r.registeredParent.confirmDisabled,true);assert.equal(f.submit.disabled,false);
  assert.equal(r.ticket.stage,'REGISTERED_PARENT_MODIFY');assert.equal(r.ticket.type,'LIMIT');
  assert.equal(r.registeredParent.stopTicks,37);assert.equal(r.registeredParent.targetTicks,74);
  assert.equal(r.flat,null);assert.equal(r.workingOrders,null);assert.equal(r.atomicBracketSubmissionVerified,false);
  assert.equal(r.registeredParent.fillVerified,false);assert.equal(r.registeredParent.protectionVerified,false);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);
});

test('read-only registered-parent verification distinguishes unsaved editor values from a persisted parent',async()=>{
  for(const change of [f=>{f.submit.attrs['aria-disabled']='false';},f=>{f.submit.textContent='Buy 1 NQ1! @ 27,720.50 LIMIT';},
    f=>{f.discard.attrs['aria-disabled']='true';},f=>{f.stopToggle.checked=false;},f=>{f.targetToggle.attrs['aria-checked']='false';},
    f=>{f.quantity.value=2;},f=>{f.description.textContent='Buy Limit 1 @ 27,720.75';},f=>{f.stopMode.textContent='Stop loss ticks';}]){
    const f=registeredFixture();change(f);const r=await f.call({action:'read',expectedPlan:f.expectedPlan});
    assert.equal(r.registeredParent.configurationVerified,false);assert.equal(r.registeredParent.status,'REGISTERED_PARENT_UNVERIFIED');
    assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('registered-parent identity requires its actual UUID, Replay logo and unique native description',async()=>{
  for(const change of [f=>{f.title.attrs.title='NQ1!, order order_test';},f=>{f.logo.attrs.src='https://static.tradingview.com/static/bundles/paper-broker.svg';},
    f=>{f.logo.attrs.src='https://evil.example/static/bundles/replay-broker.a.svg';},f=>{f.panel.selectors.set('div[class*="description-"]',[f.description,f.description]);},
    f=>{f.panel.selectors.set('[data-name="order-panel"]',[]);},f=>{f.panel.selectors.set('[title]',[f.title,f.title]);}]){
    const f=registeredFixture();change(f);const r=await f.call({action:'read'});assert.equal(r.status,'BLOCKED');
    assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('an existing parent is never mutated by TEST preparation and cannot grant a natural submit capability',async()=>{
  const f=registeredFixture(),r=await f.call({action:'prepare',testOnly:true,testDraft:f.expectedPlan});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['REPLAY_EXISTING_PARENT_IS_READ_ONLY']);
  assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
  const submit=await f.call({action:'submit',testOnly:false,intent:f.intent});assert.equal(submit.status,'BLOCKED');
  assert.equal(f.state.submitClicks,0);
});

test('registered-parent comparison never accepts another stop or fee budget as the caller plan',async()=>{
  const f=registeredFixture(),changed={...f.expectedPlan,stop:f.expectedPlan.stop+.25},r=await f.call({action:'read',expectedPlan:changed});
  assert.equal(r.registeredParent.configurationVerified,false);assert.equal(r.registeredParent.expectedPlanComparison.matches,false);
  assert.ok(r.registeredParent.reasonCodes.includes('REPLAY_REGISTERED_PARENT_PLAN_MISMATCH'));
  const over=await f.call({action:'read',expectedPlan:{...f.expectedPlan,commissionPerContract:20}});
  assert.equal(over.status,'BLOCKED');assert.deepEqual(over.reasonCodes,['REPLAY_ONE_NQ_TOTAL_RISK_EXCEEDS_200']);
  assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
});

test('an existing-parent read with no caller plan proves no total-risk budget, fill, flatness or active position protection',async()=>{
  const f=registeredFixture(),r=await f.call({action:'verify'});
  assert.equal(r.status,'UNKNOWN');assert.equal(r.evidence.registeredParent.configurationVerified,true);
  assert.equal(r.evidence.registeredParent.expectedPlanComparison,null);assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
  assert.equal(r.evidence.positions,null);assert.equal(r.evidence.workingOrders,null);assert.equal(r.evidence.flat,null);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
});

function positionFixture(){
  const f=registeredFixture();
  f.title.attrs.title='NQ1!';f.title.textContent='NQ1!';f.description.textContent='Long 1 @ 27,720.50';
  f.panel.selectors.set('[aria-label="Order ticket"]',[]);f.panel.selectors.set('[data-name="order-panel"]',[]);
  f.panel.selectors.set('[data-name="position-panel"]',[f.ticket]);
  f.ticket.selectors.set('input[data-qa-id~="order-ticket-absolute-price-input"]',[]);
  f.ticket.selectors.set('input[aria-label="Units"]',[]);
  const tradeValue=new f.Node({'data-qa-id':'position-info-trade-value'},'554,410.00'),
    tradeCurrency=new f.Node({'data-qa-id':'position-info-trade-value-currency'},'USD'),
    tickValue=new f.Node({'data-qa-id':'position-info-pip-value'},'5.00'),
    tickCurrency=new f.Node({'data-qa-id':'position-info-pip-value-currency'},'USD');
  for(const node of [tradeValue,tradeCurrency,tickValue,tickCurrency])f.ticket.selectors.set(`[data-qa-id="${node.attrs['data-qa-id']}"]`,[node]);
  f.ticket.textContent='Exits Take profit price 74 ticks Stop loss price 37 ticks Risk / Reward 2 Trade value 554,410.00 USD Tick value 5.00 USD Confirm Discard';
  return {...f,tradeValue,tradeCurrency,tickValue,tickCurrency};
}

test('actual post-fill position-panel schema verifies existing one-NQ protection and198.10 planned risk without modifying or attaching exits',async()=>{
  const f=positionFixture(),r=await f.call({action:'verify',expectedPlan:f.expectedPlan});
  assert.equal(r.status,'PROTECTED_POSITION_VERIFIED');assert.equal(r.fillVerified,true);assert.equal(r.protectionVerified,true);
  assert.equal(r.evidence.ticket.stage,'EXISTING_POSITION_PROTECTION');assert.equal(r.evidence.ticket.type,'POSITION');
  assert.equal(r.evidence.protectedPosition.entry,27720.5);assert.equal(r.evidence.protectedPosition.quantity,1);
  assert.equal(r.evidence.protectedPosition.stop,27711.25);assert.equal(r.evidence.protectedPosition.target,27739);
  assert.equal(r.evidence.protectedPosition.stopTicks,37);assert.equal(r.evidence.protectedPosition.targetTicks,74);
  assert.equal(r.evidence.protectedPosition.grossStopRisk,185);assert.equal(r.evidence.protectedPosition.totalPlannedRisk,198.1);
  assert.equal(r.evidence.protectedPosition.naturalSignalVerified,false);assert.equal(r.evidence.protectedPosition.atomicBracketSubmissionVerified,false);
  assert.equal(r.evidence.flat,false);assert.equal(r.evidence.positions.length,1);assert.equal(r.evidence.positionsComplete,false);
  assert.equal(r.evidence.workingOrders,null);assert.equal(r.evidence.workingOrdersComplete,false);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);
});

test('current position existence does not imply matching risk, saved protection or a naturally approved parent correlation',async()=>{
  for(const change of [f=>{f.submit.attrs['aria-disabled']='false';},f=>{f.stopToggle.checked=false;},
    f=>{f.targetToggle.attrs['aria-checked']='false';},f=>{f.stop.value=27711;},f=>{f.target.value=27738.75;},
    f=>{f.stopMode.textContent='Stop loss ticks';},f=>{f.discard.disabled=true;}]){
    const f=positionFixture();change(f);const r=await f.call({action:'verify',expectedPlan:f.expectedPlan});
    assert.equal(r.status,'UNKNOWN');assert.equal(r.fillVerified,true);assert.equal(r.protectionVerified,false);
    assert.equal(r.evidence.protectedPosition.totalPlannedRisk,null);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
  }
});

test('position contract proof requires one unit, exact native20-dollar point trade value,5-dollar tick andUSD currencies',async()=>{
  for(const change of [f=>{f.description.textContent='Long 2 @ 27,720.50';},f=>{f.tradeValue.textContent='554,400.00';},
    f=>{f.tradeCurrency.textContent='EUR';},f=>{f.tickValue.textContent='0.50';},f=>{f.tickCurrency.textContent='EUR';},
    f=>{f.ticket.selectors.set('[data-qa-id="position-info-trade-value"]',[]);}]){
    const f=positionFixture();change(f);const r=await f.call({action:'verify',expectedPlan:f.expectedPlan});
    assert.equal(r.status,'UNKNOWN');assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
    assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
  }
});

test('position identity excludes fresh Order tickets, duplicate descriptions and non-Replay providers before verification',async()=>{
  for(const change of [f=>{f.panel.selectors.set('[aria-label="Order ticket"]',[f.ticket]);},
    f=>{f.description.textContent='Buy Limit 1 @ 27,720.50';},f=>{f.panel.selectors.set('div[class*="description-"]',[f.description,f.description]);},
    f=>{f.logo.attrs.src='https://static.tradingview.com/static/bundles/paper-broker.svg';}]){
    const f=positionFixture();change(f);const r=await f.call({action:'verify',expectedPlan:f.expectedPlan});
    assert.equal(r.status,'BLOCKED');assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
    assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
  }
});

test('a no-plan position read exposes existing configuration without assuming costs or total-risk eligibility',async()=>{
  const f=positionFixture(),r=await f.call({action:'verify'});
  assert.equal(r.status,'UNKNOWN');assert.equal(r.fillVerified,true);assert.equal(r.protectionVerified,false);
  assert.equal(r.evidence.protectedPosition.configurationVerified,true);assert.equal(r.evidence.protectedPosition.totalPlannedRisk,null);
  assert.equal(r.evidence.protectedPosition.expectedPlanComparison,null);assert.equal(r.evidence.flat,false);
  assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
});

test('existing protected position is read-only and malformed budget inputs cannot grant order or verification capability',async()=>{
  const f=positionFixture(),prepared=await f.call({action:'prepare',testOnly:true,testDraft:f.expectedPlan});
  assert.equal(prepared.status,'BLOCKED');assert.deepEqual(prepared.reasonCodes,['REPLAY_EXISTING_PARENT_IS_READ_ONLY']);
  for(const plan of [{...f.expectedPlan,commissionPerContract:-1},{...f.expectedPlan,slippageTicks:null},{...f.expectedPlan,commissionPerContract:20}]){
    const r=await f.call({action:'verify',expectedPlan:plan});assert.equal(r.status,'BLOCKED');assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
  }
  assert.equal(f.state.mutations,0);assert.equal(f.state.sideClicks,0);assert.equal(f.state.submitClicks,0);
});

// Aggregate selectors and empty markers match actual native clean / known
// pending / after-cancel captures in verification/0.18.0. The real off-grid
// parent enabled BOTH cancel-side controls while quantity totals stayed '-'.
function domFixture(){
  const f=fixture(),logo=new f.Node({src:'https://static.tradingview.com/static/bundles/replay-broker.b8d7b478b6b3548063d9.svg'}),
    orderRadio=new f.Node({role:'radio','aria-checked':'false'},'Order'),domRadio=new f.Node({role:'radio','aria-checked':'true'},'DOM');
  f.panel.selectors.set('[aria-label="Order ticket"]',[]);f.panel.selectors.set('[role="radio"]',[orderRadio,domRadio]);
  f.panel.selectors.set('img[src]',[logo]);
  const controls={};
  for(const [key,text] of [['cancel-all-buy-orders',''],['cancel-all-sell-orders',''],['position-DOM','—'],['switch-pl-view','—'],
    ['buy-market-dom','Buy Mkt'],['sell-market-dom','Sell Mkt'],['cancel-all-orders-dom','CXL All']]){
    const node=new f.Node({'data-qa-id':key},text);controls[key]=node;f.panel.selectors.set(`[data-qa-id="${key}"]`,[node]);
    node.clickHandler=()=>{f.state.submitClicks++;};
  }
  controls['cancel-all-buy-orders'].disabled=controls['cancel-all-sell-orders'].disabled=true;
  const quantity=new f.entry.constructor({'data-qa-id':'ui-lib-Input-input qty-dom-input'},1);
  f.panel.selectors.set('input[data-qa-id~="qty-dom-input"]',[quantity]);
  const prices=Array.from({length:23},(_,index)=>new f.Node({'data-qa-id':`dom-cell-${index}-price`,
    class:'tv-dom-widget-main__value--price-VBTMesvS'+(index===11?' tv-dom-widget-main__value--highlighted-VBTMesvS':'')},(27710.5-index*.25).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})));
  f.panel.selectors.set('[data-qa-id^="dom-cell-"]',prices);
  const sideCells={};
  for(let row=0;row<prices.length;row++)for(const side of ['buy','sell']){
    const qa=`dom-cell-${row}-orders-${side}`,cell=new f.Node({'data-qa-id':qa});sideCells[qa]=cell;f.panel.selectors.set(`[data-qa-id="${qa}"]`,[cell]);
  }
  return {...f,logo,orderRadio,domRadio,controls,domQuantity:quantity,prices,sideCells};
}

function executionFixture(){
  const f=domFixture(),storage=new Map(),play=new f.Node({'data-role':'button',title:'Play'});
  play.parentElement=new f.Node({class:'controls__control-x6NoHjDT'});f.doc.selectors.set('div[data-role="button"][title="Play"]',[play]);
  const main=new f.Node({class:'tv-dom-widget-main-VBTMesvS'});main.rectHeight=600;
  f.panel.selectors.set('div[class*="tv-dom-widget-main-"]',[main]);
  f.prices.forEach((node,index)=>{node.textContent=(f.state.quote+(11-index)*.25).toFixed(2);node.rectTop=index*24;});
  const mode=selected=>{f.domRadio.attrs['aria-checked']=String(selected==='DOM');f.orderRadio.attrs['aria-checked']=String(selected==='Order');
    f.panel.selectors.set('[aria-label="Order ticket"]',selected==='Order'?[f.ticket]:[]);f.state.onMode?.(selected);};
  f.domRadio.clickHandler=()=>mode('DOM');f.orderRadio.clickHandler=()=>mode('Order');
  f.context.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))};
  return {...f,storage,play,mode,main};
}

function inspectionFixture(){
  const f=executionFixture(),orderId='order_f7ef2891-f68d-4fb6-b59c-ec2655ac3770',row=12,
    cell=f.sideCells[`dom-cell-${row}-orders-buy`],wrapper=new f.Node({class:'tv-dom-widget-order-jnISyeJE'}),
    qty=new f.Node({class:'tv-dom-widget-order__qty-jnISyeJE'},'1'),type=new f.Node({class:'tv-dom-widget-order__type-jnISyeJE'},'Limit'),
    cancel=new f.Node({class:'tv-dom-widget-order__close-jnISyeJE'}),modal=new f.Node({role:'dialog','data-name':'order-dialog-popup'}),
    title=new f.Node({title:'NQ1!, order '+orderId}),description=new f.Node({class:'description-eXazYeWn'},'Buy Limit 1 @ 28,368.75'),
    closeModal=new f.Node({'data-qa-id':'button-close','aria-label':'Close button'});
  wrapper.selectors.set('span[class*="tv-dom-widget-order__qty-"]',[qty]);wrapper.selectors.set('span[class*="tv-dom-widget-order__type-"]',[type]);
  wrapper.selectors.set('div[class*="tv-dom-widget-order__close-"]',[cancel]);
  modal.selectors.set('[aria-label="Order ticket"]',[f.ticket]);modal.selectors.set('[title]',[title]);modal.selectors.set('img[src]',[f.logo]);
  modal.selectors.set('div[class*="description-"]',[description]);modal.selectors.set('[data-qa-id="button-close"][aria-label="Close button"]',[closeModal]);
  const openModal=()=>{f.doc.selectors.set('[role="dialog"]',[modal]);f.submit.textContent='Confirm';f.submit.attrs['aria-disabled']='true';};
  const close=()=>{f.doc.selectors.set('[role="dialog"]',[]);};closeModal.clickHandler=close;
  qty.eventHandler=event=>{if(event.type==='dblclick')openModal();};
  f.state.cancelClicks=0;cancel.clickHandler=()=>{f.state.cancelClicks++;cell.selectors.set('div[class*="tv-dom-widget-order-"]',[]);
    f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=true;};
  const attach=()=>{cell.selectors.set('div[class*="tv-dom-widget-order-"]',[wrapper]);
    f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=false;
    f.stop.value=f.draft.stop;f.target.value=f.draft.target;f.stopToggle.checked=f.targetToggle.checked=true;
    f.stopToggle.attrs['aria-checked']=f.targetToggle.attrs['aria-checked']='true';f.stop.readOnly=f.target.readOnly=false;};
  attach();
  return {...f,orderId,cell,wrapper,qty,type,cancel,modal,title,description,closeModal,attach,openModal};
}

function protectionLegFixture(base=null){
  const f=base??executionFixture(),main=new f.Node({class:'tv-dom-widget-main-VBTMesvS'}),count=new f.Node({title:'2 active orders x 2'},'2');
  main.rectHeight=600;f.panel.selectors.set('div[class*="tv-dom-widget-main-"]',[main]);
  f.panel.selectors.set('[title]',[new f.Node({title:'NQ1!'}),count]);
  f.controls['position-DOM'].textContent='1 @ '+f.draft.entry.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  f.controls['position-DOM'].attrs.class='value-LVepUlEY buy-LVepUlEY';f.controls['switch-pl-view'].textContent='1 ticks';
  f.controls['cancel-all-buy-orders'].disabled=true;f.controls['cancel-all-sell-orders'].disabled=false;
  const targetType=new f.Node({class:'tv-dom-widget-order__type-jnISyeJE'},'TAKEPROFIT'),stopType=new f.Node({class:'tv-dom-widget-order__type-jnISyeJE'},'STOPLOSS'),
    targetQty=new f.Node({class:'tv-dom-widget-order__qty-jnISyeJE'},'1'),stopQty=new f.Node({class:'tv-dom-widget-order__qty-jnISyeJE'},'1');
  const wrappers=[targetType,stopType].map((type,index)=>{const wrapper=new f.Node({class:'tv-dom-widget-order-jnISyeJE'});
    wrapper.selectors.set('span[class*="tv-dom-widget-order__type-"]',[type]);wrapper.selectors.set('span[class*="tv-dom-widget-order__qty-"]',[index===0?targetQty:stopQty]);return wrapper;});
  f.state.scrollCenter=f.draft.entry;f.state.wheelEvents=0;f.state.wheelDeltas=[];f.state.noScroll=false;
  const render=()=>{for(let i=0;i<f.prices.length;i++){
    const price=f.state.scrollCenter+(11-i)*.25,node=f.prices[i];node.textContent=price.toFixed(2);node.rectTop=i*24;
    for(const side of ['buy','sell'])f.sideCells[`dom-cell-${i}-orders-${side}`].selectors.set('div[class*="tv-dom-widget-order-"]',[]);
    const leg=price===f.draft.target?wrappers[0]:price===f.draft.stop?wrappers[1]:null;
    if(leg)f.sideCells[`dom-cell-${i}-orders-sell`].selectors.set('div[class*="tv-dom-widget-order-"]',[leg]);
    node.eventHandler=e=>{if(e.type==='wheel'){f.state.wheelEvents++;f.state.wheelDeltas.push(e.deltaY);if(!f.state.noScroll){f.state.scrollCenter+=e.deltaY<0?.5:-.5;render();}f.state.onWheel?.(e);}};
  }};render();
  return {...f,main,count,targetType,stopType,targetQty,stopQty,render};
}

function offGridParentFixture(){
  const f=inspectionFixture();f.setQuote(f.draft.entry+8);f.state.scrollCenter=f.state.quote;f.state.wheelEvents=0;f.state.pending=true;
  const render=()=>{for(let i=0;i<f.prices.length;i++){
    const price=f.state.scrollCenter+(11-i)*.25,node=f.prices[i];node.textContent=price.toFixed(2);
    node.attrs.class='tv-dom-widget-main__value--price-VBTMesvS'+(price===f.state.quote?' tv-dom-widget-main__value--highlighted-VBTMesvS':'');
    for(const side of ['buy','sell'])f.sideCells[`dom-cell-${i}-orders-${side}`].selectors.set('div[class*="tv-dom-widget-order-"]',[]);
    if(f.state.pending&&price===f.draft.entry)f.sideCells[`dom-cell-${i}-orders-buy`].selectors.set('div[class*="tv-dom-widget-order-"]',[f.wrapper]);
    node.eventHandler=event=>{if(event.type==='wheel'){f.state.wheelEvents++;if(!f.state.freezeWheel){f.state.scrollCenter+=event.deltaY<0?.5:-.5;render();}f.state.onWheel?.(event);}};
  }};
  f.closeModal.clickHandler=()=>{f.doc.selectors.set('[role="dialog"]',[]);f.state.scrollCenter=f.state.quote;render();};
  f.cancel.clickHandler=()=>{f.state.cancelClicks++;f.state.pending=false;
    f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=true;render();f.state.afterCancel?.();};
  render();return {...f,render};
}

function transientOrderToDom(f,{permanent=false,duringTransition=null}={}){
  f.mode('Order');let ticks=0;
  f.domRadio.clickHandler=()=>{
    f.panel.selectors.set('[aria-label="Order ticket"]',[]);f.domRadio.attrs['aria-checked']='false';f.orderRadio.attrs['aria-checked']='false';
    f.state.modeTransition=true;duringTransition?.();
  };
  f.state.onTimer=()=>{if(f.state.modeTransition&&!permanent&&++ticks===2){f.state.modeTransition=false;f.mode('DOM');}};
}

test('parent inspection tolerates only a bounded native Order-to-DOM root remount while retaining identity, paused state and source checks',async()=>{
  const f=offGridParentFixture();transientOrderToDom(f);
  const r=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});
  assert.equal(r.status,'REGISTERED_PARENT_VERIFIED');assert.equal(r.registeredParent.orderId,f.orderId);assert.equal(f.state.modeTransition,false);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.cancelClicks,0);
});

test('protected-leg inspection from Order tolerates the same bounded native DOM remount without skipping final exact protection checks',async()=>{
  const f=protectionLegFixture();transientOrderToDom(f);
  const r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft});
  assert.equal(r.status,'TEST_PROTECTION_VERIFIED');assert.equal(r.protectedPosition.nativeLegs.stop.nativeType,'STOPLOSS');assert.equal(f.state.submitClicks,0);
});

test('a native mode remount cannot hide source drift, lost pause, another layout/provider, trusted activity or a root that never returns',async()=>{
  for(const [opts,reason] of [[{permanent:true},'REPLAY_TICKET_CONTROL_DID_NOT_SETTLE'],
    [{duringTransition:f=>{f.fieldValues.ARROW2_CHECKSUM_A.textContent='1';}},'REPLAY_PARENT_INSPECTION_SOURCE_CHANGED'],
    [{duringTransition:f=>{f.doc.selectors.set('div[data-role="button"][title="Play"]',[]);}},'REPLAY_PAUSED_NATIVE_CONTROL_REQUIRED'],
    [{duringTransition:f=>{f.layout.attrs['aria-label']='Logged in as fixture Active layout: Original charts';}},'REPLAY_NAMED_RESEARCH_LAYOUT_REQUIRED'],
    [{duringTransition:f=>{f.provider.textContent='Paper Trading';}},'REPLAY_TRADING_PANEL_MUST_BE_ACTIVE'],
    [{duringTransition:f=>{f.doc.fireActivity('pointerdown');}},'REPLAY_PREPARATION_CANCELLED']]){
    const f=offGridParentFixture();transientOrderToDom(f,{permanent:opts.permanent,duringTransition:()=>opts.duringTransition?.(f)});
    const r=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,[reason]);
    assert.equal(f.state.submitClicks,0);assert.equal(f.state.cancelClicks,0);assert.equal(f.state.wheelEvents,0);
  }
});

test('off-grid own-parent inspection seeks exact frozen price and UUID, restores native quote, and never clicks order controls',async()=>{
  const f=offGridParentFixture(),r=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});
  assert.equal(r.status,'REGISTERED_PARENT_VERIFIED');assert.equal(r.registeredParent.orderId,f.orderId);
  assert.equal(r.lifecycleNavigation.entrySeeks.length,2);assert.ok(r.lifecycleNavigation.entrySeeks.every(s=>s.steps>0));
  assert.equal(r.lifecycleNavigation.quoteRestore.targetPrice,f.state.quote);assert.ok(r.lifecycleNavigation.quoteRestore.steps>0);
  const inv=await f.call({action:'read_inventory'});assert.equal(inv.inventory.quote,f.state.quote);assert.equal(inv.inventory.pendingEmpty,false);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.cancelClicks,0);assert.equal(f.state.mutations,0);
});

test('off-grid exact-parent cancellation seeks again after modal recentering, clicks own X once and restores quote before full native zero',async()=>{
  const f=offGridParentFixture();assert.equal((await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft})).status,'REGISTERED_PARENT_VERIFIED');
  const r=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(r.status,'OWN_PARENT_CANCELLED');assert.equal(r.cancelVerified,true);assert.equal(r.inventory.status,'FLAT_NO_PENDING');
  assert.equal(r.inventory.quote,f.state.quote);assert.equal(r.cancelledOrderId,f.orderId);assert.equal(r.lifecycleNavigation.quoteRestore.targetPrice,f.state.quote);
  assert.equal(f.state.cancelClicks,1);assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
});

test('off-grid seek rejects no progress, source/user changes and time bounds before any exact-parent X',async()=>{
  for(const [change,reason] of [[f=>{f.state.freezeWheel=true;},'REPLAY_NATIVE_PARENT_WHEEL_DID_NOT_ADVANCE'],
    [f=>{f.state.onWheel=()=>{f.fieldValues.ARROW2_CHECKSUM_A.textContent='1';};},'REPLAY_PARENT_INSPECTION_SOURCE_CHANGED'],
    [f=>{f.state.onWheel=()=>f.doc.fireActivity('wheel');},'REPLAY_PREPARATION_CANCELLED'],
    [f=>{f.state.onWheel=()=>{f.state.perf+=2501;};},'REPLAY_PARENT_PRICE_SEEK_TIME_LIMIT']]){
    const f=offGridParentFixture();change(f);const r=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});
    assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,[reason]);assert.equal(f.state.cancelClicks,0);assert.equal(f.state.submitClicks,0);
  }
});

test('an uncertain quote restore after exact-parent X remains UNKNOWN and consumes cancellation to prohibit retry',async()=>{
  const f=offGridParentFixture();assert.equal((await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft})).status,'REGISTERED_PARENT_VERIFIED');
  f.state.afterCancel=()=>{f.state.freezeWheel=true;};
  const r=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(r.status,'UNKNOWN');assert.equal(r.executionLocked,true);assert.deepEqual(r.reasonCodes,['REPLAY_NATIVE_PARENT_WHEEL_DID_NOT_ADVANCE']);
  assert.equal(f.state.cancelClicks,1);const retry=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(retry.status,'BLOCKED');assert.equal(f.state.cancelClicks,1);assert.equal(f.state.submitClicks,0);
});

test('TEST protection scan reads exact opposite-side native TAKEPROFIT and STOPLOSS cells through bounded public wheel events without order mutations',async()=>{
  const f=protectionLegFixture(),r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft,sourceBinding:f.sourceBinding});
  assert.equal(r.status,'TEST_PROTECTION_VERIFIED');assert.equal(r.testOnly,true);assert.equal(r.signalApproved,false);assert.equal(r.attribution,null);
  const p=r.protectedPosition;assert.equal(p.kind,'REPLAY_NATIVE_PROTECTIVE_LEGS_PUBLIC_V1');assert.equal(p.totalPlannedRisk,198.1);
  assert.equal(p.nativeLegs.target.nativeType,'TAKEPROFIT');assert.equal(p.nativeLegs.target.price,f.draft.target);assert.equal(p.nativeLegs.stop.nativeType,'STOPLOSS');
  assert.equal(p.nativeLegs.stop.price,f.draft.stop);assert.equal(p.nativeCounter.count,2);assert.equal(p.registeredParentOrderId,null);assert.equal(p.testOnly,true);
  assert.deepEqual(p.sourceProof.fields,f.sourceFields);assert.equal(p.sourceProof.eventId,f.sourceBinding.eventId);assert.equal(p.sourceProof.stableAcrossScan,true);
  assert.ok(p.scan.steps>0&&p.scan.steps<=128);assert.equal(p.scan.steps,f.state.wheelEvents);assert.ok(p.verificationEpochMs>=p.documentTimeOrigin);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.sideClicks,0);assert.equal(r.ordersCreated,false);
});

test('native-leg protection cannot be inferred from matching prices with wrong quantity, type, aggregate or position',async()=>{
  for(const change of [f=>{f.targetType.textContent='Limit';},f=>{f.stopQty.textContent='2';},f=>{f.count.attrs.title='3 active orders x 3';f.count.textContent='3';},
    f=>{f.controls['position-DOM'].textContent='2 @ 28,368.75';},f=>{f.controls['cancel-all-buy-orders'].disabled=false;}]){
    const f=protectionLegFixture();change(f);const r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft});
    assert.equal(r.status,'BLOCKED');assert.equal(r.protectionVerified,false);assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('native protection cells receive at most two additional render frames to settle after prices and failure traces remain bounded',async()=>{
  const f=protectionLegFixture();let settleFrames=0;f.stopType.textContent='Limit';
  f.state.onFrame=()=>{if(f.state.scrollCenter-2.75<=f.draft.stop&&f.state.scrollCenter+2.75>=f.draft.stop){
    settleFrames++;if(settleFrames===2)f.stopType.textContent='STOPLOSS';}};
  const r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft});
  assert.equal(r.status,'TEST_PROTECTION_VERIFIED');assert.ok(settleFrames>=2);assert.equal(f.state.submitClicks,0);
  const bad=protectionLegFixture();bad.stopQty.textContent='2';
  const rejected=await bad.call({action:'inspect_protection',testOnly:true,expectedPlan:bad.draft});
  assert.equal(rejected.status,'BLOCKED');assert.equal(rejected.inspectionDetails.kind,'BOUNDED_PUBLIC_NATIVE_LEG_SCAN_FAILURE');
  const detail=rejected.inspectionDetails.issues[0];assert.equal(detail.role,'STOP_LOSS');assert.equal(detail.expectedPrice,bad.draft.stop);
  assert.equal(detail.expectedType,'STOPLOSS');assert.equal(detail.observedWrappers[0].quantity,'2');assert.equal(detail.observedWrappers[0].type,'STOPLOSS');
  assert.ok(detail.cellDataQa.startsWith('dom-cell-'));assert.ok(rejected.inspectionDetails.ranges.length<=16);assert.equal(rejected.inspectionDetails.settleFrames,2);
});

test('native CSS-uppercase labels retain their actual TakeProfit/StopLoss public text while matching exact normalized protective types',async()=>{
  const f=protectionLegFixture();f.targetType.textContent='TakeProfit';f.stopType.textContent='StopLoss';
  const r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft});assert.equal(r.status,'TEST_PROTECTION_VERIFIED');
  assert.equal(r.protectedPosition.nativeLegs.target.nativeType,'TAKEPROFIT');assert.equal(r.protectedPosition.nativeLegs.target.rawNativeType,'TakeProfit');
  assert.equal(r.protectedPosition.nativeLegs.stop.nativeType,'STOPLOSS');assert.equal(r.protectedPosition.nativeLegs.stop.rawNativeType,'StopLoss');
  assert.equal(f.state.submitClicks,0);assert.equal(r.signalApproved,false);
});

test('bounded native-leg scan stops on no wheel progress, source drift, trusted interference, timeout and nonpaused Replay',async()=>{
  for(const [change,reason] of [[f=>{f.state.noScroll=true;},'REPLAY_NATIVE_DOM_WHEEL_DID_NOT_ADVANCE'],
    [f=>{f.state.onWheel=()=>{f.fieldValues.ARROW2_CHECKSUM_A.textContent='1';};},'REPLAY_PROTECTION_SCAN_SOURCE_CHANGED'],
    [f=>{f.state.onWheel=()=>f.doc.fireActivity('wheel');},'REPLAY_PREPARATION_CANCELLED'],
    [f=>{f.state.onWheel=()=>{f.state.perf+=2501;};},'REPLAY_PROTECTION_SCAN_TIME_LIMIT'],
    [f=>{f.doc.selectors.set('div[data-role="button"][title="Play"]',[]);},'REPLAY_PAUSED_NATIVE_CONTROL_REQUIRED']]){
    const f=protectionLegFixture();change(f);const r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft});
    assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,[reason]);assert.ok(f.state.wheelEvents<=4);assert.equal(f.state.submitClicks,0);
  }
});

test('initial native protective-leg candidate requires explicit TEST and a valid full-cost one-contract plan',async()=>{
  const f=protectionLegFixture(),natural=await f.call({action:'inspect_protection',intent:f.intent});
  assert.equal(natural.status,'BLOCKED');assert.deepEqual(natural.reasonCodes,['REPLAY_OWN_PARENT_CORRELATION_UNVERIFIED']);assert.equal(f.state.wheelEvents,0);
  const excessive={...f.draft,commissionPerContract:10};const r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:excessive});
  assert.equal(r.status,'BLOCKED');assert.equal(f.state.wheelEvents,0);assert.equal(f.state.submitClicks,0);
});

test('a new frozen protective leg resets wheel distance instead of treating the leg switch as an overshoot',async()=>{
  const f=protectionLegFixture(),r=await f.call({action:'inspect_protection',testOnly:true,expectedPlan:f.draft});assert.equal(r.status,'TEST_PROTECTION_VERIFIED');
  assert.ok(f.state.wheelDeltas.some(x=>x>0));assert.ok(f.state.wheelDeltas.some(x=>x<0));
  assert.ok(f.state.wheelDeltas.every(x=>Math.abs(x)===400));assert.equal(f.state.submitClicks,0);
});

test('normal verify correlates both native protective legs only with its own submitted and previously registered parent after approval TTL expiry',async()=>{
  let f=inspectionFixture();f.cell.selectors.set('div[class*="tv-dom-widget-order-"]',[]);
  f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=true;
  f.submit.clickHandler=()=>{f.state.submitClicks++;f.attach();};
  assert.equal((await f.call({action:'execute_approved',intent:f.intent})).status,'SUBMITTED_UNCONFIRMED');
  assert.equal((await f.call({action:'verify',intent:f.intent})).status,'REGISTERED_PARENT_VERIFIED');
  f=protectionLegFixture(f);f.state.now+=3000;f.state.perf+=3000;
  const r=await f.call({action:'verify',intent:f.intent,lifecycleSourceBinding:{...f.sourceBinding,approvalAsOfTime:f.sourceBinding.asOfTime}});
  assert.equal(r.status,'PROTECTED_POSITION_VERIFIED');assert.equal(r.testOnly,false);assert.equal(r.signalApproved,true);
  assert.equal(r.attribution.kind,'OWN_SUBMITTED_REPLAY_INTENT');assert.equal(r.attribution.parentOrderId,f.orderId);
  assert.equal(r.protectedPosition.registeredParentOrderId,f.orderId);assert.equal(r.protectedPosition.testOnly,false);
  assert.equal(r.protectedPosition.sourceProof.approvalAsOfTime,f.sourceBinding.asOfTime);assert.equal(r.protectionVerified,true);
  assert.equal(f.state.submitClicks,1);assert.equal(f.state.cancelClicks,0);assert.equal(r.submitCapabilityCreated,false);
  const changed=await f.call({action:'inspect_protection',intent:f.intent,parentOrderId:'order_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
  assert.equal(changed.status,'BLOCKED');assert.deepEqual(changed.reasonCodes,['REPLAY_OWN_PARENT_CORRELATION_UNVERIFIED']);
});

test('matching public TEST parent inspection cannot promote an existing position to a natural own-submission attribution',async()=>{
  let f=inspectionFixture();assert.equal((await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft})).status,'REGISTERED_PARENT_VERIFIED');
  f=protectionLegFixture(f);const r=await f.call({action:'inspect_protection',intent:f.intent,parentOrderId:f.orderId,expectedPlan:f.draft,
    attribution:{kind:'OWN_SUBMITTED_REPLAY_INTENT',key:f.intent.key,parentOrderId:f.orderId}});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['REPLAY_OWN_PARENT_CORRELATION_UNVERIFIED']);assert.equal(f.state.wheelEvents,0);assert.equal(f.state.submitClicks,0);
});

test('explicit TEST inspection opens the public existing-parent modal, checks UUID and saved frozen prices, and closes without Confirm or submission',async()=>{
  const f=inspectionFixture(),r=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});
  assert.equal(r.status,'REGISTERED_PARENT_VERIFIED');assert.equal(r.registeredParent.orderId,f.orderId);
  assert.equal(r.registeredParent.configurationVerified,true);assert.equal(r.registeredParent.closeWithoutModificationAvailable,true);
  assert.equal(r.registeredParent.expectedPlanComparison.matches,true);assert.equal(r.signalApproved,false);assert.equal(r.attribution,null);
  assert.equal(f.doc.selectors.get('[role="dialog"]').length,0);assert.equal(f.state.submitClicks,0);assert.equal(f.state.cancelClicks,0);assert.equal(f.state.mutations,0);
});

test('own-X cancellation requires a private native inspection and reconfirms the same UUID and plan before cancelling exactly one parent',async()=>{
  const f=inspectionFixture(),noPin=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(noPin.status,'BLOCKED');assert.equal(f.state.cancelClicks,0);
  await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});
  const r=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(r.status,'OWN_PARENT_CANCELLED');assert.equal(r.cancelVerified,true);assert.equal(r.cancelledOrderId,f.orderId);
  assert.equal(r.inventory.status,'FLAT_NO_PENDING');assert.equal(r.pausedReplayVerified,true);assert.equal(r.signalApproved,false);
  assert.equal(f.state.cancelClicks,1);assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  const again=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});assert.equal(again.status,'BLOCKED');assert.equal(f.state.cancelClicks,1);
});

test('duplicate row/order, wrong UUID, dirty modal, off-grid price and trusted interference cannot cancel an unrelated native order',async()=>{
  for(const change of [f=>{f.cell.selectors.set('div[class*="tv-dom-widget-order-"]',[f.wrapper,f.wrapper]);},
    f=>{f.title.attrs.title='NQ1!, order order_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';},
    f=>{f.qty.eventHandler=e=>{if(e.type==='dblclick'){f.openModal();f.submit.attrs['aria-disabled']='false';}};},
    f=>{f.prices[12].textContent='28368.50';},f=>{f.qty.eventHandler=e=>{if(e.type==='dblclick'){f.doc.fireActivity('pointerdown');f.openModal();}};}]){
    const f=inspectionFixture();change(f);const r=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
    assert.equal(r.status,'BLOCKED');assert.equal(f.state.cancelClicks,0);assert.equal(f.state.submitClicks,0);
  }
});

test('an uncertain own-X cancellation is locked UNKNOWN and never automatically retried',async()=>{
  const f=inspectionFixture();await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});
  f.cancel.clickHandler=()=>{f.state.cancelClicks++;throw Error('uncertain cancellation');};
  const r=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(r.status,'UNKNOWN');assert.equal(r.executionLocked,true);assert.equal(f.state.cancelClicks,1);
  const again=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(again.status,'BLOCKED');assert.equal(f.state.cancelClicks,1);assert.equal(f.state.submitClicks,0);
});

test('own-parent cancellation follows exact price and quantity when native DOM row indices change after inspection',async()=>{
  const f=inspectionFixture(),oldCell=f.cell,newCell=f.sideCells['dom-cell-15-orders-buy'];let moved=false;
  f.closeModal.clickHandler=()=>{
    f.doc.selectors.set('[role="dialog"]',[]);
    if(!moved){moved=true;[f.prices[12].textContent,f.prices[15].textContent]=[f.prices[15].textContent,f.prices[12].textContent];
      oldCell.selectors.set('div[class*="tv-dom-widget-order-"]',[]);newCell.selectors.set('div[class*="tv-dom-widget-order-"]',[f.wrapper]);}
  };
  f.cancel.clickHandler=()=>{f.state.cancelClicks++;newCell.selectors.set('div[class*="tv-dom-widget-order-"]',[]);
    f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=true;};
  const inspected=await f.call({action:'inspect_parent',testOnly:true,expectedPlan:f.draft});assert.equal(inspected.status,'REGISTERED_PARENT_VERIFIED');
  const r=await f.call({action:'cancel_own',testOnly:true,expectedPlan:f.draft,parentOrderId:f.orderId});
  assert.equal(r.status,'OWN_PARENT_CANCELLED');assert.equal(f.state.cancelClicks,1);assert.equal(f.state.submitClicks,0);
});

test('matching preflight entry must exist by exact native price while execution keeps all seven approval flags and checks frozen',async()=>{
  const good=executionFixture(),r=await good.call({action:'preflight',sourceBinding:good.sourceBinding,expectedPlan:good.draft});
  assert.equal(r.capabilities.domEntryPriceVerified,true);assert.equal(r.capabilities.ownParentCancelVerified,true);
  assert.ok(r.inventory.visiblePriceBounds.min<=good.draft.entry&&r.inventory.visiblePriceBounds.max>=good.draft.entry);
  for(const change of [f=>{f.intent.approvalProof.requiredFlags.requireFib=false;},f=>{f.intent.approvalProof.requiredChecks[0].state='PENDING';},
    f=>{f.intent.approvalProof.requiredChecks[1].required=false;},f=>{f.intent.approvalProof.roleReversalEnabled=false;}]){
    const f=executionFixture();change(f);const result=await f.call({action:'execute_approved',intent:f.intent});
    assert.equal(result.status,'BLOCKED');assert.equal(f.state.submitClicks,0);
  }
});

test('only a privately submitted intent acquires native parent attribution and its exact-parent cancellation remains available after disarm or intent TTL expiry',async()=>{
  const f=inspectionFixture();f.cell.selectors.set('div[class*="tv-dom-widget-order-"]',[]);
  f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=true;
  f.submit.clickHandler=()=>{f.state.submitClicks++;f.attach();};
  const submitted=await f.call({action:'execute_approved',intent:f.intent});assert.equal(submitted.status,'SUBMITTED_UNCONFIRMED');
  const verified=await f.call({action:'verify',intent:f.intent});assert.equal(verified.status,'REGISTERED_PARENT_VERIFIED');
  assert.equal(verified.attribution.kind,'OWN_SUBMITTED_REPLAY_INTENT');assert.equal(verified.attribution.key,f.intent.key);
  assert.equal(verified.attribution.parentOrderId,f.orderId);assert.equal(verified.attribution.baselineFlatVerified,true);
  assert.equal(verified.attribution.submissionRecorded,true);assert.equal(verified.documentTimeOrigin,f.context.performance.timeOrigin);
  await f.call({action:'disarm'});f.intent.expiresAt=0;
  const cancelled=await f.call({action:'cancel_own',intent:f.intent,parentOrderId:f.orderId});
  assert.equal(cancelled.status,'OWN_PARENT_CANCELLED');assert.equal(cancelled.attribution.key,f.intent.key);assert.equal(cancelled.executionLocked,false);
  assert.equal(f.state.submitClicks,1);assert.equal(f.state.cancelClicks,1);
});

test('the driver event key is stable when the same approved close becomes PREVIOUS during the next forming bar',async()=>{
  const f=executionFixture(),submitted=await f.call({action:'execute_approved',intent:f.intent});assert.equal(submitted.status,'SUBMITTED_UNCONFIRMED');
  vm.runInContext("delete globalThis[Symbol.for('arrow.replay-trading-ui.v1')]",f.context);
  const b=f.intent.sourceBinding;b.currentTime=b.asOfTime;b.currentCloseTime=b.currentTime+60000;b.closedBarRole='previous';
  b.fields.ARROW2_CURRENT_TIME=String(b.currentTime-1577836800000);f.fieldValues.ARROW2_CURRENT_TIME.textContent=b.fields.ARROW2_CURRENT_TIME;
  const again=await f.call({action:'execute_approved',intent:f.intent});assert.equal(again.status,'BLOCKED');
  assert.deepEqual(again.reasonCodes,['REPLAY_EVENT_ALREADY_ATTEMPTED']);assert.equal(f.state.submitClicks,1);
});

test('disarm while approved execution awaits native paints invalidates the in-flight generation before submission',async()=>{
  const f=executionFixture();let disarmed=false;
  f.state.onFrame=()=>{if(!disarmed){disarmed=true;void f.call({action:'disarm'});}};
  const r=await f.call({action:'execute_approved',intent:f.intent});assert.equal(r.status,'BLOCKED');
  assert.deepEqual(r.reasonCodes,['REPLAY_PREPARATION_CANCELLED']);assert.equal(f.state.submitClicks,0);assert.equal(f.storage.size,0);
});

test('automatic execution requires visible native entry row and a frozen known-parent-only expiry policy without changing entry',async()=>{
  for(const change of [f=>{f.prices[12].textContent='28368.50';},f=>{f.intent.pendingPolicy.neverCancelAll=false;},
    f=>{f.intent.pendingPolicy.expiresAtReplayCloseTime++;},f=>{f.intent.definitionVersion='replay-execution-intent-1';},
    f=>{f.intent.quoteProof.documentTimeOrigin++;}]){
    const f=executionFixture(),entry=f.intent.entry;change(f);
    const r=await f.call({action:'execute_approved',intent:f.intent});assert.equal(r.status,'BLOCKED');assert.equal(f.state.submitClicks,0);assert.equal(f.intent.entry,entry);
  }
});

test('synthetic approved execution takes its own native zero-state and prepares the frozen passive ticket before exactly one recorded gesture',async()=>{
  const f=executionFixture(),r=await f.call({action:'execute_approved',intent:f.intent});
  assert.equal(r.status,'SUBMITTED_UNCONFIRMED');assert.equal(r.submitted,true);assert.equal(r.ordersCreated,null);assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
  assert.equal(r.executionLocked,true);assert.equal(f.state.submitClicks,1);assert.equal(Number(f.entry.value),f.intent.entry);
  assert.equal(Number(f.stop.value),f.intent.stop);assert.equal(Number(f.target.value),f.intent.target);
  const ledger=JSON.parse(f.storage.get('arrow.replayExecutionAttempts.v2'));assert.equal(ledger.entries.length,1);assert.equal(ledger.entries[0].key,f.intent.key);
  const again=await f.call({action:'execute_approved',intent:f.intent});assert.equal(again.status,'BLOCKED');assert.equal(f.state.submitClicks,1);
});

test('preflight composes actual current Order-ticket evidence with privately observed current-symbol zero counters',async()=>{
  const f=executionFixture(),r=await f.call({action:'preflight',sourceBinding:f.sourceBinding});
  assert.equal(r.status,'REPLAY_TRADING_UI_VERIFIED');assert.equal(r.flat,true);assert.equal(r.positionsComplete,true);assert.equal(r.workingOrdersComplete,true);
  assert.equal(r.inventory.kind,'REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1');assert.equal(r.inventory.status,'FLAT_NO_PENDING');
  assert.equal(r.inventory.sourceBinding.eventId,f.sourceBinding.eventId);assert.equal(r.ticket.stage,'NEW_ORDER_TICKET');
  assert.equal(r.ticket.quote,f.state.quote);assert.equal(r.pausedReplayVerified,true);assert.equal(r.submitCapabilityCreated,false);assert.equal(f.state.submitClicks,0);
});

test('pending inventory, nonpaused Replay, invalid approval and marketable quotes stop the execution sequence before any order attempt',async()=>{
  for(const change of [f=>{f.controls['cancel-all-buy-orders'].disabled=false;},f=>{f.doc.selectors.set('div[data-role="button"][title="Play"]',[]);},
    f=>{f.intent.approvalProof.requiredChecks[0].passed=false;},f=>{f.intent.approvalProof.engineDefinitionVersion='guide-signals-4';},
    f=>{f.intent.testOnly=true;},f=>{f.intent.quoteProof.distanceTicks=0;},f=>{f.intent.quoteProof.sourceCurrentClose+=.25;}]){
    const f=executionFixture();change(f);const r=await f.call({action:'execute_approved',intent:f.intent});
    assert.equal(r.status,'BLOCKED');assert.equal(f.state.submitClicks,0);assert.equal(f.storage.size,0);
  }
});

test('a DOM-to-Order draft reset is repaired from the frozen plan after the final zero-state read, without another tab roundtrip',async()=>{
  const f=executionFixture();let orderSelections=0;
  f.state.onMode=selected=>{if(selected==='Order'){orderSelections++;f.entry.value=f.state.quote;
    f.stopToggle.checked=f.targetToggle.checked=false;f.stopToggle.attrs['aria-checked']=f.targetToggle.attrs['aria-checked']='false';
    f.stop.readOnly=f.target.readOnly=true;}};
  const r=await f.call({action:'execute_approved',intent:f.intent});assert.equal(r.status,'SUBMITTED_UNCONFIRMED');assert.equal(orderSelections,1);
  assert.equal(Number(f.entry.value),f.intent.entry);assert.equal(f.stopToggle.checked,true);assert.equal(f.targetToggle.checked,true);assert.equal(f.state.submitClicks,1);
});

test('trusted input, source drift, stale private zero-state and missing durable storage cannot reach the native submit gesture',async()=>{
  for(const change of [f=>{f.state.onInput=()=>f.doc.fireActivity('pointerdown');},f=>{f.state.onInput=()=>{f.fieldValues.ARROW2_CHECKSUM_A.textContent='1';};},
    f=>{f.state.onInput=()=>{f.state.perf+=751;};},f=>{delete f.context.sessionStorage;},
    f=>{f.context.sessionStorage.setItem=()=>{throw Error('quota');};}]){
    const f=executionFixture();change(f);const r=await f.call({action:'execute_approved',intent:f.intent});assert.equal(r.status,'BLOCKED');assert.equal(f.state.submitClicks,0);
  }
});

test('a submission exception locks UNKNOWN and the durable attempt ledger prevents retry even if isolated memory is replaced',async()=>{
  const f=executionFixture();f.submit.clickHandler=()=>{f.state.submitClicks++;throw Error('uncertain native handler');};
  const r=await f.call({action:'execute_approved',intent:f.intent});assert.equal(r.status,'UNKNOWN');assert.equal(r.executionLocked,true);assert.equal(f.state.submitClicks,1);
  vm.runInContext("delete globalThis[Symbol.for('arrow.replay-trading-ui.v1')]",f.context);
  const again=await f.call({action:'execute_approved',intent:f.intent});assert.equal(again.status,'BLOCKED');assert.deepEqual(again.reasonCodes,['REPLAY_EVENT_ALREADY_ATTEMPTED']);
  assert.equal(f.state.submitClicks,1);
});

test('actual healthy Replay DOM aggregate-zero schema verifies only current NQ symbol flat/no-pending without clicking any control',async()=>{
  const f=domFixture(),r=await f.call({action:'read_inventory',sourceBinding:f.sourceBinding});
  assert.equal(r.status,'REPLAY_SYMBOL_FLAT_NO_PENDING_VERIFIED');assert.equal(r.flat,true);assert.deepEqual(r.positions,[]);assert.deepEqual(r.workingOrders,[]);
  assert.equal(r.inventory.scope,'CURRENT_REPLAY_SYMBOL_ONLY');assert.equal(r.inventory.quote,27707.75);
  assert.equal(r.inventory.buyCancelDisabled,true);assert.equal(r.inventory.sellCancelDisabled,true);
  assert.equal(r.inventory.positionMarker,'—');assert.equal(r.inventory.pnlMarker,'—');assert.equal(r.sourceLeaseStored,true);
  assert.equal(r.submitCapabilityCreated,false);assert.equal(r.inventory.orderEligible,false);assert.equal(r.inventory.submissionAuthorized,false);
  assert.equal(r.inventory.cancelAllEnabledUsedAsZeroEvidence,false);assert.equal(r.inventory.totalQuantityLabelsUsedAsEvidence,false);assert.equal(r.inventory.visibleOrderCellsUsedAsInventory,false);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.sideClicks,0);
});

test('known off-grid pending orders are not erased by empty visible ladder cells or quantity dashes',async()=>{
  for(const enabled of [['cancel-all-buy-orders'],['cancel-all-sell-orders'],['cancel-all-buy-orders','cancel-all-sell-orders']]){
    const f=domFixture();for(const key of enabled)f.controls[key].disabled=false;
    const r=await f.call({action:'read_inventory'});
    assert.equal(r.status,'REPLAY_SYMBOL_INVENTORY_OBSERVED');assert.equal(r.inventory.status,'PENDING_ORDERS_PRESENT');
    assert.equal(r.inventory.pendingEmpty,false);assert.equal(r.workingOrders,null);assert.equal(r.workingOrdersComplete,false);
    assert.equal(r.flat,true);assert.equal(r.sourceLeaseStored,false);assert.equal(f.state.submitClicks,0);
  }
});

test('DOM clean-to-pending-to-cancelled transition uses side controls, never the always-enabled CXLAll button',async()=>{
  const f=domFixture(),clean=await f.call({action:'read_inventory'});assert.equal(clean.sourceLeaseStored,true);
  f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=false;
  const pending=await f.call({action:'read_inventory'});assert.equal(pending.sourceLeaseStored,false);assert.equal(pending.inventory.pendingEmpty,false);
  f.controls['cancel-all-buy-orders'].disabled=f.controls['cancel-all-sell-orders'].disabled=true;
  const cancelled=await f.call({action:'read_inventory'});assert.equal(cancelled.sourceLeaseStored,true);assert.equal(cancelled.inventory.pendingEmpty,true);
  assert.equal(f.controls['cancel-all-orders-dom'].disabled,false);assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
});

test('stale, missing, disconnected or non-Replay DOM controls cannot certify an empty pending inventory',async()=>{
  for(const change of [f=>{f.controls['buy-market-dom'].disabled=true;},f=>{f.controls['sell-market-dom'].attrs['aria-disabled']='true';},
    f=>{f.panel.selectors.set('[data-qa-id="cancel-all-buy-orders"]',[]);},f=>{f.controls['cancel-all-buy-orders'].attrs['aria-disabled']='true';},
    f=>{f.prices[11].attrs.class='unhighlighted';},f=>{f.prices[11].textContent='27,707.76';},f=>{f.domQuantity.value=2;},
    f=>{f.logo.attrs.src='https://static.tradingview.com/static/bundles/paper-broker.svg';},f=>{f.domRadio.attrs['aria-checked']='false';},
    f=>{f.panel.rectWidth=0;},f=>{f.context.performance.timeOrigin=undefined;}]){
    const f=domFixture();change(f);const r=await f.call({action:'read_inventory'});assert.equal(r.status,'BLOCKED');
    assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('nonempty or unsupported position/PnL markers never become a flat DOM certificate',async()=>{
  for(const change of [f=>{f.controls['position-DOM'].textContent='1';},f=>{f.controls['switch-pl-view'].textContent='0.00';},
    f=>{f.controls['position-DOM'].textContent='-';},f=>{f.controls['position-DOM'].textContent='';}]){
    const f=domFixture();change(f);const r=await f.call({action:'read_inventory'});
    assert.equal(r.status,'REPLAY_SYMBOL_INVENTORY_OBSERVED');assert.equal(r.flat,null);assert.equal(r.positions,null);assert.equal(r.sourceLeaseStored,false);
    assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('private inventory source witness may survive only an untrusted programmatic tab switch with identical raw source and document',async()=>{
  const f=domFixture();await f.call({action:'read_inventory',sourceBinding:f.sourceBinding});
  f.doc.fireActivity('pointerdown',false);
  f.domRadio.attrs['aria-checked']='false';f.orderRadio.attrs['aria-checked']='true';f.panel.selectors.set('[aria-label="Order ticket"]',[f.ticket]);
  const r=await f.call({action:'verify_inventory_lease',sourceBinding:f.sourceBinding});
  assert.equal(r.status,'INVENTORY_SOURCE_LEASE_CURRENT');assert.equal(r.stage,'NEW_ORDER_TICKET');
  assert.equal(r.orderEligible,false);assert.equal(r.submitCapabilityCreated,false);assert.equal(f.state.submitClicks,0);
});

test('trusted user input, source drift, clocks, document origin, target change and disarm invalidate the private inventory witness',async()=>{
  for(const change of [async f=>{f.doc.fireActivity('pointerdown');},async f=>{f.doc.fireActivity('keydown');},async f=>{f.doc.fireActivity('wheel');},
    async f=>{f.doc.fireActivity('visibilitychange');},async f=>{f.fieldValues.ARROW2_CHECKSUM_A.textContent='1';},
    async f=>{f.state.now+=751;},async f=>{f.state.perf+=751;},async f=>{f.context.performance.timeOrigin++;},
    async f=>{f.expected.sourceTabId++;},async f=>{await f.call({action:'disarm'});}]){
    const f=domFixture();await f.call({action:'read_inventory'});await change(f);
    const r=await f.call({action:'verify_inventory_lease'});assert.equal(r.status,'BLOCKED');assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('caller-supplied fake inventory cannot replace a missing private witness or enable natural preparation',async()=>{
  const f=domFixture(),forged={flat:true,positions:[],workingOrders:[],sourceFields:f.sourceFields};
  const lease=await f.call({action:'verify_inventory_lease',inventory:forged});assert.equal(lease.status,'BLOCKED');
  await f.call({action:'read_inventory'});
  const prepare=await f.call({action:'prepare',testOnly:false,intent:f.intent,inventory:forged});assert.equal(prepare.status,'BLOCKED');
  assert.deepEqual(prepare.reasonCodes,['REPLAY_APPROVED_EXECUTION_SEQUENCE_REQUIRED']);assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
});

test('Replay-off, wrong layout, original multiple charts, ordinary Paper and dated tickets block all test mutations',async()=>{
  for(const change of [f=>{f.replay.attrs['aria-pressed']='false';},f=>{f.layout.attrs['aria-label']='Logged in as component Active layout: Full Screens Live';},
    f=>{f.doc.selectors.set('canvas[aria-label^="Chart for "]',[f.chart,f.chart,f.chart]);},
    f=>{f.provider.textContent='Paper Trading';},f=>{f.brokerIcon.textContent='Paper Trading';},
    f=>{f.doc.selectors.set('[aria-label="Account manager"],[data-qa-id="account-selector"]',[new f.Node()]);},
    f=>{f.panel.selectors.set('[title]',[new f.Node({title:'NQZ2026'})]);},
    f=>{f.doc.visibilityState='hidden';},f=>{f.doc.selectors.set('[role="dialog"]',[new f.Node()]);}]){
    const f=fixture();change(f);const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
    assert.equal(r.status,'BLOCKED');assert.equal(f.state.submitClicks,0);assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('collapsed zero-width or zero-height native panels cannot expose actionable overflowing child controls',async()=>{
  for(const change of [f=>{f.panel.rectWidth=0;},f=>{f.panel.rectHeight=0;},f=>{f.ticket.rectWidth=0;},f=>{f.ticket.rectHeight=0;}]){
    const f=fixture();change(f);
    assert.equal(f.entry.getClientRects()[0].width,100); // Native child rectangles can remain positive after collapse.
    const read=await f.call({action:'read'}),prepare=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
    assert.equal(read.status,'BLOCKED');assert.equal(prepare.status,'BLOCKED');
    assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
  }
});

test('zero-sized clipping ancestors hide descendants even when the descendant rectangle is positive',async()=>{
  for(const mode of ['hidden','clip','auto','scroll']){
    for(const axis of ['X','Y']){
      const f=fixture(),clipped=new f.Node();clipped['overflow'+axis]=mode;clipped[axis==='X'?'rectWidth':'rectHeight']=0;
      f.panel.parentElement=clipped;
      const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
      assert.equal(r.status,'BLOCKED');assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
    }
  }
});

test('a clipped side control and a panel that collapses during preparation cannot advance into price edits',async()=>{
  const f=fixture(),clipped=new f.Node();clipped.overflowX='hidden';clipped.rectWidth=0;
  f.ticket.selectors.get('[data-name="side-control-buy"]')[0].parentElement=clipped;
  const hidden=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(hidden.status,'BLOCKED');assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);
  const racing=fixture();racing.state.onFrame=()=>{racing.panel.rectWidth=0;};
  const collapsed=await racing.call({action:'prepare',testOnly:true,testDraft:racing.draft});
  assert.equal(collapsed.status,'BLOCKED');assert.equal(racing.state.sideClicks,1);assert.equal(racing.state.mutations,0);assert.equal(racing.state.submitClicks,0);
});

test('explicit PRICE modes are required; unsupported ticks mode is never guessed or rewritten as a price',async()=>{
  const f=fixture();f.stopMode.textContent='Stop loss ticks';
  const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['REPLAY_EXPLICIT_PRICE_UNITS_REQUIRED']);
  assert.equal(f.state.sideClicks,0);assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);
});

test('test plans cannot expand quantity, reverse protective sides or exceed the 200 USD total cost budget',async()=>{
  for(const change of [d=>{d.quantity=2;},d=>{d.stop=d.entry+.25;},d=>{d.target=d.entry-.25;},
    d=>{d.stop=d.entry-9.5;},d=>{d.commissionPerContract=-1;},d=>{d.slippageTicks=-1;},d=>{d.entry+=.1;},
    d=>{d.stopMode='TICKS';}]){const f=fixture();change(f.draft);const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
    assert.equal(r.status,'BLOCKED');assert.equal(f.state.mutations,0);assert.equal(f.state.submitClicks,0);}
});

test('public source changes or missing/duplicate fields reject a read instead of echoing a stale binding',async()=>{
  for(const change of [f=>{f.fieldValues.ARROW2_CHECKSUM_A.textContent='1';},
    f=>{f.sourceBinding.eventId='';},f=>{f.fieldValues.ARROW2_CURRENT_TIME.textContent='∅';},
    f=>{f.doc.selectors.set('[role="tab"][aria-selected="true"]',[]);}]){
    const f=fixture();change(f);const r=await f.call({action:'read',sourceBinding:f.sourceBinding});
    assert.equal(r.status,'BLOCKED');assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
  }
});

test('disarm during asynchronous preparation invalidates it before later edits and never grants a capability',async()=>{
  const f=fixture();let fired=false;f.state.onFrame=()=>{if(!fired){fired=true;void f.call({action:'disarm'});}};
  const r=await f.call({action:'prepare',testOnly:true,testDraft:f.draft});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['REPLAY_PREPARATION_CANCELLED']);
  assert.equal(f.state.submitClicks,0);assert.equal(f.state.mutations,0);
});

test('verification never turns a click, empty report or ticket into a reported fill or active protection',async()=>{
  const f=fixture(),r=await f.call({action:'verify',intent:f.intent});
  assert.equal(r.status,'UNKNOWN');assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);
  assert.deepEqual(r.reasonCodes,['REPLAY_OWN_PARENT_CORRELATION_UNVERIFIED']);assert.equal(f.state.submitClicks,0);
});

test('expired, changed-key or repriced unsigned intents do not mutate a ticket or bypass the capability gate',async()=>{
  for(const change of [i=>{i.expiresAt=0;},i=>{i.preparedAt-=3000;},i=>{i.key+='retry';},
    i=>{i.riskPlan.totalPlannedRisk=1;},i=>{i.riskPlan.perContractRisk=NaN;},i=>{i.submissionAuthorized=true;},
    i=>{i.sourceBinding.eventId+='other';}]){const f=fixture();change(f.intent);const r=await f.call({action:'prepare',testOnly:false,intent:f.intent});
    assert.equal(r.status,'BLOCKED');assert.equal(f.state.mutations,0);assert.equal(f.state.sideClicks,0);assert.equal(f.state.submitClicks,0);}
});
