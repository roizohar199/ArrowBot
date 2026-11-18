// Serialized ISOLATED-world driver. Native Replay DOM only; no broker API,
// quantity setter, bracket setter, stop movement, reverse or flatten action.
// This mode reads only the actual native DOM quantity. It does not attest that
// unseen order-ticket/SLTP presets are inherited by Buy Mkt/Sell Mkt.
export async function userMarketTradingUiCommand(command={}){
  command={...(command??{}),action:({submit:'submit_market',verify:'verify_market'})[command?.action]??command?.action};
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim(),number=x=>{const s=norm(x).replace(/^\u2212(?=\d)/,'-').replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;},
    finite=Number.isFinite,integer=Number.isSafeInteger,tick=x=>finite(x)&&x>0&&integer(x/.25),
    bounded=(x,n=512)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\u0000-\u001f\u007f]/.test(x),
    fields=['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END','ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'],
    now=()=>Date.now(),perf=()=>performance.now(),expected=command.expected??{},slot=Symbol.for('arrow.user-market-ui.v1'),
    memory=globalThis[slot]??(globalThis[slot]={version:1,generation:0,lease:null,busy:false,locked:false,own:null});
  const fail=code=>{throw Object.assign(new Error(code),{userMarketCode:code});};
  // Chrome RPC may reorder object keys. Native preset identity is its exact
  // flat schema and scalar values, rather than JSON insertion order.
  const sameNativePreset=(a,b)=>{
    const keys=['kind','symbol','quantity','quantityRaw','sourceControl','scope','bracketPresetVerified','fingerprint'];
    return !!a&&!!b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)
      &&Object.keys(a).length===keys.length&&Object.keys(b).length===keys.length
      &&keys.every(key=>Object.hasOwn(a,key)&&Object.hasOwn(b,key)&&a[key]===b[key]);
  };
  const visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
    for(let n=node;n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility==='hidden'||s.visibility==='collapse'||s.display==='none'||s.contentVisibility==='hidden')return false;
      if(n!==node){const clip=x=>['hidden','clip','auto','scroll'].includes(x),r=n.getBoundingClientRect();if(clip(s.overflowX??s.overflow)&&r.width<=0||clip(s.overflowY??s.overflow)&&r.height<=0)return false;}}
    return true;
  };
  const all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible),one=(s,r=document)=>{const a=all(s,r);return a.length===1?a[0]:null;},
    disabled=n=>!n||n.disabled===true||n.getAttribute('aria-disabled')==='true',label=n=>norm(n?.textContent),
    response=(status,extra={})=>({kind:'USER_MARKET_NATIVE_RESULT',status,provider:'REPLAY_TRADING',mode:'USER_MARKET',
      submitted:false,ordersCreated:memory.own?null:false,fillVerified:false,protectionVerified:false,
      userManaged:true,bracketPresetVerified:false,realBrokerOrdersAuthorized:false,...extra});
  let gestureStarted=false,ownsBusy=false,chartSelection=null;
  function identity(){
    if(document.visibilityState!=='visible'||document.hidden===true)fail('USER_MARKET_VISIBLE_RESEARCH_REQUIRED');
    if(all('[role="dialog"]').length)fail('USER_MARKET_MODAL_REQUIRES_REVIEW');
    let requested;try{const u=new URL(expected.researchUrl);if(u.search||u.hash||u.username||u.password)throw Error();requested=u.origin+u.pathname;}catch{fail('USER_MARKET_EXACT_RESEARCH_URL_REQUIRED');}
    if(location.protocol!=='https:'||!['www.tradingview.com','tradingview.com'].includes(location.hostname)||!/^\/chart\/[A-Za-z0-9_-]+\/$/.test(location.pathname)||location.origin+location.pathname!==requested)fail('USER_MARKET_RESEARCH_TARGET_CHANGED');
    if(expected.instrument!=='CME_MINI:NQ1!'||expected.timeframe!=='1'||!integer(expected.sourceTabId)||expected.sourceTabId<1)fail('USER_MARKET_EXACT_NQ_MINUTE_REQUIRED');
    const layout=one('[aria-label^="Logged in as"]'),charts=all('canvas[aria-label^="Chart for "]'),interval=one('#header-toolbar-intervals [aria-checked="true"]'),replay=one('#header-toolbar-replay'),footer=one('#footer-chart-panel'),provider=footer&&one('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',footer),
      targets=charts.filter(chart=>chart.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute'),multi=expected.allowResearchMultiChart===true;
    if(expected.allowResearchMultiChart!==undefined&&typeof expected.allowResearchMultiChart!=='boolean')fail('USER_MARKET_EXPLICIT_CHART_POLICY_REQUIRED');
    if(!layout||!/Active layout: Arrow /.test(layout.getAttribute('aria-label')??'')||interval?.getAttribute('data-value')!=='1'||targets.length!==1
      ||(multi?charts.length<1||charts.length>3||charts.some(chart=>!/^Chart for CME_MINI:NQ1!, [^,]+$/.test(chart.getAttribute('aria-label')??'')):charts.length!==1))fail('USER_MARKET_OWN_SINGLE_RESEARCH_CHART_REQUIRED');
    chartSelection={kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:charts.length,targetCharts:1,selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',interval:'1',researchLayoutVerified:true};
    if(replay?.getAttribute('aria-pressed')!=='true'||!provider||label(provider)!=='Replay Trading')fail('USER_MARKET_NATIVE_REPLAY_REQUIRED');
    if(all('[aria-label="Account manager"],[data-qa-id="account-selector"]').length||all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]').some(n=>label(n)))fail('USER_MARKET_REAL_OR_PAPER_BROKER_EXCLUDED');
    const panel=one('[aria-label="Trading panel"]'),radios=panel?all('[role="radio"]',panel):[],titles=panel?all('[title]',panel).map(n=>n.getAttribute('title')):[],logos=panel?all('img[src]',panel).filter(n=>{
      try{const u=new URL(n.getAttribute('src'));return u.protocol==='https:'&&u.hostname==='static.tradingview.com'&&/^\/static\/bundles\/replay-broker\.[a-z0-9]+\.svg$/.test(u.pathname);}catch{return false;}
    }):[];
    if(!panel||radios.filter(n=>label(n)==='DOM'&&n.getAttribute('aria-checked')==='true').length!==1||radios.filter(n=>label(n)==='Order'&&n.getAttribute('aria-checked')==='false').length!==1
      ||all('[aria-label="Order ticket"],[data-name="position-panel"]',panel).length||titles.filter(t=>t==='NQ1!').length!==1||titles.some(t=>/^NQ[HMUZ]20\d\d$/.test(t??'')||/^NQ1!, order /.test(t??''))||logos.length!==1)fail('USER_MARKET_PUBLIC_NATIVE_DOM_REQUIRED');
    const play=one('div[data-role="button"][title="Play"]');if(!play||!(play.parentElement?.getAttribute('class')??'').includes('controls__control-'))fail('USER_MARKET_PAUSED_REPLAY_REQUIRED');
    return {panel,researchUrl:requested,visibleCharts:charts.length,researchSelection:chartSelection};
  }
  function source(binding,allowUnboundRead=false){
    if((!binding||typeof binding!=='object')&&!allowUnboundRead)fail('USER_MARKET_SOURCE_BINDING_REQUIRED');
    const tabs=all('[role="tab"][aria-selected="true"]').filter(n=>/data\s*window/i.test(norm(n.getAttribute('aria-label')||n.textContent))),studies=all('[role="treegrid"] [role="row"][data-role="menuitem"]').filter(row=>all('span[title]',row).some(n=>(n.getAttribute('title')??'').startsWith('Arrow OHLC Window v2')));
    if(tabs.length!==1||studies.length!==1)fail('USER_MARKET_VISIBLE_OWN_SOURCE_REQUIRED');
    const observed={};for(const key of fields){const title=one(`[data-test-id-value-title="${key}"]`,studies[0]),p=title?.parentElement;
      if(!title||!p||p.children.length!==2||p.children[0]!==title||!bounded(p.children[1].textContent,128)||!integer(number(p.children[1].textContent)))fail('USER_MARKET_PUBLIC_SOURCE_STRUCTURE_CHANGED');observed[key]=p.children[1].textContent;}
    if(!binding&&allowUnboundRead)return observed;
    if(binding.sourceTabId!==expected.sourceTabId||!integer(binding.runEpoch)||binding.runId!=='CME_MINI:NQ1!|1|'+binding.runEpoch||number(observed.ARROW2_RUN_EPOCH)!==binding.runEpoch
      ||!integer(binding.sequence)||number(observed.ARROW2_SEQ_BEGIN)!==binding.sequence||number(observed.ARROW2_SEQ_END)!==binding.sequence
      ||fields.some(k=>observed[k]!==binding.fields?.[k])||!integer(binding.currentTime)||!integer(binding.currentCloseTime)||binding.currentCloseTime-binding.currentTime!==60000
      ||Math.floor(number(observed.ARROW2_CURRENT_TIME)/1e12)!==binding.sequence%4096||number(observed.ARROW2_CURRENT_TIME)%1e12+1577836800000!==binding.currentTime
      ||!integer(binding.asOfTime)||!['current','previous'].includes(binding.closedBarRole)||binding.asOfTime!==(binding.closedBarRole==='current'?binding.currentCloseTime:binding.currentTime)
      ||!bounded(binding.eventId))fail('USER_MARKET_SOURCE_RUN_CURSOR_CHANGED');
    return observed;
  }
  function native(){
    const bound=identity(),get=k=>one(`[data-qa-id="${k}"]`,bound.panel),buy=get('buy-market-dom'),sell=get('sell-market-dom'),buyCancel=get('cancel-all-buy-orders'),sellCancel=get('cancel-all-sell-orders'),
      position=get('position-DOM'),pnl=get('switch-pl-view'),qty=one('input#dom-quantity-input[data-qa-id~="qty-dom-input"]',bound.panel),prices=all('[data-qa-id^="dom-cell-"]',bound.panel).filter(n=>/^dom-cell-\d+-price$/.test(n.getAttribute('data-qa-id')??'')),
      highlighted=prices.filter(n=>(n.getAttribute('class')??'').includes('__value--highlighted-')),quote=highlighted.length===1?number(highlighted[0].textContent):null,quantity=number(qty?.value),quantityRaw=qty?.value;
    if(label(buy)!=='Buy Mkt'||disabled(buy)||label(sell)!=='Sell Mkt'||disabled(sell)||!buyCancel||!sellCancel||typeof buyCancel.disabled!=='boolean'||typeof sellCancel.disabled!=='boolean'
      ||buyCancel.getAttribute('aria-disabled')==='true'||sellCancel.getAttribute('aria-disabled')==='true'||disabled(position)||disabled(pnl)||!qty||qty.disabled||qty.readOnly||!integer(quantity)||quantity<1||quantity>1e6||!bounded(quantityRaw,80)
      ||prices.length<3||prices.length>500||prices.some(n=>!tick(number(n.textContent)))||!tick(quote))fail('USER_MARKET_NATIVE_CONTROLS_UNVERIFIED');
    const preset={kind:'NATIVE_REPLAY_DOM_MARKET_QUANTITY_V1',symbol:'NQ1!',quantity,quantityRaw,sourceControl:'input#dom-quantity-input[data-qa-id~="qty-dom-input"]',
      scope:'NATIVE_DOM_QUANTITY_ONLY_BRACKET_PRESET_UNVERIFIED',bracketPresetVerified:false};
    preset.fingerprint=JSON.stringify(['native-replay-dom-market-quantity-1',preset.symbol,preset.quantity,preset.quantityRaw,preset.sourceControl]);
    return {bound,buy,sell,buyCancel,sellCancel,position,pnl,preset,quote};
  }
  function inventory(value,raw){
    const positionMarker=label(value.position),pnlMarker=label(value.pnl),positionEmpty=positionMarker==='—'&&pnlMarker==='—',pendingEmpty=value.buyCancel.disabled&&value.sellCancel.disabled;
    if(pendingEmpty&&all('[data-qa-id^="dom-cell-"]',value.bound.panel).filter(n=>/^dom-cell-\d+-orders-(buy|sell)$/.test(n.getAttribute('data-qa-id')??'')).some(n=>all('div[class*="tv-dom-widget-order-"]',n).length))fail('USER_MARKET_ZERO_COUNTERS_CONTRADICT_ORDERS');
    return {kind:'REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1',status:positionEmpty&&pendingEmpty?'FLAT_NO_PENDING':'NONEMPTY',provider:'REPLAY_TRADING',scope:'CURRENT_REPLAY_SYMBOL_ONLY',
      instrument:'CME_MINI:NQ1!',timeframe:'1',researchUrl:value.bound.researchUrl,sourceTabId:expected.sourceTabId,observedAt:now(),documentTimeOrigin:performance.timeOrigin,
      visibleCharts:value.bound.visibleCharts,researchSelection:value.bound.researchSelection,
      positionMarker,pnlMarker,positionEmpty,pendingEmpty,flat:positionEmpty,positionsComplete:positionEmpty,workingOrdersComplete:pendingEmpty,
      positions:positionEmpty?[]:null,workingOrders:pendingEmpty?[]:null,buyCancelDisabled:value.buyCancel.disabled,sellCancelDisabled:value.sellCancel.disabled,
      quote:value.quote,sourceFields:{...raw},cancelAllEnabledUsedAsZeroEvidence:false,totalQuantityLabelsUsedAsEvidence:false,visibleOrderCellsUsedAsInventory:false};
  }
  function guards(){
    if(memory.guardsInstalled)return;if(typeof document.addEventListener!=='function')fail('USER_MARKET_ACTIVITY_GUARD_REQUIRED');
    const invalidate=e=>{if(e?.isTrusted===true){memory.generation++;memory.lease=null;if(memory.own&&!memory.own.fillVerified)memory.own.interfered=true;}};
    for(const type of ['pointerdown','keydown','wheel','touchstart','beforeinput','visibilitychange','pagehide'])document.addEventListener(type,invalidate,{capture:true,passive:true});memory.guardsInstalled=true;
  }
  function otherModesIdle(){
    const old=globalThis[Symbol.for('arrow.replay-trading-ui.v1')],paper=globalThis[Symbol.for('arrow.paper-ui-driver.v1')],lease=old?.inventoryProof;
    if(old&&(old.busy===true||old.prepared||old.locked===true||old.lastSubmission&&!old.lastSubmission.resolved
      ||lease&&lease.documentTimeOrigin===performance.timeOrigin&&now()>=lease.observedAt&&now()-lease.observedAt<=750&&perf()>=lease.observedPerformance&&perf()-lease.observedPerformance<=750))fail('USER_MARKET_OLD_REPLAY_REQUIRES_DISARM_OR_RECONCILIATION');
    if(paper&&(paper.prepared||paper.lastSubmission))fail('USER_MARKET_OTHER_PAPER_ATTEMPT_REQUIRES_RECONCILIATION');
  }
  function intentCheck(intent){
    const b=intent?.sourceBinding,a=intent?.approvalProof,ids=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
    // Public profile catalogue, duplicated intentionally for a self-contained
    // serialized native boundary. Tests compare it to guide-strategy-policy.
    const strategyProfiles={
      CANDLE_TREND_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],CANDLE_REVERSAL_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],CANDLE_RANGE_EDGE:['STRUCTURE','KNOWN_LOCATION'],
      PIN_TREND_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],PIN_CONFLUENCE:['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME'],PIN_RANGE_EDGE:['STRUCTURE','KNOWN_LOCATION'],
      ENGULFING_EMA:['STRUCTURE','EMA'],ENGULFING_FIB:['STRUCTURE','FIB'],ENGULFING_TRENDLINE:['STRUCTURE','TRENDLINE'],ENGULFING_RANGE:['STRUCTURE','KNOWN_LOCATION'],
      ENGULFING_SUPPLY_DEMAND:['STRUCTURE','SUPPLY_DEMAND'],ENGULFING_RANGE_RECLAIM:['STRUCTURE','KNOWN_LOCATION'],HANGING_MAN_REVERSAL:['STRUCTURE','KNOWN_LOCATION'],
      INVERTED_HAMMER_REVERSAL:['STRUCTURE','KNOWN_LOCATION'],INSIDE_BREAKOUT:['STRUCTURE','KNOWN_LOCATION'],INSIDE_FALSE_BREAK:['STRUCTURE','KNOWN_LOCATION'],
      INSIDE_FALSE_BREAK_FIB:['STRUCTURE','FIB'],ROLE_REVERSAL_RETEST:['STRUCTURE','KNOWN_LOCATION']
    };
    if(!intent||intent.kind!=='USER_PRESET_REPLAY_MARKET_INTENT'||intent.definitionVersion!=='user-market-intent-1'||intent.testOnly!==false||intent.synthetic===true||a?.testOnly===true||a?.synthetic===true||intent.technicalApproved!==true||intent.provider!=='REPLAY_TRADING'||intent.orderType!=='MARKET'||intent.userManaged!==true||intent.symbol!=='NQ1!'
      ||!['LONG','SHORT'].includes(intent.direction)||!integer(intent.quantity)||intent.quantity<1||intent.quantity>1e6||!bounded(intent.key,2500)||intent.researchUrl!==expected.researchUrl
      ||!integer(intent.preparedAt)||!integer(intent.expiresAt)||intent.preparedAt>now()||now()-intent.preparedAt>2000||intent.expiresAt<now()||intent.expiresAt-intent.preparedAt>2000||intent.expiresAt<=intent.preparedAt
      ||intent.sourceDocumentTimeOrigin!==performance.timeOrigin||!finite(intent.sourceObservedEpochMs)||intent.sourceObservedEpochMs<intent.sourceDocumentTimeOrigin
      ||intent.realBrokerOrdersAuthorized!==false)fail('USER_MARKET_STRICT_INTENT_REQUIRED');
    const key=['user-market-intent-1',expected.researchUrl,expected.sourceTabId,b?.runId,b?.asOfTime,b?.eventId].map(encodeURIComponent).join(':');
    const sharedKey=['replay-execution-intent-2',expected.researchUrl,expected.sourceTabId,b?.runId,b?.asOfTime,'CME_MINI:NQ1!:1:'+b?.asOfTime+':'+intent.direction].map(encodeURIComponent).join(':');
    if(intent.key!==key||intent.sharedReservationKey!==sharedKey)fail('USER_MARKET_EVENT_KEY_MISMATCH');
    if(!a||a.engineDefinitionVersion!=='guide-signals-5'||a.eventId!==b.eventId||a.asOfTime!==b.asOfTime||a.direction!==intent.direction
      ||a.technicalDecisionVersion!=='guide-technical-decision-1'||a.confirmationPolicy!=='later_close_beyond_setup'||a.confirmationBarCloseTime!==b.asOfTime||a.confirmedAt!==b.asOfTime
      ||a.roleReversalEnabled!==true||a.supplyDemandEnabled!==true
      ||!Array.isArray(a.sourceEventIds)||a.sourceEventIds.length<1||a.sourceEventIds.length>600||a.sourceEventIds.some(id=>!bounded(id)))fail('USER_MARKET_TECHNICAL_APPROVAL_REQUIRED');
    if(a.approvalPolicy==='guide_scenarios_v1'){
      if(!Array.isArray(a.strategyProofs)||a.strategyProofs.length<1||a.strategyProofs.length>18||new Set(a.sourceEventIds).size!==a.sourceEventIds.length)fail('USER_MARKET_STRATEGY_PROOF_REQUIRED');
      const seenProfiles=new Set(),covered=[];
      for(const proof of a.strategyProofs){
        const required=proof&&Object.hasOwn(strategyProfiles,proof.profileId)?strategyProfiles[proof.profileId]:null;
        if(!required||seenProfiles.has(proof.profileId)||JSON.stringify(proof.requiredCheckIds)!==JSON.stringify(required)
          ||!Array.isArray(proof.requiredChecks)||proof.requiredChecks.length!==required.length||required.some(id=>{const rows=proof.requiredChecks.filter(c=>c?.id===id);return rows.length!==1||!['required','enabled','available','passed'].every(k=>rows[0][k]===true)||rows[0].state!=='PASS'||rows[0].pendingConfirmation===true;})
          ||!Array.isArray(proof.sourceEventIds)||proof.sourceEventIds.length<1||proof.sourceEventIds.length>600||new Set(proof.sourceEventIds).size!==proof.sourceEventIds.length||proof.sourceEventIds.some(id=>!bounded(id)||!a.sourceEventIds.includes(id)))fail('USER_MARKET_STRATEGY_PROOF_REQUIRED');
        seenProfiles.add(proof.profileId);covered.push(...proof.sourceEventIds);
      }
      if(covered.length!==a.sourceEventIds.length||new Set(covered).size!==covered.length||a.sourceEventIds.some(id=>!covered.includes(id)))fail('USER_MARKET_STRATEGY_SOURCE_PARTITION_REQUIRED');
      const union=[...new Set(a.strategyProofs.flatMap(proof=>proof.requiredCheckIds))];
      if(!Array.isArray(a.requiredChecks)||a.requiredChecks.length!==union.length||union.some(id=>{const rows=a.requiredChecks.filter(row=>row?.id===id);return rows.length!==1||!['required','enabled','available','passed'].every(key=>rows[0][key]===true)||rows[0].state!=='PASS'||rows[0].pendingConfirmation===true;}))fail('USER_MARKET_STRATEGY_UNION_CHECKS_REQUIRED');
    }else{
      if(a.approvalPolicy!==undefined&&a.approvalPolicy!=='all_seven'||!Array.isArray(a.requiredChecks)||a.requiredChecks.length!==7
        ||ids.some(id=>a.requiredChecks.filter(c=>c.id===id&&['required','enabled','available','passed'].every(k=>c[k]===true)&&c.state==='PASS').length!==1)
        ||['requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'].some(k=>a.requiredFlags?.[k]!==true))fail('USER_MARKET_TECHNICAL_APPROVAL_REQUIRED');
    }
    source(b);return b;
  }
  function currentTechnicalEntry(intent,quote){
    const w=intent.technicalEntryWitness,ids=intent.approvalProof.sourceEventIds;
    if(!w||w.kind!=='CURRENT_REPLAY_QUOTE_PRESERVES_FROZEN_SETUP'||w.direction!==intent.direction||w.asOfTime!==intent.sourceBinding.asOfTime||w.pricesAdjusted!==false
      ||!tick(w.quote)||w.quote!==quote||!Array.isArray(w.sourceEventIds)||JSON.stringify(w.sourceEventIds)!==JSON.stringify(ids)||new Set(ids).size!==ids.length
      ||!Array.isArray(w.setups)||w.setups.length<1||w.setups.length>ids.length||w.setups.some(s=>!s||!bounded(s.eventId)||!ids.includes(s.eventId)||!tick(s.trigger)||!tick(s.structuralInvalidation))
      ||new Set(w.setups.map(s=>s.eventId)).size!==w.setups.length||!Array.isArray(w.eligibleSetupIds)||new Set(w.eligibleSetupIds).size!==w.eligibleSetupIds.length)fail('USER_MARKET_TECHNICAL_ENTRY_WITNESS_REQUIRED');
    const eligible=w.setups.filter(s=>intent.direction==='LONG'?quote>s.trigger&&quote>=s.structuralInvalidation:quote<s.trigger&&quote<=s.structuralInvalidation).map(s=>s.eventId);
    if(!eligible.length)fail('USER_MARKET_CURRENT_QUOTE_INVALIDATES_SETUP');
    if(w.eligibleSetupIds.some(id=>!bounded(id))||JSON.stringify([...eligible].sort())!==JSON.stringify([...w.eligibleSetupIds].sort()))fail('USER_MARKET_CURRENT_ELIGIBLE_SETUPS_CHANGED');
    return w;
  }
  function consume(key,sharedKey){
    const name='arrow.userMarketAttempts.v1';let entries;
    try{const raw=sessionStorage.getItem(name);entries=raw===null?[]:JSON.parse(raw);
      if(!Array.isArray(entries)||entries.length>256||entries.some(e=>!bounded(e?.key,2500)||!integer(e.at)||e.state!=='ATTEMPTED'))fail('USER_MARKET_EVENT_LEDGER_INVALID');
      if(entries.some(e=>e.key===key))fail('USER_MARKET_EVENT_ALREADY_ATTEMPTED');if(entries.length>=256)fail('USER_MARKET_EVENT_LEDGER_FULL');
      const oldRaw=sessionStorage.getItem('arrow.replayExecutionAttempts.v2'),old=oldRaw===null?{version:2,entries:[]}:JSON.parse(oldRaw);
      if(old.version!==2||!Array.isArray(old.entries)||old.entries.length>256||old.entries.some(e=>!bounded(e?.key,2500)||!integer(e.at)||e.state!=='ATTEMPTED'))fail('USER_MARKET_SHARED_EVENT_LEDGER_INVALID');
      if(old.entries.some(e=>e.key===sharedKey))fail('USER_MARKET_SHARED_EVENT_ALREADY_ATTEMPTED');if(old.entries.length>=256)fail('USER_MARKET_SHARED_EVENT_LEDGER_FULL');
      old.entries.push({key:sharedKey,at:now(),state:'ATTEMPTED'});const oldJson=JSON.stringify(old);sessionStorage.setItem('arrow.replayExecutionAttempts.v2',oldJson);
      if(sessionStorage.getItem('arrow.replayExecutionAttempts.v2')!==oldJson)fail('USER_MARKET_SHARED_EVENT_LEDGER_NOT_PERSISTED');
      entries.push({key,at:now(),state:'ATTEMPTED'});const json=JSON.stringify(entries);sessionStorage.setItem(name,json);if(sessionStorage.getItem(name)!==json)fail('USER_MARKET_EVENT_LEDGER_NOT_PERSISTED');
    }catch(error){if(error?.userMarketCode)throw error;fail('USER_MARKET_EVENT_LEDGER_NOT_PERSISTED');}
  }
  function attribution(own){return {kind:'OWN_USER_MARKET_SUBMISSION',key:own.intent.key,sourceTabId:own.intent.sourceBinding.sourceTabId,runId:own.intent.sourceBinding.runId,baselineFlatVerified:true,submissionRecorded:true};}
  try{
    if(memory.version!==1)fail('USER_MARKET_PRIVATE_STATE_INVALID');
    if(command.action==='disarm'){memory.generation++;memory.lease=null;return response(memory.locked?'UNKNOWNLOCK':'DISARMED',{submitCapabilityCreated:false});}
    guards();
    if(command.action==='read_controls'){
      const bound=identity(),get=k=>one(`[data-qa-id="${k}"]`,bound.panel),buy=get('buy-market-dom'),sell=get('sell-market-dom'),qty=one('input#dom-quantity-input[data-qa-id~="qty-dom-input"]',bound.panel);
      if(!buy||!sell||!qty||label(buy)!=='Buy Mkt'||label(sell)!=='Sell Mkt')fail('USER_MARKET_NATIVE_MARKET_CONTROLS_REQUIRED');
      let raw=null,inv=null;const reasons=[];
      try{raw=source(command.sourceBinding,true);}catch(error){reasons.push(error?.userMarketCode??'USER_MARKET_SOURCE_READ_UNAVAILABLE');}
      try{inv={...inventory(native(),raw??{}),sourceBound:!!command.sourceBinding&&!!raw,executionEligible:false};}
      catch(error){reasons.push(error?.userMarketCode??'USER_MARKET_INVENTORY_READ_UNAVAILABLE');}
      return response('USER_MARKET_CONTROLS_OBSERVED',{observedAt:now(),documentTimeOrigin:performance.timeOrigin,
        visibleCharts:chartSelection?.visibleCharts??null,researchSelection:chartSelection,
        researchUrl:bound.researchUrl,sourceTabId:expected.sourceTabId,instrument:'CME_MINI:NQ1!',timeframe:'1',
        controls:{quantity:{sourceControl:'input#dom-quantity-input[data-qa-id~="qty-dom-input"]',quantityRaw:qty.value,quantity:number(qty.value),disabled:qty.disabled===true,readOnly:qty.readOnly===true},
          buy:{dataQa:'buy-market-dom',label:label(buy),disabled:disabled(buy)},sell:{dataQa:'sell-market-dom',label:label(sell),disabled:disabled(sell)}},
        inventory:inv,sourceFields:raw,sourceVerification:raw?(command.sourceBinding?'BOUND_READ_ONLY':'UNBOUND_READ_ONLY'):'UNAVAILABLE',reasonCodes:reasons,
        presetScope:'NATIVE_DOM_QUANTITY_ONLY_BRACKET_PRESET_UNVERIFIED',leaseMinted:false,submitCapabilityCreated:false,ordersCreated:false,readOnly:true});
    }
    if(command.action==='read_preset'){
      if(memory.busy||memory.locked)fail('USER_MARKET_RECONCILIATION_REQUIRED');if(!['LONG','SHORT'].includes(command.direction))fail('USER_MARKET_SIGNAL_DIRECTION_REQUIRED');
      otherModesIdle();
      const raw=source(command.sourceBinding),value=native(),inv=inventory(value,raw);if(inv.status!=='FLAT_NO_PENDING')fail('USER_MARKET_FLAT_NO_PENDING_REQUIRED');
      if(!finite(performance.timeOrigin)||performance.timeOrigin<=0)fail('USER_MARKET_DOCUMENT_CLOCK_REQUIRED');
      if(typeof crypto?.getRandomValues!=='function')fail('USER_MARKET_PRIVATE_CAPABILITY_NONCE_UNAVAILABLE');
      const nonce=[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16).padStart(8,'0')).join(''),observedAt=now(),id=[++memory.generation,nonce].join(':');memory.lease={id,generation:memory.generation,observedAt,observedPerformance:perf(),documentTimeOrigin:performance.timeOrigin,
        researchUrl:expected.researchUrl,sourceTabId:expected.sourceTabId,direction:command.direction,preset:JSON.parse(JSON.stringify(value.preset)),quote:value.quote,sourceFields:{...raw}};
      return response('USER_MARKET_NATIVE_READY',{observedAt,documentTimeOrigin:performance.timeOrigin,sourceBinding:command.sourceBinding,sourceFields:raw,
        inventory:inv,preset:value.preset,nativeSide:command.direction==='LONG'?'BUY':'SELL',lease:{id,observedAt,expiresAt:observedAt+750,maximumAgeMs:750},submitCapabilityCreated:false});
    }
    if(command.action==='submit_market'){
      if(memory.busy||memory.locked)fail('USER_MARKET_RECONCILIATION_REQUIRED');const intent=command.intent,binding=intentCheck(intent),lease=memory.lease;
      otherModesIdle();
      if(command.testOnly===true||command.synthetic===true)fail('USER_MARKET_TEST_SUBMISSION_FORBIDDEN');
      if(!lease||intent.leaseId!==lease.id||lease.generation!==memory.generation||lease.documentTimeOrigin!==performance.timeOrigin||lease.sourceTabId!==expected.sourceTabId||lease.researchUrl!==expected.researchUrl
        ||now()<lease.observedAt||now()-lease.observedAt>750||perf()<lease.observedPerformance||perf()-lease.observedPerformance>750||lease.direction!==intent.direction)fail('USER_MARKET_PRIVATE_LEASE_EXPIRED_OR_CHANGED');
      const raw=source(binding),value=native(),inv=inventory(value,raw);
      if(inv.status!=='FLAT_NO_PENDING'||fields.some(k=>raw[k]!==lease.sourceFields[k])||value.quote!==lease.quote||!sameNativePreset(value.preset,lease.preset)
        ||!sameNativePreset(intent.preset,value.preset)||intent.quantity!==value.preset.quantity)fail('USER_MARKET_NATIVE_PRESET_SOURCE_OR_ZERO_CHANGED');
      currentTechnicalEntry(intent,value.quote);memory.busy=true;ownsBusy=true;
      consume(intent.key,intent.sharedReservationKey);
      // Storage reservation is followed by a final same-source native re-read;
      // the current quote must still preserve a frozen confirmed setup.
      const finalRaw=source(binding),finalValue=native(),finalInventory=inventory(finalValue,finalRaw);
      if(memory.lease!==lease||memory.generation!==lease.generation||now()<lease.observedAt||now()-lease.observedAt>750||perf()<lease.observedPerformance||perf()-lease.observedPerformance>750
        ||now()>intent.expiresAt||fields.some(k=>finalRaw[k]!==lease.sourceFields[k])||finalInventory.status!=='FLAT_NO_PENDING'||finalValue.quote!==lease.quote
        ||!sameNativePreset(finalValue.preset,lease.preset))fail('USER_MARKET_FINAL_NATIVE_PRESET_SOURCE_OR_ZERO_CHANGED');
      currentTechnicalEntry(intent,finalValue.quote);
      const button=intent.direction==='LONG'?finalValue.buy:finalValue.sell;
      memory.locked=true;memory.lease=null;
      memory.own={intent:JSON.parse(JSON.stringify(intent)),generation:memory.generation,submittedAt:now(),documentTimeOrigin:performance.timeOrigin,submittedPerformance:perf(),baseline:inv,interfered:false,fillVerified:false};
      gestureStarted=true;button.click();
      return response('USER_MARKET_SUBMITTED_UNCONFIRMED',{submitted:true,submissionAttempted:true,ordersCreated:null,key:intent.key,
        attribution:attribution(memory.own),userPreset:value.preset,submitCapabilityCreated:false,
        technicalEntryWitness:memory.own.intent.technicalEntryWitness,
        reasonCodes:['USER_MARKET_NATIVE_FILL_AND_USER_PROTECTION_NOT_YET_VERIFIED'],documentTimeOrigin:performance.timeOrigin,submittedPerformance:memory.own.submittedPerformance,
        verificationEpochMs:performance.timeOrigin+perf()});
    }
    if(command.action==='verify_market'){
      const own=memory.own,intent=own?.intent,binding=command.lifecycleSourceBinding??command.sourceBinding??intent?.sourceBinding;
      if(!own||own.intent.key!==command.intent?.key||own.interfered)fail('USER_MARKET_PRIVATE_SUBMISSION_REQUIRED');
      if(binding?.runId!==intent.sourceBinding.runId||binding?.runEpoch!==intent.sourceBinding.runEpoch||binding?.eventId!==intent.sourceBinding.eventId||binding?.asOfTime<intent.sourceBinding.asOfTime||binding?.sourceTabId!==expected.sourceTabId||performance.timeOrigin!==own.documentTimeOrigin)fail('USER_MARKET_LIFECYCLE_SOURCE_CHANGED');
      const raw=source(binding),value=native(),match=/^(-?\d+) @ ([\d,]+\.\d{2})$/.exec(label(value.position).replace(/^\u2212(?=\d)/,'-')),classes=value.position.getAttribute('class')??'',
        direction=/(?:^|\s)buy-/.test(classes)?'LONG':/(?:^|\s)sell-/.test(classes)?'SHORT':null,quantity=match?Math.abs(number(match[1])):null,entry=match?number(match[2]):null;
      if(!match||quantity!==intent.quantity||direction!==intent.direction||!tick(entry)||direction==='LONG'&&number(match[1])<0||!label(value.pnl)||label(value.pnl)==='—')fail('USER_MARKET_OWN_NATIVE_POSITION_UNVERIFIED');
      own.fillVerified=true;
      return response('USER_MARKET_FILLED',{submitted:true,ordersCreated:true,fillVerified:true,attribution:attribution(own),userPreset:intent.preset,
        technicalEntryWitness:intent.technicalEntryWitness,
        position:{kind:'NATIVE_REPLAY_DOM_USER_MARKET_POSITION_V1',symbol:'NQ1!',direction,quantity,entry,nativePositionText:label(value.position),pnlText:label(value.pnl),
          sourceFields:raw,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()},
        protectionState:'USER_MANAGED_NOT_VERIFIED',managementHandedToUser:true,documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()});
    }
    fail('USER_MARKET_UNKNOWN_ACTION');
  }catch(error){
    memory.lease=null;const reason=typeof error?.userMarketCode==='string'?error.userMarketCode:'USER_MARKET_NATIVE_COMMAND_FAILED';
    if(gestureStarted||command.action==='verify_market'&&memory.own){memory.locked=true;return response('UNKNOWNLOCK',{reasonCodes:[reason],submitted:memory.own?true:null,executionLocked:true,ordersCreated:null});}
    return response('BLOCKED',{reasonCodes:[reason],submitCapabilityCreated:false});
  }finally{if(ownsBusy)memory.busy=false;}
}
