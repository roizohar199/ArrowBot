// Serialized into the selected research tab's ISOLATED world. Public controls
// only. Replay Trading is distinct from ordinary Paper Trading. A test draft
// never creates a submission capability. A click is never reported as a fill.
// A pinned manual Replay test verified passive parent brackets and native TP.
// Approved execution uses a private current-symbol DOM zero-state witness,
// unchanged source, a passive frozen plan and a durable single-attempt ledger.
// Unsigned intent JSON is not an engine attestation or a real-broker credential.
export async function replayTradingUiCommand(command={}){
  command=command??{};
  const norm=value=>String(value??'').replace(/\s+/g,' ').trim();
  const number=value=>{const valueText=norm(value).replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(valueText)?Number(valueText):null;};
  const text=(value,max=512)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
  const finite=Number.isFinite,integer=Number.isSafeInteger,tick=value=>finite(value)&&value>0&&integer(value/.25);
  const visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(rect=>rect.width>0&&rect.height>0))return false;
    for(let current=node;current;current=current.parentElement){
      const style=getComputedStyle(current);
      if(style.visibility==='hidden'||style.visibility==='collapse'||style.display==='none'||style.contentVisibility==='hidden')return false;
      if(current!==node){
        const clips=value=>['hidden','clip','auto','scroll'].includes(value),
          clipX=clips(style.overflowX??style.overflow),clipY=clips(style.overflowY??style.overflow);
        if(clipX||clipY){const rect=current.getBoundingClientRect?.()??current.getClientRects()[0];
          if(!rect||clipX&&rect.width<=0||clipY&&rect.height<=0)return false;}
      }
    }
    return true;
  };
  const all=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible);
  const exactly=(selector,root=document)=>{const nodes=all(selector,root);return nodes.length===1?nodes[0]:null;};
  const label=node=>norm(node?.getAttribute('aria-label')||node?.innerText||node?.textContent);
  const named=(name,root=document)=>{const nodes=all('button,[role="button"],[role="tab"]',root).filter(node=>label(node)===name);return nodes.length===1?nodes[0]:null;};
  const disabled=node=>!node||node.disabled===true||node.getAttribute('aria-disabled')==='true';
  const fail=(code,details)=>{throw Object.assign(new Error(code),{replayCode:code,...(details?{replayDetails:details}:{})});};
  const fields=['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END','ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'];
  const now=()=>Date.now(),perf=()=>performance.now();
  const expected=command.expected??{},slot=Symbol.for('arrow.replay-trading-ui.v1');
  const memory=globalThis[slot]??(globalThis[slot]={version:1,generation:0,busy:false,prepared:null,usedKeys:[],locked:false,lastSubmission:null});
  const response=(status,extra={})=>({status,provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',submitted:false,
    ordersCreated:memory.lastSubmission?null:false,fillVerified:false,protectionVerified:false,
    realBrokerOrdersAuthorized:false,...extra});
  const blocked=(code,extra={})=>response('BLOCKED',{reasonCodes:[code],...extra});
  let gestureStarted=false,ownsBusy=false;
  function identity({allowOwnedModal=false}={}){
    if(document.visibilityState!=='visible'||document.hidden===true)fail('REPLAY_RESEARCH_DOCUMENT_NOT_VISIBLE');
    const dialogs=all('[role="dialog"]'),ownedModal=allowOwnedModal&&memory.modalOwnerGeneration===memory.generation&&dialogs.length===1
      &&dialogs[0].getAttribute('data-name')==='order-dialog-popup'?dialogs[0]:null;
    if(dialogs.length&&!ownedModal)fail('REPLAY_MODAL_REQUIRES_REVIEW');
    let requested;try{const url=new URL(expected.researchUrl);requested=url.origin+url.pathname;
      if(url.search||url.hash||url.username||url.password)fail('REPLAY_EXPLICIT_RESEARCH_URL_REQUIRED');
    }catch{fail('REPLAY_EXPLICIT_RESEARCH_URL_REQUIRED');}
    const here=location.origin+location.pathname;
    if(location.protocol!=='https:'||!['tradingview.com','www.tradingview.com'].includes(location.hostname)
      ||!/^\/chart\/[A-Za-z0-9_-]+\/$/.test(location.pathname)||here!==requested)fail('REPLAY_RESEARCH_URL_MISMATCH');
    if(expected.instrument!=='CME_MINI:NQ1!'||expected.timeframe!=='1'||!integer(expected.sourceTabId)||expected.sourceTabId<1)fail('REPLAY_EXPLICIT_NQ_RESEARCH_TARGET_REQUIRED');
    const layout=exactly('[aria-label^="Logged in as"]');
    if(!layout||!/Active layout: Arrow /.test(layout.getAttribute('aria-label')??''))fail('REPLAY_NAMED_RESEARCH_LAYOUT_REQUIRED');
    const charts=all('canvas[aria-label^="Chart for "]');
    if(charts.length!==1||charts[0].getAttribute('aria-label')!=='Chart for CME_MINI:NQ1!, 1 minute')fail('REPLAY_SINGLE_NQ_MINUTE_CHART_REQUIRED');
    const replay=exactly('#header-toolbar-replay');
    if(!replay||replay.getAttribute('aria-pressed')!=='true')fail('REPLAY_MUST_BE_ACTIVE');
    const footer=exactly('#footer-chart-panel'),provider=footer&&exactly('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',footer);
    if(!provider||norm(provider.textContent)!=='Replay Trading')fail('REPLAY_TRADING_PANEL_MUST_BE_ACTIVE');
    // The footer may retain an empty Open account manager icon. A visible
    // account manager/selector or an actual broker label is a different target.
    if(all('[aria-label="Account manager"],[data-qa-id="account-selector"]').length
      ||all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]').some(node=>norm(node.textContent)))fail('REPLAY_ORDINARY_BROKER_PANEL_PRESENT');
    const panel=ownedModal??exactly('[aria-label="Trading panel"]'),orderRoot=panel&&exactly('[aria-label="Order ticket"]',panel),
      positionRoot=panel&&exactly('[data-name="position-panel"]',panel),radios=panel?all('[role="radio"]',panel):[],
      domSelected=radios.filter(node=>label(node)==='DOM'&&node.getAttribute('aria-checked')==='true').length===1,
      orderDeselected=radios.filter(node=>label(node)==='Order'&&node.getAttribute('aria-checked')==='false').length===1,
      domRoot=domSelected&&orderDeselected?panel:null,root=orderRoot??positionRoot??domRoot;
    if(!panel||!root||[orderRoot,positionRoot,domRoot].filter(Boolean).length!==1)fail('REPLAY_ORDER_TICKET_REQUIRED');
    const titles=all('[title]',panel).map(node=>node.getAttribute('title')),
      orderTitles=titles.filter(title=>/^NQ1!, order order_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(title??''));
    if(titles.some(title=>/^NQ[HMUZ]20\d\d$/.test(title??'')||/Continuous futures is used for charting/i.test(title??''))||named('R',panel))fail('REPLAY_CONTINUOUS_NQ_TICKET_REQUIRED');
    const logos=all('img[src]',panel).filter(node=>{
      try{const url=new URL(node.getAttribute('src'));return url.protocol==='https:'&&url.hostname==='static.tradingview.com'&&/^\/static\/bundles\/replay-broker\.[a-z0-9]+\.svg$/.test(url.pathname);}catch{return false;}
    }),descriptions=all('div[class*="description-"]',panel),description=descriptions.length===1?norm(descriptions[0].textContent):'';
    if(domRoot){
      if(orderTitles.length||titles.filter(title=>title==='NQ1!').length!==1||logos.length!==1)fail('REPLAY_DOM_PROVIDER_IDENTITY_UNVERIFIED');
      return {researchUrl:here,panel,root,footer,stage:'REPLAY_DOM'};
    }
    if(positionRoot){
      const match=/^(Long|Short) (\d+) @ ([\d,]+\.\d{2})$/.exec(description);
      if(orderTitles.length||titles.filter(title=>title==='NQ1!').length!==1||logos.length!==1||!match)fail('REPLAY_EXISTING_POSITION_IDENTITY_UNVERIFIED');
      return {researchUrl:here,panel,root,footer,stage:'EXISTING_POSITION_PROTECTION',
        positionDescription:{direction:match[1]==='Long'?'LONG':'SHORT',quantity:number(match[2]),entry:number(match[3])}};
    }
    if(orderTitles.length===1&&titles.filter(title=>title==='NQ1!').length===0){
      const match=/^(Buy|Sell) Limit (\d+) @ ([\d,]+\.\d{2})$/.exec(description);
      if(logos.length!==1||!ownedModal&&!exactly('[data-name="order-panel"]',panel)||!match)fail('REPLAY_REGISTERED_PARENT_IDENTITY_UNVERIFIED');
      return {researchUrl:here,panel,root,footer,stage:'REGISTERED_PARENT_MODIFY',modal:!!ownedModal,orderId:orderTitles[0].slice('NQ1!, order '.length),
        parentDescription:{side:match[1],direction:match[1]==='Buy'?'LONG':'SHORT',type:'LIMIT',quantity:number(match[2]),entry:number(match[3])}};
    }
    if(orderTitles.length||titles.filter(title=>title==='NQ1!').length!==1)fail('REPLAY_CONTINUOUS_NQ_TICKET_REQUIRED');
    return {researchUrl:here,panel,root,footer,stage:'NEW_ORDER_TICKET'};
  }
  function installInventoryGuards(){
    if(memory.inventoryGuardsInstalled)return;
    if(typeof document.addEventListener!=='function')fail('REPLAY_INVENTORY_ACTIVITY_GUARD_UNAVAILABLE');
    const invalidate=event=>{
      if(event?.isTrusted===true){memory.inventoryProof=null;memory.prepared=null;memory.generation++;}
    };
    for(const type of ['pointerdown','keydown','wheel','touchstart','beforeinput','visibilitychange','pagehide'])document.addEventListener(type,invalidate,{capture:true,passive:true});
    memory.inventoryGuardsInstalled=true;
  }
  function domInventory(bound,source){
    if(bound.stage!=='REPLAY_DOM')fail('REPLAY_SELECTED_DOM_INVENTORY_REQUIRED');
    const get=key=>exactly(`[data-qa-id="${key}"]`,bound.root),buyCancel=get('cancel-all-buy-orders'),sellCancel=get('cancel-all-sell-orders'),
      position=get('position-DOM'),pnl=get('switch-pl-view'),buy=get('buy-market-dom'),sell=get('sell-market-dom'),
      cancelAll=get('cancel-all-orders-dom'),quantity=exactly('input[data-qa-id~="qty-dom-input"]',bound.root),
      prices=all('[data-qa-id^="dom-cell-"]',bound.root).filter(node=>/^dom-cell-\d+-price$/.test(node.getAttribute('data-qa-id')??'')),
      highlighted=prices.filter(node=>(node.getAttribute('class')??'').includes('__value--highlighted-')),
      quote=highlighted.length===1?number(highlighted[0].textContent):null;
    if(!buyCancel||!sellCancel||!position||!pnl||disabled(position)||disabled(pnl)||label(buy)!=='Buy Mkt'||disabled(buy)
      ||label(sell)!=='Sell Mkt'||disabled(sell)||label(cancelAll)!=='CXL All'||disabled(cancelAll)
      ||!quantity||quantity.disabled||quantity.readOnly||number(quantity.value)!==1||!tick(quote)
      ||prices.length<3||prices.length>500||prices.some(node=>!tick(number(node.textContent))))fail('REPLAY_HEALTHY_DOM_INVENTORY_CONTROLS_REQUIRED');
    const positionText=norm(position.textContent),pnlText=norm(pnl.textContent),positionEmpty=positionText==='—'&&pnlText==='—',
      pendingEmpty=buyCancel.disabled===true&&sellCancel.disabled===true,
      sideStateKnown=[buyCancel,sellCancel].every(node=>typeof node.disabled==='boolean'&&node.getAttribute('aria-disabled')!=='true');
    if(!sideStateKnown)fail('REPLAY_NATIVE_SIDE_CANCEL_STATE_REQUIRED');
    if(pendingEmpty&&all('[data-qa-id^="dom-cell-"]',bound.root).filter(node=>/^dom-cell-\d+-orders-(buy|sell)$/.test(node.getAttribute('data-qa-id')??''))
      .some(cell=>all('div[class*="tv-dom-widget-order-"]',cell).length))fail('REPLAY_DOM_EMPTY_COUNTERS_CONTRADICT_VISIBLE_ORDERS');
    const result={kind:'REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1',status:positionEmpty?(pendingEmpty?'FLAT_NO_PENDING':'PENDING_ORDERS_PRESENT'):'POSITION_REQUIRES_RECONCILIATION',
      provider:'REPLAY_TRADING',scope:'CURRENT_REPLAY_SYMBOL_ONLY',instrument:'CME_MINI:NQ1!',timeframe:'1',researchUrl:bound.researchUrl,
      sourceTabId:expected.sourceTabId,observedAt:now(),documentTimeOrigin:performance.timeOrigin,quote,
      positionMarker:positionText,pnlMarker:pnlText,buyCancelDisabled:buyCancel.disabled,sellCancelDisabled:sellCancel.disabled,
      positionEmpty,pendingEmpty,flat:positionEmpty?true:null,positions:positionEmpty?[]:null,workingOrders:pendingEmpty?[]:null,
      positionsComplete:positionEmpty,workingOrdersComplete:pendingEmpty,sourceFields:source.fields,
      totalQuantityLabelsUsedAsEvidence:false,visibleOrderCellsUsedAsInventory:false,cancelAllEnabledUsedAsZeroEvidence:false,
      proofScope:'NATIVE_CURRENT_NQ_SYMBOL_AGGREGATE_ZERO_STATE_NOT_OTHER_SYMBOLS_ACCOUNTS_OR_ORDER_ID_ENUMERATION',
      orderEligible:false,submissionAuthorized:false,ordersCreated:false};
    result.visiblePriceBounds={min:Math.min(...prices.map(node=>number(node.textContent))),max:Math.max(...prices.map(node=>number(node.textContent)))};
    memory.inventoryProof=null;
    if(positionEmpty&&pendingEmpty){
      if(!finite(performance.timeOrigin)||performance.timeOrigin<=0)fail('REPLAY_DOCUMENT_TIME_ORIGIN_REQUIRED');
      memory.inventoryProof=Object.freeze({generation:memory.generation,researchUrl:bound.researchUrl,sourceTabId:expected.sourceTabId,
        sourceFields:Object.freeze({...source.fields}),documentTimeOrigin:performance.timeOrigin,observedAt:result.observedAt,
        observedPerformance:perf(),expiresAt:result.observedAt+750});
    }
    return {...result,sourceLeaseStored:!!memory.inventoryProof,sourceLeaseExpiresAt:memory.inventoryProof?.expiresAt??null};
  }
  function inventoryLease(source,bound){
    const proof=memory.inventoryProof;
    if(!proof||proof.generation!==memory.generation||proof.researchUrl!==bound.researchUrl||proof.sourceTabId!==expected.sourceTabId
      ||proof.documentTimeOrigin!==performance.timeOrigin||now()<proof.observedAt||now()>proof.expiresAt
      ||perf()<proof.observedPerformance||perf()-proof.observedPerformance>750
      ||fields.some(key=>proof.sourceFields[key]!==source.fields[key])){
      memory.inventoryProof=null;fail('REPLAY_PRIVATE_INVENTORY_SOURCE_LEASE_EXPIRED_OR_CHANGED');
    }
    return {status:'INVENTORY_SOURCE_LEASE_CURRENT',scope:'CURRENT_REPLAY_SYMBOL_PREFLIGHT_ONLY',observedAt:proof.observedAt,
      expiresAt:proof.expiresAt,documentTimeOrigin:proof.documentTimeOrigin,sourceFields:{...proof.sourceFields},
      stage:bound.stage,orderEligible:false,submissionAuthorized:false,submitCapabilityCreated:false};
  }
  function ticket(bound=identity()){
    const root=bound.root,read=selector=>{const node=exactly(selector,root);return node?number(node.value):null;};
    const quote=side=>{const node=exactly(`[data-name="side-control-${side}"]`,root);
      return node?number(norm(node.textContent).replace(new RegExp('^'+(side==='buy'?'Buy':'Sell')+'\\s*'),'')):null;};
    const selected=all('[role="tab"][aria-selected="true"]',root),stopSwitch=exactly('[data-qa-id="order-ticket-stop-loss-checkbox-bracket"]',root),targetSwitch=exactly('[data-qa-id="order-ticket-take-profit-checkbox-bracket"]',root);
    const stopMode=named('Stop loss price',root)?'PRICE':named('Stop loss ticks',root)?'TICKS':null,
      targetMode=named('Take profit price',root)?'PRICE':named('Take profit ticks',root)?'TICKS':null;
    const entry=bound.positionDescription?.entry??read('input[data-qa-id~="order-ticket-absolute-price-input"]'),stopValue=read('input[data-qa-id~="order-ticket-stop-loss-input"]'),
      targetValue=read('input[data-qa-id~="order-ticket-take-profit-input"]');
    const tickMatch=/Tick value\s*([\d,.]+)\s*USD/.exec(norm(root.textContent)),bid=quote('sell'),ask=quote('buy');
    return {root,stage:bound.stage,symbol:'NQ1!',type:bound.stage==='EXISTING_POSITION_PROTECTION'?'POSITION':bound.stage==='REGISTERED_PARENT_MODIFY'?bound.parentDescription.type:selected.length===1?norm(selected[0].textContent).toUpperCase():null,
      quantity:bound.positionDescription?.quantity??read('input[aria-label="Units"]'),entry,bid,ask,quote:bid===ask?bid:null,
      tickValue:tickMatch?number(tickMatch[1]):null,stopMode,targetMode,
      stopPrice:stopMode==='PRICE'?stopValue:null,targetPrice:targetMode==='PRICE'?targetValue:null,
      stopTicks:stopMode==='PRICE'&&finite(entry)&&finite(stopValue)?Math.abs(entry-stopValue)/.25:null,
      targetTicks:targetMode==='PRICE'&&finite(entry)&&finite(targetValue)?Math.abs(targetValue-entry)/.25:null,
      stopEnabled:stopSwitch?.checked===true&&stopSwitch.getAttribute('aria-checked')==='true',
      targetEnabled:targetSwitch?.checked===true&&targetSwitch.getAttribute('aria-checked')==='true'};
  }
  function expectedPlanComparison(value,direction,override=null){
    const plan=override??command.expectedPlan??command.intent;if(!plan)return null;
    const normalized={stopMode:'PRICE',targetMode:'PRICE',...plan},commission=normalized.commissionPerContract??normalized.riskPlan?.parameterSnapshot?.commissionPerContract??normalized.parameterSnapshot?.commissionPerContract,
      slippage=normalized.slippageTicks??normalized.riskPlan?.parameterSnapshot?.slippageTicks??normalized.parameterSnapshot?.slippageTicks,arithmetic=validatePrices(normalized,commission,slippage),
      matched=normalized.direction===direction&&normalized.quantity===value.quantity&&normalized.entry===value.entry&&normalized.stop===value.stopPrice&&normalized.target===value.targetPrice;
    return {matches:matched,totalPlannedRisk:arithmetic.total,commissionAllowance:commission,slippageReserveTicks:slippage,
      scope:'CALLER_PLAN_COMPARISON_NOT_SIGNAL_APPROVAL'};
  }
  function registeredParent(bound,value,expectedPlan=null){
    if(bound.stage!=='REGISTERED_PARENT_MODIFY')return null;
    const confirm=exactly('[data-name="place-and-modify-button"]',value.root),discard=exactly('[data-name="button-back"]',value.root),
      description=bound.parentDescription,reasons=[];
    const close=bound.modal?exactly('[data-qa-id="button-close"][aria-label="Close button"]',bound.panel):null;
    if(label(confirm)!=='Confirm'||!disabled(confirm)||(bound.modal?disabled(close):label(discard)!=='Discard'||disabled(discard)))reasons.push('REPLAY_PARENT_EDITOR_DIRTY_OR_UNSETTLED');
    if(value.type!=='LIMIT'||description.quantity!==1||value.quantity!==1||value.entry!==description.entry||!tick(value.entry)||value.tickValue!==5)reasons.push('REPLAY_PARENT_DESCRIPTION_AND_TICKET_MISMATCH');
    if(value.stopMode!=='PRICE'||value.targetMode!=='PRICE'||!value.stopEnabled||!value.targetEnabled||![value.stopPrice,value.targetPrice].every(tick)
      ||!(description.direction==='LONG'?value.stopPrice<value.entry&&value.targetPrice>value.entry:value.stopPrice>value.entry&&value.targetPrice<value.entry))reasons.push('REPLAY_REGISTERED_PARENT_BRACKETS_UNVERIFIED');
    const comparison=expectedPlanComparison(value,description.direction,expectedPlan);
    if(comparison&&!comparison.matches)reasons.push('REPLAY_REGISTERED_PARENT_PLAN_MISMATCH');
    return {kind:'REPLAY_EXISTING_PARENT_MODIFY_PUBLIC_V1',status:reasons.length?'REGISTERED_PARENT_UNVERIFIED':'REGISTERED_PARENT_BRACKETS_VERIFIED',
      orderId:bound.orderId,symbol:'NQ1!',direction:description.direction,orderType:'LIMIT',quantity:value.quantity,entry:value.entry,
      stop:value.stopPrice,target:value.targetPrice,stopTicks:value.stopTicks,targetTicks:value.targetTicks,
      bracketsEnabled:value.stopEnabled&&value.targetEnabled,configurationVerified:reasons.length===0,expectedPlanComparison:comparison,
      confirmDisabled:disabled(confirm),discardAvailable:!!discard&&!disabled(discard),reasonCodes:reasons,
      closeWithoutModificationAvailable:!!close&&!disabled(close),
      proofScope:'ONE_EXISTING_PARENT_CONFIGURATION_NOT_ALL_PENDING_ORDERS_OR_POST_FILL_PROTECTION',
      fillVerified:false,protectionVerified:false,ordersCreated:false,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()};
  }
  function protectedPosition(bound,value){
    if(bound.stage!=='EXISTING_POSITION_PROTECTION')return null;
    const read=key=>{const node=exactly(`[data-qa-id="${key}"]`,value.root);return node?norm(node.textContent):null;},
      description=bound.positionDescription,confirm=exactly('[data-name="place-and-modify-button"]',value.root),discard=exactly('[data-name="button-back"]',value.root),
      reasons=[],tradeValue=number(read('position-info-trade-value')),tickValue=number(read('position-info-pip-value')),
      tradeCurrency=read('position-info-trade-value-currency'),tickCurrency=read('position-info-pip-value-currency');
    const positionVerified=description.quantity===1&&tick(value.entry)&&tradeValue===value.entry*20&&tradeCurrency==='USD'&&tickValue===5&&tickCurrency==='USD'&&value.tickValue===5;
    if(!positionVerified)reasons.push('REPLAY_EXISTING_POSITION_CONTRACT_UNVERIFIED');
    if(label(confirm)!=='Confirm'||!disabled(confirm)||label(discard)!=='Discard'||disabled(discard))reasons.push('REPLAY_POSITION_EDITOR_DIRTY_OR_UNSETTLED');
    if(value.stopMode!=='PRICE'||value.targetMode!=='PRICE'||!value.stopEnabled||!value.targetEnabled||![value.stopPrice,value.targetPrice].every(tick)
      ||!(description.direction==='LONG'?value.stopPrice<value.entry&&value.targetPrice>value.entry:value.stopPrice>value.entry&&value.targetPrice<value.entry))reasons.push('REPLAY_ACTIVE_POSITION_BRACKETS_UNVERIFIED');
    const comparison=expectedPlanComparison(value,description.direction);
    if(comparison&&!comparison.matches)reasons.push('REPLAY_ACTIVE_POSITION_PLAN_MISMATCH');
    const configured=reasons.length===0,matched=configured&&comparison?.matches===true;
    return {kind:'REPLAY_EXISTING_POSITION_PROTECTION_PUBLIC_V1',status:matched?'PROTECTED_POSITION_VERIFIED':configured?'POSITION_CONFIGURATION_VERIFIED':'POSITION_PROTECTION_UNVERIFIED',
      symbol:'NQ1!',direction:description.direction,quantity:value.quantity,entry:value.entry,stop:value.stopPrice,target:value.targetPrice,
      stopTicks:value.stopTicks,targetTicks:value.targetTicks,grossStopRisk:configured?value.stopTicks*5:null,
      totalPlannedRisk:matched?comparison.totalPlannedRisk:null,tradeValue,tickValue,configurationVerified:configured,
      expectedPlanComparison:comparison,confirmDisabled:disabled(confirm),discardAvailable:!!discard&&!disabled(discard),reasonCodes:reasons,
      fillVerified:positionVerified,protectionVerified:matched,atomicBracketSubmissionVerified:false,naturalSignalVerified:false,
      ordersCreated:false,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf(),
      proofScope:'ONE_CURRENT_VIRTUAL_POSITION_CONFIGURATION_NOT_PARENT_CORRELATION_SIGNAL_OR_ATOMIC_TIMING'};
  }
  function publicSource(binding){
    const selected=all('[role="tab"][aria-selected="true"]').filter(node=>/data\s*window/i.test(label(node)));
    if(selected.length!==1)fail('REPLAY_VISIBLE_DATA_WINDOW_REQUIRED');
    const studies=all('[role="treegrid"] [role="row"][data-role="menuitem"]').filter(row=>all('span[title]',row)
      .some(node=>(node.getAttribute('title')??'').startsWith('Arrow OHLC Window v2')));
    if(studies.length!==1)fail('REPLAY_OWNED_SOURCE_STUDY_REQUIRED');
    const observed={};
    for(const key of fields){const node=exactly(`[data-test-id-value-title="${key}"]`,studies[0]),parent=node?.parentElement;
      if(!node||!parent||parent.children.length!==2||parent.children[0]!==node)fail('REPLAY_PUBLIC_SOURCE_FIELD_STRUCTURE_CHANGED');
      const raw=parent.children[1].textContent;if(!text(raw,128)||!integer(number(raw)))fail('REPLAY_PUBLIC_SOURCE_FIELD_NOT_CURRENT');observed[key]=raw;}
    if(!binding)return {fields:observed,observedAt:now()};
    if(!text(binding.runId)||!integer(binding.runEpoch)||binding.runId!=='CME_MINI:NQ1!|1|'+binding.runEpoch
      ||number(observed.ARROW2_RUN_EPOCH)!==binding.runEpoch||number(observed.ARROW2_SEQ_BEGIN)!==binding.sequence
      ||number(observed.ARROW2_SEQ_END)!==binding.sequence||fields.some(key=>observed[key]!==binding.fields?.[key])
      ||!integer(binding.currentTime)||!integer(binding.currentCloseTime)||binding.currentCloseTime-binding.currentTime!==60000
      ||!integer(binding.asOfTime)||!text(binding.eventId)||binding.sourceTabId!==undefined&&binding.sourceTabId!==expected.sourceTabId
      ||Math.floor(number(observed.ARROW2_CURRENT_TIME)/1e12)!==binding.sequence%4096
      ||number(observed.ARROW2_CURRENT_TIME)%1e12+1577836800000!==binding.currentTime)fail('REPLAY_SOURCE_RUN_CURSOR_OR_EVENT_CHANGED');
    return {...binding,fields:observed};
  }
  function tradingTables(){
    // Discovery is read-only and bounded. Never reuse Paper tables or the chart
    // Data Window grid. Until an actual Replay position/order schema is observed
    // and supported, absence of rows is not evidence of a flat virtual account.
    const tables=all('table[data-name]').filter(table=>/replay/i.test(table.getAttribute('data-name')??''));
    const parsed=[];
    for(const table of tables.slice(0,8)){
      const headers=[...table.querySelectorAll('thead th')].map(node=>({id:node.id??'',text:norm(node.textContent)}));
      const body=table.querySelector('tbody');
      parsed.push({name:table.getAttribute('data-name'),headers:headers.slice(0,30),rowCount:body?[...body.querySelectorAll('tr')].length:null,
        emptyText:body?norm(body.textContent).slice(0,240):null});
    }
    return {verified:false,positions:null,workingOrders:null,flat:null,tables:parsed,
      reason:'REPLAY_POSITION_AND_PENDING_ORDER_SCHEMA_UNVERIFIED'};
  }
  function evidence(binding){
    const bound=identity(),currentTicket=ticket(bound),source=publicSource(binding),trading=tradingTables(),parent=registeredParent(bound,currentTicket),position=protectedPosition(bound,currentTicket);
    const {root,...ticketValue}=currentTicket;
    return {status:trading.verified?'REPLAY_TRADING_UI_VERIFIED':'REPLAY_TRADING_UI_INCOMPLETE',provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',
      observedAt:now(),researchUrl:bound.researchUrl,sourceTabId:expected.sourceTabId,instrument:'CME_MINI:NQ1!',timeframe:'1',replay:true,chartCount:1,
      flat:position?.fillVerified?false:trading.flat,positions:position?.fillVerified?[position]:trading.positions,
      positionsComplete:false,workingOrdersComplete:false,workingOrders:trading.workingOrders,sourceBinding:binding?source:null,
      sourceFields:source.fields,ticket:ticketValue,positionAndOrderEvidence:trading,
      registeredParent:parent,
      protectedPosition:position,
      reasonCodes:trading.verified?[]:[trading.reason],atomicBracketSubmissionVerified:false,ordersCreated:false};
  }
  function freshIntent(value){
    const validTime=integer(value?.expiresAt)&&value.expiresAt>=now()&&value.expiresAt-now()<=2000;
    if(!value||value.kind!=='TRADINGVIEW_REPLAY_TRADING_LIMIT_INTENT'||value.definitionVersion!=='replay-execution-intent-2'
      ||value.provider!=='REPLAY_TRADING'||value.mode!=='REPLAY_TRADING'||value.scope!=='VIRTUAL_REPLAY_TRADING_INTENT_ONLY'
      ||value.unsigned!==true||value.signalApproved!==true||value.testOnly!==false||value.submissionAuthorized!==false
      ||value.ordersCreated!==false||value.orderEligible!==false||value.realBrokerOrdersAuthorized!==false
      ||value.requiresReplayUiRevalidation!==true||value.quantity!==1||value.orderType!=='LIMIT'||value.symbol!=='NQ1!'
      ||value.instrument!=='CME_MINI:NQ1!'||value.timeframe!=='1'||!text(value.key,2500)||!validTime
      ||!integer(value.preparedAt)||value.preparedAt>now()||now()-value.preparedAt>2000
      ||value.researchUrl!==expected.researchUrl||value.sourceBinding?.sourceTabId!==expected.sourceTabId)fail('REPLAY_STRICT_UNSIGNED_INTENT_REQUIRED');
    let json;try{json=JSON.stringify(value);}catch{fail('REPLAY_BOUNDED_INTENT_JSON_REQUIRED');}
    if(json.length>30000)fail('REPLAY_BOUNDED_INTENT_JSON_REQUIRED');
    const binding=value.sourceBinding,requiredKey=['replay-execution-intent-2',value.researchUrl,binding.sourceTabId,binding.runId,
      binding.asOfTime,binding.eventId].map(encodeURIComponent).join(':');
    if(value.key!==requiredKey||binding.eventId!=='CME_MINI:NQ1!:1:'+binding.asOfTime+':'+value.direction
      ||!['current','previous'].includes(binding.closedBarRole)
      ||binding.asOfTime!==(binding.closedBarRole==='current'?binding.currentCloseTime:binding.currentTime))fail('REPLAY_INTENT_KEY_OR_CUTOFF_MISMATCH');
    const quote=value.quoteProof,approval=value.approvalProof,flags=['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'],
      checks=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
    if(!quote||quote.kind!=='PASSIVE_NATIVE_REPLAY_QUOTE'||!tick(quote.quote)||quote.bid!==quote.quote||quote.ask!==quote.quote
      ||quote.documentTimeOrigin!==performance.timeOrigin||quote.sourceCurrentClose!==quote.quote||quote.minimumDistanceTicks!==1||quote.pricesAdjusted!==false||!integer(quote.observedAt)||quote.observedAt>now()||now()-quote.observedAt>2000
      ||quote.distanceTicks!==(quote.quote-value.entry)*(value.direction==='LONG'?1:-1)/.25||!integer(quote.distanceTicks)||quote.distanceTicks<1)fail('REPLAY_APPROVED_PASSIVE_QUOTE_REQUIRED');
    if(!approval||approval.engineDefinitionVersion!=='guide-signals-5'||approval.eventId!==binding.eventId||approval.asOfTime!==binding.asOfTime
      ||approval.direction!==value.direction||approval.confirmationPolicy!=='later_close_beyond_setup'||approval.confirmationBarCloseTime!==binding.asOfTime
      ||!integer(approval.detectedAt)||approval.detectedAt>=binding.asOfTime||approval.signalApproved!==true||approval.testOnly!==false
      ||approval.roleReversalEnabled!==true||approval.supplyDemandEnabled!==true||flags.some(key=>approval.requiredFlags?.[key]!==true)
      ||!Array.isArray(approval.requiredChecks)||approval.requiredChecks.length!==checks.length
      ||checks.some(id=>approval.requiredChecks.filter(check=>check.id===id&&check.required===true&&check.enabled===true&&check.available===true&&check.passed===true&&check.state==='PASS').length!==1))fail('REPLAY_FROZEN_ALL_REQUIRED_APPROVAL_PROOF_REQUIRED');
    const pending=value.pendingPolicy;
    if(!pending||pending.kind!=='KNOWN_PARENT_ONLY_CLOSED_REPLAY_BAR_EXPIRY'||!integer(pending.expiresAfterClosedBars)||pending.expiresAfterClosedBars<1||pending.expiresAfterClosedBars>100
      ||pending.afterConfirmationClose!==binding.asOfTime||pending.expiresAtReplayCloseTime!==binding.asOfTime+pending.expiresAfterClosedBars*60000
      ||pending.cancelOnlyWhileReplayPaused!==true||pending.neverCancelAll!==true)fail('REPLAY_FROZEN_KNOWN_PARENT_EXPIRY_POLICY_REQUIRED');
    const arithmetic=validatePrices(value,value.riskPlan?.parameterSnapshot?.commissionPerContract,value.riskPlan?.parameterSnapshot?.slippageTicks);
    const risk=value.riskPlan;
    if(risk?.status!=='PLANNED'||risk.quantity!==1||risk.ordersCreated!==false||risk.fillInferred!==false
      ||risk.initialStop!==value.stop||risk.plannedEntry!==value.entry||risk.effectiveEntry!==value.entry||risk.actualEntry!==null
      ||risk.target!==value.target||risk.parameterSnapshot.riskBudget!==200||risk.parameterSnapshot.maxContracts!==1
      ||risk.parameterSnapshot.pointValue!==20||risk.parameterSnapshot.tickSize!==.25
      ||!finite(risk.totalPlannedRisk)||Math.abs(risk.totalPlannedRisk-arithmetic.total)>1e-8
      ||!finite(risk.perContractRisk)||Math.abs(risk.perContractRisk-arithmetic.total)>1e-8||risk.riskTicks!==arithmetic.riskTicks
      ||risk.commissionAllowance!==risk.parameterSnapshot.commissionPerContract
      ||risk.slippageAllowance!==risk.parameterSnapshot.slippageTicks*5)fail('REPLAY_INTENT_RISK_PLAN_MISMATCH');
    return {intent:value,json};
  }
  function validatePrices(value,commission,slippage){
    if(!value||!['LONG','SHORT'].includes(value.direction)||value.quantity!==1||![value.entry,value.stop,value.target].every(tick)
      ||value.stopMode!=='PRICE'||value.targetMode!=='PRICE'||!finite(commission)||commission<0||!finite(slippage)||slippage<0)fail('REPLAY_ABSOLUTE_PRICE_PLAN_REQUIRED');
    const sign=value.direction==='LONG'?1:-1,riskTicks=(value.entry-value.stop)*sign/.25,rewardTicks=(value.target-value.entry)*sign/.25,
      total=riskTicks*5+commission+slippage*5;
    if(!integer(riskTicks)||riskTicks<1||!integer(rewardTicks)||rewardTicks<1||total>200||total<=0
      ||value.stopTicks!==undefined&&value.stopTicks!==riskTicks||value.targetTicks!==undefined&&value.targetTicks!==rewardTicks)fail('REPLAY_ONE_NQ_TOTAL_RISK_EXCEEDS_200');
    // This local calculation is returned separately; never mutate a frozen
    // caller intent in order to add an implementation-only field.
    return {riskTicks,rewardTicks,total};
  }
  function sameTicket(value,intent){
    const button=exactly('[data-name="place-and-modify-button"]',value.root),caption=norm(button?.textContent),side=intent.direction==='LONG'?'Buy':'Sell';
    return value.symbol==='NQ1!'&&value.type==='LIMIT'&&value.quantity===1&&value.tickValue===5&&value.entry===intent.entry
      &&tick(value.quote)&&(intent.direction==='LONG'?intent.entry<=value.quote-.25:intent.entry>=value.quote+.25)
      &&value.stopMode==='PRICE'&&value.targetMode==='PRICE'&&value.stopPrice===intent.stop
      &&value.targetPrice===intent.target&&value.stopEnabled&&value.targetEnabled&&value.stage==='NEW_ORDER_TICKET'&&!!button&&!disabled(button)
      &&caption.startsWith(side+' ')&&caption.includes('1 NQ1!')&&caption.endsWith('LIMIT');
  }
  function passiveLimit(value,intent){
    if(!tick(value.quote))fail('REPLAY_NATIVE_CURRENT_QUOTE_REQUIRED');
    const distanceTicks=(value.quote-intent.entry)*(intent.direction==='LONG'?1:-1)/.25;
    if(!integer(distanceTicks)||distanceTicks<1)fail('MARKETABLE_LIMIT_BRACKET_UNSAFE');
    return distanceTicks;
  }
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  async function until(check,guard){
    const started=perf();while(perf()-started<1500){guard();if(check()){await paint();guard();if(check())return;}
      await new Promise(resolve=>setTimeout(resolve,30));}fail('REPLAY_TICKET_CONTROL_DID_NOT_SETTLE');
  }
  async function inputValue(selector,value,guard){
    guard();const input=exactly(selector,ticket().root);
    if(!input||input.disabled||input.readOnly)fail('REPLAY_PRICE_INPUT_NOT_EDITABLE');
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!set)fail('REPLAY_INPUT_SETTER_UNAVAILABLE');
    input.focus({preventScroll:true});if(document.activeElement!==input)fail('REPLAY_PRICE_INPUT_NOT_FOCUSED');
    set.call(input,String(value));
    input.dispatchEvent(typeof InputEvent==='function'?new InputEvent('input',{bubbles:true,composed:true,inputType:'insertReplacementText',data:String(value)}):new Event('input',{bubbles:true,composed:true}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    await paint();guard();
    if(!input.isConnected||exactly(selector,ticket().root)!==input||document.activeElement!==input)fail('REPLAY_FOCUSED_INPUT_REPLACED_BEFORE_COMMIT');
    input.blur();
    await until(()=>{const current=exactly(selector,ticket().root);return current===input&&number(current.value)===value&&document.activeElement!==current;},guard);
  }
  function pausedReplay(){
    const play=exactly('div[data-role="button"][title="Play"]');
    if(!play||!(play.parentElement?.getAttribute('class')??'').includes('controls__control-'))fail('REPLAY_PAUSED_NATIVE_CONTROL_REQUIRED');
  }
  function flowGuard(generation,binding,intent=null,allowTransition=false){
    if(memory.generation!==generation)fail('REPLAY_PREPARATION_CANCELLED');
    try{identity();}catch(error){if(!allowTransition||error?.replayCode!=='REPLAY_ORDER_TICKET_REQUIRED')throw error;}
    pausedReplay();publicSource(binding);if(intent)freshIntent(intent);
  }
  async function selectOrderMode(mode,guard){
    guard();const before=identity(),radios=all('[role="radio"]',before.panel).filter(node=>label(node)===mode);
    if(radios.length!==1||disabled(radios[0]))fail('REPLAY_EXACT_ORDER_DOM_MODE_CONTROL_REQUIRED');
    if(radios[0].getAttribute('aria-checked')!=='true'){
      radios[0].focus({preventScroll:true});radios[0].click();radios[0].blur();
      await until(()=>{
        try{const current=identity();return mode==='DOM'?current.stage==='REPLAY_DOM':current.stage==='NEW_ORDER_TICKET';}
        catch(error){if(error?.replayCode==='REPLAY_ORDER_TICKET_REQUIRED')return false;throw error;}
      },guard);
    }
    guard();const after=identity();
    if(after.stage!==(mode==='DOM'?'REPLAY_DOM':'NEW_ORDER_TICKET'))fail('REPLAY_ORDER_DOM_MODE_DID_NOT_SETTLE');
    return after;
  }
  async function currentZero(generation,binding,intent=null){
    const guard=()=>flowGuard(generation,binding,intent,true),bound=await selectOrderMode('DOM',guard);
    let result=null;
    await until(()=>{
      try{result=domInventory(identity(),publicSource(binding));return true;}
      catch(error){if(error?.replayCode==='REPLAY_HEALTHY_DOM_INVENTORY_CONTROLS_REQUIRED')return false;throw error;}
    },guard);
    if(result.status!=='FLAT_NO_PENDING')fail('REPLAY_NATIVE_SYMBOL_NOT_FLAT_OR_PENDING_ORDERS_PRESENT');
    inventoryLease(publicSource(binding),bound);return {...result,sourceBinding:publicSource(binding)};
  }
  function composedPreflight(inventory,binding){
    const bound=identity(),source=publicSource(binding),lease=inventoryLease(source,bound),value=ticket(bound);
    if(bound.stage!=='NEW_ORDER_TICKET'||value.quantity!==1||value.type!=='LIMIT'||value.tickValue!==5||!tick(value.entry)
      ||!tick(value.quote)||value.quote!==inventory.quote||value.stopMode!=='PRICE'||value.targetMode!=='PRICE')fail('REPLAY_NATIVE_PREFLIGHT_TICKET_REQUIRED');
    const {root,...ticketValue}=value;
    return {status:'REPLAY_TRADING_UI_VERIFIED',provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',replay:true,chartCount:1,
      researchUrl:bound.researchUrl,sourceTabId:expected.sourceTabId,instrument:'CME_MINI:NQ1!',timeframe:'1',observedAt:now(),documentTimeOrigin:performance.timeOrigin,
      flat:true,positions:[],workingOrders:[],positionsComplete:true,workingOrdersComplete:true,
      inventory:{...inventory,sourceBinding:source},sourceBinding:source,sourceFields:source.fields,ticket:ticketValue,privateInventoryLease:lease,
      pausedReplayVerified:true,capabilities:{ownParentCancelVerified:inventory.domEntryPriceVerified===true,domEntryPriceVerified:inventory.domEntryPriceVerified===true,pausedReplayStateVerified:true},
      ordersCreated:false,orderEligible:false,submissionAuthorized:false,submitCapabilityCreated:false};
  }
  async function prepareForm(intent,guard){
    guard();let value=ticket();if(value.stage!=='NEW_ORDER_TICKET')fail('REPLAY_EXISTING_PARENT_IS_READ_ONLY');
    passiveLimit(value,intent);if(value.stopMode!=='PRICE'||value.targetMode!=='PRICE')fail('REPLAY_EXPLICIT_PRICE_UNITS_REQUIRED');
    const side=exactly(`[data-name="side-control-${intent.direction==='LONG'?'buy':'sell'}"]`,value.root);if(!side)fail('REPLAY_SIDE_CONTROL_REQUIRED');
    side.click();await paint();guard();const limit=named('Limit',ticket().root);if(!limit)fail('REPLAY_LIMIT_CONTROL_REQUIRED');limit.click();await paint();
    await inputValue('input[data-qa-id~="order-ticket-absolute-price-input"]',intent.entry,guard);
    await inputValue('input[aria-label="Units"]',1,guard);
    for(const kind of ['stop-loss','take-profit']){
      guard();const toggle=exactly(`[data-qa-id="order-ticket-${kind}-checkbox-bracket"]`,ticket().root);
      if(!toggle||toggle.disabled)fail('REPLAY_BRACKET_SWITCH_REQUIRED');
      toggle.focus({preventScroll:true});if(document.activeElement!==toggle)fail('REPLAY_BRACKET_SWITCH_NOT_FOCUSED');
      if(toggle.getAttribute('aria-checked')!=='true'||toggle.checked!==true){toggle.click();await until(()=>toggle.getAttribute('aria-checked')==='true'&&toggle.checked===true,guard);}
      toggle.blur();await paint();guard();
    }
    await inputValue('input[data-qa-id~="order-ticket-stop-loss-input"]',intent.stop,guard);
    await inputValue('input[data-qa-id~="order-ticket-take-profit-input"]',intent.target,guard);
    guard();value=ticket();if(!sameTicket(value,intent))fail('REPLAY_PREPARED_ABSOLUTE_BRACKETS_MISMATCH');
    return value;
  }
  function attemptLedger(){
    if(typeof sessionStorage==='undefined'||typeof sessionStorage.getItem!=='function'||typeof sessionStorage.setItem!=='function')fail('REPLAY_DURABLE_EVENT_LEDGER_UNAVAILABLE');
    let ledger;try{const raw=sessionStorage.getItem('arrow.replayExecutionAttempts.v2');
      if(raw&&raw.length>800000)fail('REPLAY_DURABLE_EVENT_LEDGER_INVALID');ledger=raw?JSON.parse(raw):{version:2,entries:[]};
    }catch(error){if(error?.replayCode)throw error;fail('REPLAY_DURABLE_EVENT_LEDGER_UNAVAILABLE');}
    if(ledger.version!==2||!Array.isArray(ledger.entries)||ledger.entries.length>256||ledger.entries.some(entry=>!text(entry.key,2500)||!integer(entry.at)||entry.state!=='ATTEMPTED')
      ||new Set(ledger.entries.map(entry=>entry.key)).size!==ledger.entries.length)fail('REPLAY_DURABLE_EVENT_LEDGER_INVALID');
    return ledger;
  }
  function unusedEvent(intent){
    const ledger=attemptLedger();if(memory.usedKeys.includes(intent.key)||ledger.entries.some(entry=>entry.key===intent.key))fail('REPLAY_EVENT_ALREADY_ATTEMPTED');
    if(ledger.entries.length>=256||memory.usedKeys.length>=256)fail('REPLAY_EVENT_LEDGER_FULL');return ledger;
  }
  function consumeEvent(intent){
    const ledger=unusedEvent(intent);ledger.entries.push({key:intent.key,at:now(),state:'ATTEMPTED'});
    try{sessionStorage.setItem('arrow.replayExecutionAttempts.v2',JSON.stringify(ledger));
      if(sessionStorage.getItem('arrow.replayExecutionAttempts.v2')!==JSON.stringify(ledger))fail('REPLAY_DURABLE_EVENT_LEDGER_NOT_PERSISTED');
    }catch(error){if(error?.replayCode)throw error;fail('REPLAY_DURABLE_EVENT_LEDGER_NOT_PERSISTED');}
    memory.usedKeys.push(intent.key);
  }
  function lifecycleBinding(intent){
    const binding=command.lifecycleSourceBinding??command.sourceBinding??intent?.sourceBinding;
    if(intent&&binding&&(binding.runId!==intent.sourceBinding.runId||binding.runEpoch!==intent.sourceBinding.runEpoch
      ||binding.eventId!==intent.sourceBinding.eventId||binding!==intent.sourceBinding&&(binding.approvalAsOfTime!==intent.sourceBinding.asOfTime||binding.asOfTime<intent.sourceBinding.asOfTime)
      ||binding.sourceTabId!==intent.sourceBinding.sourceTabId))fail('REPLAY_LIFECYCLE_SOURCE_IDENTITY_CHANGED');
    return binding;
  }
  function domEntryCell(plan,bound=identity(),requireOrder=false){
    if(bound.stage!=='REPLAY_DOM')fail('REPLAY_SELECTED_DOM_INVENTORY_REQUIRED');
    const priceRows=all('[data-qa-id^="dom-cell-"]',bound.root).filter(node=>/^dom-cell-\d+-price$/.test(node.getAttribute('data-qa-id')??'')&&number(node.textContent)===plan.entry);
    if(priceRows.length!==1)fail('REPLAY_FROZEN_ENTRY_OUTSIDE_VISIBLE_DOM');
    const row=/^dom-cell-(\d+)-price$/.exec(priceRows[0].getAttribute('data-qa-id'))[1],
      cell=exactly(`[data-qa-id="dom-cell-${row}-orders-${plan.direction==='LONG'?'buy':'sell'}"]`,bound.root);
    if(!cell)fail('REPLAY_EXACT_PARENT_SIDE_CELL_REQUIRED');
    if(!requireOrder)return {cell,row};
    const wrappers=all('div[class*="tv-dom-widget-order-"]',cell),wrapper=wrappers.length===1?wrappers[0]:null,
      qty=wrapper&&exactly('span[class*="tv-dom-widget-order__qty-"]',wrapper),type=wrapper&&exactly('span[class*="tv-dom-widget-order__type-"]',wrapper),
      close=wrapper&&exactly('div[class*="tv-dom-widget-order__close-"]',wrapper);
    if(!wrapper||number(qty?.textContent)!==1||norm(type?.textContent)!=='Limit'||!close)fail('REPLAY_UNIQUE_ONE_CONTRACT_LIMIT_PARENT_REQUIRED');
    return {cell,row,wrapper,qty,close};
  }
  function nativePointer(node,count=1){
    if(!visible(node)||typeof MouseEvent!=='function')fail('REPLAY_PUBLIC_POINTER_TARGET_UNAVAILABLE');
    const rect=node.getBoundingClientRect();if(!finite(rect.left)||!finite(rect.top))fail('REPLAY_PUBLIC_POINTER_TARGET_UNAVAILABLE');
    const init={bubbles:true,cancelable:true,composed:true,view:globalThis.window,
      clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,button:0,pointerId:1,pointerType:'mouse',isPrimary:true};
    node.dispatchEvent(new MouseEvent('mouseover',{...init,buttons:0}));node.dispatchEvent(new MouseEvent('mouseenter',{...init,bubbles:false,buttons:0}));
    for(let detail=1;detail<=count;detail++){
      if(typeof PointerEvent==='function')node.dispatchEvent(new PointerEvent('pointerdown',{...init,buttons:1,detail}));
      node.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1,detail}));
      if(typeof PointerEvent==='function')node.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0,detail}));
      node.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0,detail}));node.dispatchEvent(new MouseEvent('click',{...init,buttons:0,detail}));
    }
    if(count===2)node.dispatchEvent(new MouseEvent('dblclick',{...init,buttons:0,detail:2}));
  }
  function ownAttribution(intent,parentOrderId=null){
    const own=memory.lastSubmission;
    if(!intent||!own||own.key!==intent.key||own.baseline!=='NATIVE_CURRENT_NQ_SYMBOL_FLAT_NO_PENDING')return null;
    return {kind:'OWN_SUBMITTED_REPLAY_INTENT',key:own.key,parentOrderId:parentOrderId??own.parentOrderId??null,
      sourceTabId:own.sourceBinding.sourceTabId,runId:own.sourceBinding.runId,baselineFlatVerified:true,submissionRecorded:true};
  }
  async function seekNativeDomPrice(price,guard){
    if(!tick(price))fail('REPLAY_EXACT_NATIVE_SEEK_PRICE_REQUIRED');
    const started=perf(),ranges=[];let steps=0,amount=400,lastDirection=0,stalled=0;
    const book=()=>{
      guard();if(perf()-started>2500)fail('REPLAY_PARENT_PRICE_SEEK_TIME_LIMIT',{targetPrice:price,steps,ranges});
      const bound=identity();if(bound.stage!=='REPLAY_DOM')fail('REPLAY_SELECTED_DOM_INVENTORY_REQUIRED');
      const mains=all('div[class*="tv-dom-widget-main-"]',bound.root).filter(node=>(node.getAttribute('class')??'').split(/\s+/).some(name=>/^tv-dom-widget-main-[A-Za-z0-9_]+$/.test(name)));
      if(mains.length!==1)fail('REPLAY_UNIQUE_PUBLIC_DOM_SCROLL_SURFACE_REQUIRED');
      const rect=mains[0].getBoundingClientRect(),rows=all('[data-qa-id^="dom-cell-"]',bound.root).filter(node=>{
        if(!/^dom-cell-\d+-price$/.test(node.getAttribute('data-qa-id')??''))return false;const r=node.getBoundingClientRect();return r.bottom>rect.top&&r.top<rect.bottom;
      });
      if(rows.length<3||rows.length>500||rows.some(node=>!tick(number(node.textContent))))fail('REPLAY_NATIVE_DOM_VISIBLE_PRICE_ROWS_REQUIRED');
      return {rows,min:Math.min(...rows.map(node=>number(node.textContent))),max:Math.max(...rows.map(node=>number(node.textContent)))};
    };
    let state=book();
    while(!state.rows.some(node=>number(node.textContent)===price)){
      if(steps>=128)fail('REPLAY_PARENT_PRICE_SEEK_STEP_LIMIT',{targetPrice:price,steps,ranges});
      const direction=price>state.max?-1:price<state.min?1:0;if(!direction)fail('REPLAY_PARENT_PRICE_NOT_IN_NATIVE_TICK_ROWS');
      if(lastDirection&&lastDirection!==direction)amount=Math.max(1,Math.floor(amount/2));lastDirection=direction;
      if(typeof WheelEvent!=='function')fail('REPLAY_NATIVE_WHEEL_EVENT_UNAVAILABLE');
      const node=state.rows[Math.floor(state.rows.length/2)],r=node.getBoundingClientRect();
      if(!finite(r.left)||!finite(r.top))fail('REPLAY_NATIVE_WHEEL_TARGET_UNAVAILABLE');
      node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,composed:true,view:globalThis.window,
        clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:direction*amount,deltaX:0,deltaMode:0}));
      steps++;await new Promise(resolve=>requestAnimationFrame(resolve));const after=book();
      if(ranges.length<16)ranges.push({step:steps,min:after.min,max:after.max});
      if(state.min===after.min&&state.max===after.max){if(++stalled>=4)fail('REPLAY_NATIVE_PARENT_WHEEL_DID_NOT_ADVANCE',{targetPrice:price,steps,ranges});}else stalled=0;
      state=after;
    }
    return {kind:'BOUNDED_PAUSED_NATIVE_DOM_PRICE_SEEK',targetPrice:price,steps,durationMs:perf()-started,ranges,maximumMs:2500,maximumSteps:128};
  }
  function pendingControlsMatch(initial){
    const bound=identity(),get=key=>exactly(`[data-qa-id="${key}"]`,bound.root),position=get('position-DOM'),pnl=get('switch-pl-view'),
      buy=get('cancel-all-buy-orders'),sell=get('cancel-all-sell-orders'),buyMarket=get('buy-market-dom'),sellMarket=get('sell-market-dom');
    if(bound.stage!=='REPLAY_DOM'||!position||!pnl||disabled(position)||disabled(pnl)||norm(position.textContent)!=='—'||norm(pnl.textContent)!=='—'
      ||!buy||!sell||buy.disabled!==initial.buyCancelDisabled||sell.disabled!==initial.sellCancelDisabled||buy.disabled&&sell.disabled
      ||label(buyMarket)!=='Buy Mkt'||disabled(buyMarket)||label(sellMarket)!=='Sell Mkt'||disabled(sellMarket))fail('REPLAY_PENDING_PARENT_NATIVE_STATE_CHANGED');
    // This comparison is not a complete inventory/zero certificate. The native
    // highlighted quote is restored before any final full-inventory receipt.
  }
  async function inspectOwnParent(plan,binding,generation,knownParentId=null){
    const raw=publicSource(binding).fields,guard=(modal=false,allowModeTransition=false)=>{
      if(memory.generation!==generation)fail('REPLAY_PREPARATION_CANCELLED');
      try{identity({allowOwnedModal:modal});}catch(error){if((!modal&&!allowModeTransition)||error?.replayCode!=='REPLAY_ORDER_TICKET_REQUIRED')throw error;}
      pausedReplay();const current=publicSource(binding);
      if(fields.some(key=>current.fields[key]!==raw[key]))fail('REPLAY_PARENT_INSPECTION_SOURCE_CHANGED');
    };
    await selectOrderMode('DOM',()=>guard(false,true));
    const inventory=domInventory(identity(),publicSource(binding));
    if(!inventory.positionEmpty||inventory.pendingEmpty)fail('REPLAY_PENDING_PARENT_WITHOUT_POSITION_REQUIRED');
    const seeks=[await seekNativeDomPrice(plan.entry,()=>guard(false))];pendingControlsMatch(inventory);
    const before=domEntryCell(plan,identity(),true);memory.modalOwnerGeneration=generation;
    nativePointer(before.qty,2);
    await until(()=>{
      try{return identity({allowOwnedModal:true}).modal===true;}catch(error){if(['REPLAY_ORDER_TICKET_REQUIRED','REPLAY_MODAL_REQUIRES_REVIEW'].includes(error?.replayCode))return false;throw error;}
    },()=>guard(true));
    const modal=identity({allowOwnedModal:true}),parent=registeredParent(modal,ticket(modal),plan);
    if(!modal.modal||!parent?.configurationVerified||!parent.expectedPlanComparison?.matches||knownParentId&&parent.orderId!==knownParentId)fail('REPLAY_OWN_PARENT_UUID_OR_FROZEN_PLAN_MISMATCH');
    const close=exactly('[data-qa-id="button-close"][aria-label="Close button"]',modal.panel);if(disabled(close))fail('REPLAY_OWN_PARENT_MODAL_CLOSE_REQUIRED');
    close.click();await until(()=>all('[role="dialog"]').length===0,()=>{
      if(memory.generation!==generation)fail('REPLAY_PREPARATION_CANCELLED');pausedReplay();publicSource(binding);
    });
    memory.modalOwnerGeneration=null;guard(false);
    seeks.push(await seekNativeDomPrice(plan.entry,()=>guard(false)));pendingControlsMatch(inventory);
    domEntryCell(plan,identity(),true);
    return {parent,sourceFields:{...raw},inventory,initialQuote:inventory.quote,seeks,observedAt:now(),documentTimeOrigin:performance.timeOrigin};
  }
  async function inspectProtectiveLegs(plan,binding,generation,parentOrderId=null){
    const raw=publicSource(binding).fields,origin=performance.timeOrigin,started=perf(),legs={},ranges=[],legIssues={};let steps=0;
    const guard=(allowModeTransition=false)=>{
      if(memory.generation!==generation)fail('REPLAY_PREPARATION_CANCELLED');
      try{identity();}catch(error){if(!allowModeTransition||error?.replayCode!=='REPLAY_ORDER_TICKET_REQUIRED')throw error;}
      pausedReplay();
      const current=publicSource(binding);
      if(performance.timeOrigin!==origin||fields.some(key=>current.fields[key]!==raw[key]))fail('REPLAY_PROTECTION_SCAN_SOURCE_CHANGED');
      if(perf()-started>2500)fail('REPLAY_PROTECTION_SCAN_TIME_LIMIT');
    };
    await selectOrderMode('DOM',()=>guard(true));
    const counter=()=>{
      guard();const bound=identity(),position=exactly('[data-qa-id="position-DOM"]',bound.root),pnl=exactly('[data-qa-id="switch-pl-view"]',bound.root),
        buy=exactly('[data-qa-id="cancel-all-buy-orders"]',bound.root),sell=exactly('[data-qa-id="cancel-all-sell-orders"]',bound.root),
        match=/^1 @ ([\d,]+\.\d{2})$/.exec(norm(position?.textContent)),classes=position?.getAttribute('class')??'',
        direction=/(?:^|\s)buy-/.test(classes)?'LONG':/(?:^|\s)sell-/.test(classes)?'SHORT':null,
        counts=all('[title]',bound.root).filter(node=>/^\d+ active orders? x \d+$/.test(norm(node.getAttribute('title')))),
        count=counts.length===1?/^(\d+) active orders? x (\d+)$/.exec(norm(counts[0].getAttribute('title'))):null,
        side=plan.direction==='LONG'?'SELL':'BUY',other=plan.direction==='LONG'?buy:sell,active=plan.direction==='LONG'?sell:buy;
      if(!match||number(match[1])!==plan.entry||direction!==plan.direction||disabled(position)||disabled(pnl)||!norm(pnl.textContent)||norm(pnl.textContent)==='—'
        ||!buy||!sell||other.disabled!==true||active.disabled!==false||!count||Number(count[1])!==2||Number(count[2])!==2||number(counts[0].textContent)!==2)fail('REPLAY_EXACT_ONE_POSITION_TWO_PROTECTIVE_ORDERS_REQUIRED');
      return {kind:'NATIVE_REPLAY_DOM_ACTIVE_ORDER_COUNTER',count:2,quantity:2,side,title:norm(counts[0].getAttribute('title')),otherSideCancelDisabled:true};
    };
    const book=()=>{
      guard();const bound=identity(),mains=all('div[class*="tv-dom-widget-main-"]',bound.root).filter(node=>(node.getAttribute('class')??'').split(/\s+/).some(name=>/^tv-dom-widget-main-[A-Za-z0-9_]+$/.test(name)));
      if(mains.length!==1)fail('REPLAY_UNIQUE_PUBLIC_DOM_SCROLL_SURFACE_REQUIRED');
      const main=mains[0],r=main.getBoundingClientRect(),rows=all('[data-qa-id^="dom-cell-"]',bound.root).filter(node=>{
        if(!/^dom-cell-\d+-price$/.test(node.getAttribute('data-qa-id')??''))return false;const q=node.getBoundingClientRect();return q.bottom>r.top&&q.top<r.bottom;
      });
      if(rows.length<3||rows.length>500||rows.some(node=>!tick(number(node.textContent))))fail('REPLAY_NATIVE_DOM_VISIBLE_PRICE_ROWS_REQUIRED');
      return {bound,main,rows,min:Math.min(...rows.map(node=>number(node.textContent))),max:Math.max(...rows.map(node=>number(node.textContent)))};
    };
    const readLeg=(state,role,price,nativeType)=>{
      const rows=state.rows.filter(node=>number(node.textContent)===price);if(rows.length!==1)return null;
      const row=/^dom-cell-(\d+)-price$/.exec(rows[0].getAttribute('data-qa-id'))[1],side=plan.direction==='LONG'?'sell':'buy',
        qa=`dom-cell-${row}-orders-${side}`,cell=exactly(`[data-qa-id="${qa}"]`,state.bound.root),wrappers=cell?all('div[class*="tv-dom-widget-order-"]',cell):[];
      const qty=wrappers.length===1?exactly('span[class*="tv-dom-widget-order__qty-"]',wrappers[0]):null,
        type=wrappers.length===1?exactly('span[class*="tv-dom-widget-order__type-"]',wrappers[0]):null;
      const rawNativeType=norm(type?.textContent),normalizedNativeType=rawNativeType.toUpperCase();
      if(wrappers.length!==1||number(qty?.textContent)!==1||normalizedNativeType!==nativeType){
        legIssues[role]={role,expectedPrice:price,expectedSide:side.toUpperCase(),expectedType:nativeType,expectedQuantity:1,
          cellDataQa:qa,visiblePriceBounds:{min:state.min,max:state.max},wrapperCount:wrappers.length,cellText:norm(cell?.textContent).slice(0,100),
          observedWrappers:wrappers.slice(0,4).map(wrapper=>({quantity:norm(exactly('span[class*="tv-dom-widget-order__qty-"]',wrapper)?.textContent),
            type:norm(exactly('span[class*="tv-dom-widget-order__type-"]',wrapper)?.textContent)})),scanSteps:steps,durationMs:perf()-started};
        return null;
      }
      delete legIssues[role];
      return {kind:'NATIVE_REPLAY_DOM_PROTECTIVE_LEG',role,side:side.toUpperCase(),nativeType,rawNativeType,quantity:1,price,cellDataQa:qa,
        sourceFields:{...raw},documentTimeOrigin:origin,verificationEpochMs:origin+perf()};
    };
    counter();let amount=400,lastDirection=0,stalled=0,activeTarget=null;
    while(!legs.target||!legs.stop){
      guard();counter();let state=book();
      for(const [name,role,price,type] of [['target','TAKE_PROFIT',plan.target,'TAKEPROFIT'],['stop','STOP_LOSS',plan.stop,'STOPLOSS']]){
        if(!legs[name])legs[name]=readLeg(state,role,price,type);
      }
      // Native ladder prices can settle one render before their order cells.
      // Re-read the same frozen plan after at most two further render frames;
      // mismatching/absent legs never become a verified protection proof.
      for(let settling=0;Object.keys(legIssues).length&&settling<2;settling++){
        await new Promise(resolve=>requestAnimationFrame(resolve));guard();counter();state=book();
        for(const [name,role,price,type] of [['target','TAKE_PROFIT',plan.target,'TAKEPROFIT'],['stop','STOP_LOSS',plan.stop,'STOPLOSS']]){
          if(!legs[name])legs[name]=readLeg(state,role,price,type);
        }
      }
      if(Object.keys(legIssues).length)fail('REPLAY_EXACT_ACTIVE_PROTECTION_LEG_NOT_PRESENT',{
        kind:'BOUNDED_PUBLIC_NATIVE_LEG_SCAN_FAILURE',issues:Object.values(legIssues),ranges,settleFrames:2,maximumMs:2500,maximumSteps:128});
      if(legs.target&&legs.stop)break;
      if(steps>=128)fail('REPLAY_PROTECTION_SCAN_STEP_LIMIT');
      const missing=[!legs.target?plan.target:null,!legs.stop?plan.stop:null].filter(value=>value!==null),
        distance=price=>price>state.max?price-state.max:price<state.min?state.min-price:0,
        target=missing.sort((a,b)=>distance(a)-distance(b))[0],direction=target>state.max?-1:target<state.min?1:0;
      if(!direction)fail('REPLAY_FROZEN_LEG_NOT_IN_NATIVE_PRICE_ROWS');
      // Moving from a verified leg to the other frozen leg is a new search.
      // Reduce wheel distance only when overshooting that same frozen price.
      if(activeTarget!==target){activeTarget=target;amount=400;lastDirection=0;stalled=0;}
      if(lastDirection&&direction!==lastDirection)amount=Math.max(1,Math.floor(amount/2));lastDirection=direction;
      if(typeof WheelEvent!=='function')fail('REPLAY_NATIVE_WHEEL_EVENT_UNAVAILABLE');
      const targetNode=state.rows[Math.floor(state.rows.length/2)],r=targetNode.getBoundingClientRect();
      if(!finite(r.left)||!finite(r.top))fail('REPLAY_NATIVE_WHEEL_TARGET_UNAVAILABLE');
      targetNode.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,composed:true,view:globalThis.window,
        clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:direction*amount,deltaX:0,deltaMode:0}));
      steps++;await new Promise(resolve=>requestAnimationFrame(resolve));guard();
      const after=book();if(ranges.length<16)ranges.push({step:steps,min:after.min,max:after.max});
      if(after.min===state.min&&after.max===state.max){stalled++;if(stalled>=4)fail('REPLAY_NATIVE_DOM_WHEEL_DID_NOT_ADVANCE');}
      else stalled=0;
    }
    const nativeCounter=counter(),value={quantity:1,entry:plan.entry,stopPrice:legs.stop.price,targetPrice:legs.target.price},comparison=expectedPlanComparison(value,plan.direction,plan);
    if(!comparison?.matches)fail('REPLAY_ACTIVE_POSITION_PLAN_MISMATCH');
    const source=publicSource(binding),runEpoch=number(raw.ARROW2_RUN_EPOCH);
    return {kind:'REPLAY_NATIVE_PROTECTIVE_LEGS_PUBLIC_V1',status:'PROTECTED_POSITION_VERIFIED',symbol:'NQ1!',direction:plan.direction,quantity:1,
      entry:plan.entry,stop:legs.stop.price,target:legs.target.price,stopTicks:Math.abs(plan.entry-legs.stop.price)/.25,targetTicks:Math.abs(legs.target.price-plan.entry)/.25,
      configurationVerified:true,fillVerified:true,protectionVerified:true,totalPlannedRisk:comparison.totalPlannedRisk,expectedPlanComparison:comparison,
      registeredParentOrderId:parentOrderId,nativeLegs:legs,nativeCounter,
      sourceProof:{kind:'PAUSED_REPLAY_SAME_SOURCE_SCAN',sourceTabId:expected.sourceTabId,runId:source.runId??'CME_MINI:NQ1!|1|'+runEpoch,
        runEpoch,eventId:source.eventId??null,approvalAsOfTime:source.approvalAsOfTime??null,asOfTime:source.asOfTime??null,
        currentTime:source.currentTime??null,currentCloseTime:source.currentCloseTime??null,fields:{...raw},documentTimeOrigin:origin,stableAcrossScan:true,pausedReplayVerified:true},
      scan:{steps,durationMs:perf()-started,ranges,maximumSteps:128,maximumMs:2500},
      observedAt:now(),documentTimeOrigin:origin,verificationEpochMs:origin+perf(),naturalSignalVerified:false,atomicBracketSubmissionVerified:false,ordersCreated:false,
      proofScope:'PAUSED_SAME_SOURCE_BOUNDED_NATIVE_LEG_SCAN_NOT_TICK_SEQUENCE_OR_ATOMIC_GAP_MEASUREMENT'};
  }
  try{
    if(memory.version!==1||!Array.isArray(memory.usedKeys))return blocked('REPLAY_OWNED_DRIVER_STATE_INVALID');
    if(command.action==='disarm'){memory.generation++;memory.prepared=null;memory.inventoryProof=null;return response(memory.locked?'UNKNOWNLOCK':'DISARMED',{submitCapabilityCreated:false});}
    if(command.action==='read_inventory'||command.action==='verify_inventory_lease'){
      installInventoryGuards();
      const bound=identity(),source=publicSource(command.sourceBinding);
      if(command.action==='verify_inventory_lease')return response('INVENTORY_SOURCE_LEASE_CURRENT',inventoryLease(source,bound));
      const inventory=domInventory(bound,source);
      return response(inventory.status==='FLAT_NO_PENDING'?'REPLAY_SYMBOL_FLAT_NO_PENDING_VERIFIED':'REPLAY_SYMBOL_INVENTORY_OBSERVED',
        {inventory,flat:inventory.flat,positions:inventory.positions,workingOrders:inventory.workingOrders,
          positionsComplete:inventory.positionsComplete,workingOrdersComplete:inventory.workingOrdersComplete,
          sourceLeaseStored:inventory.sourceLeaseStored,sourceLeaseExpiresAt:inventory.sourceLeaseExpiresAt,submitCapabilityCreated:false});
    }
    if(command.action==='preflight'||command.action==='execute_approved'){
      if(memory.busy)fail('REPLAY_DRIVER_BUSY');if(memory.locked)fail('REPLAY_RECONCILIATION_REQUIRED');
      if(command.testOnly===true||command.testDraft||command.synthetic===true)fail('REPLAY_APPROVED_EXECUTION_ONLY');
      installInventoryGuards();
      const accepted=command.action==='execute_approved'?freshIntent(command.intent):null,
        intent=accepted?JSON.parse(accepted.json):null,binding=intent?.sourceBinding??command.sourceBinding;
      if(!binding||typeof binding!=='object')fail('REPLAY_EXPLICIT_SOURCE_BINDING_REQUIRED');
      publicSource(binding);pausedReplay();if(intent)unusedEvent(intent);
      memory.generation++;memory.prepared=null;memory.inventoryProof=null;memory.busy=true;ownsBusy=true;
      const generation=memory.generation,startedPerformance=perf(),guard=()=>flowGuard(generation,binding,intent,true),
        inventory=await currentZero(generation,binding,intent);
      const frozenPlan=intent??command.expectedPlan;
      if(frozenPlan){
        const normalized={stopMode:'PRICE',targetMode:'PRICE',...frozenPlan};
        validatePrices(normalized,normalized.commissionPerContract??normalized.riskPlan?.parameterSnapshot?.commissionPerContract??normalized.parameterSnapshot?.commissionPerContract,
          normalized.slippageTicks??normalized.riskPlan?.parameterSnapshot?.slippageTicks??normalized.parameterSnapshot?.slippageTicks);
        domEntryCell(normalized,identity(),false);inventory.domEntryPriceVerified=true;
      }else inventory.domEntryPriceVerified=false;
      if(intent&&inventory.quote!==intent.quoteProof.quote)fail('REPLAY_APPROVED_NATIVE_QUOTE_CHANGED');
      await selectOrderMode('Order',guard);inventoryLease(publicSource(binding),identity());
      if(!intent)return composedPreflight(inventory,binding);
      const exactGuard=()=>{
        flowGuard(generation,binding,intent);
        const value=ticket();passiveLimit(value,intent);
        if(value.quote!==intent.quoteProof.quote)fail('REPLAY_APPROVED_NATIVE_QUOTE_CHANGED');
      };
      const value=await prepareForm(intent,exactGuard);
      exactGuard();inventoryLease(publicSource(binding),identity());freshIntent(intent);
      if(!sameTicket(ticket(),intent))fail('REPLAY_PRE_SUBMIT_TICKET_CHANGED');
      const button=exactly('[data-name="place-and-modify-button"]',value.root);if(!button||disabled(button))fail('REPLAY_SUBMIT_CONTROL_UNAVAILABLE');
      consumeEvent(intent);memory.locked=true;
      memory.lastSubmission={key:intent.key,submittedAt:now(),submittedPerformance:perf(),sourceBinding:JSON.parse(JSON.stringify(binding)),
        intent:JSON.parse(accepted.json),baseline:'NATIVE_CURRENT_NQ_SYMBOL_FLAT_NO_PENDING',baselineObservedAt:inventory.observedAt};
      memory.inventoryProof=null;gestureStarted=true;button.click();
      return response('SUBMITTED_UNCONFIRMED',{submitted:true,submissionAttempted:true,ordersCreated:null,key:intent.key,
        submittedAt:memory.lastSubmission.submittedAt,sourceBinding:binding,executionLocked:true,submitCapabilityCreated:false,
        reasonCodes:['REPLAY_ACTUAL_REGISTRATION_FILL_AND_ACTIVE_PROTECTION_NOT_YET_VERIFIED'],
        timing:{scope:'DOCUMENT_UI_EXECUTION_TO_GESTURE_ONLY',documentTimeOrigin:performance.timeOrigin,startedPerformance,
          submittedPerformance:memory.lastSubmission.submittedPerformance,gestureReturnedPerformance:perf(),
          orderRegistrationMs:null,fillMs:null,protectedFillMs:null}});
    }
    if(command.action==='inspect_protection'){
      if(memory.busy)fail('REPLAY_DRIVER_BUSY');installInventoryGuards();pausedReplay();
      const testOnly=command.testOnly===true,own=testOnly?null:memory.lastSubmission,
        id=own?.parentOrderId??null,pin=id?memory.parentPins?.[id]:null;
      if(!testOnly&&(!own||own.key!==command.intent?.key||own.resolved||!id||!pin||pin.testOnly!==false||pin.key!==own.key
        ||pin.cancelAttempted||pin.sourceTabId!==expected.sourceTabId||pin.researchUrl!==expected.researchUrl
        ||command.parentOrderId&&command.parentOrderId!==id
        ||['direction','quantity','entry','stop','target'].some(key=>pin.plan?.[key]!==own.intent[key])))fail('REPLAY_OWN_PARENT_CORRELATION_UNVERIFIED');
      const frozen=testOnly?command.expectedPlan:own.intent;
      if(!frozen||typeof frozen!=='object')fail('REPLAY_EXACT_FROZEN_PARENT_PLAN_REQUIRED');
      const plan=JSON.parse(JSON.stringify({stopMode:'PRICE',targetMode:'PRICE',...frozen}));
      validatePrices(plan,plan.commissionPerContract??plan.riskPlan?.parameterSnapshot?.commissionPerContract,
        plan.slippageTicks??plan.riskPlan?.parameterSnapshot?.slippageTicks);
      memory.generation++;memory.prepared=null;memory.inventoryProof=null;memory.busy=true;ownsBusy=true;
      const binding=testOnly?command.sourceBinding:lifecycleBinding(own.intent),proof=await inspectProtectiveLegs(plan,binding,memory.generation,id);
      return response(testOnly?'TEST_PROTECTION_VERIFIED':'PROTECTED_POSITION_VERIFIED',{
        protectedPosition:{...proof,testOnly,signalApproved:!testOnly},
        testOnly,signalApproved:!testOnly,attribution:ownAttribution(own?.intent,id),fillVerified:true,protectionVerified:true,
        submitted:!!own,ordersCreated:own?null:false,
        pausedReplayVerified:true,submitCapabilityCreated:false,executionLocked:memory.locked,
        documentTimeOrigin:proof.documentTimeOrigin,verificationEpochMs:proof.verificationEpochMs});
    }
    if(command.action==='read'||command.action==='verify'){
      const own=command.action==='verify'&&command.intent?.key===memory.lastSubmission?.key?memory.lastSubmission:null;
      if(own)command={...command,intent:own.intent,expectedPlan:undefined};
      if(own&&['NEW_ORDER_TICKET','REPLAY_DOM'].includes(identity().stage)){
        const current=identity(),position=current.stage==='REPLAY_DOM'?exactly('[data-qa-id="position-DOM"]',current.root):null;
        if(own.parentOrderId&&position&&norm(position.textContent)!=='—')return replayTradingUiCommand({...command,action:'inspect_protection',testOnly:false});
        const inspected=await replayTradingUiCommand({...command,action:'inspect_parent'});
        if(inspected.status==='REGISTERED_PARENT_VERIFIED')return inspected;
        if(own.parentOrderId&&inspected.reasonCodes?.includes('REPLAY_PENDING_PARENT_WITHOUT_POSITION_REQUIRED'))return replayTradingUiCommand({...command,action:'inspect_protection',testOnly:false});
        return response('UNKNOWN',{reasonCodes:inspected.reasonCodes??['REPLAY_ACTUAL_POSITION_OR_REGISTRATION_REQUIRES_RECONCILIATION'],
          executionLocked:memory.locked,attribution:ownAttribution(own.intent),fillVerified:false,protectionVerified:false,submitted:true,ordersCreated:null});
      }
      const observed=evidence(lifecycleBinding(command.intent));
      if(own&&observed.registeredParent?.configurationVerified&&observed.registeredParent.expectedPlanComparison?.matches){
        own.parentOrderId=observed.registeredParent.orderId;
        memory.parentPins??=Object.create(null);memory.parentPins[own.parentOrderId]={key:own.key,testOnly:false,plan:own.intent,
          sourceTabId:expected.sourceTabId,researchUrl:expected.researchUrl,orderId:own.parentOrderId,cancelAttempted:false};
        return response('REGISTERED_PARENT_VERIFIED',{registeredParent:observed.registeredParent,attribution:ownAttribution(own.intent),
          pausedReplayVerified:(()=>{try{pausedReplay();return true;}catch{return false;}})(),executionLocked:memory.locked,submitted:true,ordersCreated:null,
          documentTimeOrigin:observed.registeredParent.documentTimeOrigin,verificationEpochMs:observed.registeredParent.verificationEpochMs});
      }
      const correlated=!command.intent||!!own?.parentOrderId;
      if(command.action==='verify')return response(correlated&&observed.protectedPosition?.protectionVerified?'PROTECTED_POSITION_VERIFIED':'UNKNOWN',
        {reasonCodes:!correlated?['REPLAY_OWN_PARENT_CORRELATION_UNVERIFIED']:observed.protectedPosition?.protectionVerified?[]:['REPLAY_FILL_AND_PROTECTION_SCHEMA_UNVERIFIED'],evidence:observed,
          fillVerified:correlated&&observed.protectedPosition?.fillVerified===true,protectionVerified:correlated&&observed.protectedPosition?.protectionVerified===true,
          submitted:memory.lastSubmission?true:false,ordersCreated:memory.lastSubmission?null:false,executionLocked:memory.locked,
          attribution:ownAttribution(own?.intent),pausedReplayVerified:(()=>{try{pausedReplay();return true;}catch{return false;}})(),
          documentTimeOrigin:observed.protectedPosition?.documentTimeOrigin??performance.timeOrigin,
          verificationEpochMs:observed.protectedPosition?.verificationEpochMs??performance.timeOrigin+perf(),
          correlatedSubmission:!!command.intent&&memory.lastSubmission?.key===command.intent.key});
      return {...observed,executionLocked:memory.locked};
    }
    if(command.action==='inspect_parent'||command.action==='cancel_own'){
      if(memory.busy)fail('REPLAY_DRIVER_BUSY');installInventoryGuards();pausedReplay();
      const testOnly=command.testOnly===true,own=testOnly?null:memory.lastSubmission;
      if(!testOnly&&(!own||own.key!==command.intent?.key))fail('REPLAY_PRIVATE_SUBMITTED_INTENT_REQUIRED');
      const frozen=testOnly?command.expectedPlan:own.intent;
      if(!frozen||typeof frozen!=='object')fail('REPLAY_EXACT_FROZEN_PARENT_PLAN_REQUIRED');
      const plan=JSON.parse(JSON.stringify({stopMode:'PRICE',targetMode:'PRICE',...frozen}));
      validatePrices(plan,plan.commissionPerContract??plan.riskPlan?.parameterSnapshot?.commissionPerContract,
        plan.slippageTicks??plan.riskPlan?.parameterSnapshot?.slippageTicks);
      const binding=testOnly?command.sourceBinding:lifecycleBinding(own.intent),known=command.parentOrderId??own?.parentOrderId??null;
      if(known&&!/^order_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(known))fail('REPLAY_EXACT_PARENT_UUID_REQUIRED');
      memory.parentPins??=Object.create(null);
      if(command.action==='cancel_own'&&(!known||!memory.parentPins[known]||memory.parentPins[known].testOnly!==testOnly
        ||!testOnly&&memory.parentPins[known].key!==own.key))fail('REPLAY_PRIVATE_PARENT_INSPECTION_REQUIRED');
      if(command.action==='cancel_own'&&memory.parentPins[known].cancelAttempted)fail('REPLAY_OWN_CANCEL_ALREADY_ATTEMPTED');
      if(command.action==='cancel_own'&&['direction','quantity','entry','stop','target'].some(key=>memory.parentPins[known].plan[key]!==plan[key]))fail('REPLAY_PRIVATE_PARENT_PLAN_CHANGED');
      memory.generation++;memory.prepared=null;memory.inventoryProof=null;memory.busy=true;ownsBusy=true;
      const generation=memory.generation,inspection=await inspectOwnParent(plan,binding,generation,known),id=inspection.parent.orderId;
      if(!memory.parentPins[id]&&Object.keys(memory.parentPins).length>=256)fail('REPLAY_PARENT_PIN_LEDGER_FULL');
      memory.parentPins[id]={...memory.parentPins[id],key:own?.key??null,testOnly,plan,sourceTabId:expected.sourceTabId,
        researchUrl:expected.researchUrl,orderId:id,cancelAttempted:memory.parentPins[id]?.cancelAttempted===true};
      if(own)own.parentOrderId=id;
      const attribution=ownAttribution(own?.intent,id);
      const guard=()=>{
        if(memory.generation!==generation)fail('REPLAY_PREPARATION_CANCELLED');identity();pausedReplay();
        const source=publicSource(binding);if(fields.some(key=>source.fields[key]!==inspection.sourceFields[key])||performance.timeOrigin!==inspection.documentTimeOrigin)fail('REPLAY_OWN_CANCEL_SOURCE_CHANGED');
      };
      if(command.action==='inspect_parent'){
        const quoteRestore=await seekNativeDomPrice(inspection.initialQuote,guard);let inventory=null;
        await until(()=>{try{inventory=domInventory(identity(),publicSource(binding));return inventory.quote===inspection.initialQuote;}
          catch(error){if(error?.replayCode==='REPLAY_HEALTHY_DOM_INVENTORY_CONTROLS_REQUIRED')return false;throw error;}},guard);
        if(!inventory.positionEmpty||inventory.pendingEmpty||inventory.quote!==inspection.initialQuote)fail('REPLAY_PARENT_QUOTE_RESTORE_OR_PENDING_STATE_CHANGED');
        return response('REGISTERED_PARENT_VERIFIED',{registeredParent:inspection.parent,attribution,
          testOnly,signalApproved:!testOnly,parentOrderId:id,pausedReplayVerified:true,executionLocked:memory.locked,
          lifecycleNavigation:{entrySeeks:inspection.seeks,quoteRestore},
          documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()});
      }
      guard();pendingControlsMatch(inspection.inventory);
      const exact=domEntryCell(plan,identity(),true);guard();memory.parentPins[id].cancelAttempted=true;
      gestureStarted=true;nativePointer(exact.close,1);
      const quoteRestore=await seekNativeDomPrice(inspection.initialQuote,guard);
      let after=null;await until(()=>{try{after=domInventory(identity(),publicSource(binding));return after.status==='FLAT_NO_PENDING';}
        catch(error){if(error?.replayCode==='REPLAY_HEALTHY_DOM_INVENTORY_CONTROLS_REQUIRED')return false;throw error;}},guard);
      if(own&&own.key===memory.lastSubmission?.key){memory.lastSubmission.resolved='CANCELLED';memory.locked=false;}
      return response('OWN_PARENT_CANCELLED',{cancelVerified:true,cancelledOrderId:id,cancelled:true,attribution,inventory:after,
        testOnly,signalApproved:!testOnly,pausedReplayVerified:true,executionLocked:memory.locked,ordersCreated:false,
        lifecycleNavigation:{entrySeeks:inspection.seeks,quoteRestore},
        documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()});
    }
    if(command.action==='prepare'){
      if(memory.busy)fail('REPLAY_DRIVER_BUSY');if(memory.locked)fail('REPLAY_RECONCILIATION_REQUIRED');
      memory.generation++;memory.prepared=null;memory.busy=true;ownsBusy=true;
      const generation=memory.generation,testOnly=command.testOnly===true;
      let intent,intentJson=null;
      if(testOnly){
        const draft={stopMode:'PRICE',targetMode:'PRICE',...command.testDraft},arithmetic=validatePrices(draft,draft?.commissionPerContract,draft?.slippageTicks);
        intent={...draft,stopTicks:arithmetic.riskTicks,targetTicks:arithmetic.rewardTicks,signalApproved:false,testOnly:true};
      }else{
        freshIntent(command.intent);fail('REPLAY_APPROVED_EXECUTION_SEQUENCE_REQUIRED');
      }
      const guard=()=>{if(generation!==memory.generation)fail('REPLAY_PREPARATION_CANCELLED');const current=identity();
        if(current.stage==='NEW_ORDER_TICKET')passiveLimit(ticket(current),intent);
        if(!testOnly){freshIntent(intent);publicSource(intent.sourceBinding);}};
      const value=await prepareForm(intent,guard);
      const after=evidence(testOnly?null:intent.sourceBinding);
      if(!testOnly){
        if(after.status!=='REPLAY_TRADING_UI_VERIFIED'||after.flat!==true)fail('REPLAY_FLAT_STATE_NOT_VERIFIED');
        memory.prepared=Object.freeze({generation,key:intent.key,intentJson,expiresAt:intent.expiresAt,preparedPerformance:perf()});
      }
      return response(testOnly?'TICKET_PREPARED_TEST':'TICKET_PREPARED',{testOnly,signalApproved:!testOnly,
        evidence:after,submitCapabilityCreated:!testOnly,
        executionConstraint:{kind:'PASSIVE_LIMIT_FORM_ONLY',entry:intent.entry,observedQuote:value.quote,
          distanceTicks:passiveLimit(value,intent),minimumDistanceTicks:1,pricesAdjustedByDriver:false,
          registeredBracketsVerified:false,fillInferred:false}});
    }
    if(command.action==='submit'){
      memory.prepared=null;fail('REPLAY_APPROVED_EXECUTION_SEQUENCE_REQUIRED');
    }
    return blocked('UNKNOWN_REPLAY_UI_ACTION');
  }catch(error){
    memory.prepared=null;
    memory.inventoryProof=null;
    const reason=typeof error?.replayCode==='string'?error.replayCode:'REPLAY_UI_COMMAND_FAILED';
    if(gestureStarted){memory.locked=true;return response('UNKNOWN',{reasonCodes:[reason],submitted:null,ordersCreated:null,executionLocked:true});}
    return blocked(reason,error?.replayDetails?{inspectionDetails:error.replayDetails}:{});
  }finally{if(ownsBusy)memory.busy=false;}
}
