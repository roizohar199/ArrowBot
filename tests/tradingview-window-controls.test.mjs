import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prepareTradingViewWindowUi} from '../tradingview-window-controls.mjs';

function fixture(){
  const actions=[];
  class Node{
    constructor(attributes={},options={}){this.attributes=attributes;this.parentElement=options.parent??null;this.textContent=options.text??'';this.style=options.style??{};this.rect={left:0,top:0,width:200,height:30,...options.rect};this.children=[];this.queries=new Map();this.disabled=false;this.clientTop=0;this.clientHeight=this.rect.height;this.scrollHeight=this.rect.height;this._scrollTop=0;}
    getAttribute(name){return this.attributes[name]??null;}
    getBoundingClientRect(){return {...this.rect,right:this.rect.left+this.rect.width,bottom:this.rect.top+this.rect.height};}
    querySelectorAll(selector){return this.queries.get(selector)??[];}
    click(){actions.push({kind:'click',node:this});}
    get scrollTop(){return this._scrollTop;}set scrollTop(value){this._scrollTop=value;actions.push({kind:'scroll',node:this,value});}
  }
  const body=new Node({}, {rect:{width:1000,height:800}}),document={body,documentElement:body,queries:new Map(),querySelectorAll(selector){return this.queries.get(selector)??[];}};
  const node=(attributes={},options={})=>new Node(attributes,{parent:body,...options});
  const canvas=node({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),toolbar=node({'aria-label':'Object tree and data window'}),tab=node({role:'tab','aria-selected':'true'},{text:'Data window'});
  const row=node({role:'row'}),title=node({title:'Arrow OHLC Window v2 100 5 15'},{parent:row}),plot=node({'data-test-id-value-title':'ARROW2_PROTOCOL'},{parent:row}),show=node({'aria-label':'Show data'},{parent:row});
  row.queries.set('span[title]',[title]);row.queries.set('[data-test-id-value-title^="ARROW2_"]',[plot]);row.queries.set('button, [role="button"]',[show]);
  document.queries.set('canvas[aria-label^="Chart for "]',[canvas]);document.queries.set('[role="dialog"], [aria-modal="true"]',[]);document.queries.set('[role="tab"]',[tab]);document.queries.set('button[aria-label="Object tree and data window"]',[toolbar]);document.queries.set('[role="treegrid"] > div[role="row"]',[row]);
  const sandbox=vm.createContext({document,location:{protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/example/',href:'https://www.tradingview.com/chart/example/'},URL,innerWidth:1000,innerHeight:800,
    getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',overflowY:'visible',contentVisibility:'visible',...node.style})});
  const run=(args={})=>JSON.parse(JSON.stringify(vm.runInContext(`(${prepareTradingViewWindowUi.toString()})(${JSON.stringify(args)})`,sandbox)));
  return {actions,document,body,node,canvas,toolbar,tab,row,title,plot,show,sandbox,run};
}

test('exact serialized production adapter returns READY for selected Data window and own plots without action',()=>{
  const f=fixture(),result=f.run();assert.equal(result.status,'READY');assert.equal(result.phase,'window');assert.equal(result.mountedFields,1);assert.equal(result.action,null);assert.deepEqual(f.actions,[]);
});
test('historical pointer recovery releases only the exact visible LIVE minute chart and never clicks or writes inputs',()=>{
  const f=fixture(),events=[],stamp=Date.now()-120000,seq=12;
  f.sandbox.location.pathname='/chart/ARROWFR1/';f.sandbox.location.href='https://www.tradingview.com/chart/ARROWFR1/';f.document.visibilityState='visible';
  f.document.queries.set('button[aria-label*="Active layout: "]',[f.node({'aria-label':'Active layout: Full Screens Live'})]);
  f.document.queries.set('#header-toolbar-intervals [aria-checked="true"]',[f.node({'data-value':'1'})]);f.document.queries.set('#header-toolbar-replay',[f.node({'aria-pressed':'false'})]);
  const fields=Object.entries({ARROW2_SEQ_BEGIN:seq,ARROW2_SEQ_END:seq,ARROW2_SOURCE_EPOCH:seq*1e12+stamp-1577836800000}).map(([name,value])=>{const parent=f.node(),label=f.node({'data-test-id-value-title':name},{parent}),text=f.node({},{parent,text:String(value)});parent.children=[label,text];return label;});
  f.row.queries.set('[data-test-id-value-title^="ARROW2_"]',fields);f.canvas.dispatchEvent=e=>{events.push(e);return true;};
  f.sandbox.MouseEvent=class{constructor(type,init){Object.assign(this,{type},init);}};
  const args={clearHistoricalPointer:true,sourceUrl:f.sandbox.location.href};
  const r=f.run(args);assert.equal(r.action,'RELEASE_HISTORICAL_POINTER');assert.deepEqual(events.map(e=>e.type),['mouseout','mouseleave']);assert.equal(r.ordersCreated,false);assert.equal(r.layoutChanged,false);assert.deepEqual(f.actions,[]);
  events.length=0;assert.equal(f.run({...args,sourceUrl:'https://www.tradingview.com/chart/other/'}).status,'BLOCKED');assert.equal(events.length,0);
  f.document.hidden=true;assert.equal(f.run(args).status,'BLOCKED');f.document.hidden=false;
  fields[2].parentElement.children[1].textContent=String(seq*1e12+Date.now()-1577836800000);assert.equal(f.run(args).reasonCodes[0],'WINDOW_POINTER_SOURCE_ALREADY_CURRENT');assert.equal(events.length,0);
  fields[2].parentElement.children[1].textContent=String((seq+1)*1e12+stamp-1577836800000);assert.equal(f.run(args).reasonCodes[0],'WINDOW_POINTER_COHERENT_STAMP_REQUIRED');assert.equal(events.length,0);
});

test('offscreen own header without optional tooltip is found and only its nearest panel scrolls',()=>{
  const f=fixture(),panel=f.node({}, {style:{overflowY:'auto'},rect:{top:100,height:100}});
  panel.scrollHeight=2000;f.row.parentElement=panel;delete f.title.attributes.title;f.title.textContent='Arrow OHLC Window v2 (100, 5, 15, 102)';f.title.rect.top=875;
  f.row.queries.set('span[title]',[]);f.row.queries.set(':scope > div[class*="header-"] > span[class*="headerTitle-"]',[f.title]);
  assert.equal(f.run().action,'SCROLL_OWN_STUDY');assert.equal(f.actions.length,1);assert.equal(f.actions[0].node,panel);assert.equal(f.body.scrollTop,0);
  f.title.rect.top=150;assert.equal(f.run().status,'READY');assert.equal(f.actions.length,1);
});

test('fallback cannot identify own study from plot body, another title or near-match name',()=>{
  for(const text of ['Arrow OHLC Window v20','Another study','']){
    const f=fixture();f.row.textContent='Arrow OHLC Window v2 (100) ARROW2_PROTOCOL 3';f.row.queries.set('span[title]',[]);f.title.textContent=text;delete f.title.attributes.title;
    f.row.queries.set(':scope > div[class*="header-"] > span[class*="headerTitle-"]',[f.title]);
    assert.equal(f.run().reasonCodes[0],'WINDOW_STUDY_NOT_FOUND');assert.equal(f.actions.length,0);
  }
  const f=fixture();f.row.queries.set('span[title]',[]);f.title.textContent='Arrow OHLC Window v2 (100)';f.title.attributes.title='Another study';f.row.queries.set(':scope > div[class*="header-"] > span[class*="headerTitle-"]',[f.title]);assert.equal(f.run().reasonCodes[0],'WINDOW_STUDY_NOT_FOUND');
});

test('three-chart research preparation is explicit, requires unique active NQ one-minute Replay and never changes layout',()=>{
  const make=()=>{const f=fixture();f.document.queries.set('canvas[aria-label^="Chart for "]',[f.node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,f.node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})]);f.document.queries.set('button[aria-label*="Active layout: Arrow "]',[f.node({'aria-label':'Active layout: Arrow Research'})]);f.document.queries.set('#header-toolbar-intervals [aria-checked="true"]',[f.node({'data-value':'1'})]);f.document.queries.set('#header-toolbar-replay',[f.node({'aria-pressed':'true'})]);return f;};
  const f=make();assert.equal(f.run().reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.equal(f.run({allowResearchMultiChart:true}).status,'READY');assert.deepEqual(f.actions,[]);assert.equal(f.document.queries.get('canvas[aria-label^="Chart for "]').length,3);
  for(const change of [g=>g.document.queries.set('button[aria-label*="Active layout: Arrow "]',[]),g=>g.document.queries.get('#header-toolbar-intervals [aria-checked="true"]')[0].attributes['data-value']='5',g=>g.document.queries.get('canvas[aria-label^="Chart for "]')[0].attributes['aria-label']='Chart for CME_MINI:NQ1!, 1 minute']){const g=make();change(g);assert.equal(g.run({allowResearchMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.deepEqual(g.actions,[]);}
});

test('opening the panel, selecting its exact tab and expanding own study each take one separate invocation',()=>{
  const f=fixture();f.document.queries.set('[role="tab"]',[]);
  assert.equal(f.run().action,'OPEN_DATA_WINDOW_PANEL');assert.equal(f.actions.length,1);assert.equal(f.actions[0].node,f.toolbar);
  f.document.queries.set('[role="tab"]',[f.tab]);f.tab.attributes['aria-selected']='false';
  assert.equal(f.run().action,'SELECT_DATA_WINDOW_TAB');assert.equal(f.actions.length,2);assert.equal(f.actions[1].node,f.tab);
  f.tab.attributes['aria-selected']='true';f.row.queries.set('[data-test-id-value-title^="ARROW2_"]',[]);
  assert.equal(f.run().action,'EXPAND_OWN_STUDY');assert.equal(f.actions.length,3);assert.equal(f.actions[2].node,f.show);
  f.row.queries.set('[data-test-id-value-title^="ARROW2_"]',[f.plot]);assert.equal(f.run().status,'READY');assert.equal(f.actions.length,3);
});

test('multiple charts, unrelated dialogs, wrong pages, unknown phase and unrelated study requests remain read only',()=>{
  for(const change of [
    f=>f.document.queries.set('canvas[aria-label^="Chart for "]',[f.canvas,f.node()]),
    f=>f.document.queries.set('[role="dialog"], [aria-modal="true"]',[f.node({role:'dialog'})]),
    f=>{f.sandbox.location.hostname='example.com';},
  ]){const f=fixture();change(f);assert.notEqual(f.run().status,'READY');assert.equal(f.actions.length,0);}
  const f=fixture();assert.equal(f.run({phase:'metadata'}).status,'INVALID');assert.equal(f.run({expectedStudyTitle:'Broker account'}).status,'INVALID');assert.equal(f.actions.length,0);
});

test('only the exact public tab and source row can be acted on; ambiguity is excluded',()=>{
  const f=fixture(),otherTab=f.node({role:'tab','aria-selected':'false'},{text:'Data window settings'});f.document.queries.set('[role="tab"]',[otherTab]);
  assert.equal(f.run().action,'OPEN_DATA_WINDOW_PANEL');assert.equal(f.actions[0].node,f.toolbar);
  const duplicate=fixture();duplicate.document.queries.set('[role="tab"]',[duplicate.tab,duplicate.node({role:'tab'},{text:'Data window'})]);assert.equal(duplicate.run().reasonCodes[0],'DATA_WINDOW_TAB_AMBIGUOUS');assert.equal(duplicate.actions.length,0);
  const own=fixture(),otherRow=own.node({role:'row'}),otherTitle=own.node({title:'Arrow OHLC Window v2 duplicate'},{parent:otherRow});otherRow.queries.set('span[title]',[otherTitle]);own.document.queries.set('[role="treegrid"] > div[role="row"]',[own.row,otherRow]);assert.equal(own.run().reasonCodes[0],'WINDOW_STUDY_AMBIGUOUS');assert.equal(own.actions.length,0);
});

test('scrolling is restricted to nearest overflow panel of own header and consumes its own invocation',()=>{
  const f=fixture(),outer=f.node({}, {style:{overflowY:'auto'},rect:{top:0,height:600}}),panel=f.node({}, {parent:outer,style:{overflowY:'auto'},rect:{top:100,height:100}});
  outer.scrollHeight=2000;panel.scrollHeight=800;f.row.parentElement=panel;f.title.rect.top=300;f.title.rect.height=20;
  const result=f.run();assert.equal(result.action,'SCROLL_OWN_STUDY');assert.equal(f.actions.length,1);assert.equal(f.actions[0].node,panel);assert.equal(f.actions[0].value,120);assert.equal(outer.scrollTop,0);assert.equal(f.body.scrollTop,0);
  f.title.rect.top=150;assert.equal(f.run().status,'READY');assert.equal(f.actions.length,1);
});

test('already-open/mounting panes and studies are never toggled closed; hidden or disabled controls are not clicked',()=>{
  const f=fixture();f.document.queries.set('[role="tab"]',[]);f.toolbar.attributes['aria-pressed']='true';assert.equal(f.run().status,'WAITING');assert.equal(f.actions.length,0);
  const expanded=fixture();expanded.row.queries.set('[data-test-id-value-title^="ARROW2_"]',[]);expanded.show.attributes['aria-expanded']='true';assert.equal(expanded.run().status,'WAITING');assert.equal(expanded.actions.length,0);
  const disabled=fixture();disabled.document.queries.set('[role="tab"]',[]);disabled.toolbar.disabled=true;assert.equal(disabled.run().reasonCodes[0],'DATA_WINDOW_PANEL_BUTTON_DISABLED');assert.equal(disabled.actions.length,0);
  const hidden=fixture();hidden.document.queries.set('[role="tab"]',[]);hidden.toolbar.style.display='none';assert.equal(hidden.run().reasonCodes[0],'DATA_WINDOW_PANEL_BUTTON_NOT_FOUND');assert.equal(hidden.actions.length,0);
});

test('only own Show data button can expand; missing source and unrelated controls are not touched',()=>{
  const f=fixture();f.row.queries.set('[data-test-id-value-title^="ARROW2_"]',[]);const broker=f.node({'aria-label':'Buy Market'},{parent:f.row});f.row.queries.set('button, [role="button"]',[broker]);assert.equal(f.run().status,'WAITING');assert.equal(f.actions.length,0);
  f.document.queries.set('[role="treegrid"] > div[role="row"]',[]);assert.equal(f.run().reasonCodes[0],'WINDOW_STUDY_NOT_FOUND');assert.equal(f.actions.length,0);
});

test('observed TradingView-style 23-ancestor control paths remain actionable inside the fixed64 bound',()=>{
  const f=fixture();let parent=f.body;
  for(let depth=0;depth<23;depth++)parent=f.node({}, {parent});
  for(const target of [f.canvas,f.tab,f.row])target.parentElement=parent;
  assert.equal(f.run().status,'READY');assert.equal(f.actions.length,0);
  f.tab.attributes['aria-selected']='false';assert.equal(f.run().action,'SELECT_DATA_WINDOW_TAB');assert.equal(f.actions.length,1);
});

function liveMultiChartFixture(){
  const f=fixture();f.sandbox.location.pathname='/chart/ARROWRV1/';f.sandbox.location.href='https://www.tradingview.com/chart/ARROWRV1/';
  f.document.queries.set('canvas[aria-label^="Chart for "]',[f.node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,f.node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})]);
  f.document.queries.set('button[aria-label*="Active layout: "]',[f.node({'aria-label':'Logged in as local-test Active layout: Arrow OHLC Live Verification'})]);
  f.document.queries.set('#header-toolbar-intervals [aria-checked="true"]',[f.node({'data-value':'1'})]);
  f.document.queries.set('#header-toolbar-replay',[f.node({'aria-pressed':'false'})]);
  return f;
}

test('LIVE research preparation has a separate opt-in and never changes the three-chart layout',()=>{
  const f=liveMultiChartFixture();assert.equal(f.run().reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.equal(f.run({allowResearchMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');
  assert.equal(f.run({allowResearchLiveMultiChart:true}).status,'READY');assert.equal(f.actions.length,0);assert.equal(f.document.queries.get('canvas[aria-label^="Chart for "]').length,3);
  assert.equal(f.run({allowResearchLiveMultiChart:'true'}).reasonCodes[0],'WINDOW_PREPARE_CONFIGURATION_INVALID');
});

test('LIVE preparation rejects personal/mixed/ambiguous/Replay research contexts without any action',()=>{
  for(const edit of [
    f=>{f.sandbox.location.pathname='/chart/Personal/';},
    f=>{f.document.queries.get('button[aria-label*="Active layout: "]')[0].attributes['aria-label']='Active layout: Arrow Personal';},
    f=>{f.document.queries.get('canvas[aria-label^="Chart for "]')[0].attributes['aria-label']='Chart for CME_MINI:MNQ1!, 5 minutes';},
    f=>{f.document.queries.get('canvas[aria-label^="Chart for "]')[2].attributes['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';},
    f=>{f.document.queries.get('#header-toolbar-intervals [aria-checked="true"]')[0].attributes['data-value']='5';},
    f=>{f.document.queries.get('#header-toolbar-replay')[0].attributes['aria-pressed']='true';},
    f=>{f.document.queries.get('button[aria-label*="Active layout: "]').push(f.node({'aria-label':'Active layout: Arrow OHLC Live Verification'}));}
  ]){const f=liveMultiChartFixture();edit(f);assert.equal(f.run({allowResearchLiveMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.equal(f.actions.length,0);}
});

test('FULL SCREENS preparation preserves the existing charts and requires its own exact URL/name pair',()=>{
  const make=()=>{const f=liveMultiChartFixture();f.sandbox.location.pathname='/chart/ARROWFR1/';f.sandbox.location.href='https://www.tradingview.com/chart/ARROWFR1/';f.document.queries.get('button[aria-label*="Active layout: "]')[0].attributes['aria-label']='Logged in as local-test Active layout: Full Screens Live';return f;};
  const f=make();assert.equal(f.run({allowResearchLiveMultiChart:true}).status,'READY');assert.deepEqual(f.actions,[]);assert.equal(f.document.queries.get('canvas[aria-label^="Chart for "]').length,3);assert.equal(f.run({allowResearchMultiChart:true}).status,'UNAVAILABLE','Replay opt-in stays separate');
  for(const edit of [x=>{x.sandbox.location.href+='?x=1';},x=>{x.sandbox.location.pathname='/chart/ARROWRV1/';x.sandbox.location.href='https://www.tradingview.com/chart/ARROWRV1/';},x=>{x.document.queries.get('button[aria-label*="Active layout: "]')[0].attributes['aria-label']='Active layout: Arrow OHLC Live Verification';},x=>{x.document.queries.get('#header-toolbar-replay')[0].attributes['aria-pressed']='true';},x=>{x.document.queries.get('canvas[aria-label^="Chart for "]')[2].attributes['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';}]){const bad=make();edit(bad);assert.equal(bad.run({allowResearchLiveMultiChart:true}).reasonCodes[0],'SINGLE_VISIBLE_CHART_REQUIRED');assert.deepEqual(bad.actions,[]);}
});
