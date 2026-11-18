import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prepareLivePaperStartUi} from '../live-paper-start-ui.mjs';

// Synthetic public DOM contracts. No browser, natural signal or order.
function fixture(overrides={}){
  const state={active:true,manager:true,mode:'ORDER',side:'LONG',type:'Market',quantity:'1',...overrides},actions=[],events=[];
  class Element{
    constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.isConnected=true;this.disabled=false;this.readOnly=false;this.style={};this.parentElement=null;this.visible=true;}
    getAttribute(k){return this.attrs[k]??null;}getClientRects(){return this.visible?[this.getBoundingClientRect()]:[];}getBoundingClientRect(){return {width:100,height:30,left:10,top:20,...this.rect};}querySelectorAll(){return[];}
    dispatchEvent(e){events.push({node:this,type:e.type,relatedTarget:e.relatedTarget,bubbles:e.bubbles});if(e.type==='click')this.activate?.();if(e.type==='mouseleave')this.onExit?.();return true;}
  }
  const n=(attrs={},text='')=>new Element(attrs,text),layout=n({'aria-label':'Logged in as local Active layout: Arrow OHLC Live Verification'}),minute=n({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),five=n({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),second=n({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'}),interval=n(),replay=n({'aria-pressed':'false'}),paper=n({'data-qa-id':'paper_trading'},'Paper Trading'),manager=n(),selector=n(),name=n({},'Paper Exact000'),panel=n(),ticket=n(),order=n({},'Order'),dom=n({},'DOM'),trade=n({'data-qa-id':'trade-button'}),buy=n(),sell=n(),market=n({id:'Market'}),limit=n({id:'Limit'}),stop=n({id:'Stop'}),quantity=n(),logo=n({src:'https://static.tradingview.com/static/bundles/paper.abcd1234.svg'}),symbol=n({title:'NQZ2026'}),mapping=n({title:'Continuous futures is used for charting, but the NQZ2026 contract will be used for order placement.'});
  const activate=(node,action,fn)=>{node.activate=()=>{actions.push(action);fn();};};
  activate(minute,'CANVAS',()=>{state.active=true;state.crosshairPinned=true;});minute.onExit=()=>{state.crosshairPinned=false;};activate(paper,'ACCOUNT_PANEL',()=>{state.manager=true;});activate(trade,'TRADE_TICKET',()=>{state.mode='ORDER';});activate(order,'ORDER_VIEW',()=>{state.mode='ORDER';});activate(buy,'BUY_SIDE',()=>{state.side='LONG';});activate(market,'MARKET_TAB',()=>{state.type='Market';});
  Object.defineProperty(quantity,'value',{get:()=>state.quantity,set:()=>{throw Error('Numeric setter forbidden');}});
  selector.querySelectorAll=s=>s==='[class*="accountName-"]'?[name]:[];
  manager.querySelectorAll=s=>s==='[data-qa-id="account-selector"]'?[selector]:[];
  ticket.querySelectorAll=s=>s==='[data-name="side-control-buy"][role="button"]'?[buy]:s==='[data-name="side-control-sell"][role="button"]'?[sell]:s==='button[role="tab"][id="Market"]'?[market]:s==='[role="tab"][aria-selected="true"]'?[{Market:market,Limit:limit,Stop:stop}[state.type]].filter(Boolean):s==='input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]'?[quantity]:[];
  panel.querySelectorAll=s=>s==='[aria-label="Order ticket"]'&&state.mode==='ORDER'?[ticket]:s==='[role="radio"]'?[order,dom]:s==='[data-name="position-panel"]'?(state.positionEditor?[n()]:[]):s==='[title]'?[symbol,mapping,...(state.orderEditor?[n({title:'NQZ2026, order existing-123'})]:[])]:s==='img[src]'?[logo]:[];
  const document={visibilityState:'visible',hidden:false,querySelectorAll(s){
    interval.attrs['data-value']=state.active?'1':'5';paper.attrs['aria-label']=state.manager?'Collapse account manager':'Open account manager';
    order.attrs['aria-checked']=String(state.mode==='ORDER');dom.attrs['aria-checked']=String(state.mode==='DOM');buy.attrs.class=state.side==='LONG'||state.side==='BOTH'?'buy-knd active-knd':'buy-knd';sell.attrs.class=state.side==='SHORT'||state.side==='BOTH'?'sell-knd active-knd':'sell-knd';market.attrs['aria-selected']=String(state.type==='Market');
    return s==='[role="dialog"],[aria-modal="true"]'?(state.dialog?[n()]:[]):s==='[aria-label^="Logged in as"]'?[layout]:s==='canvas[aria-label^="Chart for "]'?[five,minute,second,...(state.extraMinute?[n(minute.attrs)]:[])]:s==='#header-toolbar-replay'?[replay]:s==='[data-qa-id="replay_trading"]'?[]:s==='button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]'?[paper]:s==='button[data-qa-id="paper_trading"]'?[paper]:s==='#header-toolbar-intervals [aria-checked="true"]'?[interval]:s==='[aria-label="Account manager"]'&&state.manager?[manager]:s==='[aria-label="Trading panel"]'&&state.mode!=='CLOSED'?[panel]:s==='button[data-qa-id="trade-button"]'?(state.duplicateTrade?[trade,n()]:[trade]):[];
  }};
  const context=vm.createContext({document,location:{href:'https://www.tradingview.com/chart/ARROWRV1/'},URL,getComputedStyle:node=>({display:node.visible?'block':'none',visibility:'visible',overflowX:'visible',overflowY:'visible',...node.style}),MouseEvent:class{constructor(type,init){this.type=type;Object.assign(this,init);}},PointerEvent:class{constructor(type,init){this.type=type;Object.assign(this,init);}}});context.window=context;
  const run=async(args={})=>JSON.parse(JSON.stringify(await vm.runInContext('('+prepareLivePaperStartUi.toString()+')('+JSON.stringify({nativeAccountId:'Paper Exact000',...args})+')',context)));
  return {state,actions,events,run,context,layout,minute,five,replay,paper,name,logo,quantity,trade};
}

test('startup prepares existing research UI through one non-order gesture per call without numeric or preset changes',async()=>{
  const f=fixture({active:false,manager:false,mode:'CLOSED',side:'NONE',type:'Limit',quantity:'3'}),expected=['ACTIVATE_EXISTING_NQ_ONE_MINUTE_CHART','OPEN_EXISTING_PAPER_ACCOUNT_MANAGER','OPEN_NEW_NATIVE_ORDER_TICKET','INITIALIZE_NEW_ORDER_BUY_SIDE','SELECT_NATIVE_MARKET_DRAFT'];
  for(const action of expected){const before=f.actions.length,r=await f.run();assert.equal(r.status,'WAITING',JSON.stringify(r));assert.equal(r.actionPerformed,action);assert.equal(f.actions.length,before+1);assert.equal(r.ordersCreated,false);assert.equal(r.numericInputsSet,false);assert.equal(r.presetApplied,false);}
  const ready=await f.run();assert.equal(ready.status,'READY',JSON.stringify(ready));assert.equal(ready.draft.quantity,3);assert.equal(ready.draft.quantityRaw,'3');assert.equal(ready.actionPerformed,'CLEAR_CURRENT_CHART_POINTER');assert.equal(ready.submitCapabilityCreated,false);assert.equal(f.actions.length,5);
});
test('FULL SCREENS uses its exact existing URL and name pair without changing the layout, numeric values or preset',async()=>{
  const f=fixture({quantity:'3'}),url='https://www.tradingview.com/chart/ARROWFR1/';f.context.location.href=url;f.layout.attrs['aria-label']='Logged in as local Active layout: Full Screens Live';
  const r=await f.run({sourceUrl:url});assert.equal(r.status,'READY',JSON.stringify(r));assert.equal(r.layoutName,'Full Screens Live');assert.equal(r.sourceUrl,url);assert.equal(r.layoutChanged,false);assert.equal(r.timeframeChanged,false);assert.equal(r.numericInputsSet,false);assert.equal(r.presetApplied,false);assert.deepEqual(f.actions,[]);
});
test('crossed URL/name pairs and navigation away from the explicitly pinned source fail before any gesture',async()=>{
  for(const pair of ['FULL_URL_RESEARCH_NAME','RESEARCH_URL_FULL_NAME','PINNED_SOURCE_CHANGED']){
    const f=fixture();if(pair==='FULL_URL_RESEARCH_NAME')f.context.location.href='https://www.tradingview.com/chart/ARROWFR1/';if(pair==='RESEARCH_URL_FULL_NAME')f.layout.attrs['aria-label']='Logged in as local Active layout: Full Screens Live';
    const r=await f.run(pair==='PINNED_SOURCE_CHANGED'?{sourceUrl:'https://www.tradingview.com/chart/ARROWFR1/'}:{});assert.equal(r.status,'BLOCKED',pair);assert.deepEqual(f.actions,[]);assert.deepEqual(f.events,[]);
  }
});

test('an existing DOM view switches only its Order radio and preserves an initialized Short side and native quantity',async()=>{
  const f=fixture({mode:'DOM',side:'SHORT',quantity:'2.00'});assert.equal((await f.run()).actionPerformed,'SELECT_EXISTING_ORDER_VIEW');const ready=await f.run();assert.equal(ready.status,'READY');assert.equal(ready.draft.direction,'SHORT');assert.equal(ready.draft.quantity,2);assert.deepEqual(f.actions,['ORDER_VIEW']);
});

test('personal layout, other URL, mixed or ambiguous charts, Replay and another broker are excluded before any action',async()=>{
  for(const mode of ['layout','url','mixed','duplicate','replay','provider','dialog']){const f=fixture();if(mode==='layout')f.layout.attrs['aria-label']='Logged in as local Active layout: Personal';if(mode==='url')f.context.location.href='https://www.tradingview.com/chart/Personal/';if(mode==='mixed')f.five.attrs['aria-label']='Chart for CME_MINI:ES1!, 5 minutes';if(mode==='duplicate')f.state.extraMinute=true;if(mode==='replay')f.replay.attrs['aria-pressed']='true';if(mode==='provider')f.paper.textContent='Tradovate';if(mode==='dialog')f.state.dialog=true;const r=await f.run();assert.equal(r.status,'BLOCKED',mode+JSON.stringify(r));assert.deepEqual(f.actions,[]);}
});

test('native account mismatch, non-Paper ticket, existing-order editor and ambiguous native side cannot initialize a draft',async()=>{
  for(const mode of ['account','logo','order','position','side']){const f=fixture();if(mode==='account')f.name.textContent='Another';if(mode==='logo')f.logo.attrs.src='https://static.tradingview.com/static/bundles/tradovate.123.svg';if(mode==='order')f.state.orderEditor=true;if(mode==='position')f.state.positionEditor=true;if(mode==='side')f.state.side='BOTH';assert.equal((await f.run()).status,'BLOCKED',mode);assert.deepEqual(f.actions,[]);}
  const stalePanel=fixture({mode:'DOM'});stalePanel.logo.attrs.src='https://static.tradingview.com/static/bundles/tradovate.123.svg';assert.equal((await stalePanel.run()).status,'BLOCKED');assert.deepEqual(stalePanel.actions,[]);
});

test('ambiguous Trade buttons and invalid or readonly quantity never produce READY or any order action',async()=>{
  const ambiguous=fixture({mode:'CLOSED',duplicateTrade:true});assert.equal((await ambiguous.run()).status,'BLOCKED');assert.deepEqual(ambiguous.actions,[]);
  for(const qty of ['0','-1','1.5','NaN']){const f=fixture({quantity:qty});assert.equal((await f.run()).status,'BLOCKED');assert.deepEqual(f.actions,[]);}
  const readonly=fixture();readonly.quantity.readOnly=true;assert.equal((await readonly.run()).status,'BLOCKED');
});

test('collapsed or invisible research surfaces cannot be used as public control targets',async()=>{
  const f=fixture({active:false});f.minute.rect={width:0};assert.equal((await f.run()).status,'BLOCKED');assert.deepEqual(f.actions,[]);
});

test('a cold React document waits without gestures until chart and native identity controls mount',async()=>{
  const f=fixture(),doc=f.context.document,query=doc.querySelectorAll;let cold=true;
  doc.querySelectorAll=s=>cold&&['[aria-label^="Logged in as"]','canvas[aria-label^="Chart for "]','#header-toolbar-replay','button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]','button[data-qa-id="paper_trading"]'].includes(s)?[]:query(s);
  const wait=await f.run();assert.equal(wait.status,'WAITING');assert.equal(wait.actionPerformed,null);assert.deepEqual(f.actions,[]);cold=false;assert.equal((await f.run()).status,'READY');assert.deepEqual(f.actions,[]);
});

test('missing mount-only interval, Replay, provider, ticket or panel fields wait without repeating Trade',async()=>{
  for(const missing of ['#header-toolbar-intervals [aria-checked="true"]','#header-toolbar-replay','button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]','button[data-qa-id="paper_trading"]']){
    const f=fixture(),doc=f.context.document,query=doc.querySelectorAll;doc.querySelectorAll=s=>s===missing?[]:query(s);assert.equal((await f.run()).status,'WAITING',missing);assert.deepEqual(f.actions,[]);
  }
  const ticketPending=fixture(),doc=ticketPending.context.document,query=doc.querySelectorAll;const panel=query('[aria-label="Trading panel"]')[0],panelQuery=panel.querySelectorAll;panel.querySelectorAll=s=>s==='[aria-label="Order ticket"]'?[]:panelQuery(s);assert.equal((await ticketPending.run()).status,'WAITING');assert.deepEqual(ticketPending.actions,[]);
  const partial=fixture(),partialPanel=partial.context.document.querySelectorAll('[aria-label="Trading panel"]')[0],partialQuery=partialPanel.querySelectorAll;partialPanel.querySelectorAll=s=>s==='img[src]'||s==='[title]'?[]:partialQuery(s);assert.equal((await partial.run()).status,'WAITING');assert.deepEqual(partial.actions,[]);
});

test('mount waits do not hide an explicitly wrong layout, broker, Replay or duplicate minute chart',async()=>{
  for(const mode of ['layout','broker','replay','duplicate']){
    const f=fixture();if(mode==='layout'){f.layout.attrs['aria-label']='Logged in as local Active layout: Personal';const doc=f.context.document,query=doc.querySelectorAll;doc.querySelectorAll=s=>s==='canvas[aria-label^="Chart for "]'?[]:query(s);}if(mode==='broker')f.paper.textContent='Tradovate';if(mode==='replay')f.replay.attrs['aria-pressed']='true';if(mode==='duplicate')f.state.extraMinute=true;assert.equal((await f.run()).status,'BLOCKED',mode);assert.deepEqual(f.actions,[]);
  }
  for(const conflict of ['broker','replay']){const f=fixture(),doc=f.context.document,query=doc.querySelectorAll;doc.querySelectorAll=s=>s==='canvas[aria-label^="Chart for "]'?[]:query(s);if(conflict==='broker')f.paper.textContent='Tradovate';else f.replay.attrs['aria-pressed']='true';assert.equal((await f.run()).status,'BLOCKED',conflict+' during cold mount');assert.deepEqual(f.actions,[]);}
});

test('activating the existing minute canvas exits its crosshair toward the safe Paper provider control',async()=>{
  const f=fixture({active:false});assert.equal((await f.run()).actionPerformed,'ACTIVATE_EXISTING_NQ_ONE_MINUTE_CHART');assert.equal(f.state.crosshairPinned,false);assert.deepEqual(f.actions,['CANVAS']);
  const exits=f.events.filter(e=>['pointerout','pointerleave','mouseout','mouseleave'].includes(e.type));assert.deepEqual(exits.map(e=>e.type),['pointerout','pointerleave','mouseout','mouseleave']);assert.ok(exits.every(e=>e.node===f.minute&&e.relatedTarget===f.paper));assert.equal(exits.find(e=>e.type==='mouseleave').bubbles,false);
});

test('an already-active minute chart also clears a historical pointer at READY without clicking any UI or requiring source data',async()=>{
  const f=fixture();f.state.crosshairPinned=true;const r=await f.run();assert.equal(r.status,'READY');assert.equal(r.actionPerformed,'CLEAR_CURRENT_CHART_POINTER');assert.equal(r.pointerExited,true);assert.equal(f.state.crosshairPinned,false);assert.deepEqual(f.actions,[]);assert.deepEqual(f.events.map(e=>e.type),['pointerout','pointerleave','mouseout','mouseleave']);assert.ok(f.events.every(e=>e.node===f.minute&&e.relatedTarget===f.paper));assert.equal(r.presetApplied,false);assert.equal(r.submitCapabilityCreated,false);
});
