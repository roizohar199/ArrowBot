// Serialized read-only diagnostics of the public historical trading controls.
// Never clicks a control or reads a private TradingView chart/broker object.
export function readReplayTradingPublicControls(){
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
  const visible=e=>{
    if(!e||![...e.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
    for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility==='hidden'||s.visibility==='collapse'||s.display==='none')return false;
      if(n!==e){const r=n.getBoundingClientRect(),clip=v=>['hidden','clip','auto','scroll'].includes(v);
        if(clip(s.overflowX)&&r.width<=0||clip(s.overflowY)&&r.height<=0)return false;}}
    return true;
  };
  const all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible);
  const base={kind:'PUBLIC_REPLAY_TRADING_CONTROL_INSPECTION',observedAt:Date.now(),ordersCreated:false,scope:'READ_ONLY_VISIBLE_PUBLIC_CONTROLS'};
  const block=code=>({...base,status:'BLOCKED',reasonCodes:[code]});
  const layout=all('[aria-label^="Logged in as"]');
  const charts=all('canvas[aria-label^="Chart for "]');
  const replay=document.querySelector('#header-toolbar-replay');
  if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||!location.pathname.startsWith('/chart/')||document.visibilityState!=='visible'||layout.length!==1||!/Active layout: Arrow /.test(layout[0].getAttribute('aria-label')??'')||charts.length!==1||charts[0].getAttribute('aria-label')!=='Chart for CME_MINI:NQ1!, 1 minute'||replay?.getAttribute('aria-pressed')!=='true')return block('EXACT_NQ_ONE_MINUTE_RESEARCH_REPLAY_REQUIRED');
  const panels=all('[aria-label="Trading panel"]');
  if(panels.length!==1)return block('ONE_VISIBLE_TRADING_PANEL_REQUIRED');
  const panel=panels[0],tickets=all('[aria-label="Order ticket"]',panel),positions=all('[data-name="position-panel"]',panel),
    dom=all('[role="radio"][aria-checked="true"]',panel).some(e=>norm(e.textContent)==='DOM');
  if(tickets.length>1||positions.length>1||!tickets.length&&!positions.length&&!dom)return block('PUBLIC_ORDER_DOM_OR_POSITION_PANEL_REQUIRED');
  const attributes=e=>Object.fromEntries(['aria-label','aria-checked','aria-selected','aria-disabled','aria-expanded','aria-pressed','data-name','data-qa-id','data-testid','data-role','data-overflow-tooltip-text','data-tooltip-text','title','id','role','type','class','style'].map(k=>[k,e.getAttribute(k)]).filter(([,v])=>v!==null).map(([k,v])=>[k,String(v).slice(0,240)]));
  const rect=e=>{const r=e.getBoundingClientRect();return Object.fromEntries(['x','y','left','top','right','bottom','width','height'].map(k=>[k,Number.isFinite(r[k])?r[k]:null]));};
  const ancestors=e=>{const result=[];for(let n=e.parentElement;n&&result.length<5;n=n.parentElement)result.push({tag:n.tagName,attributes:attributes(n),rect:rect(n)});return result;};
  const record=e=>({tag:e.tagName,attributes:attributes(e),text:norm(e.innerText??e.textContent).slice(0,180),rect:rect(e),
    ...('value' in e?{value:String(e.value).slice(0,180),disabled:e.disabled===true,readOnly:e.readOnly===true}:{}),
    ...('disabled' in e?{disabled:e.disabled===true}:{}),...('checked' in e?{checked:e.checked===true}:{})});
  const nodes=all('input,textarea,button,[role="button"],[role="tab"],[role="switch"]',panel).slice(0,120).map(record);
  const historical=all('button[aria-label="Collapse Replay Trading"],button[aria-label="Open Replay Trading"]');
  if(!historical.some(e=>e.getAttribute('aria-label')==='Collapse Replay Trading'&&norm(e.textContent)==='Replay Trading'))return block('NATIVE_REPLAY_TRADING_PROVIDER_REQUIRED');
  const grids=all('[class*="tv-dom-widget-main-"],[class*="tv-dom-widget-main__anchor-"]',panel).slice(0,8).map(e=>{
    const s=getComputedStyle(e);return {...record(e),ancestors:ancestors(e),clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,
      clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,scrollTop:e.scrollTop,overflowX:s.overflowX,overflowY:s.overflowY};
  });
  const cells=all('[data-qa-id^="dom-cell-"]',panel).slice(0,500),priceRows=cells.filter(e=>/^dom-cell-\d+-price$/.test(e.getAttribute('data-qa-id')??'')),
    orderCells=cells.filter(e=>/^dom-cell-\d+-orders-(buy|sell)$/.test(e.getAttribute('data-qa-id')??'')&&all('div[class*="tv-dom-widget-order-"]',e).length).slice(0,30).map(e=>{
      const row=/^dom-cell-(\d+)-/.exec(e.getAttribute('data-qa-id'))?.[1],price=priceRows.find(p=>p.getAttribute('data-qa-id')===`dom-cell-${row}-price`);
      return {...record(e),priceText:price?norm(price.textContent):null,ancestors:ancestors(e),
        children:all('div[class*="tv-dom-widget-order-"],span[class*="tv-dom-widget-order__qty-"],span[class*="tv-dom-widget-order__type-"],div[class*="tv-dom-widget-order__close-"]',e).slice(0,12).map(record)};
    });
  const chartAncestors=[];for(let n=charts[0].parentElement;n&&chartAncestors.length<5;n=n.parentElement){if(n===document.body||n===document.documentElement)break;chartAncestors.push(n);}
  const explicit=all('[data-name*="position"],[data-name*="order"],[data-qa-id*="position"],[data-qa-id*="protect"],[class*="orderLine"],[class*="order-line"],[class*="positionLine"],[class*="position-line"]')
    .filter(e=>!panel.contains(e)&&e.tagName!=='CANVAS'&&norm(e.innerText??e.textContent).length<220).slice(0,35),
    chartRoot=chartAncestors.at(-1),leafCandidates=chartRoot?all('span,button,[role="button"],[title],[aria-label],[data-name],[data-qa-id]',chartRoot).slice(0,600)
      .filter(e=>{const t=norm(e.innerText??e.textContent);return t.length>0&&t.length<130&&/(?:\b(?:BUY|SELL|LONG|SHORT|TP|SL)\b|protect position|take profit|stop loss|\b1\s*@\s*[\d,]+\.?\d*|\d[\d,.]*\s*USD)/i.test(t);}):[],
    chartTradeNodes=[...new Set([...explicit,...leafCandidates])].slice(0,50).map(e=>({...record(e),ancestors:ancestors(e)}));
  return {...base,status:'OBSERVED',researchUrl:location.origin+location.pathname,chart:{instrument:'CME_MINI:NQ1!',timeframe:'1',chartCount:1,replay:true},
    panelMode:positions.length?'POSITION_EDITOR':dom?'DOM':'ORDER_TICKET',historicalPanelControls:historical.map(record),
    ticketText:norm((tickets[0]??positions[0]??panel).textContent).slice(0,1800),panelHeadings:all('[title],[aria-label]',panel).slice(0,35).map(record),nodes,
    diagnostic:{readOnly:true,privateApiRead:false,chartAncestors:chartAncestors.map(e=>({tag:e.tagName,attributes:attributes(e),rect:rect(e)})),
      chartTradeNodes,domScrollSurfaces:grids,domModeControls:all('[data-qa-id="switch-mode-DOM"],[data-qa-id="position-DOM"],[data-qa-id="switch-pl-view"]',panel).map(e=>({...record(e),ancestors:ancestors(e)})),
      domAggregateCounters:all('[title]',panel).filter(e=>/^\d+ active orders? x \d+$/.test(norm(e.getAttribute('title')))).slice(0,8).map(e=>({...record(e),ancestors:ancestors(e),
        parent:e.parentElement?{...record(e.parentElement),children:[...e.parentElement.children].slice(0,18).map(record)}:null})),
      visiblePriceRows:priceRows.slice(0,90).map(record),visibleProtectionOrderCells:orderCells,
      limits:{chartTradeNodes:50,chartLeafCandidatesScanned:600,domScrollSurfaces:8,orderCells:30,ancestorDepth:5,fullBodyTextRead:false,fullBodyHtmlRead:false}}};
}
