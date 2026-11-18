import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreopenContext} from '../live-preopen-context.mjs';

const at=Date.UTC(2026,10,14,12),end=Date.UTC(2026,10,13,22),runEpoch=at-1000;
const metadata={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
const chart={symbols:[metadata.instrument],interval:'1',visibleCharts:1,documentVisible:true,replay:false,marketOpen:false,realtime:false};
function burst(){
  const bars=duration=>Array.from({length:20},(_,i)=>({time:end-(20-i)*duration,closeTime:end-(19-i)*duration,open:28000,high:28002,low:27999,close:28001,closed:true,sourceClosed:true,providerBarIndex:i+1,sessionFirst:false,sessionLast:i===19}));
  const header={schemaVersion:1,runId:metadata.instrument+'|1|'+runEpoch,sourceEmittedAt:at,realtime:false,dataDelayUnverified:true,bootstrapOnly:true,reasonCodes:[]};
  return [{...header,kind:'snapshot',sequence:1,metadata:{...metadata,sessionGaps:[]},bars:bars(60000)},...['5','15'].map((timeframe,i)=>({...header,kind:'timeframe_snapshot',sequence:i+2,metadata,bars:[],higherTimeframes:[{timeframe,timeframeMs:Number(timeframe)*60000,bars:bars(Number(timeframe)*60000),sessionGaps:[],reasonCodes:[]}]}))].map(p=>'ARROW_OHLC_V1 '+JSON.stringify(p));
}
const prepare=()=>{const context=createPreopenContext();assert.equal(context.capture(burst(),{sourceTabId:17,chart,receivedAt:at}).ok,true);return context;};

test('closed-market context becomes ready without any live eligibility or unguarded repeated seed',()=>{
  const c=prepare(),s=c.snapshot();assert.equal(s.status,'CONTEXT_READY');assert.equal(s.liveEligible,false);assert.equal(s.ordersAuthorized,false);assert.deepEqual(s.series.map(x=>x.bars),[20,20,20]);
  c.begin({sourceTabId:17,instrument:metadata.instrument,connectionSessionId:'new-connection'});const first=c.readerArgs();assert.equal(first.bootstrap.runEpoch,runEpoch);assert.equal(first.bootstrapHistory.baseBars.length,20);assert.deepEqual(c.readerArgs(),{});
  first.bootstrapHistory.baseBars[0].high=0;assert.equal(c.snapshot({includeHistory:true}).bootstrapHistory.baseBars[0].high,28002);
});
test('source/tab/account change, replay and incomplete new burst cannot borrow old prepared context',()=>{
  for(const change of [{sourceTabId:18,instrument:metadata.instrument},{sourceTabId:17,instrument:'CME_MINI:MNQ1!'}]){const c=prepare();c.begin(change);assert.equal(c.snapshot().status,'NOT_PREPARED');assert.deepEqual(c.readerArgs(),{});}
  const c=prepare();assert.equal(c.capture(burst().slice(0,2),{sourceTabId:17,chart,receivedAt:at}).ok,false);assert.equal(c.snapshot().status,'NOT_PREPARED');
  assert.equal(c.capture(burst(),{sourceTabId:17,chart:{...chart,replay:true},receivedAt:at}).ok,false);
});
test('fresh source identity is required and a closed-bar correction permanently invalidates the seed',()=>{
  for(const evidence of [{chart,frame:{runEpoch:runEpoch+1}},{chart:{...chart,interval:'5'}},{chart,reasonCodes:['WINDOW_CLOSED_BAR_CORRECTION']}]){const c=prepare();c.readerArgs();c.observe(evidence);assert.deepEqual(c.readerArgs(),{});assert.equal(c.snapshot().status,'NOT_PREPARED');}
  const c=prepare();c.observe({chart,frame:{runEpoch,realtime:false},contextOnly:true});assert.equal(c.snapshot().status,'CONTEXT_READY');assert.equal(c.snapshot().liveEligible,false);
});

test('validated partial history is seeded once without promoting context or live readiness',()=>{
  const messages=burst().map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)));
  messages[2].higherTimeframes[0].bars=messages[2].higherTimeframes[0].bars.slice(2);
  const raw=messages.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet)),c=createPreopenContext();
  const captured=c.capture(raw,{sourceTabId:17,chart,receivedAt:at});
  assert.equal(captured.ok,true);assert.equal(captured.status,'CONTEXT_INCOMPLETE');assert.deepEqual(captured.series.map(series=>series.bars),[20,20,18]);
  assert.equal(captured.liveEligible,false);assert.equal(captured.contextOnly,true);assert.equal(captured.ordersAuthorized,false);
  c.begin({sourceTabId:17,instrument:metadata.instrument,connectionSessionId:'partial-connection'});
  const seed=c.readerArgs();assert.equal(seed.bootstrapHistory.higherTimeframes[1].bars.length,18);assert.deepEqual(c.readerArgs(),{});
  seed.bootstrapHistory.higherTimeframes[1].bars[0].high=0;assert.equal(c.snapshot({includeHistory:true}).bootstrapHistory.higherTimeframes[1].bars[0].high,28002);
  assert.equal(c.snapshot().status,'CONTEXT_INCOMPLETE');assert.equal(c.snapshot().liveEligible,false);
  c.begin({sourceTabId:17,instrument:metadata.instrument,connectionSessionId:'reviewed-reconnect'});assert.equal(c.readerArgs().bootstrapHistory.baseBars.length,20);assert.deepEqual(c.readerArgs(),{});
  c.observe({chart,frame:{runEpoch:runEpoch+1}});assert.equal(c.snapshot().status,'NOT_PREPARED');assert.deepEqual(c.readerArgs(),{});
  c.capture(raw,{sourceTabId:17,chart,receivedAt:at});assert.equal(c.capture(raw.slice(0,2),{sourceTabId:17,chart,receivedAt:at}).ok,false);assert.deepEqual(c.readerArgs(),{});
});

const sourceUrl='https://www.tradingview.com/chart/ARROWRV1/';
function researchChart(){return {...chart,visibleCharts:3,chartLabels:['Chart for CME_MINI:NQ1!, 5 minutes','Chart for CME_MINI:NQ1!, 1 minute','Chart for CME_MINI:NQ1!, 1 second'],researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:3,targetCharts:1,selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',interval:'1',researchLayoutVerified:true,sourceMode:'LIVE',liveMultiChartExplicit:true,statusLegendScoped:true}};}
test('explicit LIVE research context accepts native three-message history for the unique active one-minute NQ without waiting for new HTF closes',()=>{
  const c=createPreopenContext({allowResearchLiveMultiChart:true}),captured=c.capture(burst(),{sourceTabId:17,chart:researchChart(),sourceUrl,receivedAt:at});
  assert.equal(captured.ok,true);assert.equal(captured.status,'CONTEXT_READY');assert.equal(captured.multiChartSeed,true);assert.equal(captured.sourceUrl,sourceUrl);assert.deepEqual(captured.series.map(s=>s.bars),[20,20,20]);assert.equal(captured.liveEligible,false);assert.equal(captured.ordersAuthorized,false);
  c.begin({sourceTabId:17,instrument:metadata.instrument,connectionSessionId:'live-three',sourceUrl});const args=c.readerArgs();assert.equal(args.bootstrapHistory.runId,metadata.instrument+'|1|'+runEpoch);assert.deepEqual(c.readerArgs(),{});
  c.observe({chart:researchChart(),sourceUrl,frame:{runEpoch}});assert.equal(c.snapshot().status,'CONTEXT_READY');
  assert.equal(createPreopenContext().capture(burst(),{sourceTabId:17,chart:researchChart(),sourceUrl,receivedAt:at}).ok,false,'default remains single-chart');
});
test('three-chart preparation rejects personal/ambiguous/mismatched source labels, URLs, modes and metadata',()=>{
  for(const change of [x=>{x.chart.chartLabels[2]=x.chart.chartLabels[1];},x=>{x.chart.chartLabels[2]='Chart for BINANCE:BTCUSDT, 1 second';},x=>{x.chart.chartLabels.pop();},x=>{x.chart.researchSelection.statusLegendScoped=false;},x=>{x.chart.researchSelection.liveMultiChartExplicit=false;},x=>{x.chart.researchSelection.sourceMode='REPLAY';},x=>{x.chart.interval='5';},x=>{x.chart.replay=true;},x=>{x.sourceUrl='https://www.tradingview.com/chart/Personal/';},x=>{x.sourceUrl+='?other=1';},x=>{delete x.sourceUrl;}]){
    const input={sourceTabId:17,chart:researchChart(),sourceUrl,receivedAt:at};change(input);const c=createPreopenContext({allowResearchLiveMultiChart:true});assert.equal(c.capture(burst(),input).ok,false,change.toString());assert.deepEqual(c.readerArgs(),{});
  }
  const changed=burst().map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)));for(const p of changed)p.metadata.pointValue=2;
  assert.equal(createPreopenContext({allowResearchLiveMultiChart:true}).capture(changed.map(p=>'ARROW_OHLC_V1 '+JSON.stringify(p)),{sourceTabId:17,chart:researchChart(),sourceUrl,receivedAt:at}).ok,false);
});
test('multi-chart seed stays bound to the reviewed URL and native run, including a reconnect or source change',()=>{
  for(const mutate of [e=>{e.sourceUrl='https://www.tradingview.com/chart/Other/';},e=>{e.frame.runEpoch++;},e=>{e.chart.researchSelection.targetCharts=2;}]){
    const c=createPreopenContext({allowResearchLiveMultiChart:true});c.capture(burst(),{sourceTabId:17,chart:researchChart(),sourceUrl,receivedAt:at});const e={chart:researchChart(),sourceUrl,frame:{runEpoch}};mutate(e);c.observe(e);assert.equal(c.snapshot().status,'NOT_PREPARED');assert.deepEqual(c.readerArgs(),{});
  }
  const c=createPreopenContext({allowResearchLiveMultiChart:true});c.capture(burst(),{sourceTabId:17,chart:researchChart(),sourceUrl,receivedAt:at});c.begin({sourceTabId:17,instrument:metadata.instrument,sourceUrl:'https://www.tradingview.com/chart/Other/'});assert.equal(c.snapshot().status,'NOT_PREPARED');assert.deepEqual(c.readerArgs(),{});
});

test('FULL SCREENS context requires its exact URL/name receipt and cannot borrow the research-layout receipt',()=>{
  const fullUrl='https://www.tradingview.com/chart/ARROWFR1/',fullChart=()=>{const value=researchChart();value.researchSelection.layoutName='Full Screens Live';return value;};
  const c=createPreopenContext({allowResearchLiveMultiChart:true}),captured=c.capture(burst(),{sourceTabId:17,chart:fullChart(),sourceUrl:fullUrl,receivedAt:at});assert.equal(captured.ok,true);assert.equal(captured.contextOnly,true);assert.equal(captured.liveEligible,false);assert.equal(captured.ordersAuthorized,false);
  c.begin({sourceTabId:17,instrument:metadata.instrument,sourceUrl:fullUrl,connectionSessionId:'full-screens'});assert.equal(c.readerArgs().bootstrapHistory.baseBars.length,20);
  for(const edit of [x=>{delete x.chart.researchSelection.layoutName;},x=>{x.chart.researchSelection.layoutName='Arrow OHLC Live Verification';},x=>{x.sourceUrl=sourceUrl;},x=>{x.sourceUrl+='?x=1';},x=>{x.chart.researchSelection.statusLegendScoped=false;},x=>{x.chart.replay=true;}]){const input={sourceTabId:17,chart:fullChart(),sourceUrl:fullUrl,receivedAt:at};edit(input);assert.equal(createPreopenContext({allowResearchLiveMultiChart:true}).capture(burst(),input).ok,false,edit.toString());}
  const research=researchChart();research.researchSelection.layoutName='Full Screens Live';assert.equal(createPreopenContext({allowResearchLiveMultiChart:true}).capture(burst(),{sourceTabId:17,chart:research,sourceUrl,receivedAt:at}).ok,false);
});
