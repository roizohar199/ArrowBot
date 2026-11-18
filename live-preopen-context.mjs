import {parseWindowBootstrapEvidence} from './window-bootstrap.mjs';

// A context cache, never a live store. It carries only the reviewed source
// history into the reader; that reader must independently see fresh frames.
export function createPreopenContext({allowResearchLiveMultiChart=false}={}){
  if(typeof allowResearchLiveMultiChart!=='boolean')throw TypeError('EXPLICIT_PREOPEN_CHART_POLICY_REQUIRED');
  let bundle=null,tabId=null,capturedAt=null,sessionId=null,seedSent=false,reason='NOT_PREPARED',sourceUrl=null,multiChartSeed=false;
  const copy=value=>structuredClone(value);
  function researchChart(chart,url){
    let exactUrl=false,layoutName=null;try{const parsed=new URL(url);layoutName=parsed.pathname==='/chart/ARROWRV1/'?'Arrow OHLC Live Verification':parsed.pathname==='/chart/ARROWFR1/'?'Full Screens Live':null;exactUrl=parsed.protocol==='https:'&&['www.tradingview.com','tradingview.com'].includes(parsed.hostname)&&layoutName!==null&&!parsed.port&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash;}catch{}
    const selection=chart?.researchSelection,labels=chart?.chartLabels;
    return allowResearchLiveMultiChart===true&&exactUrl&&chart?.visibleCharts>=2&&chart.visibleCharts<=3&&chart.documentVisible===true&&chart.replay===false&&chart.interval==='1'&&chart.symbols?.length===1&&chart.symbols[0]==='CME_MINI:NQ1!'
      &&Array.isArray(labels)&&labels.length===chart.visibleCharts&&labels.every(label=>typeof label==='string'&&/^Chart for CME_MINI:NQ1!, [^,]+$/.test(label))&&labels.filter(label=>label==='Chart for CME_MINI:NQ1!, 1 minute').length===1
      &&selection?.kind==='UNIQUE_ACTIVE_RESEARCH_NQ_1M'&&selection.visibleCharts===chart.visibleCharts&&selection.targetCharts===1&&selection.interval==='1'&&selection.selectedChartLabel==='Chart for CME_MINI:NQ1!, 1 minute'&&selection.researchLayoutVerified===true&&selection.liveMultiChartExplicit===true&&selection.statusLegendScoped===true&&selection.sourceMode==='LIVE'
      &&(layoutName==='Full Screens Live'?selection.layoutName===layoutName:selection.layoutName===undefined||selection.layoutName===layoutName);
  }
  function snapshot({includeHistory=false}={}){
    return {kind:'PREOPEN_CONTEXT_ONLY',status:bundle?.ready?'CONTEXT_READY':bundle?'CONTEXT_INCOMPLETE':'NOT_PREPARED',contextOnly:true,liveEligible:false,ordersAuthorized:false,tabId,capturedAt,sessionId,seedSent,reason,
      metadata:copy(bundle?.bootstrap.metadata??null),runId:bundle?.bootstrap.runId??null,runEpoch:bundle?.bootstrap.runEpoch??null,sourceUrl,multiChartSeed,
      series:bundle?[{timeframe:bundle.bootstrap.metadata.timeframe,bars:bundle.basePacket.bars.length},...bundle.higherPackets.map(packet=>({timeframe:packet.higherTimeframes[0].timeframe,bars:packet.higherTimeframes[0].bars.length}))]:[],
      ...(includeHistory&&bundle?{bootstrap:copy(bundle.bootstrap),bootstrapHistory:copy(bundle.bootstrapHistory)}:{})};
  }
  function clear(nextReason='NOT_PREPARED'){
    bundle=null;tabId=null;capturedAt=null;sessionId=null;seedSent=false;sourceUrl=null;multiChartSeed=false;reason=nextReason;return snapshot();
  }
  function capture(messages,{sourceTabId,chart,sourceUrl:chartUrl,receivedAt=Date.now()}={}){
    clear('SOURCE_HISTORY_NOT_VERIFIED');
    const multi=researchChart(chart,chartUrl);
    if(!Number.isSafeInteger(sourceTabId)||sourceTabId<1||chart?.visibleCharts!==1&&!multi||chart?.documentVisible!==true||chart?.replay!==false||chart?.symbols?.length!==1){reason='BOOTSTRAP_VISIBLE_SOURCE_REQUIRED';return {ok:false,...snapshot()};}
    const parsed=parseWindowBootstrapEvidence(messages,{tabId:sourceTabId,receivedAt});
    if(!parsed.ok){reason=parsed.reasonCodes[0];return {ok:false,...snapshot()};}
    if(chart.symbols[0]!==parsed.bootstrap.metadata.instrument||chart.interval!==parsed.bootstrap.metadata.timeframe){reason='BOOTSTRAP_CHART_IDENTITY_MISMATCH';return {ok:false,...snapshot()};}
    if(multi&&(parsed.bootstrap.metadata.instrument!=='CME_MINI:NQ1!'||parsed.bootstrap.metadata.timeframe!=='1'||parsed.bootstrap.metadata.timeframeMs!==60000||parsed.bootstrap.metadata.currency!=='USD'||parsed.bootstrap.metadata.tickSize!==.25||parsed.bootstrap.metadata.pointValue!==20||parsed.bootstrap.higherTimeframes.length!==2||parsed.bootstrap.higherTimeframes[0].timeframe!=='5'||parsed.bootstrap.higherTimeframes[1].timeframe!=='15')){reason='BOOTSTRAP_CHART_IDENTITY_MISMATCH';return {ok:false,...snapshot()};}
    bundle=parsed;tabId=sourceTabId;capturedAt=receivedAt;sourceUrl=typeof chartUrl==='string'?chartUrl:null;multiChartSeed=multi;reason='HISTORICAL_CONTEXT_ONLY';return {ok:true,...snapshot()};
  }
  function begin({sourceTabId,instrument,connectionSessionId,sourceUrl:chartUrl}={}){
    sessionId=connectionSessionId??null;seedSent=false;
    if(bundle&&(tabId!==sourceTabId||bundle.bootstrap.metadata.instrument!==instrument||multiChartSeed&&sourceUrl!==chartUrl))clear('BOOTSTRAP_ACCOUNT_OR_TAB_MISMATCH');
    return snapshot();
  }
  function readerArgs(){
    // A validated partial history is useful intake context too. The reader
    // and each timeframe manager still enforce their own readiness minimums.
    if(!bundle||seedSent)return {};
    seedSent=true;return {bootstrap:copy(bundle.bootstrap),bootstrapHistory:copy(bundle.bootstrapHistory)};
  }
  function observe(evidence){
    if(!bundle)return snapshot();
    const chart=evidence?.chart,epoch=evidence?.windowFrame?.runEpoch??evidence?.frame?.runEpoch??evidence?.bootstrapMetadata?.runEpoch;
    if(multiChartSeed&&(!researchChart(chart,evidence?.sourceUrl)||evidence.sourceUrl!==sourceUrl))return clear('BOOTSTRAP_SOURCE_CHANGED');
    if(chart&&(chart.symbols?.length!==1||chart.symbols[0]!==bundle.bootstrap.metadata.instrument||chart.interval!==bundle.bootstrap.metadata.timeframe||chart.replay!==false))return clear('BOOTSTRAP_SOURCE_CHANGED');
    if(Number.isSafeInteger(epoch)&&epoch!==bundle.bootstrap.runEpoch)return clear('BOOTSTRAP_SOURCE_RUN_CHANGED');
    if(evidence?.reasonCodes?.some(code=>['WINDOW_CLOSED_BAR_CORRECTION','WINDOW_METADATA_REBIND_REQUIRED','WINDOW_CHART_METADATA_MISMATCH','WINDOW_BOOTSTRAP_HISTORY_INVALID','WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH'].includes(code)))return clear('BOOTSTRAP_SOURCE_INVALIDATED');
    return snapshot();
  }
  return {capture,begin,readerArgs,observe,snapshot,clear};
}
