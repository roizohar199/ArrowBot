import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLiveChart} from '../live-ohlc.mjs';

const packet=(metadata={})=>({runId:'run:personal:123',realtime:true,metadata:{source:'ohlc',instrument:'BINANCE:BTCUSDT',timeframe:'1S',chartType:'standard',...metadata}});
const evidence=(chart={})=>({observedAtWall:1700000000000,chart:{visibleCharts:1,symbols:['BINANCE:BTCUSDT'],interval:'1S',replay:false,realtime:true,marketOpen:true,realtimeBasis:'EXPLICIT_REALTIME_DOM',realtimeReference:null,...chart}});

test('FULL SCREENS multi-chart proof binds the exact layout name and original URL without relaxing the active one-minute scope',()=>{
  const source=packet({instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000});
  const make=()=>({...evidence({visibleCharts:3,symbols:['CME_MINI:NQ1!'],interval:'1',chartLabels:['Chart for CME_MINI:NQ1!, 5 minutes','Chart for CME_MINI:NQ1!, 1 minute','Chart for CME_MINI:NQ1!, 1 second'],researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:3,targetCharts:1,interval:'1',selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',researchLayoutVerified:true,liveMultiChartExplicit:true,statusLegendScoped:true,sourceMode:'LIVE',layoutName:'Full Screens Live'}}),sourceUrl:'https://www.tradingview.com/chart/ARROWFR1/'});
  const good=verifyLiveChart(source,make(),17,{allowResearchLiveMultiChart:true});assert.equal(good.liveVerified,true);assert.equal(good.metadata.sourceUrl,make().sourceUrl);
  for(const change of [e=>{delete e.chart.researchSelection.layoutName;},e=>{e.chart.researchSelection.layoutName='Arrow OHLC Live Verification';},e=>{e.sourceUrl+='?x=1';},e=>{e.sourceUrl='https://www.tradingview.com/chart/Other/';},e=>{e.chart.researchSelection.statusLegendScoped=false;},e=>{e.chart.chartLabels[2]=e.chart.chartLabels[1];}]){const dom=make();change(dom);assert.equal(verifyLiveChart(source,dom,17,{allowResearchLiveMultiChart:true}).liveVerified,false);}
  const cross=make();cross.sourceUrl='https://www.tradingview.com/chart/ARROWRV1/';assert.equal(verifyLiveChart(source,cross,17,{allowResearchLiveMultiChart:true}).identityValid,false);
});

test('live chart proof binds exact exchange-qualified symbol, interval and source tab',()=>{
  const source=packet(),proof=verifyLiveChart(source,evidence(),17);
  assert.equal(proof.identityValid,true);assert.equal(proof.liveVerified,true);assert.deepEqual(proof.reasonCodes,[]);
  assert.equal(proof.metadata.tabId,17);assert.equal(proof.metadata.sourceId,source.runId);assert.equal(proof.metadata.chartIdentityVerified,true);assert.equal(proof.metadata.replay,false);
  assert.equal(proof.metadata.realtimeVerification.observedAtWall,1700000000000);
  proof.metadata.instrument='EDITED';assert.equal(source.metadata.instrument,'BINANCE:BTCUSDT');
});

test('matching ticker suffix on a different exchange cannot verify a live source',()=>{
  const proof=verifyLiveChart(packet({instrument:'COINBASE:BTCUSD'}),evidence({symbols:['BITSTAMP:BTCUSD']}),17);
  assert.equal(proof.identityValid,false);assert.equal(proof.liveVerified,false);assert.ok(proof.reasonCodes.includes('CHART_SYMBOL_MISMATCH'));assert.equal(proof.metadata.realtime,false);
});

test('multi-chart, missing symbol and different interval evidence fail identity verification',()=>{
  for(const chart of [{visibleCharts:2},{symbols:['BINANCE:BTCUSDT','BINANCE:ETHUSDT']},{symbols:[]},{interval:'5S'},{interval:null}]){
    const proof=verifyLiveChart(packet(),evidence(chart),17);assert.equal(proof.identityValid,false);assert.equal(proof.liveVerified,false);assert.equal(proof.metadata.chartIdentityVerified,false);
  }
  assert.ok(verifyLiveChart(packet(),evidence({interval:'5S'}),17).reasonCodes.includes('CHART_TIMEFRAME_MISMATCH'));
});

test('Replay, delayed data and closed market block live confirmation despite a matching chart identity',()=>{
  for(const [chart,reason] of [[{replay:true},'REPLAY_SOURCE'],[{replay:null},'REPLAY_STATUS_UNVERIFIED'],[{realtime:false},'DELAYED_SOURCE'],[{realtime:null},'LIVE_STATUS_UNVERIFIED'],[{marketOpen:false},'MARKET_CLOSED']]){
    const proof=verifyLiveChart(packet(),evidence(chart),17);assert.equal(proof.identityValid,true);assert.equal(proof.liveVerified,false);assert.ok(proof.reasonCodes.includes(reason));
  }
  const unknownReplay=verifyLiveChart(packet(),evidence({replay:null}),17);assert.equal(unknownReplay.metadata.replay,undefined);
});

test('Pine execution realtime never substitutes for missing DOM realtime or Replay evidence',()=>{
  const source=packet(),proof=verifyLiveChart(source,evidence({realtime:undefined,replay:undefined}),17);
  assert.equal(source.realtime,true);assert.equal(proof.liveVerified,false);assert.equal(proof.metadata.realtime,false);
  assert.ok(proof.reasonCodes.includes('LIVE_STATUS_UNVERIFIED'));assert.ok(proof.reasonCodes.includes('REPLAY_STATUS_UNVERIFIED'));
  assert.equal(verifyLiveChart(source,null,17).identityValid,false);
});

test('a fresh producer-clock bar can verify currentness without inventing an exchange entitlement',()=>{
  const sourceAt=1794636154411,source={...packet({instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000}),sourceEmittedAt:sourceAt,bars:[{time:1794636120000,closeTime:1794636180000,closed:false}]};
  const dom=evidence({symbols:['CME_MINI:NQ1!'],interval:'1',realtime:null});
  const proof=verifyLiveChart(source,dom,17);assert.equal(proof.liveVerified,true);assert.equal(proof.metadata.realtimeVerification.basis,'PINE_BAR_CURRENTNESS_WITH_VISIBLE_CHART');assert.equal(proof.metadata.realtimeVerification.exchangeEntitlementVerified,false);
  assert.equal(verifyLiveChart(source,{...dom,chart:{...dom.chart,realtime:false}},17).liveVerified,false);
  assert.equal(verifyLiveChart({...source,realtime:false},dom,17).liveVerified,false);
  assert.equal(verifyLiveChart({...source,sourceEmittedAt:sourceAt+900000},dom,17).liveVerified,false);
  assert.equal(verifyLiveChart({...source,bars:[{...source.bars[0],closed:true}]},dom,17).liveVerified,false);
});
