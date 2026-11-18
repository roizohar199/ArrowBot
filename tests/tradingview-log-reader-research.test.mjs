import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readPineLogsEvidence} from '../tradingview-log-reader.mjs';

// Serialized public-DOM boundary tests, not a live feed or a market signal.
const sourceUrl='https://www.tradingview.com/chart/ARROWRV1/',at=Date.UTC(2026,10,16,9);
function fixture(){
  class Element{
    constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.parentElement=null;this.style={display:'block',visibility:'visible'};this.rect={width:100,height:40,left:0,right:100,top:0,bottom:40};this.map=new Map();}
    getAttribute(k){return this.attrs[k]??null;}getBoundingClientRect(){return this.rect;}querySelectorAll(s){return this.map.get(s)??[];}querySelector(s){return this.querySelectorAll(s)[0]??null;}closest(){return null;}
  }
  const canvases=['5 minutes','1 minute','1 second'].map(tf=>new Element({'aria-label':'Chart for CME_MINI:NQ1!, '+tf})),statusClosed=new Element({},'Closed'),statusLive=new Element({},'Real-time data'),layout=new Element({'aria-label':'Logged in as test Active layout: Arrow OHLC Live Verification'}),interval=new Element({'data-value':'1'}),replay=new Element({'aria-pressed':'false'});
  statusClosed.outerHTML='<span class="marketStatusClose-test"></span>';statusLive.outerHTML='<span class="marketStatusOpen-test dataStatusRealtime-test"></span>';
  const legends=[statusClosed,statusLive,statusClosed].map(status=>{const n=new Element();n.map.set('[data-qa-id="legend-statuses-wrapper"]',[status]);return n;}),pane=new Element();pane.map.set('canvas[aria-label^="Chart for "]',[canvases[1]]);pane.map.set('[data-qa-id="legend-series-item"]',[legends[1]]);canvases[1].parentElement=pane;
  const meta={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'regular',chartType:'standard'},runId=meta.instrument+'|1|'+(at-1000),bar=duration=>({time:at-duration,closeTime:at,open:28000,high:28002,low:27999,close:28001,volume:100,closed:true,sourceClosed:true,providerBarIndex:1,sessionFirst:false,sessionLast:false});
  const base={schemaVersion:1,kind:'snapshot',runId,sequence:1,sourceEmittedAt:at,realtime:false,bootstrapOnly:true,dataDelayUnverified:true,metadata:meta,bars:[bar(60000)],reasonCodes:[]},packets=[base,...['5','15'].map((tf,i)=>({...base,sequence:i+2,kind:'timeframe_snapshot',bars:[],higherTimeframes:[{timeframe:tf,timeframeMs:Number(tf)*60000,bars:[bar(Number(tf)*60000)],sessionGaps:[],reasonCodes:[]}]}))];
  const nodes=packets.map(p=>({nodeValue:'ARROW_OHLC_V1 '+JSON.stringify(p),parentElement:new Element()})),doc={visibilityState:'visible',hidden:false,body:new Element(),querySelectorAll(s){return s==='canvas[aria-label^="Chart for "]'?canvases:s==='[data-qa-id="legend-series-item"]'?legends:(s==='button[aria-label*="Active layout: Arrow "]'||s==='button[aria-label*="Active layout: "]')?[layout]:s==='#header-toolbar-intervals [aria-checked="true"]'?[interval]:s==='#header-toolbar-replay'?[replay]:[];},querySelector(s){return this.querySelectorAll(s)[0]??null;},createTreeWalker(){let i=0;return {nextNode:()=>nodes[i++]??null};}};
  const location={protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/ARROWRV1/',href:sourceUrl},scope={document:doc,location,window:{innerWidth:1200,innerHeight:800},URL,Date:{now:()=>at+1000},performance:{now:()=>1},NodeFilter:{SHOW_TEXT:4},getComputedStyle:n=>n.style};
  for(const name of ['TradingView','tvWidget','WebSocket','fetch','XMLHttpRequest'])Object.defineProperty(scope,name,{get(){throw Error('Private/network access forbidden: '+name);}});
  return {doc,location,canvases,legends,pane,layout,interval,replay,statusLive,run(args={}){scope.args={bootstrapOnly:true,allowResearchLiveMultiChart:true,...args};return JSON.parse(JSON.stringify(vm.runInNewContext('('+readPineLogsEvidence.toString()+')(args)',scope)));}};
}

test('native bootstrap logs preserve the three visible NQ charts and scope status to the active one-minute pane',()=>{
  const f=fixture(),result=f.run();assert.equal(result.status,'OK',JSON.stringify(result));assert.equal(result.messages.length,3);assert.equal(result.chart.visibleCharts,3);assert.equal(result.chart.marketOpen,true);assert.equal(result.chart.realtime,true);assert.equal(result.chart.researchSelection.statusLegendScoped,true);assert.equal(result.sourceUrl,sourceUrl);assert.equal(result.contextOnly,true);assert.equal(result.liveEligible,false);assert.ok(result.messages.every(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)).bootstrapOnly===true));
  const def=fixture().run({allowResearchLiveMultiChart:false});assert.equal(def.status,'UNAVAILABLE');assert.equal(def.messages.length,0);
});
test('three-chart log exception rejects personal URL/layout, duplicate target, other instruments, replay and wrong active timeframe',()=>{
  for(const mutate of [f=>{f.location.href='https://www.tradingview.com/chart/Personal/';},f=>{f.location.href+='?extra=1';},f=>{f.layout.attrs['aria-label']='Logged in as test Active layout: My Personal';},f=>{f.canvases[2].attrs['aria-label']=f.canvases[1].attrs['aria-label'];},f=>{f.canvases[2].attrs['aria-label']='Chart for BINANCE:BTCUSDT, 1 second';},f=>{f.interval.attrs['data-value']='5';},f=>{f.replay.attrs['aria-pressed']='true';},f=>{f.doc.hidden=true;}]){const f=fixture();mutate(f);const result=f.run();assert.equal(result.status,'UNAVAILABLE',mutate.toString());assert.equal(result.messages.length,0);}
  assert.deepEqual(fixture().run({allowResearchLiveMultiChart:'true'}).reasonCodes,['PINE_LOG_READER_CONFIGURATION_INVALID']);
});
test('global other-pane legends or clipped/mixed ancestors cannot impersonate the active one-minute market status',()=>{
  for(const mutate of [f=>{f.canvases[1].parentElement=null;},f=>{f.pane.map.set('canvas[aria-label^="Chart for "]',f.canvases);},f=>{f.pane.map.set('[data-qa-id="legend-series-item"]',f.legends);},f=>{f.pane.style.overflowY='hidden';f.pane.clientHeight=0;}]){const f=fixture();mutate(f);const result=f.run();assert.equal(result.status,'UNAVAILABLE',mutate.toString());assert.equal(result.messages.length,0);}
  const f=fixture();f.statusLive.outerHTML='<span class="marketStatusClose-test"></span>';f.statusLive.textContent='Closed';const result=f.run();assert.equal(result.status,'OK');assert.equal(result.chart.marketOpen,false);assert.equal(result.contextOnly,true);assert.equal(result.liveEligible,false);
});

test('FULL SCREENS bootstrap logs require its exact URL/name and retain context-only status with scoped minute evidence',()=>{
  const make=()=>{const f=fixture();f.location.pathname='/chart/ARROWFR1/';f.location.href='https://www.tradingview.com/chart/ARROWFR1/';f.layout.attrs['aria-label']='Logged in as test Active layout: Full Screens Live';return f;};
  const f=make(),result=f.run();assert.equal(result.status,'OK');assert.equal(result.contextOnly,true);assert.equal(result.liveEligible,false);assert.equal(result.messages.length,3);assert.equal(result.chart.researchSelection.layoutName,'Full Screens Live');assert.equal(result.chart.researchSelection.statusLegendScoped,true);assert.equal(result.chart.marketOpen,true);assert.equal(result.chart.realtime,true);
  for(const edit of [x=>{x.location.href=sourceUrl;x.location.pathname='/chart/ARROWRV1/';},x=>{x.layout.attrs['aria-label']='Active layout: Arrow OHLC Live Verification';},x=>{x.location.href+='#x';},x=>{x.location.href+='?x=1';},x=>{x.replay.attrs['aria-pressed']='true';},x=>{x.canvases[2].attrs['aria-label']=x.canvases[1].attrs['aria-label'];}]){const bad=make();edit(bad);assert.equal(bad.run().status,'UNAVAILABLE',edit.toString());}
});
