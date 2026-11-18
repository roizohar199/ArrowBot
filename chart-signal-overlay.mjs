// This command is serialized into TradingView's isolated world. It owns only
// its two pointer-transparent cards; it never places a price-aligned marker,
// clicks the page, reads private chart objects or submits an order.
export async function chartSignalOverlayCommand({action,sessionId,mode,expectedInstrument,expectedTimeframe,expectedSourceSession,expectedSourceRunEpoch,signal}={}){
  const key='__arrowChartSignalOverlayV1',ids={LIVE:'arrow-chart-signal-live-v1',TEST:'arrow-chart-signal-test-v1'};
  const epoch=()=>performance.timeOrigin+performance.now();
  const receiptAt=epoch(),meaning='renderopportunitynotphysical';
  const response=(status,extra={})=>({status,mode:mode??null,eventId:signal?.eventId??null,documentTimeOrigin:performance.timeOrigin,renderReceiptEpoch:receiptAt,mutationEpoch:null,firstPaintEpoch:null,secondPaintEpoch:null,meaning,physicalDisplayMeasured:false,...extra});
  const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
  if(!['show','clear','read'].includes(action)||!bounded(sessionId,200)||mode!==undefined&&!['LIVE','TEST'].includes(mode))return response('INVALID_COMMAND');
  let state=globalThis[key];
  const ownedEntries=()=>Object.values(state?.entries??{});
  if(action==='read'){
    return response('OK',{cards:ownedEntries().filter(entry=>entry.sessionId===sessionId&&(!mode||entry.mode===mode)).map(entry=>({mode:entry.mode,sessionId:entry.sessionId,eventId:entry.eventId,status:entry.status,receipt:entry.receipt?{...entry.receipt}:null})),activeModes:ownedEntries().filter(entry=>entry.sessionId===sessionId).map(entry=>entry.mode)});
  }
  if(action==='clear'){
    const matches=ownedEntries().filter(entry=>entry.sessionId===sessionId&&(!mode||entry.mode===mode));
    for(const entry of matches)state.remove(entry,'CLEARED');
    state?.releaseIfEmpty?.();
    return response(matches.length?'CLEARED':ownedEntries().some(entry=>!mode||entry.mode===mode)?'STALE_SESSION':'EMPTY',{clearedModes:matches.map(entry=>entry.mode)});
  }
  if(!['LIVE','TEST'].includes(mode)||!bounded(expectedInstrument,200)||!bounded(expectedTimeframe,20)||!signal||typeof signal!=='object'||Array.isArray(signal)||!bounded(signal.eventId,512)||!['LONG','SHORT'].includes(signal.direction)||![signal.confirmationClose,signal.invalidation].every(Number.isFinite)||!Number.isSafeInteger(signal.confirmationBarCloseTime)||signal.confirmationBarCloseTime<0||!Number.isFinite(new Date(signal.confirmationBarCloseTime).getTime())||signal.patternIds!==undefined&&(!Array.isArray(signal.patternIds)||signal.patternIds.length>32||signal.patternIds.some(id=>!bounded(id,80))))return response('INVALID_SIGNAL');
  if(expectedSourceSession!==undefined&&!bounded(expectedSourceSession,200)||expectedSourceRunEpoch!==undefined&&(!Number.isSafeInteger(expectedSourceRunEpoch)||expectedSourceRunEpoch<1577836800000))return response('INVALID_SOURCE_BINDING');
  if(!Number.isFinite(receiptAt))return response('INVALID_LOCAL_CLOCK');
  if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||!location.pathname.startsWith('/chart/'))return response('TRADINGVIEW_CHART_REQUIRED');
  const quantity=signal.riskPlan?.quantity,planned=signal.riskPlan?.status==='PLANNED'&&Number.isSafeInteger(quantity)&&quantity>0&&quantity<=100000;
  if(mode==='LIVE'&&!planned)return response('PLANNED_RISK_REQUIRED');
  if(mode==='LIVE'&&(signal.status!=='CONFIRMED'||signal.execution!=='OBSERVATION_ONLY'||signal.orderEligible!==false))return response('CONFIRMED_SIGNAL_REQUIRED');
  const rendered=node=>{
    const box=node?.getBoundingClientRect?.();if(!box||box.width<=0||box.height<=0)return false;
    let parent=node,depth=0;
    for(;parent&&depth<64;parent=parent.parentElement,depth++){
      const style=getComputedStyle(parent);
      if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.contentVisibility==='hidden'||style.opacity!==''&&Number(style.opacity)===0)return false;
    }
    return !parent;
  };
  const onscreen=node=>{
    const box=node?.getBoundingClientRect?.();return rendered(node)&&box.right>0&&box.bottom>0&&box.left<innerWidth&&box.top<innerHeight;
  };
  const visibleCanvasBox=node=>{
    if(!onscreen(node))return null;
    const box=node.getBoundingClientRect();let left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom),parent=node,depth=0;
    for(;parent&&depth<64;parent=parent.parentElement,depth++){
      const style=getComputedStyle(parent),clipX=['auto','scroll','hidden','clip','overlay'].includes(style.overflowX??style.overflow),clipY=['auto','scroll','hidden','clip','overlay'].includes(style.overflowY??style.overflow);
      if(clipX||clipY){const bounds=parent.getBoundingClientRect(),x=bounds.left+(parent.clientLeft??0),y=bounds.top+(parent.clientTop??0);if(clipX){left=Math.max(left,x);right=Math.min(right,x+(parent.clientWidth??bounds.width));}if(clipY){top=Math.max(top,y);bottom=Math.min(bottom,y+(parent.clientHeight??bounds.height));}if(right<=left||bottom<=top)return null;}
    }
    return parent?null:{left,right,top,bottom,width:right-left,height:bottom-top};
  };
  const sourceProof=()=>{
    if(document.visibilityState!=='visible'||document.hidden===true)return {ok:false,status:'DOCUMENT_HIDDEN'};
    const ownedSource=globalThis.__arrowWindowFeedV2;
    if(expectedSourceSession!==undefined&&ownedSource?.sessionId!==expectedSourceSession)return {ok:false,status:'SOURCE_SESSION_MISMATCH'};
    if(expectedSourceRunEpoch!==undefined&&ownedSource?.bootstrap?.runEpoch!==expectedSourceRunEpoch)return {ok:false,status:'SOURCE_RUN_EPOCH_MISMATCH'};
    const nodes=document.querySelectorAll('canvas[aria-label^="Chart for "]');if(nodes.length>20)return {ok:false,status:'CHART_SCOPE_LIMIT'};
    const charts=Array.from(nodes).filter(node=>visibleCanvasBox(node));if(charts.length!==1)return {ok:false,status:'SINGLE_VISIBLE_CHART_REQUIRED'};
    const canvas=charts[0],label=canvas.getAttribute('aria-label')??'',instrument=/^Chart for (.+), [^,]+$/.exec(label)?.[1];
    const interval=document.querySelector('#header-toolbar-intervals [aria-checked="true"]')?.getAttribute('data-value');
    if(instrument?.trim().toUpperCase()!==expectedInstrument.trim().toUpperCase()||interval?.trim().toUpperCase()!==expectedTimeframe.trim().toUpperCase())return {ok:false,status:'CHART_IDENTITY_MISMATCH'};
    const replay=document.querySelector('#header-toolbar-replay'),pressed=replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked');
    if(pressed!=='false')return {ok:false,status:pressed==='true'?'REPLAY_ACTIVE':'REPLAY_STATUS_UNVERIFIED'};
    const box=visibleCanvasBox(canvas);
    if(!box||box.width<240||box.height<220)return {ok:false,status:'CHART_VISIBLE_AREA_TOO_SMALL'};
    return {ok:true,canvas,box};
  };
  const initialProof=sourceProof();if(!initialProof.ok)return response(initialProof.status);
  if(!document.body)return response('DOCUMENT_BODY_UNAVAILABLE');
  const collision=document.getElementById(ids[mode]);
  if(collision&&collision!==state?.entries?.[mode]?.root)return response('OWNED_ROOT_ID_COLLISION');
  if(!state){
    state={entries:{}};
    state.remove=(entry,status)=>{
      entry.cancel?.(status);
      if(state.entries[entry.mode]!==entry)return;
      entry.root.remove();delete state.entries[entry.mode];
    };
    state.releaseIfEmpty=()=>{
      if(Object.keys(state.entries).length)return;
      removeEventListener('pagehide',state.pagehide);
      document.removeEventListener('visibilitychange',state.visibility);
      if(globalThis[key]===state)delete globalThis[key];
    };
    state.pagehide=()=>{for(const entry of Object.values(state.entries))state.remove(entry,'PAGE_HIDDEN');state.releaseIfEmpty();};
    state.visibility=()=>{if(document.visibilityState!=='visible'||document.hidden===true){for(const entry of Object.values(state.entries))state.remove(entry,'DOCUMENT_HIDDEN');state.releaseIfEmpty();}};
    globalThis[key]=state;addEventListener('pagehide',state.pagehide,{once:true});document.addEventListener('visibilitychange',state.visibility);
  }
  let entry=state.entries[mode];
  const display={instrument:expectedInstrument,testInstrument:mode==='TEST'&&bounded(signal.instrument,200)?signal.instrument:null,timeframe:expectedTimeframe,expectedSourceSession:expectedSourceSession??null,expectedSourceRunEpoch:expectedSourceRunEpoch??null,eventId:signal.eventId,direction:signal.direction,confirmationClose:signal.confirmationClose,confirmationBarCloseTime:signal.confirmationBarCloseTime,invalidation:signal.invalidation,patternIds:signal.patternIds??[],quantity:planned?quantity:null,markerStyleVersion:'direction-arrow-1'};
  const signature=JSON.stringify(display);
  if(entry?.sessionId===sessionId&&entry.signature===signature&&entry.receipt?.status==='RENDERED'){
    const current=entry.root.getBoundingClientRect(),chart=initialProof.box;
    if(current.left>=chart.left&&current.right<=chart.right&&current.top>=chart.top&&current.bottom<=chart.bottom)return {...entry.receipt,status:'DUPLICATE'};
  }
  if(entry&&entry.sessionId!==sessionId){state.remove(entry,'SUPERSEDED');entry=null;}
  if(!entry){
    const root=document.createElement('div');root.id=ids[mode];root.setAttribute('data-arrow-overlay-owned','v1');root.setAttribute('data-arrow-overlay-mode',mode);root.setAttribute('dir','rtl');root.setAttribute('role','status');root.style.pointerEvents='none';
    entry={mode,sessionId,root,status:'PENDING',eventId:signal.eventId,signature,receipt:null,cancel:null};state.entries[mode]=entry;document.body.append(root);
  }else entry.cancel?.('SUPERSEDED');
  Object.assign(entry,{sessionId,eventId:signal.eventId,signature,status:'PENDING',receipt:null});
  const root=entry.root,box=initialProof.box,width=Math.min(360,box.width-24);
  Object.assign(root.style,{position:'fixed',zIndex:'2147483000',pointerEvents:'none',boxSizing:'border-box',width:width+'px',maxHeight:(box.height-24)+'px',overflow:'hidden',right:'auto',left:(box.right-width-12)+'px',top:mode==='LIVE'?(box.top+12)+'px':'auto',bottom:mode==='TEST'?(innerHeight-box.bottom+12)+'px':'auto',padding:'12px 14px',borderRadius:'9px',border:mode==='LIVE'?'2px solid #72e1bc':'3px dashed #ffc761',background:mode==='LIVE'?'#102b27':'#342516',color:'#ffffff',fontFamily:'Arial, sans-serif',fontSize:'14px',lineHeight:'1.45',boxShadow:'0 3px 18px #0007'});
  const line=(text,strong=false)=>{const node=document.createElement(strong?'strong':'div');node.textContent=text;if(strong){node.style.display='block';node.style.marginBottom='5px';}return node;};
  const directionLine=()=>{
    const text=signal.direction==='LONG'?'לונג · LONG':'שורט · SHORT';
    if(mode!=='LIVE')return line(text,true);
    const row=line('',true),arrow=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path'),color=signal.direction==='LONG'?'#7dd3fc':'#fb923c';
    arrow.setAttribute('data-arrow-approved-direction',signal.direction);arrow.setAttribute('data-arrow-size','medium');arrow.setAttribute('data-arrow-placement','signal-card');arrow.setAttribute('width','32');arrow.setAttribute('height','36');arrow.setAttribute('viewBox','0 0 32 36');arrow.setAttribute('role','img');arrow.setAttribute('aria-label',signal.direction==='LONG'?'חץ לונג מאושר':'חץ שורט מאושר');
    Object.assign(arrow.style,{width:'32px',height:'36px',flex:'0 0 32px',pointerEvents:'none'});path.setAttribute('fill',color);path.setAttribute('d',signal.direction==='LONG'?'M16 2L2 16H10V34H22V16H30Z':'M16 34L2 20H10V2H22V20H30Z');arrow.append(path);Object.assign(row.style,{display:'flex',alignItems:'center',gap:'10px',minHeight:'36px'});row.append(arrow,line(text));return row;
  };
  const number=value=>Number(value).toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:8});
  root.replaceChildren(
    line(mode==='LIVE'?'Arrow · איתות מחקר מאושר':'Arrow · בדיקת תצוגה בלבד · ללא איתות שוק',true),
    line(mode==='TEST'?'נתוני בדיקה: '+(bounded(signal.instrument,200)?signal.instrument:'SYNTHETIC')+' · גרף תצוגה: '+expectedInstrument+' · '+expectedTimeframe:expectedInstrument+' · '+expectedTimeframe),
    directionLine(),
    line('מחיר אישור: '+number(signal.confirmationClose)),
    line('סגירת נר האישור: '+new Date(signal.confirmationBarCloseTime).toISOString()),
    line('ביטול: '+number(signal.invalidation)+' · כמות: '+(planned?quantity:'—')),
    line('תבניות: '+((signal.patternIds??[]).join(' · ')||'—')),
    line(mode==='LIVE'?'תצוגת מחקר · ללא פקודות':'TEST · המחשה מבוקרת בלבד')
  );
  const mutationAt=epoch();
  if(!Number.isFinite(mutationAt)||mutationAt<receiptAt){state.remove(entry,'INVALID_LOCAL_CLOCK');state.releaseIfEmpty();return response('INVALID_LOCAL_CLOCK');}
  return await new Promise(resolve=>{
    const work={done:false,first:null,handles:[],timer:null};
    const finish=(status,first=null,second=null)=>{
      if(work.done)return;work.done=true;
      if(work.timer!==null)clearTimeout(work.timer);
      for(const handle of work.handles)try{cancelAnimationFrame(handle);}catch{}
      entry.cancel=null;entry.status=status;
      const receipt=response(status,{mutationEpoch:mutationAt,firstPaintEpoch:first,secondPaintEpoch:second});entry.receipt=receipt;
      if(status!=='RENDERED'&&status!=='SUPERSEDED'&&state.entries[mode]===entry){root.remove();delete state.entries[mode];state.releaseIfEmpty();}
      resolve(receipt);
    };
    entry.cancel=status=>finish(status,work.first,null);
    const observable=()=>{
      if(globalThis[key]!==state||state.entries[mode]!==entry||entry.sessionId!==sessionId){finish('SUPERSEDED');return false;}
      const proof=sourceProof();if(!proof.ok){finish(proof.status,work.first,null);return false;}
      const bounds=root.getBoundingClientRect(),chart=proof.box;
      if(bounds.width<=0||bounds.height<=0||bounds.left<chart.left||bounds.right>chart.right||bounds.top<chart.top||bounds.bottom>chart.bottom){finish('OVERLAY_OFFSCREEN',work.first,null);return false;}
      if(epoch()-receiptAt>1000){finish('RENDER_TIMEOUT',work.first,null);return false;}
      return true;
    };
    work.timer=setTimeout(()=>finish('RENDER_TIMEOUT',work.first,null),750);
    if(!observable())return;
    try{
      work.handles.push(requestAnimationFrame(()=>{
        if(work.done||!observable())return;
        const first=epoch();if(!Number.isFinite(first)||first<mutationAt){finish('INVALID_LOCAL_CLOCK');return;}work.first=first;
        try{work.handles.push(requestAnimationFrame(()=>{
          if(work.done||!observable())return;
          const second=epoch();if(!Number.isFinite(second)||second<first){finish('INVALID_LOCAL_CLOCK',first,null);return;}finish('RENDERED',first,second);
        }));}catch{finish('ANIMATION_CALLBACK_UNAVAILABLE',first,null);}
      }));
    }catch{finish('ANIMATION_CALLBACK_UNAVAILABLE');}
  });
}
