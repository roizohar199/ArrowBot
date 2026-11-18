import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readReplayTradingPublicControls} from '../replay-ui-inspection.mjs';

// Bounded public DOM diagnostic fixtures only; not native platform proof.
function fixture(mode='DOM'){
  class Node{
    constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.tagName='DIV';this.map=new Map();this.width=100;this.height=30;}
    getAttribute(key){return this.attrs[key]??null;}get innerText(){return this.textContent;}
    getClientRects(){return [{width:this.width,height:this.height}];}
    getBoundingClientRect(){return {x:0,y:0,left:0,top:0,right:this.width,bottom:this.height,width:this.width,height:this.height};}
    querySelectorAll(selector){return this.map.get(selector)??[];}querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false;}
  }
  const doc=new Node();doc.visibilityState='visible';doc.body=new Node();doc.documentElement=new Node();
  Object.defineProperty(doc.body,'textContent',{get(){throw Error('Full body text must not be read');}});
  const layout=new Node({'aria-label':'Logged in as fixture Active layout: Arrow Replay research'}),chart=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),
    replay=new Node({'aria-pressed':'true'}),panel=new Node({'aria-label':'Trading panel'}),ticket=new Node({'aria-label':'Order ticket'},'Tick value 5.00 USD'),
    position=new Node({'data-name':'position-panel'},'Long 1 @ 27,723.00 Exits'),radio=new Node({role:'radio','aria-checked':'true'},'DOM'),
    provider=new Node({'aria-label':'Collapse Replay Trading'},'Replay Trading'),root=new Node({'data-name':'chart-pane'}),parent=new Node(),
    tradeLabel=new Node({'data-name':'position-label'},'BUY 1 @ 27,723.00'),modeButton=new Node({'data-qa-id':'switch-mode-DOM',title:'Enable dynamic mode'}),
    main=new Node({class:'tv-dom-widget-main-VBTMesvS'}),price=new Node({'data-qa-id':'dom-cell-0-price'},'27,741.50'),
    cell=new Node({'data-qa-id':'dom-cell-0-orders-sell'},'1 Limit'),qty=new Node({class:'tv-dom-widget-order__qty-jnISyeJE'},'1');
  chart.tagName='CANVAS';chart.parentElement=parent;parent.parentElement=root;tradeLabel.parentElement=root;
  modeButton.parentElement=panel;main.parentElement=panel;price.parentElement=main;cell.parentElement=main;qty.parentElement=cell;
  main.clientHeight=467;main.scrollHeight=482;main.clientWidth=300;main.scrollWidth=300;main.scrollTop=0;
  for(const [selector,nodes] of [['[aria-label^="Logged in as"]',[layout]],['canvas[aria-label^="Chart for "]',[chart]],
    ['#header-toolbar-replay',[replay]],['[aria-label="Trading panel"]',[panel]],
    ['button[aria-label="Collapse Replay Trading"],button[aria-label="Open Replay Trading"]',[provider]]])doc.map.set(selector,nodes);
  panel.map.set('[aria-label="Order ticket"]',mode==='ORDER_TICKET'?[ticket]:[]);
  panel.map.set('[data-name="position-panel"]',mode==='POSITION_EDITOR'?[position]:[]);
  panel.map.set('[role="radio"][aria-checked="true"]',mode==='DOM'?[radio]:[]);
  panel.map.set('input,textarea,button,[role="button"],[role="tab"],[role="switch"]',[modeButton]);
  panel.map.set('[class*="tv-dom-widget-main-"],[class*="tv-dom-widget-main__anchor-"]',[main]);
  panel.map.set('[data-qa-id^="dom-cell-"]',[price,cell]);
  panel.map.set('[data-qa-id="switch-mode-DOM"],[data-qa-id="position-DOM"],[data-qa-id="switch-pl-view"]',[modeButton]);
  cell.map.set('div[class*="tv-dom-widget-order-"]',[qty]);
  cell.map.set('div[class*="tv-dom-widget-order-"],span[class*="tv-dom-widget-order__qty-"],span[class*="tv-dom-widget-order__type-"],div[class*="tv-dom-widget-order__close-"]',[qty]);
  const tradeSelector='[data-name*="position"],[data-name*="order"],[data-qa-id*="position"],[data-qa-id*="protect"],[class*="orderLine"],[class*="order-line"],[class*="positionLine"],[class*="position-line"]';
  doc.map.set(tradeSelector,[tradeLabel]);
  root.map.set('span,button,[role="button"],[title],[aria-label],[data-name],[data-qa-id]',[tradeLabel]);
  const context=vm.createContext({document:doc,location:{protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/research/',origin:'https://www.tradingview.com'},Date,
    getComputedStyle:node=>({visibility:'visible',display:'block',overflowX:node.overflowX??'visible',overflowY:node.overflowY??'visible'})});
  const read=()=>JSON.parse(JSON.stringify(vm.runInContext('('+readReplayTradingPublicControls.toString()+')()',context)));
  return {Node,doc,panel,chart,provider,modeButton,main,price,cell,tradeLabel,tradeSelector,read};
}

test('public diagnostic supports Order, DOM and existing position editors without requiring a fresh Order ticket',()=>{
  for(const mode of ['ORDER_TICKET','DOM','POSITION_EDITOR']){
    const f=fixture(mode),r=f.read();assert.equal(r.status,'OBSERVED');assert.equal(r.panelMode,mode);
    assert.equal(r.ordersCreated,false);assert.equal(r.diagnostic.readOnly,true);assert.equal(r.diagnostic.privateApiRead,false);
  }
});

test('public diagnostic exposes bounded scroll, dynamic-mode, protection-cell and chart-label metadata without whole-body text',()=>{
  const f=fixture(),r=f.read(),d=r.diagnostic;
  assert.equal(d.domModeControls[0].attributes.title,'Enable dynamic mode');assert.equal(d.domScrollSurfaces[0].scrollHeight,482);
  assert.equal(d.visibleProtectionOrderCells[0].priceText,'27,741.50');assert.equal(d.visibleProtectionOrderCells[0].children[0].text,'1');
  assert.equal(d.chartTradeNodes[0].attributes['data-name'],'position-label');assert.equal(d.chartTradeNodes[0].ancestors[0].attributes['data-name'],'chart-pane');
  assert.equal(d.limits.fullBodyTextRead,false);assert.equal(d.limits.fullBodyHtmlRead,false);
  f.doc.map.set(f.tradeSelector,Array.from({length:120},(_,i)=>new f.Node({'data-name':'position-label-'+i},'BUY 1 @ 27,723.00')));
  assert.equal(f.read().diagnostic.chartTradeNodes.length,36); //35 explicit candidates plus1 bounded chart leaf.
});

test('zero-width collapsed panels and non-Replay provider evidence are rejected',()=>{
  const collapsed=fixture();collapsed.panel.width=0;assert.equal(collapsed.read().status,'BLOCKED');
  const wrong=fixture();wrong.provider.textContent='Paper Trading';assert.equal(wrong.read().status,'BLOCKED');
  const original=fixture();original.chart.attrs['aria-label']='Chart for CME_MINI:NQ1!, 5 minutes';assert.equal(original.read().status,'BLOCKED');
});

test('public aggregate-counter diagnostic preserves exact native title and bounded sibling metadata',()=>{
  const f=fixture(),parent=new f.Node({class:'centeringContainer-_JoblSiM'}),counter=new f.Node({title:'2 active orders x 2',class:'countedVolume-_JoblSiM'},'2');
  counter.parentElement=parent;parent.children=[counter,...Array.from({length:30},()=>new f.Node({},'bounded'))];
  f.panel.map.set('[title]',[counter]);const d=f.read().diagnostic.domAggregateCounters;
  assert.equal(d.length,1);assert.equal(d[0].attributes.title,'2 active orders x 2');assert.equal(d[0].text,'2');
  assert.equal(d[0].parent.attributes.class,'centeringContainer-_JoblSiM');assert.equal(d[0].parent.children.length,18);
});
