import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inspectReplayOrderPreset} from '../replay-order-preset-inspector.mjs';

// Public native selectors copied from actual saved inspector/menu artifacts.
// These are component fixtures, not saved user presets or inheritance proofs.
function fixture({mode='ORDER',alreadyOpen=false,transient=false}={}){
  const state={perf:0,now:Date.UTC(2026,10,15),mode,menuOpen:alreadyOpen,menuClicks:0,orderClicks:0,domClicks:0,submitClicks:0,saveClicks:0,presetClicks:0,fieldWrites:0,onFrame:null,onMenu:null,transitionTicks:0,pendingMode:null};
  class Node{
    constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.tagName='DIV';this.isConnected=true;this.width=100;this.height=30;this.map=new Map();this.disabled=false;}
    getAttribute(k){return this.attrs[k]??null;}getClientRects(){return [{width:this.width,height:this.height}];}getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
    querySelectorAll(k){const a=this.map.get(k)??[];return typeof a==='function'?a():a;}
    dispatchEvent(e){if(e.type==='click')this.onClick?.();return true;}
  }
  const doc=new Node();doc.visibilityState='visible';doc.hidden=false;doc.listeners=new Map();doc.addEventListener=(e,f)=>doc.listeners.set(e,[...(doc.listeners.get(e)??[]),f]);doc.removeEventListener=(e,f)=>doc.listeners.set(e,(doc.listeners.get(e)??[]).filter(x=>x!==f));doc.fire=e=>{for(const f of doc.listeners.get(e)??[])f({isTrusted:true,type:e});};
  const layout=new Node({'aria-label':'Logged in as test Active layout: Arrow research'}),chart=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),replay=new Node({'aria-pressed':'true'}),footer=new Node(),provider=new Node({},'Replay Trading'),
    panel=new Node(),ticket=new Node(),title=new Node({title:'NQ1!'}),logo=new Node({src:'https://static.tradingview.com/static/bundles/replay-broker.fixture.svg'}),order=new Node({},'Order'),dom=new Node({},'DOM');
  order.getAttribute=k=>k==='aria-checked'?String(state.mode==='ORDER'):null;dom.getAttribute=k=>k==='aria-checked'?String(state.mode==='DOM'):null;
  const menuButton=new Node({'data-qa-id':'header-order-presets-menu-button'});menuButton.getAttribute=k=>k==='class'?'button'+(state.menuOpen?' active-IeQwPjcZ':''):menuButton.attrs[k]??null;
  const popup=new Node({class:'flex-go0ZeNQF'},'Save order preset... No order presets created yet'),empty=new Node({class:'emptyStateText-smD5tLxJ'},'No order presets created yet'),save=new Node({},'Save order preset...');
  menuButton.onClick=()=>{state.menuClicks++;state.menuOpen=!state.menuOpen;state.onMenu?.();};save.onClick=()=>state.saveClicks++;
  const setMode=next=>{state.transitionTicks=0;state.pendingMode=next;state.mode=transient?'TRANSITION':next;};
  order.onClick=()=>{state.orderClicks++;setMode('ORDER');};dom.onClick=()=>{state.domClicks++;setMode('DOM');};
  const mkInput=(attrs,initial)=>{const n=new Node(attrs);let val=String(initial);Object.defineProperty(n,'value',{get:()=>val,set:v=>{state.fieldWrites++;val=String(v);}});return n;};
  const qty=mkInput({'aria-label':'Units'},1),stop=mkInput({},37),target=mkInput({},74),stopSwitch=new Node({'aria-checked':'false'}),targetSwitch=new Node({'aria-checked':'false'}),
    stopMode=new Node({},'Stop loss ticks'),targetMode=new Node({},'Take profit ticks'),limit=new Node({},'Limit'),submit=new Node({'data-name':'place-and-modify-button'},'Buy 1 NQ1! @ 27,934.00 LIMIT');
  stopSwitch.checked=targetSwitch.checked=false;submit.onClick=()=>state.submitClicks++;
  for(const [selector,nodes] of [['[role="dialog"]',[]],['[aria-label^="Logged in as"]',[layout]],['canvas[aria-label^="Chart for "]',[chart]],['#header-toolbar-replay',[replay]],['#footer-chart-panel',[footer]],
    ['[aria-label="Account manager"],[data-qa-id="account-selector"]',[]],['button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]',[]],['[aria-label="Trading panel"]',[panel]]])doc.map.set(selector,nodes);
  footer.map.set('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',[provider]);doc.map.set('div[class~="flex-go0ZeNQF"]',()=>state.menuOpen?[popup]:[]);
  panel.map.set('[aria-label="Order ticket"]',()=>state.mode==='ORDER'?[ticket]:[]);panel.map.set('[role="radio"]',[order,dom]);panel.map.set('[title]',[title]);panel.map.set('img[src]',[logo]);panel.map.set('button[data-qa-id="header-order-presets-menu-button"]',[menuButton]);
  ticket.map.set('[role="tab"][aria-selected="true"]',[limit]);ticket.map.set('[data-name="place-and-modify-button"]',[submit]);ticket.map.set('input[aria-label="Units"]',[qty]);
  ticket.map.set('[data-qa-id="order-ticket-stop-loss-checkbox-bracket"]',[stopSwitch]);ticket.map.set('[data-qa-id="order-ticket-take-profit-checkbox-bracket"]',[targetSwitch]);
  ticket.map.set('[data-qa-id="order-ticket-stop-loss-dropdown-button"]',[stopMode]);ticket.map.set('[data-qa-id="order-ticket-take-profit-dropdown-button"]',[targetMode]);
  ticket.map.set('input[data-qa-id~="order-ticket-stop-loss-input"]',[stop]);ticket.map.set('input[data-qa-id~="order-ticket-take-profit-input"]',[target]);
  popup.map.set('div[class~="emptyStateText-smD5tLxJ"]',[empty]);popup.map.set('button,[role],[data-qa-id]',[save]);
  const context=vm.createContext({document:doc,location:{protocol:'https:',hostname:'www.tradingview.com',origin:'https://www.tradingview.com',pathname:'/chart/research/'},URL,Date:class extends Date{static now(){return state.now;}},performance:{now:()=>state.perf},
    getComputedStyle:n=>({visibility:'visible',display:'block',overflowX:n.overflowX??'visible',overflowY:n.overflowY??'visible'}),MouseEvent:class{constructor(type,data){this.type=type;Object.assign(this,data);}},PointerEvent:class{constructor(type,data){this.type=type;Object.assign(this,data);}},
    requestAnimationFrame:f=>queueMicrotask(()=>{state.perf+=16;state.now+=16;state.onFrame?.();f();}),setTimeout:(f,ms)=>queueMicrotask(()=>{state.perf+=ms;state.now+=ms;if(state.mode==='TRANSITION'&&++state.transitionTicks===2)state.mode=state.pendingMode;f();})});
  const expected={researchUrl:'https://www.tradingview.com/chart/research/',instrument:'CME_MINI:NQ1!',timeframe:'1',sourceTabId:17},call=async(args={})=>{context.command={expected,...args};return JSON.parse(JSON.stringify(await vm.runInContext('('+inspectReplayOrderPreset.toString()+')(command)',context)));};
  return {state,Node,doc,layout,chart,replay,provider,panel,ticket,title,logo,order,dom,menuButton,popup,empty,save,qty,stop,target,stopSwitch,targetSwitch,stopMode,targetMode,limit,submit,context,expected,call};
}

test('actual empty preset menu proves MISSING even when an unrelated LIMIT TEST draft contains37/74 with both exitsOFF',async()=>{
  const f=fixture(),r=await f.call();assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_MISSING');assert.equal(r.presets.state,'NONE');assert.deepEqual(r.presets.names,[]);
  assert.equal(r.ticket.orderType,'LIMIT');assert.equal(r.ticket.stopLoss.value,37);assert.equal(r.ticket.takeProfit.value,74);assert.equal(r.ticket.stopLoss.enabled,false);assert.equal(r.ticket.takeProfit.enabled,false);
  assert.equal(r.protectionPresetVerified,false);assert.equal(r.inheritanceVerified,false);assert.equal(r.leaseMinted,false);assert.equal(r.submitCapabilityCreated,false);
  assert.equal(f.state.menuClicks,2);assert.equal(f.state.menuOpen,false);assert.equal(r.navigation.menuClosedByInspector,true);assert.equal(f.state.fieldWrites,0);assert.equal(f.state.submitClicks+f.state.saveClicks+f.state.presetClicks,0);
});

test('DOM navigation tolerates a bounded native Order-root remount but never edits fields, selects type or requests a side change',async()=>{
  const f=fixture({mode:'DOM',transient:true}),r=await f.call({direction:'SHORT'});assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_MISSING');assert.equal(f.state.orderClicks,1);
  assert.equal(r.navigation.openedOrderTab,true);assert.equal(r.ticket.nativeSide,'BUY');assert.equal(r.ticket.requestedDirection,'SHORT');assert.equal(r.ticket.orderType,'LIMIT');assert.equal(f.state.fieldWrites,0);assert.equal(f.state.submitClicks,0);
  assert.equal(f.state.mode,'DOM');assert.equal(f.state.domClicks,1);assert.equal(r.navigation.modeRestored,true);assert.equal(r.navigation.finalMode,'DOM');
});

test('an already-open user preset menu is read without toggling or claiming ownership of its cleanup',async()=>{
  const f=fixture({alreadyOpen:true}),r=await f.call();assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_MISSING');assert.equal(r.navigation.menuAlreadyOpen,true);
  assert.equal(r.navigation.menuOpenedByInspector,false);assert.equal(r.navigation.menuClosedByInspector,false);assert.equal(f.state.menuClicks,0);assert.equal(f.state.menuOpen,true);
});

test('an existing user popup in DOM is never closed or navigated away from',async()=>{
  const f=fixture({mode:'DOM',alreadyOpen:true}),r=await f.call();assert.equal(r.status,'BLOCKED');assert.ok(r.reasonCodes.includes('REPLAY_PRESET_EXISTING_MENU_REQUIRES_REVIEW'));
  assert.equal(f.state.mode,'DOM');assert.equal(f.state.menuOpen,true);assert.equal(f.state.menuClicks+f.state.orderClicks+f.state.domClicks,0);assert.equal(r.navigation.modeRestored,true);
});

test('trusted input after inspector navigation prevents closing or restoring a possibly user-owned popup/view',async()=>{
  const f=fixture({mode:'DOM'});f.state.onMenu=()=>f.doc.fire('pointerdown');const r=await f.call();assert.equal(r.status,'BLOCKED');assert.equal(r.navigation.cleanupSkippedBecauseUserInput,true);
  assert.equal(f.state.mode,'ORDER');assert.equal(f.state.domClicks,0);assert.equal(f.state.menuClicks,1);assert.equal(f.state.menuOpen,true);assert.equal(f.state.fieldWrites,0);assert.equal(f.state.submitClicks+f.state.saveClicks,0);
});

test('supported explicit semantic preset names can be recorded but never imply configured inheritance or enable an order',async()=>{
  const f=fixture(),row=new f.Node({role:'menuitemradio','aria-checked':'true'},'User preset');f.popup.textContent='Save order preset... User preset';
  f.popup.map.set('div[class~="emptyStateText-smD5tLxJ"]',[]);f.popup.map.set('[role="menuitemradio"],[role="option"]',[row]);
  const r=await f.call();assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_UNVERIFIED');assert.deepEqual(r.presets.names,['User preset']);assert.equal(r.presets.selectedName,'User preset');
  assert.equal(r.presets.selectedIdentityVerified,false);assert.equal(r.protectionPresetVerified,false);assert.equal(f.state.submitClicks+f.state.saveClicks+f.state.presetClicks,0);
});

test('unknown saved-list markup and unavailable TIF remain unknown instead of inventing native values or named presets',async()=>{
  const f=fixture();f.popup.textContent='Save order preset... some new row';f.popup.map.set('div[class~="emptyStateText-smD5tLxJ"]',[]);
  const r=await f.call();assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_UNVERIFIED');assert.equal(r.presets.names,null);assert.equal(r.presets.selectedName,null);assert.equal(r.ticket.timeInForce.available,false);assert.equal(r.protectionPresetVerified,false);
});

function remountHeader(f,{replacePopup=false,changeDraft=false,trusted=false}={}){
  let replaced=false;
  f.state.onFrame=()=>{if(replaced||!f.state.menuOpen)return;replaced=true;
    const next=new f.Node({'data-qa-id':'header-order-presets-menu-button'});next.getAttribute=k=>k==='class'?'button'+(f.state.menuOpen?' active-IeQwPjcZ':''):next.attrs[k]??null;
    next.onClick=()=>{f.state.menuClicks++;f.state.menuOpen=!f.state.menuOpen;};f.menuButton.isConnected=false;
    f.panel.map.set('button[data-qa-id="header-order-presets-menu-button"]',[next]);f.state.remountedButton=next;
    if(replacePopup){const foreign=new f.Node({class:'flex-go0ZeNQF'},f.popup.textContent);foreign.map=f.popup.map;f.doc.map.set('div[class~="flex-go0ZeNQF"]',()=>f.state.menuOpen?[foreign]:[]);}
    if(changeDraft)f.stop.value=99;if(trusted)f.doc.fire('pointerdown');
  };
}

test('native header remount may rebind only its same owned popup and unchanged ticket, then close and restore original DOM',async()=>{
  const f=fixture({mode:'DOM',transient:true});remountHeader(f);const r=await f.call();
  assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_MISSING');assert.equal(r.navigation.menuButtonReboundAfterNativeRemount,true);assert.equal(r.navigation.menuClosedByInspector,true);assert.equal(r.navigation.modeRestored,true);
  assert.equal(f.state.mode,'DOM');assert.equal(f.state.menuOpen,false);assert.equal(f.state.menuClicks,2);assert.equal(f.state.fieldWrites,0);assert.equal(f.state.submitClicks+f.state.saveClicks,0);
});

test('closing the owned popup polls a fresh remounted inactive header instead of a disconnected old button retaining active class',async()=>{
  const f=fixture({mode:'DOM',transient:true});let opened=false;
  f.menuButton.onClick=()=>{f.state.menuClicks++;if(!opened){opened=true;f.state.menuOpen=true;return;}
    f.state.menuOpen=false;f.menuButton.isConnected=false;
    f.menuButton.getAttribute=k=>k==='class'?'button active-IeQwPjcZ':f.menuButton.attrs[k]??null;
    const fresh=new f.Node({'data-qa-id':'header-order-presets-menu-button',class:'button'});fresh.onClick=()=>{throw Error('must not retry close or reopen');};
    f.panel.map.set('button[data-qa-id="header-order-presets-menu-button"]',[fresh]);
  };
  const r=await f.call();assert.equal(r.status,'USER_REPLAY_BRACKET_PRESET_MISSING');assert.equal(r.navigation.menuCloseHeaderReboundAfterNativeRemount,true);
  assert.equal(r.navigation.menuClosedByInspector,true);assert.equal(r.navigation.modeRestored,true);assert.equal(f.state.mode,'DOM');assert.equal(f.state.menuOpen,false);
  assert.equal(f.state.menuClicks,2);assert.equal(f.state.fieldWrites,0);assert.equal(f.state.submitClicks+f.state.saveClicks,0);
});

test('a remounted header cannot authorize closing a replaced popup, changed draft or trusted user menu',async()=>{
  for(const change of [{replacePopup:true},{changeDraft:true},{trusted:true}]){
    const f=fixture({mode:'DOM'});remountHeader(f,change);const r=await f.call();assert.equal(r.status,'BLOCKED');assert.equal(r.navigation.menuClosedByInspector,false);
    assert.equal(f.state.menuClicks,1);assert.equal(f.state.menuOpen,true);assert.equal(f.state.domClicks,0);assert.equal(f.state.submitClicks+f.state.saveClicks,0);
  }
});

test('wrong layout/provider, multiple charts, modals, dated tickets and collapsed native panels block before any inspector click',async()=>{
  for(const change of [f=>{f.layout.attrs['aria-label']='Active layout: Original';},f=>{f.provider.textContent='Paper Trading';},f=>{f.doc.map.set('canvas[aria-label^="Chart for "]',[f.chart,f.chart]);},
    f=>{f.doc.map.set('[role="dialog"]',[new f.Node()]);},f=>{f.title.attrs.title='NQZ2026';},f=>{f.panel.width=0;}]){
    const f=fixture();change(f);assert.equal((await f.call()).status,'BLOCKED');assert.equal(f.state.menuClicks+f.state.orderClicks+f.state.submitClicks+f.state.saveClicks,0);
  }
});

test('draft changes and trusted user intervention prevent an unchanged-preset claim and never trigger Save or submission',async()=>{
  const changed=fixture();changed.state.onMenu=()=>{if(changed.state.menuOpen)changed.stop.value=99;};const r=await changed.call();assert.equal(r.status,'BLOCKED');assert.ok(r.reasonCodes.includes('REPLAY_PRESET_DRAFT_CHANGED_DURING_INSPECTION'));assert.equal(changed.state.submitClicks+changed.state.saveClicks,0);
  const interrupted=fixture();interrupted.state.onMenu=()=>interrupted.doc.fire('pointerdown');const stop=await interrupted.call();assert.equal(stop.status,'BLOCKED');assert.ok(stop.reasonCodes.includes('REPLAY_PRESET_INSPECTION_INTERRUPTED'));assert.equal(interrupted.state.submitClicks+interrupted.state.saveClicks,0);
});

test('existing-position or registered-order editors cannot be confused with a saved preset setup',async()=>{
  for(const title of ['NQ1!, order order_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','NQZ2026']){
    const f=fixture();f.title.attrs.title=title;assert.equal((await f.call()).status,'BLOCKED');assert.equal(f.state.menuClicks,0);
  }
});
