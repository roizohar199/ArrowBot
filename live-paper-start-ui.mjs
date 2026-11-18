// Serialized public-UI startup only: one bounded non-order action per call.
// Never changes a layout, timeframe, account, numeric input or order preset.
export async function prepareLivePaperStartUi({nativeAccountId,sourceUrl}={}){
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim(),visible=node=>{
    if(!node?.isConnected||![...node.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
    for(let p=node,depth=0;p&&depth<64;p=p.parentElement,depth++){
      const s=getComputedStyle(p);if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.contentVisibility==='hidden')return false;
      if(p!==node){const r=p.getBoundingClientRect(),clip=v=>['hidden','clip','scroll','auto'].includes(v);if(clip(s.overflowX??s.overflow)&&r.width<=0||clip(s.overflowY??s.overflow)&&r.height<=0)return false;}
    }return true;
  },all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible),one=(s,r=document)=>{const a=all(s,r);return a.length===1?a[0]:null;},
    label=n=>norm(n?.textContent),disabled=n=>!n||n.disabled===true||n.getAttribute('aria-disabled')==='true',
    result=(status,reason,extra={})=>({kind:'LIVE_PAPER_START_PUBLIC_UI_V1',status,reasonCodes:reason?[reason]:[],actionPerformed:null,ordersCreated:false,submitted:false,submitCapabilityCreated:false,
      numericInputsSet:false,presetApplied:false,layoutChanged:false,timeframeChanged:false,accountChanged:false,...extra}),
    fail=code=>{throw Object.assign(new Error(code),{paperStartCode:code});},wait=code=>{throw Object.assign(new Error(code),{paperStartCode:code,paperStartWaiting:true});};
  function identity(){
    const layoutsByUrl={'https://www.tradingview.com/chart/ARROWRV1/':'Arrow OHLC Live Verification','https://www.tradingview.com/chart/ARROWFR1/':'Full Screens Live'},layoutName=layoutsByUrl[location.href];
    if(!layoutName||sourceUrl!==undefined&&sourceUrl!==location.href||document.visibilityState!=='visible'||document.hidden===true)fail('LIVE_PAPER_START_EXACT_VISIBLE_RESEARCH_REQUIRED');
    if(typeof nativeAccountId!=='string'||!nativeAccountId.trim()||nativeAccountId.length>240||/[\u0000-\u001f\u007f]/.test(nativeAccountId))fail('LIVE_PAPER_START_NATIVE_ACCOUNT_REQUIRED');
    if(all('[role="dialog"],[aria-modal="true"]').length)fail('LIVE_PAPER_START_EXISTING_DIALOG_EXCLUDED');
    const layouts=all('[aria-label^="Logged in as"]'),charts=all('canvas[aria-label^="Chart for "]'),minutes=charts.filter(n=>n.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute'),replays=all('#header-toolbar-replay'),replay=replays[0];
    if(layouts.length>1||layouts.some(n=>!norm(n.getAttribute('aria-label')).endsWith('Active layout: '+layoutName))||charts.length>3||minutes.length>1||charts.some(n=>!/^Chart for CME_MINI:NQ1!, [^,]+$/.test(n.getAttribute('aria-label')??'')))fail('LIVE_PAPER_START_EXACT_RESEARCH_NQ_SCOPE_REQUIRED');
    const scopeMounting=!layouts.length||!charts.length;if(charts.length&&minutes.length!==1)fail('LIVE_PAPER_START_EXACT_RESEARCH_NQ_SCOPE_REQUIRED');
    if(replays.length>1||all('[data-qa-id="replay_trading"]').length)fail('LIVE_PAPER_START_REPLAY_EXCLUDED');
    const replayState=replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked'),replayMounting=!replay||replayState===null;if(!replayMounting&&replayState!=='false')fail('LIVE_PAPER_START_REPLAY_EXCLUDED');
    const providers=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]'),paperButtons=all('button[data-qa-id="paper_trading"]');
    if(providers.length>3||providers.some(n=>label(n)&&label(n)!=='Paper Trading')||paperButtons.length>1||paperButtons.some(n=>label(n)&&label(n)!=='Paper Trading'))fail('LIVE_PAPER_START_EXACT_PAPER_PROVIDER_REQUIRED');
    if(scopeMounting)wait('LIVE_PAPER_START_RESEARCH_SCOPE_MOUNTING');if(replayMounting)wait('LIVE_PAPER_START_REPLAY_CONTROL_MOUNTING');
    if(!providers.length||!paperButtons.length||providers.some(n=>!label(n))||!label(paperButtons[0]))wait('LIVE_PAPER_START_PAPER_PROVIDER_MOUNTING');
    return {minute:minutes[0],paperButton:paperButtons[0],visibleCharts:charts.length,sourceUrl:location.href,layoutName};
  }
  function exitPointer(node,exitTo){
    if(typeof MouseEvent!=='function')fail('LIVE_PAPER_START_PUBLIC_GESTURE_UNAVAILABLE');
    const target=exitTo.getBoundingClientRect(),out={bubbles:true,cancelable:true,composed:true,view:globalThis.window,button:0,buttons:0,clientX:target.left+target.width/2,clientY:target.top+target.height/2,relatedTarget:exitTo};
    if(typeof PointerEvent==='function'){node.dispatchEvent(new PointerEvent('pointerout',{...out,pointerId:1,pointerType:'mouse',isPrimary:true}));node.dispatchEvent(new PointerEvent('pointerleave',{...out,bubbles:false,pointerId:1,pointerType:'mouse',isPrimary:true}));}
    node.dispatchEvent(new MouseEvent('mouseout',out));node.dispatchEvent(new MouseEvent('mouseleave',{...out,bubbles:false}));
  }
  function gesture(node,{exitTo=null}={}){
    if(disabled(node)||!visible(node))fail('LIVE_PAPER_START_OWN_CONTROL_UNAVAILABLE');
    const r=node.getBoundingClientRect(),init={bubbles:true,cancelable:true,composed:true,view:globalThis.window,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};
    if(typeof MouseEvent!=='function')fail('LIVE_PAPER_START_PUBLIC_GESTURE_UNAVAILABLE');
    if(typeof PointerEvent==='function')node.dispatchEvent(new PointerEvent('pointerdown',{...init,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true}));
    node.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1}));
    if(typeof PointerEvent==='function')node.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true}));
    node.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0}));node.dispatchEvent(new MouseEvent('click',{...init,buttons:0}));
    if(exitTo)exitPointer(node,exitTo);
  }
  function act(node,action,options){identity();gesture(node,options);return result('WAITING','LIVE_PAPER_START_NATIVE_UI_SETTLING',{actionPerformed:action});}
  try{
    const bound=identity(),intervals=all('#header-toolbar-intervals [aria-checked="true"]');
    if(!intervals.length||intervals.length===1&&intervals[0].getAttribute('data-value')===null)wait('LIVE_PAPER_START_ACTIVE_CHART_MOUNTING');if(intervals.length!==1)fail('LIVE_PAPER_START_ACTIVE_CHART_AMBIGUOUS');
    if(intervals[0].getAttribute('data-value')!=='1')return act(bound.minute,'ACTIVATE_EXISTING_NQ_ONE_MINUTE_CHART',{exitTo:bound.paperButton});
    const managers=all('[aria-label="Account manager"]');if(managers.length>1)fail('LIVE_PAPER_START_ACCOUNT_MANAGER_AMBIGUOUS');
    if(!managers.length){
      if(bound.paperButton.getAttribute('aria-label')==='Open account manager')return act(bound.paperButton,'OPEN_EXISTING_PAPER_ACCOUNT_MANAGER');
      if(bound.paperButton.getAttribute('aria-label')==='Collapse account manager')return result('WAITING','LIVE_PAPER_START_ACCOUNT_MANAGER_MOUNTING');
      fail('LIVE_PAPER_START_ACCOUNT_MANAGER_CONTROL_UNRECOGNIZED');
    }
    const selector=one('[data-qa-id="account-selector"]',managers[0]),names=selector?all('[class*="accountName-"]',selector):[];
    if(names.length>1)fail('LIVE_PAPER_START_NATIVE_ACCOUNT_UNVERIFIED');if(!names.length||!label(names[0]))wait('LIVE_PAPER_START_NATIVE_ACCOUNT_MOUNTING');if(label(names[0])!==nativeAccountId)fail('LIVE_PAPER_START_NATIVE_ACCOUNT_MISMATCH');
    const panels=all('[aria-label="Trading panel"]');if(panels.length>1)fail('LIVE_PAPER_START_TRADING_PANEL_AMBIGUOUS');
    const panel=panels[0]??null,tickets=panel?all('[aria-label="Order ticket"]',panel):[],radios=panel?all('[role="radio"]',panel):[],order=radios.filter(n=>label(n)==='Order'),dom=radios.filter(n=>label(n)==='DOM');
    if(tickets.length>1||order.length>1||dom.length>1||panel&&all('[data-name="position-panel"]',panel).length)fail('LIVE_PAPER_START_NEW_ORDER_DRAFT_REQUIRED');
    const titles=panel?all('[title]',panel).map(n=>n.getAttribute('title')):[],symbols=[...new Set(titles.filter(t=>/^NQ[HMUZ]20\d\d$/.test(t??'')))],logos=panel?all('img[src]',panel).filter(n=>{
      try{const u=new URL(n.getAttribute('src'));return u.protocol==='https:'&&u.hostname==='static.tradingview.com'&&/^\/static\/bundles\/paper\.[a-z0-9]+\.svg$/.test(u.pathname);}catch{return false;}
    }):[];
    if(panel){
      const images=all('img[src]',panel),mappings=titles.filter(t=>(t??'').startsWith('Continuous futures is used for charting, but '));
      if(symbols.length>1||logos.length>1||images.length&&!logos.length||titles.some(t=>/^NQ[HMUZ]20\d\d, (?:order|position) /.test(t??'')||/^[A-Z]+[HMUZ]20\d\d$/.test(t??'')&&!/^NQ[HMUZ]20\d\d$/.test(t))||mappings.length>1||mappings.length===1&&symbols.length===1&&mappings[0]!==`Continuous futures is used for charting, but the ${symbols[0]} contract will be used for order placement.`)fail('LIVE_PAPER_START_NATIVE_PAPER_CONTRACT_UNVERIFIED');
      if(!symbols.length||!logos.length||!mappings.length)wait('LIVE_PAPER_START_NATIVE_PANEL_MOUNTING');
    }
    if(panel&&!tickets.length&&dom.length===1&&dom[0].getAttribute('aria-checked')==='true'&&order.length===1&&order[0].getAttribute('aria-checked')==='false')return act(order[0],'SELECT_EXISTING_ORDER_VIEW');
    if(panel&&!tickets.length&&order.length===1&&order[0].getAttribute('aria-checked')==='true')wait('LIVE_PAPER_START_NEW_ORDER_TICKET_MOUNTING');
    if(!tickets.length){const trades=all('button[data-qa-id="trade-button"]');if(trades.length>1)fail('LIVE_PAPER_START_TRADE_CONTROL_AMBIGUOUS');if(!trades.length)return result('WAITING','LIVE_PAPER_START_TRADE_CONTROL_MOUNTING');return act(trades[0],'OPEN_NEW_NATIVE_ORDER_TICKET');}
    if(!order.length&&!dom.length)wait('LIVE_PAPER_START_ORDER_VIEW_MOUNTING');if(order.length!==1||order[0].getAttribute('aria-checked')!=='true'||dom.length!==1||dom[0].getAttribute('aria-checked')!=='false')fail('LIVE_PAPER_START_NEW_ORDER_VIEW_UNVERIFIED');
    const ticket=tickets[0],buy=one('[data-name="side-control-buy"][role="button"]',ticket),sell=one('[data-name="side-control-sell"][role="button"]',ticket),active=n=>(n?.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-'));
    const buyCount=all('[data-name="side-control-buy"][role="button"]',ticket).length,sellCount=all('[data-name="side-control-sell"][role="button"]',ticket).length;
    if(!buyCount||!sellCount)wait('LIVE_PAPER_START_NATIVE_SIDE_CONTROLS_MOUNTING');if(disabled(buy)||disabled(sell))fail('LIVE_PAPER_START_NATIVE_SIDE_CONTROLS_UNVERIFIED');
    if(!active(buy)&&!active(sell))return act(buy,'INITIALIZE_NEW_ORDER_BUY_SIDE');
    if(active(buy)&&active(sell))fail('LIVE_PAPER_START_NATIVE_SIDE_AMBIGUOUS');
    const market=one('button[role="tab"][id="Market"]',ticket),selected=all('[role="tab"][aria-selected="true"]',ticket);
    if(!all('button[role="tab"][id="Market"]',ticket).length||!selected.length)wait('LIVE_PAPER_START_NATIVE_ORDER_TYPE_MOUNTING');if(!market||disabled(market)||selected.length!==1||!['Market','Limit','Stop'].includes(selected[0].getAttribute('id')))fail('LIVE_PAPER_START_NATIVE_ORDER_TYPE_UNVERIFIED');
    if(market.getAttribute('aria-selected')==='false')return act(market,'SELECT_NATIVE_MARKET_DRAFT');
    if(market.getAttribute('aria-selected')!=='true'||selected[0]!==market)fail('LIVE_PAPER_START_NATIVE_MARKET_DRAFT_REQUIRED');
    const qty=one('input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]',ticket),raw=qty?.value,quantity=typeof raw==='string'&&/^\d+(?:\.0+)?$/.test(raw)?Number(raw):null;
    if(!all('input[aria-label="Units"][data-qa-id~="units-quantity-field-input"]',ticket).length||raw==='')wait('LIVE_PAPER_START_NATIVE_QUANTITY_MOUNTING');if(disabled(qty)||qty.readOnly||!Number.isSafeInteger(quantity)||quantity<1)fail('LIVE_PAPER_START_NATIVE_QUANTITY_UNVERIFIED');
    identity();exitPointer(bound.minute,bound.paperButton);
    return result('READY',null,{actionPerformed:'CLEAR_CURRENT_CHART_POINTER',pointerExited:true,provider:'TRADINGVIEW_PAPER',nativeAccountId,executionSurface:'ORDER_TICKET_PRESET',visibleCharts:bound.visibleCharts,sourceUrl:bound.sourceUrl,layoutName:bound.layoutName,draft:{symbol:symbols[0],orderType:'MARKET',direction:active(buy)?'LONG':'SHORT',quantity,quantityRaw:raw},nativeAccountVerified:true});
  }catch(error){return result(error?.paperStartWaiting?'WAITING':'BLOCKED',error?.paperStartCode??'LIVE_PAPER_START_NATIVE_UI_FAILED');}
}
