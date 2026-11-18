import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readTradovateNativeReadiness} from '../tradovate-native-readiness.mjs';

const sourceUrl='https://www.tradingview.com/chart/ARROWFR1/';
function fixture(){
  const actions=[];
  class Node{
    constructor(attributes={},text='',parent=null){this.attributes=attributes;this.textContent=text;this.parentElement=parent;this.isConnected=true;this.nodes=new Map();this.disabled=false;this.readOnly=false;this.value='';this.style={};}
    getAttribute(key){return this.attributes[key]??null;}
    getClientRects(){return this.style.display==='none'?[]:[{width:100,height:30}];}
    querySelectorAll(selector){return this.nodes.get(selector)??[];}
    click(){actions.push('click');throw Error('NO_ACTION_ALLOWED');}
    dispatchEvent(){actions.push('event');throw Error('NO_ACTION_ALLOWED');}
    setAttribute(){actions.push('setAttribute');throw Error('NO_ACTION_ALLOWED');}
  }
  const body=new Node(),node=(attributes={},text='',parent=body)=>new Node(attributes,text,parent),
    doc={body,visibilityState:'visible',hidden:false,nodes:new Map(),querySelectorAll(selector){return this.nodes.get(selector)??[];},addEventListener(){actions.push('listener');throw Error('NO_ACTION_ALLOWED');}},
    put=(selector,nodes,root=doc)=>root.nodes.set(selector,nodes),
    provider=node({'aria-label':'Collapse account manager'},'Tradovate'),manager=node({'aria-label':'Account manager'}),selector=node({'data-qa-id':'account-selector'},'',manager),account=node({},'PAAPEX6742230000003',selector),
    replay=node({'aria-pressed':'false'}),panel=node({'aria-label':'Trading panel'}),ticket=node({'aria-label':'Order ticket'},'',panel),
    order=node({'aria-checked':'true'},'Order',panel),dom=node({'aria-checked':'false'},'DOM',panel),
    qty=node({'aria-label':'Units'},'',ticket),qtyType=node({},'Units',ticket),market=node({id:'Market','aria-selected':'true'},'Market',ticket),
    buy=node({class:'side active-native'},'Buy 27800.25',ticket),sell=node({class:'side'},'Sell 27800.00',ticket),favorite=node({'data-qa-id':'favorite-preset-tag-1','aria-label':'Preset "ROI MARKET 20/30"'},'R',ticket);
  qty.value='1';
  put('[role="dialog"],[aria-modal="true"]',[]);put('#header-toolbar-replay',[replay]);put('[data-qa-id="replay_trading"]',[]);
  put('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]',[provider]);put('[aria-label="Account manager"]',[manager]);put('[data-qa-id="account-selector"]',[selector],manager);put('[class*="accountName-"]',[account],selector);
  put('[aria-label="Trading panel"]',[panel]);put('[aria-label="Order ticket"]',[ticket],panel);put('[role="radio"]',[order,dom],panel);put('[title]',[node({title:'NQZ2026'},'',panel),node({title:'Continuous futures is used for charting, but the NQZ2026 contract will be used for order placement.'},'',panel)],panel);
  put('[data-name="position-panel"]',[],panel);put('input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]',[qty],ticket);put('[data-qa-id="quantity-dropdown-types"]',[qtyType],ticket);put('[role="tab"][aria-selected="true"]',[market],ticket);put('[data-name="side-control-buy"][role="button"]',[buy],ticket);put('[data-name="side-control-sell"][role="button"]',[sell],ticket);put('button[data-qa-id^="favorite-preset-tag-"]',[favorite],ticket);
  const exits={};
  for(const [kind,value,caption] of [['stop-loss','30','Stop loss ticks'],['take-profit','20','Take profit ticks']]){
    const sw=node({'aria-checked':'true'},'',ticket),field=node({},'',ticket),unit=node({},caption,ticket);sw.checked=true;field.value=value;exits[kind]={sw,field,unit};
    put(`input[role="switch"][data-qa-id="order-ticket-${kind}-checkbox-bracket"]`,[sw],ticket);put(`input[data-qa-id~="order-ticket-${kind}-input"]`,[field],ticket);put(`button[data-qa-id="order-ticket-${kind}-dropdown-button"]`,[unit],ticket);
  }
  const tables={};
  for(const kind of ['positions','orders']){
    const table=node({'data-name':`TRADOVATE.${kind}-table`},'',manager),ids=kind==='positions'?['symbol','side','qty','avgPrice','unrealizedPl','updateTime','id']:['symbol','side','type','qty','remainingQty','filledQty','limitPrice','stopPrice','takeProfit','stopLoss','avgPrice','status','updateTime','id'],
      headers=ids.map(id=>node({id},id,table)),row=node({},'',table),empty=node({},'Nothing to show yet. Your account activity will appear here.',row);
    put(`table[role="grid"][data-name="TRADOVATE.${kind}-table"]`,[table],manager);put('thead th',headers,table);put('tbody tr',[row],table);put('[data-qa-id~="account-manager-tab-empty-state"]',[empty],table);tables[kind]={table,headers,row,empty};
  }
  const context=vm.createContext({document:doc,location:{href:sourceUrl},Date:{now:()=>2000},URL,getComputedStyle:n=>({display:'block',visibility:'visible',contentVisibility:'visible',...n.style}),fetch(){actions.push('fetch');throw Error('NO_NETWORK_ALLOWED');},chrome:new Proxy({}, {get(){actions.push('chrome');throw Error('NO_EXTENSION_ACTION_ALLOWED');}})});
  const command={sourceTabId:7,sourceUrl,nativeAccountId:'PAAPEX6742230000003',environment:'PA'};
  const run=(patch={})=>JSON.parse(JSON.stringify(vm.runInContext(`(${readTradovateNativeReadiness.toString()})(${JSON.stringify({...command,...patch})})`,context)));
  return {actions,doc,put,node,provider,manager,selector,account,replay,panel,ticket,order,dom,qty,qtyType,market,buy,sell,favorite,exits,tables,context,command,run};
}

test('serialized native PA observation reports exact identity and original preset fields without any execution authority or action',()=>{
  const f=fixture(),r=f.run();assert.equal(r.status,'PREPARATION_ONLY');assert.equal(r.account.nativeAccountId,f.command.nativeAccountId);assert.equal(r.account.provider,'TRADOVATE');assert.equal(r.account.environmentVerified,false);
  assert.equal(r.preset.quantity,1);assert.equal(r.preset.stop.value,30);assert.equal(r.preset.target.value,20);assert.equal(r.preset.orderType,'MARKET');assert.equal(r.preset.name,'ROI MARKET 20/30');
  assert.deepEqual(r.capabilities,{inspectAccount:true,preflight:false,submitMarket:false,reconcile:false});for(const key of ['botActive','executionReady','ordersCreated','submitted','realBrokerOrdersAuthorized'])assert.equal(r[key],false);
  for(const code of ['EXECUTION_ADAPTER_NOT_IMPLEMENTED','BROKER_ENVIRONMENT_NOT_ATTESTED','NATIVE_INVENTORY_COMPLETENESS_NOT_VERIFIED','PRESET_INHERITANCE_NOT_VERIFIED'])assert.ok(r.missingChecks.includes(code));
  assert.equal(r.preset.freshApplicationVerified,false);assert.equal(r.preset.inheritanceVerified,false);assert.equal(r.preset.protectionVerified,false);assert.equal(r.preset.inputValuesSetByDriver,false);assert.deepEqual(f.actions,[]);
});
test('source URL, visible account, exact provider, Replay, modal and declared PA environment cannot be bypassed by caller flags',()=>{
  for(const mutate of [f=>{f.context.location.href='https://www.tradingview.com/chart/another/';},f=>{f.doc.hidden=true;},f=>{f.provider.textContent='Paper Trading';},f=>{f.account.textContent='OTHER';},f=>{f.replay.attributes['aria-pressed']='true';},f=>{f.put('[role="dialog"],[aria-modal="true"]',[f.node()]);}]){
    const f=fixture();mutate(f);const r=f.run({executionReady:true,botActive:true,ordersAuthorized:true,environmentVerified:true});assert.equal(r.status,'BLOCKED');assert.equal(r.executionReady,false);assert.equal(r.botActive,false);assert.equal(r.account,null);assert.deepEqual(f.actions,[]);
  }
  const f=fixture();for(const patch of [{environment:'DEMO'},{environment:'LIVE'},{sourceTabId:0},{sourceUrl:sourceUrl+'?x=1'},{sourceUrl:'https://evil.test/chart/ARROWFR1/'},{nativeAccountId:''}])assert.equal(f.run(patch).status,'BLOCKED');
});
test('duplicate consistent provider labels are allowed; conflicting providers or ambiguous native account labels are blocked',()=>{
  const f=fixture(),key='button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]';f.put(key,[f.provider,f.node({},'Tradovate')]);assert.equal(f.run().account.nativeIdentityVerified,true);
  f.put(key,[f.provider,f.node({},'Another Broker')]);assert.equal(f.run().status,'BLOCKED');f.put(key,[f.provider]);f.put('[class*="accountName-"]',[f.account,f.node({},f.command.nativeAccountId)],f.selector);assert.equal(f.run().status,'BLOCKED');
});
test('a missing or hidden native Order card produces explicit preparation gaps and never assumes the screenshot preset',()=>{
  for(const mutate of [f=>f.put('[aria-label="Order ticket"]',[],f.panel),f=>{f.ticket.style.display='none';},f=>{f.order.attributes['aria-checked']='false';f.dom.attributes['aria-checked']='true';}]){
    const f=fixture();mutate(f);const r=f.run();assert.equal(r.status,'INCOMPLETE');assert.equal(r.preset,null);assert.ok(r.missingChecks.includes('NEW_NATIVE_MARKET_ORDER_TICKET_REQUIRED'));assert.equal(r.executionReady,false);assert.deepEqual(f.actions,[]);
  }
});
test('native quantity, Market selection, side, protective fields, mapping and favorite ambiguity remain individually observable requirements',()=>{
  for(const [code,mutate] of [
    ['NATIVE_UNITS_QUANTITY_REQUIRED',f=>{f.qty.value='0';}],['NATIVE_MARKET_TYPE_REQUIRED',f=>{f.market.attributes.id='Limit';}],['NATIVE_ORDER_SIDE_REQUIRED',f=>{f.buy.attributes.class='side';}],
    ['NATIVE_STOP_AND_TARGET_FIELDS_REQUIRED',f=>{f.exits['stop-loss'].sw.checked=false;}],['NATIVE_STOP_AND_TARGET_FIELDS_REQUIRED',f=>{f.exits['take-profit'].field.value='NaN';}],
    ['SOLE_NATIVE_FAVORITE_REQUIRED',f=>f.put('button[data-qa-id^="favorite-preset-tag-"]',[f.favorite,f.node({},'X')],f.ticket)],['EXACT_DATED_NQ_MAPPING_REQUIRED',f=>f.put('[title]',[],f.panel)]
  ]){const f=fixture();mutate(f);const r=f.run();assert.equal(r.status,'INCOMPLETE');assert.ok(r.missingChecks.includes(code));assert.equal(r.executionReady,false);assert.deepEqual(f.actions,[]);}
});
test('a visible preset notice is name observation only and missing or contradictory names never become applied-preset proof',()=>{
  const f=fixture();f.favorite.attributes['aria-label']='R';let r=f.run();assert.equal(r.preset.name,null);assert.ok(r.missingChecks.includes('NATIVE_PRESET_NAME_OBSERVATION_REQUIRED'));
  f.put('[role="tooltip"]',[f.node({},'Preset "My PA preset" applied')]);r=f.run();assert.equal(r.preset.name,'My PA preset');assert.equal(r.preset.freshApplicationVerified,false);assert.equal(r.preset.inheritanceVerified,false);
  f.put('[role="tooltip"]',[f.node({},'Preset "One" applied'),f.node({},'Preset "Two" applied')]);assert.equal(f.run().preset.name,null);assert.deepEqual(f.actions,[]);
});
test('visible empty tables are scoped observations and missing rows, hidden tables, pagination, filters or loading never prove complete inventory',()=>{
  const f=fixture();let r=f.run();assert.equal(r.inventory.positions.explicitEmptyObserved,true);assert.equal(r.inventory.orders.explicitEmptyObserved,true);assert.equal(r.inventory.positionsComplete,false);assert.equal(r.inventory.workingOrdersComplete,false);assert.equal(r.inventory.flatVerified,false);
  f.tables.positions.table.style.display='none';f.put('tbody tr',[],f.tables.orders.table);f.put('[data-qa-id~="account-manager-tab-empty-state"]',[],f.tables.orders.table);
  f.put('[role="progressbar"],[data-qa-id="account-manager-table-loader"]',[f.node()],f.manager);f.put('[aria-label*="page" i],[data-qa-id*="pagination"]',[f.node()],f.manager);
  const filter=f.node();filter.value='NQ';f.put('input[type="search"],[role="searchbox"],[aria-label*="filter" i][aria-pressed="true"],[data-qa-id*="filter"][aria-pressed="true"]',[filter],f.manager);
  r=f.run();assert.equal(r.inventory.positions.visible,false);assert.equal(r.inventory.orders.explicitEmptyObserved,false);assert.equal(r.inventory.orders.loading,true);assert.equal(r.inventory.orders.paginationObserved,true);assert.equal(r.inventory.orders.activeFilterObserved,true);assert.equal(r.inventory.flatVerified,false);assert.ok(r.missingChecks.includes('VISIBLE_TRADOVATE_POSITIONS_SCHEMA_REQUIRED'));assert.deepEqual(f.actions,[]);
});
test('incomplete or duplicated table columns are not treated as the observed Tradovate schema',()=>{
  const f=fixture();f.put('thead th',f.tables.orders.headers.slice(1),f.tables.orders.table);let r=f.run();assert.equal(r.inventory.orders.schemaObserved,false);assert.ok(r.missingChecks.includes('VISIBLE_TRADOVATE_ORDERS_SCHEMA_REQUIRED'));
  f.put('thead th',[...f.tables.positions.headers,f.node({id:'qty'},'Qty')],f.tables.positions.table);r=f.run();assert.equal(r.inventory.positions.schemaObserved,false);assert.equal(r.inventory.flatVerified,false);assert.deepEqual(f.actions,[]);
});
