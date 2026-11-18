// Read-only public account labels in an explicitly chosen TradingView chart.
// No click, account switch, order, credential, balance or private API access.
export function readTradingViewExecutionAccount(command={}){
  const base={kind:'TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1',observedAt:Date.now(),ordersCreated:false,submitted:false,readOnly:true,synthetic:false,testOnly:false};
  const blocked=code=>({...base,status:'UNAVAILABLE',reasonCodes:[code]});
  const norm=value=>String(value??'').replace(/\s+/g,' ').trim();
  const visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(rect=>rect.width>0&&rect.height>0))return false;
    for(let item=node;item;item=item.parentElement){const css=getComputedStyle(item);if(css.display==='none'||['hidden','collapse'].includes(css.visibility))return false;}
    return true;
  };
  const all=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible);
  let expected;
  try{expected=new URL(command.url);if(expected.protocol!=='https:'||!['www.tradingview.com','tradingview.com'].includes(expected.hostname)||!/^\/chart\/[A-Za-z0-9_-]+\/$/.test(expected.pathname)||expected.search||expected.hash||expected.username||expected.password)throw Error();}
  catch{return blocked('EXACT_TRADINGVIEW_CHART_REQUIRED');}
  if(!Number.isSafeInteger(command.tabId)||command.tabId<1||location.href!==expected.href)return blocked('ACCOUNT_SOURCE_TAB_CHANGED');
  if(document.visibilityState!=='visible'||document.hidden===true)return blocked('ACCOUNT_SOURCE_NOT_VISIBLE');
  if(all('[role="dialog"]').length)return blocked('ACCOUNT_MODAL_OPEN');
  const source={tabId:command.tabId,url:expected.href};
  const replay=all('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]');
  const broker=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]');
  const manager=all('[aria-label="Account manager"]');
  // TradingView renders the same connected-provider label in the footer and
  // trading panel. Accept duplicate consistent labels, never choose between
  // different providers or multiple account managers by DOM order.
  const providerLabels=[...new Set(broker.map(node=>norm(node.textContent)))];
  if(replay.length>1||broker.length>3||providerLabels.length>1||manager.length>1||replay.length&&manager.length)return blocked('ACCOUNT_PROVIDER_AMBIGUOUS');
  if(replay.length===1){
    const toggle=all('#header-toolbar-replay');
    if(norm(replay[0].textContent)!=='Replay Trading'||toggle.length!==1||toggle[0].getAttribute('aria-pressed')!=='true')return blocked('REPLAY_ACCOUNT_NOT_ACTIVE');
    return {...base,status:'OBSERVED',provider:'REPLAY_TRADING',providerLabel:'Replay Trading',
      nativeAccountId:'replay:'+command.tabId,environment:'REPLAY',environmentVerified:true,
      nativeIdentityVerified:true,identityScope:'REPLAY_SIMULATOR_IN_EXPLICIT_TAB',source,
      verificationScope:'PUBLIC_UI_IDENTITY_ONLY_NOT_EXECUTION_AUTHORIZATION',reasonCodes:[]};
  }
  if(!broker.length||providerLabels.length!==1||manager.length!==1)return blocked('VISIBLE_ACCOUNT_MANAGER_REQUIRED');
  const selector=all('[data-qa-id="account-selector"]',manager[0]);
  const names=selector.length===1?all('[class*="accountName-"]',selector[0]):[];
  if(names.length!==1)return blocked('EXACT_NATIVE_ACCOUNT_LABEL_REQUIRED');
  const nativeAccountId=norm(names[0].textContent),providerLabel=providerLabels[0];
  if(!nativeAccountId||nativeAccountId.length>240||/[\u0000-\u001f\u007f]/.test(nativeAccountId)||!providerLabel||providerLabel.length>120)return blocked('INVALID_NATIVE_ACCOUNT_LABEL');
  const provider=providerLabel==='Paper Trading'?'TRADINGVIEW_PAPER':providerLabel==='Tradovate'?'TRADOVATE':null;
  return {...base,status:'OBSERVED',provider,providerLabel,nativeAccountId,
    environment:provider==='TRADINGVIEW_PAPER'?'DEMO':null,environmentVerified:provider==='TRADINGVIEW_PAPER',
    nativeIdentityVerified:true,identityScope:'VISIBLE_TRADINGVIEW_ACCOUNT_LABEL_NOT_BROKER_API_ID',source,
    verificationScope:'PUBLIC_UI_IDENTITY_ONLY_NOT_EXECUTION_AUTHORIZATION',reasonCodes:provider?[]:['PROVIDER_ADAPTER_MAPPING_REQUIRED']};
}

export function createTradingViewAccountInspectionAdapter({readAccount,now=Date.now}={}){
  if(typeof readAccount!=='function'||typeof now!=='function')throw TypeError('ACCOUNT_INSPECTION_TRANSPORT_REQUIRED');
  return Object.freeze({
    id:'tradingview-account-ui',provider:'MULTI_PROVIDER',supportedProviders:['REPLAY_TRADING','TRADINGVIEW_PAPER','TRADOVATE'],label:'TradingView · קריאת זהות בלבד',
    supportedEnvironments:['REPLAY','DEMO','EVALUATION','PA','LIVE'],
    capabilities:{inspectAccount:true,preflight:false,submitMarket:false,reconcile:false},
    async inspectAccount({selection,source}){
      const account=selection?.profile;
      if(!account||!Number.isSafeInteger(source?.tabId)||typeof source?.url!=='string')return {status:'NOT_CONNECTED',reasonCodes:['EXPLICIT_ACCOUNT_SOURCE_REQUIRED']};
      const observation=await readAccount({tabId:source.tabId,url:source.url});
      if(observation?.status!=='OBSERVED')return {status:'NOT_CONNECTED',observation,reasonCodes:observation?.reasonCodes??['NATIVE_ACCOUNT_NOT_OBSERVED']};
      if(observation.kind!=='TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1'||observation.nativeIdentityVerified!==true||observation.synthetic!==false||observation.testOnly!==false||observation.readOnly!==true||observation.ordersCreated!==false||observation.submitted!==false||observation.source?.tabId!==source.tabId||observation.source?.url!==source.url||typeof observation.environmentVerified!=='boolean')return {status:'NOT_CONNECTED',reasonCodes:['NATIVE_ACCOUNT_OBSERVATION_UNVERIFIED']};
      if(observation.provider!==account.provider||observation.nativeAccountId!==account.nativeAccountId)return {status:'ACCOUNT_MISMATCH',observation,reasonCodes:['SELECTED_AND_VISIBLE_ACCOUNT_DIFFER']};
      if(observation.environmentVerified&&observation.environment!==account.environment)return {status:'ACCOUNT_MISMATCH',observation,reasonCodes:['SELECTED_AND_VISIBLE_ENVIRONMENT_DIFFER']};
      const at=now();
      if(!Number.isSafeInteger(observation.observedAt)||observation.observedAt>at||at-observation.observedAt>2000)return {status:'NOT_CONNECTED',reasonCodes:['ACCOUNT_OBSERVATION_STALE']};
      return {status:'NATIVE_ACCOUNT_OBSERVED',observation,evidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',
        provider:observation.provider,nativeAccountId:observation.nativeAccountId,environment:observation.environment??account.environment,
        environmentVerified:observation.environmentVerified===true,accountRevision:account.revision,selectionKey:selection.selectionKey,
        observedAt:observation.observedAt,origin:'PUBLIC_NATIVE_UI',nativeIdentityVerified:true,connected:true,synthetic:false,testOnly:false}};
    }
  });
}
