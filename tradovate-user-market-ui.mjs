// Serialized native chart Market boundary. The user's existing chart presets
// and quantity are read, never edited. No stop, target or risk calculation.
// Provider checks remain separate from the legacy Paper-only writer.
export async function nativeUserMarketUiCommand(command={}){
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim(),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x),integer=Number.isSafeInteger,finite=Number.isFinite,
    bounded=(x,n=512)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\u0000-\u001f\u007f]/.test(x),
    num=x=>{const s=norm(x).replace(/\u2212/g,'-').replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;},tick=x=>finite(x)&&x>0&&integer(x/.25),
    now=()=>Date.now(),perf=()=>performance.now(),copy=x=>structuredClone(x),canonical=x=>JSON.stringify(x,(_k,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b),
    expected=command.expected??{},provider=expected.provider,environment=expected.environment,paper=provider==='TRADINGVIEW_PAPER',slot=Symbol.for('arrow.native-user-market-ui.v1'),
    state=globalThis[slot]??(globalThis[slot]={generation:0,busy:false,lease:null,own:null,consumed:[],guards:false});
  const fail=(code,details={})=>{throw Object.assign(new Error(code),{nativeUserCode:code,...details});};
  const visible=node=>{if(!node?.isConnected||![...node.getClientRects()].some(r=>r.width>0&&r.height>0))return false;for(let n=node,depth=0;n&&depth<64;n=n.parentElement,depth++){const s=getComputedStyle(n);if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.contentVisibility==='hidden')return false;}return true;};
  const all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible),one=(s,r=document)=>{const a=all(s,r);return a.length===1?a[0]:null;},label=n=>norm(n?.textContent),disabled=n=>!n||n.disabled===true||n.getAttribute('aria-disabled')==='true';
  const result=(status,extra={})=>({kind:'NATIVE_USER_MARKET_RESULT_V1',nativeBoundaryRevision:'native-chart-market-6',status,provider,environment,environmentVerified:paper,nativeIdentityVerified:false,
    environmentBasis:paper?'NATIVE_PAPER_PROVIDER_DEMO':'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED',submitted:false,ordersCreated:false,fillVerified:false,protectionVerified:false,
    userManaged:true,riskManagement:'USER_MANAGED_NOT_CALCULATED',postFillManagement:false,realBrokerOrdersAuthorized:false,...extra});
  let ownsBusy=false,gestureStarted=false;
  const activeOrderStatuses=new Set(['working','inactive','pending','partially_filled']),terminalOrderStatuses=new Set(['filled','cancelled','canceled','rejected','expired']);
  const orderStatus=row=>norm(row.status).toLowerCase().replace(/\s+/g,'_');
  function activeOrders(rows){if(rows.some(row=>!activeOrderStatuses.has(orderStatus(row))&&!terminalOrderStatuses.has(orderStatus(row))))fail('NATIVE_USER_ORDER_STATUS_UNVERIFIED');return rows.filter(row=>activeOrderStatuses.has(orderStatus(row)));}
  function identity(){
    if(!['TRADOVATE','TRADINGVIEW_PAPER'].includes(provider)||(paper?environment!=='DEMO':!['PA','LIVE','DEMO','EVALUATION'].includes(environment)))fail('NATIVE_USER_PROVIDER_ENVIRONMENT_REQUIRED');
    if(document.visibilityState!=='visible'||document.hidden===true)fail('NATIVE_USER_VISIBLE_SOURCE_REQUIRED');
    if(all('[role="dialog"],[aria-modal="true"]').length)fail('NATIVE_USER_MODAL_OPEN');
    const names={'https://www.tradingview.com/chart/ARROWRV1/':'Arrow OHLC Live Verification','https://www.tradingview.com/chart/ARROWFR1/':'Full Screens Live'},layoutName=names[expected.researchUrl];
    if(!layoutName||location.href!==expected.researchUrl||!integer(expected.sourceTabId)||expected.sourceTabId<1)fail('NATIVE_USER_EXACT_SOURCE_REQUIRED');
    if(!bounded(expected.nativeAccountId,240)||!integer(expected.accountRevision)||expected.accountRevision<1||!bounded(expected.selectionKey,16384))fail('NATIVE_USER_SELECTED_ACCOUNT_REQUIRED');
    const layouts=all('[aria-label^="Logged in as"]'),charts=all('canvas[aria-label^="Chart for "]'),interval=one('#header-toolbar-intervals [aria-checked="true"]'),replay=one('#header-toolbar-replay');
    if(layouts.length!==1||!norm(layouts[0].getAttribute('aria-label')).endsWith('Active layout: '+layoutName)||interval?.getAttribute('data-value')!=='1'||charts.length<1||charts.length>3||charts.some(n=>!/^Chart for CME_MINI:NQ1!, [^,]+$/.test(n.getAttribute('aria-label')??''))||charts.filter(n=>n.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length!==1)fail('NATIVE_USER_EXACT_NQ_MINUTE_SCOPE_REQUIRED');
    if((replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked'))!=='false'||all('[data-qa-id="replay_trading"]').length)fail('NATIVE_USER_REPLAY_EXCLUDED');
    const providers=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]'),providerName=paper?'Paper Trading':'Tradovate';
    if(!providers.length||providers.length>3||providers.some(n=>label(n)!==providerName))fail('NATIVE_USER_EXACT_PROVIDER_REQUIRED');
    const account=one('[aria-label="Account manager"]'),selector=account&&one('[data-qa-id="account-selector"]',account),name=selector&&one('[class*="accountName-"]',selector);
    if(!account||!name||label(name)!==expected.nativeAccountId)fail('NATIVE_USER_NATIVE_ACCOUNT_CHANGED');
    const panel=one('[aria-label="Trading panel"]'),titles=panel?all('[title]',panel).map(n=>n.getAttribute('title')):[],maps=titles.map(t=>/^Continuous futures is used for charting, but the (NQ[HMUZ]20\d\d) contract will be used for order placement\.$/.exec(t??'')).filter(Boolean);
    if(!panel||maps.length!==1)fail('NATIVE_USER_EXACT_DATED_CONTRACT_MAPPING_REQUIRED');
    const symbol=maps[0][1],short=symbol.slice(0,3)+symbol.slice(-1);
    if(!titles.includes(symbol)&&(!paper&&titles.filter(t=>t===short).length===1)===false||expected.symbol!==undefined&&expected.symbol!==symbol)fail('NATIVE_USER_NATIVE_DATED_SYMBOL_CHANGED');
    const active=all('[data-qa-id="chart-container"]').filter(n=>(n.getAttribute('class')??'').split(/\s+/).includes('active'));
    if(active.length!==1||all('canvas[aria-label^="Chart for "]',active[0]).length!==1||all('canvas[aria-label^="Chart for "]',active[0])[0].getAttribute('aria-label')!=='Chart for CME_MINI:NQ1!, 1 minute')fail('NATIVE_USER_ACTIVE_MINUTE_CHART_REQUIRED');
    return {account,panel,chart:active[0],symbol,displaySymbol:paper?symbol:short,nativeAccountId:label(name),researchUrl:expected.researchUrl,layoutName};
  }
  function native({requireQuote=true}={}){
    const bound=identity(),groups=all('[class*="sellBuyButtonsContainer-"]',bound.chart);
    if(groups.length!==1)fail('NATIVE_USER_UNIQUE_QUICK_MARKET_GROUP_REQUIRED');
    const root=groups[0],buy=one('[data-name="buy-order-button"]',root),sell=one('[data-name="sell-order-button"]',root),quantityNode=one('[data-name="qtyEl"]',root),quantityRaw=label(quantityNode),quantity=num(quantityRaw),
      readButton=node=>({price:num(label(one('span[class*="buttonText-"]',node))),name:label(one('span[class*="title-"]',node))}),long=buy&&readButton(buy),short=sell&&readButton(sell);
    const quantityIdentity=quantityNode&&(quantityNode.getAttribute('title')==='Quantity'||/(?:^|\s)qty-[^\s]+(?:\s|$)/.test(quantityNode.getAttribute('class')??'')&&/(?:^|\s)spreadQtyWrapper-[^\s]+(?:\s|$)/.test(quantityNode.parentElement?.getAttribute('class')??'')&&all('span',quantityNode).length===1&&label(one('span',quantityNode))===quantityRaw);
    if(disabled(buy)||disabled(sell)||!quantityIdentity||!integer(quantity)||quantity<1||quantity>1000000||!bounded(quantityRaw,40)||!bounded(long?.name,160)||!bounded(short?.name,160)||requireQuote&&(!tick(long.price)||!tick(short.price)||short.price>long.price))fail('NATIVE_USER_QUICK_MARKET_CONTROLS_UNVERIFIED');
    const preset={kind:'NATIVE_CHART_USER_MANAGED_MARKET_PRESET_V1',executionSurface:'USER_MANAGED_CHART_MARKET',symbol:bound.symbol,quantity,quantityRaw,
      sideNames:{LONG:long.name,SHORT:short.name},quantitySource:'ACTIVE_MINUTE_CHART_QUICK_QUANTITY',stopTargetRead:false,inheritanceVerified:false,inputValuesSetByDriver:false};
    preset.fingerprint=canonical([preset.kind,preset.symbol,preset.quantity,preset.quantityRaw,preset.sideNames]);
    if(expected.nativePresetFingerprint!==undefined&&expected.nativePresetFingerprint!==preset.fingerprint)fail('NATIVE_USER_ARMED_PRESET_CHANGED');
    return {bound,buy,sell,quantity,quantityRaw,quotes:{LONG:long.price,SHORT:short.price},preset};
  }
  async function settle(check){const start=perf();while(perf()-start<1200){if(check()){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(check())return;}await new Promise(r=>setTimeout(r,20));}fail('NATIVE_USER_NATIVE_READ_DID_NOT_SETTLE');}
  function guardInstall(){if(state.guards)return;state.guards=true;const invalidate=e=>{if(e?.isTrusted===true){state.generation++;state.lastLeaseRevocation='TRUSTED_NATIVE_DOCUMENT_INPUT';state.lease=null;if(state.own){state.own.trustedInputCount=(state.own.trustedInputCount??0)+1;state.own.firstTrustedInputAt??=now();state.own.lastTrustedInputAt=now();}}};for(const type of ['pointerdown','keydown','touchstart'])document.addEventListener(type,invalidate,true);}
  async function table(kind,generation){
    let bound=identity();const tab=one(`[role="tab"][id="${kind}"]`,bound.account);if(disabled(tab))fail('NATIVE_USER_ACCOUNT_TAB_REQUIRED');
    const check=()=>{if(state.generation!==generation)fail('NATIVE_USER_CONTEXT_INTERRUPTED');const b=identity();return one(`[role="tab"][id="${kind}"]`,b.account)?.getAttribute('aria-selected')==='true'&&!all('[role="progressbar"]',b.account).length;};
    if(tab.getAttribute('aria-selected')!=='true')tab.click();await settle(check);bound=identity();
    if(all('[role="combobox"],input',bound.account).length||all('[aria-pressed="true"][aria-label*="filter" i]',bound.account).length)fail('NATIVE_USER_FILTERED_ACCOUNT_TABLE_EXCLUDED');
    if(paper&&['orders','history'].includes(kind)){
      const filters=all('[role="tab"],[role="combobox"],input',bound.account).filter(n=>(n.getAttribute('id')??'').startsWith('orderstatus')),allowed=['orderstatustatus-all',...(kind==='orders'?['orderstatus-working','orderstatus-inactive']:[]),'orderstatus-filled','orderstatus-cancelled','orderstatus-rejected'],selected=filters.filter(n=>n.getAttribute('id')==='orderstatustatus-all'),shown=selected.length===1?label(selected[0]):'',allLabel=/^All(?: (\d+))?(?:\s*All(?: (\d+))?)?$/.exec(shown);
      if(filters.length!==allowed.length||filters.some(n=>!allowed.includes(n.getAttribute('id')))||new Set(filters.map(n=>n.getAttribute('id'))).size!==allowed.length||selected.length!==1||selected[0].getAttribute('aria-selected')!=='true'||filters.some(n=>n!==selected[0]&&n.getAttribute('aria-selected')!=='false')||!allLabel||allLabel[1]&&allLabel[2]&&allLabel[1]!==allLabel[2])fail('NATIVE_USER_NATIVE_HISTORY_ALL_REQUIRED');
    }
    const grid=one(`table[data-name="${paper?'Paper':'TRADOVATE'}.${kind}-table"]`,bound.account),body=grid?.querySelector('tbody');if(!grid||!body||grid.getAttribute('role')!=='grid')fail('NATIVE_USER_VISIBLE_PUBLIC_TABLE_REQUIRED');
    const headers=[...grid.querySelectorAll('thead th')].map(n=>({id:n.getAttribute('id')??n.id,text:label(n)})),required=paper?{symbol:'Symbol',side:'Side',qty:'Quantity',...(kind==='positions'?{avgPrice:'Avg fill price'}:{type:'Type',status:'Status',id:'Order ID'})}:{symbol:'Symbol',side:'Side',qty:'Qty',avgPrice:'Avg Fill Price',...(kind==='positions'?{id:'Position ID'}:{type:'Type',status:'Status',id:'Order ID'})};
    if(headers.length<4||headers.length>40||new Set(headers.map(h=>h.id)).size!==headers.length||Object.entries(required).some(([id,text])=>headers.filter(h=>h.id===id&&h.text===text).length!==1))fail('NATIVE_USER_TYPED_HEADERS_CHANGED');
    const rows=[...body.querySelectorAll('tr')],empty=all('[data-qa-id="account-manager-tab-empty-state"]',body);if(rows.length>1000)fail('NATIVE_USER_TABLE_SCOPE_LIMIT');
    const explicitEmpty=rows.length===1&&[...rows[0].querySelectorAll('td')].length===1&&Number(rows[0].querySelectorAll('td')[0].getAttribute('colspan'))===headers.length&&norm(body.textContent)==='Nothing to show yet. Your account activity will appear here.'&&empty.length===1&&!rows[0].getAttribute('data-row-id');
    if(explicitEmpty)return {kind,rows:[],explicitEmpty:true,observedAt:now()};
    if(!rows.length||empty.length)fail('NATIVE_USER_EMPTY_STATE_OR_ROWS_UNVERIFIED');
    const parsed=rows.map(row=>{const cells=[...row.querySelectorAll('td')];if(cells.length!==headers.length)fail('NATIVE_USER_PARTIAL_NATIVE_ROW');const value=Object.fromEntries(headers.map((h,i)=>[h.id,label(cells[i])]));if(!bounded(value.symbol,240)||!['Buy','Sell','Long','Short'].includes(value.side)||!integer(num(value.qty))||num(value.qty)<1)fail('NATIVE_USER_NATIVE_ROW_IDENTITY_UNVERIFIED');if(kind!=='positions'&&(!/^\d{1,20}$/.test(value.id)||row.getAttribute('data-row-id')!==value.id))fail('NATIVE_USER_NATIVE_ORDER_ID_UNVERIFIED');return value;});
    if(kind!=='positions'&&new Set(parsed.map(r=>r.id)).size!==parsed.length)fail('NATIVE_USER_DUPLICATE_ORDER_ID');
    return {kind,rows:parsed,explicitEmpty:false,observedAt:now()};
  }
  function providerEmptyAccount(bound){
    // TradingView's first-trade state hides all account tabs. Its visible,
    // account-scoped empty-state assertion is distinct from a missing table.
    // Never turn hidden/unloaded table contents into positive inventory proof.
    const roots=all(':scope > .js-empty-account',bound.account);
    if(!roots.length)return null;
    if(roots.length!==1||state.own)fail('NATIVE_USER_EMPTY_ACCOUNT_STATE_UNVERIFIED');
    const root=roots[0],empty=one('[data-qa-id="account-manager-empty-state"]',root),title=empty&&one('[data-qa-id="ui-lib-empty-title account-manager-empty-state"]',empty),text=empty&&one('[data-qa-id="ui-lib-empty-text account-manager-empty-state"]',empty),
      buy=empty&&one('[data-qa-id="account-manager-empty-state-buy-button"]',empty),sell=empty&&one('[data-qa-id="account-manager-empty-state-sell-button"]',empty);
    if(!empty||label(title)!=='Make a trade to get started'||label(text)!=='Red or blue — choose your pill.'||disabled(buy)||disabled(sell)||label(buy)!=='Buy'||label(sell)!=='Sell'
      ||all('[role="progressbar"],[role="alert"]',bound.account).length||all('[role="tab"],table[role="grid"]',bound.account).length)fail('NATIVE_USER_EMPTY_ACCOUNT_STATE_UNVERIFIED');
    // Mounted hidden rows can contradict the visible provider assertion; they
    // cannot establish it. Hidden loading placeholders do not assert anything.
    const tables=[...bound.account.querySelectorAll('table[role="grid"]')];
    if(tables.length>12)fail('NATIVE_USER_EMPTY_ACCOUNT_STATE_UNVERIFIED');
    for(const grid of tables){
      const rows=[...grid.querySelectorAll('tbody tr')];
      if(rows.length>1000||rows.some(row=>row.getAttribute('data-row-id')||row.querySelectorAll('td').length>1))fail('NATIVE_USER_EMPTY_ACCOUNT_STATE_CONTRADICTED');
    }
    return {root,empty};
  }
  async function accountState({withHistory=false}={}){
    const generation=state.generation,bound=identity(),prior=all('[role="tab"][aria-selected="true"]',bound.account).map(n=>n.getAttribute('id'));
    const initialEmpty=providerEmptyAccount(bound);
    if(initialEmpty){
      await settle(()=>{if(state.generation!==generation)fail('NATIVE_USER_CONTEXT_INTERRUPTED');const current=identity(),proof=providerEmptyAccount(current);return current.account===bound.account&&proof?.root===initialEmpty.root&&proof?.empty===initialEmpty.empty;});
      const value=native(),finalEmpty=providerEmptyAccount(value.bound);if(!finalEmpty||value.bound.account!==bound.account||finalEmpty.root!==initialEmpty.root)fail('NATIVE_USER_EMPTY_ACCOUNT_STATE_UNVERIFIED');
      const empty=kind=>({kind,rows:[],explicitEmpty:true,emptyBasis:'VISIBLE_PROVIDER_ACCOUNT_EMPTY_STATE',observedAt:now()});
      return {value,positions:empty('positions'),orders:empty('orders'),activeOrders:[],history:withHistory&&paper?empty('history'):null,flat:true,positionsComplete:true,workingOrdersComplete:true,
        proofKind:'SELECTED_NATIVE_ACCOUNT_VISIBLE_PROVIDER_EMPTY_STATE',scope:'PUBLIC_SELECTED_NATIVE_ACCOUNT_PROVIDER_EMPTY_ASSERTION_NOT_TABLE_OR_ATOMIC_BROKER_SNAPSHOT',observedAt:now()};
    }
    const positions=await table('positions',generation),orders=await table('orders',generation),history=withHistory&&paper?await table('history',generation):null;
    if(prior.length===1){const tab=one(`[role="tab"][id="${prior[0]}"]`,identity().account);if(tab&&tab.getAttribute('aria-selected')!=='true'){tab.click();await settle(()=>state.generation===generation&&one(`[role="tab"][id="${prior[0]}"]`,identity().account)?.getAttribute('aria-selected')==='true');}}
    const value=native(),working=activeOrders(orders.rows);return {value,positions,orders,activeOrders:working,history,flat:positions.explicitEmpty&&working.length===0,positionsComplete:true,workingOrdersComplete:true,
      proofKind:'SELECTED_NATIVE_ACCOUNT_TWO_VISIBLE_UNFILTERED_EMPTY_TABLES',scope:'PUBLIC_SELECTED_NATIVE_ACCOUNT_UI_NOT_ATOMIC_BROKER_SNAPSHOT',observedAt:now()};
  }
  function passiveInventorySignature(){
    // Mounted hidden views are only a trigger for a fresh explicit UI scan.
    // This structural signature never certifies inventory, a fill or closure.
    const account=identity().account,views=[];
    for(const kind of ['positions','orders',...(paper?['history']:[])]){
      const grids=[...account.querySelectorAll(`table[role="grid"][data-name="${paper?'Paper':'TRADOVATE'}.${kind}-table"]`)];
      // TradingView virtualizes inactive tabs. Their absence is part of the
      // change trigger, never evidence that the corresponding inventory is
      // empty. A change in any mounted view can request an explicit scan.
      if(grids.length===0){views.push({kind,mounted:false});continue;}
      if(grids.length!==1||!grids[0].isConnected)return null;
      const grid=grids[0],body=grid.querySelector('tbody'),headers=[...grid.querySelectorAll('thead th')].map(n=>n.getAttribute('id')??n.id);
      if(!body||headers.length<4||headers.length>40||new Set(headers).size!==headers.length||grid.querySelectorAll('[role="progressbar"]').length)return null;
      const rows=[...body.querySelectorAll('tr')];if(!rows.length||rows.length>1000)return null;
      const values=[];
      for(const row of rows){const cells=[...row.querySelectorAll('td')];
        if(cells.length===1&&Number(cells[0].getAttribute('colspan'))===headers.length&&norm(body.textContent)==='Nothing to show yet. Your account activity will appear here.'){values.push({empty:true});continue;}
        if(cells.length!==headers.length)return null;
        const fields={};for(const key of ['symbol','side','type','qty','remainingQty','filledQty','avgPrice','status','id']){const i=headers.indexOf(key);if(i>=0)fields[key]=label(cells[i]);}
        values.push(fields);
      }
      views.push({kind,headers,rows:values});
    }
    return views.some(view=>view.mounted!==false)?canonical(views):null;
  }
  function nativeFill(row){
    // Closing time belongs to the typed FILLED order row. Never substitute
    // placing time, source approval time or our observation time for a fill.
    const clocks=all('button[data-name="time-zone-menu"]'),offsets=clocks.map(n=>/^\d{2}:\d{2}:\d{2}\s+UTC(?:([+−-])(\d{1,2})(?::(\d{2}))?)?$/.exec(label(n)));
    if(!clocks.length||offsets.some(m=>!m||Number(m[2]??0)>14||Number(m[3]??0)>59))return null;
    const values=offsets.map(m=>(m[1]==='-'||m[1]==='−'?-1:1)*(Number(m[2]??0)*60+Number(m[3]??0)));
    if(new Set(values).size!==1||values.some(v=>Math.abs(v)>840))return null;
    const m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(row?.closeDate??''),price=num(row?.avgPrice);
    if(!m||!/^\d{1,20}$/.test(row.id??'')||row.type!=='Market'||row.status?.toLowerCase()!=='filled'||!['Buy','Sell'].includes(row.side)||!tick(price))return null;
    const [y,mo,d,h,mi,s]=m.slice(1).map(Number),wall=Date.UTC(y,mo-1,d,h,mi,s),date=new Date(wall);
    if(y<2020||mo<1||mo>12||d<1||h>23||mi>59||s>59||date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d)return null;
    return {kind:'NATIVE_EXECUTED_FILL_V1',origin:'PUBLIC_NATIVE_UI',provider,environment,nativeAccountId:expected.nativeAccountId,nativeOrderId:row.id,direction:row.side==='Buy'?'LONG':'SHORT',price,filledAt:wall-values[0]*60000,timeText:row.closeDate,timestampField:'closeDate',timestampPrecisionMs:1000,utcOffsetMinutes:values[0],timezoneBasis:'VISIBLE_CHART_TIMEZONE_MENU',orderRow:copy(row),synthetic:false,testOnly:false};
  }
  function connection(snapshot,live){return {status:'NATIVE_USER_CONNECTION_VERIFIED',provider,environment,environmentVerified:paper,environmentBasis:paper?'NATIVE_PAPER_PROVIDER_DEMO':'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED',nativeIdentityVerified:true,
    nativeAccountId:snapshot.value.bound.nativeAccountId,symbol:snapshot.value.bound.symbol,quantity:snapshot.value.quantity,quantityRaw:snapshot.value.quantityRaw,observedAt:now(),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf(),
    flat:snapshot.flat,positionsComplete:snapshot.positionsComplete,workingOrdersComplete:snapshot.workingOrdersComplete,positions:snapshot.positions.rows,workingOrders:snapshot.activeOrders,inventoryProofKind:snapshot.proofKind,inventoryScope:snapshot.scope,
    sourceVerified:!!live,latestClosedAt:live?.latestClosedAt??null,liveSource:live,nativeFillRecords:(snapshot.history?.rows??snapshot.orders.rows).map(nativeFill).filter(Boolean).slice(-100),executionSurface:'USER_MANAGED_CHART_MARKET',nativePreset:copy(snapshot.value.preset),protectionVerified:false,userManaged:true,postFillManagement:false,realBrokerOrdersAuthorized:false};}
  async function restoreFilledOwnership(r){
    // An extension restart loses its private DOM observer. A durable, already
    // attributed fill plus the SAME typed native order ID can restore only
    // read-only ownership. Never reconstruct a submission lease or replay it.
    const b=r?.intentBinding?.binding,s=r?.intentBinding?.signal,p=r?.history?.at(-1)?.proof,a=p?.accountEvidence;
    const key=b&&s?['execution-attempt-1',provider,environment,expected.nativeAccountId,b.symbol,s.eventId].map(encodeURIComponent).join(':'):null;
    if(r?.status!=='FILLED'||r.key!==key||state.consumed.includes(r.key)||state.lease||r.history?.at(-1)?.status!=='FILLED'||r.history?.[0]?.phase!=='RESERVED_BEFORE_DISPATCH'
      ||!same(b?.accountIdentity,{provider,environment,nativeAccountId:expected.nativeAccountId})||b.accountRevision!==expected.accountRevision||b.selectionKey!==expected.selectionKey||b.adapterId!==(paper?'tradingview-paper-market-ui':'tradovate-market-ui')
      ||b.sourceIdentity!==JSON.stringify([expected.researchUrl,expected.sourceTabId,'CME_MINI:NQ1!','1'])||s?.sourceIdentity!==b.sourceIdentity||s.sourceRunId!==b.sourceRunId||s.symbol!==b.symbol||s.status!=='CONFIRMED'||s.synthetic!==false||s.testOnly!==false||!['LONG','SHORT'].includes(s.direction)
      ||!integer(b.quantity)||b.quantity<1||r.intentBinding.quantity!==b.quantity||r.eventIdentity?.eventId!==s.eventId||r.eventIdentity.direction!==s.direction||r.eventIdentity.symbol!==b.symbol||r.eventIdentity.confirmedAt!==s.confirmedAt
      ||p?.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||p.intentKey!==r.key||p.status!=='FILLED'||p.attributionVerified!==true||p.fillVerified!==true||p.closedVerified!==false||!same(p.binding,r.intentBinding)||p.quantity!==b.quantity||p.direction!==s.direction||!/^\d{1,20}$/.test(p.nativeOrderId??'')||p.synthetic!==false||p.testOnly!==false
      ||a?.kind!=='NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1'||a.provider!==provider||a.environment!==environment||a.nativeAccountId!==expected.nativeAccountId||a.nativeIdentityVerified!==true||a.origin!=='PUBLIC_NATIVE_UI'||a.connected!==true||a.synthetic!==false||a.testOnly!==false||paper&&(a.environmentVerified!==true||a.environmentBasis!=='NATIVE_PAPER_PROVIDER_DEMO'))fail('NATIVE_USER_DURABLE_ATTRIBUTED_FILL_REQUIRED');
    const snapshot=await accountState({withHistory:paper}),symbols=new Set([b.symbol,'CME_MINI:'+b.symbol,...(!paper?[snapshot.value.bound.displaySymbol]:[])]),side=s.direction==='LONG'?'Buy':'Sell';
    const rows=(paper?snapshot.history.rows:snapshot.orders.rows).filter(row=>row.id===p.nativeOrderId&&symbols.has(row.symbol)&&row.side===side&&row.type==='Market'&&num(row.qty)===b.quantity&&orderStatus(row)==='filled'&&tick(num(row.avgPrice)));
    if(rows.length!==1||snapshot.value.bound.symbol!==b.symbol)fail('NATIVE_USER_DURABLE_FILL_NATIVE_ID_NOT_FOUND');
    const order=rows[0],positions=snapshot.positions.rows;
    if(!snapshot.flat&&!(positions.length===1&&symbols.has(positions[0].symbol)&&[side,side==='Buy'?'Long':'Short'].includes(positions[0].side)&&num(positions[0].qty)===b.quantity&&num(positions[0].avgPrice)===num(order.avgPrice)))fail('NATIVE_USER_DURABLE_FILL_CURRENT_INVENTORY_CONFLICT');
    state.own={attemptKey:r.key,permit:{binding:copy(b),signal:copy(s)},nativeOrderId:order.id,verifiedOrderRow:copy(order),fillVerified:true,closedReceipts:[],baselineHistoryIds:[],nativePreset:copy(snapshot.value.preset),trustedInputCount:0,lastScanTrustedInputCount:0,restoredFromDurableFill:true};state.consumed.push(r.key);state.consumed=state.consumed.slice(-256);
    return snapshot;
  }
  function source(binding,{optional=false}={}){
    if(!binding){if(optional)return null;fail('NATIVE_USER_LIVE_SOURCE_BINDING_REQUIRED');}
    if(binding.mode!=='LIVE'||binding.instrument!=='CME_MINI:NQ1!'||binding.timeframe!=='1'||binding.sourceTabId!==expected.sourceTabId||binding.researchUrl!==expected.researchUrl||!bounded(binding.sessionId)||!integer(binding.generation)||binding.generation<0
      ||!integer(binding.asOfTime)||!plain(binding.closedBar)||binding.closedBar.closeTime!==binding.asOfTime)fail('NATIVE_USER_LIVE_SOURCE_BINDING_REQUIRED');
    const tabs=all('[role="tab"][aria-selected="true"]').filter(n=>/data\s*window/i.test(norm(n.getAttribute('aria-label')||n.textContent))),studies=all('[role="treegrid"] [role="row"][data-role="menuitem"]').filter(row=>(all('span[title]',row).some(n=>(n.getAttribute('title')??'').startsWith('Arrow OHLC Window v2'))||all(':scope > div[class*="header-"] > span[class*="headerTitle-"]',row).some(n=>!n.getAttribute('title')&&/^Arrow OHLC Window v2(?:\s|\(|$)/.test(norm(n.textContent)))));
    if(tabs.length!==1||studies.length!==1)fail('NATIVE_USER_VISIBLE_OWN_SOURCE_REQUIRED');
    const suffixes=['TIME','CLOSE_TIME','OPEN','HIGH','LOW','CLOSE','VOLUME'],tagged=[],add=(key,kind='scalar')=>tagged.push({name:'ARROW2_'+key,kind});
    for(const [key,kind]of [['SOURCE_EPOCH','time'],['BASE_MS'],['TICK','price'],['POINT','price'],['HIGHER1_MS'],['HIGHER2_MS'],['SUPPORTED'],['HISTORY_STATE']])add(key,kind);
    for(const suffix of [...suffixes,'CLOSED'])add('CURRENT_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':suffix==='VOLUME'?'volume':'scalar');
    for(const group of ['PREVIOUS','HIGHER1','HIGHER2','HISTORY_BASE','HISTORY_HIGHER1','HISTORY_HIGHER2'])for(const suffix of suffixes)add(group+'_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':'volume');
    const fields=['ARROW2_PROTOCOL','ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN',...tagged.map(f=>f.name),'ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B','ARROW2_SEQ_END'],nodes=new Map();
    for(const key of fields){const title=one(`[data-test-id-value-title="${key}"]`,studies[0]),p=title?.parentElement;if(!p||p.children.length!==2||p.children[0]!==title)fail('NATIVE_USER_SOURCE_FIELD_STRUCTURE_CHANGED');nodes.set(key,p.children[1]);}
    const read=key=>{const raw=norm(nodes.get(key)?.textContent);if(/^(?:∅|—|na)$/i.test(raw))return null;const value=num(raw);if(!integer(value))fail('NATIVE_USER_SOURCE_INTEGER_REQUIRED');return value;};
    const seq=read('ARROW2_SEQ_BEGIN'),epoch=read('ARROW2_RUN_EPOCH'),raw=Object.fromEntries(fields.map(key=>[key,read(key)]));
    if(raw.ARROW2_PROTOCOL!==3||!integer(seq)||seq<0||raw.ARROW2_SEQ_END!==seq||read('ARROW2_SEQ_BEGIN')!==seq||read('ARROW2_SEQ_END')!==seq||read('ARROW2_RUN_EPOCH')!==epoch||binding.runId!=='CME_MINI:NQ1!|1|'+epoch)fail('NATIVE_USER_COHERENT_SOURCE_RUN_REQUIRED');
    let a=0,b=0;for(const value of [epoch,seq,...tagged.map(f=>raw[f.name]??-1)]){a=(a*65599+((value%1000000007)+1000000007)%1000000007)%1000000007;b=(b*131071+((value%1000000009)+1000000009)%1000000009)%1000000009;}
    if(raw.ARROW2_CHECKSUM_A!==a||raw.ARROW2_CHECKSUM_B!==b)fail('NATIVE_USER_SOURCE_CHECKSUM_MISMATCH');
    const decoded={};for(const field of tagged){const value=raw[field.name];if(value===null){decoded[field.name]=null;continue;}const base=field.kind==='price'?20000000000:1e12,payload=value%base;
      if(value<0||Math.floor(value/base)!==seq%4096)fail('NATIVE_USER_SOURCE_TAG_MISMATCH');decoded[field.name]=field.kind==='price'?(payload-1e10)/10000:field.kind==='time'?payload+1577836800000:payload;}
    const emitted=decoded.ARROW2_SOURCE_EPOCH;if(decoded.ARROW2_SUPPORTED!==3||decoded.ARROW2_BASE_MS!==60000||decoded.ARROW2_TICK!==.25||decoded.ARROW2_POINT!==20||!integer(emitted)||emitted<now()-15000||emitted>now()+5000)fail('NATIVE_USER_LIVE_SOURCE_CURRENTNESS_REQUIRED');
    const bar=(group,current=false)=>{const time=decoded['ARROW2_'+group+'_TIME'],proof=decoded['ARROW2_'+group+'_CLOSE_TIME']-1577836800000,values=Object.fromEntries(['OPEN','HIGH','LOW','CLOSE'].map(k=>[k.toLowerCase(),decoded['ARROW2_'+group+'_'+k]])),closed=current?decoded.ARROW2_CURRENT_CLOSED===1:true;
      if(!integer(time)||!integer(proof)||proof<0||!Object.values(values).every(tick)||values.high<Math.max(values.open,values.close,values.low)||values.low>Math.min(values.open,values.close,values.high)||time>emitted||closed&&time+60000>emitted)fail('NATIVE_USER_SOURCE_BAR_INVALID');
      return {time,closeTime:time+60000,...values,closed,providerBarIndex:Math.floor(proof/4)};};
    if(![0,1].includes(decoded.ARROW2_CURRENT_CLOSED))fail('NATIVE_USER_SOURCE_FINALITY_INVALID');
    const current=bar('CURRENT',true),previous=bar('PREVIOUS'),closed=current.closed?current:previous;
    if(!current.closed&&previous.closeTime!==current.time||closed.closeTime!==binding.asOfTime||['time','closeTime','open','high','low','close'].some(k=>closed[k]!==binding.closedBar[k])||emitted-current.closeTime>15000)fail('NATIVE_USER_APPROVED_CLOSED_BAR_CHANGED');
    return {runId:binding.runId,sequence:seq,sourceEmittedAt:emitted,current,closed,latestClosedAt:closed.closeTime,sourceVerified:true,checksumsVerified:true,observedAt:now(),verificationEpochMs:performance.timeOrigin+perf()};
  }
  function permitCheck(permit,attemptKey){
    const b=permit?.binding,s=permit?.signal;
    if(permit?.kind!=='EXECUTION_LIFECYCLE_ENTRY_PERMIT'||permit.version!=='execution-lifecycle-1'||!bounded(permit.id)||!bounded(permit.sessionId)||!integer(permit.generation)||permit.generation<0
      ||!plain(b)||b.accountIdentity?.provider!==provider||b.accountIdentity.environment!==environment||b.accountIdentity.nativeAccountId!==expected.nativeAccountId||b.adapterId!==(paper?'tradingview-paper-market-ui':'tradovate-market-ui')
      ||b.accountRevision!==expected.accountRevision||b.selectionKey!==expected.selectionKey||!bounded(b.sourceIdentity)||!bounded(b.sourceRunId)||!/^NQ[HMUZ]20\d\d$/.test(b.symbol)||!integer(b.quantity)||b.quantity<1
      ||s?.status!=='CONFIRMED'||s.synthetic!==false||s.testOnly!==false||!['LONG','SHORT'].includes(s.direction)||!bounded(s.eventId,1024)||s.symbol!==b.symbol||s.sourceIdentity!==b.sourceIdentity||s.sourceRunId!==b.sourceRunId||!integer(s.confirmedAt)||s.confirmationBarCloseTime!==s.confirmedAt
      ||!finite(permit.issuedAt)||!finite(permit.expiresAt)||permit.issuedAt<0||permit.expiresAt>8640000000000000||now()<permit.issuedAt||now()>permit.expiresAt||permit.expiresAt-permit.issuedAt>2000||permit.expiresAt<=permit.issuedAt)fail('NATIVE_USER_CURRENT_ENTRY_PERMIT_REQUIRED');
    const key=['execution-attempt-1',provider,environment,expected.nativeAccountId,b.symbol,s.eventId].map(encodeURIComponent).join(':');if(attemptKey!==key)fail('NATIVE_USER_DURABLE_ATTEMPT_KEY_MISMATCH');return b;
  }
  function approvalCheck(permit,approval,witness,binding,quote,sourceClose,sourceEmittedAt){
    if(approval?.approvalPolicy==='roi_brr_market_on_ready_v1'){
      const a=approval,s=permit.signal,observed=globalThis[Symbol.for('arrow.roi-brr-live-observation.v1')],age=now()-observed?.observedAtWall;
      if(a.kind!=='ROI_BRR_MARKET_APPROVAL_V1'||a.eventId!==s.eventId||a.eventId!==`CME_MINI:NQ1!:1:${s.confirmedAt}:${s.direction}:ROI_BRR`||
        a.direction!==s.direction||a.closeTime!==s.confirmedAt||binding.asOfTime!==a.closeTime||binding.runId!==permit.binding.sourceRunId||
        !integer(a.priceTicks)||a.priceTicks<=0||a.priceTicks!==binding.closedBar?.close/.25||!tick(quote)||!tick(sourceClose)||
        observed?.kind!=='ROI_BRR_LIVE_READY_V1'||observed.documentTimeOrigin!==performance.timeOrigin||observed.sourceUrl!==binding.researchUrl||
        observed.sessionId!==binding.sessionId||observed.runId!==binding.runId||observed.closeTime!==a.closeTime||observed.direction!==a.direction||observed.priceTicks!==a.priceTicks||
        !finite(age)||age<0||age>2000||!integer(observed.sourceEmittedAt)||observed.sourceEmittedAt>sourceEmittedAt||sourceEmittedAt-a.closeTime>15000)
        fail('NATIVE_USER_ROI_BRR_LIVE_READY_PROOF_REQUIRED');
      return [s.eventId];
    }
    const profiles={CANDLE_TREND_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],CANDLE_REVERSAL_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],CANDLE_RANGE_EDGE:['STRUCTURE','KNOWN_LOCATION'],PIN_TREND_AT_ZONE:['STRUCTURE','KNOWN_LOCATION'],PIN_CONFLUENCE:['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME'],PIN_RANGE_EDGE:['STRUCTURE','KNOWN_LOCATION'],ENGULFING_EMA:['STRUCTURE','EMA'],ENGULFING_FIB:['STRUCTURE','FIB'],ENGULFING_TRENDLINE:['STRUCTURE','TRENDLINE'],ENGULFING_RANGE:['STRUCTURE','KNOWN_LOCATION'],ENGULFING_SUPPLY_DEMAND:['STRUCTURE','SUPPLY_DEMAND'],ENGULFING_RANGE_RECLAIM:['STRUCTURE','KNOWN_LOCATION'],HANGING_MAN_REVERSAL:['STRUCTURE','KNOWN_LOCATION'],INVERTED_HAMMER_REVERSAL:['STRUCTURE','KNOWN_LOCATION'],INSIDE_BREAKOUT:['STRUCTURE','KNOWN_LOCATION'],INSIDE_FALSE_BREAK:['STRUCTURE','KNOWN_LOCATION'],INSIDE_FALSE_BREAK_FIB:['STRUCTURE','FIB'],ROLE_REVERSAL_RETEST:['STRUCTURE','KNOWN_LOCATION']};
    const a=approval,s=permit.signal,passed=row=>['required','enabled','available','passed'].every(k=>row?.[k]===true)&&row.state==='PASS'&&row.pendingConfirmation!==true;
    if(a?.engineDefinitionVersion!=='guide-signals-5'||a.technicalDecisionVersion!=='guide-technical-decision-1'||a.approvalPolicy!=='guide_scenarios_v1'||a.eventId!==s.eventId||a.direction!==s.direction||a.asOfTime!==s.confirmedAt||a.confirmationBarCloseTime!==s.confirmedAt
      ||!integer(a.confirmedAt)||a.confirmedAt<s.confirmedAt||!integer(a.analysisAsOfTime)||a.analysisAsOfTime<a.confirmedAt||a.analysisAsOfTime>sourceEmittedAt
      ||a.confirmationPolicy!=='later_close_beyond_setup'||a.synthetic===true||a.testOnly===true||a.roleReversalEnabled!==true||a.supplyDemandEnabled!==true
      ||!Array.isArray(a.sourceEventIds)||!a.sourceEventIds.length||a.sourceEventIds.length>600||a.sourceEventIds.some(id=>!bounded(id,1024))||new Set(a.sourceEventIds).size!==a.sourceEventIds.length||!Array.isArray(a.strategyProofs)||!a.strategyProofs.length||a.strategyProofs.length>18||new Set(a.strategyProofs.map(p=>p?.profileId)).size!==a.strategyProofs.length)fail('NATIVE_USER_REAL_TECHNICAL_APPROVAL_REQUIRED');
    const covered=[];for(const p of a.strategyProofs){const needed=Object.hasOwn(profiles,p?.profileId)?profiles[p.profileId]:null;if(!needed||!same(p.requiredCheckIds,needed)||!Array.isArray(p.requiredChecks)||p.requiredChecks.length!==needed.length||needed.some(id=>p.requiredChecks.filter(r=>r.id===id&&passed(r)).length!==1)||!Array.isArray(p.sourceEventIds)||!p.sourceEventIds.length||p.sourceEventIds.some(id=>!a.sourceEventIds.includes(id)))fail('NATIVE_USER_STRATEGY_PROFILE_PROOF_REQUIRED');covered.push(...p.sourceEventIds);}
    const union=[...new Set(a.strategyProofs.flatMap(p=>p.requiredCheckIds))];if(covered.length!==a.sourceEventIds.length||new Set(covered).size!==covered.length||!Array.isArray(a.requiredChecks)||a.requiredChecks.length!==union.length||union.some(id=>a.requiredChecks.filter(r=>r.id===id&&passed(r)).length!==1))fail('NATIVE_USER_STRATEGY_UNION_PROOF_REQUIRED');
    if(binding.runId!==permit.binding.sourceRunId||binding.asOfTime!==s.confirmedAt||witness?.kind!=='CURRENT_LIVE_QUOTE_PRESERVES_FROZEN_SETUP'||witness.direction!==s.direction||witness.asOfTime!==s.confirmedAt||witness.pricesAdjusted!==false||!same(witness.sourceEventIds,a.sourceEventIds)||!Array.isArray(witness.setups)||witness.setups.length!==a.sourceEventIds.length||new Set(witness.setups.map(x=>x?.eventId)).size!==witness.setups.length
      ||witness.setups.some(x=>!a.sourceEventIds.includes(x.eventId)||!tick(x.trigger)||!tick(x.structuralInvalidation)))fail('NATIVE_USER_FROZEN_TECHNICAL_ENTRY_WITNESS_REQUIRED');
    const confirmedClose=binding.closedBar?.close;
    const eligible=witness.setups.filter(x=>tick(confirmedClose)&&(s.direction==='LONG'?confirmedClose>x.trigger&&quote>=x.structuralInvalidation&&sourceClose>=x.structuralInvalidation:confirmedClose<x.trigger&&quote<=x.structuralInvalidation&&sourceClose<=x.structuralInvalidation));
    if(!eligible.length)fail('NATIVE_USER_CURRENT_QUOTE_INVALIDATED_SETUP');return eligible.map(x=>x.eventId);
  }

  function idle(){const legacy=globalThis[Symbol.for('arrow.paper-user-market-ui.v1')],replay=globalThis[Symbol.for('arrow.user-market-ui.v1')];if(legacy&&(legacy.busy||legacy.lease||legacy.own&&!legacy.own.fillVerified)||replay&&(replay.busy||replay.lease||replay.own&&!replay.own.fillVerified))fail('NATIVE_USER_OTHER_EXECUTION_MODE_UNRESOLVED');}
  try{
    guardInstall();
    if(command.action==='disarm'){state.generation++;state.lastLeaseRevocation='EXPLICIT_DISARM:'+String(command.reason??'');state.lease=null;identity();return result('DISARMED',{ownAttemptRetained:!!state.own});}
    identity();if(state.busy)fail('NATIVE_USER_NATIVE_BUSY');state.busy=true;ownsBusy=true;
    const action=({preflight:'prepare',verify:'reconcile'})[command.action]??command.action;
    if(action==='read_connection'){
      // Frequent health checks must not navigate the account manager. Identity,
      // chart quantity/preset and the coherent source are checked synchronously;
      // this deliberately makes no fresh account-inventory claim.
      const value=native(),live=source(command.sourceBinding,{optional:true}),snapshot={value,positions:{rows:[]},orders:{rows:[]},flat:false,positionsComplete:false,workingOrdersComplete:false,
        proofKind:'NATIVE_ACCOUNT_INVENTORY_NOT_READ_BY_HEALTH_CHECK',scope:'IDENTITY_QUANTITY_PRESET_AND_SOURCE_ONLY'};
      return result('NATIVE_USER_CONNECTION_VERIFIED',{...connection(snapshot,live),readOnly:true,accountTabNavigationOnly:false,inventoryRead:false,presetApplied:false,inputValuesSetByDriver:false,submitCapabilityCreated:false});
    }
    if(action==='inspect'){
      const snapshot=await accountState({withHistory:paper}),live=source(command.sourceBinding,{optional:true});return result('NATIVE_USER_CONNECTION_VERIFIED',{...connection(snapshot,live),readOnly:false,accountTabNavigationOnly:true,inventoryRead:true,presetApplied:false,inputValuesSetByDriver:false,submitCapabilityCreated:false});
    }
    if(action==='verify_not_submitted'){
      const r=command.record,b=r?.intentBinding?.binding,receipt=command.receipt,res=receipt?.result,origin=receipt?.measurementAnchor?.sourceObservation?.sourceDocumentTimeOrigin;
      const privateReceipt=state.rejections?.find(p=>p.id===res?.nonSubmissionReceiptId&&p.attemptKey===r?.key&&same(p.binding,r?.intentBinding));
      const reviewedLegacy=paper&&command.operatorReviewedExport===true&&origin===performance.timeOrigin&&res?.reasonCodes?.length===1&&res.reasonCodes[0]==='NATIVE_USER_PRIVATE_NATIVE_LEASE_REQUIRED';
      if(!r||r.status!=='UNKNOWN'||r.history?.some(h=>h.status!=='UNKNOWN')||r.history?.[0]?.phase!=='RESERVED_BEFORE_DISPATCH'||receipt?.phase!=='NATIVE_SUBMISSION_REPLY'||receipt.attemptKey!==r.key||receipt.eventId!==r.eventIdentity?.eventId||res?.kind!=='NATIVE_USER_MARKET_RESULT_V1'||res.status!=='BLOCKED'||res.submitted!==false||res.ordersCreated!==false||(!privateReceipt&&!reviewedLegacy)||!integer(receipt.observedAtReceiver)||receipt.observedAtReceiver<r.reservedAt||receipt.observedAtReceiver>r.reservedAt+10000||state.own||state.consumed.includes(r.key)||b?.accountIdentity?.provider!==provider||b.accountIdentity.environment!==environment||b.accountIdentity.nativeAccountId!==expected.nativeAccountId)fail('NATIVE_USER_NON_SUBMISSION_PROOF_REQUIRED');
      const snapshot=await accountState(),live=source(command.sourceBinding),observedAt=now();if(!snapshot.flat||!snapshot.positionsComplete||!snapshot.workingOrdersComplete||snapshot.value.bound.symbol!==b.symbol||state.own||state.consumed.includes(r.key))fail('NATIVE_USER_FRESH_FLAT_NON_SUBMISSION_REQUIRED');
      const accountIdentity=copy(b.accountIdentity),accountInventory={sampleId:crypto.randomUUID(),observedAt,accountIdentity,sourceIdentity:b.sourceIdentity,sourceRunId:command.sourceBinding.runId,symbol:b.symbol,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],ownershipVerified:false,synthetic:false,testOnly:false};
      return {kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:r.key,status:'NOT_SUBMITTED',binding:copy(r.intentBinding),attributionVerified:true,submitted:false,noOrderVerified:true,accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...accountIdentity,origin:'PUBLIC_NATIVE_UI',nativeIdentityVerified:true,environmentVerified:paper,environmentBasis:paper?'NATIVE_PAPER_PROVIDER_DEMO':'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED',connected:true,observedAt,synthetic:false,testOnly:false},accountInventory,nonSubmissionBasis:privateReceipt?'PRIVATE_PRE_GESTURE_REJECTION_AND_FRESH_FLAT_ACCOUNT':'OPERATOR_REVIEWED_PAPER_BLOCKED_REPLY_SAME_DOCUMENT_NO_PRIVATE_DISPATCH_AND_FRESH_FLAT_ACCOUNT',rejectionReceipt:copy(receipt),latestClosedAt:live.latestClosedAt,synthetic:false,testOnly:false};
    }
    if(action==='prepare'){
      if(command.testOnly===true||command.synthetic===true)fail('NATIVE_USER_TEST_SUBMISSION_EXCLUDED');idle();if(state.own)fail('NATIVE_USER_OWN_ATTEMPT_UNRESOLVED');
      const b=permitCheck(command.permit,command.attemptKey),snapshot=await accountState({withHistory:paper}),live=source(command.sourceBinding),value=snapshot.value;
      if(!snapshot.flat||value.quantity!==b.quantity||value.bound.symbol!==b.symbol)fail('NATIVE_USER_EMPTY_ACCOUNT_AND_NATIVE_QUANTITY_REQUIRED');
      const eligible=approvalCheck(command.permit,command.approvalProof,command.technicalEntryWitness,command.sourceBinding,value.quotes[command.permit.signal.direction],live.current.close,live.sourceEmittedAt),at=now(),
        prepared={kind:'EXECUTION_SESSION_NATIVE_PREPARATION_V1',status:'READY',binding:copy(b),direction:command.permit.signal.direction,quantity:b.quantity,privateLeaseId:crypto.randomUUID(),expiresAt:Math.min(command.permit.expiresAt,at+750),connection:connection(snapshot,live),executionSurface:'USER_MANAGED_CHART_MARKET',nativePreset:copy(value.preset)};
      if(prepared.expiresAt<=at)fail('NATIVE_USER_NATIVE_PREPARATION_EXPIRED');
      state.lease={prepared:copy(prepared),permit:copy(command.permit),attemptKey:command.attemptKey,approval:copy(command.approvalProof),witness:copy(command.technicalEntryWitness),sourceBinding:copy(command.sourceBinding),baselineHistoryIds:snapshot.history?.rows.map(r=>r.id)??[],generation:state.generation,observedPerformance:perf(),eligible};return prepared;
    }
    if(action==='submit'){
      const lease=state.lease,b=permitCheck(command.permit,command.attemptKey);
      if(expected.executionAuthorized!==true)fail('NATIVE_USER_EXPLICIT_START_REQUIRED');
      const leaseChecks={nonTest:command.testOnly!==true&&command.synthetic!==true,present:!!lease,generation:!!lease&&lease.generation===state.generation,prepared:!!lease&&same(command.nativePrepared,lease.prepared),permit:!!lease&&same(command.permit,lease.permit),attempt:!!lease&&command.attemptKey===lease.attemptKey,wallTime:!!lease&&now()<=lease.prepared.expiresAt,performanceTime:!!lease&&perf()-lease.observedPerformance<=750&&perf()>=lease.observedPerformance};
      if(Object.values(leaseChecks).some(passed=>!passed))fail('NATIVE_USER_PRIVATE_NATIVE_LEASE_REQUIRED',{leaseDiagnostic:{checks:leaseChecks,elapsedPerformanceMs:lease?perf()-lease.observedPerformance:null,lastRevocation:state.lastLeaseRevocation??null,preparedDifferingKeys:lease?[...new Set([...Object.keys(command.nativePrepared??{}),...Object.keys(lease.prepared)])].filter(k=>!same(command.nativePrepared?.[k],lease.prepared[k])):[],connectionDifferingKeys:lease?[...new Set([...Object.keys(command.nativePrepared?.connection??{}),...Object.keys(lease.prepared.connection??{})])].filter(k=>!same(command.nativePrepared?.connection?.[k],lease.prepared.connection?.[k])):[]}});
      const r=command.record;if(r?.key!==command.attemptKey||r.status!=='UNKNOWN'||!same(r.accountIdentity,b.accountIdentity)||!same(r.intentBinding?.binding,b)||!same(r.intentBinding?.signal,command.permit.signal)||r.history?.[0]?.phase!=='RESERVED_BEFORE_DISPATCH')fail('NATIVE_USER_DURABLE_UNKNOWN_BEFORE_DISPATCH_REQUIRED');
      if(state.consumed.includes(command.attemptKey)||state.own)fail('NATIVE_USER_NATIVE_ATTEMPT_ALREADY_CONSUMED');idle();
      const snapshot=await accountState(),live=source(lease.sourceBinding),value=native();
      if(!snapshot.flat||value.quantity!==b.quantity||value.bound.symbol!==b.symbol||value.preset.fingerprint!==lease.prepared.nativePreset?.fingerprint||state.generation!==lease.generation||state.lease!==lease||now()>lease.prepared.expiresAt||perf()-lease.observedPerformance>750)fail('NATIVE_USER_FINAL_ACCOUNT_OR_PRESET_CHANGED');
      const eligible=approvalCheck(command.permit,lease.approval,lease.witness,lease.sourceBinding,value.quotes[command.permit.signal.direction],live.current.close,live.sourceEmittedAt);
      if(state.consumed.length>=2048)fail('NATIVE_USER_NATIVE_LEDGER_FULL');state.consumed.push(command.attemptKey);state.lease=null;
      state.own={attemptKey:command.attemptKey,permit:copy(command.permit),baselineHistoryIds:[...lease.baselineHistoryIds],nativeOrderId:null,fillVerified:false,interfered:false,submittedAt:now(),submittedPerformance:perf(),documentTimeOrigin:performance.timeOrigin,nativePreset:copy(value.preset)};
      gestureStarted=true;(command.permit.signal.direction==='LONG'?value.buy:value.sell).click();
      return result('NATIVE_USER_SUBMITTED_UNCONFIRMED',{submitted:true,ordersCreated:null,attemptKey:command.attemptKey,submissionAttempted:true,eligibleSetupIds:eligible,executionSurface:'USER_MANAGED_CHART_MARKET',nativePreset:copy(value.preset),presetApplication:null,documentTimeOrigin:performance.timeOrigin,submittedPerformance:state.own.submittedPerformance,verificationEpochMs:performance.timeOrigin+perf(),nativeIdentityVerified:true,realBrokerOrdersAuthorized:!paper});
    }
    if(action==='reconcile'||action==='review_closed'){
      const r=command.record,currentLive=source(command.sourceBinding),restoredSnapshot=!state.own?await restoreFilledOwnership(r):null,own=state.own;if(!own||r?.key!==own.attemptKey||!same(r.intentBinding?.binding,own.permit.binding))fail('NATIVE_USER_PRIVATE_OWN_ATTEMPT_REQUIRED');
      // A panel restart preserves the source-side private dispatch owner, but
      // its new observation session needs one fresh read-only inventory scan.
      if(action==='review_closed'){
        const receipt=command.receipt,result=receipt?.result;
        if(!paper||command.operatorReviewedExport!==true||!/^\d{1,20}$/.test(command.nativeOrderId??'')||receipt?.phase!=='NATIVE_SUBMISSION_REPLY'||receipt.attemptKey!==own.attemptKey||receipt.eventId!==own.permit.signal.eventId||result?.submitted!==true||!['NATIVE_USER_SUBMITTED_UNCONFIRMED','PAPER_USER_SUBMITTED_UNCONFIRMED'].includes(result.status)||result.attemptKey!==own.attemptKey||result.documentTimeOrigin!==own.documentTimeOrigin||!finite(receipt.observedAtReceiver)||Math.abs(receipt.observedAtReceiver-own.submittedAt)>5000)fail('NATIVE_USER_EXACT_REVIEWED_DISPATCH_RECEIPT_REQUIRED');
        own.reconciliationScanSeen=false;
      }
      if(own.lastReconcileSourceSessionId!==command.sourceBinding.sessionId){own.reconciliationScanSeen=false;own.lastReconcileSourceSessionId=command.sourceBinding.sessionId;}
      const signature=passiveInventorySignature(),inputChanged=(own.trustedInputCount??0)!==(own.lastScanTrustedInputCount??0),quiet=!inputChanged||now()-(own.lastTrustedInputAt??now())>=1000,
        structuralChanged=signature!==null&&signature!==own.passiveStructuralSignature,secondClosureSample=(own.closedReceipts?.length??0)>0&&r.status!=='CLOSED';
      if(own.reconciliationScanSeen&&(!quiet||!secondClosureSample&&!structuralChanged&&!inputChanged||signature===null&&!inputChanged&&!secondClosureSample)){
        return result('NATIVE_USER_RECONCILIATION_PENDING',{submitted:true,ordersCreated:null,attemptKey:own.attemptKey,intentKey:own.attemptKey,nativeAccountId:expected.nativeAccountId,nativeIdentityVerified:true,
          sourceVerified:true,sourceBinding:copy(command.sourceBinding),observedAt:now(),latestClosedAt:currentLive.latestClosedAt,inventoryRead:false,inventoryFresh:false,ownedStateChanged:false,
          ...(own.lastReconciliationDiagnostics?{reconciliationDiagnostics:copy(own.lastReconciliationDiagnostics)}:{}),reasonCodes:[!quiet?'NATIVE_USER_WAITING_FOR_USER_INPUT_QUIET':signature===null?'NATIVE_USER_PASSIVE_STRUCTURE_UNAVAILABLE':'NATIVE_USER_NATIVE_STRUCTURE_UNCHANGED']});
      }
      let snapshot;try{snapshot=restoredSnapshot??await accountState({withHistory:paper});}finally{own.reconciliationScanSeen=true;own.passiveStructuralSignature=passiveInventorySignature();own.lastScanTrustedInputCount=own.trustedInputCount??0;own.lastInventoryScanAt=now();}
      const live=source(command.sourceBinding),b=own.permit.binding,side=own.permit.signal.direction==='LONG'?'Buy':'Sell',
        symbols=new Set([b.symbol,'CME_MINI:'+b.symbol,...(!paper?[snapshot.value.bound.displaySymbol]:[])]),
        candidates=(paper?snapshot.history.rows:snapshot.orders.rows).filter(row=>(own.nativeOrderId?row.id===own.nativeOrderId:!own.baselineHistoryIds.includes(row.id))&&symbols.has(row.symbol)&&row.side===side&&row.type==='Market'&&num(row.qty)===b.quantity&&row.status.toLowerCase()==='filled'&&tick(num(row.avgPrice)));
      if(candidates.length===1){
        const order=candidates[0],matching=snapshot.positions.rows.filter(row=>symbols.has(row.symbol)&&[side,side==='Buy'?'Long':'Short'].includes(row.side)&&num(row.qty)===b.quantity&&num(row.avgPrice)===num(order.avgPrice));
        const reviewed=action==='review_closed'&&command.nativeOrderId===order.id;
        const completedFill=nativeFill(order),completedBeforePosition=paper&&!own.fillVerified&&snapshot.flat&&((own.trustedInputCount??0)===0||reviewed||completedFill&&Number.isFinite(own.firstTrustedInputAt)&&own.firstTrustedInputAt>=completedFill.filledAt+completedFill.timestampPrecisionMs)&&completedFill&&completedFill.filledAt>=own.permit.signal.confirmedAt-5000&&completedFill.filledAt>=own.submittedAt-5000&&completedFill.filledAt<=own.submittedAt+15000;
        let ownedStatus=null;if(action!=='review_closed'&&snapshot.positions.rows.length===1&&matching.length===1){own.nativeOrderId=order.id;own.verifiedOrderRow=copy(order);own.fillVerified=true;own.closedReceipts=[];ownedStatus='FILLED';}else if(own.fillVerified&&snapshot.flat)ownedStatus='CLOSED';else if(completedBeforePosition){own.nativeOrderId=order.id;own.verifiedOrderRow=copy(order);own.fillVerified=true;own.completedBeforePositionObserved=true;own.operatorReviewedFill=reviewed;own.closedReceipts=[];ownedStatus='CLOSED';}
        if(ownedStatus){
          const observedAt=now(),sampleId=crypto.randomUUID();if(ownedStatus==='CLOSED'){own.closedReceipts??=[];if(own.closedReceipts.length&&observedAt<=own.closedReceipts.at(-1).observedAt)fail('NATIVE_USER_DISTINCT_CLOSURE_OBSERVATION_REQUIRED');own.closedReceipts.push({sampleId,observedAt,latestClosedAt:live.latestClosedAt});own.closedReceipts=own.closedReceipts.slice(-2);}
          return result('NATIVE_USER_OWNED_STATE_VERIFIED',{submitted:true,ordersCreated:true,ownedStatus,fillVerified:own.fillVerified,closedVerified:ownedStatus==='CLOSED',ownershipVerified:true,nativeOrderId:order.id,attemptKey:own.attemptKey,intentKey:own.attemptKey,
            nativeIdentityVerified:true,nativeAccountId:expected.nativeAccountId,symbol:b.symbol,direction:own.permit.signal.direction,quantity:b.quantity,entry:num(order.avgPrice),nativeFill:nativeFill(order),positionsComplete:true,workingOrdersComplete:true,
            positions:ownedStatus==='FILLED'?[{symbol:b.symbol,direction:own.permit.signal.direction,quantity:b.quantity}]:[],workingOrders:snapshot.activeOrders.map(row=>({symbol:row.symbol.replace(/^CME_MINI:/,''),orderId:row.id,direction:['Buy','Long'].includes(row.side)?'LONG':'SHORT',quantity:num(row.qty)})),
            observedAt,sampleId,latestClosedAt:live.latestClosedAt,sourceVerified:true,documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf(),nativeOrderRow:order,nativePositionRow:matching[0]??null,nativeWorkingOrderRows:copy(snapshot.orders.rows),
            ownershipBasis:own.operatorReviewedFill?'PRIVATE_DISPATCH_RECEIPT_OPERATOR_REVIEWED_NEW_TYPED_TIMED_FILL_AND_COMPLETE_FLAT_READ':own.completedBeforePositionObserved?'PRIVATE_SINGLE_NATIVE_CHART_DISPATCH_NEW_TYPED_TIMED_FILL_AND_COMPLETE_FLAT_READ':own.restoredFromDurableFill?'DURABLE_ATTRIBUTED_FILL_AND_SAME_TYPED_NATIVE_ORDER_ID':'PRIVATE_SINGLE_NATIVE_CHART_DISPATCH_FROM_FLAT_WITH_NEW_TYPED_FILL_ID_AND_MATCHING_POSITION',restoredFromDurableFill:own.restoredFromDurableFill===true,trustedInputAfterDispatch:{count:own.trustedInputCount??0,firstAt:own.firstTrustedInputAt??null,lastAt:own.lastTrustedInputAt??null},executionSurface:'USER_MANAGED_CHART_MARKET',nativePreset:copy(own.nativePreset),presetApplication:null,inventoryProofKind:snapshot.proofKind,protectionVerified:false});
        }
      }
      // A native click is a dispatch receipt, not a fill. This observer keeps
      // an unresolved attempt consumed when no provider order ID is available.
      own.lastReconciliationDiagnostics={newTypedFillCount:candidates.length,flat:snapshot.flat,trustedInputAfterDispatch:own.trustedInputCount??0,submittedAt:own.submittedAt,nativeFillCandidate:candidates.length===1?nativeFill(candidates[0]):null};
      return result('UNKNOWN',{submitted:true,ordersCreated:null,attemptKey:own.attemptKey,intentKey:own.attemptKey,reasonCodes:['NATIVE_USER_FILL_ATTRIBUTION_NOT_VERIFIED'],nativeIdentityVerified:true,
        reconciliationDiagnostics:copy(own.lastReconciliationDiagnostics),
        positions:snapshot.positions.rows,workingOrders:snapshot.orders.rows,positionsComplete:snapshot.positionsComplete,workingOrdersComplete:snapshot.workingOrdersComplete,
        observedAt:now(),latestClosedAt:live.latestClosedAt,sourceVerified:true,executionSurface:'USER_MANAGED_CHART_MARKET',nativePreset:copy(own.nativePreset),documentTimeOrigin:performance.timeOrigin,verificationEpochMs:performance.timeOrigin+perf()});
    }
    if(action==='release_closed'){
      const own=state.own,r=command.record,p=r?.history?.at(-1)?.proof;
      if(!own||r?.key!==own.attemptKey||r.status!=='CLOSED'||!same(r.intentBinding?.binding,own.permit.binding)||!same(r.intentBinding?.signal,own.permit.signal)||own.closedReceipts?.length!==2||p?.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||p.intentKey!==own.attemptKey||p.status!=='CLOSED'||p.nativeOrderId!==own.nativeOrderId||p.closedVerified!==true||p.attributionVerified!==true||p.accountEvidence?.provider!==provider||p.accountEvidence.environment!==environment||p.accountEvidence.nativeAccountId!==expected.nativeAccountId||!Array.isArray(p.closureSamples)||p.closureSamples.length!==2||p.closureSamples.some((sample,i)=>sample.sampleId!==own.closedReceipts[i].sampleId||sample.observedAt!==own.closedReceipts[i].observedAt||sample.latestClosedAt!==own.closedReceipts[i].latestClosedAt||sample.attemptKey!==own.attemptKey||sample.positionsComplete!==true||sample.workingOrdersComplete!==true||sample.positions?.length!==0||sample.workingOrders?.length!==0))fail('NATIVE_USER_DURABLE_CLOSED_ACK_REQUIRED');
      state.lastClosed=own;state.own=null;state.lease=null;state.generation++;return result('NATIVE_USER_CLOSED_RELEASED',{attemptKey:r.key,intentKey:r.key,nativeOrderId:own.nativeOrderId,closedVerified:true});
    }
    fail('NATIVE_USER_UNKNOWN_ACTION');
  }catch(error){state.lastLeaseRevocation='NATIVE_ACTION_REJECTED:'+String(command.action)+':'+String(error?.nativeUserCode??'UNKNOWN');state.lease=null;let rejection={};if(command.action==='submit'&&!gestureStarted&&!state.own&&command.record?.key===command.attemptKey&&!state.consumed.includes(command.attemptKey)){const id=crypto.randomUUID();state.rejections??=[];state.rejections.push({id,attemptKey:command.attemptKey,binding:copy(command.record.intentBinding)});state.rejections=state.rejections.slice(-64);rejection={nonSubmissionReceiptId:id,attemptKey:command.attemptKey,documentTimeOrigin:performance.timeOrigin};}return result(gestureStarted||command.action==='reconcile'&&state.own?'UNKNOWN':'BLOCKED',{reasonCodes:[error?.nativeUserCode??'NATIVE_USER_NATIVE_OPERATION_FAILED'],submitted:!!state.own,ordersCreated:state.own?null:false,submitCapabilityCreated:false,...(error?.leaseDiagnostic?{leaseDiagnostic:copy(error.leaseDiagnostic)}:{}),...rejection});}
  finally{if(ownsBusy)state.busy=false;}
}
export const tradovateUserMarketUiCommand=nativeUserMarketUiCommand;
