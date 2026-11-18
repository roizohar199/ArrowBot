// Serialized public-UI boundary for TradingView's virtual Paper account ONLY.
// Reads native quantity; never sets numeric quantity, SL/TP or risk values.
// In Order mode only the user's existing sole favourite preset and technical
// side may be activated before the exact native Market confirmation button.
export async function paperUserMarketUiCommand(command={}){
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim(),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x),integer=Number.isSafeInteger,finite=Number.isFinite,
    bounded=(x,n=512)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\u0000-\u001f\u007f]/.test(x),
    num=x=>{const s=norm(x).replace(/\u2212/g,'-').replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;},
    tick=x=>finite(x)&&x>0&&integer(x/.25),now=()=>Date.now(),perf=()=>performance.now(),copy=x=>structuredClone(x),
    canonical=x=>JSON.stringify(x,(_k,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b),
    expected=command.expected??{},slot=Symbol.for('arrow.paper-user-market-ui.v1'),
    state=globalThis[slot]??(globalThis[slot]={generation:0,busy:false,lease:null,own:null,consumed:[],guards:false});
  const fail=(code,details={})=>{throw Object.assign(new Error(code),{paperUserCode:code,...details});};
  const visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
    for(let n=node,depth=0;n&&depth<64;n=n.parentElement,depth++){
      const s=getComputedStyle(n);if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.contentVisibility==='hidden')return false;
      if(n!==node){const r=n.getBoundingClientRect(),clip=v=>['hidden','clip','auto','scroll'].includes(v);if(clip(s.overflowX??s.overflow)&&r.width<=0||clip(s.overflowY??s.overflow)&&r.height<=0)return false;}
    }return true;
  };
  const all=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible),one=(selector,root=document)=>{const values=all(selector,root);return values.length===1?values[0]:null;},
    label=node=>norm(node?.textContent),disabled=node=>!node||node.disabled===true||node.getAttribute('aria-disabled')==='true';
  const result=(status,extra={})=>({kind:'PAPER_USER_MARKET_NATIVE_RESULT',status,provider:'TRADINGVIEW_PAPER',environment:'DEMO',submitted:false,ordersCreated:false,fillVerified:false,
    protectionVerified:false,userManaged:true,riskManagement:'USER_MANAGED_NOT_CALCULATED',postFillManagement:false,realBrokerOrdersAuthorized:false,...extra});
  let ownsBusy=false,gestureStarted=false;
  function identity(){
    if(document.visibilityState!=='visible'||document.hidden===true)fail('PAPER_USER_VISIBLE_RESEARCH_REQUIRED');
    if(all('[role="dialog"],[aria-modal="true"]').length)fail('PAPER_USER_MODAL_OPEN');
    let url;try{url=new URL(expected.researchUrl);}catch{fail('PAPER_USER_EXACT_RESEARCH_REQUIRED');}
    const layoutsByUrl={'https://www.tradingview.com/chart/ARROWRV1/':'Arrow OHLC Live Verification','https://www.tradingview.com/chart/ARROWFR1/':'Full Screens Live'},layoutName=layoutsByUrl[url.href];
    if(!layoutName||url.protocol!=='https:'||!['www.tradingview.com','tradingview.com'].includes(url.hostname)||url.search||url.hash||url.username||url.password
      ||location.href!==url.href||!integer(expected.sourceTabId)||expected.sourceTabId<1)fail('PAPER_USER_RESEARCH_TARGET_CHANGED');
    if(!bounded(expected.nativeAccountId,240)||!integer(expected.accountRevision)||expected.accountRevision<1||!bounded(expected.selectionKey,16384))fail('PAPER_USER_SELECTED_ACCOUNT_REQUIRED');
    const layouts=all('[aria-label^="Logged in as"]'),charts=all('canvas[aria-label^="Chart for "]'),interval=one('#header-toolbar-intervals [aria-checked="true"]'),replay=one('#header-toolbar-replay');
    if(layouts.length!==1||!norm(layouts[0].getAttribute('aria-label')).endsWith('Active layout: '+layoutName)||interval?.getAttribute('data-value')!=='1'
      ||charts.filter(n=>n.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length!==1
      ||(expected.allowResearchLiveMultiChart===true?charts.length<1||charts.length>3||charts.some(n=>!/^Chart for CME_MINI:NQ1!, [^,]+$/.test(n.getAttribute('aria-label')??'')):charts.length!==1)
      ||expected.allowResearchLiveMultiChart!==undefined&&typeof expected.allowResearchLiveMultiChart!=='boolean')fail('PAPER_USER_EXACT_NQ_MINUTE_SCOPE_REQUIRED');
    if((replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked'))!=='false'||all('[data-qa-id="replay_trading"]').length)fail('PAPER_USER_REPLAY_EXCLUDED');
    const providers=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]');
    if(!providers.length||providers.length>3||providers.some(n=>label(n)!=='Paper Trading'))fail('PAPER_USER_EXACT_PAPER_PROVIDER_REQUIRED');
    const account=one('[aria-label="Account manager"]'),selector=account&&one('[data-qa-id="account-selector"]',account),name=selector&&one('[class*="accountName-"]',selector);
    if(!account||!name||label(name)!==expected.nativeAccountId)fail('PAPER_USER_NATIVE_ACCOUNT_CHANGED');
    const panel=one('[aria-label="Trading panel"]'),radios=panel?all('[role="radio"]',panel):[],titles=panel?all('[title]',panel).map(n=>n.getAttribute('title')):[],symbols=[...new Set(titles.filter(t=>/^NQ[HMUZ]20\d\d$/.test(t??'')))];
    const logos=panel?all('img[src]',panel).filter(n=>{try{const u=new URL(n.getAttribute('src'));return u.protocol==='https:'&&u.hostname==='static.tradingview.com'&&/^\/static\/bundles\/paper\.[a-z0-9]+\.svg$/.test(u.pathname);}catch{return false;}}):[];
    const ticket=panel&&one('[aria-label="Order ticket"]',panel),domSelected=radios.filter(n=>label(n)==='DOM'&&n.getAttribute('aria-checked')==='true').length===1&&radios.filter(n=>label(n)==='Order'&&n.getAttribute('aria-checked')==='false').length===1,
      orderSelected=radios.filter(n=>label(n)==='Order'&&n.getAttribute('aria-checked')==='true').length===1&&radios.filter(n=>label(n)==='DOM'&&n.getAttribute('aria-checked')==='false').length===1,mode=ticket&&orderSelected?'ORDER':!ticket&&domSelected?'DOM':null;
    if(!panel||!mode||all('[data-name="position-panel"]',panel).length||symbols.length!==1||logos.length!==1||titles.some(t=>/^NQ[HMUZ]20\d\d, (?:order|position) /.test(t??'')))fail('PAPER_USER_NATIVE_DOM_OR_NEW_ORDER_REQUIRED');
    const symbol=symbols[0],mapping=`Continuous futures is used for charting, but the ${symbol} contract will be used for order placement.`;
    if(!titles.includes(mapping)||expected.symbol!==undefined&&expected.symbol!==symbol)fail('PAPER_USER_EXACT_DATED_CONTRACT_MAPPING_REQUIRED');
    if(expected.executionSurface!==undefined&&expected.executionSurface!==(mode==='ORDER'?'ORDER_TICKET_PRESET':'DOM_MARKET'))fail('PAPER_USER_SELECTED_EXECUTION_SURFACE_CHANGED');
    return {account,panel,ticket,mode,symbol,visibleCharts:charts.length,nativeAccountId:label(name),researchUrl:url.href,layoutName};
  }
  function orderNative(bound,{requireQuote=true}={}){
    const root=bound.ticket,quantityNode=one('input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]',root),quantity=num(quantityNode?.value),quantityType=one('[data-qa-id="quantity-dropdown-types"]',root),
      buy=one('[data-name="side-control-buy"][role="button"]',root),sell=one('[data-name="side-control-sell"][role="button"]',root),active=node=>(node?.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-')),
      direction=active(buy)&&!active(sell)?'LONG':active(sell)&&!active(buy)?'SHORT':null,quoteFor=(node,side)=>num(label(node).replace(new RegExp('^'+side+'\\s*'),'')),quotes={LONG:quoteFor(buy,'Buy'),SHORT:quoteFor(sell,'Sell')},
      selected=all('[role="tab"][aria-selected="true"]',root),orderType=selected.length===1?label(selected[0]).toUpperCase():null,submit=one('button[data-name="place-and-modify-button"]',root),favorites=all('button[data-qa-id^="favorite-preset-tag-"]',root),favorite=one('button[data-qa-id="favorite-preset-tag-1"]',root);
    const readExit=kind=>{const sw=one(`input[role="switch"][data-qa-id="order-ticket-${kind}-checkbox-bracket"]`,root),field=one(`input[data-qa-id~="order-ticket-${kind}-input"]`,root),unitNode=one(`button[data-qa-id="order-ticket-${kind}-dropdown-button"]`,root),unitLabel=label(unitNode),
      unit=unitLabel===(kind==='take-profit'?'Take profit ticks':'Stop loss ticks')?'TICKS':/\bprice$/i.test(unitLabel)?'PRICE':/percent|%/i.test(unitLabel)?'PERCENT':/USD|dollar/i.test(unitLabel)?'USD':null,
      aria=sw?.getAttribute('aria-checked'),enabled=!!sw&&sw.checked===true&&(aria===null||aria==='true')&&!disabled(sw),value=num(field?.value);
      return {enabled,switchConsistent:!!sw&&typeof sw.checked==='boolean'&&(aria===null||aria===String(sw.checked)),unit,unitLabel,value,valueRaw:field?.value??null,fieldWritable:!!field&&!disabled(field)&&field.readOnly!==true};};
    const stop=readExit('stop-loss'),target=readExit('take-profit'),quote=direction?quotes[direction]:null,side=direction==='LONG'?'Buy':'Sell',caption=label(submit),
      ready=orderType==='MARKET'&&stop.enabled&&target.enabled&&stop.switchConsistent&&target.switchConsistent&&[stop,target].every(x=>x.unit&&x.fieldWritable&&finite(x.value)&&x.value>0&&(x.unit!=='TICKS'||integer(x.value))),
      diagnostics={kind:'PAPER_USER_PUBLIC_ORDER_TICKET_DIAGNOSTIC_V1',observedAt:now(),executionSurface:'ORDER_TICKET_PRESET',quantityValid:integer(quantity)&&quantity>0,quantityDisabled:quantityNode?.disabled??null,quantityReadOnly:quantityNode?.readOnly??null,
        unitsSelected:label(quantityType)==='Units',buyCount:all('[data-name="side-control-buy"][role="button"]',root).length,sellCount:all('[data-name="side-control-sell"][role="button"]',root).length,direction,buyDisabled:disabled(buy),sellDisabled:disabled(sell),
        favoriteCount:favorites.length,soleFavoriteMatches:favorites.length===1&&favorites[0]===favorite,submitCount:all('button[data-name="place-and-modify-button"]',root).length,submitDisabled:disabled(submit),caption,orderType,quoteRequired:requireQuote,quoteValid:tick(quote),stop,target};
    if(!quantityNode||disabled(quantityNode)||quantityNode.readOnly||!integer(quantity)||quantity<1||!bounded(quantityNode.value,80)||label(quantityType)!=='Units'||disabled(buy)||disabled(sell)||!direction||favorites.length!==1||favorites[0]!==favorite||disabled(favorite)
      ||disabled(submit)||!['MARKET','LIMIT','STOP'].includes(orderType)||selected[0]?.getAttribute('id')!==({MARKET:'Market',LIMIT:'Limit',STOP:'Stop'})[orderType]||caption!==`${side} ${quantity} ${bound.symbol} ${orderType}`||requireQuote&&(!tick(quotes.LONG)||!tick(quotes.SHORT)||quotes.SHORT>quotes.LONG))fail('PAPER_USER_NATIVE_CONTROLS_UNVERIFIED',{controlDiagnostics:diagnostics});
    const preset={kind:'NATIVE_PAPER_ORDER_TICKET_PRESET_FIELDS_V1',executionSurface:'ORDER_TICKET_PRESET',symbol:bound.symbol,quantity,quantityRaw:quantityNode.value,orderType,direction,stop,target,ready,favoriteDataQa:'favorite-preset-tag-1',soleFavoriteVerified:true};
    preset.fingerprint=canonical([preset.kind,preset.symbol,preset.quantity,preset.quantityRaw,preset.orderType,preset.direction,preset.stop,preset.target,preset.favoriteDataQa]);
    return {bound,buy,sell,submit,favorite,direction,quantity,quantityRaw:quantityNode.value,quote,quotes,preset};
  }
  function native({requireQuote=true}={}){
    const bound=identity();if(bound.mode==='ORDER')return orderNative(bound,{requireQuote});
    const get=k=>one(`[data-qa-id="${k}"]`,bound.panel),quantityNode=one('input#dom-quantity-input[data-qa-id~="qty-dom-input"]',bound.panel),quantity=num(quantityNode?.value),buy=get('buy-market-dom'),sell=get('sell-market-dom'),buyCancel=get('cancel-all-buy-orders'),sellCancel=get('cancel-all-sell-orders'),position=get('position-DOM'),pnl=get('switch-pl-view');
    const prices=all('[data-qa-id^="dom-cell-"]',bound.panel).filter(n=>/^dom-cell-\d+-price$/.test(n.getAttribute('data-qa-id')??'')),highlight=prices.filter(n=>(n.getAttribute('class')??'').includes('__value--highlighted-')),quote=highlight.length===1?num(highlight[0].textContent):null;
    const controlDiagnostics={kind:'PAPER_USER_PUBLIC_NATIVE_CONTROLS_DIAGNOSTIC_V1',observedAt:now(),quantityCount:all('input#dom-quantity-input[data-qa-id~="qty-dom-input"]',bound.panel).length,
      quantityValid:integer(quantity)&&quantity>0&&bounded(quantityNode?.value,80),quantityDisabled:quantityNode?.disabled??null,quantityReadOnly:quantityNode?.readOnly??null,
      buyCount:all('[data-qa-id="buy-market-dom"]',bound.panel).length,sellCount:all('[data-qa-id="sell-market-dom"]',bound.panel).length,buyDisabled:disabled(buy),sellDisabled:disabled(sell),
      buyLabelMatches:label(buy)==='Buy Mkt',sellLabelMatches:label(sell)==='Sell Mkt',buyCancelCount:all('[data-qa-id="cancel-all-buy-orders"]',bound.panel).length,sellCancelCount:all('[data-qa-id="cancel-all-sell-orders"]',bound.panel).length,
      buyCancelBoolean:typeof buyCancel?.disabled==='boolean',sellCancelBoolean:typeof sellCancel?.disabled==='boolean',positionCount:all('[data-qa-id="position-DOM"]',bound.panel).length,pnlCount:all('[data-qa-id="switch-pl-view"]',bound.panel).length,
      positionDisabled:disabled(position),pnlDisabled:disabled(pnl),priceCount:prices.length,highlightCount:highlight.length,quoteRequired:requireQuote,quoteValid:tick(quote),highlightedValues:highlight.slice(0,4).map(n=>label(n).slice(0,80))};
    if(disabled(buy)||disabled(sell)||label(buy)!=='Buy Mkt'||label(sell)!=='Sell Mkt'||!buyCancel||!sellCancel||typeof buyCancel.disabled!=='boolean'||typeof sellCancel.disabled!=='boolean'||disabled(position)||disabled(pnl)
      ||!quantityNode||quantityNode.disabled||quantityNode.readOnly||!integer(quantity)||quantity<1||!bounded(quantityNode.value,80)||prices.length<3||prices.length>500||requireQuote&&!tick(quote))fail('PAPER_USER_NATIVE_CONTROLS_UNVERIFIED',{controlDiagnostics});
    return {bound,buy,sell,buyCancel,sellCancel,position,pnl,quantity,quantityRaw:quantityNode.value,quote};
  }
  async function readNativeCoherent(generation,{requireQuote=true}={}){
    const started=perf();let attempts=0,last;
    while(attempts<16&&perf()-started<=220){
      if(state.generation!==generation)fail('PAPER_USER_NATIVE_CONTEXT_INTERRUPTED');
      try{const value=native({requireQuote});value.controlRead={attempts:attempts+1,elapsedMs:perf()-started,transientRecovered:attempts>0,quoteRequired:requireQuote};return value;}
      catch(error){if(error?.paperUserCode!=='PAPER_USER_NATIVE_CONTROLS_UNVERIFIED')throw error;last=error;}
      attempts++;if(attempts<16&&perf()-started<220)await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(state.generation!==generation)fail('PAPER_USER_NATIVE_CONTEXT_INTERRUPTED');
    if(last?.controlDiagnostics)last.controlDiagnostics={...last.controlDiagnostics,readAttempts:attempts,readElapsedMs:perf()-started,retryBudgetMs:220};
    throw last;
  }
  function source(binding,{optional=false}={}){
    if(!binding){if(optional)return null;fail('PAPER_USER_LIVE_SOURCE_BINDING_REQUIRED');}
    if(binding.mode!=='LIVE'||binding.instrument!=='CME_MINI:NQ1!'||binding.timeframe!=='1'||binding.sourceTabId!==expected.sourceTabId||binding.researchUrl!==expected.researchUrl||!bounded(binding.sessionId)||!integer(binding.generation)||binding.generation<0
      ||!integer(binding.asOfTime)||!plain(binding.closedBar)||binding.closedBar.closeTime!==binding.asOfTime)fail('PAPER_USER_LIVE_SOURCE_BINDING_REQUIRED');
    const tabs=all('[role="tab"][aria-selected="true"]').filter(n=>/data\s*window/i.test(norm(n.getAttribute('aria-label')||n.textContent))),studies=all('[role="treegrid"] [role="row"][data-role="menuitem"]').filter(row=>(all('span[title]',row).some(n=>(n.getAttribute('title')??'').startsWith('Arrow OHLC Window v2'))||all(':scope > div[class*="header-"] > span[class*="headerTitle-"]',row).some(n=>!n.getAttribute('title')&&/^Arrow OHLC Window v2(?:\s|\(|$)/.test(norm(n.textContent)))));
    if(tabs.length!==1||studies.length!==1)fail('PAPER_USER_VISIBLE_OWN_SOURCE_REQUIRED');
    const suffixes=['TIME','CLOSE_TIME','OPEN','HIGH','LOW','CLOSE','VOLUME'],tagged=[],add=(key,kind='scalar')=>tagged.push({name:'ARROW2_'+key,kind});
    for(const [key,kind]of [['SOURCE_EPOCH','time'],['BASE_MS'],['TICK','price'],['POINT','price'],['HIGHER1_MS'],['HIGHER2_MS'],['SUPPORTED'],['HISTORY_STATE']])add(key,kind);
    for(const suffix of [...suffixes,'CLOSED'])add('CURRENT_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':suffix==='VOLUME'?'volume':'scalar');
    for(const group of ['PREVIOUS','HIGHER1','HIGHER2','HISTORY_BASE','HISTORY_HIGHER1','HISTORY_HIGHER2'])for(const suffix of suffixes)add(group+'_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':'volume');
    const fields=['ARROW2_PROTOCOL','ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN',...tagged.map(f=>f.name),'ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B','ARROW2_SEQ_END'],nodes=new Map();
    for(const key of fields){const title=one(`[data-test-id-value-title="${key}"]`,studies[0]),p=title?.parentElement;if(!p||p.children.length!==2||p.children[0]!==title)fail('PAPER_USER_SOURCE_FIELD_STRUCTURE_CHANGED');nodes.set(key,p.children[1]);}
    const read=key=>{const raw=norm(nodes.get(key)?.textContent);if(/^(?:∅|—|na)$/i.test(raw))return null;const value=num(raw);if(!integer(value))fail('PAPER_USER_SOURCE_INTEGER_REQUIRED');return value;};
    const seq=read('ARROW2_SEQ_BEGIN'),epoch=read('ARROW2_RUN_EPOCH'),raw=Object.fromEntries(fields.map(key=>[key,read(key)]));
    if(raw.ARROW2_PROTOCOL!==3||!integer(seq)||seq<0||raw.ARROW2_SEQ_END!==seq||read('ARROW2_SEQ_BEGIN')!==seq||read('ARROW2_SEQ_END')!==seq||read('ARROW2_RUN_EPOCH')!==epoch||binding.runId!=='CME_MINI:NQ1!|1|'+epoch)fail('PAPER_USER_COHERENT_SOURCE_RUN_REQUIRED');
    let a=0,b=0;for(const value of [epoch,seq,...tagged.map(f=>raw[f.name]??-1)]){a=(a*65599+((value%1000000007)+1000000007)%1000000007)%1000000007;b=(b*131071+((value%1000000009)+1000000009)%1000000009)%1000000009;}
    if(raw.ARROW2_CHECKSUM_A!==a||raw.ARROW2_CHECKSUM_B!==b)fail('PAPER_USER_SOURCE_CHECKSUM_MISMATCH');
    const decoded={};for(const field of tagged){const value=raw[field.name];if(value===null){decoded[field.name]=null;continue;}const base=field.kind==='price'?20000000000:1e12,payload=value%base;
      if(value<0||Math.floor(value/base)!==seq%4096)fail('PAPER_USER_SOURCE_TAG_MISMATCH');decoded[field.name]=field.kind==='price'?(payload-1e10)/10000:field.kind==='time'?payload+1577836800000:payload;}
    const emitted=decoded.ARROW2_SOURCE_EPOCH;if(decoded.ARROW2_SUPPORTED!==3||decoded.ARROW2_BASE_MS!==60000||decoded.ARROW2_TICK!==.25||decoded.ARROW2_POINT!==20||!integer(emitted)||emitted<now()-15000||emitted>now()+5000)fail('PAPER_USER_LIVE_SOURCE_CURRENTNESS_REQUIRED');
    const bar=(group,current=false)=>{const time=decoded['ARROW2_'+group+'_TIME'],proof=decoded['ARROW2_'+group+'_CLOSE_TIME']-1577836800000,values=Object.fromEntries(['OPEN','HIGH','LOW','CLOSE'].map(k=>[k.toLowerCase(),decoded['ARROW2_'+group+'_'+k]])),closed=current?decoded.ARROW2_CURRENT_CLOSED===1:true;
      if(!integer(time)||!integer(proof)||proof<0||!Object.values(values).every(tick)||values.high<Math.max(values.open,values.close,values.low)||values.low>Math.min(values.open,values.close,values.high)||time>emitted||closed&&time+60000>emitted)fail('PAPER_USER_SOURCE_BAR_INVALID');
      return {time,closeTime:time+60000,...values,closed,providerBarIndex:Math.floor(proof/4)};};
    if(![0,1].includes(decoded.ARROW2_CURRENT_CLOSED))fail('PAPER_USER_SOURCE_FINALITY_INVALID');
    const current=bar('CURRENT',true),previous=bar('PREVIOUS'),closed=current.closed?current:previous;
    if(!current.closed&&previous.closeTime!==current.time||closed.closeTime!==binding.asOfTime||['time','closeTime','open','high','low','close'].some(k=>closed[k]!==binding.closedBar[k])||emitted-current.closeTime>15000)fail('PAPER_USER_APPROVED_CLOSED_BAR_CHANGED');
    return {runId:binding.runId,sequence:seq,sourceEmittedAt:emitted,current,closed,latestClosedAt:closed.closeTime,sourceVerified:true,checksumsVerified:true,observedAt:now(),verificationEpochMs:performance.timeOrigin+perf()};
  }
  function guardInstall(){
    if(state.guards)return;if(typeof document.addEventListener!=='function')fail('PAPER_USER_ACTIVITY_GUARD_REQUIRED');
    const invalidate=event=>{if(event?.isTrusted===true){state.generation++;state.lease=null;if(state.own&&!state.own.fillVerified)state.own.interfered=true;}};
    for(const type of ['pointerdown','keydown','beforeinput','wheel','touchstart','visibilitychange','pagehide'])document.addEventListener(type,invalidate,{capture:true,passive:true});state.guards=true;
  }
  async function settle(check){const started=perf();while(perf()-started<1200){if(check()){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(check())return;}await new Promise(resolve=>setTimeout(resolve,20));}fail('PAPER_USER_NATIVE_READ_DID_NOT_SETTLE');}
  async function applyFavorite({direction}={}){
    const generation=state.generation,before=native({requireQuote:false});if(before.bound.mode!=='ORDER')fail('PAPER_USER_ORDER_PRESET_REQUIRED');
    if(direction!==undefined&&!['LONG','SHORT'].includes(direction))fail('PAPER_USER_TECHNICAL_SIDE_REQUIRED');
    if(expected.nativePresetName!==undefined&&!bounded(expected.nativePresetName,240))fail('PAPER_USER_PRESET_NAME_INVALID');
    const check=predicate=>{if(state.generation!==generation)fail('PAPER_USER_NATIVE_CONTEXT_INTERRUPTED');try{return predicate(native({requireQuote:false}));}catch(e){if(e?.paperUserCode==='PAPER_USER_NATIVE_CONTROLS_UNVERIFIED')return false;throw e;}};
    if(direction&&before.direction!==direction){(direction==='LONG'?before.buy:before.sell).click();await settle(()=>check(value=>value.bound.mode==='ORDER'&&value.direction===direction));}
    const notices=()=>all('div[role="tooltip"]').map(node=>({node,text:label(node)})).filter(x=>/^Preset "(.+)" applied$/.test(x.text)),old=notices().map(x=>x.node),current=native({requireQuote:false});
    if(current.bound.mode!=='ORDER'||direction&&current.direction!==direction)fail('PAPER_USER_ORDER_PRESET_CONTEXT_CHANGED');
    current.favorite.click();let receipt=null;
    await settle(()=>check(value=>{
      const shown=notices();if(shown.length!==1||old.includes(shown[0].node)||value.bound.mode!=='ORDER'||!value.preset.ready||direction&&value.direction!==direction)return false;
      const name=/^Preset "(.+)" applied$/.exec(shown[0].text)[1];if(!bounded(name,240)||expected.nativePresetName!==undefined&&name!==expected.nativePresetName)return false;
      receipt={kind:'NATIVE_PAPER_FAVORITE_PRESET_APPLICATION_V1',name,nameVerified:true,favoriteDataQa:'favorite-preset-tag-1',applicationNotice:shown[0].text,freshNoticeVerified:true,
        fingerprint:value.preset.fingerprint,account:expected.nativeAccountId,researchUrl:expected.researchUrl,sourceTabId:expected.sourceTabId,generation,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()};return true;
    }));
    if(!receipt)fail('PAPER_USER_PRESET_APPLICATION_UNVERIFIED');state.appliedPreset=receipt;return copy(receipt);
  }
  // Historical native application evidence is read-only. Source disarm revokes
  // the separate entry lease, not an unchanged same-document preset receipt.
  // Every prepare still performs a fresh native application before any lease.
  function appliedPreset(value){const p=state.appliedPreset;return value.bound.mode==='ORDER'&&p?.account===expected.nativeAccountId&&p.documentTimeOrigin===performance.timeOrigin&&p.researchUrl===expected.researchUrl&&p.sourceTabId===expected.sourceTabId
    &&(expected.nativePresetName===undefined||p.name===expected.nativePresetName)&&p.fingerprint===value.preset.fingerprint?copy(p):null;}
  const maps={positions:{symbol:'Symbol',side:'Side',qty:'Quantity',avgPrice:'Avg fill price'},orders:{symbol:'Symbol',side:'Side',type:'Type',qty:'Quantity',avgPrice:'Fill price',status:'Status',id:'Order ID'},history:{symbol:'Symbol',side:'Side',type:'Type',qty:'Quantity',avgPrice:'Fill price',status:'Status',id:'Order ID',placingTime:'Placing time'}};
  async function table(kind,generation){
    let bound=identity();const tab=one(`[role="tab"][id="${kind}"]`,bound.account);
    if(!tab)fail('PAPER_USER_ACCOUNT_TAB_REQUIRED');
    const check=()=>{if(state.generation!==generation)fail('PAPER_USER_NATIVE_CONTEXT_INTERRUPTED');const fresh=identity();return one(`[role="tab"][id="${kind}"]`,fresh.account)?.getAttribute('aria-selected')==='true'&&!all('[role="progressbar"]',fresh.account).length;};
    if(tab.getAttribute('aria-selected')!=='true')tab.click();await settle(check);bound=identity();
    const filterControls=all('[role="tab"],[role="combobox"],input',bound.account),statusFilters=filterControls.filter(n=>(n.getAttribute('id')??'').startsWith('orderstatus'));
    if(filterControls.some(n=>n.getAttribute('role')==='combobox'||n.tagName==='INPUT'))fail('PAPER_USER_FILTERED_ACCOUNT_TABLE_EXCLUDED');
    if(statusFilters.length){
      const allowed=['orderstatustatus-all','orderstatus-filled','orderstatus-cancelled','orderstatus-rejected'],allFilter=statusFilters.filter(n=>n.getAttribute('id')==='orderstatustatus-all'),shown=allFilter.length===1?norm(allFilter[0].innerText??allFilter[0].textContent):'',allLabel=/^All(?: (\d+))?(?:\s*All(?: (\d+))?)?$/.exec(shown);
      if(kind!=='history'||statusFilters.length!==4||statusFilters.some(n=>!allowed.includes(n.getAttribute('id')))||new Set(statusFilters.map(n=>n.getAttribute('id'))).size!==4||allFilter.length!==1||allFilter[0].getAttribute('aria-selected')!=='true'||statusFilters.some(n=>n!==allFilter[0]&&n.getAttribute('aria-selected')!=='false')||!allLabel||allLabel[1]&&allLabel[2]&&allLabel[1]!==allLabel[2])fail('PAPER_USER_FILTERED_ACCOUNT_TABLE_EXCLUDED');
    }else if(kind==='history')fail('PAPER_USER_NATIVE_HISTORY_ALL_FILTER_REQUIRED');
    const grid=one(`table[data-name="Paper.${kind}-table"]`,bound.account),body=grid?.querySelector('tbody');if(!grid||!body||grid.getAttribute('role')!=='grid')fail('PAPER_USER_PUBLIC_TABLE_REQUIRED');
    const headers=[...grid.querySelectorAll('thead th')].map(n=>({id:n.getAttribute('id')??n.id,text:label(n)})),required=maps[kind];
    if(headers.length<4||headers.length>40||new Set(headers.map(h=>h.id)).size!==headers.length||Object.entries(required).some(([id,text])=>headers.filter(h=>h.id===id&&h.text===text).length!==1))fail('PAPER_USER_TYPED_TABLE_HEADERS_CHANGED');
    const exitHeaderMap=kind==='positions'?{takeProfit:'Take profit',stopLoss:'Stop loss'}:kind==='orders'?{limitPrice:'Limit price',stopPrice:'Stop price'}:null,
      exitHeadersVerified=!!exitHeaderMap&&Object.entries(exitHeaderMap).every(([id,text])=>headers.filter(h=>h.id===id&&h.text===text).length===1);
    const rows=[...body.querySelectorAll('tr')];if(rows.length>1000)fail('PAPER_USER_TABLE_SCOPE_LIMIT');
    const emptyElements=all('[data-qa-id="account-manager-tab-empty-state"]',body);
    const explicitEmpty=rows.length===1&&[...rows[0].querySelectorAll('td')].length===1&&Number(rows[0].querySelectorAll('td')[0].getAttribute('colspan'))===headers.length
      &&norm(body.textContent)==='Nothing to show yet. Your account activity will appear here.'&&emptyElements.length===1&&!rows[0].getAttribute('data-row-id');
    if(explicitEmpty)return {kind,headers,exitHeadersVerified,rows:[],explicitEmpty:true,proofKind:'NATIVE_PAPER_ACCOUNT_EMPTY_STATE_V1',scope:'SELECTED_NATIVE_PAPER_ACCOUNT_APP_EMPTY_STATE',observedAt:now()};
    if(!rows.length||emptyElements.length)fail('PAPER_USER_EMPTY_STATE_OR_ROWS_UNVERIFIED');
    const parsed=rows.map(row=>{const cells=[...row.querySelectorAll('td')];if(cells.length!==headers.length)fail('PAPER_USER_PARTIAL_NATIVE_ROW');const values=Object.fromEntries(headers.map((h,i)=>[h.id,label(cells[i])]));
      if(!bounded(values.symbol,240)||!['Buy','Sell','Long','Short'].includes(values.side)||!integer(num(values.qty))||num(values.qty)<1||kind!=='positions'&&(!/^\d{1,20}$/.test(values.id)||row.getAttribute('data-row-id')!==values.id))fail('PAPER_USER_NATIVE_ROW_IDENTITY_UNVERIFIED');return values;});
    if(kind!=='positions'&&new Set(parsed.map(r=>r.id)).size!==parsed.length)fail('PAPER_USER_DUPLICATE_NATIVE_ORDER_ID');
    if(kind==='orders'&&parsed.some(r=>!['working','inactive','pending','partially_filled'].includes(r.status)))fail('PAPER_USER_CURRENT_ORDER_STATUS_UNVERIFIED');
    return {kind,headers,exitHeadersVerified,rows:parsed,explicitEmpty:false,proofKind:'NATIVE_PAPER_TYPED_PUBLIC_ROWS_V1',scope:'RENDERED_PUBLIC_ROWS_NOT_COMPLETE_HISTORY',observedAt:now()};
  }
  async function accountState({withHistory=false,requireQuote=true}={}){
    const generation=state.generation,bound=identity(),prior=all('[role="tab"][aria-selected="true"]',bound.account).map(n=>n.getAttribute('id')).filter(id=>['positions','orders','history','account-history','trading-journal','broker-trades','broker-analytics'].includes(id));
    const positions=await table('positions',generation),orders=await table('orders',generation),history=withHistory?await table('history',generation):null;
    if(prior.length===1){const current=identity(),tab=one(`[role="tab"][id="${prior[0]}"]`,current.account);if(tab&&tab.getAttribute('aria-selected')!=='true'){tab.click();await settle(()=>{if(state.generation!==generation)fail('PAPER_USER_NATIVE_CONTEXT_INTERRUPTED');return one(`[role="tab"][id="${prior[0]}"]`,identity().account)?.getAttribute('aria-selected')==='true';});}}
    const value=await readNativeCoherent(generation,{requireQuote}),domEmpty=value.bound.mode==='DOM'&&label(value.position)==='—'&&label(value.pnl)==='—'&&value.buyCancel.disabled===true&&value.sellCancel.disabled===true;
    const flat=positions.explicitEmpty&&orders.explicitEmpty&&(value.bound.mode==='ORDER'||domEmpty);
    return {value,positions,orders,history,flat,positionsComplete:positions.explicitEmpty,workingOrdersComplete:orders.explicitEmpty,
      proofKind:'NATIVE_PAPER_ACCOUNT_EMPTY_STATE_V1',scope:'SELECTED_NATIVE_PAPER_ACCOUNT_APP_EMPTY_STATE_NOT_API_SNAPSHOT',domEmptyCorroborated:domEmpty,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()};
  }
  function connection(snapshot,live){return {status:'PAPER_USER_CONNECTION_VERIFIED',provider:'TRADINGVIEW_PAPER',environment:'DEMO',environmentVerified:true,nativeAccountId:snapshot.value.bound.nativeAccountId,symbol:snapshot.value.bound.symbol,quantity:snapshot.value.quantity,quantityRaw:snapshot.value.quantityRaw,
    observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf(),flat:snapshot.flat,positionsComplete:snapshot.positionsComplete,workingOrdersComplete:snapshot.workingOrdersComplete,
    positions:snapshot.positions.rows,workingOrders:snapshot.orders.rows,inventoryProofKind:snapshot.proofKind,inventoryScope:snapshot.scope,nativeControlRead:snapshot.value.controlRead,sourceVerified:!!live,latestClosedAt:live?.latestClosedAt??null,liveSource:live,
    executionSurface:snapshot.value.bound.mode==='ORDER'?'ORDER_TICKET_PRESET':'DOM_MARKET',nativePreset:snapshot.value.preset?{...snapshot.value.preset,application:appliedPreset(snapshot.value)}:null,domEmptyCorroborated:snapshot.domEmptyCorroborated,
    protectionVerified:false,userManaged:true,postFillManagement:false,realBrokerOrdersAuthorized:false};}
  function permitCheck(permit,attemptKey){
    const b=permit?.binding,s=permit?.signal;
    if(permit?.kind!=='EXECUTION_LIFECYCLE_ENTRY_PERMIT'||permit.version!=='execution-lifecycle-1'||!bounded(permit.id)||!bounded(permit.sessionId)||!integer(permit.generation)||permit.generation<0
      ||!plain(b)||b.accountIdentity?.provider!=='TRADINGVIEW_PAPER'||b.accountIdentity.environment!=='DEMO'||b.accountIdentity.nativeAccountId!==expected.nativeAccountId||b.adapterId!=='tradingview-paper-market-ui'
      ||b.accountRevision!==expected.accountRevision||b.selectionKey!==expected.selectionKey||!bounded(b.sourceIdentity)||!bounded(b.sourceRunId)||!/^NQ[HMUZ]20\d\d$/.test(b.symbol)||!integer(b.quantity)||b.quantity<1
      ||s?.status!=='CONFIRMED'||s.synthetic!==false||s.testOnly!==false||!['LONG','SHORT'].includes(s.direction)||!bounded(s.eventId,1024)||s.symbol!==b.symbol||s.sourceIdentity!==b.sourceIdentity||s.sourceRunId!==b.sourceRunId||!integer(s.confirmedAt)||s.confirmationBarCloseTime!==s.confirmedAt
      ||!finite(permit.issuedAt)||!finite(permit.expiresAt)||permit.issuedAt<0||permit.expiresAt>8640000000000000||now()<permit.issuedAt||now()>permit.expiresAt||permit.expiresAt-permit.issuedAt>2000||permit.expiresAt<=permit.issuedAt)fail('PAPER_USER_CURRENT_ENTRY_PERMIT_REQUIRED');
    const key=['execution-attempt-1','TRADINGVIEW_PAPER','DEMO',expected.nativeAccountId,b.symbol,s.eventId].map(encodeURIComponent).join(':');if(attemptKey!==key)fail('PAPER_USER_DURABLE_ATTEMPT_KEY_MISMATCH');return b;
  }
  function approvalCheck(permit,approval,witness,binding,quote,sourceClose,sourceEmittedAt){
    const profiles={CANDLE_TREND_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],CANDLE_REVERSAL_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],CANDLE_RANGE_EDGE:['STRUCTURE','KNOWN_LOCATION'],PIN_TREND_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],PIN_CONFLUENCE:['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME'],PIN_RANGE_EDGE:['STRUCTURE','KNOWN_LOCATION'],ENGULFING_EMA:['STRUCTURE','EMA'],ENGULFING_FIB:['STRUCTURE','FIB'],ENGULFING_TRENDLINE:['STRUCTURE','TRENDLINE'],ENGULFING_RANGE:['STRUCTURE','KNOWN_LOCATION'],ENGULFING_SUPPLY_DEMAND:['STRUCTURE','SUPPLY_DEMAND'],ENGULFING_RANGE_RECLAIM:['STRUCTURE','KNOWN_LOCATION'],HANGING_MAN_REVERSAL:['STRUCTURE','KNOWN_LOCATION'],INVERTED_HAMMER_REVERSAL:['STRUCTURE','KNOWN_LOCATION'],INSIDE_BREAKOUT:['STRUCTURE','KNOWN_LOCATION'],INSIDE_FALSE_BREAK:['STRUCTURE','KNOWN_LOCATION'],INSIDE_FALSE_BREAK_FIB:['STRUCTURE','FIB'],ROLE_REVERSAL_RETEST:['STRUCTURE','KNOWN_LOCATION']};
    const a=approval,s=permit.signal,passed=row=>['required','enabled','available','passed'].every(k=>row?.[k]===true)&&row.state==='PASS'&&row.pendingConfirmation!==true;
    if(a?.engineDefinitionVersion!=='guide-signals-5'||a.technicalDecisionVersion!=='guide-technical-decision-1'||a.approvalPolicy!=='guide_scenarios_v1'||a.eventId!==s.eventId||a.direction!==s.direction||a.asOfTime!==s.confirmedAt||a.confirmationBarCloseTime!==s.confirmedAt
      ||!integer(a.confirmedAt)||a.confirmedAt<s.confirmedAt||!integer(a.analysisAsOfTime)||a.analysisAsOfTime<a.confirmedAt||a.analysisAsOfTime>sourceEmittedAt
      ||a.confirmationPolicy!=='later_close_beyond_setup'||a.synthetic===true||a.testOnly===true||a.roleReversalEnabled!==true||a.supplyDemandEnabled!==true
      ||!Array.isArray(a.sourceEventIds)||!a.sourceEventIds.length||a.sourceEventIds.length>600||a.sourceEventIds.some(id=>!bounded(id,1024))||new Set(a.sourceEventIds).size!==a.sourceEventIds.length||!Array.isArray(a.strategyProofs)||!a.strategyProofs.length||a.strategyProofs.length>18||new Set(a.strategyProofs.map(p=>p?.profileId)).size!==a.strategyProofs.length)fail('PAPER_USER_REAL_TECHNICAL_APPROVAL_REQUIRED');
    const covered=[];for(const p of a.strategyProofs){const needed=Object.hasOwn(profiles,p?.profileId)?profiles[p.profileId]:null;if(!needed||!same(p.requiredCheckIds,needed)||!Array.isArray(p.requiredChecks)||p.requiredChecks.length!==needed.length||needed.some(id=>p.requiredChecks.filter(r=>r.id===id&&passed(r)).length!==1)||!Array.isArray(p.sourceEventIds)||!p.sourceEventIds.length||p.sourceEventIds.some(id=>!a.sourceEventIds.includes(id)))fail('PAPER_USER_STRATEGY_PROFILE_PROOF_REQUIRED');covered.push(...p.sourceEventIds);}
    const union=[...new Set(a.strategyProofs.flatMap(p=>p.requiredCheckIds))];if(covered.length!==a.sourceEventIds.length||new Set(covered).size!==covered.length||!Array.isArray(a.requiredChecks)||a.requiredChecks.length!==union.length||union.some(id=>a.requiredChecks.filter(r=>r.id===id&&passed(r)).length!==1))fail('PAPER_USER_STRATEGY_UNION_PROOF_REQUIRED');
    if(binding.runId!==permit.binding.sourceRunId||binding.asOfTime!==s.confirmedAt||witness?.kind!=='CURRENT_LIVE_QUOTE_PRESERVES_FROZEN_SETUP'||witness.direction!==s.direction||witness.asOfTime!==s.confirmedAt||witness.pricesAdjusted!==false||!same(witness.sourceEventIds,a.sourceEventIds)||!Array.isArray(witness.setups)||witness.setups.length!==a.sourceEventIds.length||new Set(witness.setups.map(x=>x?.eventId)).size!==witness.setups.length
      ||witness.setups.some(x=>!a.sourceEventIds.includes(x.eventId)||!tick(x.trigger)||!tick(x.structuralInvalidation)))fail('PAPER_USER_FROZEN_TECHNICAL_ENTRY_WITNESS_REQUIRED');
    const confirmedClose=binding.closedBar?.close;
    const eligible=witness.setups.filter(x=>tick(confirmedClose)&&(s.direction==='LONG'?confirmedClose>x.trigger&&quote>=x.structuralInvalidation&&sourceClose>=x.structuralInvalidation:confirmedClose<x.trigger&&quote<=x.structuralInvalidation&&sourceClose<=x.structuralInvalidation));
    if(!eligible.length)fail('PAPER_USER_CURRENT_QUOTE_INVALIDATED_SETUP');return eligible.map(x=>x.eventId);
  }
  function idle(){const replay=globalThis[Symbol.for('arrow.user-market-ui.v1')],old=globalThis[Symbol.for('arrow.paper-ui-driver.v1')];if(replay&&(replay.busy||replay.lease||replay.own&&!replay.own.fillVerified)||old&&(old.prepared||old.lastSubmission))fail('PAPER_USER_OTHER_EXECUTION_MODE_UNRESOLVED');}
  function protectionProof(own,snapshot,position,entry,status){
    const reasons=[],preset=own.nativePreset,b=own.permit.binding,direction=own.permit.signal.direction,opposite=direction==='LONG'?'Sell':'Buy',sign=direction==='LONG'?1:-1,
      relative=!!preset&&preset.stop?.unit==='TICKS'&&preset.target?.unit==='TICKS'&&tick(entry),expectedPrices=relative?{stop:entry-sign*preset.stop.value*.25,target:entry+sign*preset.target.value*.25}:null,
      exits=position?{stop:num(position.stopLoss),target:num(position.takeProfit),stopRaw:position.stopLoss??null,targetRaw:position.takeProfit??null}:null,
      orders=snapshot.orders.rows,typedType=row=>String(row.type).replace(/\s+/g,'').toUpperCase();
    if(status!=='FILLED')reasons.push('OPEN_OWN_POSITION_NOT_OBSERVED');
    if(snapshot.positions.exitHeadersVerified!==true||snapshot.orders.exitHeadersVerified!==true)reasons.push('NATIVE_POSITION_AND_ORDER_EXIT_HEADER_LABELS_NOT_VERIFIED');
    if(!preset?.ready||!own.presetApplication?.nameVerified)reasons.push('OWN_APPLIED_NATIVE_PRESET_NOT_BOUND');
    if(!relative||!tick(expectedPrices?.stop)||!tick(expectedPrices?.target))reasons.push('RELATIVE_TICK_PRESET_AND_FILL_PRICES_REQUIRED');
    if(!position||!exits||exits.stop!==expectedPrices?.stop||exits.target!==expectedPrices?.target)reasons.push('NATIVE_POSITION_EXIT_FIELDS_DO_NOT_MATCH_PRESET');
    const eligible=orders.filter(row=>row.symbol==='CME_MINI:'+b.symbol&&row.side===opposite&&num(row.qty)===b.quantity&&row.status==='working'&&row.id!==own.nativeOrderId&&!own.baselineHistoryIds.includes(row.id)),
      stops=eligible.filter(row=>['STOP','STOPLOSS','STOPMARKET','STOPLOSSMARKET'].includes(typedType(row))&&num(row.stopPrice)===expectedPrices?.stop),
      targets=eligible.filter(row=>['LIMIT','TAKEPROFIT'].includes(typedType(row))&&num(row.limitPrice)===expectedPrices?.target);
    if(orders.length!==2||eligible.length!==2||stops.length!==1||targets.length!==1||stops[0]?.id===targets[0]?.id)reasons.push('EXACT_TWO_NEW_ACTIVE_OPPOSITE_NATIVE_BRACKET_ROWS_REQUIRED');
    const verified=reasons.length===0;
    return {kind:'PUBLIC_NATIVE_POSITION_BRACKET_FIELDS_AND_MATCHING_WORKING_ORDERS',status:verified?'INHERITED_NATIVE_PRESET_PROTECTION_VERIFIED':'UNVERIFIED',protectionVerified:verified,inheritanceVerified:verified,linkVerified:verified,
      linkBasis:verified?'PRIVATE_SINGLE_MARKET_FROM_FLAT_BASELINE_MATCHING_POSITION_EXIT_FIELDS_AND_TWO_NEW_OPPOSITE_WORKING_ROWS':null,brokerParentOrderIdVerified:false,apiProof:false,
      nativeOrderId:own.nativeOrderId,presetAtSubmit:preset??null,presetApplication:own.presetApplication??null,expectedPrices,positionExits:exits,stopOrder:stops.length===1?copy(stops[0]):null,targetOrder:targets.length===1?copy(targets[0]):null,
      workingOrders:copy(orders),reasonCodes:reasons,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()};
  }
  try{
    guardInstall();if(command.action==='disarm'){state.generation++;state.lease=null;identity();return result('DISARMED',{ownAttemptRetained:!!state.own});}
    identity();if(state.busy)fail('PAPER_USER_NATIVE_BUSY');state.busy=true;ownsBusy=true;
    if(command.action==='inspect'&&identity().mode==='ORDER'){
      if(state.own||state.lease)fail('PAPER_USER_PRESET_INSPECTION_WITH_OWN_ATTEMPT_EXCLUDED');
      const application=await applyFavorite({direction:command.direction}),snapshot=await accountState({requireQuote:false}),live=source(command.sourceBinding,{optional:true});
      return result('PAPER_USER_CONNECTION_VERIFIED',{...connection(snapshot,live),application,readOnly:false,presetApplied:true,inputValuesSetByDriver:false,submitCapabilityCreated:false});
    }
    const action=({inspect:'read_connection',preflight:'prepare',verify:'reconcile'})[command.action]??command.action;
    if(action==='read_connection'){
      const snapshot=await accountState({requireQuote:false}),live=source(command.sourceBinding,{optional:true});return result('PAPER_USER_CONNECTION_VERIFIED',{...connection(snapshot,live),readOnly:true,submitCapabilityCreated:false});
    }
    if(action==='prepare'){
      if(command.testOnly===true||command.synthetic===true)fail('PAPER_USER_TEST_SUBMISSION_EXCLUDED');idle();
      if(state.own)fail('PAPER_USER_OWN_ATTEMPT_UNRESOLVED');
      const b=permitCheck(command.permit,command.attemptKey);let snapshot=await accountState({withHistory:true}),live=source(command.sourceBinding);
      if(!snapshot.flat||snapshot.value.quantity!==b.quantity||snapshot.value.bound.symbol!==b.symbol)fail('PAPER_USER_FRESH_EMPTY_ACCOUNT_AND_NATIVE_QUANTITY_REQUIRED');
      approvalCheck(command.permit,command.approvalProof,command.technicalEntryWitness,command.sourceBinding,snapshot.value.quotes?.[command.permit.signal.direction]??snapshot.value.quote,live.current.close,live.sourceEmittedAt);
      if(snapshot.value.bound.mode==='ORDER'){
        await applyFavorite({direction:command.permit.signal.direction});snapshot=await accountState({withHistory:true});live=source(command.sourceBinding);permitCheck(command.permit,command.attemptKey);
        if(!snapshot.flat||snapshot.value.quantity!==b.quantity||snapshot.value.bound.symbol!==b.symbol||snapshot.value.direction!==command.permit.signal.direction||!snapshot.value.preset.ready||!appliedPreset(snapshot.value))fail('PAPER_USER_APPLIED_PRESET_OR_QUANTITY_CHANGED');
      }
      const eligible=approvalCheck(command.permit,command.approvalProof,command.technicalEntryWitness,command.sourceBinding,snapshot.value.quote,live.current.close,live.sourceEmittedAt),at=now();
      const prepared={kind:'EXECUTION_SESSION_NATIVE_PREPARATION_V1',status:'READY',binding:copy(b),direction:command.permit.signal.direction,quantity:b.quantity,privateLeaseId:crypto.randomUUID(),expiresAt:Math.min(command.permit.expiresAt,at+750),connection:connection(snapshot,live),
        executionSurface:snapshot.value.bound.mode==='ORDER'?'ORDER_TICKET_PRESET':'DOM_MARKET',nativePreset:snapshot.value.preset?copy(snapshot.value.preset):null,presetApplication:appliedPreset(snapshot.value)};
      if(prepared.expiresAt<=at)fail('PAPER_USER_NATIVE_PREPARATION_EXPIRED');
      state.lease={prepared:copy(prepared),permit:copy(command.permit),attemptKey:command.attemptKey,approval:copy(command.approvalProof),witness:copy(command.technicalEntryWitness),sourceBinding:copy(command.sourceBinding),baselineHistoryIds:snapshot.history.rows.map(r=>r.id),generation:state.generation,observedPerformance:perf(),eligible};
      return prepared;
    }
    if(action==='submit'){
      const lease=state.lease,b=permitCheck(command.permit,command.attemptKey);
      if(command.testOnly===true||command.synthetic===true||!lease||lease.generation!==state.generation||!same(command.nativePrepared,lease.prepared)||!same(command.permit,lease.permit)||command.attemptKey!==lease.attemptKey||now()>lease.prepared.expiresAt||perf()-lease.observedPerformance>750||perf()<lease.observedPerformance)fail('PAPER_USER_PRIVATE_NATIVE_LEASE_REQUIRED');
      const r=command.record;if(r?.key!==command.attemptKey||r.status!=='UNKNOWN'||!same(r.accountIdentity,b.accountIdentity)||!same(r.intentBinding?.binding,b)||!same(r.intentBinding?.signal,command.permit.signal)||r.history?.[0]?.phase!=='RESERVED_BEFORE_DISPATCH')fail('PAPER_USER_DURABLE_UNKNOWN_BEFORE_DISPATCH_REQUIRED');
      if(state.consumed.includes(command.attemptKey)||state.own)fail('PAPER_USER_NATIVE_ATTEMPT_ALREADY_CONSUMED');idle();
      const snapshot=await accountState(),live=source(lease.sourceBinding),value=native();
      if(!snapshot.flat||value.quantity!==b.quantity||value.bound.symbol!==b.symbol||state.generation!==lease.generation||state.lease!==lease||now()>lease.prepared.expiresAt||perf()-lease.observedPerformance>750)fail('PAPER_USER_FINAL_EMPTY_ACCOUNT_OR_NATIVE_CONTEXT_CHANGED');
      if((value.bound.mode==='ORDER'?'ORDER_TICKET_PRESET':'DOM_MARKET')!==lease.prepared.executionSurface||value.bound.mode==='ORDER'&&(!value.preset.ready||value.direction!==command.permit.signal.direction||value.preset.fingerprint!==lease.prepared.nativePreset?.fingerprint||!same(appliedPreset(value),lease.prepared.presetApplication)))fail('PAPER_USER_FINAL_PRESET_OR_EXECUTION_SURFACE_CHANGED');
      const eligible=approvalCheck(command.permit,lease.approval,lease.witness,lease.sourceBinding,value.quote,live.current.close,live.sourceEmittedAt);
      if(state.consumed.length>=2048)fail('PAPER_USER_NATIVE_LEDGER_FULL');state.consumed.push(command.attemptKey);state.lease=null;
      state.own={attemptKey:command.attemptKey,permit:copy(command.permit),baselineHistoryIds:[...lease.baselineHistoryIds],nativeOrderId:null,fillVerified:false,interfered:false,submittedAt:now(),submittedPerformance:perf(),documentTimeOrigin:performance.timeOrigin,
        executionSurface:lease.prepared.executionSurface,nativePreset:copy(lease.prepared.nativePreset),presetApplication:copy(lease.prepared.presetApplication)};
      gestureStarted=true;(value.bound.mode==='ORDER'?value.submit:command.permit.signal.direction==='LONG'?value.buy:value.sell).click();
      return result('PAPER_USER_SUBMITTED_UNCONFIRMED',{submitted:true,ordersCreated:null,attemptKey:command.attemptKey,submissionAttempted:true,eligibleSetupIds:eligible,executionSurface:state.own.executionSurface,nativePreset:state.own.nativePreset,presetApplication:state.own.presetApplication,documentTimeOrigin:performance.timeOrigin,submittedPerformance:state.own.submittedPerformance,verificationEpochMs:performance.timeOrigin+perf()});
    }
    if(action==='reconcile'){
      const r=command.record,own=state.own?.attemptKey===r?.key?state.own:state.lastClosed?.attemptKey===r?.key?state.lastClosed:null;if(!own||r?.key!==own.attemptKey||!same(r.intentBinding?.binding,own.permit.binding)||own.interfered)fail('PAPER_USER_PRIVATE_OWN_ATTEMPT_REQUIRED');
      const snapshot=await accountState({withHistory:true,requireQuote:false}),live=source(command.sourceBinding),b=own.permit.binding,side=own.permit.signal.direction==='LONG'?'Buy':'Sell';
      const candidates=snapshot.history.rows.filter(row=>(own.nativeOrderId?row.id===own.nativeOrderId:!own.baselineHistoryIds.includes(row.id))&&row.symbol==='CME_MINI:'+b.symbol&&row.side===side&&row.type==='Market'&&num(row.qty)===b.quantity&&row.status==='filled'&&finite(num(row.avgPrice))&&num(row.avgPrice)>0);
      if(candidates.length!==1)fail('PAPER_USER_UNIQUE_NEW_NATIVE_MARKET_FILL_REQUIRED');const order=candidates[0];own.nativeOrderId=order.id;
      const matching=snapshot.positions.rows.filter(row=>row.symbol==='CME_MINI:'+b.symbol&&[side,side==='Buy'?'Long':'Short'].includes(row.side)&&num(row.qty)===b.quantity&&num(row.avgPrice)===num(order.avgPrice));
      const nativePositionText=label(snapshot.value.position),positionParts=/^(-?\d+) @ ([\d,]+\.\d{2})$/.exec(nativePositionText.replace(/\u2212/g,'-')),
        positionMatches=snapshot.value.bound.mode==='ORDER'||positionParts&&Math.abs(num(positionParts[1]))===b.quantity&&num(positionParts[2])===num(order.avgPrice)&&(side==='Sell'||num(positionParts[1])>0);
      let status;if(snapshot.positions.rows.length===1&&matching.length===1&&positionMatches){own.fillVerified=true;own.closedReceipts=[];status='FILLED';}
      else if(own.fillVerified&&snapshot.flat){status='CLOSED';}else fail('PAPER_USER_NATIVE_OWN_POSITION_OR_CLOSURE_UNVERIFIED');
      const observedAt=now(),sampleId=crypto.randomUUID();
      if(status==='CLOSED'){
        own.closedReceipts??=[];if(own.closedReceipts.length&&observedAt<=own.closedReceipts.at(-1).observedAt)fail('PAPER_USER_DISTINCT_CLOSURE_OBSERVATION_REQUIRED');
        own.closedReceipts.push({sampleId,observedAt,latestClosedAt:live.latestClosedAt});own.closedReceipts=own.closedReceipts.slice(-2);
      }
      const nativeProtection=protectionProof(own,snapshot,matching[0]??null,num(order.avgPrice),status);
      return result('PAPER_USER_OWNED_STATE_VERIFIED',{submitted:true,ordersCreated:true,ownedStatus:status,fillVerified:own.fillVerified,closedVerified:status==='CLOSED',ownershipVerified:true,nativeOrderId:order.id,
        attemptKey:own.attemptKey,intentKey:own.attemptKey,provider:'TRADINGVIEW_PAPER',environment:'DEMO',environmentVerified:true,nativeAccountId:expected.nativeAccountId,symbol:b.symbol,direction:own.permit.signal.direction,quantity:b.quantity,entry:num(order.avgPrice),
        positionsComplete:true,workingOrdersComplete:true,positions:status==='FILLED'?[{symbol:b.symbol,direction:own.permit.signal.direction,quantity:b.quantity}]:[],workingOrders:snapshot.orders.rows.map(row=>({symbol:row.symbol.replace(/^CME_MINI:/,''),orderId:row.id,direction:['Buy','Long'].includes(row.side)?'LONG':'SHORT',quantity:num(row.qty)})),
        observedAt,sampleId,latestClosedAt:live.latestClosedAt,sourceVerified:true,documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf(),
        ownershipBasis:'PRIVATE_SINGLE_PAPER_DISPATCH_NEW_TYPED_HISTORY_ID_AND_MATCHING_NATIVE_POSITION',nativeOrderRow:order,nativePositionRow:matching[0]??null,nativeWorkingOrderRows:copy(snapshot.orders.rows),
        executionSurface:own.executionSurface,nativePreset:own.nativePreset,presetApplication:own.presetApplication,
        nativeProtection,inventoryProofKind:snapshot.proofKind,protectionVerified:nativeProtection.protectionVerified});
    }
    if(action==='release_closed'){
      const own=state.own,r=command.record,p=r?.history?.at(-1)?.proof;
      if(!own||r?.key!==own.attemptKey||r.status!=='CLOSED'||!same(r.intentBinding?.binding,own.permit.binding)||!same(r.intentBinding?.signal,own.permit.signal)||own.closedReceipts?.length!==2
        ||p?.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||p.intentKey!==own.attemptKey||p.status!=='CLOSED'||p.nativeOrderId!==own.nativeOrderId||p.closedVerified!==true||p.attributionVerified!==true
        ||p.accountEvidence?.provider!=='TRADINGVIEW_PAPER'||p.accountEvidence.environment!=='DEMO'||p.accountEvidence.nativeAccountId!==expected.nativeAccountId||!Array.isArray(p.closureSamples)||p.closureSamples.length!==2
        ||p.closureSamples.some((sample,i)=>sample.sampleId!==own.closedReceipts[i].sampleId||sample.observedAt!==own.closedReceipts[i].observedAt||sample.latestClosedAt!==own.closedReceipts[i].latestClosedAt||sample.attemptKey!==own.attemptKey||sample.positionsComplete!==true||sample.workingOrdersComplete!==true||sample.positions?.length!==0||sample.workingOrders?.length!==0))fail('PAPER_USER_DURABLE_CLOSED_ACK_REQUIRED');
      state.lastClosed=own;state.own=null;state.lease=null;state.generation++;return result('PAPER_USER_CLOSED_RELEASED',{attemptKey:r.key,intentKey:r.key,nativeOrderId:own.nativeOrderId,closedVerified:true});
    }
    fail('PAPER_USER_UNKNOWN_ACTION');
  }catch(error){state.lease=null;const code=error?.paperUserCode??'PAPER_USER_NATIVE_OPERATION_FAILED';return result(gestureStarted||command.action==='reconcile'&&state.own?'UNKNOWN':'BLOCKED',{reasonCodes:[code],...(error?.controlDiagnostics?{controlDiagnostics:error.controlDiagnostics}:{}),submitted:state.own?true:false,ordersCreated:state.own?null:false,submitCapabilityCreated:false});}
  finally{if(ownsBusy)state.busy=false;}
}
