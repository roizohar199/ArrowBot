// Public Data Window transport for the user's personal Arrow indicator.
// This adapter reads rendered DOM only. It does not access chart internals,
// broker state, network transports or TradingView's private data objects.
export const ARROW_WINDOW_METADATA_PREFIX='ARROW_WINDOW_META_V2';
export const ARROW_WINDOW_TRANSPORT_VERSION=3;

export function parseTradingViewWindowMetadata(text){
  const fail=code=>({ok:false,reasonCodes:[code]});
  if(typeof text!=='string'||text.length>20000)return fail('WINDOW_METADATA_SIZE_LIMIT');
  const marker=text.indexOf(ARROW_WINDOW_METADATA_PREFIX);if(marker<0)return fail('WINDOW_METADATA_MARKER_REQUIRED');
  const start=text.indexOf('{',marker+ARROW_WINDOW_METADATA_PREFIX.length);if(start<0)return fail('WINDOW_METADATA_JSON_REQUIRED');
  let quoted=false,escaped=false,depth=0,end=-1;
  for(let index=start;index<text.length;index++){
    const char=text[index];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&--depth===0){end=index+1;break;}
  }
  if(end<0)return fail('WINDOW_METADATA_TRUNCATED');
  let value;try{value=JSON.parse(text.slice(start,end));}catch{return fail('WINDOW_METADATA_INVALID_JSON');}
  const plain=item=>item&&typeof item==='object'&&!Array.isArray(item),bounded=(item,max)=>typeof item==='string'&&item.length>0&&item.length<=max&&!/[\u0000-\u001f]/.test(item);
  const exact=(item,allowed)=>plain(item)&&Object.keys(item).every(key=>allowed.includes(key));
  const duration=tf=>typeof tf==='string'&&/^\d+S?$/.test(tf)?Number(tf.replace('S',''))*(tf.endsWith('S')?1000:60000):null;
  if(!exact(value,['schemaVersion','runEpoch','runId','metadata','higherTimeframes','encoding'])||value.schemaVersion!==2||!Number.isSafeInteger(value.runEpoch)||value.runEpoch<1577836800000||!bounded(value.runId,400)||!value.runId.endsWith('|'+value.runEpoch))return fail('WINDOW_METADATA_INVALID_ENVELOPE');
  const meta=value.metadata;
  if(!exact(meta,['source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'])||meta.source!=='ohlc'||!['instrument','timeframe','currency','timezone','session'].every(key=>bounded(meta[key],200))||!['standard','nonstandard'].includes(meta.chartType)||!Number.isSafeInteger(meta.timeframeMs)||meta.timeframeMs<1000||duration(meta.timeframe)!==meta.timeframeMs||!Number.isFinite(meta.tickSize)||meta.tickSize<=0||!Number.isFinite(meta.pointValue)||meta.pointValue<=0)return fail('WINDOW_METADATA_INVALID_SOURCE');
  try{new Intl.DateTimeFormat('en',{timeZone:meta.timezone});}catch{return fail('WINDOW_METADATA_INVALID_TIMEZONE');}
  if(!Array.isArray(value.higherTimeframes)||value.higherTimeframes.length!==2||value.higherTimeframes.some(entry=>!exact(entry,['timeframe','timeframeMs'])||!bounded(entry.timeframe,20)||entry.timeframeMs!==null&&(!Number.isSafeInteger(entry.timeframeMs)||entry.timeframeMs<=0||duration(entry.timeframe)!==entry.timeframeMs)))return fail('WINDOW_METADATA_INVALID_HIGHER_TIMEFRAMES');
  const encoding=value.encoding;
  if(!exact(encoding,['priceDecimals','volumeDecimals','volumeQuantized','volumeMaxAbsoluteError','volumeMissing','tagModulo','timeOrigin','historyHoldMs','historyOrder','checksumPrimes','checksumMultipliers'])||encoding.priceDecimals!==4||encoding.volumeDecimals!==6||encoding.volumeQuantized!==true||encoding.volumeMaxAbsoluteError!==0.0000005||encoding.volumeMissing!==999999999999||encoding.tagModulo!==4096||encoding.timeOrigin!==1577836800000||encoding.historyHoldMs!==500||encoding.historyOrder!=='newest_first'||JSON.stringify(encoding.checksumPrimes)!=='[1000000007,1000000009]'||JSON.stringify(encoding.checksumMultipliers)!=='[65599,131071]')return fail('WINDOW_METADATA_UNSUPPORTED_ENCODING');
  const tick=meta.tickSize*10000;if(Math.round(tick)<1||Math.abs(tick-Math.round(tick))>Math.max(1,Math.abs(tick))*Number.EPSILON*16)return fail('WINDOW_PRICE_PRECISION_UNREPRESENTABLE');
  return {ok:true,bootstrap:structuredClone(value),reasonCodes:[]};
}

// Capture the one small, rendered metadata log before opening Data Window.
// This function is also serialized on its own into Chrome's isolated world.
export function readWindowMetadataEvidence(){
  const observedAtWall=Date.now(),started=performance.now(),prefix='ARROW_WINDOW_META_V2';
  const unavailable=reason=>({status:'UNAVAILABLE',reasonCodes:[reason],bootstrap:null,observedAtWall,readMs:performance.now()-started});
  if(location.protocol!=='https:'||!(location.hostname==='tradingview.com'||location.hostname.endsWith('.tradingview.com'))||!location.pathname.startsWith('/chart/'))return unavailable('TRADINGVIEW_CHART_REQUIRED');
  const visible=node=>{if(!node?.getBoundingClientRect)return false;const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);};
  const valid=value=>{
    const plain=item=>item&&typeof item==='object'&&!Array.isArray(item),bounded=(item,max)=>typeof item==='string'&&item.length>0&&item.length<=max&&!/[\u0000-\u001f]/.test(item),keys=(item,list)=>plain(item)&&Object.keys(item).every(key=>list.includes(key));
    const duration=tf=>typeof tf==='string'&&/^\d+S?$/.test(tf)?Number(tf.replace('S',''))*(tf.endsWith('S')?1000:60000):null;
    if(!keys(value,['schemaVersion','runEpoch','runId','metadata','higherTimeframes','encoding'])||value.schemaVersion!==2||!Number.isSafeInteger(value.runEpoch)||value.runEpoch<1577836800000||!bounded(value.runId,400)||!value.runId.endsWith('|'+value.runEpoch))return false;
    const meta=value.metadata,encoding=value.encoding;
    if(!keys(meta,['source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'])||meta.source!=='ohlc'||!['instrument','timeframe','currency','timezone','session'].every(key=>bounded(meta[key],200))||!['standard','nonstandard'].includes(meta.chartType)||!Number.isSafeInteger(meta.timeframeMs)||meta.timeframeMs<1000||duration(meta.timeframe)!==meta.timeframeMs||!Number.isFinite(meta.tickSize)||meta.tickSize<=0||!Number.isFinite(meta.pointValue)||meta.pointValue<=0)return false;
    const tick=meta.tickSize*10000;if(Math.round(tick)<1||Math.abs(tick-Math.round(tick))>Math.max(1,Math.abs(tick))*Number.EPSILON*16)return false;
    try{new Intl.DateTimeFormat('en',{timeZone:meta.timezone});}catch{return false;}
    if(!Array.isArray(value.higherTimeframes)||value.higherTimeframes.length!==2||value.higherTimeframes.some(entry=>!keys(entry,['timeframe','timeframeMs'])||!bounded(entry.timeframe,20)||entry.timeframeMs!==null&&(!Number.isSafeInteger(entry.timeframeMs)||entry.timeframeMs<=0||duration(entry.timeframe)!==entry.timeframeMs)))return false;
    return keys(encoding,['priceDecimals','volumeDecimals','volumeQuantized','volumeMaxAbsoluteError','volumeMissing','tagModulo','timeOrigin','historyHoldMs','historyOrder','checksumPrimes','checksumMultipliers'])&&encoding.priceDecimals===4&&encoding.volumeDecimals===6&&encoding.volumeQuantized===true&&encoding.volumeMaxAbsoluteError===0.0000005&&encoding.volumeMissing===999999999999&&encoding.tagModulo===4096&&encoding.timeOrigin===1577836800000&&encoding.historyHoldMs===500&&encoding.historyOrder==='newest_first'&&JSON.stringify(encoding.checksumPrimes)==='[1000000007,1000000009]'&&JSON.stringify(encoding.checksumMultipliers)==='[65599,131071]';
  };
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),candidates=[],seen=new Set();let node,visited=0,limited=false;
  while((node=walker.nextNode())){
    if(++visited>20000){limited=true;break;}const text=node.nodeValue??'';if(!text.includes(prefix))continue;
    const parent=node.parentElement;if(!parent||!visible(parent)||parent.closest('script,style,textarea,input,[contenteditable="true"],[role="textbox"],.monaco-editor'))continue;
    const marker=text.indexOf(prefix),start=text.indexOf('{',marker+prefix.length);if(start<0||text.length>20000)continue;
    let depth=0,quoted=false,escaped=false,end=-1;
    for(let index=start;index<text.length;index++){const char=text[index];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&--depth===0){end=index+1;break;}}
    if(end<0)continue;const raw=prefix+' '+text.slice(start,end);if(seen.has(raw))continue;seen.add(raw);
    try{const value=JSON.parse(text.slice(start,end));if(valid(value))candidates.push({bootstrap:value,raw});}catch{}
  }
  if(limited)return unavailable('DOM_SCAN_LIMIT');
  const latest=candidates.sort((a,b)=>a.bootstrap.runEpoch-b.bootstrap.runEpoch).at(-1);if(!latest)return unavailable('WINDOW_METADATA_LOG_NOT_VISIBLE');
  const sameEpoch=candidates.filter(item=>item.bootstrap.runEpoch===latest.bootstrap.runEpoch);if(new Set(sameEpoch.map(item=>item.bootstrap.runId)).size>1)return unavailable('WINDOW_METADATA_AMBIGUOUS');
  return {status:'OK',reasonCodes:[],bootstrap:latest.bootstrap,rawMetadata:latest.raw,observedAtWall,readMs:performance.now()-started,visitedTextNodes:visited,transport:'PUBLIC_DATA_WINDOW_V2'};
}

// Self-contained because Chrome serializes this function into the source tab's
// isolated world. The only persistent object belongs to this extension.
export function readTradingViewWindowEvidence({bootstrap,bootstrapHistory,sessionId='arrow-window',needsSnapshot=false,minBars=20,historyCount=100,expectedStudyTitle='Arrow OHLC Window v2',reset=false,observationOnly=false,stop=false,afterSequence=0,afterRunId=null,allowResearchMultiChart=false,allowResearchLiveMultiChart=false}={}){
  const observedAtWall=Date.now(),started=performance.now(),origin=1577836800000,scalarBase=1000000000000,priceBase=20000000000,priceBias=10000000000;
  const suppliedBootstrapHistory=bootstrapHistory!==undefined;
  // Passive, same-document context only. No observer, receiver cursor, clock
  // grant, pending packet or approval is retained across monitor ownership.
  const retainedKey='__arrowVerifiedWindowContextV1',pageUrl=typeof location.href==='string'?location.href:location.protocol+'//'+location.hostname+location.pathname+(location.search??'')+(location.hash??''),priorOwner=globalThis.__arrowWindowFeedV2;
  let retainedContext=globalThis[retainedKey],retainedBootstrapUsed=false,reusedContext=null,retainedRejection=null;
  const discardRetained=reason=>{delete globalThis[retainedKey];retainedContext=null;retainedRejection=reason;};
  if(reset)discardRetained('RESET_REQUESTED');
  if(retainedContext&&(retainedContext.document!==document||retainedContext.sourceDocumentTimeOrigin!==performance.timeOrigin||retainedContext.sourceUrl!==pageUrl||!Number.isFinite(retainedContext.observedAtPerformance)||performance.now()<retainedContext.observedAtPerformance||performance.now()-retainedContext.observedAtPerformance>60000))discardRetained('DOCUMENT_OR_AGE_CHANGED');
  const canReuseRetained=!reset&&!observationOnly&&!suppliedBootstrapHistory&&retainedContext&&priorOwner?.sessionId!==sessionId;
  let rpcSourceDomTiming=null;
  let roiBrr=null,roiBrrStatus=null;
  const roiBrrKey=Symbol.for('arrow.roi-brr-live-observation.v1');
  if(!observationOnly)delete globalThis[roiBrrKey];
  const clockEvidence=()=>{const owned=globalThis.__arrowWindowFeedV2;return owned?.sessionId===sessionId&&Array.isArray(owned.clockWitnesses)?structuredClone(owned.clockWitnesses.slice(-8)):[];};
  const continuityEvidence=()=>{const owned=globalThis.__arrowWindowFeedV2;return owned?.sessionId===sessionId&&Array.isArray(owned.continuityDecisions)?structuredClone(owned.continuityDecisions.slice(-16)):[];};
  const empty=(reason,status='UNAVAILABLE',extra={})=>({status,reasonCodes:[reason],messages:[],chart:null,observedAtWall,readMs:performance.now()-started,transport:'PUBLIC_DATA_WINDOW_V2',sourceDomTiming:rpcSourceDomTiming,continuityDecisions:continuityEvidence(),clockWitnesses:clockEvidence(),roiBrr,roiBrrStatus,...extra});
  if(stop){const owned=globalThis.__arrowWindowFeedV2;if(owned?.sessionId===sessionId){owned.observer?.disconnect();if(owned.expiryTimer!==undefined)clearTimeout(owned.expiryTimer);delete globalThis.__arrowWindowFeedV2;}return empty('WINDOW_OBSERVER_STOPPED','STOPPED');}
  if(observationOnly&&globalThis.__arrowWindowFeedV2?.inObserverCallback!==true)return empty('WINDOW_OBSERVER_CONTEXT_REQUIRED');
  // Only a real receiver RPC may renew the separate timing observer's lease.
  // Sampling here stays inside that RPC's calibration bracket, including when
  // the source cursor currently points to an unavailable historical frame.
  if(!observationOnly)try{rpcSourceDomTiming=globalThis.__arrowSourceDomTimingV1?.read?.()??null;}catch{}
  if(location.protocol!=='https:'||!(location.hostname==='tradingview.com'||location.hostname.endsWith('.tradingview.com'))||!location.pathname.startsWith('/chart/'))return empty('TRADINGVIEW_CHART_REQUIRED');
  if(!bootstrap&&globalThis.__arrowWindowFeedV2?.sessionId===sessionId)bootstrap=globalThis.__arrowWindowFeedV2.bootstrap;
  if(!bootstrapHistory&&globalThis.__arrowWindowFeedV2?.sessionId===sessionId)bootstrapHistory=globalThis.__arrowWindowFeedV2.bootstrapHistory;
  if(!bootstrap&&canReuseRetained){bootstrap=structuredClone(retainedContext.bootstrap);retainedBootstrapUsed=true;}
  let meta=bootstrap?.metadata;const encoding=bootstrap?.encoding;
  if(bootstrap&&(bootstrap?.schemaVersion!==2||!Number.isSafeInteger(bootstrap.runEpoch)||typeof bootstrap.runId!=='string'||!bootstrap.runId.endsWith('|'+bootstrap.runEpoch)||
    !meta||meta.source!=='ohlc'||meta.chartType!=='standard'||!Number.isSafeInteger(meta.timeframeMs)||meta.timeframeMs<1000||!Number.isFinite(meta.tickSize)||meta.tickSize<=0||!Number.isFinite(meta.pointValue)||meta.pointValue<=0||
    !Array.isArray(bootstrap.higherTimeframes)||bootstrap.higherTimeframes.length!==2||encoding?.priceDecimals!==4||encoding.volumeDecimals!==6||encoding.volumeMissing!==scalarBase-1||encoding.tagModulo!==4096||encoding.timeOrigin!==origin))return empty('WINDOW_METADATA_REQUIRED');
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>200||!Number.isSafeInteger(minBars)||minBars<1||minBars>100||!Number.isSafeInteger(historyCount)||historyCount<minBars||historyCount>100||typeof needsSnapshot!=='boolean'||!Number.isSafeInteger(afterSequence)||afterSequence<0||afterRunId!==null&&(typeof afterRunId!=='string'||!afterRunId||afterRunId.length>400))return empty('WINDOW_READER_CONFIGURATION_INVALID');
  const visible=node=>{if(!node?.getBoundingClientRect)return false;const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);};
  const visibleInViewport=node=>{
    if(document.visibilityState!=='visible'||document.hidden===true)return false;
    const box=node?.getBoundingClientRect?.();if(!box||box.width<=0||box.height<=0)return false;
    let left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
    if(right<=left||bottom<=top)return false;
    let ancestor=node,depth=0;
    for(;ancestor&&depth<64;ancestor=ancestor.parentElement,depth++){
      const style=getComputedStyle(ancestor);
      if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.contentVisibility==='hidden'||style.opacity!==''&&Number(style.opacity)===0)return false;
      const clipX=['auto','scroll','hidden','clip','overlay'].includes(style.overflowX??style.overflow),clipY=['auto','scroll','hidden','clip','overlay'].includes(style.overflowY??style.overflow);
      if(clipX||clipY){const bounds=ancestor.getBoundingClientRect(),x=bounds.left+(ancestor.clientLeft??0),y=bounds.top+(ancestor.clientTop??0);if(clipX){left=Math.max(left,x);right=Math.min(right,x+(ancestor.clientWidth??bounds.width));}if(clipY){top=Math.max(top,y);bottom=Math.min(bottom,y+(ancestor.clientHeight??bounds.height));}if(right<=left||bottom<=top)return false;}
    }
    return !ancestor;
  };
  const canvases=Array.from(document.querySelectorAll('canvas[aria-label^="Chart for "]')).filter(visible),labels=canvases.map(node=>node.getAttribute('aria-label')??'');
  const symbols=[...new Set(labels.map(label=>/^Chart for (.+), [^,]+$/.exec(label)?.[1]).filter(Boolean))];
  const selected=document.querySelector('#header-toolbar-intervals [aria-checked="true"]'),interval=selected?.getAttribute('data-value')??null;
  const replayNode=document.querySelector('#header-toolbar-replay'),replayAttribute=replayNode?.getAttribute('aria-pressed')??replayNode?.getAttribute('aria-checked'),replay=replayAttribute==='true'?true:replayAttribute==='false'?false:null;
  const researchLayout=document.querySelector('button[aria-label*="Active layout: Arrow "]'),researchTargets=canvases.filter(node=>node.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute');
  const researchMultiChart=allowResearchMultiChart===true&&canvases.length>=2&&canvases.length<=3&&researchLayout&&visible(researchLayout)&&interval==='1'&&replay===true&&symbols.length===1&&symbols[0]==='CME_MINI:NQ1!'&&researchTargets.length===1;
  // LIVE has exactly two approved URL/name pairs; selecting the existing
  // one-minute pane never changes a layout, symbol or timeframe.
  let liveLayoutName=null;
  try{const url=new URL(location.href);if(url.protocol==='https:'&&url.protocol===location.protocol&&url.hostname===location.hostname&&url.pathname===location.pathname&&['www.tradingview.com','tradingview.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash)liveLayoutName=url.pathname==='/chart/ARROWRV1/'?'Arrow OHLC Live Verification':url.pathname==='/chart/ARROWFR1/'?'Full Screens Live':null;}catch{}
  const liveLayouts=Array.from(document.querySelectorAll('button[aria-label*="Active layout: "]')).filter(visibleInViewport);
  const liveIntervals=Array.from(document.querySelectorAll('#header-toolbar-intervals [aria-checked="true"]')).filter(visibleInViewport);
  const liveReplay=Array.from(document.querySelectorAll('#header-toolbar-replay')).filter(visibleInViewport);
  const researchLiveMultiChart=allowResearchLiveMultiChart===true&&liveLayoutName!==null
    &&liveLayouts.length===1&&(liveLayouts[0].getAttribute('aria-label')??'').replace(/\s+/g,' ').trim().endsWith('Active layout: '+liveLayoutName)
    &&canvases.length>=2&&canvases.length<=3&&canvases.every(node=>visibleInViewport(node)&&/^Chart for CME_MINI:NQ1!, [^,]+$/.test(node.getAttribute('aria-label')??''))
    &&researchTargets.length===1&&liveIntervals.length===1&&liveIntervals[0]===selected&&interval==='1'&&liveReplay.length===1&&liveReplay[0]===replayNode&&replay===false;
  const legends=Array.from(document.querySelectorAll('[data-qa-id="legend-series-item"]')).filter(visible);
  let scopedLegend=null;
  if(researchLiveMultiChart){
    // Stop at a shared/mixed chart ancestor. A global "first legend" can report
    // the market/realtime state of the five-minute or one-second chart instead.
    for(let ancestor=researchTargets[0].parentElement,depth=0;ancestor&&depth<32;ancestor=ancestor.parentElement,depth++){
      const chartNodes=ancestor.querySelectorAll('canvas[aria-label^="Chart for "]');
      if(chartNodes.length>20)break;
      const ownedCanvases=Array.from(chartNodes).filter(visible);
      if(ownedCanvases.length!==1||ownedCanvases[0]!==researchTargets[0])break;
      const legendNodes=ancestor.querySelectorAll('[data-qa-id="legend-series-item"]');
      if(legendNodes.length>20)break;
      const ownLegends=Array.from(legendNodes).filter(visibleInViewport);
      if(ownLegends.length>1)break;
      if(ownLegends.length===1){scopedLegend=ownLegends[0];break;}
    }
  }
  let statuses=null;
  if(researchLiveMultiChart){
    const scopedStatuses=scopedLegend?Array.from(scopedLegend.querySelectorAll('[data-qa-id="legend-statuses-wrapper"]')).filter(visibleInViewport):[];
    if(scopedStatuses.length===1)statuses=scopedStatuses[0];
  }else if(legends.length===1)statuses=legends[0].querySelector('[data-qa-id="legend-statuses-wrapper"]');
  const statusText=(statuses?.outerHTML??'')+' '+(statuses?.textContent??''),openStatus=/marketStatusOpen-/.test(statusText),closedStatus=/marketStatusClose(?:d)?-/.test(statusText),marketOpen=researchLiveMultiChart&&openStatus&&closedStatus?null:openStatus?true:closedStatus?false:null;
  const delayed=/dataModeDelayed|dataStatusDelayed|isDelayed|Data is delayed|Delayed data|End.of.day/i.test(statusText),explicit=/dataModeRealtime|dataStatusRealtime|Real.time data|Data is real.time/i.test(statusText),knownRealtimeOnly=symbols.length===1&&symbols[0].startsWith('BINANCE:');
  const realtime=delayed?false:explicit||knownRealtimeOnly&&marketOpen===true&&statuses!==null?true:null;
  const chart={symbols,interval,replay,marketOpen,realtime,chartLabels:labels,visibleCharts:canvases.length,documentVisible:document.visibilityState==='visible',realtimeBasis:delayed?'EXPLICIT_DELAYED_DOM':explicit?'EXPLICIT_REALTIME_DOM':realtime===true?'BINANCE_REALTIME_ONLY_COVERAGE_2026_11_14':'UNVERIFIED',realtimeReference:knownRealtimeOnly?'https://www.tradingview.com/data-coverage/':null,...(researchMultiChart||researchLiveMultiChart?{researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:canvases.length,targetCharts:1,selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',interval:'1',researchLayoutVerified:true,...(researchLiveMultiChart?{layoutName:liveLayoutName,sourceMode:'LIVE',liveMultiChartExplicit:true,statusLegendScoped:statuses!==null}:{})}}:{})};
  const unavailable=(reason,status='UNAVAILABLE',extra={})=>empty(reason,status,{chart,...extra});
  if(typeof allowResearchMultiChart!=='boolean'||typeof allowResearchLiveMultiChart!=='boolean')return unavailable('WINDOW_READER_CONFIGURATION_INVALID');
  if((canvases.length!==1&&!researchMultiChart&&!researchLiveMultiChart)||symbols.length!==1)return unavailable('SINGLE_VISIBLE_CHART_REQUIRED');
  const selectedTab=Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).find(node=>/data\s*window/i.test((node.getAttribute('aria-label')??'')+' '+(node.getAttribute('title')??'')+' '+(node.textContent??'')));
  if(!selectedTab||!visibleInViewport(selectedTab))return unavailable('DATA_WINDOW_NOT_SELECTED');
  const studyHeader=row=>Array.from(row.querySelectorAll('span[title]')).find(node=>(node.getAttribute('title')??'').startsWith(expectedStudyTitle))??Array.from(row.querySelectorAll(':scope > div[class*="header-"] > span[class*="headerTitle-"]')).find(node=>!node.getAttribute('title')&&/^Arrow OHLC Window v2(?:\s|\(|$)/.test((node.textContent??'').replace(/\s+/g,' ').trim()));
  const studyRows=Array.from(document.querySelectorAll('[role="treegrid"] [role="row"][data-role="menuitem"]'));
  const ownedRows=studyRows.filter(row=>visible(row)&&studyHeader(row));
  if(ownedRows.length!==1)return unavailable(ownedRows.length?'WINDOW_STUDY_AMBIGUOUS':'WINDOW_STUDY_NOT_FOUND');
  const ownedHeader=studyHeader(ownedRows[0]);
  if(!visibleInViewport(ownedHeader))return unavailable('WINDOW_STUDY_NOT_VISIBLE');
  const row=ownedRows[0],suffixes=['TIME','CLOSE_TIME','OPEN','HIGH','LOW','CLOSE','VOLUME'],tagged=[];
  const add=(name,kind='scalar')=>tagged.push({name:'ARROW2_'+name,kind});
  for(const [name,kind] of [['SOURCE_EPOCH','time'],['BASE_MS'],['TICK','price'],['POINT','price'],['HIGHER1_MS'],['HIGHER2_MS'],['SUPPORTED'],['HISTORY_STATE']])add(name,kind);
  for(const suffix of [...suffixes,'CLOSED'])add('CURRENT_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':suffix==='VOLUME'?'volume':'scalar');
  for(const group of ['PREVIOUS','HIGHER1','HIGHER2','HISTORY_BASE','HISTORY_HIGHER1','HISTORY_HIGHER2'])for(const suffix of suffixes)add(group+'_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':'volume');
  const names=['ARROW2_PROTOCOL','ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN',...tagged.map(item=>item.name),'ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B','ARROW2_SEQ_END'],nodes=new Map();
  for(const label of Array.from(row.querySelectorAll('[data-test-id-value-title]'))){
    const title=label.getAttribute('data-test-id-value-title');if(!title?.startsWith('ARROW2_'))continue;
    if(!names.includes(title)||nodes.has(title))return unavailable('WINDOW_DUPLICATE_OR_UNKNOWN_FIELD');
    const parent=label.parentElement;if(!parent||parent.children.length!==2||parent.children[0]!==label)return unavailable('WINDOW_FIELD_STRUCTURE_CHANGED');
    nodes.set(title,parent.children[1]);
  }
  if(nodes.size!==names.length)return unavailable('WINDOW_FIELDS_NOT_MOUNTED', 'UNAVAILABLE',{mountedFields:nodes.size,expectedFields:names.length});
  let shared=globalThis.__arrowWindowFeedV2;
  if(reset||!shared||shared.sessionId!==sessionId){shared?.observer?.disconnect();if(shared?.expiryTimer!==undefined)clearTimeout(shared.expiryTimer);shared={sessionId,bootstrap:bootstrap?structuredClone(bootstrap):null,active:true,pendingMessages:new Map(),latestEvidence:null};globalThis.__arrowWindowFeedV2=shared;}
  let acknowledgedBenignRecovery=false;
  if(!observationOnly){
    if(needsSnapshot&&shared.resetReported){acknowledgedBenignRecovery=shared.pendingResetReasons?.length>0&&shared.pendingResetReasons.every(reason=>reason==='WINDOW_COHERENCE_REPRIMING');shared.pendingResetReasons=[];shared.resetReported=false;}
    shared.lastRealPollAt=observedAtWall;shared.lastRealPollPerf=performance.now();shared.currentArgs={sessionId,needsSnapshot,minBars,historyCount,expectedStudyTitle,afterSequence,afterRunId,allowResearchMultiChart,allowResearchLiveMultiChart};shared.active=true;
    if(shared.expiryTimer!==undefined)clearTimeout(shared.expiryTimer);
    if(typeof setTimeout==='function')shared.expiryTimer=setTimeout(()=>{const current=globalThis.__arrowWindowFeedV2;if(current?.sessionId===sessionId&&performance.now()-current.lastRealPollPerf>=60000){current.observer?.disconnect();current.observer=null;current.active=false;current.pendingMessages.clear();}},60000);
    if(typeof MutationObserver==='function'&&(!shared.observer||shared.observedRow!==row)){
      shared.observer?.disconnect();
      shared.observer=new MutationObserver(()=>{
        const current=globalThis.__arrowWindowFeedV2;if(!current?.active||current.sessionId!==sessionId)return;
        if(performance.now()-current.lastRealPollPerf>=60000){current.observer?.disconnect();current.active=false;return;}
        current.inObserverCallback=true;
        try{const result=readTradingViewWindowEvidence({...current.currentArgs,bootstrap:current.bootstrap??undefined,observationOnly:true});const latest=globalThis.__arrowWindowFeedV2;if(latest?.sessionId===sessionId&&result.windowFrame?.coherent){latest.latestEvidence=result;try{globalThis.__arrowWindowWakeV1?.notify?.();}catch{}}}catch{}
        finally{const latest=globalThis.__arrowWindowFeedV2;if(latest?.sessionId===sessionId)latest.inObserverCallback=false;}
      });shared.observedRow=row;shared.observer.observe(row,{subtree:true,childList:true,characterData:true});
    }
  }
  const integerText=node=>{
    const text=(node?.textContent??'').trim();if(!text||/^(?:na|n\/a|nan|∅|—|–|-|\u2014)$/i.test(text))return null;
    const normalized=text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[ ,\u00a0\u202f\u2009]/g,'').replace(/\u2212/g,'-');
    if(!/^[+-]?\d+(?:\.0+)?$/.test(normalized))throw Error('WINDOW_NONINTEGER_RENDERED_VALUE');
    const value=Number(normalized);if(!Number.isSafeInteger(value))throw Error('WINDOW_UNSAFE_RENDERED_INTEGER');return value;
  };
  let raw,decoded,sequence,sourceAt,historyState,metadataFrame=false,bootstrapMetadata=null;
  try{
    const begin=integerText(nodes.get('ARROW2_SEQ_BEGIN')),epoch=integerText(nodes.get('ARROW2_RUN_EPOCH'));
    raw=Object.fromEntries(names.map(name=>[name,integerText(nodes.get(name))]));sequence=raw.ARROW2_SEQ_BEGIN;
    if(names.every(name=>raw[name]===null))return unavailable('WINDOW_LAST_BAR_REQUIRED');
    if(['ARROW2_PROTOCOL','ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END'].some(name=>raw[name]===null))return unavailable('WINDOW_MIXED_FRAME');
    if(![2,3].includes(raw.ARROW2_PROTOCOL)||!Number.isSafeInteger(epoch)||epoch<origin||raw.ARROW2_RUN_EPOCH!==epoch)return unavailable('WINDOW_METADATA_REBIND_REQUIRED');
    if(retainedContext&&(raw.ARROW2_PROTOCOL!==3||retainedContext.bootstrap.runEpoch!==epoch)){discardRetained('NATIVE_RUN_CHANGED');if(retainedBootstrapUsed){bootstrap=null;meta=null;shared.bootstrap=null;}}
    if(!Number.isSafeInteger(sequence)||sequence<0||sequence>Math.floor((Number.MAX_SAFE_INTEGER-7)/8)||sequence!==begin||raw.ARROW2_SEQ_END!==sequence||integerText(nodes.get('ARROW2_SEQ_BEGIN'))!==sequence||integerText(nodes.get('ARROW2_SEQ_END'))!==sequence||integerText(nodes.get('ARROW2_RUN_EPOCH'))!==epoch)return unavailable('WINDOW_MIXED_FRAME');
    let hashA=0,hashB=0;
    for(const value of [epoch,sequence,...tagged.map(item=>raw[item.name]??-1)]){hashA=(hashA*65599+((value%1000000007)+1000000007)%1000000007)%1000000007;hashB=(hashB*131071+((value%1000000009)+1000000009)%1000000009)%1000000009;}
    if(raw.ARROW2_CHECKSUM_A!==hashA||raw.ARROW2_CHECKSUM_B!==hashB)return unavailable('WINDOW_FRAME_CHECKSUM_MISMATCH');
    decoded={};const payloads={};
    for(const item of tagged){
      const value=raw[item.name];if(value===null){decoded[item.name]=null;continue;}
      const base=item.kind==='price'?priceBase:scalarBase,payload=value%base;
      if(value<0||Math.floor(value/base)!==sequence%4096||payload<0||payload>=base)throw Error('WINDOW_PAYLOAD_TAG_MISMATCH');
      payloads[item.name]=payload;decoded[item.name]=item.kind==='price'?(payload-priceBias)/10000:item.kind==='time'?payload+origin:item.kind==='volume'?payload===scalarBase-1?null:payload/1000000:payload;
    }
    if((decoded.ARROW2_SUPPORTED&4)===4)return unavailable('WINDOW_METADATA_TEXT_UNREPRESENTABLE');
    if(tagged.slice(0,8).some(item=>decoded[item.name]===null)||!Number.isSafeInteger(decoded.ARROW2_SUPPORTED)||decoded.ARROW2_SUPPORTED<0||decoded.ARROW2_SUPPORTED>7||(decoded.ARROW2_SUPPORTED&1)!==1)return unavailable('WINDOW_SOURCE_UNSUPPORTED');
    sourceAt=decoded.ARROW2_SOURCE_EPOCH;
    let packed=decoded.ARROW2_HISTORY_STATE;
    if(packed>=134217728){metadataFrame=true;packed-=134217728;if(packed>=134217728)throw Error('WINDOW_INVALID_HISTORY_STATE');}
    const slot=packed%100;packed=Math.floor(packed/100);const h2=packed%101;packed=Math.floor(packed/101);const h1=packed%101,base=Math.floor(packed/101);
    if([base,h1,h2].some(count=>count<0||count>100))throw Error('WINDOW_INVALID_HISTORY_STATE');historyState={slot,counts:[base,h1,h2]};
    if(metadataFrame){
      const bytes=[];for(const field of tagged.slice(37)){const word=payloads[field.name];if(!Number.isSafeInteger(word)||word<0||word>4294967295)throw Error('WINDOW_INVALID_METADATA_BYTES');for(const shift of [16777216,65536,256,1])bytes.push(Math.floor(word/shift)%256);}
      const end=bytes.indexOf(0),textBytes=end<0?bytes:bytes.slice(0,end);if(end>=0&&bytes.slice(end).some(byte=>byte!==0)||textBytes.some(byte=>byte<32||byte>126))throw Error('WINDOW_INVALID_METADATA_BYTES');
      const parts=String.fromCharCode(...textBytes).split('|');if(parts.length!==6||parts[0]!==String(raw.ARROW2_PROTOCOL)||parts.slice(1).some(part=>!part||part.length>200))throw Error('WINDOW_INVALID_METADATA_TEXT');
      const [_,instrument,timeframe,timezone,session,currency]=parts,duration=/^\d+S?$/.test(timeframe)?Number(timeframe.replace('S',''))*(timeframe.endsWith('S')?1000:60000):null;
      if(duration!==decoded.ARROW2_BASE_MS||instrument!==symbols[0]||timeframe!==interval)throw Error('WINDOW_CHART_METADATA_MISMATCH');
      try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('WINDOW_METADATA_INVALID_TIMEZONE');}
      const tf=ms=>Number.isSafeInteger(ms)&&ms>0&&ms%1000===0?ms%60000===0?String(ms/60000):String(ms/1000)+'S':null;
      const higherTimeframes=[decoded.ARROW2_HIGHER1_MS,decoded.ARROW2_HIGHER2_MS].map(ms=>({timeframe:tf(ms),timeframeMs:ms}));
      if(higherTimeframes.some(entry=>!entry.timeframe||entry.timeframeMs<=duration)||higherTimeframes[0].timeframe===higherTimeframes[1].timeframe)throw Error('WINDOW_METADATA_INVALID_HIGHER_TIMEFRAMES');
      bootstrapMetadata={schemaVersion:2,...(raw.ARROW2_PROTOCOL===3?{wireVersion:3}:{}),runEpoch:epoch,runId:instrument+'|'+timeframe+'|'+epoch,metadata:{source:'ohlc',instrument,timeframe,timeframeMs:duration,tickSize:decoded.ARROW2_TICK,pointValue:decoded.ARROW2_POINT,currency,timezone,session,chartType:'standard'},higherTimeframes,encoding:{priceDecimals:4,volumeDecimals:6,volumeQuantized:true,volumeMaxAbsoluteError:.0000005,volumeMissing:scalarBase-1,tagModulo:4096,timeOrigin:origin,historyHoldMs:raw.ARROW2_PROTOCOL===3?200:500,historyOrder:'newest_first',checksumPrimes:[1000000007,1000000009],checksumMultipliers:[65599,131071]}};
      bootstrap=bootstrapMetadata;meta=bootstrap.metadata;
    }
    if(!bootstrap||bootstrap.runEpoch!==epoch)return unavailable('WINDOW_METADATA_FRAME_REQUIRED','WAITING',{needsMetadata:true,resetRequired:!!bootstrap,frame:{sequence,sourceEmittedAt:sourceAt,runEpoch:epoch,coherent:true,checksumsVerified:true}});
    if((bootstrap.wireVersion??2)!==raw.ARROW2_PROTOCOL)return unavailable('WINDOW_METADATA_REBIND_REQUIRED');
    if(symbols[0]!==meta.instrument||interval!==meta.timeframe)return unavailable('WINDOW_CHART_METADATA_MISMATCH');
    const tick=meta.tickSize*10000;if(!Number.isFinite(tick)||Math.round(tick)<1||Math.abs(tick-Math.round(tick))>Math.max(1,Math.abs(tick))*Number.EPSILON*16||!Number.isFinite(meta.pointValue)||meta.pointValue<=0)throw Error('WINDOW_PRICE_PRECISION_UNREPRESENTABLE');
    if(decoded.ARROW2_BASE_MS!==meta.timeframeMs||decoded.ARROW2_TICK!==meta.tickSize||decoded.ARROW2_POINT!==meta.pointValue||bootstrap.higherTimeframes.some((entry,index)=>decoded['ARROW2_HIGHER'+(index+1)+'_MS']!==(entry.timeframeMs??0)))return unavailable('WINDOW_ENCODED_METADATA_MISMATCH');
  }catch(error){return unavailable(String(error?.message??'WINDOW_DECODE_FAILED'));}
  const readBar=(group,duration,current=false)=>{
    const values=suffixes.map(suffix=>decoded['ARROW2_'+group+'_'+suffix]);
    if(values.every(value=>value===null))return null;
    // Only volume has an explicit missing sentinel. Every other row operand
    // must be present together; a partially painted row never enters history.
    if(values.slice(0,6).some(value=>value===null)||!Number.isSafeInteger(duration)||duration<1000)throw Error('WINDOW_INCOMPLETE_BAR');
    const [time,closeCarrier,open,high,low,close,volume]=values,closed=current?decoded.ARROW2_CURRENT_CLOSED===1:true;
    const proof=raw.ARROW2_PROTOCOL===3?closeCarrier-origin:null,closeTime=proof===null?closeCarrier:time+duration;
    if(proof!==null&&(!Number.isSafeInteger(proof)||proof<0||proof>=scalarBase))throw Error('WINDOW_INVALID_PROVIDER_BAR_PROOF');
    if(current&&![0,1].includes(decoded.ARROW2_CURRENT_CLOSED)||!Number.isSafeInteger(time)||!Number.isSafeInteger(closeTime)||closeTime-time!==duration||time>sourceAt||closed&&closeTime>sourceAt||high<Math.max(open,close)||low>Math.min(open,close)||high<low)throw Error('WINDOW_INVALID_BAR');
    for(const price of [open,high,low,close])if(Math.abs(price/meta.tickSize-Math.round(price/meta.tickSize))>Math.max(1,Math.abs(price/meta.tickSize))*Number.EPSILON*32)throw Error('WINDOW_PRICE_OFF_TICK');
    return {time,closeTime,open,high,low,close,volume,closed,sourceClosed:closed,...(proof===null?{}:{providerBarIndex:Math.floor(proof/4),sessionFirst:(proof%4&1)===1,sessionLast:(proof%4&2)===2})};
  };
  let current,previous,higher,historical;
  try{
    current=readBar('CURRENT',meta.timeframeMs,true);if(!current)throw Error('WINDOW_CURRENT_BAR_REQUIRED');
    previous=readBar('PREVIOUS',meta.timeframeMs);higher=bootstrap.higherTimeframes.map((entry,index)=>readBar('HIGHER'+(index+1),entry.timeframeMs));
    historical=metadataFrame?[null,null,null]:[readBar('HISTORY_BASE',meta.timeframeMs),...bootstrap.higherTimeframes.map((entry,index)=>readBar('HISTORY_HIGHER'+(index+1),entry.timeframeMs))];
    if(previous&&previous.closeTime>current.time||higher.some(bar=>bar&&bar.closeTime>sourceAt))throw Error('WINDOW_ROW_CHRONOLOGY_MISMATCH');
    for(let index=0;index<3;index++)if(!metadataFrame&&historyState.slot>=historyState.counts[index]&&historical[index]!==null)throw Error('WINDOW_HISTORY_COUNT_MISMATCH');
  }catch(error){return unavailable(String(error?.message??'WINDOW_BAR_DECODE_FAILED'));}
  // A historical crosshair can replay a valid old Pine frame. It is not a
  // producer rollback: reject it before touching history, observer witnesses
  // or the live cursor, including while a new snapshot is being assembled.
  if(sourceAt<observedAtWall-15000&&current.closeTime<observedAtWall-15000)return unavailable('WINDOW_LAST_BAR_REQUIRED');
  const gapProof=(previous,next)=>previous&&next&&next.time>previous.closeTime&&Number.isSafeInteger(previous.providerBarIndex)&&next.providerBarIndex===previous.providerBarIndex+1&&previous.sessionLast===true&&next.sessionFirst===true?{from:previous.closeTime,to:next.time,kind:'market_closed',basis:'PINE_SESSION_FLAGS_AND_PROVIDER_INDEX',previousBarIndex:previous.providerBarIndex,nextBarIndex:next.providerBarIndex,previousSessionLast:true,nextSessionFirst:true}:null;
  const adjacent=(previous,next)=>next.time===previous.closeTime&&(raw.ARROW2_PROTOCOL===2||next.providerBarIndex===previous.providerBarIndex+1)||!!gapProof(previous,next);
  const gapsFor=bars=>bars.flatMap((bar,index)=>index>0&&gapProof(bars[index-1],bar)?[gapProof(bars[index-1],bar)]:[]);
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const equalClosed=(a,b)=>['time','closeTime','open','high','low','close','volume','providerBarIndex','sessionFirst','sessionLast'].every(key=>a[key]===b[key]);
  if(canReuseRetained&&retainedContext){
    const cache=retainedContext,seed=cache.seed,series=[seed.baseBars,...seed.higherTimeframes.map(entry=>entry.bars)],incoming=[[previous,...(current.closed?[current]:[]),...(!metadataFrame?[historical[0]]:[])],...higher.map((bar,index)=>[bar,...(!metadataFrame?[historical[index+1]]:[])])],seqDelta=sequence-cache.sequence,sourceDelta=sourceAt-cache.sourceEmittedAt;
    const checks={sameBinding:raw.ARROW2_PROTOCOL===3&&cache.bootstrap.runId===bootstrap.runId&&JSON.stringify(stable([cache.bootstrap.metadata,cache.bootstrap.higherTimeframes,cache.bootstrap.encoding]))===JSON.stringify(stable([bootstrap.metadata,bootstrap.higherTimeframes,bootstrap.encoding])),liveSource:chart.replay===false&&(decoded.ARROW2_SUPPORTED&2)===2&&chart.documentVisible===true&&chart.marketOpen===true&&chart.realtime!==false,forwardFrame:seqDelta===0&&sourceDelta===0||seqDelta>0&&seqDelta<4096&&sourceDelta>=0&&sourceDelta<=60000,currentAdjacent:current.time===cache.current.time||adjacent(cache.current,current),completeHistory:series.every((bars,index)=>bars.length>=Math.min(historyCount,historyState.counts[index])&&Math.min(historyCount,historyState.counts[index])>=minBars),closedUnchanged:incoming.every((bars,index)=>bars.every(bar=>!bar||!series[index].some(known=>known.time===bar.time&&!equalClosed(known,bar)))),noMissingClosedRows:incoming.every((bars,index)=>{const next=bars[0],last=series[index].at(-1);return next&&last&&(next.time===last.time||adjacent(last,next));}),sameRetainedFrame:seqDelta!==0||equalClosed(cache.current,current)&&cache.current.closed===current.closed};
    if(Object.values(checks).every(Boolean)){bootstrapHistory=structuredClone(seed);reusedContext=cache;}else discardRetained('CONTEXT_REJECTED:'+Object.keys(checks).filter(key=>!checks[key]).join(','));
  }
  let seedRows=[[],[],[]],discardedCachedSeed=null;
  if(bootstrapHistory&&!suppliedBootstrapHistory&&raw.ARROW2_PROTOCOL===3
    &&shared.bootstrapHistoryVerifiedRun===bootstrapHistory.runId&&shared.bootstrapHistoryVerifiedSourceAt===bootstrapHistory.sourceEmittedAt
    &&Number.isSafeInteger(bootstrapHistory.runEpoch)&&bootstrap.runEpoch>bootstrapHistory.runEpoch&&bootstrap.runId!==bootstrapHistory.runId&&sourceAt>=bootstrapHistory.sourceEmittedAt){
    // A new native run cannot inherit a prior run's verified history. Discard
    // only our cached seed; explicitly supplied invalid seeds still fail below.
    discardedCachedSeed={previousRunId:bootstrapHistory.runId,previousRunEpoch:bootstrapHistory.runEpoch,previousSeedSourceAt:bootstrapHistory.sourceEmittedAt,nativeRunId:bootstrap.runId,nativeRunEpoch:bootstrap.runEpoch};
    bootstrapHistory=null;shared.bootstrapHistory=null;shared.bootstrapHistoryVerifiedRun=null;shared.bootstrapHistoryVerifiedSourceAt=null;shared.contextRecovery=null;shared.pendingMessages?.clear();
  }
  if(bootstrapHistory){
    const seed=bootstrapHistory;
    if(raw.ARROW2_PROTOCOL!==3||seed.runEpoch!==bootstrap.runEpoch||seed.runId!==bootstrap.runId||!Number.isSafeInteger(seed.sourceEmittedAt)||seed.sourceEmittedAt>sourceAt||
      !seed.metadata||Object.keys(meta).some(key=>seed.metadata[key]!==meta[key])||!Array.isArray(seed.baseBars)||!Array.isArray(seed.higherTimeframes)||seed.higherTimeframes.length!==2){
      // A cached recovery belongs to exactly one provider run and symbol.
      // Revoke it immediately on a new binding, even before a replacement
      // historical seed can be collected or supplied.
      if(shared.contextRecovery){shared.contextRecovery=null;shared.pendingMessages.clear();shared.pendingResetReasons=['WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH'];shared.resetReported=!observationOnly;}
      return unavailable('WINDOW_BOOTSTRAP_HISTORY_IDENTITY_MISMATCH','UNAVAILABLE',{resetRequired:true,liveEligible:false});
    }
    seedRows=[seed.baseBars,...seed.higherTimeframes.map((entry,index)=>entry?.timeframe===bootstrap.higherTimeframes[index].timeframe&&entry.timeframeMs===bootstrap.higherTimeframes[index].timeframeMs?entry.bars:null)];
    const durations=[meta.timeframeMs,...bootstrap.higherTimeframes.map(entry=>entry.timeframeMs)];
    const cacheTrusted=!suppliedBootstrapHistory&&shared.bootstrapHistoryVerifiedRun===bootstrap.runId&&shared.bootstrapHistoryVerifiedSourceAt===seed.sourceEmittedAt;
    if(!cacheTrusted){
      if(seedRows.some((bars,index)=>!Array.isArray(bars)||bars.length>100||bars.some((bar,i)=>!bar||!Number.isSafeInteger(bar.time)||!Number.isSafeInteger(bar.closeTime)||bar.closeTime-bar.time!==durations[index]||bar.closeTime>seed.sourceEmittedAt||bar.closed!==true||bar.sourceClosed!==true||!Number.isSafeInteger(bar.providerBarIndex)||bar.providerBarIndex<0||bar.providerBarIndex*4+3>=scalarBase||typeof bar.sessionFirst!=='boolean'||typeof bar.sessionLast!=='boolean'||!['open','high','low','close'].every(key=>Number.isFinite(bar[key])&&Math.abs(bar[key]/meta.tickSize-Math.round(bar[key]/meta.tickSize))<=Math.max(1,Math.abs(bar[key]/meta.tickSize))*Number.EPSILON*32)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low||bar.volume!==null&&(!Number.isFinite(bar.volume)||bar.volume<0)||i>0&&!adjacent(bars[i-1],bar))))return unavailable('WINDOW_BOOTSTRAP_HISTORY_INVALID');
      shared.bootstrapHistory=structuredClone(seed);shared.bootstrapHistoryVerifiedRun=bootstrap.runId;shared.bootstrapHistoryVerifiedSourceAt=seed.sourceEmittedAt;
    }
  }
  if(chart.replay===true||raw.ARROW2_PROTOCOL===3&&(decoded.ARROW2_SUPPORTED&2)!==2){
    // Explicit Replay research may inspect these already validated rows. No
    // source packet or live eligibility is created; normal LIVE stays blocked.
    // Replay stepping may set Pine's realtime execution bit. The public Replay
    // control still wins. Cache only the metadata just verified above, so a
    // subsequent same-run nonmetadata Replay frame can be decoded read-only.
    if(chart.replay===true)shared.bootstrap=structuredClone(bootstrap);
    const replayContext=chart.replay===true?{historicalContext:{kind:'REPLAY_HISTORICAL_OHLC_CONTEXT',mode:'REPLAY',metadata:structuredClone(meta),current:structuredClone(current),previous:structuredClone(previous),higher:structuredClone(higher),liveEligible:false},
      replayWitness:{kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,pineRealtimeExecution:(decoded.ARROW2_SUPPORTED&2)===2,runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sequence,sourceEmittedAt:sourceAt,observedAt:observedAtWall,sourceObservedEpochMs:performance.timeOrigin+performance.now(),sourceDocumentTimeOrigin:performance.timeOrigin,checksumsVerified:true,metadata:structuredClone(meta),current:structuredClone(current),previous:structuredClone(previous),currentTime:current.time,currentCloseTime:current.closeTime,fields:Object.fromEntries(['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END','ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'].map(name=>[name,nodes.get(name).textContent]))}}:{};
    return unavailable('WINDOW_PRESESSION_CONTEXT_ONLY','WAITING',{bootstrapMetadata:structuredClone(bootstrap),contextReady:seedRows.every(bars=>bars.length>=minBars),contextOnly:true,liveEligible:false,frame:{sequence,sourceEmittedAt:sourceAt,runEpoch:bootstrap.runEpoch,coherent:true,realtime:false},...replayContext});
  }
  // Object insertion order is not source identity. Preserve every value/key,
  // including unknown metadata fields, while keeping timeframe array order.
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const liveSourceScope=researchLiveMultiChart?[pageUrl,liveLayoutName]:null;
  const identity=JSON.stringify(canonical([sessionId,bootstrap.runEpoch,bootstrap.runId,meta,bootstrap.higherTimeframes,minBars,historyCount,liveSourceScope]));
  let state=globalThis.__arrowWindowFeedV2;
  const freshState=()=>({...shared,identity,sessionId,liveSourceScope,bootstrap:structuredClone(bootstrap),readerMinBars:minBars,readerHistoryCount:historyCount,primeSequence:sequence,primeSourceAt:sourceAt,primeCurrentTime:current.time,lastSequence:null,lastSourceAt:null,lastObservedAt:observedAtWall,acceptedFrames:0,pendingMessages:new Map(),pendingResetReasons:[],resetReported:false,latestEvidence:null,contextRecovery:null,series:[0,1,2].map(index=>({bars:seedRows[index].map(bar=>({...structuredClone(bar),firstObservedSourceAt:bootstrapHistory.sourceEmittedAt,firstObservedDomEpoch:null,preSessionBootstrap:true})),snapshotSent:false,lastSnapshotRevision:-1,revision:seedRows[index].length,invalidReason:null})),lastFrame:null});
  const seriesSummary=(series,binding=bootstrap)=>(series??[]).map((entry,index)=>({timeframe:index===0?binding.metadata.timeframe:binding.higherTimeframes[index-1].timeframe,retainedBars:entry.bars.length,firstProviderBarIndex:entry.bars[0]?.providerBarIndex??null,lastProviderBarIndex:entry.bars.at(-1)?.providerBarIndex??null,firstOpenTime:entry.bars[0]?.time??null,lastOpenTime:entry.bars.at(-1)?.time??null,snapshotSent:entry.snapshotSent,invalidReason:entry.invalidReason??null}));
  const bindingChanges=prior=>{
    if(!prior?.bootstrap)return [];
    const changes=[],keys=['source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'];
    for(const key of keys)if(prior.bootstrap.metadata?.[key]!==meta[key])changes.push('metadata.'+key);
    const extras=value=>Object.fromEntries(Object.entries(value??{}).filter(([key])=>!keys.includes(key)));
    if(JSON.stringify(canonical(extras(prior.bootstrap.metadata)))!==JSON.stringify(canonical(extras(meta))))changes.push('metadata.additionalFields');
    for(const key of ['runEpoch','runId'])if(prior.bootstrap[key]!==bootstrap[key])changes.push(key);
    for(let index=0;index<2;index++){
      const before=prior.bootstrap.higherTimeframes?.[index],after=bootstrap.higherTimeframes[index];
      for(const key of ['timeframe','timeframeMs'])if(before?.[key]!==after[key])changes.push('higherTimeframes['+index+'].'+key);
      const rest=value=>Object.fromEntries(Object.entries(value??{}).filter(([key])=>!['timeframe','timeframeMs'].includes(key)));
      if(JSON.stringify(canonical(rest(before)))!==JSON.stringify(canonical(rest(after))))changes.push('higherTimeframes['+index+'].additionalFields');
    }
    if(prior.readerMinBars!==minBars)changes.push('minBars');if(prior.readerHistoryCount!==historyCount)changes.push('historyCount');if(JSON.stringify(prior.liveSourceScope??null)!==JSON.stringify(liveSourceScope))changes.push('liveSourceScope');return changes;
  };
  const recordContinuity=(target,action,details={})=>{const ledger=Array.isArray(target.continuityDecisions)?[...target.continuityDecisions]:[];ledger.push({action,sequence,sourceEmittedAt:sourceAt,observedAt:observedAtWall,runId:bootstrap.runId,...details});target.continuityDecisions=ledger.slice(-16);};
  const windowFrame={sequence,sourceEmittedAt:sourceAt,runEpoch:bootstrap.runEpoch,historySlot:historyState.slot,historyCounts:historyState.counts,coherent:true,checksumsVerified:true,realtime:(decoded.ARROW2_SUPPORTED&2)===2,current,previous,higher};
  // Data Window can briefly replay a previously coherent frame while the
  // cursor hovers over an older bar. Preserve a healthy same-run baseline;
  // the next genuine frame still goes through every normal gap/stale check.
  if(!reset&&state?.identity===identity&&state.series?.[0]?.snapshotSent===true&&state.lastSequence!==null&&sequence<state.lastSequence&&sourceAt<=state.lastSourceAt&&current.time<=state.lastFrame?.current?.time)return unavailable('WINDOW_LAST_BAR_REQUIRED');
  if(!observationOnly&&allowResearchLiveMultiChart&&liveLayoutName&&meta.instrument==='CME_MINI:NQ1!'&&meta.timeframe==='1'&&meta.tickSize===.25&&
    chart.documentVisible===true&&chart.marketOpen===true&&chart.realtime!==false&&windowFrame.realtime){
    const title=/^(?:Roi BRR|Roi \| 5M Break \+ 1M Retest & Rejection) v1\.2(?:\s|\(|$)/;
    const strategies=studyRows.filter(row=>visible(row)&&Array.from(row.querySelectorAll('span[title], :scope > div[class*="header-"] > span[class*="headerTitle-"]'))
      .some(header=>[header.getAttribute('title'),header.textContent].some(value=>title.test((value??'').trim()))));
    roiBrrStatus=strategies.length===0?'NOT_INSTALLED':strategies.length===1?'WAITING_FIELDS':'MULTIPLE_STUDIES';
    if(strategies.length===1){
      const fields=new Map();
      for(const label of strategies[0].querySelectorAll('[data-test-id-value-title^="ARROW_BRR_"]')){
        const key=label.getAttribute('data-test-id-value-title'),parent=label.parentElement;
        const rawValue=(parent?.children[1]?.textContent??'').trim().replace(/^\u2212/,'-');
        if(fields.has(key)||parent?.children.length!==2||parent.children[0]!==label||!/^-?(?:\d{1,16}|\d{1,3}(?:,\d{3}){1,5})$/.test(rawValue)){fields.clear();break;}
        fields.set(key,Number(rawValue.replaceAll(',','')));
      }
      const [protocol,closeTime,side,priceTicks,check]=['PROTOCOL','READY_CLOSE','READY_SIDE','READY_PRICE_TICKS','READY_CHECK'].map(field=>fields.get('ARROW_BRR_'+field));
      const checksum=((closeTime%1000000007)*131+(side+1)*17+priceTicks)%1000000007;
      const closed=current.closed?current:previous;
      if(fields.size===5&&protocol===1&&[closeTime,side,priceTicks,check].every(Number.isSafeInteger)&&check===checksum){
        roiBrrStatus='WAITING_READY';
        if(closed&&closeTime===closed.closeTime&&[1,-1].includes(side)&&priceTicks>0&&priceTicks===closed.close/.25&&closeTime<=sourceAt&&sourceAt-closeTime<=15000){
          roiBrr={kind:'ROI_BRR_LIVE_READY_V1',sessionId,runId:bootstrap.runId,sourceUrl:pageUrl,closeTime,direction:side===1?'LONG':'SHORT',priceTicks,observedAtWall,sourceEmittedAt:sourceAt};
          globalThis[roiBrrKey]=Object.freeze({...roiBrr,documentTimeOrigin:performance.timeOrigin});roiBrrStatus='READY';
        }
      }
    }
  }
  // This stamp can be produced only inside our leased, owned observer after
  // validating the complete public numeric frame. Polling a retained packet
  // never creates or refreshes a clock sample. Prices and raw Pine timestamps
  // alone therefore cannot authorize a receiver/source clock correlation.
  if(observationOnly&&shared.inObserverCallback===true&&chart.documentVisible===true&&document.hidden!==true&&chart.replay===false&&chart.marketOpen===true&&chart.realtime!==false&&windowFrame.realtime&&sourceAt>=current.time&&sourceAt-current.closeTime<=15000){
    const witnesses=Array.isArray(shared.clockWitnesses)?shared.clockWitnesses:[],last=witnesses.at(-1);
    if(!last||last.runId!==bootstrap.runId||last.sequence!==sequence||last.sourceEmittedAt!==sourceAt){
      const clockObservedAtWall=Date.now(),clockObservedAtPerfEpoch=performance.timeOrigin+performance.now();
      const witness={kind:'OWNED_WINDOW_CLOCK_OBSERVATION_V1',sessionId,runId:bootstrap.runId,runEpoch:bootstrap.runEpoch,sequence,sourceEmittedAt:sourceAt,observedAtWall:clockObservedAtWall,observedAtPerfEpoch:clockObservedAtPerfEpoch,sourceDocumentTimeOrigin:performance.timeOrigin,observedByMutationObserver:true,checksumsVerified:true,documentVisible:true,replay:false,marketOpen:true,realtime:true,metadata:structuredClone(meta),currentTime:current.time,currentCloseTime:current.closeTime,currentClosed:current.closed};
      shared.clockWitnesses=[...witnesses,witness].slice(-8);
    }
  }

  if(reset||!state||state.identity!==identity){const changed=!!state?.identity&&state.identity!==identity,beforeSeries=seriesSummary(state?.series,state?.bootstrap??bootstrap),beforeRunId=state?.bootstrap?.runId??null,semanticBindingChanges=bindingChanges(state);state=freshState();if(changed)state.pendingResetReasons=['WINDOW_SOURCE_CHANGED'];globalThis.__arrowWindowFeedV2=state;if(discardedCachedSeed)recordContinuity(state,'VERIFIED_BOOTSTRAP_DISCARDED_FOR_NEW_NATIVE_RUN',discardedCachedSeed);if(retainedRejection)recordContinuity(state,'RETAINED_NATIVE_CONTEXT_REJECTED',{reason:retainedRejection});recordContinuity(state,'COHERENCE_PRIME',{changedIdentity:changed,resetRequested:reset,beforeRunId,semanticBindingChanges,beforeSeries,afterSeries:seriesSummary(state.series)});
    if(reusedContext){
      state.lastSequence=sequence;state.lastSourceAt=sourceAt;state.lastFrame=windowFrame;state.contextRecovery={baselineSequence:sequence,baselineSourceAt:sourceAt,contextObservedAt:observedAtWall,freshFrames:0,lastFreshSequence:sequence,lastFreshSourceAt:sourceAt};
      const publicRow=bar=>Object.fromEntries(['time','closeTime','open','high','low','close','volume','closed','sourceClosed','providerBarIndex','sessionFirst','sessionLast'].map(key=>[key,bar[key]]));
      const contextPacket=(kind,slot,bars,entry)=>{const packet={schemaVersion:1,kind,runId:bootstrap.runId,sequence:sequence*8+slot,sourceEmittedAt:sourceAt,realtime:false,dataDelayUnverified:true,bootstrapOnly:true,metadata:{...structuredClone(meta),sessionGaps:gapsFor(seedRows[0])},bars:bars.map(publicRow),reasonCodes:['WINDOW_RETAINED_NATIVE_CONTEXT_ONLY'],...(entry?{higherTimeframes:[entry]}:{})},raw='ARROW_OHLC_V1 '+JSON.stringify(packet);state.pendingMessages.set(kind+(entry?':'+entry.timeframe:''),{raw,sequence:packet.sequence,observation:{id:packet.runId+':'+packet.sequence,sourceSequence:sequence,firstCoherentDomEpoch:null,observedByMutationObserver:false,visibleDomObservation:false}});};
      contextPacket('snapshot',1,seedRows[0]);bootstrap.higherTimeframes.forEach((entry,index)=>contextPacket('timeframe_snapshot',index+2,[],{...entry,bars:seedRows[index+1].map(publicRow),reasonCodes:[],sessionGaps:gapsFor(seedRows[index+1])}));
      recordContinuity(state,'RETAINED_NATIVE_CONTEXT_PUBLISHED',{previousSessionId:reusedContext.ownerSessionId,baselineSequence:sequence,baselineSourceAt:sourceAt,requiredFreshFrames:2,liveEligible:false});
      const output=unavailable('WINDOW_RETAINED_NATIVE_CONTEXT_ONLY','OK',{frame:windowFrame,windowFrame,bootstrapMetadata:structuredClone(bootstrap),messages:[...state.pendingMessages.values()].map(item=>item.raw),resetRequired:true,contextOnly:true,liveEligible:false,recovery:structuredClone(state.contextRecovery),history:state.series.map(item=>({retainedBars:item.bars.length,snapshotSent:false}))});state.latestEvidence=output;return output;
    }
    return unavailable('WINDOW_COHERENCE_PRIMING','WAITING',{frame:windowFrame,windowFrame,bootstrapMetadata:bootstrapMetadata??structuredClone(bootstrap),resetRequired:true,history:state.series.map(item=>({retainedBars:item.bars.length}))});}
  const prior=state.lastSequence??state.primeSequence,delta=sequence-prior;
  if(delta===0){
    // The receiver can acknowledge a reset only after an observer has already
    // seen the whole short source burst. Requiring yet another mutation just
    // to send its retained history left sparse sources stuck forever. Publish
    // that history as explicitly non-live context, never as an update, and
    // demand a genuinely new coherent pair before establishing a live baseline.
    const sameBar=(a,b)=>a===null&&b===null||!!a&&!!b&&['time','closeTime','open','high','low','close','volume','closed','sourceClosed','providerBarIndex','sessionFirst','sessionLast'].every(key=>a[key]===b[key]);
    const sameFrame=state.lastFrame&&sourceAt===state.lastSourceAt&&sameBar(current,state.lastFrame.current)&&sameBar(previous,state.lastFrame.previous)&&higher.every((bar,index)=>sameBar(bar,state.lastFrame.higher[index]));
    if(acknowledgedBenignRecovery&&state.acceptedFrames>0&&sameFrame&&state.series.every(series=>!series.invalidReason)){
      const suffix=index=>{const bars=state.series[index].bars;let first=bars.length-1;while(first>0&&adjacent(bars[first-1],bars[first]))first--;return bars.slice(Math.max(0,first));};
      const publicBar=bar=>Object.fromEntries(['time','closeTime','open','high','low','close','volume','closed','sourceClosed','providerBarIndex','sessionFirst','sessionLast'].filter(key=>bar[key]!==undefined).map(key=>[key,bar[key]]));
      state.pendingMessages.clear();
      const metadata={...structuredClone(meta),...(raw.ARROW2_PROTOCOL===3?{sessionGaps:gapsFor(suffix(0))}:{})};
      const emitContext=(kind,slot,bars=[],entry)=>{const packet={schemaVersion:1,kind,runId:bootstrap.runId,sequence:sequence*8+slot,sourceEmittedAt:sourceAt,realtime:false,dataDelayUnverified:true,bootstrapOnly:true,metadata,bars:bars.map(publicBar),reasonCodes:['WINDOW_RECOVERY_CONTEXT_ONLY'],...(entry?{higherTimeframes:[entry]}:{})};state.pendingMessages.set(kind+(entry?':'+entry.timeframe:''),{raw:'ARROW_OHLC_V1 '+JSON.stringify(packet),sequence:packet.sequence,observation:{id:packet.runId+':'+packet.sequence,sourceSequence:sequence,firstCoherentDomEpoch:null,observedByMutationObserver:false,visibleDomObservation:false}});};
      const base=suffix(0),target=Math.min(historyCount,historyState.counts[0]);
      if(target>=minBars&&base.length>=target)emitContext('snapshot',1,base);
      for(let index=0;index<2;index++){const bars=suffix(index+1),entry=bootstrap.higherTimeframes[index],target=Math.min(historyCount,historyState.counts[index+1]);if(target>=minBars&&bars.length>=target)emitContext('timeframe_snapshot',index+2,[],{...entry,bars:bars.map(publicBar),reasonCodes:[],...(raw.ARROW2_PROTOCOL===3?{sessionGaps:gapsFor(bars)}:{})});}
      state.contextRecovery={baselineSequence:sequence,baselineSourceAt:sourceAt,contextObservedAt:observedAtWall,freshFrames:0,lastFreshSequence:sequence,lastFreshSourceAt:sourceAt};
      recordContinuity(state,'RECOVERY_CONTEXT_PUBLISHED',{baselineSequence:sequence,baselineSourceAt:sourceAt,contextObservedAt:observedAtWall,liveEligible:false,requiredFreshFrames:2,contextPackets:state.pendingMessages.size});
    }
    const sourceDomTiming=rpcSourceDomTiming;
    const pending=state.pendingResetReasons?.length>0;if(pending&&!observationOnly)state.resetReported=true;
    const retained=[...state.pendingMessages.values()].filter(item=>afterRunId!==bootstrap.runId||item.sequence>afterSequence).sort((a,b)=>a.sequence-b.sequence);
    const cached=state.latestEvidence??{},context=state.contextRecovery?{contextOnly:true,liveEligible:false,recovery:structuredClone(state.contextRecovery)}:{};return {...cached,...unavailable('NO_FRESH_SOURCE_PACKET','OK'),reasonCodes:[...(state.pendingResetReasons??[]),'NO_FRESH_SOURCE_PACKET',...(state.contextRecovery?['WINDOW_RECOVERY_WAITING_FRESH_FRAMES']:[])],resetRequired:pending,frame:state.lastFrame??windowFrame,windowFrame,bootstrapMetadata:structuredClone(state.bootstrap),messages:pending?[]:retained.map(item=>item.raw),packetObservations:pending?[]:retained.map(item=>item.observation),sourceDomTiming,...context};
  }
  const equal=(a,b)=>['time','closeTime','open','high','low','close','volume','providerBarIndex','sessionFirst','sessionLast'].every(key=>a[key]===b[key]);
  const sourceReference=state.lastSourceAt??state.primeSourceAt??null,currentReference=state.lastFrame?.current?.time??state.primeCurrentTime??null;
  const inactive=observedAtWall-state.lastObservedAt>15000,clockRegressed=sourceReference!==null&&sourceAt<sourceReference;
  if(delta<0||delta>=4096||inactive||clockRegressed){
    // Quiet instruments still need a new coherent pair before any delivery.
    // Inactivity alone does not invalidate already verified closed history.
    // A conflicting current frame, pending fault, rollback or large sequence
    // gap takes the original discard path; no new rows are accepted here.
    const incoming=[[previous,...(current.closed?[current]:[]),...(!metadataFrame?[historical[0]]:[])],...higher.map((bar,index)=>[bar,...(!metadataFrame?[historical[index+1]]:[])])];
    const preserveChecks={inactivityOnly:inactive,forwardBoundedSequence:delta>0&&delta<4096,clockNotRegressed:!clockRegressed,sourceStrictlyAdvanced:Number.isSafeInteger(sourceReference)&&sourceAt>sourceReference,currentNotRegressed:Number.isSafeInteger(currentReference)&&current.time>=currentReference,
      onlyBenignReprimePending:(state.pendingResetReasons??[]).every(reason=>reason==='WINDOW_COHERENCE_REPRIMING'),noInvalidSeries:state.series.every(series=>!series.invalidReason),currentAdjacent:!previous||adjacent(previous,current),historyRowsPresent:metadataFrame||historical.every((bar,index)=>historyState.slot>=historyState.counts[index]||bar!==null),
      observedClosedUnchanged:incoming.every((bars,index)=>bars.every(bar=>{if(!bar)return true;const known=state.series[index].bars.find(item=>item.time===bar.time);return !known||equal(known,bar);} ))};
    const preserve=Object.values(preserveChecks).every(Boolean),beforeSeries=seriesSummary(state.series),pendingReasonsBefore=[...(state.pendingResetReasons??[])];
    const retained=preserve?state.series.map(series=>({...series,bars:series.bars.map(bar=>structuredClone(bar)),snapshotSent:false,lastSnapshotRevision:-1})):null;
    const contextRecovery=preserve&&state.contextRecovery?{...state.contextRecovery,freshFrames:1,lastFreshSequence:sequence,lastFreshSourceAt:sourceAt}:null;
    state=freshState();if(retained)state.series=retained;
    state.contextRecovery=contextRecovery;state.pendingResetReasons=contextRecovery?[]:['WINDOW_COHERENCE_REPRIMING'];if(!observationOnly&&!contextRecovery)state.resetReported=true;globalThis.__arrowWindowFeedV2=state;
    recordContinuity(state,'COHERENCE_REPRIME',{delta,inactive,sourceReference,currentReference,preserve,preserveChecks,failedPreserveChecks:Object.keys(preserveChecks).filter(key=>!preserveChecks[key]),pendingReasonsBefore,beforeSeries,afterSeries:seriesSummary(state.series)});
    return unavailable(contextRecovery?'WINDOW_RECOVERY_WAITING_FRESH_FRAMES':'WINDOW_COHERENCE_REPRIMING','WAITING',{frame:windowFrame,windowFrame,resetRequired:!contextRecovery,bootstrapMetadata:bootstrapMetadata??structuredClone(bootstrap),...(contextRecovery?{contextOnly:true,liveEligible:false,recovery:structuredClone(contextRecovery)}:{})});
  }
  state.lastSequence=sequence;state.lastSourceAt=sourceAt;state.lastObservedAt=observedAtWall;state.acceptedFrames++;
  const reasons=[],messages=[];
  const put=(index,bar)=>{
    if(!bar)return;const series=state.series[index],existing=series.bars.find(item=>item.time===bar.time);
    if(existing&&!equal(existing,bar)){const beforeSeries=seriesSummary(state.series);series.bars=[];series.snapshotSent=false;series.invalidReason='WINDOW_CLOSED_BAR_CORRECTION';state.bootstrapHistory=null;bootstrapHistory=null;reasons.push(series.invalidReason);recordContinuity(state,'CLOSED_BAR_CORRECTION',{seriesIndex:index,providerBarIndex:bar.providerBarIndex??null,barTime:bar.time,beforeSeries,afterSeries:seriesSummary(state.series)});}
    if(!existing||series.invalidReason){series.bars.push({...bar,firstObservedSourceAt:sourceAt,firstObservedDomEpoch:performance.timeOrigin+performance.now()});series.bars.sort((a,b)=>a.time-b.time);series.bars=series.bars.slice(-historyCount);series.revision++;series.invalidReason=null;}
  };
  put(0,previous);if(current.closed)put(0,current);higher.forEach((bar,index)=>put(index+1,bar));
  if(!metadataFrame)historical.forEach((bar,index)=>{
    if(historyState.slot<historyState.counts[index]&&!bar){const series=state.series[index],beforeSeries=seriesSummary(state.series);series.bars=[];series.snapshotSent=false;series.invalidReason='WINDOW_HISTORY_ROW_UNAVAILABLE';reasons.push(series.invalidReason);recordContinuity(state,'HISTORY_ROW_UNAVAILABLE',{seriesIndex:index,historySlot:historyState.slot,beforeSeries,afterSeries:seriesSummary(state.series)});}
    else put(index,bar);
  });
  if(previous&&!adjacent(previous,current)){const beforeSeries=seriesSummary(state.series);state.series[0].bars=state.series[0].bars.filter(bar=>bar.time>=current.time);state.series[0].snapshotSent=false;reasons.push('WINDOW_CURRENT_BASE_GAP');recordContinuity(state,'CURRENT_BASE_GAP',{beforeSeries,afterSeries:seriesSummary(state.series)});}
  state.pendingResetReasons=[...new Set([...(state.pendingResetReasons??[]),...reasons.filter(reason=>['WINDOW_CLOSED_BAR_CORRECTION','WINDOW_HISTORY_ROW_UNAVAILABLE','WINDOW_CURRENT_BASE_GAP'].includes(reason))])];
  const resetRequired=state.pendingResetReasons.length>0;reasons.push(...state.pendingResetReasons);if(resetRequired&&!observationOnly)state.resetReported=true;
  if(resetRequired){state.pendingMessages.clear();state.contextRecovery=null;}
  const suffix=index=>{const bars=state.series[index].bars;let start=bars.length-1;while(start>0&&adjacent(bars[start-1],bars[start]))start--;return bars.slice(Math.max(0,start));};
  const publicBar=bar=>Object.fromEntries(['time','closeTime','open','high','low','close','volume','closed','sourceClosed','providerBarIndex','sessionFirst','sessionLast'].filter(key=>bar[key]!==undefined).map(key=>[key,bar[key]]));
  const envelope=(kind,slot,bars=[],entry)=>({schemaVersion:1,kind,runId:bootstrap.runId,sequence:sequence*8+slot,sourceEmittedAt:sourceAt,realtime:windowFrame.realtime,dataDelayUnverified:true,metadata:{...structuredClone(meta),...(raw.ARROW2_PROTOCOL===3?{sessionGaps:gapsFor([...suffix(0),...(!current.closed?[current]:[])])}:{})},bars:bars.map(publicBar),reasonCodes:[],...(entry?{higherTimeframes:[{...entry,...(raw.ARROW2_PROTOCOL===3?{sessionGaps:gapsFor(suffix(bootstrap.higherTimeframes.findIndex(item=>item.timeframe===entry.timeframe)+1))}:{})}]}:{})});
  const emit=packet=>{
    const raw='ARROW_OHLC_V1 '+JSON.stringify(packet),id=packet.runId+':'+packet.sequence,key=packet.kind+(packet.higherTimeframes?':'+packet.higherTimeframes[0].timeframe:'');messages.push(raw);
    const visibleObservation=observationOnly&&document.visibilityState==='visible';
    const observation={id,sourceSequence:sequence,firstCoherentDomEpoch:visibleObservation?performance.timeOrigin+performance.now():null,observedByMutationObserver:observationOnly,visibleDomObservation:visibleObservation};state.pendingMessages.set(key,{raw,sequence:packet.sequence,observation});
    if(observationOnly)try{globalThis.__arrowSourceDomTimingV1?.recordWindowPacket?.(id,{initial:packet.kind!=='update'||state.acceptedFrames===1,transport:'PUBLIC_DATA_WINDOW_V2',sourceSequence:sequence});}catch{}
  };
  const base=suffix(0),baseState=state.series[0];
  if(state.contextRecovery){
    const recovery=state.contextRecovery;
    if(sequence>recovery.lastFreshSequence&&sourceAt>recovery.lastFreshSourceAt){recovery.freshFrames++;recovery.lastFreshSequence=sequence;recovery.lastFreshSourceAt=sourceAt;}
    state.lastFrame=windowFrame;
    if(recovery.freshFrames<2){
      const output=unavailable('WINDOW_RECOVERY_WAITING_FRESH_FRAMES','WAITING',{frame:windowFrame,windowFrame,resetRequired:false,bootstrapMetadata:structuredClone(bootstrap),contextOnly:true,liveEligible:false,recovery:structuredClone(recovery),history:state.series.map((series,index)=>({timeframe:index===0?meta.timeframe:bootstrap.higherTimeframes[index-1].timeframe,retainedBars:series.bars.length,contiguousBars:suffix(index).length,snapshotSent:false}))});state.latestEvidence=output;return output;
    }
    state.pendingMessages.clear();for(const series of state.series){series.snapshotSent=false;series.lastSnapshotRevision=-1;}
    recordContinuity(state,'RECOVERY_FRESH_PAIR_VERIFIED',{baselineSequence:recovery.baselineSequence,baselineSourceAt:recovery.baselineSourceAt,contextObservedAt:recovery.contextObservedAt,freshFrames:recovery.freshFrames,newBaselineSourceAt:sourceAt});state.contextRecovery=null;
  }
  const needBaseSnapshot=needsSnapshot||!baseState.snapshotSent;
  const baseTarget=Math.min(historyCount,historyState.counts[0]);
  if(!resetRequired&&needBaseSnapshot&&baseTarget>=minBars&&base.length>=baseTarget){emit(envelope('snapshot',1,base));baseState.snapshotSent=true;baseState.lastSnapshotRevision=baseState.revision;}
  for(let index=0;index<2;index++){
    const entry=bootstrap.higherTimeframes[index],series=state.series[index+1],bars=suffix(index+1),supported=Number.isSafeInteger(entry.timeframeMs)&&entry.timeframeMs>meta.timeframeMs&&bootstrap.higherTimeframes.findIndex(item=>item.timeframe===entry.timeframe)===index;
    const target=Math.min(historyCount,historyState.counts[index+1]);
    if(!resetRequired&&supported&&target>=minBars&&bars.length>=target&&(needsSnapshot||!series.snapshotSent||series.revision!==series.lastSnapshotRevision)){
      emit(envelope('timeframe_snapshot',index+2,[],{timeframe:entry.timeframe,timeframeMs:entry.timeframeMs,bars:bars.map(publicBar),reasonCodes:[]}));series.snapshotSent=true;series.lastSnapshotRevision=series.revision;
    }
  }
  // Repeat the provider's latest closed row on each fresh coherent frame. A
  // receiver which missed the boundary can still verify its final OHLC.
  if(!resetRequired&&windowFrame.realtime&&baseState.snapshotSent){emit(envelope('update',4,[...(previous?[previous]:[]),current]));
    for(let index=0;index<2;index++){const entry=bootstrap.higherTimeframes[index];if(higher[index]&&state.series[index+1].snapshotSent)emit(envelope('timeframe_update',index+5,[],{timeframe:entry.timeframe,timeframeMs:entry.timeframeMs,bars:[publicBar(higher[index])],reasonCodes:[]}));}
  }
  state.lastFrame=windowFrame;
  if(raw.ARROW2_PROTOCOL===3&&!resetRequired&&!state.contextRecovery&&state.series.every((series,index)=>series.snapshotSent&&!series.invalidReason&&suffix(index).length>=Math.max(minBars,Math.min(historyCount,historyState.counts[index])))){
    const cached=globalThis[retainedKey],revisionKey=state.series.map(series=>series.revision).join(','),reuseSeed=cached?.ownerSessionId===sessionId&&cached.bootstrap.runId===bootstrap.runId&&cached.revisionKey===revisionKey;
    const seed=reuseSeed?cached.seed:{runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:sourceAt,metadata:structuredClone(meta),baseBars:suffix(0).map(publicBar),higherTimeframes:bootstrap.higherTimeframes.map((entry,index)=>({...entry,bars:suffix(index+1).map(publicBar),sessionGaps:gapsFor(suffix(index+1)),reasonCodes:[]}))};
    globalThis[retainedKey]={kind:'VERIFIED_NATIVE_WINDOW_CONTEXT_V1',document,sourceDocumentTimeOrigin:performance.timeOrigin,sourceUrl:pageUrl,observedAtPerformance:performance.now(),ownerSessionId:sessionId,bootstrap:reuseSeed?cached.bootstrap:structuredClone(bootstrap),seed,revisionKey,sequence,sourceEmittedAt:sourceAt,current:structuredClone(current)};
  }else if(resetRequired)discardRetained('SOURCE_RESET_REQUIRED');
  const history=state.series.map((series,index)=>({timeframe:index===0?meta.timeframe:bootstrap.higherTimeframes[index-1].timeframe,retainedBars:series.bars.length,contiguousBars:suffix(index).length,snapshotSent:series.snapshotSent,reasonCodes:series.invalidReason?[series.invalidReason]:[],firstObservations:series.bars.map(bar=>({time:bar.time,firstObservedSourceAt:bar.firstObservedSourceAt,firstObservedDomEpoch:bar.firstObservedDomEpoch}))}));
  if(!baseState.snapshotSent)reasons.push('WINDOW_HISTORY_WARMUP');
  const sourceDomTiming=rpcSourceDomTiming;
  const output={status:'OK',reasonCodes:[...new Set(reasons)],messages,chart,observedAtWall,readMs:performance.now()-started,transport:'PUBLIC_DATA_WINDOW_V2',frame:state.lastFrame,windowFrame,bootstrapMetadata:bootstrapMetadata??structuredClone(state.bootstrap),resetRequired,history,sourceDomTiming,continuityDecisions:continuityEvidence(),clockWitnesses:clockEvidence(),roiBrr,roiBrrStatus,packetObservations:[...state.pendingMessages.values()].map(item=>item.observation),availabilityPolicy:'SNAPSHOTS_BECOME_AVAILABLE_AT_CURRENT_COHERENT_OBSERVATION;PER_ROW_FIRST_OBSERVATIONS_RETAINED_SEPARATELY'};
  state.latestEvidence=output;return output;
}
