// One bounded public-UI action per call. This function is serialized directly
// into the chart tab's isolated world; it has no module or private-page state.
export function prepareTradingViewWindowUi({phase='window',expectedStudyTitle='Arrow OHLC Window v2',allowResearchMultiChart=false,allowResearchLiveMultiChart=false,clearHistoricalPointer=false,sourceUrl=null}={}){
  const result=(status,reason,action=null,extra={})=>({status,phase,action,reasonCodes:[reason],...extra});
  if(phase!=='window')return result('INVALID','WINDOW_PREPARE_PHASE_INVALID');
  if(expectedStudyTitle!=='Arrow OHLC Window v2')return result('INVALID','WINDOW_PREPARE_STUDY_INVALID');
  if(typeof clearHistoricalPointer!=='boolean')return result('INVALID','WINDOW_PREPARE_CONFIGURATION_INVALID');
  if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||!location.pathname.startsWith('/chart/'))return result('UNAVAILABLE','TRADINGVIEW_CHART_REQUIRED');
  const query=(scope,selector,max=300)=>{const nodes=scope.querySelectorAll(selector);return nodes.length>max?null:Array.from(nodes);};
  const rect=node=>node?.getBoundingClientRect?.();
  const rendered=node=>{
    const box=rect(node);if(!box||box.width<=0||box.height<=0)return false;
    let parent=node,depth=0;
    // TradingView's observed control/content paths can exceed 20 ancestors.
    for(;parent&&depth<64;parent=parent.parentElement,depth++){
      const style=getComputedStyle(parent);
      if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.opacity!==''&&Number(style.opacity)===0||style.contentVisibility==='hidden')return false;
    }
    return !parent;
  };
  const onscreen=node=>{const box=rect(node);return rendered(node)&&box.right>0&&box.bottom>0&&box.left<innerWidth&&box.top<innerHeight;};
  const allCanvases=query(document,'canvas[aria-label^="Chart for "]',20);
  if(!allCanvases)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
  const charts=allCanvases.filter(onscreen);
  const researchLayout=query(document,'button[aria-label*="Active layout: Arrow "]',20)?.[0],interval=query(document,'#header-toolbar-intervals [aria-checked="true"]',20)?.[0]?.getAttribute('data-value'),replay=query(document,'#header-toolbar-replay',20)?.[0];
  const researchMultiChart=allowResearchMultiChart===true&&charts.length>=2&&charts.length<=3&&researchLayout&&onscreen(researchLayout)&&interval==='1'&&(replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked'))==='true'&&charts.every(node=>/^Chart for CME_MINI:NQ1!, /.test(node.getAttribute('aria-label')??''))&&charts.filter(node=>node.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length===1;
  let liveLayoutName=null;
  try{const url=new URL(location.href);if(url.protocol==='https:'&&url.protocol===location.protocol&&url.hostname===location.hostname&&url.pathname===location.pathname&&['www.tradingview.com','tradingview.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash)liveLayoutName=url.pathname==='/chart/ARROWRV1/'?'Arrow OHLC Live Verification':url.pathname==='/chart/ARROWFR1/'?'Full Screens Live':null;}catch{}
  const liveLayouts=query(document,'button[aria-label*="Active layout: "]',20)?.filter(onscreen)??[];
  const liveIntervals=query(document,'#header-toolbar-intervals [aria-checked="true"]',20)?.filter(onscreen)??[];
  const liveReplay=query(document,'#header-toolbar-replay',20)?.filter(onscreen)??[];
  const researchLiveMultiChart=allowResearchLiveMultiChart===true&&liveLayoutName!==null&&liveLayouts.length===1
    &&(liveLayouts[0].getAttribute('aria-label')??'').replace(/\s+/g,' ').trim().endsWith('Active layout: '+liveLayoutName)
    &&charts.length>=2&&charts.length<=3&&charts.every(node=>/^Chart for CME_MINI:NQ1!, [^,]+$/.test(node.getAttribute('aria-label')??''))
    &&charts.filter(node=>node.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length===1&&liveIntervals.length===1&&liveIntervals[0].getAttribute('data-value')==='1'
    &&liveReplay.length===1&&(liveReplay[0].getAttribute('aria-pressed')??liveReplay[0].getAttribute('aria-checked'))==='false';
  if(typeof allowResearchMultiChart!=='boolean'||typeof allowResearchLiveMultiChart!=='boolean')return result('INVALID','WINDOW_PREPARE_CONFIGURATION_INVALID');
  if(charts.length!==1&&!researchMultiChart&&!researchLiveMultiChart)return result('UNAVAILABLE','SINGLE_VISIBLE_CHART_REQUIRED',null,{visibleCharts:charts.length});
  const dialogs=query(document,'[role="dialog"], [aria-modal="true"]',30);
  if(!dialogs)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
  if(dialogs.some(onscreen))return result('BLOCKED','UNRELATED_DIALOG_OPEN');
  const allTabs=query(document,'[role="tab"]',100);
  if(!allTabs)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
  const tabs=allTabs.filter(node=>rendered(node)&&(node.textContent??'').trim().replace(/\s+/g,' ')==='Data window');
  if(tabs.length>1)return result('UNAVAILABLE','DATA_WINDOW_TAB_AMBIGUOUS');
  if(!tabs.length){
    const buttons=query(document,'button[aria-label="Object tree and data window"]',10);
    if(!buttons)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
    const visibleButtons=buttons.filter(onscreen);
    if(visibleButtons.length!==1)return result('UNAVAILABLE',visibleButtons.length?'DATA_WINDOW_PANEL_BUTTON_AMBIGUOUS':'DATA_WINDOW_PANEL_BUTTON_NOT_FOUND');
    const button=visibleButtons[0];
    if(button.disabled||button.getAttribute('aria-disabled')==='true')return result('UNAVAILABLE','DATA_WINDOW_PANEL_BUTTON_DISABLED');
    if(button.getAttribute('aria-pressed')==='true'||button.getAttribute('aria-expanded')==='true')return result('WAITING','DATA_WINDOW_PANEL_MOUNTING');
    button.click();return result('ACTION_TAKEN','DATA_WINDOW_PANEL_OPEN_REQUESTED','OPEN_DATA_WINDOW_PANEL');
  }
  const tab=tabs[0];
  if(tab.getAttribute('aria-selected')!=='true'){
    if(!onscreen(tab)||tab.disabled||tab.getAttribute('aria-disabled')==='true')return result('UNAVAILABLE','DATA_WINDOW_TAB_NOT_ACTIONABLE');
    tab.click();return result('ACTION_TAKEN','DATA_WINDOW_TAB_SELECT_REQUESTED','SELECT_DATA_WINDOW_TAB');
  }
  if(!onscreen(tab))return result('UNAVAILABLE','DATA_WINDOW_TAB_NOT_VISIBLE');
  const rows=query(document,'[role="treegrid"] > div[role="row"]',200);
  if(!rows)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
  const owned=[];
  for(const row of rows){
    if(!rendered(row))continue;
    const titles=query(row,'span[title]',20);if(!titles)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
    // TradingView omits the optional tooltip title on offscreen study headers.
    // Accept text only from the direct study header, never from plot/body text.
    const headers=query(row,':scope > div[class*="header-"] > span[class*="headerTitle-"]',20);if(!headers)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
    const title=titles.find(node=>(node.getAttribute('title')??'').startsWith(expectedStudyTitle))??headers.find(node=>!node.getAttribute('title')&&/^Arrow OHLC Window v2(?:\s|\(|$)/.test((node.textContent??'').replace(/\s+/g,' ').trim()));
    if(title)owned.push({row,title});
  }
  if(owned.length!==1)return result('UNAVAILABLE',owned.length?'WINDOW_STUDY_AMBIGUOUS':'WINDOW_STUDY_NOT_FOUND');
  const {row,title}=owned[0];
  // Scroll only the nearest overflow ancestor of our own study. Never use
  // scrollIntoView(), document scrolling, keyboard input or another pane.
  let panel=row.parentElement;
  for(let depth=0;panel&&panel!==document.body&&panel!==document.documentElement&&depth<20;panel=panel.parentElement,depth++){
    const style=getComputedStyle(panel);
    if(panel.scrollHeight>panel.clientHeight+2&&['auto','scroll'].includes(style.overflowY)){
      const box=rect(panel),target=rect(title),top=box.top+(panel.clientTop??0),bottom=top+panel.clientHeight;
      let delta=target.top<top?target.top-top:target.bottom>bottom?target.bottom-bottom:0;
      const before=panel.scrollTop,next=Math.max(0,Math.min(panel.scrollHeight-panel.clientHeight,before+delta));
      if(Number.isFinite(next)&&Math.abs(next-before)>1){panel.scrollTop=next;return result('ACTION_TAKEN','WINDOW_OWN_STUDY_SCROLL_REQUESTED','SCROLL_OWN_STUDY');}
      break;
    }
  }
  const plots=query(row,'[data-test-id-value-title^="ARROW2_"]',70);
  if(!plots)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
  if(plots.length){
    if(clearHistoricalPointer){
      // Only release the historical crosshair on the reviewed, visible LIVE
      // NQ minute chart. No click, focus, scroll, input or order action.
      if(sourceUrl!==location.href||!liveLayoutName||document.visibilityState!=='visible'||document.hidden===true
        ||liveIntervals.length!==1||liveIntervals[0].getAttribute('data-value')!=='1'||liveReplay.length!==1
        ||(liveReplay[0].getAttribute('aria-pressed')??liveReplay[0].getAttribute('aria-checked'))!=='false'
        ||charts.filter(n=>n.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length!==1)return result('BLOCKED','WINDOW_POINTER_LIVE_SCOPE_REQUIRED');
      const fields=name=>plots.filter(n=>n.getAttribute('data-test-id-value-title')===name),read=name=>{
        const f=fields(name);if(f.length!==1||f[0].parentElement?.children?.length!==2)return null;
        const raw=String(f[0].parentElement.children[1].textContent??'').replace(/[ ,\u00a0\u202f\u2009\u200e\u200f]/g,'');
        return /^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;
      };
      const seq=read('ARROW2_SEQ_BEGIN'),stamp=read('ARROW2_SOURCE_EPOCH'),end=read('ARROW2_SEQ_END');
      if(seq===null||stamp===null||end!==seq||Math.floor(stamp/1e12)!==seq%4096)return result('WAITING','WINDOW_POINTER_COHERENT_STAMP_REQUIRED');
      const emitted=stamp%1e12+1577836800000;
      if(emitted>=Date.now()-15000)return result('READY','WINDOW_POINTER_SOURCE_ALREADY_CURRENT');
      if(typeof MouseEvent!=='function')return result('UNAVAILABLE','WINDOW_POINTER_PUBLIC_EVENT_UNAVAILABLE');
      const minute=charts.find(n=>n.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute'),box=rect(title),init={bubbles:true,cancelable:true,composed:true,view:globalThis.window,buttons:0,button:0,clientX:box.left+box.width/2,clientY:box.top+box.height/2,relatedTarget:title};
      if(typeof PointerEvent==='function'){minute.dispatchEvent(new PointerEvent('pointerout',{...init,pointerId:1,pointerType:'mouse',isPrimary:true}));minute.dispatchEvent(new PointerEvent('pointerleave',{...init,bubbles:false,pointerId:1,pointerType:'mouse',isPrimary:true}));}
      minute.dispatchEvent(new MouseEvent('mouseout',init));minute.dispatchEvent(new MouseEvent('mouseleave',{...init,bubbles:false}));
      return result('ACTION_TAKEN','WINDOW_HISTORICAL_POINTER_RELEASE_REQUESTED','RELEASE_HISTORICAL_POINTER',{layoutChanged:false,timeframeChanged:false,ordersCreated:false,submitted:false,numericInputsSet:false,emittedAt:emitted});
    }
    return result('READY','DATA_WINDOW_OWN_PLOTS_READY',null,{mountedFields:plots.length});
  }
  const ownButtons=query(row,'button, [role="button"]',30);
  if(!ownButtons)return result('UNAVAILABLE','WINDOW_PREPARE_SCOPE_LIMIT');
  const expand=ownButtons.filter(node=>rendered(node)&&(node.getAttribute('aria-label')==='Show data'||node.getAttribute('title')==='Show data'||(node.textContent??'').trim()==='Show data'));
  if(expand.length>1)return result('UNAVAILABLE','WINDOW_SHOW_DATA_AMBIGUOUS');
  if(!expand.length)return result('WAITING','WINDOW_OWN_PLOTS_NOT_MOUNTED');
  const button=expand[0];
  if(button.getAttribute('aria-expanded')==='true')return result('WAITING','WINDOW_OWN_PLOTS_MOUNTING');
  if(!onscreen(button)||button.disabled||button.getAttribute('aria-disabled')==='true')return result('UNAVAILABLE','WINDOW_SHOW_DATA_NOT_ACTIONABLE');
  button.click();return result('ACTION_TAKEN','WINDOW_OWN_STUDY_EXPAND_REQUESTED','EXPAND_OWN_STUDY');
}
