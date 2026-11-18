// Extension-owned, isolated-world instrumentation of rendered log messages.
// This does not observe TradingView internals or exchange/network timestamps.
export function sourceDomTimingCommand({action='install',sessionId=''}={}){
  const key='__arrowSourceDomTimingV1',existing=globalThis[key];
  if(action==='stop'){
    if(existing&&(!sessionId||existing.sessionId===sessionId)){existing.stop();delete globalThis[key];}
    return {status:'STOPPED'};
  }
  if(action==='read')return existing?.read?.()??{status:'UNAVAILABLE'};
  if(action!=='install'||typeof sessionId!=='string'||!sessionId||sessionId.length>200)return {status:'INVALID_COMMAND'};
  if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||!location.pathname.startsWith('/chart/'))return {status:'WRONG_PAGE'};
  existing?.stop?.();
  const prefix='ARROW_OHLC_V1',records=new Map(),epoch=()=>performance.timeOrigin+performance.now();
  let stopped=false,limited=0,callbacks=0,windowCallbacks=0,heartbeat=performance.now();
  const windowExcluded={};
  const limitReasons={};
  const hitLimit=reason=>{limited++;limitReasons[reason]=(limitReasons[reason]??0)+1;};
  function visible(node){
    if(document.visibilityState!=='visible')return false;
    const r=node?.getBoundingClientRect?.();if(!r||r.width<=0||r.height<=0)return false;
    let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    if(right<=left||bottom<=top)return false;
    let parent=node,depth=0;
    // A viewport rectangle alone misses invisible text in clipped log panes.
    // A bounded, conservative ancestor walk checks style and clip rectangles.
    // The observed TradingView Pine Logs text has 23 ancestors. Keep a fixed
    // bound above that real layout; 20 incorrectly excluded every live row.
    for(;parent&&depth<64;parent=parent.parentElement,depth++){
      const style=getComputedStyle(parent);
      if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.contentVisibility==='hidden'||style.opacity!==''&&Number(style.opacity)===0)return false;
      const clipX=['auto','scroll','hidden','clip','overlay'].includes(style.overflowX??style.overflow),clipY=['auto','scroll','hidden','clip','overlay'].includes(style.overflowY??style.overflow);
      if(clipX||clipY){
        const box=parent.getBoundingClientRect(),clipLeft=box.left+(parent.clientLeft??0),clipTop=box.top+(parent.clientTop??0);
        const clipRight=clipLeft+(parent.clientWidth??box.width),clipBottom=clipTop+(parent.clientHeight??box.height);
        if(clipX){left=Math.max(left,clipLeft);right=Math.min(right,clipRight);}
        if(clipY){top=Math.max(top,clipTop);bottom=Math.min(bottom,clipBottom);}
        if(right<=left||bottom<=top)return false;
      }
    }
    if(parent){hitLimit('VISIBILITY_ANCESTOR_LIMIT');return false;}
    return true;
  }
  function capture(node,initial){
    const parent=node.parentElement;
    if(!parent||!visible(parent)||parent.closest('script,style,textarea,input,[contenteditable="true"],[role="textbox"],.monaco-editor'))return;
    let text=node.nodeValue??'';
    if(text.length>100000){hitLimit('TEXT_SIZE_LIMIT');return;}
    const marker=text.indexOf(prefix);if(marker<0)return;
    let start=text.indexOf('{',marker+prefix.length),depth=0,quoted=false,escaped=false,end=-1;
    if(start<0)return;
    for(let i=start;i<text.length&&i-start<=40960;i++){
      const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}
    }
    if(end<0)return;
    let packet;try{packet=JSON.parse(text.slice(start,end));}catch{return;}
    if(typeof packet.runId!=='string'||packet.runId.length>1024||!Number.isSafeInteger(packet.sequence)||packet.sequence<1)return;
    const id=packet.runId+':'+packet.sequence;
    if(records.has(id))return;
    records.set(id,{id,appearanceEpochMs:initial?null:epoch(),initial,documentVisible:true,meaning:'FIRST_OBSERVED_VISIBLE_LOG_DOM_APPEARANCE'});
    while(records.size>1200)records.delete(records.keys().next().value);
  }
  function scan(root,initial,budget){
    if(!root)return true;
    const visit=node=>{
      if(budget.textNodes<=0){hitLimit('TEXT_NODE_LIMIT');return false;}
      budget.textNodes--;
      const value=node.nodeValue??'';
      if(value.length>100000){hitLimit('TEXT_SIZE_LIMIT');return true;}
      if(value.includes(prefix))capture(node,initial);
      return true;
    };
    if(root.nodeType===3)return visit(root);
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
    while((n=walker.nextNode()))if(!visit(n))return false;
    return true;
  }
  scan(document.body,true,{textNodes:20000});
  const observer=new MutationObserver(changes=>{
    if(stopped)return;callbacks++;
    let count=0,added=0;
    const budget={textNodes:5000};
    for(const change of changes){
      if(++count>500){hitLimit('MUTATION_RECORD_LIMIT');break;}
      // Do not materialize an unbounded NodeList or read subtree.textContent.
      // One mutation can contain many added nodes, so all limits are global
      // to this callback. Skipped work is not backfilled with a later stamp.
      const candidates=change.type==='characterData'?[change.target]:change.addedNodes??[];
      for(const node of candidates){
        if(++added>1000){hitLimit('ADDED_NODE_LIMIT');return;}
        if(!scan(node,false,budget))return;
      }
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  const stop=()=>{stopped=true;observer.disconnect();clearInterval(ttl);removeEventListener('pagehide',stop);};
  const ttl=setInterval(()=>{if(performance.now()-heartbeat>60000){stop();if(globalThis[key]?.sessionId===sessionId)delete globalThis[key];}},10000);
  addEventListener('pagehide',stop,{once:true});
  function recordWindowPacket(id,options={}){
    // Only this installed extension-owned session can record observations.
    // The caller supplies identity/provenance, never a clock or timestamp.
    if(stopped||globalThis[key]!==state||globalThis[key]?.sessionId!==sessionId)return false;
    windowCallbacks++;
    const reject=reason=>{windowExcluded[reason]=(windowExcluded[reason]??0)+1;return false;};
    if(typeof id!=='string'||!id||id.length>1024||/[\u0000-\u001f]/.test(id))return reject('INVALID_WINDOW_PACKET_ID');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(name=>!['initial','transport','sourceSequence'].includes(name)))return reject('INVALID_WINDOW_OBSERVATION_OPTIONS');
    const {initial=false,transport='PUBLIC_DATA_WINDOW_V2',sourceSequence}=options;
    if(typeof initial!=='boolean'||transport!=='PUBLIC_DATA_WINDOW_V2')return reject('INVALID_WINDOW_OBSERVATION_OPTIONS');
    if(!Number.isSafeInteger(sourceSequence)||sourceSequence<0)return reject('INVALID_WINDOW_SOURCE_SEQUENCE');
    if(document.visibilityState!=='visible'||document.hidden===true)return reject('WINDOW_DOCUMENT_HIDDEN');
    if(records.has(id))return false;
    const observedAt=initial?null:epoch();
    if(!initial&&!Number.isFinite(observedAt))return reject('INVALID_LOCAL_WINDOW_CLOCK');
    records.set(id,{id,appearanceEpochMs:observedAt,initial,documentVisible:true,transport,sourceSequence,
      meaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME'});
    while(records.size>1200)records.delete(records.keys().next().value);
    return true;
  }
  const state={sessionId,stop,recordWindowPacket,read(){heartbeat=performance.now();return {status:stopped?'STOPPED':'OK',sessionId,sourceEpoch:epoch(),documentTimeOrigin:performance.timeOrigin,documentVisible:document.visibilityState==='visible',records:[...records.values()].slice(-160).map(item=>({...item})),limited,limitReasons:{...limitReasons},callbacks,windowCallbacks,windowExcluded:{...windowExcluded},scope:'Visible log DOM first observation or first extension observation of a checksum-verified coherent visible Data Window frame. The latter starts in the scoped DOM MutationObserver callback after coherence validation, before the next receiver poll. Subsequent polling wait is included. Earlier exchange, Pine execution and frame rendering are unmeasured.'};}};
  globalThis[key]=state;return state.read();
}

const summarize=values=>{
  const v=values.filter(Number.isFinite).sort((a,b)=>a-b),n=v.length;
  return {count:n,p50Ms:n?v[Math.ceil(n*.5)-1]:null,p95Ms:n?v[Math.ceil(n*.95)-1]:null,maxMs:n?v[n-1]:null};
};
export function createSourceDomLatency({maxSamples=600,maxAgeMs=30000,maxRoundTripMs=1000,now=()=>performance.now()}={}){
  if(!Number.isSafeInteger(maxSamples)||maxSamples<1||maxSamples>10000||!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isFinite(maxRoundTripMs)||maxRoundTripMs<=0||typeof now!=='function')throw TypeError('INVALID_SOURCE_TIMING_LIMITS');
  let sessionId=null,origins=new Map(),associations=new Map(),samples=[],reasons={},lastLimited=0,lastObserver=null,lookupObservation=null;
  const reject=reason=>{reasons[reason]=(reasons[reason]??0)+1;return false;};
  function reset(nextSession){sessionId=nextSession;origins.clear();associations.clear();samples=[];reasons={};lastLimited=0;lastObserver=null;lookupObservation=null;}
  function observe(evidence,{beforeEpoch,afterEpoch,receiverTimeOrigin}={}){
    lookupObservation=null;
    if(evidence?.status!=='OK'||evidence.sessionId!==sessionId)return reject('OBSERVER_SESSION_UNAVAILABLE');
    if(![beforeEpoch,afterEpoch,receiverTimeOrigin,evidence.sourceEpoch].every(Number.isFinite)||afterEpoch<beforeEpoch||afterEpoch-beforeEpoch>maxRoundTripMs)return reject('INVALID_CALIBRATION_BRACKET');
    const observedAt=now();
    if(Number.isFinite(observedAt)&&Number.isFinite(evidence.documentTimeOrigin)&&evidence.documentTimeOrigin>=0&&evidence.sourceEpoch>=evidence.documentTimeOrigin)lookupObservation={observedAt,sourceEpoch:evidence.sourceEpoch,sourceDocumentTimeOrigin:evidence.documentTimeOrigin,receiverTimeOrigin,documentVisible:evidence.documentVisible===true};
    lastLimited=evidence.limited??0;
    lastObserver={documentVisible:evidence.documentVisible,records:evidence.records?.length??0,callbacks:evidence.callbacks??0,windowCallbacks:evidence.windowCallbacks??0,windowExcluded:{...evidence.windowExcluded},limitReasons:{...evidence.limitReasons}};
    for(const item of evidence.records??[]){
      if(origins.has(item.id))continue;
      if(item.initial||item.appearanceEpochMs===null){origins.set(item.id,{reason:'ALREADY_PRESENT_AT_OBSERVER_START'});continue;}
      const age=evidence.sourceEpoch-item.appearanceEpochMs;
      if(!Number.isFinite(age)||age<0||age>maxAgeMs||!item.documentVisible){origins.set(item.id,{reason:'SOURCE_APPEARANCE_UNAVAILABLE'});continue;}
      // At the source sample instant, the receiver was between before/after.
      // Translate the earlier appearance to that same interval; no Unix/Pine
      // synchronization or symmetric round-trip assumption is needed.
      origins.set(item.id,{earliest:beforeEpoch-age-receiverTimeOrigin,latest:afterEpoch-age-receiverTimeOrigin,bracketMs:afterEpoch-beforeEpoch,receiverTimeOrigin,sourceAppearanceEpochMs:item.appearanceEpochMs,
        sourceObservationMeaning:item.meaning??'FIRST_OBSERVED_VISIBLE_LOG_DOM_APPEARANCE',sourceTransport:item.transport??'PUBLIC_PINE_LOG_DOM',sourceSequence:item.sourceSequence??null,...(Number.isFinite(evidence.documentTimeOrigin)?{sourceDocumentTimeOrigin:evidence.documentTimeOrigin}:{})});
    }
    while(origins.size>1200)origins.delete(origins.keys().next().value);return true;
  }
  function originFor(packetId){
    // A packet origin is useful independently of result-panel sampling. It is
    // always the original owned observation, never the time of this lookup.
    if(typeof sessionId!=='string'||!sessionId||typeof packetId!=='string'||!packetId||packetId.length>1024||/[\u0000-\u001f]/.test(packetId)||!lookupObservation||!lookupObservation.documentVisible)return null;
    const origin=origins.get(packetId),at=now(),elapsed=at-lookupObservation.observedAt;
    if(!origin||origin.reason||!Number.isFinite(at)||elapsed<0||!Number.isFinite(origin.sourceDocumentTimeOrigin)||origin.sourceDocumentTimeOrigin!==lookupObservation.sourceDocumentTimeOrigin||origin.receiverTimeOrigin!==lookupObservation.receiverTimeOrigin||!Number.isFinite(origin.sourceAppearanceEpochMs)||origin.sourceAppearanceEpochMs<origin.sourceDocumentTimeOrigin||!Number.isSafeInteger(origin.sourceSequence)||origin.sourceSequence<0||origin.sourceTransport!=='PUBLIC_DATA_WINDOW_V2'||origin.sourceObservationMeaning!=='FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME')return null;
    const age=lookupObservation.sourceEpoch-origin.sourceAppearanceEpochMs+elapsed,packetSequence=Number(packetId.slice(packetId.lastIndexOf(':')+1));
    if(!Number.isFinite(age)||age<0||age>maxAgeMs||!Number.isSafeInteger(packetSequence)||packetSequence<1||Math.floor(packetSequence/8)!==origin.sourceSequence||![origin.earliest,origin.latest,origin.bracketMs,origin.receiverTimeOrigin].every(Number.isFinite)||origin.latest<origin.earliest||origin.bracketMs<0||origin.bracketMs>maxRoundTripMs)return null;
    return structuredClone({kind:'OWNED_SOURCE_PACKET_ORIGIN_V1',sessionId,packetId,sourceAppearanceEpochMs:origin.sourceAppearanceEpochMs,sourceDocumentTimeOrigin:origin.sourceDocumentTimeOrigin,sourceSequence:origin.sourceSequence,sourceTransport:origin.sourceTransport,sourceObservationMeaning:origin.sourceObservationMeaning,calibrationBracketMs:origin.bracketMs,calibration:{receiverTimeOrigin:origin.receiverTimeOrigin,sourceAppearanceEarliestReceiverPerformanceMs:origin.earliest,sourceAppearanceLatestReceiverPerformanceMs:origin.latest}});
  }
  function associate(eventId,packetId){
    const origin=origins.get(packetId);if(!origin)return reject('APPEARANCE_NOT_OBSERVED');if(origin.reason)return reject(origin.reason);
    associations.set(eventId,{...origin,packetId});while(associations.size>64)associations.delete(associations.keys().next().value);return true;
  }
  function complete(sample){
    const origin=associations.get(sample?.eventId);associations.delete(sample?.eventId);if(!origin)return false;
    if(![sample.firstPaintOpportunityAt,sample.secondPaintOpportunityAt,sample.mutationAt].every(Number.isFinite)||sample.mutationAt<origin.earliest||sample.firstPaintOpportunityAt<sample.mutationAt||sample.secondPaintOpportunityAt<sample.firstPaintOpportunityAt)return reject('INVALID_CORRELATED_RENDER');
    const result={eventId:sample.eventId,packetId:origin.packetId,sourceAppearanceEpochMs:origin.sourceAppearanceEpochMs,sourceObservationMeaning:origin.sourceObservationMeaning,sourceTransport:origin.sourceTransport,sourceSequence:origin.sourceSequence,...(Number.isFinite(origin.sourceDocumentTimeOrigin)?{sourceDocumentTimeOrigin:origin.sourceDocumentTimeOrigin}:{}),calibrationBracketMs:origin.bracketMs,
      sourceToMutationLowerMs:Math.max(0,sample.mutationAt-origin.latest),sourceToMutationUpperMs:sample.mutationAt-origin.earliest,
      sourceToPaintLowerMs:Math.max(0,sample.firstPaintOpportunityAt-origin.latest),sourceToPaintUpperMs:sample.secondPaintOpportunityAt-origin.earliest};
    if(result.sourceToPaintUpperMs>maxAgeMs)return reject('CORRELATION_EXPIRED');
    samples.push(result);if(samples.length>maxSamples)samples.shift();return {...result};
  }
  function snapshot(){return {kind:'SOURCE_VISIBLE_LOG_DOM_TO_RESULT_PAINT_OPPORTUNITIES',sessionId,scope:'First observed visible Pine log DOM appearance, or first extension observation of a checksum-verified coherent visible Data Window frame, to result DOM and two browser rendering opportunities. Data Window observations begin in the scoped DOM MutationObserver callback after coherence validation and include subsequent polling wait; earlier frame appearance is unmeasured. Exchange/network/Pine/render stages and physical pixels are unmeasured. Each sample identifies its boundary.',marketToDisplayMeasured:false,captureToDisplayMeasured:false,physicalDisplayMeasured:false,observerLimitEvents:lastLimited,observer:lastObserver?structuredClone(lastObserver):null,excluded:{...reasons},metrics:Object.fromEntries(['sourceToMutationLowerMs','sourceToMutationUpperMs','sourceToPaintLowerMs','sourceToPaintUpperMs'].map(key=>[key,summarize(samples.map(s=>s[key]))])),samples:structuredClone(samples)};}
  return {reset,observe,originFor,associate,complete,snapshot};
}
