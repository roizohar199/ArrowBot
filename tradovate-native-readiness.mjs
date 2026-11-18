// Serialized public-DOM observation only. No click, preset application, order
// operation, credential, storage, network call, or native authority is created.
export function readTradovateNativeReadiness(command={}){
  const at=Date.now(),base={kind:'TRADOVATE_NATIVE_READINESS_V1',observedAt:at,
    mode:'READ_ONLY_PA_PREPARATION',status:'INCOMPLETE',readOnly:true,ordersCreated:false,submitted:false,
    botActive:false,executionReady:false,realBrokerOrdersAuthorized:false,credentialsStored:false,
    capabilities:{inspectAccount:true,preflight:false,submitMarket:false,reconcile:false},
    account:null,source:null,preset:null,inventory:null,checks:[],missingChecks:[],reasonCodes:[]};
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim(),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x),
    text=(x,max=240)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x),
    integer=Number.isSafeInteger,number=x=>{const s=norm(x).replace(/\u2212/g,'-').replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;};
  const visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
    let p=node;for(let depth=0;p&&depth<64;depth++,p=p.parentElement){
      const s=getComputedStyle(p);if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.contentVisibility==='hidden')return false;
    }return !p;
  };
  const all=(selector,root=document,max=1000)=>{const nodes=root.querySelectorAll(selector);if(nodes.length>max)throw Error('PA_READINESS_DOM_LIMIT');return [...nodes].filter(visible);},
    one=(selector,root=document)=>{const nodes=all(selector,root);return nodes.length===1?nodes[0]:null;},
    label=n=>norm(n?.textContent),disabled=n=>!n||n.disabled===true||n.getAttribute('aria-disabled')==='true';
  const missing=new Set(['EXECUTION_ADAPTER_NOT_IMPLEMENTED','BROKER_ENVIRONMENT_NOT_ATTESTED','NATIVE_INVENTORY_COMPLETENESS_NOT_VERIFIED','PRESET_INHERITANCE_NOT_VERIFIED']);
  function check(id,passed,available=true,evidence={}){base.checks.push({id,passed:passed===true,available:available===true,evidence});if(passed!==true)missing.add(id);}
  function done(status=base.status){base.status=status;base.missingChecks=[...missing];base.reasonCodes=[...missing];return base;}
  const blocked=code=>{missing.add(code);return done('BLOCKED');};
  try{
    if(!plain(command)||!integer(command.sourceTabId)||command.sourceTabId<1||!text(command.sourceUrl,4096)||!text(command.nativeAccountId)||command.environment!=='PA')return blocked('EXPLICIT_PA_ACCOUNT_AND_SOURCE_REQUIRED');
    let url;try{url=new URL(command.sourceUrl);if(url.protocol!=='https:'||!['www.tradingview.com','tradingview.com'].includes(url.hostname)||!/^\/chart\/[A-Za-z0-9_-]+\/$/.test(url.pathname)||url.search||url.hash||url.username||url.password||url.port)throw Error();}catch{return blocked('EXACT_TRADINGVIEW_SOURCE_REQUIRED');}
    if(location.href!==url.href)return blocked('PA_SOURCE_TAB_CHANGED');
    base.source={tabId:command.sourceTabId,url:url.href};
    if(document.visibilityState!=='visible'||document.hidden===true)return blocked('PA_VISIBLE_SOURCE_REQUIRED');
    if(all('[role="dialog"],[aria-modal="true"]',document,30).length)return blocked('PA_EXISTING_DIALOG_REQUIRES_REVIEW');
    const replay=all('#header-toolbar-replay',document,10);
    if(replay.length!==1||(replay[0].getAttribute('aria-pressed')??replay[0].getAttribute('aria-checked'))!=='false'||all('[data-qa-id="replay_trading"]',document,10).length)return blocked('PA_LIVE_NON_REPLAY_SOURCE_REQUIRED');
    const providers=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]',document,10),names=[...new Set(providers.map(label))];
    if(!providers.length||providers.length>3||names.length!==1||names[0]!=='Tradovate')return blocked('EXACT_TRADOVATE_PROVIDER_REQUIRED');
    const manager=one('[aria-label="Account manager"]'),selector=manager&&one('[data-qa-id="account-selector"]',manager),nativeNames=selector?all('[class*="accountName-"]',selector,10):[];
    if(!manager||nativeNames.length!==1)return blocked('EXACT_VISIBLE_NATIVE_ACCOUNT_REQUIRED');
    if(label(nativeNames[0])!==command.nativeAccountId)return blocked('SELECTED_AND_VISIBLE_PA_ACCOUNT_DIFFER');
    base.account={provider:'TRADOVATE',nativeAccountId:label(nativeNames[0]),environment:'PA',environmentVerified:false,
      environmentBasis:'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED',nativeIdentityVerified:true,ordersAuthorized:false};
    check('EXACT_NATIVE_PA_ACCOUNT_MATCH',true);

    const panel=one('[aria-label="Trading panel"]'),ticket=panel&&one('[aria-label="Order ticket"]',panel),radios=panel?all('[role="radio"]',panel,10):[];
    const orderSelected=radios.filter(n=>label(n)==='Order'&&n.getAttribute('aria-checked')==='true').length===1&&radios.filter(n=>label(n)==='DOM'&&n.getAttribute('aria-checked')==='false').length===1;
    const titles=panel?all('[title]',panel,100).map(n=>n.getAttribute('title')):[],contracts=[...new Set(titles.filter(t=>/^NQ[HMUZ]20\d\d$/.test(t??'')))];
    const symbol=contracts.length===1?contracts[0]:null,mapping=symbol&&titles.includes(`Continuous futures is used for charting, but the ${symbol} contract will be used for order placement.`),
      existingOrderEditor=!!panel&&(all('[data-name="position-panel"]',panel,10).length>0||titles.some(t=>/^NQ[HMUZ]20\d\d, (?:order|position) /.test(t??'')));
    check('NEW_NATIVE_MARKET_ORDER_TICKET_REQUIRED',!!ticket&&orderSelected&&!existingOrderEditor,!!panel);
    check('EXACT_DATED_NQ_MAPPING_REQUIRED',!!symbol&&!!mapping,!!panel,{symbol});
    if(ticket&&orderSelected&&!existingOrderEditor){
      const qty=one('input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]',ticket),raw=qty?.value,quantity=number(raw),
        qtyType=one('[data-qa-id="quantity-dropdown-types"]',ticket),selected=all('[role="tab"][aria-selected="true"]',ticket,10),
        orderType=selected.length===1?norm(selected[0].getAttribute('id')).toUpperCase():null,
        buy=one('[data-name="side-control-buy"][role="button"]',ticket),sell=one('[data-name="side-control-sell"][role="button"]',ticket),
        active=n=>(n?.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-')),
        direction=active(buy)&&!active(sell)?'LONG':active(sell)&&!active(buy)?'SHORT':null,
        favorites=all('button[data-qa-id^="favorite-preset-tag-"]',ticket,20),favorite=favorites.length===1?favorites[0]:null;
      const readExit=kind=>{
        const sw=one(`input[role="switch"][data-qa-id="order-ticket-${kind}-checkbox-bracket"]`,ticket),field=one(`input[data-qa-id~="order-ticket-${kind}-input"]`,ticket),unitNode=one(`button[data-qa-id="order-ticket-${kind}-dropdown-button"]`,ticket),unitLabel=label(unitNode),
          unit=unitLabel===(kind==='take-profit'?'Take profit ticks':'Stop loss ticks')?'TICKS':/\bprice$/i.test(unitLabel)?'PRICE':/percent|%/i.test(unitLabel)?'PERCENT':/USD|dollar/i.test(unitLabel)?'USD':null,aria=sw?.getAttribute('aria-checked'),value=number(field?.value);
        return {enabled:!!sw&&sw.checked===true&&!disabled(sw)&&(aria===null||aria==='true'),switchConsistent:!!sw&&typeof sw.checked==='boolean'&&(aria===null||aria===String(sw.checked)),unit,unitLabel,value,valueRaw:field?.value??null,
          fieldObserved:!!field&&!disabled(field)&&field.readOnly!==true};
      };
      const stop=readExit('stop-loss'),target=readExit('take-profit'),goodExit=x=>x.enabled&&x.switchConsistent&&x.unit&&x.fieldObserved&&Number.isFinite(x.value)&&x.value>0&&(x.unit!=='TICKS'||integer(x.value)),
        nameCandidates=[];
      // A visible tooltip/accessible label is name evidence only. Reading it
      // cannot prove that it was freshly applied or inherited by an order.
      if(favorite){for(const value of [favorite.getAttribute('aria-label'),favorite.getAttribute('title')]){
        const valueText=norm(value),m=/^(?:Preset|Apply preset) ["“](.{1,160})["”]$/.exec(valueText);if(m)nameCandidates.push({name:m[1],basis:'VISIBLE_FAVORITE_ACCESSIBLE_LABEL'});
      }}
      for(const tooltip of all('[role="tooltip"]',document,30)){const m=/^Preset ["“](.{1,160})["”] applied$/.exec(label(tooltip));if(m)nameCandidates.push({name:m[1],basis:'VISIBLE_PRESET_NOTICE_NOT_FRESH_APPLICATION_PROOF'});}
      const presetNames=[...new Set(nameCandidates.map(n=>n.name))],name=presetNames.length===1?presetNames[0]:null;
      base.preset={kind:'NATIVE_TRADOVATE_ORDER_PRESET_OBSERVATION_V1',symbol,orderType,direction,quantity:integer(quantity)&&quantity>0?quantity:null,quantityRaw:text(raw,80)?raw:null,stop,target,
        favoriteCount:favorites.length,favoriteDataQa:favorite?.getAttribute('data-qa-id')??null,name,nameEvidence:name?nameCandidates.filter(n=>n.name===name):[],nameObserved:!!name,
        freshApplicationVerified:false,inheritanceVerified:false,protectionVerified:false,inputValuesSetByDriver:false,readOnly:true};
      check('NATIVE_UNITS_QUANTITY_REQUIRED',!!qty&&!disabled(qty)&&qty.readOnly!==true&&integer(quantity)&&quantity>0&&quantity<=1000000&&label(qtyType)==='Units',!!qty);
      check('NATIVE_MARKET_TYPE_REQUIRED',orderType==='MARKET',selected.length===1);
      check('NATIVE_ORDER_SIDE_REQUIRED',!!direction&&!disabled(buy)&&!disabled(sell),!!buy&&!!sell);
      check('NATIVE_STOP_AND_TARGET_FIELDS_REQUIRED',goodExit(stop)&&goodExit(target),!!one('input[data-qa-id~="order-ticket-stop-loss-input"]',ticket)&&!!one('input[data-qa-id~="order-ticket-take-profit-input"]',ticket));
      check('SOLE_NATIVE_FAVORITE_REQUIRED',favorites.length===1&&!disabled(favorite),favorites.length>0);
      check('NATIVE_PRESET_NAME_OBSERVATION_REQUIRED',!!name,presetNames.length>0);
    }

    function tableObservation(kind){
      const dataName=`TRADOVATE.${kind}-table`,tables=all(`table[role="grid"][data-name="${dataName}"]`,manager,5);
      if(tables.length!==1)return {dataName,visible:false,ambiguous:tables.length>1,schemaObserved:false,rowCount:null,explicitEmptyObserved:false,completeInventoryVerified:false};
      const table=tables[0],headers=all('thead th',table,40).map(n=>({id:n.getAttribute('id'),label:label(n)})),rows=all('tbody tr',table,1000),
        expected=kind==='positions'?['symbol','side','qty','avgPrice','unrealizedPl','updateTime','id']:['symbol','side','type','qty','remainingQty','filledQty','limitPrice','stopPrice','takeProfit','stopLoss','avgPrice','status','updateTime','id'],
        headerIds=headers.map(h=>h.id),schemaObserved=expected.every(id=>headerIds.filter(x=>x===id).length===1),
        empty=all('[data-qa-id~="account-manager-tab-empty-state"]',table,10).some(n=>label(n)==='Nothing to show yet. Your account activity will appear here.'),
        loaders=all('[role="progressbar"],[data-qa-id="account-manager-table-loader"]',manager,20).length,
        filters=all('input[type="search"],[role="searchbox"],[aria-label*="filter" i][aria-pressed="true"],[data-qa-id*="filter"][aria-pressed="true"]',manager,50).filter(n=>norm(n.value??'')||n.getAttribute('aria-pressed')==='true').length,
        pagination=all('[aria-label*="page" i],[data-qa-id*="pagination"]',manager,50).length,
        virtualized=table.getAttribute('aria-rowcount')!==null||all('[data-virtualized],[class*="virtual"]',table,30).length>0;
      return {dataName,visible:true,ambiguous:false,headers,schemaObserved,rowCount:rows.length,explicitEmptyObserved:empty,loading:loaders>0,activeFilterObserved:filters>0,paginationObserved:pagination>0,virtualizationObserved:virtualized,
        // Native empty text and a visible row set do not certify that the
        // broker inventory is complete, unfiltered, or atomically sampled.
        completeInventoryVerified:false,emptyStateScope:'VISIBLE_SELECTED_TAB_ONLY_NOT_BROKER_COMPLETE_SNAPSHOT'};
    }
    base.inventory={positions:tableObservation('positions'),orders:tableObservation('orders'),positionsComplete:false,workingOrdersComplete:false,flatVerified:false,accountScope:'EXACT_VISIBLE_NATIVE_ACCOUNT_NOT_COMPLETE_BROKER_INVENTORY'};
    check('VISIBLE_TRADOVATE_POSITIONS_SCHEMA_REQUIRED',base.inventory.positions.schemaObserved,base.inventory.positions.visible);
    check('VISIBLE_TRADOVATE_ORDERS_SCHEMA_REQUIRED',base.inventory.orders.schemaObserved,base.inventory.orders.visible);
    const nativeReady=base.checks.filter(c=>!c.id.startsWith('VISIBLE_TRADOVATE_')).every(c=>c.passed);
    return done(nativeReady?'PREPARATION_ONLY':'INCOMPLETE');
  }catch(error){return blocked(error?.message==='PA_READINESS_DOM_LIMIT'?error.message:'PA_PUBLIC_READINESS_OBSERVATION_FAILED');}
}
