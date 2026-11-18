import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {paperUserMarketUiCommand} from '../paper-user-market-ui.mjs';
import {makeWindowFixture,makeBootstrap,encodeFrame,recalculateChecksums,rows,SCALAR_BASE} from './window-reader-fixture.mjs';

// Synthetic public-UI component contracts ONLY. No real tab/account, market
// signal, browser gesture or order is involved in these positive tests.
function fixture({direction='LONG',quantity=1,knownDelay=145}={}){
  const start=Date.UTC(2026,10,14,12),bootstrap=makeBootstrap(),f=makeWindowFixture({bootstrap}),Element=f.canvas.constructor,doc=f.document;
  Object.defineProperty(Element.prototype,'isConnected',{configurable:true,get(){return this.connected!==false;}});
  Element.prototype.getClientRects=function(){return this.visible?[this.getBoundingClientRect()]:[];};
  const node=(attrs={},text='')=>{const n=new Element(attrs,text);n.tagName='DIV';n.disabled=false;return n;};
  const actions=[],listeners=new Map(),expected={researchUrl:'https://www.tradingview.com/chart/ARROWRV1/',sourceTabId:42,nativeAccountId:'Paper local component',accountRevision:1,selectionKey:'selection-1',allowResearchLiveMultiChart:true};
  Object.assign(f.context.location,{origin:'https://www.tradingview.com',href:expected.researchUrl,pathname:'/chart/ARROWRV1/'});
  f.context.URL=URL;f.context.crypto=webcrypto;f.context.requestAnimationFrame=cb=>{f.advance(10);cb(f.context.performance.now());};f.context.setTimeout=(cb,ms)=>setTimeout(()=>{f.advance(ms);cb();},0);f.context.clearTimeout=clearTimeout;
  doc.addEventListener=(type,fn)=>{listeners.set(type,fn);};
  const layout=node({'aria-label':'Logged in as test Active layout: Arrow OHLC Live Verification'}),interval=node({'data-value':'1'}),providers=[node({},'Paper Trading'),node({},'Paper Trading')],account=node({'aria-label':'Account manager'}),selector=node({'data-qa-id':'account-selector'}),name=node({},expected.nativeAccountId),panel=node({'aria-label':'Trading panel'});
  selector.querySelectorAll=s=>s==='[class*="accountName-"]'?[name]:[];
  const contract=node({title:'NQZ2026'}),mapping=node({title:'Continuous futures is used for charting, but the NQZ2026 contract will be used for order placement.'}),logo=node({src:'https://static.tradingview.com/static/bundles/paper.e1fda77151c371306993.svg'}),dom=node({role:'radio','aria-checked':'true'},'DOM'),order=node({role:'radio','aria-checked':'false'},'Order');
  const nativeNodes=new Map();for(const [key,text]of [['buy-market-dom','Buy Mkt'],['sell-market-dom','Sell Mkt'],['cancel-all-buy-orders',''],['cancel-all-sell-orders',''],['position-DOM','—'],['switch-pl-view','—']])nativeNodes.set(key,node({'data-qa-id':key},text));
  nativeNodes.get('cancel-all-buy-orders').disabled=true;nativeNodes.get('cancel-all-sell-orders').disabled=true;
  const qty=node({id:'dom-quantity-input','data-qa-id':'ui-lib-Input-input qty-dom-input'});qty.tagName='INPUT';qty.value=String(quantity);qty.readOnly=false;
  const prices=[28840.25,28840.5,28840.75].map((price,index)=>node({'data-qa-id':`dom-cell-${index}-price`,class:index===1?'x__value--highlighted-y':'x'},String(price)));
  for(const side of ['buy','sell'])nativeNodes.get(side+'-market-dom').click=()=>{actions.push(side==='buy'?'BUY_MARKET':'SELL_MARKET');};
  panel.querySelectorAll=s=>s==='[role="radio"]'?[order,dom]:s==='[title]'?[contract,mapping]:s==='img[src]'?[logo]:s==='[aria-label="Order ticket"],[data-name="position-panel"]'?[]:s==='input#dom-quantity-input[data-qa-id~="qty-dom-input"]'?[qty]:s==='[data-qa-id^="dom-cell-"]'?prices:/^\[data-qa-id="(.+)"\]$/.test(s)?[nativeNodes.get(/^\[data-qa-id="(.+)"\]$/.exec(s)[1])].filter(Boolean):[];
  let active='positions';const tabs=['positions','orders','history'].map(id=>{const n=node({id,role:'tab','aria-selected':id===active?'true':'false'},id);n.click=()=>{actions.push('TAB:'+id);active=id;for(const t of tabs)t.attrs['aria-selected']=String(t.attrs.id===id);};return n;});
  const statusTabs=[['orderstatustatus-all','All 1All 1',true],['orderstatus-filled','Filled 1Filled 1',false],['orderstatus-cancelled','CancelledCancelled',false],['orderstatus-rejected','RejectedRejected',false]].map(([id,text,on])=>node({id,role:'tab','aria-selected':String(on)},text));
  const headers={positions:[['symbol','Symbol'],['side','Side'],['qty','Quantity'],['avgPrice','Avg fill price'],['takeProfit','Take profit'],['stopLoss','Stop loss'],['lastPrice','Last price'],['pl','Unrealized PnL'],['plPercent','Unrealized PnL %'],['tradeValue','Trade value'],['marketValue','Market value'],['leverage','Leverage'],['usedMargin','Margin'],['expirationDate','Expiration date'],['settings','']],
    orders:[['symbol','Symbol'],['side','Side'],['type','Type'],['qty','Quantity'],['limitPrice','Limit price'],['stopPrice','Stop price'],['avgPrice','Fill price'],['takeProfit','Take profit'],['stopLoss','Stop loss'],['instruction','Instruction'],['status','Status'],['placingTime','Placing time'],['id','Order ID'],['exitLevelId','Level ID'],['expiry','Expiry'],['leverage','Leverage'],['usedMargin','Margin'],['settings','']],
    history:[['symbol','Symbol'],['side','Side'],['type','Type'],['qty','Quantity'],['limitPrice','Limit price'],['stopPrice','Stop price'],['avgPrice','Fill price'],['status','Status'],['commission','Commission'],['placingTime','Placing time'],['closeDate','Closing time'],['id','Order ID'],['exitLevelId','Level ID'],['leverage','Leverage'],['usedMargin','Margin'],['settings','']]};
  const data={positions:[],orders:[],history:[{symbol:'CME_MINI:NQZ2026',side:'Buy',type:'Market',qty:'1',avgPrice:'28,000.00',status:'filled',id:'100',placingTime:'2026-11-13 12:00:00'}]};
  let emptyQa=true,extraFilter=false,partialRow=false;
  const grids={};for(const kind of ['positions','orders','history']){
    const grid=node({'data-name':'Paper.'+kind+'-table',role:'grid'}),body=node(),head=headers[kind].map(([id,text])=>node({id},text));
    const builtRows=()=>{
      if(!data[kind].length){const row=node(),cell=node({colspan:String(head.length)},'Nothing to show yet. Your account activity will appear here.');row.querySelectorAll=s=>s==='td'?[cell]:[];return[row];}
      return data[kind].map(values=>{const row=node(kind==='positions'?{}:{'data-row-id':values.id}),cells=head.map(h=>node({},values[h.attrs.id]??''));row.querySelectorAll=s=>s==='td'?(partialRow?cells.slice(1):cells):[];return row;});
    };
    Object.defineProperty(body,'textContent',{configurable:true,get:()=>data[kind].length?data[kind].map(x=>Object.values(x).join(' ')).join(' '):'Nothing to show yet. Your account activity will appear here.'});
    body.querySelectorAll=s=>s==='tr'?builtRows():s==='[data-qa-id="account-manager-tab-empty-state"]'&&!data[kind].length&&emptyQa?[node({'data-qa-id':'account-manager-tab-empty-state'})]:[];
    grid.querySelector=s=>s==='tbody'?body:null;grid.querySelectorAll=s=>s==='thead th'?head:[];grids[kind]={grid,body,head};
  }
  account.querySelectorAll=s=>s==='[data-qa-id="account-selector"]'?[selector]:s==='[role="tab"][aria-selected="true"]'?tabs.filter(t=>t.attrs['aria-selected']==='true'):s==='[role="progressbar"]'?[]:s==='[role="tab"],[role="combobox"],input'?[...tabs,...(active==='history'?statusTabs:[]),...(extraFilter?[node({role:'combobox'})]:[])]:/^\[role="tab"\]\[id="(.+)"\]$/.test(s)?tabs.filter(t=>t.attrs.id===/^\[role="tab"\]\[id="(.+)"\]$/.exec(s)[1]):/^table\[data-name="Paper\.(.+)-table"\]$/.test(s)?(/^table\[data-name="Paper\.(.+)-table"\]$/.exec(s)[1]===active?[grids[active].grid]:[]):[];
  const oldGlobal=doc.querySelectorAll.bind(doc),oldStudy=f.study.querySelectorAll.bind(f.study);
  f.study.querySelectorAll=s=>/^\[data-test-id-value-title="(.+)"\]$/.test(s)?f.labelNodes.filter(n=>n.attrs['data-test-id-value-title']===/^\[data-test-id-value-title="(.+)"\]$/.exec(s)[1]):oldStudy(s);
  doc.canvases=[node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})];
  doc.querySelectorAll=s=>s==='[aria-label^="Logged in as"]'?[layout]:s==='#header-toolbar-intervals [aria-checked="true"]'?[interval]:s==='#header-toolbar-replay'?[f.replay]:s==='[role="dialog"],[aria-modal="true"]'||s==='[data-qa-id="replay_trading"]'?[]:s==='button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]'?providers:s==='[aria-label="Account manager"]'?[account]:s==='[aria-label="Trading panel"]'?[panel]:oldGlobal(s);
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
  const eventId=`technical:guide-technical-decision-1:CME_MINI:NQ1!:1:${start}:${direction}`,setup='CME_MINI:NQ1!:1:component-setup',checks=['STRUCTURE','KNOWN_LOCATION'].map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),binding={accountIdentity:{provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:expected.nativeAccountId},adapterId:'tradingview-paper-market-ui',accountRevision:1,selectionKey:expected.selectionKey,sourceIdentity:JSON.stringify([expected.researchUrl,42,'CME_MINI:NQ1!','1']),sourceRunId:bootstrap.runId,symbol:'NQZ2026',quantity};
  const permit={kind:'EXECUTION_LIFECYCLE_ENTRY_PERMIT',version:'execution-lifecycle-1',id:'component-permit',generation:1,sessionId:'component-session',binding,signal:{eventId,direction,symbol:'NQZ2026',sourceIdentity:binding.sourceIdentity,sourceRunId:bootstrap.runId,confirmedAt:start,confirmationBarCloseTime:start,observedAt:f.context.Date.now(),status:'CONFIRMED',synthetic:false,testOnly:false},issuedAt:f.context.Date.now(),expiresAt:f.context.Date.now()+1900,scope:'ONE_LOCAL_ATTEMPT_CONTEXT_NOT_BROKER_AUTHORIZATION',orderAuthorizationGranted:false};
  const approvalProof={engineDefinitionVersion:'guide-signals-5',technicalDecisionVersion:'guide-technical-decision-1',approvalPolicy:'guide_scenarios_v1',eventId,direction,asOfTime:start,confirmedAt:start+knownDelay,analysisAsOfTime:start+knownDelay,confirmationBarCloseTime:start,confirmationPolicy:'later_close_beyond_setup',roleReversalEnabled:true,supplyDemandEnabled:true,sourceEventIds:[setup],requiredChecks:checks,strategyProofs:[{profileId:'ROLE_REVERSAL_RETEST',requiredCheckIds:['STRUCTURE','KNOWN_LOCATION'],requiredChecks:checks,sourceEventIds:[setup]}]};
  const technicalEntryWitness={kind:'CURRENT_LIVE_QUOTE_PRESERVES_FROZEN_SETUP',direction,quote:28840.5,asOfTime:start,sourceEventIds:[setup],eligibleSetupIds:[setup],pricesAdjusted:false,setups:[{eventId:setup,trigger:direction==='LONG'?28840:28841,structuralInvalidation:direction==='LONG'?28839:28842}]};
  const attemptKey=['execution-attempt-1','TRADINGVIEW_PAPER','DEMO',expected.nativeAccountId,'NQZ2026',eventId].map(encodeURIComponent).join(':'),record={key:attemptKey,status:'UNKNOWN',accountIdentity:binding.accountIdentity,intentBinding:{quantity,binding,signal:permit.signal},history:[{phase:'RESERVED_BEFORE_DISPATCH',status:'UNKNOWN',proof:null}]};
  async function run(action,extra={}){f.context.__paperArgs={action,expected,sourceBinding,permit,attemptKey,approvalProof,technicalEntryWitness,record,...extra};return JSON.parse(JSON.stringify(await vm.runInContext('('+paperUserMarketUiCommand.toString()+')(__paperArgs)',f.context)));}
  function setFilled({brackets=false,entry=28840.5}={}){
    const side=direction==='LONG'?'Buy':'Sell',fill=entry.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    data.history.unshift({symbol:'CME_MINI:NQZ2026',side,type:'Market',qty:String(quantity),avgPrice:fill,status:'filled',id:'101',placingTime:'2026-11-14 14:00:01'});
    data.positions=[{symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Long':'Short',qty:String(quantity),avgPrice:fill}];nativeNodes.get('position-DOM').textContent=(direction==='SHORT'?'−':'')+quantity+' @ '+fill;nativeNodes.get('switch-pl-view').textContent='0 ticks';
    if(brackets){data.orders=[{symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Sell':'Buy',type:'Stop Loss',qty:String(quantity),status:'working',id:'102'},{symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Sell':'Buy',type:'Take Profit',qty:String(quantity),status:'working',id:'103'}];nativeNodes.get(direction==='LONG'?'cancel-all-sell-orders':'cancel-all-buy-orders').disabled=false;}
  }
  function setClosed(){data.positions=[];data.orders=[];nativeNodes.get('position-DOM').textContent='—';nativeNodes.get('switch-pl-view').textContent='—';nativeNodes.get('cancel-all-buy-orders').disabled=true;nativeNodes.get('cancel-all-sell-orders').disabled=true;}
  return {f,expected,permit,sourceBinding,approvalProof,technicalEntryWitness,attemptKey,record,actions,data,qty,providers,name,logo,mapping,grids,statusTabs,nativeNodes,prices,panel,run,setFilled,setClosed,advance:ms=>f.advance(ms),advanceTick(options={}){sequence++;return updateSource(options);},trusted:()=>listeners.get('pointerdown')?.({isTrusted:true}),setEmptyQa:x=>{emptyQa=x;},setFilter:x=>{extraFilter=x;},setPartial:x=>{partialRow=x;}};
}
const marketActions=f=>f.actions.filter(x=>/MARKET/.test(x));
async function prepared(f){const result=await f.run('prepare');assert.equal(result.status,'READY',JSON.stringify(result));return result;}
function fullScreens(f){
  const url='https://www.tradingview.com/chart/ARROWFR1/';f.expected.researchUrl=url;f.sourceBinding.researchUrl=url;
  Object.assign(f.f.context.location,{href:url,pathname:'/chart/ARROWFR1/'});f.f.document.querySelectorAll('[aria-label^="Logged in as"]')[0].attrs['aria-label']='Logged in as test Active layout: Full Screens Live';
  f.permit.binding.sourceIdentity=JSON.stringify([url,42,'CME_MINI:NQ1!','1']);f.permit.signal.sourceIdentity=f.permit.binding.sourceIdentity;return f;
}
function orderFixture({direction='LONG',quantity=1,stopTicks=30,targetTicks=20,initialType='MARKET'}={}){
  const f=fixture({direction,quantity}),Element=f.f.canvas.constructor,node=(attrs={},text='')=>{const n=new Element(attrs,text);n.tagName='DIV';n.disabled=false;return n;},ticket=node({'aria-label':'Order ticket'}),oldPanelQuery=f.panel.querySelectorAll,oldDocumentQuery=f.f.document.querySelectorAll;
  f.expected.executionSurface='ORDER_TICKET_PRESET';f.expected.nativePresetName='ROI MARKET 20/30';
  const radios=[node({role:'radio','aria-checked':'true'},'Order'),node({role:'radio','aria-checked':'false'},'DOM')],favorite=node({'data-qa-id':'favorite-preset-tag-1'},'R'),units=node({'data-qa-id':'quantity-dropdown-types'},'Units'),qty=node({'aria-label':'Units','data-qa-id':'ui-lib-Input-input units-quantity-field-input'});qty.tagName='INPUT';qty.value=String(quantity);qty.readOnly=false;
  const buy=node({'data-name':'side-control-buy',role:'button',class:'buy-knd active-knd'},'Buy 28,840.75'),sell=node({'data-name':'side-control-sell',role:'button',class:'sell-knd'},'Sell 28,840.25'),submit=node({'data-name':'place-and-modify-button'}),types=['Market','Limit','Stop'].map(id=>node({id,role:'tab','aria-selected':String(id.toUpperCase()===initialType)},id));
  const exits={};for(const [key,value,title]of [['stop-loss',stopTicks,'Stop loss ticks'],['take-profit',targetTicks,'Take profit ticks']]){
    const sw=node({'data-qa-id':`order-ticket-${key}-checkbox-bracket`,role:'switch','aria-checked':'true'}),input=node({'data-qa-id':`ui-lib-Input-input order-ticket-${key}-input`}),unit=node({'data-qa-id':`order-ticket-${key}-dropdown-button`},title);sw.tagName='INPUT';sw.checked=true;input.tagName='INPUT';input.value=String(value);input.readOnly=false;exits[key]={sw,input,unit};
  }
  let notices=[],noticeMode='FRESH',extraFavorite=false;
  function updateCaption(){submit.textContent=`${(buy.attrs.class??'').includes('active-')?'Buy':'Sell'} ${qty.value} NQZ2026 ${types.find(n=>n.attrs['aria-selected']==='true')?.textContent.toUpperCase()}`;}
  for(const [side,n,other]of [['Buy',buy,sell],['Sell',sell,buy]])n.click=()=>{f.actions.push('SIDE:'+side);n.attrs.class=side.toLowerCase()+'-knd active-knd';other.attrs.class=side==='Buy'?'sell-knd':'buy-knd';updateCaption();};
  favorite.click=()=>{f.actions.push('APPLY_NATIVE_FAVORITE');types.forEach(n=>n.attrs['aria-selected']=String(n.attrs.id==='Market'));for(const [key,value]of [['stop-loss',stopTicks],['take-profit',targetTicks]]){exits[key].sw.checked=true;exits[key].sw.attrs['aria-checked']='true';exits[key].input.value=String(value);}updateCaption();if(noticeMode==='FRESH'||noticeMode==='WRONG')notices=[node({role:'tooltip'},`Preset "${noticeMode==='WRONG'?'OTHER PRESET':f.expected.nativePresetName}" applied`)];else if(noticeMode==='NONE')notices=[];};
  submit.click=()=>f.actions.push('ORDER_MARKET_'+((buy.attrs.class??'').includes('active-')?'BUY':'SELL'));updateCaption();
  ticket.querySelectorAll=s=>s==='input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]'?[qty]:s==='[data-qa-id="quantity-dropdown-types"]'?[units]:s==='[data-name="side-control-buy"][role="button"]'?[buy]:s==='[data-name="side-control-sell"][role="button"]'?[sell]:s==='[role="tab"][aria-selected="true"]'?types.filter(n=>n.attrs['aria-selected']==='true'):s==='button[data-name="place-and-modify-button"]'?[submit]:s==='button[data-qa-id^="favorite-preset-tag-"]'?[favorite,...(extraFavorite?[node({'data-qa-id':'favorite-preset-tag-2'},'X')]:[])]:s==='button[data-qa-id="favorite-preset-tag-1"]'?[favorite]:(()=>{for(const [key,e]of Object.entries(exits)){if(s===`input[role="switch"][data-qa-id="order-ticket-${key}-checkbox-bracket"]`)return[e.sw];if(s===`input[data-qa-id~="order-ticket-${key}-input"]`)return[e.input];if(s===`button[data-qa-id="order-ticket-${key}-dropdown-button"]`)return[e.unit];}return[];})();
  f.panel.querySelectorAll=s=>s==='[role="radio"]'?radios:s==='[aria-label="Order ticket"]'?[ticket]:s==='[data-name="position-panel"]'?[]:oldPanelQuery(s);
  f.f.document.querySelectorAll=s=>s==='div[role="tooltip"]'?notices:oldDocumentQuery(s);
  return {...f,ticket,orderQty:qty,buy,sell,submit,types,exits,favorite,radios,updateCaption,setNoticeMode:mode=>{noticeMode=mode;},setOldNotice:()=>{notices=[node({role:'tooltip'},`Preset "${f.expected.nativePresetName}" applied`)];},setExtraFavorite:()=>{extraFavorite=true;},
    setProtectedFill(){f.setFilled({brackets:true});const entry=28840.5,sign=direction==='LONG'?1:-1,stop=entry-sign*stopTicks*.25,target=entry+sign*targetTicks*.25;f.data.positions[0].stopLoss=String(stop);f.data.positions[0].takeProfit=String(target);f.data.orders[0].type='Stop';f.data.orders[0].stopPrice=String(stop);f.data.orders[1].type='Limit';f.data.orders[1].limitPrice=String(target);return{entry,stop,target};}};
}

test('Paper inspection reads exact account, live closed source and native quantity without a submission capability',async()=>{
  const f=fixture(),r=await f.run('read_connection');assert.equal(r.status,'PAPER_USER_CONNECTION_VERIFIED');assert.equal(r.nativeAccountId,f.expected.nativeAccountId);assert.equal(r.sourceVerified,true);assert.equal(r.flat,true);assert.equal(r.positionsComplete,true);assert.equal(r.workingOrdersComplete,true);assert.equal(r.quantity,1);assert.equal(r.submitCapabilityCreated,false);assert.equal(r.inventoryProofKind,'NATIVE_PAPER_ACCOUNT_EMPTY_STATE_V1');assert.deepEqual(marketActions(f),[]);
});
test('FULL SCREENS exact source preserves the named native Order preset through one synthetic Paper entry',async()=>{
  const f=fullScreens(orderFixture({quantity:3})),inspect=await f.run('inspect');assert.equal(inspect.status,'PAPER_USER_CONNECTION_VERIFIED',JSON.stringify(inspect));assert.equal(inspect.nativePreset.application.name,'ROI MARKET 20/30');
  const p=await prepared(f);assert.equal(p.quantity,3);assert.equal(p.nativePreset.stop.value,30);assert.equal(p.nativePreset.target.value,20);const sent=await f.run('submit',{nativePrepared:p});assert.equal(sent.status,'PAPER_USER_SUBMITTED_UNCONFIRMED');assert.deepEqual(marketActions(f),['ORDER_MARKET_BUY']);assert.equal(f.orderQty.value,'3');assert.equal(sent.realBrokerOrdersAuthorized,false);
});
test('both supported native source URLs reject the other layout name before an order or preset action',async()=>{
  for(const full of [false,true]){const f=full?fullScreens(orderFixture()):orderFixture();f.f.document.querySelectorAll('[aria-label^="Logged in as"]')[0].attrs['aria-label']='Logged in as test Active layout: '+(full?'Arrow OHLC Live Verification':'Full Screens Live');
    const r=await f.run('prepare');assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['PAPER_USER_EXACT_NQ_MINUTE_SCOPE_REQUIRED']);assert.equal(f.actions.length,0);
  }
});
test('FULL SCREENS cannot turn protocol2 into entry eligibility or permit a Tradovate/PA account',async()=>{
  const legacy=fullScreens(orderFixture()),raw=legacy.advanceTick();raw.ARROW2_PROTOCOL=2;recalculateChecksums(raw);legacy.f.setRaw(raw);
  const r=await legacy.run('prepare');assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['PAPER_USER_COHERENT_SOURCE_RUN_REQUIRED']);assert.deepEqual(marketActions(legacy),[]);assert.equal(legacy.actions.includes('APPLY_NATIVE_FAVORITE'),false);
  const pa=fullScreens(orderFixture());pa.providers.forEach(n=>n.textContent='Tradovate');for(const action of ['inspect','prepare','submit']){const reply=await pa.run(action);assert.equal(reply.status,'BLOCKED');assert.equal(reply.realBrokerOrdersAuthorized,false);}assert.deepEqual(marketActions(pa),[]);
});

test('missing native app empty-state proof never turns empty text into entry eligibility',async()=>{
  const f=fixture();f.setEmptyQa(false);const r=await f.run('prepare');assert.equal(r.status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
});

test('native read retries zero or two highlighted quotes for one RAF and accepts only the subsequent unique healthy quote',async()=>{
  for(const firstCount of [0,2]){
    const f=fixture(),query=f.panel.querySelectorAll,raf=f.f.context.requestAnimationFrame;let reads=0,framesAfterRead=0;
    f.f.context.requestAnimationFrame=cb=>{if(reads)framesAfterRead++;return raf(cb);};
    f.panel.querySelectorAll=s=>{if(s==='[data-qa-id^="dom-cell-"]'){reads++;f.prices.forEach((n,i)=>n.attrs.class=(reads===1?i<firstCount:i===1)?'x__value--highlighted-y':'x');}return query(s);};
    const r=await f.run('prepare');assert.equal(r.status,'READY',JSON.stringify(r));assert.equal(r.connection.nativeControlRead.transientRecovered,true);assert.equal(r.connection.nativeControlRead.attempts,2);assert.equal(framesAfterRead,1);assert.deepEqual(marketActions(f),[]);
  }
});

test('read-only connection does not depend on a display quote highlight and cannot mint an entry lease from it',async()=>{
  for(const highlightCount of [0,2]){
    const f=fixture();f.prices.forEach((n,i)=>n.attrs.class=i<highlightCount?'x__value--highlighted-y':'x');
    const read=await f.run('read_connection');assert.equal(read.status,'PAPER_USER_CONNECTION_VERIFIED',JSON.stringify(read));assert.equal(read.readOnly,true);assert.equal(read.submitCapabilityCreated,false);assert.equal(read.nativeControlRead.quoteRequired,false);assert.equal(read.nativeControlRead.attempts,1);
    assert.equal((await f.run('submit',{nativePrepared:read})).status,'BLOCKED');assert.equal((await f.run('prepare')).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
  }
});

test('persistent ambiguous quotes provide bounded public diagnostics and do not infer a quote or writable controls',async()=>{
  for(const highlightCount of [0,2]){
    const f=fixture();f.prices.forEach((n,i)=>n.attrs.class=i<highlightCount?'x__value--highlighted-y':'x');
    const r=await f.run('prepare');assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['PAPER_USER_NATIVE_CONTROLS_UNVERIFIED']);assert.equal(r.controlDiagnostics.highlightCount,highlightCount);assert.equal(r.controlDiagnostics.quoteValid,false);assert.ok(r.controlDiagnostics.readAttempts>1&&r.controlDiagnostics.readAttempts<=16);assert.ok(r.controlDiagnostics.readElapsedMs<=230);assert.deepEqual(marketActions(f),[]);
  }
  const f=fixture();f.qty.readOnly=true;const r=await f.run('prepare');assert.equal(r.status,'BLOCKED');assert.equal(r.controlDiagnostics.quantityReadOnly,true);assert.deepEqual(marketActions(f),[]);
});

test('trusted intervention during a transient native read aborts instead of retrying a different generation',async()=>{
  const f=fixture(),query=f.panel.querySelectorAll,raf=f.f.context.requestAnimationFrame;let read=false;
  f.panel.querySelectorAll=s=>{if(s==='[data-qa-id^="dom-cell-"]'){read=true;f.prices.forEach(n=>n.attrs.class='x');}return query(s);};
  f.f.context.requestAnimationFrame=cb=>{if(read)f.trusted();return raf(cb);};
  const r=await f.run('prepare');assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['PAPER_USER_NATIVE_CONTEXT_INTERRUPTED']);assert.deepEqual(marketActions(f),[]);
});

test('the final pre-click native read stays synchronous and blocks a new ambiguous quote after a healthy read snapshot',async()=>{
  const f=fixture(),p=await prepared(f),query=f.panel.querySelectorAll;let reads=0;
  f.panel.querySelectorAll=s=>{if(s==='[data-qa-id^="dom-cell-"]'&&++reads===2)f.prices.forEach(n=>n.attrs.class='x');return query(s);};
  const r=await f.run('submit',{nativePrepared:p});assert.equal(r.status,'BLOCKED');assert.equal(r.controlDiagnostics.highlightCount,0);assert.equal(r.controlDiagnostics.readAttempts,undefined);assert.equal(reads,2);assert.deepEqual(marketActions(f),[]);
});

for(const direction of ['LONG','SHORT'])test('synthetic '+direction+' contract submits exactly one observed-quantity Market and requires native history/position fill proof',async()=>{
  const f=fixture({direction,quantity:3}),p=await prepared(f);assert.equal(p.quantity,3);assert.equal(p.connection.sourceVerified,true);assert.ok(p.expiresAt<=f.permit.expiresAt);
  const sent=await f.run('submit',{nativePrepared:p});assert.equal(sent.status,'PAPER_USER_SUBMITTED_UNCONFIRMED');assert.equal(sent.fillVerified,false);assert.deepEqual(marketActions(f),[direction==='LONG'?'BUY_MARKET':'SELL_MARKET']);
  assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');assert.equal(marketActions(f).length,1);
  f.setFilled({brackets:true});const fill=await f.run('reconcile');assert.equal(fill.status,'PAPER_USER_OWNED_STATE_VERIFIED',JSON.stringify(fill));assert.equal(fill.ownedStatus,'FILLED');assert.equal(fill.nativeOrderId,'101');assert.equal(fill.quantity,3);assert.equal(fill.workingOrders.length,2);assert.equal(fill.protectionVerified,false);assert.equal(fill.intentKey,f.attemptKey);assert.equal(f.qty.value,'3');
});

test('late knownAt from a LIVE close is preserved instead of forced to the candle close',async()=>{
  const f=fixture({knownDelay:145});const p=await prepared(f);assert.equal(p.status,'READY');assert.equal(f.approvalProof.confirmedAt-f.permit.signal.confirmedAt,145);
  const bad=fixture();bad.approvalProof.confirmedAt=bad.approvalProof.analysisAsOfTime+1;assert.equal((await bad.run('prepare')).status,'BLOCKED');
  const future=fixture();future.approvalProof.analysisAsOfTime=future.f.context.Date.now()+10000;assert.equal((await future.run('prepare')).status,'BLOCKED');
});

test('LIVE sequence advance and a still-eligible current price do not change the frozen closed approval',async()=>{
  const f=fixture(),p=await prepared(f);f.advanceTick({close:28840.75});f.prices[1].textContent='28840.75';assert.equal((await f.run('submit',{nativePrepared:p})).submitted,true);assert.equal(marketActions(f).length,1);
});

test('a changed closed OHLC, bad checksum or current structural invalidation blocks before the only possible Market gesture',async()=>{
  for(const mode of ['closed','checksum','trigger']){const f=fixture(),p=await prepared(f);if(mode==='closed')f.advanceTick({previousClose:28840.75});if(mode==='checksum')f.advanceTick({corrupt:true});if(mode==='trigger'){f.advanceTick({close:28838.75});f.prices[1].textContent='28838.75';}const r=await f.run('submit',{nativePrepared:p});assert.equal(r.status,'BLOCKED',mode);assert.deepEqual(marketActions(f),[]);}
});

test('PA/Tradovate, wrong native account, wrong Paper icon and Replay are excluded on every public entry action',async()=>{
  for(const mode of ['provider','account','icon','replay']){const f=fixture();if(mode==='provider')f.providers.forEach(n=>n.textContent='Tradovate');if(mode==='account')f.name.textContent='PAAPEX-OTHER';if(mode==='icon')f.logo.attrs.src='https://static.tradingview.com/static/bundles/replay-broker.abc.svg';if(mode==='replay')f.f.replay.attrs['aria-pressed']='true';for(const action of ['inspect','prepare','submit','reconcile','disarm'])assert.notEqual((await f.run(action)).status,'READY');assert.deepEqual(marketActions(f),[]);}
});

test('native quantity, mapping or account change after preparation cannot be silently substituted',async()=>{
  for(const mode of ['quantity','mapping','account']){const f=fixture(),p=await prepared(f);if(mode==='quantity')f.qty.value='2';if(mode==='mapping')f.mapping.attrs.title='Different mapping';if(mode==='account')f.name.textContent='different';assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);}
});

test('synthetic submission command, missing durable UNKNOWN, expired private lease and trusted intervention do not dispatch',async()=>{
  for(const mode of ['test','durable','expired','intervened']){const f=fixture(),p=await prepared(f);const args={nativePrepared:p};if(mode==='test')args.testOnly=true;if(mode==='durable')args.record={...f.record,status:'FILLED'};if(mode==='expired')f.advance(751);if(mode==='intervened')f.trusted();assert.equal((await f.run('submit',args)).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);}
});

test('actual duplicated All filter text is recognized while a selected Filled filter and unknown filter controls are rejected',async()=>{
  const f=fixture();assert.equal((await f.run('prepare')).status,'READY');assert.equal(f.statusTabs[0].textContent,'All 1All 1');
  const other=fixture();other.statusTabs[0].attrs['aria-selected']='false';other.statusTabs[1].attrs['aria-selected']='true';assert.equal((await other.run('prepare')).status,'BLOCKED');
  const filtered=fixture();filtered.setFilter(true);assert.equal((await filtered.run('prepare')).status,'BLOCKED');assert.deepEqual(marketActions(filtered),[]);
});

test('matching arbitrary position, duplicate new history candidates or partial native rows cannot fake ownership',async()=>{
  const f=fixture();f.setFilled();assert.equal((await f.run('reconcile')).status,'BLOCKED');
  for(const mode of ['duplicate','partial']){const g=fixture(),p=await prepared(g);await g.run('submit',{nativePrepared:p});g.setFilled();if(mode==='duplicate')g.data.history.unshift({...g.data.history[0],id:'104'});else g.setPartial(true);assert.equal((await g.run('reconcile')).status,'UNKNOWN');assert.equal(marketActions(g).length,1);}
});

test('user-native bracket rows are observed without modification and closure needs durable matching two-sample acknowledgement',async()=>{
  const f=fixture(),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setFilled({brackets:true});await f.run('reconcile');
  assert.equal((await f.run('release_closed',{record:{...f.record,status:'CLOSED'}})).status,'BLOCKED');
  f.setClosed();const first=await f.run('reconcile');f.advance(100);const second=await f.run('reconcile');assert.equal(first.ownedStatus,'CLOSED');assert.equal(second.ownedStatus,'CLOSED');
  const samples=[first,second].map(r=>({sampleId:r.sampleId,observedAt:r.observedAt,latestClosedAt:r.latestClosedAt,attemptKey:f.attemptKey,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[]}));
  const closed={...f.record,status:'CLOSED',history:[...f.record.history,{proof:{kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:f.attemptKey,status:'CLOSED',nativeOrderId:'101',closedVerified:true,attributionVerified:true,accountEvidence:{provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:f.expected.nativeAccountId},closureSamples:samples}}]};
  const corrupt=structuredClone(closed);corrupt.history.at(-1).proof.closureSamples[1].sampleId='forged';assert.equal((await f.run('release_closed',{record:corrupt})).status,'BLOCKED');
  assert.equal((await f.run('release_closed',{record:closed})).status,'PAPER_USER_CLOSED_RELEASED');assert.equal(marketActions(f).length,1);assert.equal(f.qty.value,'1');
});

test('Order read_connection leaves a visible Limit draft and the user inputs unchanged; explicit inspect alone applies the actual existing favourite',async()=>{
  const f=orderFixture({initialType:'LIMIT'});f.exits['stop-loss'].sw.checked=false;f.exits['stop-loss'].sw.attrs['aria-checked']='false';f.exits['take-profit'].sw.checked=false;f.exits['take-profit'].sw.attrs['aria-checked']='false';
  const read=await f.run('read_connection');assert.equal(read.status,'PAPER_USER_CONNECTION_VERIFIED',JSON.stringify(read));assert.equal(read.executionSurface,'ORDER_TICKET_PRESET');assert.equal(read.nativePreset.orderType,'LIMIT');assert.equal(read.nativePreset.ready,false);assert.equal(read.nativePreset.application,null);assert.equal(f.actions.includes('APPLY_NATIVE_FAVORITE'),false);
  const inspect=await f.run('inspect');assert.equal(inspect.status,'PAPER_USER_CONNECTION_VERIFIED',JSON.stringify(inspect));assert.equal(inspect.presetApplied,true);assert.equal(inspect.submitCapabilityCreated,false);assert.equal(inspect.nativePreset.ready,true);assert.equal(inspect.application.name,f.expected.nativePresetName);assert.equal(inspect.application.freshNoticeVerified,true);assert.equal(inspect.domEmptyCorroborated,false);assert.deepEqual(marketActions(f),[]);
});

test('source disarm preserves only unchanged read-only native preset evidence and revokes the old prepared submission lease',async()=>{
  const f=orderFixture(),p=await prepared(f),original=p.presetApplication;assert.equal((await f.run('disarm')).status,'DISARMED');
  const r=await f.run('read_connection');assert.equal(r.status,'PAPER_USER_CONNECTION_VERIFIED',JSON.stringify(r));assert.deepEqual(r.nativePreset.application,original);assert.equal(r.nativePreset.application.observedAt,original.observedAt);assert.equal(r.readOnly,true);assert.equal(r.submitCapabilityCreated,false);
  assert.equal(vm.runInContext('globalThis[Symbol.for("arrow.paper-user-market-ui.v1")].lease',f.f.context),null);
  assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');assert.deepEqual(marketActions(f),[]);
  const again=await prepared(f);assert.notEqual(again.privateLeaseId,p.privateLeaseId);assert.equal(f.actions.filter(x=>x==='APPLY_NATIVE_FAVORITE').length,2);assert.ok(again.presetApplication.observedAt>original.observedAt);assert.equal((await f.run('submit',{nativePrepared:again})).submitted,true);
});

test('read-only preset application evidence is not carried across changed native fields, account, document or pinned name',async()=>{
  for(const change of ['fields','account','document','name']){
    const f=orderFixture();assert.equal((await f.run('inspect')).status,'PAPER_USER_CONNECTION_VERIFIED');await f.run('disarm');
    if(change==='fields')f.exits['stop-loss'].input.value='31';if(change==='account'){f.expected.nativeAccountId='Another Paper Account';f.name.textContent=f.expected.nativeAccountId;}if(change==='document')f.f.context.performance.timeOrigin+=1000;if(change==='name')f.expected.nativePresetName='Another preset';
    const r=await f.run('read_connection');assert.equal(r.status,'PAPER_USER_CONNECTION_VERIFIED',change+JSON.stringify(r));assert.equal(r.nativePreset.application,null,change);assert.equal(r.submitCapabilityCreated,false);assert.deepEqual(marketActions(f),[]);
  }
});

for(const direction of ['LONG','SHORT'])test('Order '+direction+' uses native preset and one native Market button, then verifies both new native position exits and working rows',async()=>{
  const f=orderFixture({direction}),p=await prepared(f);assert.equal(p.executionSurface,'ORDER_TICKET_PRESET');assert.equal(p.nativePreset.stop.value,30);assert.equal(p.nativePreset.target.value,20);assert.equal(p.presetApplication.name,'ROI MARKET 20/30');assert.equal(p.nativePreset.direction,direction);
  const sent=await f.run('submit',{nativePrepared:p});assert.equal(sent.status,'PAPER_USER_SUBMITTED_UNCONFIRMED',JSON.stringify(sent));assert.deepEqual(marketActions(f),['ORDER_MARKET_'+(direction==='LONG'?'BUY':'SELL')]);assert.equal((await f.run('submit',{nativePrepared:p})).status,'BLOCKED');
  const prices=f.setProtectedFill(),r=await f.run('reconcile');assert.equal(r.status,'PAPER_USER_OWNED_STATE_VERIFIED',JSON.stringify(r));assert.equal(r.ownedStatus,'FILLED');assert.equal(r.nativeOrderId,'101');assert.equal(r.protectionVerified,true);assert.equal(r.nativeProtection.inheritanceVerified,true);assert.equal(r.nativeProtection.kind,'PUBLIC_NATIVE_POSITION_BRACKET_FIELDS_AND_MATCHING_WORKING_ORDERS');assert.deepEqual(r.nativeProtection.expectedPrices,{stop:prices.stop,target:prices.target});assert.equal(r.nativeProtection.brokerParentOrderIdVerified,false);assert.equal(f.orderQty.value,'1');
});

test('native preset numeric values are read without imposing prior bot budget, quantity or20/30 constants',async()=>{
  const f=orderFixture({quantity:4,stopTicks:17,targetTicks:41}),p=await prepared(f);assert.equal(p.quantity,4);assert.equal(p.nativePreset.stop.value,17);assert.equal(p.nativePreset.target.value,41);assert.equal(f.orderQty.value,'4');assert.equal((await f.run('submit',{nativePrepared:p})).submitted,true);f.setProtectedFill();assert.equal((await f.run('reconcile')).protectionVerified,true);
});

test('a missing, mismatched or stale native applied notice cannot turn a populated draft into a verified preset',async()=>{
  for(const mode of ['NONE','WRONG','STALE']){const f=orderFixture();f.setNoticeMode(mode);if(mode==='STALE')f.setOldNotice();const r=await f.run('inspect');assert.equal(r.status,'BLOCKED',mode+JSON.stringify(r));assert.deepEqual(marketActions(f),[]);}
  const f=orderFixture();f.setExtraFavorite();assert.equal((await f.run('inspect')).status,'BLOCKED');assert.equal(f.actions.includes('APPLY_NATIVE_FAVORITE'),false);
});

test('Order final commit rejects changed quantity, bracket values, switches, type, side or favourite identity without editing them back',async()=>{
  for(const field of ['quantity','stop','target','switch','type','side','favorite']){const f=orderFixture(),p=await prepared(f);if(field==='quantity'){f.orderQty.value='2';f.updateCaption();}if(field==='stop')f.exits['stop-loss'].input.value='31';if(field==='target')f.exits['take-profit'].input.value='21';if(field==='switch'){f.exits['stop-loss'].sw.checked=false;f.exits['stop-loss'].sw.attrs['aria-checked']='false';}if(field==='type'){f.types.forEach(n=>n.attrs['aria-selected']=String(n.attrs.id==='Limit'));f.updateCaption();}if(field==='side')f.sell.click();if(field==='favorite')f.setExtraFavorite();const r=await f.run('submit',{nativePrepared:p});assert.equal(r.status,'BLOCKED',field+JSON.stringify(r));assert.deepEqual(marketActions(f),[]);assert.equal(f.actions.filter(x=>x==='APPLY_NATIVE_FAVORITE').length,1);}
});

test('matching draft exits or generic two orders never substitute for exact active native brackets linked through position fields',async()=>{
  for(const field of ['position','price','quantity','side','status','extra','oldid']){const f=orderFixture(),p=await prepared(f);await f.run('submit',{nativePrepared:p});f.setProtectedFill();if(field==='position')f.data.positions[0].stopLoss='—';if(field==='price')f.data.orders[0].stopPrice='28000';if(field==='quantity')f.data.orders[0].qty='2';if(field==='side')f.data.orders[0].side='Buy';if(field==='status')f.data.orders[0].status='inactive';if(field==='extra')f.data.orders.push({...f.data.orders[0],id:'104'});if(field==='oldid')f.data.orders[0].id='100';const r=await f.run('reconcile');assert.equal(r.ownedStatus,'FILLED',field+JSON.stringify(r));assert.equal(r.protectionVerified,false);assert.equal(r.nativeProtection.inheritanceVerified,false);assert.ok(r.nativeProtection.reasonCodes.length>0);}
});

test('missing or relabeled native exit headers cannot certify inherited protection and do not become a strategy entry gate',async()=>{
  for(const mode of ['position-label','order-missing']){
    const f=orderFixture();if(mode==='position-label')f.grids.positions.head.find(n=>n.attrs.id==='stopLoss').textContent='Other price';else{const h=f.grids.orders.head;h.splice(h.findIndex(n=>n.attrs.id==='limitPrice'),1);}
    const p=await prepared(f);assert.equal((await f.run('submit',{nativePrepared:p})).submitted,true);f.setProtectedFill();const r=await f.run('reconcile');assert.equal(r.ownedStatus,'FILLED',JSON.stringify(r));assert.equal(r.protectionVerified,false);assert.equal(r.nativeProtection.inheritanceVerified,false);assert.ok(r.nativeProtection.reasonCodes.includes('NATIVE_POSITION_AND_ORDER_EXIT_HEADER_LABELS_NOT_VERIFIED'));
  }
});
