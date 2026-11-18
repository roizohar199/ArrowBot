// Serialized public-UI inspection. Only the owned Order radio and its preset
// menu toggle may be activated. Never selects/saves a preset or edits an input.
export async function inspectReplayOrderPreset(command={}){
  const expected=command?.expected??{},norm=x=>String(x??'').replace(/\s+/g,' ').trim(),number=x=>{const s=norm(x).replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(s)?Number(s):null;},
    visible=n=>{if(!n?.isConnected||![...n.getClientRects()].some(r=>r.width>0&&r.height>0))return false;for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p);if(s.visibility==='hidden'||s.visibility==='collapse'||s.display==='none'||s.contentVisibility==='hidden')return false;
      if(p!==n){const clip=x=>['hidden','clip','auto','scroll'].includes(x),r=p.getBoundingClientRect();if(clip(s.overflowX??s.overflow)&&r.width<=0||clip(s.overflowY??s.overflow)&&r.height<=0)return false;}}return true;},
    all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible),one=(s,r=document)=>{const a=all(s,r);return a.length===1?a[0]:null;},label=n=>norm(n?.textContent),
    disabled=n=>!n||n.disabled===true||n.getAttribute('aria-disabled')==='true',fail=code=>{throw Object.assign(new Error(code),{presetCode:code});},
    slot=Symbol.for('arrow.replay-order-preset-inspector.v1'),memory=globalThis[slot]??(globalThis[slot]={busy:false,generation:0});
  const navigation={originalMode:null,finalMode:null,modeRestored:false,openedOrderTab:false,menuAlreadyOpen:false,menuOpenedByInspector:false,menuClosedByInspector:false},base={kind:'REPLAY_ORDER_PRESET_READ_ONLY_INSPECTION',provider:'REPLAY_TRADING',observedAt:Date.now(),
    protectionPresetVerified:false,inheritanceVerified:false,orderEligible:false,submitCapabilityCreated:false,leaseMinted:false,ordersCreated:false,inputValuesChangedByInspector:false,presetSelectedByInspector:false,presetSaved:false,navigation};
  if(memory.busy)return {...base,status:'BLOCKED',reasonCodes:['REPLAY_PRESET_INSPECTOR_BUSY']};
  memory.busy=true;const generation=++memory.generation;let cancelled=false,openedByInspector=false,outcome=null,ownedButton=null,ownedPopup=null,ownedDraftSignature=null;
  const events=['pointerdown','keydown','beforeinput','wheel','touchstart','visibilitychange','pagehide'],onActivity=e=>{if(e?.isTrusted===true)cancelled=true;};
  for(const e of events)document.addEventListener(e,onActivity,{capture:true,passive:true});
  function identity(allowTransition=false){
    if(cancelled||memory.generation!==generation)fail('REPLAY_PRESET_INSPECTION_INTERRUPTED');
    if(document.visibilityState!=='visible'||document.hidden===true)fail('REPLAY_PRESET_VISIBLE_RESEARCH_REQUIRED');
    if(command.direction!==undefined&&!['LONG','SHORT'].includes(command.direction))fail('REPLAY_PRESET_DIRECTION_INVALID');
    let url;try{url=new URL(expected.researchUrl);if(url.search||url.hash||url.username||url.password)throw Error();}catch{fail('REPLAY_PRESET_EXACT_RESEARCH_URL_REQUIRED');}
    if(location.protocol!=='https:'||!['tradingview.com','www.tradingview.com'].includes(location.hostname)||!/^\/chart\/[A-Za-z0-9_-]+\/$/.test(location.pathname)||url.origin+url.pathname!==location.origin+location.pathname)fail('REPLAY_PRESET_RESEARCH_TARGET_MISMATCH');
    if(expected.instrument!=='CME_MINI:NQ1!'||expected.timeframe!=='1'||!Number.isSafeInteger(expected.sourceTabId)||expected.sourceTabId<1)fail('REPLAY_PRESET_EXACT_NQ_MINUTE_TARGET_REQUIRED');
    const layout=one('[aria-label^="Logged in as"]'),charts=all('canvas[aria-label^="Chart for "]'),replay=one('#header-toolbar-replay'),footer=one('#footer-chart-panel'),provider=footer&&one('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',footer);
    if(!layout||!/Active layout: Arrow /.test(layout.getAttribute('aria-label')??'')||charts.length!==1||charts[0].getAttribute('aria-label')!=='Chart for CME_MINI:NQ1!, 1 minute')fail('REPLAY_PRESET_OWN_SINGLE_RESEARCH_CHART_REQUIRED');
    if(replay?.getAttribute('aria-pressed')!=='true'||!provider||label(provider)!=='Replay Trading')fail('REPLAY_PRESET_NATIVE_REPLAY_PROVIDER_REQUIRED');
    if(all('[role="dialog"]').length)fail('REPLAY_PRESET_EXISTING_DIALOG_REQUIRES_REVIEW');
    if(all('[aria-label="Account manager"],[data-qa-id="account-selector"]').length||all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]').some(n=>label(n)))fail('REPLAY_PRESET_PAPER_OR_REAL_BROKER_EXCLUDED');
    const panel=one('[aria-label="Trading panel"]'),ticket=panel&&one('[aria-label="Order ticket"]',panel),radios=panel?all('[role="radio"]',panel):[],
      order=radios.filter(n=>label(n)==='Order'&&n.getAttribute('aria-checked')==='true'),dom=radios.filter(n=>label(n)==='DOM'&&n.getAttribute('aria-checked')==='true'),mode=ticket&&order.length===1?'ORDER':!ticket&&dom.length===1?'DOM':null;
    if(!panel||!mode){if(allowTransition)return {panel,ticket,mode:'TRANSITION'};fail('REPLAY_PRESET_ORDER_OR_DOM_VIEW_REQUIRED');}
    const titles=all('[title]',panel).map(n=>n.getAttribute('title')),logos=all('img[src]',panel).filter(n=>{try{const u=new URL(n.getAttribute('src'));return u.protocol==='https:'&&u.hostname==='static.tradingview.com'&&/^\/static\/bundles\/replay-broker\.[a-z0-9]+\.svg$/.test(u.pathname);}catch{return false;}});
    if(titles.filter(t=>t==='NQ1!').length!==1||titles.some(t=>/^NQ[HMUZ]20\d\d$/.test(t??'')||/^NQ1!, order /.test(t??''))||logos.length!==1||all('[data-name="position-panel"]',panel).length)fail('REPLAY_PRESET_FRESH_NQ_TICKET_REQUIRED');
    return {panel,ticket,mode};
  }
  function pointer(node){
    if(disabled(node)||!visible(node))fail('REPLAY_PRESET_OWN_CONTROL_UNAVAILABLE');
    const r=node.getBoundingClientRect(),init={bubbles:true,cancelable:true,composed:true,view:globalThis.window,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,pointerId:1,pointerType:'mouse',isPrimary:true};
    if(typeof MouseEvent!=='function')fail('REPLAY_PRESET_PUBLIC_POINTER_UNAVAILABLE');
    if(typeof PointerEvent==='function')node.dispatchEvent(new PointerEvent('pointerdown',{...init,buttons:1}));node.dispatchEvent(new MouseEvent('mousedown',{...init,buttons:1}));
    if(typeof PointerEvent==='function')node.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0}));node.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0}));node.dispatchEvent(new MouseEvent('click',{...init,buttons:0}));
  }
  async function until(check,{transition=false}={}){
    const started=performance.now();while(performance.now()-started<1500){identity(transition);if(check()){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));identity(transition);if(check())return;}
      await new Promise(resolve=>setTimeout(resolve,25));}fail('REPLAY_PRESET_OWN_CONTROL_DID_NOT_SETTLE');
  }
  function menu(){
    // These exact popup/empty-state classes were captured from the native UI.
    // Unknown future saved-row markup is recorded but never promoted to a
    // verified selected preset merely because text happens to be present.
    const roots=all('div[class~="flex-go0ZeNQF"]').filter(n=>/Save order preset(?:\.{3}|…)/.test(label(n)));
    if(roots.length>1)fail('REPLAY_PRESET_MENU_AMBIGUOUS');return roots[0]??null;
  }
  const record=n=>({tag:n.tagName??null,text:label(n).slice(0,200),...('value' in n?{valueRaw:String(n.value).slice(0,240)}:{}),...('checked' in n?{checked:n.checked===true}:{}),
    attributes:Object.fromEntries(['role','aria-label','aria-selected','aria-checked','data-name','data-qa-id','title','class'].map(k=>[k,n.getAttribute(k)]).filter(([,v])=>v!==null).map(([k,v])=>[k,String(v).slice(0,240)]))});
  function ticketSnapshot(bound){
    const root=bound.ticket,read=s=>{const n=one(s,root);return n?{present:true,valueRaw:String(n.value??''),value:number(n.value),disabled:n.disabled===true,readOnly:n.readOnly===true}:{present:false,valueRaw:null,value:null};},
      selected=all('[role="tab"][aria-selected="true"]',root),submit=one('[data-name="place-and-modify-button"]',root),side=/^(Buy|Sell)\s+/.exec(label(submit));
    const bracket=which=>{const sw=one(`[data-qa-id="order-ticket-${which}-checkbox-bracket"]`,root),mode=one(`[data-qa-id="order-ticket-${which}-dropdown-button"]`,root),raw=label(mode),
      checked=typeof sw?.checked==='boolean'?sw.checked:null,aria=sw?.getAttribute('aria-checked')??null;
      return {switchPresent:!!sw,checkedProperty:checked,ariaChecked:aria,enabled:checked!==null&&['true','false'].includes(aria)?checked&&aria==='true':null,
        switchConsistent:checked!==null&&['true','false'].includes(aria)?checked===(aria==='true'):false,unitLabel:mode?raw:null,
        unit:/\bticks\b/i.test(raw)?'TICKS':/\bprice\b/i.test(raw)?'PRICE':/percent|%/i.test(raw)?'PERCENT':/USD|dollar/i.test(raw)?'USD':null,
        ...read(`input[data-qa-id~="order-ticket-${which}-input"]`)};};
    const labelled=all('button,input,[role="button"],[role="combobox"]',root).filter(n=>/time in force|order duration|validity/i.test(norm(n.getAttribute('aria-label')||n.getAttribute('data-qa-id')||n.textContent)));
    return {kind:'VISIBLE_NATIVE_REPLAY_ORDER_DRAFT',orderType:selected.length===1?label(selected[0]).toUpperCase():null,nativeSide:side?side[1].toUpperCase():null,requestedDirection:command.direction??null,
      quantity:read('input[aria-label="Units"]'),entry:read('input[data-qa-id~="order-ticket-absolute-price-input"]'),stopLoss:bracket('stop-loss'),takeProfit:bracket('take-profit'),timeInForce:{available:labelled.length>0,observedControls:labelled.slice(0,8).map(record)},
      draftIsNotSavedPreset:true,submitControlObserved:!!submit,submitControlActivated:false};
  }
  try{
    let bound=identity();navigation.originalMode=bound.mode;
    if(bound.mode==='DOM'&&menu()){navigation.menuAlreadyOpen=true;fail('REPLAY_PRESET_EXISTING_MENU_REQUIRES_REVIEW');}
    if(bound.mode==='DOM'){
      const order=all('[role="radio"]',bound.panel).filter(n=>label(n)==='Order');if(order.length!==1)fail('REPLAY_PRESET_EXACT_ORDER_RADIO_REQUIRED');
      pointer(order[0]);navigation.openedOrderTab=true;await until(()=>{try{return identity(true).mode==='ORDER';}catch(e){if(e?.presetCode==='REPLAY_PRESET_ORDER_OR_DOM_VIEW_REQUIRED')return false;throw e;}},{transition:true});bound=identity();
    }
    if(bound.mode!=='ORDER'||!bound.ticket)fail('REPLAY_PRESET_FRESH_ORDER_TICKET_REQUIRED');
    const before=ticketSnapshot(bound);ownedDraftSignature=JSON.stringify(before);ownedButton=one('button[data-qa-id="header-order-presets-menu-button"]',bound.panel);if(!ownedButton)fail('REPLAY_PRESET_EXACT_HEADER_MENU_REQUIRED');
    let popup=menu();navigation.menuAlreadyOpen=!!popup;
    if(!popup){
      if((ownedButton.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-')))fail('REPLAY_PRESET_OPEN_MENU_SCHEMA_UNSUPPORTED');
      pointer(ownedButton);openedByInspector=true;navigation.menuOpenedByInspector=true;
      await until(()=>{const observed=menu();if(observed&&ownedPopup&&observed!==ownedPopup)fail('REPLAY_PRESET_MENU_OWNER_CHANGED');if(observed&&!ownedPopup)ownedPopup=observed;return !!observed;});popup=menu();
    }
    identity();const empty=all('div[class~="emptyStateText-smD5tLxJ"]',popup).filter(n=>label(n)==='No order presets created yet'),
      semanticRows=all('[role="menuitemradio"],[role="option"]',popup).filter(n=>label(n)&&!/^Save order preset(?:\.{3}|…)$/.test(label(n))).slice(0,20),
      rows=semanticRows.map(n=>({name:label(n).slice(0,200),selected:n.getAttribute('aria-checked')==='true'||n.getAttribute('aria-selected')==='true',...record(n)})),
      selected=rows.filter(r=>r.selected),after=ticketSnapshot(identity());
    if(JSON.stringify(before)!==JSON.stringify(after))fail('REPLAY_PRESET_DRAFT_CHANGED_DURING_INSPECTION');
    const none=empty.length===1;
    outcome={...base,status:none?'USER_REPLAY_BRACKET_PRESET_MISSING':'USER_REPLAY_BRACKET_PRESET_UNVERIFIED',reasonCodes:[none?'NO_SAVED_REPLAY_ORDER_PRESETS':'USER_NAMED_PRESET_PARAMETERS_AND_INHERITANCE_PROOF_REQUIRED'],
      researchUrl:expected.researchUrl,sourceTabId:expected.sourceTabId,instrument:'CME_MINI:NQ1!',timeframe:'1',ticket:after,
      presets:{state:none?'NONE':rows.length?'SEMANTIC_ROWS_OBSERVED':'SAVED_ROW_SCHEMA_UNSUPPORTED',emptyMessage:none?'No order presets created yet':null,names:none?[]:rows.length?rows.map(r=>r.name):null,
        selectedName:selected.length===1?selected[0].name:null,selectedIdentityVerified:false,semanticRows:rows,rawControls:all('button,[role],[data-qa-id]',popup).slice(0,30).map(record),menuText:label(popup).slice(0,2000)},
      inheritanceScope:'NO_USER_PRESET_OR_MARKET_BRACKET_INHERITANCE_IS_INFERRED_FROM_AN_ORDER_DRAFT'};
  }catch(error){outcome={...base,status:'BLOCKED',reasonCodes:[error?.presetCode??'REPLAY_PRESET_INSPECTION_FAILED']};}
  finally{
    let cleanupSafe=true;
    if(openedByInspector){
      try{
        const fresh=identity(),current=one('button[data-qa-id="header-order-presets-menu-button"]',fresh.panel),currentPopup=menu(),active=current&&(current.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-'));
        if(currentPopup&&currentPopup!==ownedPopup)fail('REPLAY_PRESET_MENU_OWNER_CHANGED');
        if(current!==ownedButton){
          // Native Order header can remount while its same popup stays open.
          // A selector match alone never grants ownership of another menu.
          if(!current||fresh.mode!=='ORDER'||!ownedPopup||currentPopup!==ownedPopup||!visible(ownedPopup)||!active
            ||JSON.stringify(ticketSnapshot(fresh))!==ownedDraftSignature)fail('REPLAY_PRESET_MENU_OWNER_CHANGED');
          ownedButton=current;navigation.menuButtonReboundAfterNativeRemount=true;
        }
        if(menu()||(current.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-'))){
          pointer(current);
          await until(()=>{
            const settled=identity(),button=one('button[data-qa-id="header-order-presets-menu-button"]',settled.panel),popup=menu();
            if(popup&&popup!==ownedPopup)fail('REPLAY_PRESET_MENU_OWNER_CHANGED');
            if(settled.mode!=='ORDER'||JSON.stringify(ticketSnapshot(settled))!==ownedDraftSignature)fail('REPLAY_PRESET_DRAFT_CHANGED_DURING_MENU_CLOSE');
            if(button&&button!==current)navigation.menuCloseHeaderReboundAfterNativeRemount=true;
            return !!button&&!popup&&!(button.getAttribute('class')??'').split(/\s+/).some(c=>c.startsWith('active-'));
          });
        }
        navigation.menuClosedByInspector=true;
      }catch(error){cleanupSafe=false;outcome={...outcome,status:'BLOCKED',reasonCodes:[...new Set([...(outcome?.reasonCodes??[]),error?.presetCode??'REPLAY_PRESET_OWN_MENU_CLOSE_UNVERIFIED'])]};}
    }
    if(cancelled)navigation.cleanupSkippedBecauseUserInput=true;
    else if(cleanupSafe){
      try{
        const current=identity();
        if(navigation.originalMode==='DOM'&&navigation.openedOrderTab){
          if(menu())fail('REPLAY_PRESET_UNOWNED_MENU_PREVENTS_MODE_RESTORE');
          const dom=all('[role="radio"]',current.panel).filter(n=>label(n)==='DOM');if(dom.length!==1)fail('REPLAY_PRESET_EXACT_DOM_RESTORE_CONTROL_REQUIRED');
          pointer(dom[0]);await until(()=>identity(true).mode==='DOM',{transition:true});
        }
        navigation.finalMode=identity().mode;navigation.modeRestored=navigation.finalMode===navigation.originalMode;
        if(!navigation.modeRestored)fail('REPLAY_PRESET_ORIGINAL_MODE_RESTORE_UNVERIFIED');
      }catch(error){outcome={...outcome,status:'BLOCKED',reasonCodes:[...new Set([...(outcome?.reasonCodes??[]),error?.presetCode??'REPLAY_PRESET_ORIGINAL_MODE_RESTORE_UNVERIFIED'])]};}
    }
    for(const e of events)document.removeEventListener(e,onActivity,{capture:true});memory.busy=false;
  }
  return outcome;
}
