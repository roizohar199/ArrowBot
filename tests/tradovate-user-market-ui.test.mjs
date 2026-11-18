import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {nativeUserMarketUiCommand} from '../tradovate-user-market-ui.mjs';
import {makeWindowFixture,makeBootstrap,encodeFrame,recalculateChecksums,rows,SCALAR_BASE} from './window-reader-fixture.mjs';
import {roiBrrEventId,ROI_BRR_APPROVAL_POLICY} from '../roi-brr-live-signal.mjs';

// Synthetic public-UI component contracts ONLY. No real tab/account, market
// signal, browser gesture or order is involved in these positive tests.
function fixture({direction='LONG',quantity=1,knownDelay=145,provider='TRADOVATE',environment='PA'}={}){
  const start=Date.UTC(2026,10,14,12),bootstrap=makeBootstrap(),f=makeWindowFixture({bootstrap}),Element=f.canvas.constructor,doc=f.document;
  Object.defineProperty(Element.prototype,'isConnected',{configurable:true,get(){return this.connected!==false;}});
  Element.prototype.getClientRects=function(){return this.visible?[this.getBoundingClientRect()]:[];};
  const node=(attrs={},text='')=>{const n=new Element(attrs,text);n.tagName='DIV';n.disabled=false;return n;};
  const paper=provider==='TRADINGVIEW_PAPER',actions=[],listeners=new Map(),expected={provider,environment,executionAuthorized:true,researchUrl:'https://www.tradingview.com/chart/ARROWRV1/',sourceTabId:42,nativeAccountId:'Paper local component',accountRevision:1,selectionKey:'selection-1',allowResearchLiveMultiChart:true};
  Object.assign(f.context.location,{origin:'https://www.tradingview.com',href:expected.researchUrl,pathname:'/chart/ARROWRV1/'});
  f.context.URL=URL;f.context.crypto=webcrypto;f.context.requestAnimationFrame=cb=>{f.advance(10);cb(f.context.performance.now());};f.context.setTimeout=(cb,ms)=>setTimeout(()=>{f.advance(ms);cb();},0);f.context.clearTimeout=clearTimeout;
  doc.addEventListener=(type,fn)=>{listeners.set(type,fn);};
  const layout=node({'aria-label':'Logged in as test Active layout: Arrow OHLC Live Verification'}),interval=node({'data-value':'1'}),providers=[node({},paper?'Paper Trading':'Tradovate'),node({},paper?'Paper Trading':'Tradovate')],account=node({'aria-label':'Account manager'}),selector=node({'data-qa-id':'account-selector'}),name=node({},expected.nativeAccountId),panel=node({'aria-label':'Trading panel'});
  selector.querySelectorAll=s=>s==='[class*="accountName-"]'?[name]:[];
  const contract=node({title:paper?'NQZ2026':'NQZ6'}),mapping=node({title:'Continuous futures is used for charting, but the NQZ2026 contract will be used for order placement.'}),logo=node({src:'https://static.tradingview.com/static/bundles/paper.e1fda77151c371306993.svg'}),dom=node({role:'radio','aria-checked':'true'},'DOM'),order=node({role:'radio','aria-checked':'false'},'Order');
  const nativeNodes=new Map();for(const [key,text]of [['buy-market-dom','Buy Mkt'],['sell-market-dom','Sell Mkt'],['cancel-all-buy-orders',''],['cancel-all-sell-orders',''],['position-DOM','—'],['switch-pl-view','—']])nativeNodes.set(key,node({'data-qa-id':key},text));
  nativeNodes.get('cancel-all-buy-orders').disabled=true;nativeNodes.get('cancel-all-sell-orders').disabled=true;
  const qty=node({id:'dom-quantity-input','data-qa-id':'ui-lib-Input-input qty-dom-input'});qty.tagName='INPUT';qty.value=String(quantity);qty.readOnly=false;
  const prices=[28840.25,28840.5,28840.75].map((price,index)=>node({'data-qa-id':`dom-cell-${index}-price`,class:index===1?'x__value--highlighted-y':'x'},String(price)));
  for(const side of ['buy','sell'])nativeNodes.get(side+'-market-dom').click=()=>{actions.push(side==='buy'?'BUY_MARKET':'SELL_MARKET');};
  panel.querySelectorAll=s=>s==='[role="radio"]'?[order,dom]:s==='[title]'?[contract,mapping]:s==='img[src]'?[logo]:s==='[aria-label="Order ticket"],[data-name="position-panel"]'?[]:s==='input#dom-quantity-input[data-qa-id~="qty-dom-input"]'?[qty]:s==='[data-qa-id^="dom-cell-"]'?prices:/^\[data-qa-id="(.+)"\]$/.test(s)?[nativeNodes.get(/^\[data-qa-id="(.+)"\]$/.exec(s)[1])].filter(Boolean):[];
  let active='positions';const tabs=['positions','orders','history'].map(id=>{const n=node({id,role:'tab','aria-selected':id===active?'true':'false'},id);n.click=()=>{actions.push('TAB:'+id);active=id;for(const t of tabs)t.attrs['aria-selected']=String(t.attrs.id===id);};return n;});
  const statusTabs=[['orderstatustatus-all','All 1All 1',true],['orderstatus-filled','Filled 1Filled 1',false],['orderstatus-cancelled','CancelledCancelled',false],['orderstatus-rejected','RejectedRejected',false]].map(([id,text,on])=>node({id,role:'tab','aria-selected':String(on)},text));
  const orderExtraFilters=['orderstatus-working','orderstatus-inactive'].map((id,i)=>node({id,role:'tab','aria-selected':'false'},i?'Inactive':'Working'));
  const headers={positions:[['symbol','Symbol'],['side','Side'],['qty','Quantity'],['avgPrice','Avg fill price'],['takeProfit','Take profit'],['stopLoss','Stop loss'],['lastPrice','Last price'],['pl','Unrealized PnL'],['plPercent','Unrealized PnL %'],['tradeValue','Trade value'],['marketValue','Market value'],['leverage','Leverage'],['usedMargin','Margin'],['expirationDate','Expiration date'],['settings','']],
    orders:[['symbol','Symbol'],['side','Side'],['type','Type'],['qty','Quantity'],['limitPrice','Limit price'],['stopPrice','Stop price'],['avgPrice','Fill price'],['takeProfit','Take profit'],['stopLoss','Stop loss'],['instruction','Instruction'],['status','Status'],['placingTime','Placing time'],['id','Order ID'],['exitLevelId','Level ID'],['expiry','Expiry'],['leverage','Leverage'],['usedMargin','Margin'],['settings','']],
    history:[['symbol','Symbol'],['side','Side'],['type','Type'],['qty','Quantity'],['limitPrice','Limit price'],['stopPrice','Stop price'],['avgPrice','Fill price'],['status','Status'],['commission','Commission'],['placingTime','Placing time'],['closeDate','Closing time'],['id','Order ID'],['exitLevelId','Level ID'],['leverage','Leverage'],['usedMargin','Margin'],['settings','']]};
  if(!paper){for(const kind of ['positions','orders','history'])for(const h of headers[kind]){if(h[0]==='qty')h[1]='Qty';if(h[0]==='avgPrice')h[1]='Avg Fill Price';}headers.positions.push(['id','Position ID']);}
  const data={positions:[],orders:[],history:[{symbol:'CME_MINI:NQZ2026',side:'Buy',type:'Market',qty:'1',avgPrice:'28,000.00',status:'filled',id:'100',placingTime:'2026-11-13 12:00:00'}]};
  let emptyQa=true,extraFilter=false,partialRow=false;
  const grids={};for(const kind of ['positions','orders','history']){
    const grid=node({'data-name':(paper?'Paper.':'TRADOVATE.')+kind+'-table',role:'grid'}),body=node(),head=headers[kind].map(([id,text])=>node({id},text));
    const builtRows=()=>{
      if(!data[kind].length){const row=node(),cell=node({colspan:String(head.length)},'Nothing to show yet. Your account activity will appear here.');row.querySelectorAll=s=>s==='td'?[cell]:[];return[row];}
      return data[kind].map(values=>{const row=node(kind==='positions'?{}:{'data-row-id':values.id}),cells=head.map(h=>node({},values[h.attrs.id]??''));row.querySelectorAll=s=>s==='td'?(partialRow?cells.slice(1):cells):[];return row;});
    };
    Object.defineProperty(body,'textContent',{configurable:true,get:()=>data[kind].length?data[kind].map(x=>Object.values(x).join(' ')).join(' '):'Nothing to show yet. Your account activity will appear here.'});
    body.querySelectorAll=s=>s==='tr'?builtRows():s==='[data-qa-id="account-manager-tab-empty-state"]'&&!data[kind].length&&emptyQa?[node({'data-qa-id':'account-manager-tab-empty-state'})]:[];
    grid.querySelector=s=>s==='tbody'?body:null;grid.querySelectorAll=s=>s==='thead th'?head:[];grids[kind]={grid,body,head};
  }
  account.querySelectorAll=s=>s==='[data-qa-id="account-selector"]'?[selector]:s==='[role="tab"][aria-selected="true"]'?tabs.filter(t=>t.attrs['aria-selected']==='true'):s==='[role="progressbar"]'?[]:s==='[role="tab"],[role="combobox"],input'?[...tabs,...(active==='orders'?[statusTabs[0],...orderExtraFilters,...statusTabs.slice(1)]:active==='history'?statusTabs:[]),...(extraFilter?[node({role:'combobox'})]:[])]:/^\[role="tab"\]\[id="(.+)"\]$/.test(s)?tabs.filter(t=>t.attrs.id===/^\[role="tab"\]\[id="(.+)"\]$/.exec(s)[1]):/^table\[role="grid"\]\[data-name="(?:Paper|TRADOVATE)\.(.+)-table"\]$/.test(s)?[grids[/^table\[role="grid"\]\[data-name="(?:Paper|TRADOVATE)\.(.+)-table"\]$/.exec(s)[1]].grid]:/^table\[data-name="(?:Paper|TRADOVATE)\.(.+)-table"\]$/.test(s)?(/^table\[data-name="(?:Paper|TRADOVATE)\.(.+)-table"\]$/.exec(s)[1]===active?[grids[active].grid]:[]):[];
  // Observed TradingView first-trade public DOM. Hidden table loaders are not
  // empty evidence; only the scoped visible provider empty assertion is.
  const welcome={root:node(),empty:node(),title:node({},'Make a trade to get started'),text:node({},'Red or blue — choose your pill.'),buy:node({},'Buy'),sell:node({},'Sell'),hiddenPanel:node(),alert:node({role:'alert'})};
  welcome.root.parentElement=account;welcome.empty.parentElement=welcome.root;for(const key of ['title','text','buy','sell'])welcome[key].parentElement=welcome.empty;
  welcome.root.querySelectorAll=s=>s==='[data-qa-id="account-manager-empty-state"]'?[welcome.empty]:[];
  welcome.empty.querySelectorAll=s=>s==='[data-qa-id="ui-lib-empty-title account-manager-empty-state"]'?[welcome.title]:s==='[data-qa-id="ui-lib-empty-text account-manager-empty-state"]'?[welcome.text]:s==='[data-qa-id="account-manager-empty-state-buy-button"]'?[welcome.buy]:s==='[data-qa-id="account-manager-empty-state-sell-button"]'?[welcome.sell]:[];
  welcome.buy.click=()=>actions.push('WELCOME_BUY');welcome.sell.click=()=>actions.push('WELCOME_SELL');
  let welcomeOn=false,welcomeAlert=false;const ordinaryAccountQuery=account.querySelectorAll;
  account.querySelectorAll=s=>s===':scope > .js-empty-account'?(welcomeOn?[welcome.root]:[]):s==='[role="progressbar"],[role="alert"]'?(welcomeAlert?[welcome.alert]:[]):s==='[role="tab"],table[role="grid"]'?[...tabs,...Object.values(grids).map(g=>g.grid)]:s==='table[role="grid"]'?Object.values(grids).map(g=>g.grid):ordinaryAccountQuery(s);
  for(const {grid,body} of Object.values(grids)){const old=grid.querySelectorAll;grid.querySelectorAll=s=>s==='tbody tr'?body.querySelectorAll('tr'):old(s);}
  function setWelcome(on=true){welcomeOn=on;if(on)data.history=[];welcome.hiddenPanel.style.display=on?'none':'block';for(const n of [...tabs,...Object.values(grids).map(g=>g.grid)])n.parentElement=welcome.hiddenPanel;}
  const quickQty=node({'data-name':'qtyEl',title:'Quantity'});Object.defineProperty(quickQty,'textContent',{get:()=>qty.value});
  const quickBuy=node({'data-name':'buy-order-button'}),quickSell=node({'data-name':'sell-order-button'}),quickGroup=node(),activeChart=node({'data-qa-id':'chart-container',class:'chart-container multiple active'});
  let longName='USER LONG MARKET',shortName='USER SHORT MARKET';
  quickBuy.querySelectorAll=s=>s==='span[class*="buttonText-"]'?[node({},'28,840.50')]:s==='span[class*="title-"]'?[node({},longName)]:[];
  quickSell.querySelectorAll=s=>s==='span[class*="buttonText-"]'?[node({},'28,840.50')]:s==='span[class*="title-"]'?[node({},shortName)]:[];
  quickBuy.click=()=>actions.push('CHART_BUY_MARKET');quickSell.click=()=>actions.push('CHART_SELL_MARKET');
  quickGroup.querySelectorAll=s=>s==='[data-name="buy-order-button"]'?[quickBuy]:s==='[data-name="sell-order-button"]'?[quickSell]:s==='[data-name="qtyEl"]'?[quickQty]:[];
  activeChart.querySelectorAll=s=>s==='canvas[aria-label^="Chart for "]'?[f.canvas]:s==='[class*="sellBuyButtonsContainer-"]'?[quickGroup]:[];
  const oldGlobal=doc.querySelectorAll.bind(doc),oldStudy=f.study.querySelectorAll.bind(f.study);
  f.study.querySelectorAll=s=>/^\[data-test-id-value-title="(.+)"\]$/.test(s)?f.labelNodes.filter(n=>n.attrs['data-test-id-value-title']===/^\[data-test-id-value-title="(.+)"\]$/.exec(s)[1]):oldStudy(s);
  doc.canvases=[node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})];
  doc.querySelectorAll=s=>s==='[data-qa-id="chart-container"]'?[activeChart]:s==='[aria-label^="Logged in as"]'?[layout]:s==='#header-toolbar-intervals [aria-checked="true"]'?[interval]:s==='#header-toolbar-replay'?[f.replay]:s==='[role="dialog"],[aria-modal="true"]'||s==='[data-qa-id="replay_trading"]'?[]:s==='button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]'?providers:s==='[aria-label="Account manager"]'?[account]:s==='[aria-label="Trading panel"]'?[panel]:oldGlobal(s);
  const candle=(bar,index)=>({...bar,open:28840.25,high:28841,low:28839.75,close:28840.5,volume:2,providerBarIndex:index,sessionFirst:false,sessionLast:false});
  const base=rows(20,60000).map((b,i)=>candle(b,100+i)),higher=[rows(20,300000).map((b,i)=>candle(b,200+i)),rows(20,900000).map((b,i)=>candle(b,300+i))],current={...candle({time:start,closeTime:start+60000},120),closed:false};let sequence=1;
  function updateSource({close=current.close,previousClose=base.at(-1).close,corrupt=false}={}){
    current.close=close;current.high=Math.max(current.high,close);current.low=Math.min(current.low,close);base.at(-1).close=previousClose;
    const sourceAt=f.context.Date.now()+3700,raw=encodeFrame({bootstrap,sequence,base,higher,current,sourceAt});raw.ARROW2_PROTOCOL=3;
    for(const [group,b]of Object.entries({CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)}))raw['ARROW2_'+group+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+b.providerBarIndex*4;
    recalculateChecksums(raw);if(corrupt)raw.ARROW2_CHECKSUM_A++;f.setRaw(raw);return raw;
  }
  updateSource();
  const sourceBinding={sourceTabId:42,researchUrl:expected.researchUrl,sessionId:'component-live-source',runId:bootstrap.runId,generation:1,asOfTime:start,closedBar:Object.fromEntries(['time','closeTime','open','high','low','close'].map(k=>[k,base.at(-1)[k]])),instrument:'CME_MINI:NQ1!',timeframe:'1',mode:'LIVE'};
  const eventId=`technical:guide-technical-decision-1:CME_MINI:NQ1!:1:${start}:${direction}`,setup='CME_MINI:NQ1!:1:component-setup',checks=['STRUCTURE','KNOWN_LOCATION'].map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),binding={accountIdentity:{provider,environment,nativeAccountId:expected.nativeAccountId},adapterId:paper?'tradingview-paper-market-ui':'tradovate-market-ui',accountRevision:1,selectionKey:expected.selectionKey,sourceIdentity:JSON.stringify([expected.researchUrl,42,'CME_MINI:NQ1!','1']),sourceRunId:bootstrap.runId,symbol:'NQZ2026',quantity};
  const permit={kind:'EXECUTION_LIFECYCLE_ENTRY_PERMIT',version:'execution-lifecycle-1',id:'component-permit',generation:1,sessionId:'component-session',binding,signal:{eventId,direction,symbol:'NQZ2026',sourceIdentity:binding.sourceIdentity,sourceRunId:bootstrap.runId,confirmedAt:start,confirmationBarCloseTime:start,observedAt:f.context.Date.now(),status:'CONFIRMED',synthetic:false,testOnly:false},issuedAt:f.context.Date.now(),expiresAt:f.context.Date.now()+1900,scope:'ONE_LOCAL_ATTEMPT_CONTEXT_NOT_BROKER_AUTHORIZATION',orderAuthorizationGranted:false};
  const approvalProof={engineDefinitionVersion:'guide-signals-5',technicalDecisionVersion:'guide-technical-decision-1',approvalPolicy:'guide_scenarios_v1',eventId,direction,asOfTime:start,confirmedAt:start+knownDelay,analysisAsOfTime:start+knownDelay,confirmationBarCloseTime:start,confirmationPolicy:'later_close_beyond_setup',roleReversalEnabled:true,supplyDemandEnabled:true,sourceEventIds:[setup],requiredChecks:checks,strategyProofs:[{profileId:'ROLE_REVERSAL_RETEST',requiredCheckIds:['STRUCTURE','KNOWN_LOCATION'],requiredChecks:checks,sourceEventIds:[setup]}]};
  const technicalEntryWitness={kind:'CURRENT_LIVE_QUOTE_PRESERVES_FROZEN_SETUP',direction,quote:28840.5,asOfTime:start,sourceEventIds:[setup],eligibleSetupIds:[setup],pricesAdjusted:false,setups:[{eventId:setup,trigger:direction==='LONG'?28840:28841,structuralInvalidation:direction==='LONG'?28839:28842}]};
  const attemptKey=['execution-attempt-1',provider,environment,expected.nativeAccountId,'NQZ2026',eventId].map(encodeURIComponent).join(':'),record={key:attemptKey,eventIdentity:{eventId:permit.signal.eventId,symbol:'NQZ2026',direction,confirmedAt:start},status:'UNKNOWN',accountIdentity:binding.accountIdentity,intentBinding:{quantity,binding,signal:permit.signal},history:[{phase:'RESERVED_BEFORE_DISPATCH',status:'UNKNOWN',proof:null}]};
  async function run(action,extra={}){f.context.__paperArgs={action,expected,sourceBinding,permit,attemptKey,approvalProof,technicalEntryWitness,record,...extra};return JSON.parse(JSON.stringify(await vm.runInContext('('+nativeUserMarketUiCommand.toString()+')(__paperArgs)',f.context)));}
  function setFilled({brackets=false,entry=28840.5}={}){
    const side=direction==='LONG'?'Buy':'Sell',fill=entry.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    data.history.unshift({symbol:'CME_MINI:NQZ2026',side,type:'Market',qty:String(quantity),avgPrice:fill,status:'filled',id:'101',placingTime:'2026-11-14 14:00:01'});
    data.positions=[{symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Long':'Short',qty:String(quantity),avgPrice:fill}];nativeNodes.get('position-DOM').textContent=(direction==='SHORT'?'−':'')+quantity+' @ '+fill;nativeNodes.get('switch-pl-view').textContent='0 ticks';
    if(brackets){data.orders=[{symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Sell':'Buy',type:'Stop Loss',qty:String(quantity),status:'working',id:'102'},{symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Sell':'Buy',type:'Take Profit',qty:String(quantity),status:'working',id:'103'}];nativeNodes.get(direction==='LONG'?'cancel-all-sell-orders':'cancel-all-buy-orders').disabled=false;}
  }
  function setClosed(){data.positions=[];data.orders=[];nativeNodes.get('position-DOM').textContent='—';nativeNodes.get('switch-pl-view').textContent='—';nativeNodes.get('cancel-all-buy-orders').disabled=true;nativeNodes.get('cancel-all-sell-orders').disabled=true;}
  return {welcome,setWelcome,setWelcomeAlert:x=>{welcomeAlert=x;},activeChart,quickBuy,quickSell,quickGroup,quickQty,contract,setNames(a,b){longName=a;shortName=b;},f,expected,permit,sourceBinding,approvalProof,technicalEntryWitness,attemptKey,record,actions,data,qty,providers,name,logo,mapping,grids,statusTabs,orderExtraFilters,nativeNodes,prices,panel,run,setFilled,setClosed,advance:ms=>f.advance(ms),advanceTick(options={}){sequence++;return updateSource(options);},trusted:()=>listeners.get('pointerdown')?.({isTrusted:true}),setEmptyQa:x=>{emptyQa=x;},setFilter:x=>{extraFilter=x;},setPartial:x=>{partialRow=x;}};
}
const marketActions=f=>f.actions.filter(x=>/MARKET/.test(x));
async function prepared(f){const r=await f.run('prepare');assert.equal(r.status,'READY',JSON.stringify(r));return r;}
function brrApproval(f,direction){
  const closeTime=f.sourceBinding.asOfTime,eventId=roiBrrEventId(closeTime,direction),priceTicks=f.sourceBinding.closedBar.close/.25;
  const permit=structuredClone(f.permit);permit.signal.eventId=eventId;
  const attemptKey=['execution-attempt-1',f.expected.provider,f.expected.environment,f.expected.nativeAccountId,permit.binding.symbol,eventId].map(encodeURIComponent).join(':');
  const record=structuredClone(f.record);record.key=attemptKey;record.eventIdentity.eventId=eventId;record.intentBinding.signal=permit.signal;
  const stamp=f.f.context.Date.now();
  f.f.context[Symbol.for('arrow.roi-brr-live-observation.v1')]={kind:'ROI_BRR_LIVE_READY_V1',documentTimeOrigin:f.f.context.performance.timeOrigin,
    sourceUrl:f.sourceBinding.researchUrl,sessionId:f.sourceBinding.sessionId,runId:f.sourceBinding.runId,closeTime,direction,priceTicks,observedAtWall:stamp,sourceEmittedAt:stamp+3700};
  return {permit,attemptKey,record,technicalEntryWitness:undefined,approvalProof:{kind:'ROI_BRR_MARKET_APPROVAL_V1',approvalPolicy:ROI_BRR_APPROVAL_POLICY,eventId,direction,closeTime,priceTicks}};
}
test('fresh Roi BRR uses one native Market click and the unchanged preset for Paper, Evaluation and PA',async()=>{
  for(const [provider,environment,direction] of [['TRADINGVIEW_PAPER','DEMO','LONG'],['TRADOVATE','EVALUATION','SHORT'],['TRADOVATE','PA','LONG']]){
    const f=fixture({provider,environment,direction,quantity:2});
    const brr=brrApproval(f,direction),nativePrepared=await f.run('prepare',brr);
    assert.equal(nativePrepared.status,'READY',JSON.stringify(nativePrepared));
    assert.equal(nativePrepared.quantity,2);
    const submitted=await f.run('submit',{...brr,nativePrepared});
    assert.equal(submitted.status,'NATIVE_USER_SUBMITTED_UNCONFIRMED',JSON.stringify(submitted));
    assert.deepEqual(marketActions(f),[direction==='LONG'?'CHART_BUY_MARKET':'CHART_SELL_MARKET']);
    assert.equal((await f.run('submit',{...brr,nativePrepared})).status,'BLOCKED');
    assert.equal(marketActions(f).length,1);
  }
});

test('native Market preparation and dispatch both require the owned Roi BRR observation',async()=>{
  const key=Symbol.for('arrow.roi-brr-live-observation.v1');
  const missing=fixture(),signal=brrApproval(missing,'LONG');delete missing.f.context[key];
  const refused=await missing.run('prepare',signal);assert.deepEqual(refused.reasonCodes,['NATIVE_USER_ROI_BRR_LIVE_READY_PROOF_REQUIRED']);
  const expired=fixture(),brr=brrApproval(expired,'LONG'),nativePrepared=await expired.run('prepare',brr);
  assert.equal(nativePrepared.status,'READY');delete expired.f.context[key];
  const blocked=await expired.run('submit',{...brr,nativePrepared});
  assert.equal(blocked.submitted,false);assert.deepEqual(marketActions(expired),[]);
});
function durableFill(f,fill){
  f.record.status='FILLED';f.record.history.push({status:'FILLED',phase:'ATTRIBUTED_NATIVE_RECONCILIATION',at:fill.observedAt,proof:{kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:f.record.key,status:'FILLED',attributionVerified:true,fillVerified:true,closedVerified:false,binding:structuredClone(f.record.intentBinding),nativeOrderId:fill.nativeOrderId,direction:fill.direction,quantity:fill.quantity,synthetic:false,testOnly:false,accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...f.record.accountIdentity,origin:'PUBLIC_NATIVE_UI',connected:true,nativeIdentityVerified:true,environmentVerified:true,environmentBasis:'NATIVE_PAPER_PROVIDER_DEMO',observedAt:fill.observedAt,synthetic:false,testOnly:false}}});
}

test('a lost private observer restores only read-only ownership from a durable FILLED receipt and the same native order ID',async()=>{
  for(const closed of [false,true]){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();const fill=await f.run('reconcile');durableFill(f,fill);if(closed)f.setClosed();
    vm.runInContext('delete globalThis[Symbol.for("arrow.native-user-market-ui.v1")]',f.f.context);f.actions.length=0;
    const restored=await f.run('reconcile');assert.equal(restored.status,'NATIVE_USER_OWNED_STATE_VERIFIED',JSON.stringify(restored));assert.equal(restored.restoredFromDurableFill,true);assert.equal(restored.ownedStatus,closed?'CLOSED':'FILLED');assert.equal(restored.nativeOrderId,fill.nativeOrderId);assert.deepEqual(marketActions(f),[]);
    if(closed){const second=await f.run('reconcile');assert.equal(second.ownedStatus,'CLOSED');assert.notEqual(restored.sampleId,second.sampleId);}
  }
});

test('private observer recovery cannot manufacture ownership from UNKNOWN, mismatched, synthetic or absent native fill proof',async()=>{
  for(const mode of ['unknown','account','native-id','synthetic','missing','conflicting-position']){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();const fill=await f.run('reconcile');durableFill(f,fill);
    if(mode==='unknown')f.record.status='UNKNOWN';if(mode==='account')f.record.history.at(-1).proof.accountEvidence.nativeAccountId='other';if(mode==='native-id')f.record.history.at(-1).proof.nativeOrderId='999';if(mode==='synthetic')f.record.history.at(-1).proof.synthetic=true;if(mode==='missing')f.record.history.at(-1).proof=null;if(mode==='conflicting-position')f.data.positions[0].avgPrice='28,000.00';
    vm.runInContext('delete globalThis[Symbol.for("arrow.native-user-market-ui.v1")]',f.f.context);f.actions.length=0;const r=await f.run('reconcile');assert.equal(r.status,'BLOCKED',mode);assert.equal(r.closedVerified,undefined);assert.deepEqual(marketActions(f),[]);
  }
});

test('Orders uses the six observed status filters and cannot use a Working-only or Filled-only view as complete inventory',async()=>{
  for(const chosen of ['working','filled']){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.statusTabs[0].attrs['aria-selected']='false';(chosen==='working'?f.orderExtraFilters[0]:f.statusTabs[1]).attrs['aria-selected']='true';const r=await f.run('inspect');assert.equal(r.status,'BLOCKED');assert.ok(r.reasonCodes.includes('NATIVE_USER_NATIVE_HISTORY_ALL_REQUIRED'));assert.deepEqual(marketActions(f),[]);
  }
});

test('native chart preparation uses the proven closed breakout and permits a trigger retest but rejects structural invalidation',async()=>{
  for(const direction of ['LONG','SHORT'])for(const invalid of [false,true]){
    const f=fixture({direction}),quote=direction==='LONG'?(invalid?28838.75:28839.75):(invalid?28842.25:28841.25);
    for(const button of [f.quickBuy,f.quickSell]){const original=button.querySelectorAll;button.querySelectorAll=s=>{const found=original(s);if(s==='span[class*="buttonText-"]')found[0].textContent=String(quote);return found;};}
    f.advanceTick({close:quote});
    const reply=await f.run('prepare');assert.equal(reply.status,invalid?'BLOCKED':'READY',JSON.stringify(reply));
    if(invalid)assert.ok(reply.reasonCodes.includes('NATIVE_USER_CURRENT_QUOTE_INVALIDATED_SETUP'));
    assert.deepEqual(marketActions(f),[]);
  }
});

for(const [provider,environment] of [['TRADINGVIEW_PAPER','DEMO'],['TRADOVATE','PA'],['TRADOVATE','EVALUATION'],['TRADOVATE','LIVE']])test('explicit visible first-trade state supports '+provider+' '+environment+' without a test trade or tab navigation',async()=>{
  const f=fixture({provider,environment});f.setWelcome();const r=await f.run('inspect');assert.equal(r.status,'NATIVE_USER_CONNECTION_VERIFIED',JSON.stringify(r));assert.equal(r.flat,true);assert.equal(r.positionsComplete,true);assert.equal(r.workingOrdersComplete,true);assert.equal(r.inventoryProofKind,'SELECTED_NATIVE_ACCOUNT_VISIBLE_PROVIDER_EMPTY_STATE');assert.deepEqual(f.actions,[]);assert.equal(f.qty.value,'1');
  const health=await f.run('read_connection');assert.equal(health.inventoryRead,false);assert.equal(health.flat,false);assert.deepEqual(f.actions,[]);
});

test('first-trade assertion rejects hidden, incomplete, conflicting, loading and wrong-account states',async()=>{
  for(const edit of [f=>f.welcome.root.visible=false,f=>f.welcome.title.textContent='Other text',f=>f.welcome.text.textContent='',f=>f.welcome.buy.disabled=true,f=>f.setWelcomeAlert(true),f=>f.welcome.hiddenPanel.style.display='block',f=>f.name.textContent='Other account',f=>f.providers.forEach(n=>n.textContent='Other broker'),f=>f.data.positions.push({symbol:'NQZ2026',side:'Long',qty:'1'}),f=>f.data.orders.push({id:'123',symbol:'NQZ2026',side:'Buy',qty:'1'})]){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();edit(f);assert.equal((await f.run('inspect')).status,'BLOCKED');assert.deepEqual(f.actions,[]);
  }
});

test('empty account identity must remain stable across two rendered observations',async()=>{
  const f=fixture();f.setWelcome();f.f.context.requestAnimationFrame=cb=>{f.name.textContent='Changed account';cb(f.f.context.performance.now());};assert.equal((await f.run('inspect')).status,'BLOCKED');assert.deepEqual(f.actions,[]);
});

test('first-trade entry uses the existing preset once only and then requires normal typed fill evidence',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();const p=await prepared(f);assert.deepEqual(f.actions,[]);const sent=await f.run('submit',{nativePrepared:p});assert.equal(sent.status,'NATIVE_USER_SUBMITTED_UNCONFIRMED');assert.deepEqual(f.actions,['CHART_BUY_MARKET']);
  assert.equal((await f.run('reconcile')).status,'UNKNOWN','welcome cannot establish fill or owned closure');assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');assert.equal(f.actions.length,1);
  f.setWelcome(false);f.setFilled({brackets:true});const fill=await f.run('reconcile');assert.equal(fill.status,'NATIVE_USER_OWNED_STATE_VERIFIED',JSON.stringify(fill));assert.equal(fill.fillVerified,true);assert.equal(fill.ownedStatus,'FILLED');assert.equal(f.qty.value,'1');
});

test('disappearing empty assertion or new inventory between preparation and submit blocks without clicking',async()=>{
  for(const edit of [f=>f.welcome.title.textContent='',f=>f.data.orders.push({id:'123',symbol:'NQZ2026',side:'Buy',qty:'1'})]){
    const f=fixture();f.setWelcome();const p=await prepared(f);edit(f);assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');assert.deepEqual(f.actions,[]);
  }
});

test('native source accepts observed title-less own header and still rejects body-only or ambiguous study identity',async()=>{
  const f=fixture();delete f.f.header.attrs.title;f.f.header.textContent='Arrow OHLC Window v2 (100, 5, 15, 102)';assert.equal((await f.run('prepare')).status,'READY');assert.deepEqual(marketActions(f),[]);
  f.f.header.textContent='Another study';f.f.study.textContent='Arrow OHLC Window v2';assert.equal((await f.run('prepare')).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
  f.f.header.textContent='Arrow OHLC Window v2';f.f.document.studies.push(f.f.study);assert.equal((await f.run('prepare')).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
});

for(const provider of ['TRADOVATE','TRADINGVIEW_PAPER'])for(const direction of ['LONG','SHORT'])test('synthetic shared chart '+provider+' '+direction+' reads user presets and submits one exact side without editing exits',async()=>{
  const f=fixture({provider,environment:provider==='TRADINGVIEW_PAPER'?'DEMO':'PA',direction,quantity:3});
  const read=await f.run('read_connection');assert.equal(read.status,'NATIVE_USER_CONNECTION_VERIFIED',JSON.stringify(read));assert.equal(read.executionSurface,'USER_MANAGED_CHART_MARKET');assert.equal(read.quantity,3);assert.equal(read.nativePreset.stopTargetRead,false);assert.equal(read.nativePreset.sideNames.LONG,'USER LONG MARKET');assert.equal(read.nativePreset.sideNames.SHORT,'USER SHORT MARKET');assert.deepEqual(marketActions(f),[]);
  const p=await prepared(f),sent=await f.run('submit',{nativePrepared:p});assert.equal(sent.status,'NATIVE_USER_SUBMITTED_UNCONFIRMED',JSON.stringify(sent));assert.equal(sent.fillVerified,false);assert.equal(sent.protectionVerified,false);assert.deepEqual(marketActions(f),[direction==='LONG'?'CHART_BUY_MARKET':'CHART_SELL_MARKET']);
  assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');assert.equal(marketActions(f).length,1);assert.equal(f.qty.value,'3');
});

test('future evaluation accounts use the selected exact identity and declared environment',async()=>{
  const f=fixture({environment:'EVALUATION'});const r=await f.run('inspect');assert.equal(r.status,'NATIVE_USER_CONNECTION_VERIFIED',JSON.stringify(r));assert.equal(r.environment,'EVALUATION');assert.equal(r.environmentVerified,false);assert.equal(r.environmentBasis,'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');assert.equal(r.nativeIdentityVerified,true);assert.deepEqual(marketActions(f),[]);
});

test('shared driver never accepts Paper as PA or Tradovate as Paper',async()=>{
  for(const mode of ['provider','account','env','mapping','display','active','replay']){
    const f=fixture();if(mode==='provider')f.providers.forEach(n=>n.textContent='Paper Trading');if(mode==='account')f.name.textContent='OTHER';if(mode==='env')f.expected.environment='UNKNOWN';if(mode==='mapping')f.mapping.attrs.title='Different mapping';if(mode==='display')f.contract.attrs.title='NQZ7';if(mode==='active')f.activeChart.attrs.class='chart-container inactive';if(mode==='replay')f.f.replay.attrs['aria-pressed']='true';
    const r=await f.run('prepare');assert.equal(r.status,'BLOCKED',mode+JSON.stringify(r));assert.deepEqual(marketActions(f),[]);
  }
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'PA'});assert.equal((await f.run('inspect')).status,'BLOCKED');
});

test('one active one-minute chart is required while three existing chart scopes remain unchanged',async()=>{
  const f=fixture(),p=await prepared(f);assert.equal(p.connection.symbol,'NQZ2026');assert.equal(f.f.document.canvases.length,3);assert.equal(f.contract.attrs.title,'NQZ6');assert.equal(f.f.document.canvases[1].attrs['aria-label'],'Chart for CME_MINI:NQ1!, 1 minute');assert.deepEqual(marketActions(f),[]);
});

test('FULL SCREENS exact URL and name pairing is accepted without layout navigation',async()=>{
  const f=fixture(),url='https://www.tradingview.com/chart/ARROWFR1/';f.expected.researchUrl=url;f.sourceBinding.researchUrl=url;Object.assign(f.f.context.location,{href:url,pathname:'/chart/ARROWFR1/'});f.f.document.querySelectorAll('[aria-label^="Logged in as"]')[0].attrs['aria-label']='Logged in as test Active layout: Full Screens Live';f.permit.binding.sourceIdentity=JSON.stringify([url,42,'CME_MINI:NQ1!','1']);f.permit.signal.sourceIdentity=f.permit.binding.sourceIdentity;
  assert.equal((await f.run('prepare')).status,'READY');f.f.document.querySelectorAll('[aria-label^="Logged in as"]')[0].attrs['aria-label']='Logged in as test Active layout: Arrow OHLC Live Verification';assert.equal((await f.run('prepare')).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
});

test('only explicit user start plus exact durable UNKNOWN and private lease can dispatch',async()=>{
  for(const mode of ['start','durable','synthetic','expired','intervention']){
    const f=fixture(),p=await prepared(f),extra={nativePrepared:p};if(mode==='start')f.expected.executionAuthorized=false;if(mode==='durable')extra.record={...f.record,status:'FILLED'};if(mode==='synthetic')extra.testOnly=true;if(mode==='expired')f.advance(751);if(mode==='intervention')f.trusted();
    assert.equal((await f.run('submit',extra)).status,'BLOCKED',mode);assert.deepEqual(marketActions(f),[]);
  }
});

test('observed quantity and independent side preset names are frozen until the one dispatch',async()=>{
  for(const field of ['quantity','long','short','fingerprint','account','mapping']){
    const f=fixture(),p=await prepared(f);if(field==='quantity')f.qty.value='2';if(field==='long')f.setNames('CHANGED','USER SHORT MARKET');if(field==='short')f.setNames('USER LONG MARKET','CHANGED');if(field==='fingerprint')f.expected.nativePresetFingerprint='wrong';if(field==='account')f.name.textContent='Other';if(field==='mapping')f.mapping.attrs.title='Missing mapping';
    const r=await f.run('submit',{nativePrepared:p});assert.equal(r.status,'BLOCKED',field+JSON.stringify(r));assert.deepEqual(marketActions(f),[]);
  }
});

test('missing live source, modified frozen candle and corrupt checksum cannot dispatch',async()=>{
  for(const field of ['source','closed','checksum','approval']){
    const f=fixture(),extra={};if(field==='source')extra.sourceBinding=null;if(field==='closed')f.advanceTick({previousClose:28840.75});if(field==='checksum')f.advanceTick({corrupt:true});if(field==='approval')extra.approvalProof={...f.approvalProof,testOnly:true};
    const r=await f.run('prepare',extra);assert.equal(r.status,'BLOCKED',field+JSON.stringify(r));assert.deepEqual(marketActions(f),[]);
  }
});

test('nonempty native account and incomplete empty marker prevent an additional entry',async()=>{
  for(const mode of ['position','orders','empty']){
    const f=fixture();if(mode==='position')f.data.positions=[{symbol:'CME_MINI:NQZ2026',side:'Long',qty:'1',avgPrice:'28,840.50',id:'90'}];if(mode==='orders')f.data.orders=[{symbol:'CME_MINI:NQZ2026',side:'Buy',type:'Limit',qty:'1',status:'working',id:'90'}];if(mode==='empty')f.setEmptyQa(false);
    assert.equal((await f.run('prepare')).status,'BLOCKED',mode);assert.deepEqual(marketActions(f),[]);
  }
});

test('unknown post-click outcome is kept consumed without claiming a fill or protection',async()=>{
  const f=fixture(),p=await prepared(f);await f.run('submit',{nativePrepared:p});const r=await f.run('reconcile');assert.equal(r.status,'UNKNOWN');assert.equal(r.submitted,true);assert.equal(r.fillVerified,false);assert.equal(r.protectionVerified,false);assert.equal((await f.run('prepare')).status,'BLOCKED');assert.equal(marketActions(f).length,1);
});

test('Paper typed history ID and exact position can verify the own entry without making SLTP an entry gate',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();const r=await f.run('reconcile');assert.equal(r.status,'NATIVE_USER_OWNED_STATE_VERIFIED',JSON.stringify(r));assert.equal(r.ownedStatus,'FILLED');assert.equal(r.nativeOrderId,'101');assert.equal(r.protectionVerified,false);assert.equal(r.fillVerified,true);assert.equal(marketActions(f).length,1);
});

test('Paper filtered history cannot manufacture a fresh native fill ID',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.statusTabs[0].attrs['aria-selected']='false';f.statusTabs[1].attrs['aria-selected']='true';const r=await f.run('prepare');assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['NATIVE_USER_NATIVE_HISTORY_ALL_REQUIRED']);assert.deepEqual(marketActions(f),[]);
});

test('closed Paper entry needs two distinct native samples and exact durable acknowledgement before release',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();await f.run('reconcile');f.setClosed();
  const first=await f.run('reconcile');f.advance(100);const second=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED');assert.equal(second.ownedStatus,'CLOSED');
  const samples=[first,second].map(r=>({sampleId:r.sampleId,observedAt:r.observedAt,latestClosedAt:r.latestClosedAt,attemptKey:f.attemptKey,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[]})),closed={...f.record,status:'CLOSED',history:[...f.record.history,{proof:{kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:f.attemptKey,status:'CLOSED',nativeOrderId:'101',closedVerified:true,attributionVerified:true,accountEvidence:{provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:f.expected.nativeAccountId},closureSamples:samples}}]};
  assert.equal((await f.run('release_closed',{record:{...f.record,status:'CLOSED'}})).status,'BLOCKED');assert.equal((await f.run('release_closed',{record:closed})).status,'NATIVE_USER_CLOSED_RELEASED');assert.equal(marketActions(f).length,1);
});

test('manual user risk controls after dispatch revoke no entry lease but do not veto exact fill and closure reconciliation',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();
  f.trusted();const fill=await f.run('reconcile');assert.equal(fill.status,'NATIVE_USER_OWNED_STATE_VERIFIED',JSON.stringify(fill));assert.equal(fill.ownedStatus,'FILLED');assert.equal(fill.nativeOrderId,'101');assert.equal(fill.trustedInputAfterDispatch.count,1);
  f.trusted();f.setClosed();f.advance(1001);const first=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED');assert.equal(first.trustedInputAfterDispatch.count,2);f.advance(100);f.trusted();f.advance(1001);const second=await f.run('reconcile');assert.equal(second.ownedStatus,'CLOSED');assert.equal(second.trustedInputAfterDispatch.count,3);assert.equal(marketActions(f).length,1);
});

test('trusted post-dispatch interaction cannot turn ambiguous native fill candidates into ownership',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();f.data.history.push({...f.data.history[0],id:'104'});f.trusted();const r=await f.run('reconcile');assert.equal(r.status,'UNKNOWN');assert.equal(r.fillVerified,false);assert.equal(marketActions(f).length,1);
});

test('the user position editor does not gate chart Market reconciliation while exact contract mapping remains required',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();
  const query=f.panel.querySelectorAll;f.panel.querySelectorAll=s=>s==='[data-name="position-panel"]'?[f.panel]:query(s);f.trusted();
  const r=await f.run('reconcile');assert.equal(r.status,'NATIVE_USER_OWNED_STATE_VERIFIED',JSON.stringify(r));assert.equal(r.ownedStatus,'FILLED');assert.equal(marketActions(f).length,1);
  f.mapping.attrs.title='No contract mapping';const missing=await f.run('reconcile');assert.equal(missing.status,'UNKNOWN');assert.deepEqual(missing.reasonCodes,['NATIVE_USER_EXACT_DATED_CONTRACT_MAPPING_REQUIRED']);assert.equal(marketActions(f).length,1);
});

test('routine native health checks never switch account tabs or turn cached flat state into fresh inventory proof',async()=>{
  const f=fixture(),inspection=await f.run('inspect');assert.equal(inspection.flat,true);assert.equal(inspection.inventoryRead,true);assert.ok(f.actions.some(x=>x.startsWith('TAB:')));
  f.actions.length=0;f.data.positions=[{symbol:'CME_MINI:NQZ2026',side:'Long',qty:'1',avgPrice:'28,840.50',id:'90'}];
  for(let i=0;i<10;i++){const health=await f.run('read_connection');assert.equal(health.status,'NATIVE_USER_CONNECTION_VERIFIED',JSON.stringify(health));assert.equal(health.readOnly,true);assert.equal(health.inventoryRead,false);assert.equal(health.flat,false);assert.equal(health.positionsComplete,false);assert.equal(health.workingOrdersComplete,false);assert.equal(health.inventoryProofKind,'NATIVE_ACCOUNT_INVENTORY_NOT_READ_BY_HEALTH_CHECK');}
  assert.deepEqual(f.actions,[]);assert.equal((await f.run('prepare')).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
});

test('virtualized inactive tabs cannot strand an attributed fill after the mounted position closes, and steady checks do not flicker',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),account=f.f.document.querySelectorAll('[aria-label="Account manager"]')[0],original=account.querySelectorAll;
  account.querySelectorAll=s=>{const m=/^table\[role="grid"\]\[data-name="Paper\.(positions|orders|history)-table"\]$/.exec(s);if(m&&original(`[role="tab"][id="${m[1]}"]`)[0]?.getAttribute('aria-selected')!=='true')return [];return original(s);};
  const p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();assert.equal((await f.run('reconcile')).ownedStatus,'FILLED');f.actions.length=0;
  for(let i=0;i<20;i++)assert.equal((await f.run('reconcile')).status,'NATIVE_USER_RECONCILIATION_PENDING');assert.deepEqual(f.actions,[]);
  f.setClosed();const first=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED',JSON.stringify(first));assert.equal(first.positionsComplete,true);assert.equal(first.workingOrdersComplete,true);const second=await f.run('reconcile');assert.equal(second.ownedStatus,'CLOSED');assert.notEqual(first.sampleId,second.sampleId);assert.ok(f.actions.some(x=>x.startsWith('TAB:')));assert.equal(marketActions(f).length,0);
});

test('retained Filled and Cancelled rows are history rather than working exposure, while active or unknown statuses still prevent flat',async()=>{
  for(const status of ['Filled','Cancelled','Rejected','Expired','Working','Inactive','Pending','Partially Filled','UNRECOGNIZED']){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.data.orders=[{symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Take Profit',qty:'1',status,id:'103'}];
    const r=await f.run('inspect');
    if(status==='UNRECOGNIZED'){assert.equal(r.status,'BLOCKED');assert.ok(r.reasonCodes.includes('NATIVE_USER_ORDER_STATUS_UNVERIFIED'));}
    else {assert.equal(r.status,'NATIVE_USER_CONNECTION_VERIFIED',JSON.stringify(r));assert.equal(r.flat,['Filled','Cancelled','Rejected','Expired'].includes(status),status);assert.equal(r.workingOrdersComplete,true);assert.equal(r.workingOrders.length,r.flat?0:1);}
    assert.deepEqual(marketActions(f),[]);
  }
});

test('the observed retained terminal-order shape closes an owned Paper entry only after fresh visible inventory reads',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled({brackets:true});assert.equal((await f.run('reconcile')).ownedStatus,'FILLED');f.setClosed();
  f.data.orders=[{symbol:'CME_MINI:NQZ2026',side:'Buy',type:'Market',qty:'1',avgPrice:'28,840.50',status:'Filled',id:'101'},{symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Stop Loss',qty:'1',status:'Cancelled',id:'102'},{symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Take Profit',qty:'1',avgPrice:'28,845.50',status:'Filled',id:'103'}];
  const first=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED',JSON.stringify(first));assert.deepEqual(first.workingOrders,[]);assert.equal(first.nativeWorkingOrderRows.length,3);assert.equal(first.nativeOrderId,'101');const second=await f.run('reconcile');assert.equal(second.ownedStatus,'CLOSED');assert.notEqual(first.sampleId,second.sampleId);assert.equal(marketActions(f).length,1);
});

test('twenty steady owned-entry checks and price or PnL changes cause no account-tab navigation or repeated proof',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();const fill=await f.run('reconcile');assert.equal(fill.ownedStatus,'FILLED');f.actions.length=0;
  for(let i=0;i<20;i++){f.data.positions[0].lastPrice=String(28840+i);f.data.positions[0].pl=String(i*5);f.advance(200);const r=await f.run('reconcile');assert.equal(r.status,'NATIVE_USER_RECONCILIATION_PENDING',JSON.stringify(r));assert.equal(r.inventoryRead,false);assert.equal(r.inventoryFresh,false);assert.equal(r.ownedStateChanged,false);assert.equal(r.intentKey,f.attemptKey);assert.deepEqual(r.sourceBinding,f.sourceBinding);assert.equal(r.sampleId,undefined);assert.equal(r.positionsComplete,undefined);}
  assert.deepEqual(f.actions,[]);
  f.setClosed();const first=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED');assert.ok(f.actions.some(x=>x.startsWith('TAB:')));f.actions.length=0;f.advance(100);const second=await f.run('reconcile');assert.equal(second.ownedStatus,'CLOSED');assert.notEqual(second.sampleId,first.sampleId);assert.ok(f.actions.some(x=>x.startsWith('TAB:')));
});

test('manual input waits for one second of quiet before one transition-triggered inventory scan',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();await f.run('reconcile');f.actions.length=0;f.trusted();f.setClosed();
  const quiet=await f.run('reconcile');assert.equal(quiet.status,'NATIVE_USER_RECONCILIATION_PENDING');assert.deepEqual(quiet.reasonCodes,['NATIVE_USER_WAITING_FOR_USER_INPUT_QUIET']);assert.deepEqual(f.actions,[]);
  f.advance(999);assert.equal((await f.run('reconcile')).status,'NATIVE_USER_RECONCILIATION_PENDING');assert.deepEqual(f.actions,[]);f.advance(2);const closed=await f.run('reconcile');assert.equal(closed.ownedStatus,'CLOSED');assert.ok(f.actions.some(x=>x.startsWith('TAB:')));
});

test('unavailable passive mounted table structure stays pending without using hidden rows as closure proof',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();await f.run('reconcile');f.actions.length=0;const query=f.f.document.querySelectorAll('[aria-label="Account manager"]')[0].querySelectorAll;
  const account=f.f.document.querySelectorAll('[aria-label="Account manager"]')[0];account.querySelectorAll=s=>s.startsWith('table[role="grid"]')?[]:query(s);f.setClosed();const r=await f.run('reconcile');assert.equal(r.status,'NATIVE_USER_RECONCILIATION_PENDING');assert.deepEqual(r.reasonCodes,['NATIVE_USER_PASSIVE_STRUCTURE_UNAVAILABLE']);assert.equal(r.closedVerified,undefined);assert.equal(r.sampleId,undefined);assert.deepEqual(f.actions,[]);
});

function blockedReceipt(f,r){f.record.reservedAt=f.f.context.Date.now();return {phase:'NATIVE_SUBMISSION_REPLY',attemptKey:f.attemptKey,eventId:f.record.intentBinding.signal.eventId,observedAtReceiver:f.record.reservedAt,result:r,measurementAnchor:{sourceObservation:{sourceDocumentTimeOrigin:f.f.context.performance.timeOrigin}}};}

test('a private pre-gesture rejection proves non-submission while preserving the rejected event and never clicks Market',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();const p=await prepared(f);p.connection.status='PAPER_USER_CONNECTION_VERIFIED';const rejected=await f.run('submit',{userStarted:true,nativePrepared:p});assert.equal(rejected.status,'BLOCKED');assert.equal(rejected.submitted,false);assert.ok(rejected.nonSubmissionReceiptId);const receipt=blockedReceipt(f,rejected),proof=await f.run('verify_not_submitted',{receipt});assert.equal(proof.status,'NOT_SUBMITTED',JSON.stringify(proof));assert.equal(proof.noOrderVerified,true);assert.equal(proof.binding.quantity,1);assert.equal(proof.nonSubmissionBasis,'PRIVATE_PRE_GESTURE_REJECTION_AND_FRESH_FLAT_ACCOUNT');assert.deepEqual(marketActions(f),[]);
});

test('reviewed legacy rejection is Paper-only, exact-document, exact-event and cannot erase a consumed entry',async()=>{
  const changes=[()=>{},f=>{f.expected.provider='TRADOVATE';},f=>{f.receipt.measurementAnchor.sourceObservation.sourceDocumentTimeOrigin++;},f=>{f.receipt.result.reasonCodes=['OTHER'];},f=>{f.receipt.attemptKey+='other';},f=>{f.receipt.result.submitted=true;},f=>{f.record.history.push({status:'FILLED'});},f=>{f.receipt.observedAtReceiver+=10001;}];
  for(let i=0;i<changes.length;i++){const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();f.receipt=blockedReceipt(f,{kind:'NATIVE_USER_MARKET_RESULT_V1',status:'BLOCKED',reasonCodes:['NATIVE_USER_PRIVATE_NATIVE_LEASE_REQUIRED'],submitted:false,ordersCreated:false});changes[i](f);const r=await f.run('verify_not_submitted',{receipt:f.receipt,operatorReviewedExport:true});assert.equal(r.status,i===0?'NOT_SUBMITTED':'BLOCKED',JSON.stringify(r));assert.deepEqual(marketActions(f),[]);}
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();const p=await prepared(f);await f.run('submit',{userStarted:true,nativePrepared:p});const receipt=blockedReceipt(f,{kind:'NATIVE_USER_MARKET_RESULT_V1',status:'BLOCKED',reasonCodes:['NATIVE_USER_PRIVATE_NATIVE_LEASE_REQUIRED'],submitted:false,ordersCreated:false});assert.equal((await f.run('verify_not_submitted',{receipt,operatorReviewedExport:true})).status,'BLOCKED');assert.equal(marketActions(f).length,1);
});


test('native lease rejection identifies transport mutation separately from expiry or trusted user interruption without dispatch',async()=>{
  for(const mode of ['prepared','expired','intervention']){const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();const p=await prepared(f);if(mode==='prepared')p.connection.status='PAPER_USER_CONNECTION_VERIFIED';if(mode==='expired')f.advance(751);if(mode==='intervention')f.trusted();const r=await f.run('submit',{nativePrepared:p});assert.equal(r.status,'BLOCKED');assert.equal(r.nativeBoundaryRevision,'native-chart-market-6');assert.equal(r.submitted,false);const checks=r.leaseDiagnostic.checks;assert.equal(checks.present,mode!=='intervention');if(mode==='prepared'){assert.equal(checks.prepared,false);assert.deepEqual(r.leaseDiagnostic.preparedDifferingKeys,['connection']);assert.deepEqual(r.leaseDiagnostic.connectionDifferingKeys,['status']);assert.equal(checks.performanceTime,true);}if(mode==='expired')assert.equal(checks.performanceTime,false);if(mode==='intervention')assert.equal(r.leaseDiagnostic.lastRevocation,'TRUSTED_NATIVE_DOCUMENT_INPUT');assert.deepEqual(marketActions(f),[]);}
});


test('the opaque chart preparation survives a transport that omits null optional fields, without changing preset values or weakening lease checks',async()=>{
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});f.setWelcome();const p=await prepared(f);
  assert.equal(Object.hasOwn(p,'presetApplication'),false,'chart presets have no ticket-application result to transport');
  const transported=JSON.parse(JSON.stringify(p,(_key,value)=>value===null?undefined:value));
  const r=await f.run('submit',{nativePrepared:transported});assert.equal(r.status,'NATIVE_USER_SUBMITTED_UNCONFIRMED',JSON.stringify(r));assert.equal(r.submitted,true);assert.equal(marketActions(f).length,1);
  assert.equal(r.protectionVerified,false);assert.equal(r.nativePreset.inputValuesSetByDriver,false);
});


function addFillClock(f,text='14:00:02 UTC+2'){const doc=f.f.document,old=doc.querySelectorAll.bind(doc),clock=new f.f.canvas.constructor({'data-name':'time-zone-menu'},text);doc.querySelectorAll=s=>s==='button[data-name="time-zone-menu"]'?[clock]:old(s);return clock;}
test('read-only Paper inspection exports actual typed closing time and fill price with explicit native timezone',async()=>{const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);f.data.history[0].closeDate='2026-11-14 14:00:01';const r=await f.run('inspect');assert.equal(r.status,'NATIVE_USER_CONNECTION_VERIFIED');assert.equal(r.nativeFillRecords.length,1);assert.equal(r.nativeFillRecords[0].filledAt,Date.UTC(2026,10,14,12,0,1));assert.equal(r.nativeFillRecords[0].price,28000);assert.equal(r.nativeFillRecords[0].timestampField,'closeDate');assert.equal(r.nativeFillRecords[0].timestampPrecisionMs,1000);assert.deepEqual(marketActions(f),[]);});
test('missing closing time or ambiguous/invalid timezone never substitutes placing/observation time and does not block trading readiness',async()=>{for(const mode of ['missing-close','missing-clock','invalid-clock']){const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});if(mode!=='missing-clock')addFillClock(f,mode==='invalid-clock'?'14:00:02 UTC+2:99':'14:00:02 UTC+2');if(mode!=='missing-close')f.data.history[0].closeDate='2026-11-14 14:00:01';const r=await f.run('inspect');assert.equal(r.status,'NATIVE_USER_CONNECTION_VERIFIED');assert.equal(r.nativeFillRecords.length,0);assert.deepEqual(marketActions(f),[]);}});

test('first attributed Paper fill includes the same actual native price/time without waiting for its candle to close',async()=>{const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);const p=await prepared(f);assert.equal((await f.run('submit',{nativePrepared:p})).submitted,true);f.setFilled();f.data.history[0].closeDate='2026-11-14 14:00:01';const r=await f.run('reconcile');assert.equal(r.ownedStatus,'FILLED');assert.equal(r.nativeFill.nativeOrderId,r.nativeOrderId);assert.equal(r.nativeFill.price,r.entry);assert.equal(r.nativeFill.filledAt,Date.UTC(2026,10,14,12,0,1));});


test('a private Paper Market fill that closes before the first position read is attributed without fabricating an open position',async()=>{const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);const p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();f.data.history[0].closeDate='2026-11-14 14:00:01';f.setClosed();const first=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED',JSON.stringify(first));assert.equal(first.fillVerified,true);assert.equal(first.closedVerified,true);assert.deepEqual(first.positions,[]);assert.deepEqual(first.workingOrders,[]);assert.equal(first.nativeFill.price,28840.5);assert.match(first.ownershipBasis,/NEW_TYPED_TIMED_FILL/);const second=await f.run('reconcile');assert.equal(second.ownedStatus,'CLOSED');assert.notEqual(second.sampleId,first.sampleId);assert.ok(second.observedAt>first.observedAt);assert.equal(marketActions(f).length,1);});
test('fast-completion attribution rejects manual native intervention, multiple fills, wrong timestamps and remaining working orders',async()=>{for(const mode of ['input','multiple','late','working']){const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);const p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();f.data.history[0].closeDate='2026-11-14 14:00:01';f.setClosed();if(mode==='input')f.trusted();if(mode==='multiple')f.data.history.unshift({...f.data.history[0],id:'999'});if(mode==='late')f.data.history[0].closeDate='2026-11-14 14:05:00';if(mode==='working')f.data.orders=[{symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Limit',qty:'1',status:'working',id:'999'}];const r=await f.run('reconcile');assert.equal(r.status,'UNKNOWN',mode+JSON.stringify(r));assert.equal(r.fillVerified,false);assert.equal(marketActions(f).length,1);}});
test('new panel observation session performs one fresh reconciliation and retains anti-flicker behavior on subsequent steady reads',async()=>{const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});const p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();await f.run('reconcile');f.actions.length=0;f.sourceBinding.sessionId='new-panel-source-observation';assert.equal((await f.run('reconcile')).ownedStatus,'FILLED');assert.ok(f.actions.some(a=>a.startsWith('TAB:')));f.actions.length=0;for(let i=0;i<8;i++)assert.equal((await f.run('reconcile')).inventoryRead,false);assert.deepEqual(f.actions,[]);});

test('explicit review of an exact original dispatch recovers a completed Paper fill after later native interaction, without another entry',async()=>{
  for(const mode of ['valid','missing-review','wrong-order','wrong-origin','wrong-event','multiple']){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);const p=await prepared(f),submitted=await f.run('submit',{nativePrepared:p});f.setFilled();f.data.history[0].closeDate='2026-11-14 14:00:01';f.setClosed();f.trusted();
    const pending=await f.run('reconcile');assert.equal(pending.status,'UNKNOWN');
    const receipt=blockedReceipt(f,submitted),args={operatorReviewedExport:true,nativeOrderId:'101',receipt};
    if(mode==='missing-review')args.operatorReviewedExport=false;if(mode==='wrong-order')args.nativeOrderId='999';if(mode==='wrong-origin')receipt.result.documentTimeOrigin++;if(mode==='wrong-event')receipt.eventId+='other';if(mode==='multiple')f.data.history.unshift({...f.data.history[0],id:'999'});
    const reviewed=await f.run('review_closed',args);assert.equal(reviewed.ownedStatus==='CLOSED',mode==='valid',mode+JSON.stringify(reviewed));
    if(mode==='valid'){assert.equal(reviewed.fillVerified,true);assert.deepEqual(reviewed.positions,[]);assert.match(reviewed.ownershipBasis,/OPERATOR_REVIEWED/);assert.equal((await f.run('reconcile')).ownedStatus,'CLOSED');}
    assert.equal(marketActions(f).length,1);
  }
});

test('a completed-before-position fill keeps supplying distinct closure reads until the consumer durably acknowledges CLOSED',async()=>{const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);const p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();f.data.history[0].closeDate='2026-11-14 14:00:01';f.setClosed();const samples=[];for(let i=0;i<4;i++){const r=await f.run('reconcile');assert.equal(r.ownedStatus,'CLOSED');samples.push(r.sampleId);}assert.equal(new Set(samples).size,4);assert.equal(marketActions(f).length,1);f.record.status='CLOSED';f.actions.length=0;assert.equal((await f.run('reconcile')).inventoryRead,false);assert.deepEqual(f.actions,[]);});


test('SL, TP and manual closures keep producing fresh native samples until durable consumer acknowledgment, including after lost samples',async()=>{
  for(const exit of ['SL','TP','MANUAL']){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled({brackets:true});assert.equal((await f.run('reconcile')).ownedStatus,'FILLED');f.record.status='FILLED';f.setClosed();
    const orders=[{symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Stop Loss',qty:'1',status:exit==='SL'?'Filled':'Cancelled',id:'102'},{symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Take Profit',qty:'1',status:exit==='TP'?'Filled':'Cancelled',id:'103'}];
    if(exit==='MANUAL'){orders.push({symbol:'CME_MINI:NQZ2026',side:'Sell',type:'Market',qty:'1',avgPrice:'28,841.00',status:'Filled',id:'104'});f.trusted();f.advance(1001);}
    f.data.orders=orders;const ids=[];
    for(let i=0;i<5;i++){f.advance(100);const closed=await f.run('reconcile');assert.equal(closed.ownedStatus,'CLOSED',exit+JSON.stringify(closed));assert.deepEqual(closed.workingOrders,[]);ids.push(closed.sampleId);}
    assert.equal(new Set(ids).size,5);assert.equal(marketActions(f).length,1);f.record.status='CLOSED';f.actions.length=0;assert.equal((await f.run('reconcile')).inventoryRead,false);assert.deepEqual(f.actions,[]);
  }
});

test('manual interaction strictly after the native fill second does not strand a rapidly closed Paper fill; earlier interaction remains ambiguous',async()=>{
  for(const delay of [0,200,2500,4500]){
    const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'});addFillClock(f);const p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled();f.data.history[0].closeDate='2026-11-14 14:00:01';f.setClosed();f.advance(delay);f.trusted();
    const r=await f.run('reconcile');assert.equal(r.ownedStatus==='CLOSED',delay>=2500,JSON.stringify({delay,r}));assert.equal(marketActions(f).length,1);
    if(delay>=2500){assert.equal(r.fillVerified,true);assert.ok(r.trustedInputAfterDispatch.firstAt>=r.nativeFill.filledAt+r.nativeFill.timestampPrecisionMs);}
  }
});


test('observed tooltip-free chart quantity uses its exact unique native structure; missing or ambiguous identity still blocks',async()=>{
 for(const mode of ['observed','no-parent','wrong-class','duplicate-value','invalid-number']){
  const f=fixture({provider:'TRADINGVIEW_PAPER',environment:'DEMO'}),E=f.f.canvas.constructor;
  delete f.quickQty.attrs.title;f.quickQty.attrs.class='apply-common-tooltip button-OH8c8Nc3 qty-OH8c8Nc3';
  f.quickQty.parentElement=new E({class:'spreadQtyWrapper-OH8c8Nc3'});const span=new E({},'1');f.quickQty.querySelectorAll=s=>s==='span'?(mode==='duplicate-value'?[span,new E({},'1')]:[span]):[];
  if(mode==='no-parent')f.quickQty.parentElement=null;if(mode==='wrong-class')f.quickQty.attrs.class='other';if(mode==='invalid-number')f.qty.value='1.5';
  const result=await f.run('inspect');assert.equal(result.status,mode==='observed'?'NATIVE_USER_CONNECTION_VERIFIED':'BLOCKED',mode+JSON.stringify(result));
  if(mode==='observed'){assert.equal(result.quantity,1);assert.equal(result.nativePreset.sideNames.LONG,'USER LONG MARKET');assert.equal(result.nativePreset.inputValuesSetByDriver,false);}assert.deepEqual(marketActions(f),[]);
 }
});
