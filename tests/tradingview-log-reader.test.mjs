import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readPineLogsEvidence} from '../tradingview-log-reader.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';

const epoch=Date.UTC(2026,10,14,10);
const prefix='ARROW_OHLC_V1 ';
function packet(sequence,{kind='update',runId='current-run',sourceEmittedAt=epoch+sequence*100,instrument='BINANCE:BTCUSDT',session='regular'}={}){
  return {schemaVersion:1,kind,runId,sequence,sourceEmittedAt,realtime:true,dataDelayUnverified:true,metadata:{source:'ohlc',instrument,timeframe:'1S',timeframeMs:1000,tickSize:.01,pointValue:1,timezone:'Etc/UTC',session,chartType:'standard'},
    bars:[{time:epoch-1000,closeTime:epoch,open:100,high:102,low:99,close:101,closed:kind==='snapshot',sourceClosed:kind==='snapshot'}],reasonCodes:[]};
}
function element({tag='div',attributes={},classes=[],text='',style={},width=100,height=20,parent=null,outerHTML=''}={}){
  return {tag,attributes,classes,textContent:text,style:{display:'block',visibility:'visible',...style},parentElement:parent,outerHTML,
    getBoundingClientRect:()=>({width,height}),getAttribute:name=>attributes[name]??null,
    closest(selector){
      for(let node=this;node;node=node.parentElement)if(['script','style','textarea','input'].includes(node.tag)||node.attributes.contenteditable==='true'||node.attributes.role==='textbox'||node.classes.includes('monaco-editor'))return node;
      return null;
    },
    getContext(){throw Error('Reader must not sample chart pixels or run OCR');},
  };
}
function logNode(value,options={}){
  const text=typeof value==='string'?value:'[10:00:00] '+prefix+JSON.stringify(value);
  const parent=element({...options,text});return {nodeValue:text,parentElement:parent};
}
function read({nodes=[],symbols=['BINANCE:BTCUSDT'],hiddenSymbols=[],interval='1S',replay='false',statusMarkup='<span class="marketStatusOpen-test"></span>',statusText='',seriesCount=1,body=element({tag:'body'}),documentElement=element({tag:'html'}),followLatest,bootstrapOnly,linkedMarker=null,sourceDomTiming,location={protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/live/'}}={}){
  const canvases=[...symbols.map(symbol=>element({tag:'canvas',attributes:{'aria-label':`Chart for ${symbol}, 1 second`}})),...hiddenSymbols.map(symbol=>element({tag:'canvas',attributes:{'aria-label':`Chart for ${symbol}, 1 second`},style:{display:'none'}}))];
  const statuses=statusMarkup===null?null:element({outerHTML:`<div data-qa-id="legend-statuses-wrapper">${statusMarkup}</div>`,text:statusText});
  const series=Array.from({length:seriesCount},()=>({...element({attributes:{'data-qa-id':'legend-series-item'}}),querySelector(selector){assert.equal(selector,'[data-qa-id="legend-statuses-wrapper"]');return statuses;}}));
  let cursor=0,clock=20;
  const context={Date:{now:()=>epoch+100000},performance:{now:()=>clock++},location,NodeFilter:{SHOW_TEXT:4},getComputedStyle:node=>node.style,
    document:{body,documentElement,visibilityState:'visible',
      querySelectorAll(selector){
        if(selector==='canvas[aria-label^="Chart for "]')return canvases;
        if(selector==='[data-qa-id="legend-series-item"]')return series;
        if(selector==='[title="Linked with chart, all is fine."]')return linkedMarker?[linkedMarker]:[];
        throw Error('Unexpected source DOM surface: '+selector);
      },
      querySelector(selector){
        if(selector==='#header-toolbar-intervals [aria-checked="true"]')return interval===null?null:element({attributes:{'data-value':interval}});
        if(selector==='#header-toolbar-replay')return replay===null?element():element({attributes:{'aria-pressed':replay}});
        throw Error('Unexpected source DOM surface: '+selector);
      },
      createTreeWalker(root,filter){assert.equal(root.tag,'body');assert.equal(filter,4);return {nextNode:()=>nodes[cursor++]??null};},
    },
  };
  context.window={document:context.document,location,innerWidth:1200,innerHeight:800};
  if(sourceDomTiming)context.__arrowSourceDomTimingV1=sourceDomTiming;
  for(const name of ['TradingView','tvWidget','WebSocket','fetch','XMLHttpRequest','OffscreenCanvas']){
    const getter={get(){throw Error('DOM reader accessed forbidden hidden/browser/network surface '+name);}};
    Object.defineProperty(context,name,getter);Object.defineProperty(context.window,name,getter);
  }
  // chrome.scripting serializes the function itself. The VM deliberately has no
  // module imports or parent closures; every dependency must be page-standard.
  return vm.runInNewContext('('+readPineLogsEvidence.toString()+')('+JSON.stringify({...(followLatest===undefined?{}:{followLatest}),...(bootstrapOnly===undefined?{}:{bootstrapOnly})})+')',context);
}
const decoded=result=>Array.from(result.messages,raw=>JSON.parse(raw.slice(prefix.length)));

test('serialized DOM reader preserves exact OHLC JSON, including escaped text and nested braces, without chart globals or OCR',()=>{
  const source=packet(1,{session:'regular {session} with "quoted" name'}),result=read({nodes:[logNode(source)]});
  assert.equal(result.status,'OK');assert.equal(result.messages.length,1);assert.deepEqual(JSON.parse(JSON.stringify(decoded(result)[0])),source);
  const parsed=parsePineOhlcMessage(result.messages[0],{receivedAt:epoch+100000,tabId:7});assert.equal(parsed.ok,true);assert.deepEqual(parsed.packet.bars,source.bars);
  assert.equal(result.chart.symbols[0],'BINANCE:BTCUSDT');assert.equal(result.chart.interval,'1S');assert.equal(result.chart.replay,false);assert.ok(result.readMs>=0);
});

test('newest-first rendered logs retain the newest updates and newest warmup rather than oldest DOM positions',()=>{
  const rows=[packet(1,{kind:'snapshot'}),packet(3,{kind:'snapshot'}),...Array.from({length:100},(_,i)=>packet(i+10))];
  const forward=read({nodes:rows.map(row=>logNode(row))}),reverse=read({nodes:rows.slice().reverse().map(row=>logNode(row))});
  const a=decoded(forward),b=decoded(reverse);assert.equal(reverse.status,'OK');assert.deepEqual(b,a);
  const snapshots=b.filter(row=>row.kind==='snapshot'),updates=b.filter(row=>row.kind==='update');
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].sequence,3);assert.equal(Math.max(...updates.map(row=>row.sequence)),109);
  assert.ok(updates.length>0&&updates.length<=64);assert.ok(updates.every((row,i)=>i===0||row.sequence>updates[i-1].sequence));
  assert.ok(updates[0].sequence>10,'older updates yield space to the current source tail');
});

test('run selection uses fresh source time, never a high sequence from an older run, and does not mix warmups',()=>{
  const rows=[packet(1,{kind:'snapshot',runId:'new-run',sourceEmittedAt:epoch+80000}),packet(2,{runId:'new-run',sourceEmittedAt:epoch+90000}),packet(9000,{kind:'snapshot',runId:'old-run',sourceEmittedAt:epoch+1000}),packet(9999,{runId:'old-run',sourceEmittedAt:epoch+2000})];
  const result=read({nodes:rows.map(row=>logNode(row))}),values=decoded(result);
  assert.equal(result.status,'OK');assert.equal(values.length,2);assert.ok(values.every(row=>row.runId==='new-run'));assert.deepEqual(values.map(row=>row.kind),['snapshot','update']);
});

test('every visible provider HTF retains its own latest warmup beyond the bounded realtime tail',()=>{
  const higher=(sequence,tf)=>({...packet(sequence,{kind:'timeframe_snapshot'}),bars:[],higherTimeframes:[{timeframe:tf,timeframeMs:Number(tf)*60000,bars:[],reasonCodes:['WARMUP']}]});
  const source=[packet(1,{kind:'snapshot'}),higher(2,'5'),higher(3,'15'),higher(4,'5'),...Array.from({length:100},(_,index)=>packet(10+index))];
  const result=read({nodes:source.slice().reverse().map(row=>logNode(row))}),values=decoded(result);
  assert.equal(values.length,67);assert.deepEqual(values.slice(0,3).map(row=>row.sequence),[1,3,4]);
  assert.equal(values.filter(row=>row.kind==='update').length,64);assert.equal(values.at(-1).sequence,109);
  assert.deepEqual(values.filter(row=>row.kind==='timeframe_snapshot').map(row=>row.higherTimeframes[0].timeframe).sort(),['15','5']);
  const malicious=read({nodes:[packet(1,{kind:'snapshot'}),...Array.from({length:10},(_,index)=>higher(index+2,String(index+1))),...Array.from({length:100},(_,index)=>packet(index+20))].map(row=>logNode(row))});
  assert.ok(decoded(malicious).length<=68,'at most3provider warmups plusbase plus64tail messages');
});

test('reader returns extension-owned DOM appearance records without accessing TradingView internals',()=>{
  const timing={sessionId:'our-session',sourceEpoch:1234,records:[{id:'current-run:1',appearanceEpochMs:1220,initial:false}]};let reads=0;
  const result=read({nodes:[logNode(packet(1))],sourceDomTiming:{read(){reads++;return timing;}}});
  assert.equal(reads,1);assert.deepEqual(result.sourceDomTiming,timing);
  const unavailable=read({nodes:[logNode(packet(1))],sourceDomTiming:{read(){throw Error('observer disconnected');}}});assert.equal(unavailable.sourceDomTiming,null);assert.equal(unavailable.status,'OK');
});

test('editor code, hidden log rows, duplicated text and truncated JSON cannot become additional live packets',()=>{
  const valid=packet(8),nodes=[
    logNode(packet(100),{classes:['monaco-editor']}),logNode(packet(101),{tag:'textarea'}),logNode(packet(102),{attributes:{contenteditable:'true'}}),logNode(packet(103),{attributes:{role:'textbox'}}),
    logNode(packet(104),{style:{visibility:'hidden'}}),logNode(prefix+'{"kind":"update","runId":"truncated","sequence":999'),logNode(valid),logNode(valid),
  ];
  const result=read({nodes});assert.equal(result.status,'OK');assert.equal(result.messages.length,1);assert.equal(decoded(result)[0].sequence,8);
  const unavailable=read({nodes:[logNode(packet(100),{classes:['monaco-editor']})]});assert.equal(unavailable.status,'UNAVAILABLE');assert.ok(unavailable.reasonCodes.includes('PINE_LOGS_NOT_VISIBLE'));
});

test('multiple visible charts block the reader while a hidden alternate canvas cannot impersonate an active chart',()=>{
  const nodes=[logNode(packet(1))],multiple=read({nodes,symbols:['BINANCE:BTCUSDT','BINANCE:ETHUSDT']});
  assert.equal(multiple.status,'UNAVAILABLE');assert.equal(multiple.chart.visibleCharts,2);assert.ok(multiple.reasonCodes.includes('SINGLE_VISIBLE_CHART_REQUIRED'));
  const single=read({nodes,hiddenSymbols:['BINANCE:ETHUSDT']});assert.equal(single.status,'OK');assert.equal(single.chart.visibleCharts,1);assert.deepEqual(Array.from(single.chart.symbols),['BINANCE:BTCUSDT']);
});

test('an explicit delayed badge wins over the narrow Binance profile and absent futures entitlement remains unknown',()=>{
  const nodes=[logNode(packet(1))],delayed=read({nodes,statusMarkup:'<span class="marketStatusOpen-test dataModeDelayed-test">D</span>'});
  assert.equal(delayed.chart.realtime,false);assert.equal(delayed.chart.realtimeBasis,'EXPLICIT_DELAYED_DOM');
  const known=read({nodes});assert.equal(known.chart.marketOpen,true);assert.equal(known.chart.realtime,true);assert.equal(known.chart.realtimeBasis,'BINANCE_REALTIME_ONLY_COVERAGE_2026_11_14');assert.equal(known.chart.realtimeReference,'https://www.tradingview.com/data-coverage/');
  const future=read({nodes:[logNode(packet(1,{instrument:'CME_MINI:NQ1!'}))],symbols:['CME_MINI:NQ1!']});assert.equal(future.chart.realtime,null);assert.ok(future.reasonCodes.includes('LIVE_STATUS_UNVERIFIED'));
  const realtime=read({nodes,symbols:['CME_MINI:NQ1!'],statusMarkup:'<span class="marketStatusOpen-test dataStatusRealtime-test">Real-time data</span>'});assert.equal(realtime.chart.realtime,true);assert.equal(realtime.chart.realtimeBasis,'EXPLICIT_REALTIME_DOM');
  assert.equal(read({nodes,statusMarkup:null}).chart.realtime,null);assert.equal(read({nodes,statusMarkup:'<span class="marketStatusClosed-test"></span>'}).chart.realtime,null);
});

test('actual futures marketStatusClose class and legacy Closed spelling preserve an explicit closed-market reason',()=>{
  for(const className of ['marketStatusClose-KqlJzsVD','marketStatusClosed-test']){
    const result=read({nodes:[logNode(packet(1,{instrument:'CME_MINI:NQ1!'}))],symbols:['CME_MINI:NQ1!'],interval:'1',
      statusMarkup:`<span class="${className}" title="Market closed"><svg aria-label="Market closed"></svg></span>`,statusText:'Market closed'});
    assert.equal(result.status,'OK','closed-market history may still be read without claiming a live feed');
    assert.equal(result.chart.marketOpen,false);assert.equal(result.chart.realtime,null);
    assert.ok(result.reasonCodes.includes('MARKET_CLOSED'),'the idle UI needs the concrete closed-market reason');
    assert.ok(result.reasonCodes.includes('LIVE_STATUS_UNVERIFIED'));
  }
  const idle=read({symbols:['CME_MINI:NQ1!'],statusMarkup:'<span class="marketStatusClose-KqlJzsVD" title="Market closed"></span>'});
  assert.equal(idle.status,'UNAVAILABLE');assert.equal(idle.chart.marketOpen,false);assert.ok(idle.reasonCodes.includes('MARKET_CLOSED'));
});

test('unknown Replay, a scan limit, or a nonchart page stays explicitly unavailable or unverified',()=>{
  const nodes=[logNode(packet(1))],unknown=read({nodes,replay:null});assert.equal(unknown.chart.replay,null);assert.ok(unknown.reasonCodes.includes('REPLAY_STATUS_UNVERIFIED'));
  const limited=read({nodes:[...Array.from({length:20001},()=>({nodeValue:'ordinary page text',parentElement:null})),...nodes]});assert.equal(limited.status,'UNAVAILABLE');assert.ok(limited.reasonCodes.includes('DOM_SCAN_LIMIT'));assert.equal(limited.messages.length,0);
  const elsewhere=read({location:{protocol:'https:',hostname:'example.com',pathname:'/chart/whatever/'},nodes});assert.equal(elsewhere.status,'UNAVAILABLE');assert.ok(elsewhere.reasonCodes.includes('TRADINGVIEW_CHART_REQUIRED'));
});

function scrollPane({parent=null,height=2000,client=699,top=40}={}){
  const pane=element({parent,style:{overflowY:'auto'}}),writes=[];let value=top;
  Object.assign(pane,{scrollHeight:height,clientHeight:client});
  Object.defineProperty(pane,'scrollTop',{get:()=>value,set:next=>{writes.push(next);value=Math.min(Math.max(0,next),height-client);}});
  return {pane,writes,top:()=>value};
}

test('default and explicit disabled follow preserve a user-scrolled Pine Logs viewport',()=>{
  const body=element({tag:'body'}),logs=scrollPane({parent:body,height:144177,client:699,top:27073}),node=logNode(packet(7),{parent:logs.pane});
  for(const options of [{},{followLatest:false}]){
    const result=read({nodes:[node],body,...options});assert.equal(result.status,'OK');assert.equal(result.followedLogContainers,0);
    assert.equal(logs.top(),27073);assert.equal(logs.writes.length,0,'read-only polling must not move the source viewport');
  }
});

test('explicit follow scrolls only the nearest marked-log container and leaves chart, editor, outer panes and page alone',()=>{
  const page=scrollPane({height:200000,client:800,top:50});page.pane.tag='body';
  const outer=scrollPane({parent:page.pane,height:10000,client:800,top:80}),logs=scrollPane({parent:outer.pane,height:144177,client:699,top:27073});
  const chart=scrollPane({parent:page.pane,height:10000,client:800,top:120}),editor=scrollPane({parent:page.pane,height:9000,client:600,top:150}),unrelated=scrollPane({parent:page.pane,height:8000,client:700,top:200});
  const first=logNode(packet(7),{parent:logs.pane}),second=logNode(packet(8),{parent:logs.pane}),editorCode=logNode(packet(999),{parent:editor.pane,classes:['monaco-editor']}),otherText=logNode('ordinary broker or chart pane text',{parent:unrelated.pane});
  const result=read({nodes:[first,second,editorCode,otherText],body:page.pane,followLatest:true});
  assert.equal(result.status,'OK');assert.equal(result.followedLogContainers,1);assert.equal(logs.top(),144177-699);assert.equal(logs.writes.length,1,'coalesced rows follow the log pane once');
  for(const other of [page,outer,chart,editor,unrelated])assert.equal(other.writes.length,0,'follow must not scroll a different work surface');
  assert.deepEqual(decoded(result).map(row=>row.sequence),[7,8]);
  const atBottom=read({nodes:[first,second],body:page.pane,followLatest:true});assert.equal(atBottom.followedLogContainers,0);assert.equal(logs.writes.length,1,'an already-following pane needs no additional scroll write');
  const bodyMarker=logNode(packet(9),{parent:page.pane});read({nodes:[bodyMarker],body:page.pane,followLatest:true});assert.equal(page.writes.length,0,'the page body is never a follow target');
});

function bootstrapPackets(){
  const sourceAt=epoch+1000,runId='BINANCE:BTCUSDT|1S|'+epoch;
  const closed=(duration,index=1)=>({time:epoch-duration,closeTime:epoch,open:100,high:102,low:99,close:101,volume:100,closed:true,sourceClosed:true,providerBarIndex:index,sessionFirst:false,sessionLast:false});
  const base={...packet(1,{kind:'snapshot',runId,sourceEmittedAt:sourceAt}),bootstrapOnly:true,realtime:false,bars:[closed(1000)]};
  return [base,...['5','15'].map((tf,index)=>({...base,kind:'timeframe_snapshot',sequence:index+2,bars:[],higherTimeframes:[{timeframe:tf,timeframeMs:Number(tf)*60000,bars:[closed(Number(tf)*60000)],sessionGaps:[],reasonCodes:[]}]}))];
}
const detachedLocation={protocol:'https:',hostname:'www.tradingview.com',pathname:'/pine/'};
const detachedOptions=()=>({location:detachedLocation,symbols:[],seriesCount:0,interval:null,replay:null,statusMarkup:null,bootstrapOnly:true,linkedMarker:element({attributes:{title:'Linked with chart, all is fine.'},text:'Linked'})});

test('explicit bootstrap-only mode reads at most three closed historical messages from the publicly linked detached editor',()=>{
  const packets=bootstrapPackets(),result=read({...detachedOptions(),nodes:packets.slice().reverse().map(row=>logNode(row))});
  assert.equal(result.status,'OK');assert.equal(result.chart,null);assert.equal(result.editorLinked,true);assert.equal(result.bootstrapLogsOnly,true);assert.equal(result.contextOnly,true);assert.equal(result.liveEligible,false);
  assert.deepEqual(decoded(result).map(row=>row.sequence),[1,2,3]);assert.ok(decoded(result).every(row=>row.realtime===false&&row.bootstrapOnly===true));
  assert.deepEqual(Array.from(result.reasonCodes),['HISTORICAL_BOOTSTRAP_NO_ALERT']);
  const partial=read({...detachedOptions(),nodes:packets.slice(1).map(row=>logNode(row))});assert.equal(partial.status,'OK');assert.equal(partial.messages.length,2,'the receiving parser may accumulate virtualized parts, never invent a missing one');
  const chart=read({bootstrapOnly:true,nodes:packets.map(row=>logNode(row))});assert.equal(chart.status,'OK');assert.equal(chart.chart.visibleCharts,1);assert.equal(chart.editorLinked,false);
});

test('detached editor support is opt-in, exact-path and visible-public-link guarded; normal Logs readers retain their chart boundary',()=>{
  const nodes=bootstrapPackets().map(row=>logNode(row));
  for(const change of [{bootstrapOnly:undefined},{bootstrapOnly:false},{linkedMarker:null},{linkedMarker:element({text:'Unlinked'})},{linkedMarker:element({text:'Linked',style:{display:'none'}})},{location:{...detachedLocation,pathname:'/pine/other/'}},{location:{...detachedLocation,pathname:'/pine'}},{location:{...detachedLocation,hostname:'example.com'}},{location:{...detachedLocation,protocol:'http:'}}]){
    const result=read({...detachedOptions(),nodes,...change});assert.equal(result.status,'UNAVAILABLE',JSON.stringify(change));assert.equal(result.messages.length,0);
  }
  const config=read({...detachedOptions(),nodes,bootstrapOnly:'true'});assert.deepEqual(Array.from(config.reasonCodes),['PINE_LOG_READER_CONFIGURATION_INVALID']);
  const multiple=read({bootstrapOnly:true,nodes,symbols:['BINANCE:BTCUSDT','BINANCE:ETHUSDT']});assert.equal(multiple.status,'UNAVAILABLE');assert.equal(multiple.messages.length,0);
});

test('bootstrap-only mode rejects ordinary or malformed messages instead of converting them into a realtime-capable log stream',()=>{
  const cases=[
    packets=>{packets[0].bootstrapOnly=false;},packets=>{packets[0].realtime=true;},packets=>{packets[0].schemaVersion=2;},
    packets=>{packets[0].bars[0].sourceClosed=false;},packets=>{packets[0].bars[0].closed=false;},packets=>{packets[0].bars[0].providerBarIndex=-1;},
    packets=>{packets[0].bars[0].sessionFirst=null;},packets=>{packets[0].bars[0].high=98;},packets=>{packets[0].bars[0].volume=-1;},
    packets=>{packets[0].bars[0].closeTime=epoch+200000;},packets=>{packets[0].bars=Array.from({length:101},()=>packets[0].bars[0]);},
    packets=>{packets[1].kind='update';},packets=>{packets[1].sequence=4;},packets=>{packets[1].higherTimeframes[0].bars[0].closed=false;},
    packets=>{packets[1].higherTimeframes.push(packets[1].higherTimeframes[0]);},packets=>{packets[1].sourceEmittedAt++;},
    packets=>{for(const p of packets)p.sourceEmittedAt=epoch+200000;},
    packets=>{packets.push({...packets[0],reasonCodes:['DIFFERENT_DUPLICATE']});},
    packets=>{packets.push({...packet(4,{runId:packets[0].runId,sourceEmittedAt:packets[0].sourceEmittedAt}),bootstrapOnly:false});},
  ];
  for(const mutate of cases){const packets=bootstrapPackets();mutate(packets);const result=read({...detachedOptions(),nodes:packets.map(row=>logNode(row))});assert.equal(result.status,'UNAVAILABLE',mutate.toString());assert.equal(result.messages.length,0);assert.equal(result.liveEligible,false);assert.deepEqual(Array.from(result.reasonCodes),['BOOTSTRAP_LOG_PACKET_INVALID']);}
  const truncated=read({...detachedOptions(),nodes:[logNode(prefix+'{"bootstrapOnly":true,"sequence":1')]});assert.equal(truncated.status,'UNAVAILABLE');assert.equal(truncated.messages.length,0);
  const editorCode=read({...detachedOptions(),nodes:bootstrapPackets().map(row=>logNode(row,{classes:['monaco-editor']}))});assert.equal(editorCode.status,'UNAVAILABLE');assert.equal(editorCode.messages.length,0);
});
