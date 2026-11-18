// Serialized into the ISOLATED world of the explicitly selected research tab.
// Public rendered controls only. Never uses TradingView private APIs, hotkeys,
// broker HTTP endpoints or account credentials. Every mutation requires the
// currently selected broker to be exactly TradingView's virtual Paper Trading.
export async function paperTradingUiCommand(command={}){
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
  const label=e=>norm(e?.getAttribute('aria-label')||e?.innerText||e?.textContent);
  const number=x=>{const s=norm(x).replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;};
  const visible=e=>!!e&&e.isConnected&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const all=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible);
  const exactly=(selector,root=document)=>{const rows=all(selector,root);return rows.length===1?rows[0]:null;};
  const named=(name,root=document)=>{const rows=all('button,[role="button"],[role="tab"]',root).filter(e=>label(e)===name);return rows.length===1?rows[0]:null;};
  const fail=code=>{throw Object.assign(new Error(code),{paperCode:code});};
  const slot=Symbol.for('arrow.paper-ui-driver.v1');
  const memory=globalThis[slot]??(globalThis[slot]={generation:0,prepared:null,lastSubmission:null});
  let gestureStarted=false;
  const safe=code=>({status:'BLOCKED',reasonCodes:[code],submitted:false,ordersCreated:false});
  const current=()=>Date.now();
  const expire=at=>Number.isFinite(at)&&at>=current()&&at-current()<=20000;
  const finishPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  async function until(check){
    const started=current();
    while(current()-started<1800){if(check()){await finishPaint();if(check())return;}await new Promise(resolve=>setTimeout(resolve,35));}
    fail('PAPER_UI_DID_NOT_SETTLE');
  }
  const expected=command.expected??{};
  function identity(){
    if(document.visibilityState!=='visible')fail('RESEARCH_TAB_NOT_VISIBLE');
    if(all('[role="dialog"]').length)fail('PAPER_MODAL_REQUIRES_REVIEW');
    const here=location.origin+location.pathname;
    let requested;try{const u=new URL(expected.researchUrl);requested=u.origin+u.pathname;}catch{fail('EXPLICIT_RESEARCH_URL_REQUIRED');}
    if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||!/^\/chart\/[A-Za-z0-9]+\/$/.test(location.pathname)||here!==requested)fail('RESEARCH_URL_MISMATCH');
    const layout=exactly('[aria-label^="Logged in as"]')?.getAttribute('aria-label')??'';
    if(!/Active layout: Arrow /.test(layout))fail('NAMED_RESEARCH_LAYOUT_REQUIRED');
    const charts=all('canvas[aria-label^="Chart for "]');
    if(charts.length!==1)fail('SINGLE_RESEARCH_CHART_REQUIRED');
    const chart=/^Chart for ([^,]+), (\d+) minute$/.exec(charts[0].getAttribute('aria-label')??'');
    if(!chart||chart[1]!==expected.instrument||chart[2]!=='1'||expected.timeframe!=='1'||!/^CME_MINI:NQ(?:1!|[HMUZ]20\d\d)$/.test(chart[1]))fail('NQ_ONE_MINUTE_RESEARCH_REQUIRED');
    const replay=all('button[aria-label="Bar replay"]');
    if(!replay.length||replay.some(e=>e.getAttribute('aria-pressed')!=='false'))fail('REPLAY_MUST_BE_OFF');
    const brokerButtons=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]');
    if(brokerButtons.length!==1||norm(brokerButtons[0].textContent)!=='Paper Trading')fail('EXACT_PAPER_TRADING_BROKER_REQUIRED');
    const account=exactly('[aria-label="Account manager"]');
    const selector=account&&exactly('[data-qa-id="account-selector"]',account);
    const name=selector?.querySelector('[class*="accountName-"]');
    if(!account||!visible(name)||!norm(name.textContent))fail('PAPER_ACCOUNT_PANEL_REQUIRED');
    // UI binding only, not authentication. Exclude the changing balance.
    let h=2166136261;for(const c of norm(name.textContent)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
    const accountKey='paper-ui:'+(h>>>0).toString(16);
    if(expected.accountKey&&expected.accountKey!==accountKey)fail('PAPER_ACCOUNT_CHANGED');
    return {provider:'TRADINGVIEW_PAPER',accountKey,researchUrl:here,chartCount:1,instrument:chart[1],timeframe:'1',replay:false,account};
  }
  function ticket(){
    const panel=exactly('[aria-label="Trading panel"]'),root=panel&&exactly('[aria-label="Order ticket"]',panel);
    if(!root)fail('PAPER_ORDER_TICKET_REQUIRED');
    const symbols=all('[title]',panel).map(e=>e.title).filter(s=>/^NQ[HMUZ]20\d\d$/.test(s));
    if(new Set(symbols).size!==1)fail('EXACT_PAPER_NQ_TICKET_REQUIRED');
    const symbol=symbols[0];
    const mapping=all('[title]',panel).map(e=>e.title).find(s=>s===`Continuous futures is used for charting, but the ${symbol} contract will be used for order placement.`)??null;
    if(expected.instrument==='CME_MINI:NQ1!'&&!mapping)fail('PAPER_CONTINUOUS_CONTRACT_MAPPING_REQUIRED');
    if(expected.instrument!=='CME_MINI:NQ1!'&&expected.instrument!=='CME_MINI:'+symbol)fail('PAPER_TICKET_CONTRACT_CHANGED');
    const read=selector=>{const e=exactly(selector,root);return e?number(e.value):null;};
    const quote=side=>{const e=exactly(`[data-name="side-control-${side}"]`,root);return e?number(norm(e.textContent).replace(new RegExp('^'+(side==='buy'?'Buy':'Sell')+'\\s*'),'')):null;};
    const selected=all('[role="tab"][aria-selected="true"]',root);
    const type=selected.length===1?norm(selected[0].textContent).toUpperCase():null;
    const stopSwitch=exactly('[data-qa-id="order-ticket-stop-loss-checkbox-bracket"]',root),targetSwitch=exactly('[data-qa-id="order-ticket-take-profit-checkbox-bracket"]',root);
    const stopTicksMode=!!named('Stop loss ticks',root),targetTicksMode=!!named('Take profit ticks',root);
    const stopPriceMode=!!named('Stop loss price',root),targetPriceMode=!!named('Take profit price',root);
    const entry=read('input[data-qa-id~="order-ticket-absolute-price-input"]');
    const stopValue=read('input[data-qa-id~="order-ticket-stop-loss-input"]'),targetValue=read('input[data-qa-id~="order-ticket-take-profit-input"]');
    const tickMatch=/Tick value\s*([\d,.]+)\s*USD/.exec(norm(root.textContent));
    return {root,symbol,mappingNotice:mapping,quantity:read('input[aria-label="Units"]'),type,
      entry,stopMode:stopPriceMode?'PRICE':stopTicksMode?'TICKS':null,targetMode:targetPriceMode?'PRICE':targetTicksMode?'TICKS':null,
      stopPrice:stopPriceMode?stopValue:null,targetPrice:targetPriceMode?targetValue:null,
      stopTicks:stopTicksMode?stopValue:stopPriceMode&&Number.isFinite(entry)&&Number.isFinite(stopValue)?Math.abs(entry-stopValue)/.25:null,
      targetTicks:targetTicksMode?targetValue:targetPriceMode&&Number.isFinite(entry)&&Number.isFinite(targetValue)?Math.abs(entry-targetValue)/.25:null,
      stopEnabled:stopSwitch?.getAttribute('aria-checked')==='true'&&stopSwitch.checked===true,
      targetEnabled:targetSwitch?.getAttribute('aria-checked')==='true'&&targetSwitch.checked===true,
      bid:quote('sell'),ask:quote('buy'),tickValue:tickMatch?number(tickMatch[1]):null};
  }
  async function rows(kind,binding){
    const id=identity();if(id.accountKey!==binding.accountKey)fail('PAPER_ACCOUNT_CHANGED');
    const tabs=all('[role="tab"]',id.account).filter(e=>new RegExp('^'+kind+'(?: \\d+)?$').test(label(e)));
    const tab=tabs.length===1?tabs[0]:null;if(!tab)fail('PAPER_ACCOUNT_TAB_REQUIRED');
    if(tab.getAttribute('aria-selected')!=='true'){tab.click();await until(()=>tab.getAttribute('aria-selected')==='true'&&!all('[role="progressbar"]',id.account).length);}
    if(kind==='Orders'){
      const filters=all('[role="tab"]',id.account).filter(e=>/^All(?: \d+)?$/.test(label(e)));
      if(filters.length>1)fail('PAPER_ORDER_FILTER_AMBIGUOUS');
      if(filters.length===1&&filters[0].getAttribute('aria-selected')!=='true'){filters[0].click();await until(()=>filters[0].getAttribute('aria-selected')==='true');}
    }
    const fresh=identity();if(fresh.accountKey!==binding.accountKey)fail('PAPER_ACCOUNT_CHANGED');
    const grid=exactly(`table[data-name="Paper.${kind==='Positions'?'positions':'orders'}-table"]`,fresh.account);if(!grid)fail('PAPER_TABLE_REQUIRED');
    const body=grid.querySelector('tbody');if(!body)fail('PAPER_TABLE_BODY_REQUIRED');
    const headers=[...grid.querySelectorAll('thead th')].map(e=>({id:e.id,text:norm(e.textContent)}));
    const empty=norm(body.textContent)==='Nothing to show yet. Your account activity will appear here.';
    if(empty)return {headers,rows:[],empty:true};
    const elements=[...body.querySelectorAll('tr')];
    if(!elements.length||!headers.length||headers.some(e=>!e.id)||new Set(headers.map(e=>e.id)).size!==headers.length)fail('PAPER_TABLE_SCHEMA_UNVERIFIED');
    const parsed=elements.map(row=>{
      const cells=[...row.querySelectorAll('td')];if(cells.length!==headers.length)fail('PAPER_TABLE_ROW_INCOMPLETE');
      return {rowId:row.getAttribute('data-row-id'),cells:Object.fromEntries(headers.map((h,i)=>[h.id,norm(cells[i].textContent)]))};
    });
    return {headers,rows:parsed,empty:false};
  }
  async function evidence(){
    const binding=identity();const positionTable=await rows('Positions',binding),orderTable=await rows('Orders',binding);
    const positions=positionTable.rows,terminal=new Set(['filled','cancelled','canceled','rejected']);
    const workingOrders=orderTable.rows.filter(row=>!terminal.has(String(row.cells.status??'').toLowerCase()));
    const bound=identity(),t=ticket();if(bound.accountKey!==binding.accountKey)fail('PAPER_ACCOUNT_CHANGED');
    const {root,...value}=t;
    return {status:'PAPER_UI_VERIFIED',provider:bound.provider,accountKey:bound.accountKey,observedAt:current(),researchUrl:bound.researchUrl,
      chartCount:1,instrument:bound.instrument,timeframe:'1',replay:false,positions,workingOrders,flat:positions.length===0&&workingOrders.length===0,
      tables:{positions:positionTable,orders:orderTable},ticket:value,ordersCreated:false};
  }
  function validIntent(intent){
    if(!intent||intent.quantity!==1||!['LONG','SHORT'].includes(intent.direction)||![intent.entry,intent.stopTicks,intent.targetTicks].every(Number.isFinite)||
      !Number.isSafeInteger(intent.stopTicks)||intent.stopTicks<1||intent.stopTicks>40||!Number.isSafeInteger(intent.targetTicks)||intent.targetTicks<1||intent.targetTicks>10000||
      !/^NQ[HMUZ]20\d\d$/.test(intent.expectedSymbol)||!expire(intent.expiresAt))fail('INVALID_OR_EXPIRED_PAPER_INTENT');
    const coordinate=intent.entry/.25;if(!Number.isSafeInteger(coordinate)||intent.entry<=0)fail('PAPER_ENTRY_OFF_TICK');
    return intent;
  }
  function liveSourceLease(intent){
    const run=/\|(\d{13})$/.exec(intent.sourceBinding?.runId??'');
    if(!run)fail('PAPER_SOURCE_RUN_EPOCH_REQUIRED');
    const field=name=>{
      const label=exactly(`[data-test-id-value-title="${name}"]`);
      if(!label?.parentElement||label.parentElement.children.length!==2)fail('PAPER_VISIBLE_LIVE_SOURCE_REQUIRED');
      const value=number(label.parentElement.children[1].textContent);
      if(!Number.isSafeInteger(value))fail('PAPER_VISIBLE_LIVE_SOURCE_REQUIRED');return value;
    };
    const epoch=field('ARROW2_RUN_EPOCH'),begin=field('ARROW2_SEQ_BEGIN'),source=field('ARROW2_SOURCE_EPOCH'),supported=field('ARROW2_SUPPORTED'),closed=field('ARROW2_CURRENT_CLOSED'),end=field('ARROW2_SEQ_END');
    const bank=1e12,sourceAt=source%bank+1577836800000;
    if(epoch!==Number(run[1])||begin!==end||Math.floor(source/bank)!==begin||Math.floor(supported/bank)!==begin||Math.floor(closed/bank)!==begin||supported%bank!==3||closed%bank!==0||sourceAt<current()-15000||sourceAt>current()+5000)fail('PAPER_LIVE_SOURCE_LEASE_CHANGED');
  }
  async function setInput(selector,value){
    identity();const root=ticket().root,input=exactly(selector,root);
    if(!input||input.disabled||input.readOnly)fail('PAPER_INPUT_NOT_EDITABLE');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)fail('PAPER_INPUT_SETTER_UNAVAILABLE');
    setter.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();
    await until(()=>number(input.value)===value);
  }
  async function absoluteExit(kind){
    const prefix=kind==='stop-loss'?'Stop loss':'Take profit',root=ticket().root;
    if(named(prefix+' price',root))return;
    const choose=named(prefix+' ticks',root);if(!choose)fail('PAPER_EXIT_PRICE_MODE_REQUIRED');
    choose.click();await until(()=>!!exactly('[data-qa-id="equivalent-type-Price"]'));
    identity();exactly('[data-qa-id="equivalent-type-Price"]').click();
    await until(()=>!!named(prefix+' price',ticket().root));
  }
  function matches(t,intent){
    const parent=exactly('[data-name="place-and-modify-button"]',t.root);
    const text=norm(parent?.textContent),side=intent.direction==='LONG'?'Buy':'Sell';
    const sign=intent.direction==='LONG'?1:-1,stop=intent.stop??intent.entry-sign*intent.stopTicks*.25,target=intent.target??intent.entry+sign*intent.targetTicks*.25;
    return t.symbol===intent.expectedSymbol&&t.quantity===1&&t.type==='LIMIT'&&t.entry===intent.entry&&t.stopTicks===intent.stopTicks&&t.targetTicks===intent.targetTicks&&t.stopMode==='PRICE'&&t.targetMode==='PRICE'&&t.stopPrice===stop&&t.targetPrice===target&&t.stopEnabled&&t.targetEnabled&&t.tickValue===5&&
      text.startsWith(side+' ')&&text.includes('1 '+intent.expectedSymbol)&&text.endsWith('LIMIT')&&parent&&!parent.disabled;
  }
  try{
    if(command.action==='disarm'){memory.generation++;memory.prepared=null;return {status:'DISARMED',ordersCreated:false};}
    if(command.action==='read')return await evidence();
    if(command.action==='prepare'){
      memory.prepared=null;const generation=memory.generation,intent=validIntent(command.intent),before=await evidence();
      if(before.accountKey!==intent.accountKey||before.ticket.symbol!==intent.expectedSymbol||!before.flat)fail('PAPER_FLAT_ACCOUNT_BINDING_REQUIRED');
      const t=ticket(),side=exactly(`[data-name="side-control-${intent.direction==='LONG'?'buy':'sell'}"]`,t.root);if(!side)fail('PAPER_SIDE_CONTROL_REQUIRED');
      side.click();await finishPaint();identity();
      const limit=named('Limit',ticket().root);if(!limit)fail('PAPER_LIMIT_CONTROL_REQUIRED');limit.click();await finishPaint();
      await setInput('input[data-qa-id~="order-ticket-absolute-price-input"]',intent.entry);
      await setInput('input[aria-label="Units"]',1);
      for(const type of ['stop-loss','take-profit']){
        const sw=exactly(`[data-qa-id="order-ticket-${type}-checkbox-bracket"]`,ticket().root);
        if(!sw)fail('PAPER_PROTECTIVE_SWITCH_REQUIRED');if(sw.getAttribute('aria-checked')!=='true'){sw.click();await until(()=>sw.getAttribute('aria-checked')==='true'&&sw.checked);}
      }
      await absoluteExit('stop-loss');await absoluteExit('take-profit');
      const sign=intent.direction==='LONG'?1:-1,stop=intent.stop??intent.entry-sign*intent.stopTicks*.25,target=intent.target??intent.entry+sign*intent.targetTicks*.25;
      if(stop!==intent.entry-sign*intent.stopTicks*.25||target!==intent.entry+sign*intent.targetTicks*.25)fail('PAPER_STRUCTURAL_EXIT_MISMATCH');
      await setInput('input[data-qa-id~="order-ticket-stop-loss-input"]',stop);
      await setInput('input[data-qa-id~="order-ticket-take-profit-input"]',target);
      validIntent(intent);const after=await evidence();
      if(generation!==memory.generation||!after.flat||after.accountKey!==intent.accountKey||!matches(ticket(),intent))fail('PAPER_TICKET_VERIFICATION_FAILED');
      const testOnly=command.mode==='TEST_DRAFT';
      if(!testOnly){
        if(intent.signalApproved!==true||intent.testOnly!==false||!intent.sourceBinding||!intent.key)fail('APPROVED_LIVE_PAPER_INTENT_REQUIRED');
        liveSourceLease(intent);
        memory.prepared={generation,accountKey:intent.accountKey,key:intent.key,intentJson:JSON.stringify(intent),expiresAt:intent.expiresAt};
      }
      return {status:'TICKET_PREPARED',mode:testOnly?'TEST_NO_SUBMISSION':'LIVE_APPROVED_PAPER',evidence:after,ordersCreated:false,submitCapabilityCreated:!testOnly};
    }
    if(command.action==='submit'){
      const intent=validIntent(command.intent),lease=memory.prepared;
      // Invalidate before any asynchronous checks. There is no automatic retry.
      memory.prepared=null;
      if(command.mode==='TEST_DRAFT'||intent.testOnly!==false||intent.signalApproved!==true||!lease||lease.key!==intent.key||lease.generation!==memory.generation||lease.intentJson!==JSON.stringify(intent))fail('PAPER_SUBMISSION_CAPABILITY_REQUIRED');
      const checked=await evidence();
      validIntent(intent);const bound=identity(),t=ticket();
      if(lease.generation!==memory.generation||!checked.flat||bound.accountKey!==intent.accountKey||checked.accountKey!==intent.accountKey||!matches(t,intent))fail('PAPER_PRE_SUBMIT_CHANGED');
      const parent=exactly('[data-name="place-and-modify-button"]',t.root);
      liveSourceLease(intent);
      // Exact broker, research identity, account and bracket fields were checked
      // synchronously in this turn before this sole virtual-account gesture.
      const baselineOrderIds=checked.tables.orders.rows.map(row=>row.cells.id??row.rowId).filter(Boolean);
      memory.lastSubmission={key:intent.key,accountKey:intent.accountKey,baselineOrderIds,submittedAt:current()};
      gestureStarted=true;parent.click();
      return {status:'SUBMITTED_UNCONFIRMED',submittedAt:memory.lastSubmission.submittedAt,key:intent.key,baselineOrderIds,ordersCreated:null,fillVerified:false,protectionVerified:false};
    }
    if(command.action==='verify'){
      let inspected=await evidence();
      const prior=memory.lastSubmission,untilAt=current()+3000;
      if(prior&&prior.key===command.intent?.key){
        const known=new Set(prior.baselineOrderIds);
        while(inspected.positions.length===0&&!inspected.tables.orders.rows.some(row=>!known.has(row.cells.id??row.rowId))&&current()<untilAt){
          await new Promise(resolve=>setTimeout(resolve,75));inspected=await evidence();
        }
      }
      // No fabricated fill from a click acknowledgement or chart marker.
      // Until a separately validated exact table parser proves the parent and
      // both protective rows, uncertainty requires locked human reconciliation.
      return {status:'UNKNOWN',reasonCodes:['PAPER_FILL_AND_PROTECTION_NOT_VERIFIED'],evidence:inspected,ordersCreated:null,fillVerified:false,protectionVerified:false};
    }
    return safe('UNKNOWN_PAPER_UI_ACTION');
  }catch(e){memory.prepared=null;const reason=typeof e?.paperCode==='string'?e.paperCode:'PAPER_UI_COMMAND_FAILED';
    return gestureStarted?{status:'UNKNOWN',reasonCodes:[reason],submitted:null,ordersCreated:null,fillVerified:false,protectionVerified:false}:safe(reason);}
}
