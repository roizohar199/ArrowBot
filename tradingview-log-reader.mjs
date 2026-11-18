// Read the rendered Pine Logs/toolbar DOM. This is our versioned UI
// adapter, not a TradingView data API. No chart globals, network sockets,
// account/order data or keyboard commands are accessed.
export function readPineLogsEvidence({followLatest=false,bootstrapOnly=false,allowResearchLiveMultiChart=false}={}){
  const observedAtWall=Date.now(),started=performance.now(),prefix='ARROW_OHLC_V1';
  const unavailable=reason=>({status:'UNAVAILABLE',reasonCodes:[reason],messages:[],chart:null,observedAtWall});
  if(typeof bootstrapOnly!=='boolean'||typeof allowResearchLiveMultiChart!=='boolean')return unavailable('PINE_LOG_READER_CONFIGURATION_INVALID');
  const detachedBootstrap=bootstrapOnly&&location.pathname==='/pine/';
  if(location.protocol!=='https:'||!(location.hostname==='tradingview.com'||location.hostname.endsWith('.tradingview.com'))||!location.pathname.startsWith('/chart/')&&!detachedBootstrap)return unavailable('TRADINGVIEW_CHART_REQUIRED');
  const visible=node=>{if(!node?.getBoundingClientRect)return false;const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);};
  // Detached Logs are historical context only. The receiving page separately
  // verifies its selected chart and the Window reader still requires the exact
  // source generation. This public link badge never proves a live source.
  const editorLinked=detachedBootstrap&&Array.from(document.querySelectorAll('[title="Linked with chart, all is fine."]')).some(node=>visible(node)&&(node.textContent??'').trim()==='Linked');
  if(detachedBootstrap&&!editorLinked)return unavailable('DETACHED_EDITOR_LINK_REQUIRED');
  const canvases=Array.from(document.querySelectorAll('canvas[aria-label^="Chart for "]')).filter(visible);
  const labels=canvases.map(node=>node.getAttribute('aria-label')??'');
  const symbols=[...new Set(labels.map(label=>/^Chart for (.+), [^,]+$/.exec(label)?.[1]).filter(Boolean))];
  const selected=document.querySelector('#header-toolbar-intervals [aria-checked="true"]');
  const interval=selected?.getAttribute('data-value')??null;
  const replayNode=document.querySelector('#header-toolbar-replay'),replayAttribute=replayNode?.getAttribute('aria-pressed')??replayNode?.getAttribute('aria-checked');
  const replay=replayAttribute==='true'?true:replayAttribute==='false'?false:null;
  const series=Array.from(document.querySelectorAll('[data-qa-id="legend-series-item"]')).filter(visible);
  let researchLiveMultiChart=false,statuses=series.length===1?series[0].querySelector('[data-qa-id="legend-statuses-wrapper"]'):null;
  if(allowResearchLiveMultiChart&&!detachedBootstrap){
    const inViewport=node=>{
      if(document.visibilityState!=='visible'||document.hidden===true||!visible(node))return false;
      const r=node.getBoundingClientRect();if(![r.left,r.right,r.top,r.bottom].every(Number.isFinite))return false;
      let left=Math.max(0,r.left),right=Math.min(window.innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(window.innerHeight,r.bottom),ancestor=node,depth=0;
      if(right<=left||bottom<=top)return false;
      for(;ancestor&&depth<64;ancestor=ancestor.parentElement,depth++){
        const css=getComputedStyle(ancestor);if(css.display==='none'||['hidden','collapse'].includes(css.visibility)||css.contentVisibility==='hidden'||css.opacity!==undefined&&css.opacity!==''&&Number(css.opacity)===0)return false;
        const clipX=['auto','scroll','hidden','clip','overlay'].includes(css.overflowX??css.overflow),clipY=['auto','scroll','hidden','clip','overlay'].includes(css.overflowY??css.overflow);
        if(clipX||clipY){const box=ancestor.getBoundingClientRect(),x=box.left+(ancestor.clientLeft??0),y=box.top+(ancestor.clientTop??0);if(clipX){left=Math.max(left,x);right=Math.min(right,x+(ancestor.clientWidth??box.width));}if(clipY){top=Math.max(top,y);bottom=Math.min(bottom,y+(ancestor.clientHeight??box.height));}if(right<=left||bottom<=top)return false;}
      }
      return !ancestor;
    };
    const layouts=Array.from(document.querySelectorAll('button[aria-label*="Active layout: "]')).filter(inViewport),intervals=Array.from(document.querySelectorAll('#header-toolbar-intervals [aria-checked="true"]')).filter(inViewport),replays=Array.from(document.querySelectorAll('#header-toolbar-replay')).filter(inViewport),targets=canvases.filter(node=>node.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute');
    let exactUrl=false;try{const url=new URL(location.href);const name=url.pathname==='/chart/ARROWRV1/'?'Arrow OHLC Live Verification':url.pathname==='/chart/ARROWFR1/'?'Full Screens Live':null;exactUrl=url.protocol==='https:'&&['www.tradingview.com','tradingview.com'].includes(url.hostname)&&name!==null&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&layouts.length===1&&(layouts[0].getAttribute('aria-label')??'').replace(/\s+/g,' ').trim().endsWith('Active layout: '+name);}catch{}
    researchLiveMultiChart=exactUrl&&layouts.length===1
      &&canvases.length>=2&&canvases.length<=3&&canvases.every(node=>inViewport(node)&&/^Chart for CME_MINI:NQ1!, [^,]+$/.test(node.getAttribute('aria-label')??''))&&symbols.length===1&&symbols[0]==='CME_MINI:NQ1!'
      &&targets.length===1&&intervals.length===1&&intervals[0]===selected&&interval==='1'&&replays.length===1&&replays[0]===replayNode&&replay===false;
    if(researchLiveMultiChart){
      statuses=null;
      // The active one-minute pane owns its market-status evidence. A global
      // first legend could instead belong to the five-minute or second chart.
      for(let ancestor=targets[0].parentElement,depth=0;ancestor&&depth<32;ancestor=ancestor.parentElement,depth++){
        const charts=Array.from(ancestor.querySelectorAll('canvas[aria-label^="Chart for "]')).filter(visible);if(charts.length!==1||charts[0]!==targets[0])break;
        const legends=Array.from(ancestor.querySelectorAll('[data-qa-id="legend-series-item"]')).filter(inViewport);if(legends.length>1)break;
        if(legends.length===1){const own=Array.from(legends[0].querySelectorAll('[data-qa-id="legend-statuses-wrapper"]')).filter(inViewport);if(own.length===1)statuses=own[0];break;}
      }
      if(statuses===null)researchLiveMultiChart=false;
    }
  }
  const statusMarkup=statuses?.outerHTML??'',statusText=statuses?.textContent??'';
  const marketOpen=/marketStatusOpen-/.test(statusMarkup)?true:/marketStatusClose(?:d)?-/.test(statusMarkup)?false:null;
  const delayed=/dataModeDelayed|dataStatusDelayed|isDelayed|Data is delayed|Delayed data|End.of.day/i.test(statusMarkup+' '+statusText);
  const explicitRealtime=/dataModeRealtime|dataStatusRealtime|Real.time data|Data is real.time/i.test(statusMarkup+' '+statusText);
  // TradingView's official data coverage identifies BINANCE as realtime-only,
  // free (verified 2026-11-14). This narrow provider profile does not infer a
  // paid futures entitlement from the absence of a delayed badge.
  const knownRealtimeOnly=symbols.length===1&&symbols[0].startsWith('BINANCE:');
  const realtime=delayed?false:explicitRealtime||knownRealtimeOnly&&marketOpen===true&&statuses!==null?true:null;
  const chart=detachedBootstrap?null:{symbols,interval,replay,marketOpen,realtime,chartLabels:labels,visibleCharts:canvases.length,
    realtimeBasis:delayed?'EXPLICIT_DELAYED_DOM':explicitRealtime?'EXPLICIT_REALTIME_DOM':realtime===true?'BINANCE_REALTIME_ONLY_COVERAGE_2026_11_14':'UNVERIFIED',
    realtimeReference:knownRealtimeOnly?'https://www.tradingview.com/data-coverage/':null,documentVisible:document.visibilityState==='visible',
    ...(researchLiveMultiChart?{researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:canvases.length,targetCharts:1,selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',interval:'1',researchLayoutVerified:true,layoutName:new URL(location.href).pathname==='/chart/ARROWFR1/'?'Full Screens Live':'Arrow OHLC Live Verification',sourceMode:'LIVE',liveMultiChartExplicit:true,statusLegendScoped:statuses!==null}}:{})};
  const messages=[],seen=new Set(),followed=new Set(),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let node,visited=0,limited=false;
  function envelope(text){
    const marker=text.indexOf(prefix);if(marker<0)return null;
    const start=text.indexOf('{',marker+prefix.length);if(start<0)return null;
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<text.length&&i-start<=40960;i++){
      const char=text[i];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&--depth===0)return prefix+' '+text.slice(start,i+1);
    }
    return null;
  }
  while((node=walker.nextNode())){
    if(++visited>20000){limited=true;break;}
    if(!node.nodeValue?.includes(prefix))continue;
    let parent=node.parentElement;
    if(!parent||parent.closest('script,style,textarea,input,[contenteditable="true"],[role="textbox"],.monaco-editor')||!visible(parent))continue;
    // Pine Logs virtualizes its rows. Follow only the scroll container of our
    // own marked log, when the user enabled that visible monitoring option.
    // The chart viewport, editor, broker and unrelated panes are never scrolled.
    if(followLatest===true)for(let scroll=parent,depth=0;scroll&&depth<12;scroll=scroll.parentElement,depth++){
      if(scroll===document.body||scroll===document.documentElement)break;
      if(scroll.scrollHeight>scroll.clientHeight+10&&['auto','scroll'].includes(getComputedStyle(scroll).overflowY)){
        if(!followed.has(scroll)&&scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop>2){scroll.scrollTop=scroll.scrollHeight;followed.add(scroll);}break;
      }
    }
    let text=node.nodeValue,raw=envelope(text);
    for(let climb=0;!raw&&parent&&climb<3;climb++,parent=parent.parentElement){text=parent.textContent??'';if(text.length>100000)break;raw=envelope(text);}
    if(!raw||seen.has(raw))continue;
    seen.add(raw);messages.push(raw);
  }
  // Retain the warmup plus the newest visible messages. Callers deduplicate
  // per-run sequences; they must not turn an old log into a fresh heartbeat.
  const ordered=messages.flatMap(raw=>{try{const packet=JSON.parse(raw.slice(prefix.length).trim());return Number.isSafeInteger(packet.sequence)&&Number.isFinite(packet.sourceEmittedAt)?[{raw,...(bootstrapOnly?{packet}:{}),kind:packet.kind,runId:packet.runId,sequence:packet.sequence,sourceEmittedAt:packet.sourceEmittedAt,higherTimeframes:Array.isArray(packet.higherTimeframes)?packet.higherTimeframes.map(entry=>entry?.timeframe).filter(tf=>typeof tf==='string').slice(0,3):[]}]:[];}catch{return [];}}).sort((a,b)=>a.sourceEmittedAt-b.sourceEmittedAt||a.sequence-b.sequence);
  const runId=ordered.at(-1)?.runId,currentRun=ordered.filter(item=>item.runId===runId);
  if(bootstrapOnly){
    const result=(status,reasonCodes,retained=[])=>({status,reasonCodes,messages:retained,chart,sourceUrl:location.href,bootstrapLogsOnly:true,editorLinked,contextOnly:true,liveEligible:false,observedAtWall,readMs:performance.now()-started,visitedTextNodes:visited,followedLogContainers:followed.size,sourceDocumentVisible:document.visibilityState==='visible'});
    if(limited)return result('UNAVAILABLE',['DOM_SCAN_LIMIT']);
    if(!currentRun.length)return result('UNAVAILABLE',['PINE_LOGS_NOT_VISIBLE']);
    if(!detachedBootstrap&&canvases.length!==1&&!researchLiveMultiChart)return result('UNAVAILABLE',['SINGLE_VISIBLE_CHART_REQUIRED']);
    const closedRows=(bars,sourceAt)=>Array.isArray(bars)&&bars.length>0&&bars.length<=100&&bars.every(bar=>bar&&bar.closed===true&&bar.sourceClosed===true&&Number.isSafeInteger(bar.time)&&Number.isSafeInteger(bar.closeTime)&&bar.time<bar.closeTime&&bar.closeTime<=sourceAt&&Number.isSafeInteger(bar.providerBarIndex)&&bar.providerBarIndex>=0&&typeof bar.sessionFirst==='boolean'&&typeof bar.sessionLast==='boolean'&&['open','high','low','close'].every(key=>Number.isFinite(bar[key]))&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=bar.low&&(bar.volume===null||Number.isFinite(bar.volume)&&bar.volume>=0));
    const validPacket=({packet:p,raw})=>{
      if(raw.length>40974||p.schemaVersion!==1||p.bootstrapOnly!==true||p.realtime!==false||typeof p.runId!=='string'||!p.runId||p.runId.length>400||!Number.isSafeInteger(p.sourceEmittedAt)||p.sourceEmittedAt>observedAtWall||p.metadata?.source!=='ohlc'||p.metadata?.chartType!=='standard'||![1,2,3].includes(p.sequence))return false;
      return p.sequence===1?p.kind==='snapshot'&&closedRows(p.bars,p.sourceEmittedAt):p.kind==='timeframe_snapshot'&&Array.isArray(p.bars)&&p.bars.length===0&&Array.isArray(p.higherTimeframes)&&p.higherTimeframes.length===1&&closedRows(p.higherTimeframes[0]?.bars,p.sourceEmittedAt);
    };
    if(currentRun.length>3||new Set(currentRun.map(item=>item.sequence)).size!==currentRun.length||new Set(currentRun.map(item=>item.sourceEmittedAt)).size!==1||!currentRun.every(validPacket))return result('UNAVAILABLE',['BOOTSTRAP_LOG_PACKET_INVALID']);
    return result('OK',['HISTORICAL_BOOTSTRAP_NO_ALERT'],currentRun.map(item=>item.raw));
  }
  const warmups=new Map();
  let higherWarmups=0;
  for(const item of currentRun.slice().reverse()){
    if(item.kind==='snapshot'&&!warmups.has('base'))warmups.set('base',item);
    if(item.kind==='timeframe_snapshot')for(const tf of item.higherTimeframes){const key='higher:'+tf;if(!warmups.has(key)&&higherWarmups<3){warmups.set(key,item);higherWarmups++;}}
  }
  // Each provider timeframe needs its own bootstrap. A long intrabar tail must
  // not evict an otherwise still visible higher-timeframe warmup envelope.
  const retained=new Map();
  for(const item of [...warmups.values(),...currentRun.filter(item=>!['snapshot','timeframe_snapshot'].includes(item.kind)).slice(-64)])retained.set(item.runId+':'+item.sequence,item);
  const selectedMessages=[...retained.values()].sort((a,b)=>a.sourceEmittedAt-b.sourceEmittedAt||a.sequence-b.sequence).map(item=>item.raw);
  const reasonCodes=[...(messages.length?[]:['PINE_LOGS_NOT_VISIBLE']),...(limited?['DOM_SCAN_LIMIT']:[]),...(canvases.length!==1&&!researchLiveMultiChart?['SINGLE_VISIBLE_CHART_REQUIRED']:[]),...(replay===null?['REPLAY_STATUS_UNVERIFIED']:[]),...(marketOpen===false?['MARKET_CLOSED']:[]),...(realtime===null?['LIVE_STATUS_UNVERIFIED']:[])];
  // This optional object belongs to our extension's isolated source observer.
  // It contains first-DOM-appearance timestamps, never private chart state.
  let sourceDomTiming=null;try{sourceDomTiming=globalThis.__arrowSourceDomTimingV1?.read?.()??null;}catch{}
  return {status:messages.length&&(canvases.length===1||researchLiveMultiChart)&&!limited?'OK':'UNAVAILABLE',reasonCodes,messages:selectedMessages,chart,sourceUrl:location.href,observedAtWall,readMs:performance.now()-started,visitedTextNodes:visited,followedLogContainers:followed.size,sourceDomTiming};
}
