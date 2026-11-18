// Serialized into TradingView's isolated world. This module owns one REPLAY
// research card, uses public DOM only, and has no order or LIVE delivery path.
export async function replayChartOverlayCommand({action,sessionId,mode='REPLAY',expectedInstrument,expectedTimeframe,replayWitness,decision,testOnly=false,allowResearchMultiChart=false,expectedResearchUrl}={}){
  const key='__arrowReplayResearchOverlayV1',rootId='arrow-replay-research-overlay-v1',epoch=()=>performance.timeOrigin+performance.now(),receiptAt=epoch();
  const response=(status,extra={})=>({status,mode:'REPLAY',live:false,orderEligible:false,ordersCreated:false,testOnly,meaning:'HISTORICAL_REPLAY_UI_RENDER_OPPORTUNITIES_NOT_LIVE_LATENCY',marketToDisplayMeasured:false,networkLatencyMeasured:false,physicalDisplayMeasured:false,documentTimeOrigin:performance.timeOrigin,renderReceiptEpoch:receiptAt,mutationEpoch:null,firstPaintEpoch:null,secondPaintEpoch:null,sourceToChartLowerMs:null,sourceToChartUpperMs:null,...extra});
  const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value),finite=Number.isFinite,integer=Number.isSafeInteger;
  let state=globalThis[key];
  const remove=(status)=>{if(state?.entry?.sessionId===sessionId)state.remove(status);};
  const reject=status=>{remove(status);return response(status);};
  if(!bounded(sessionId,200))return response('INVALID_SESSION');
  if(!['show','read','clear'].includes(action)||mode!=='REPLAY')return reject('INVALID_REPLAY_COMMAND');
  if(action==='clear'){
    if(state?.entry&&state.entry.sessionId!==sessionId)return response('STALE_SESSION');
    const had=!!state?.entry;remove('CLEARED');return response(had?'CLEARED':'EMPTY');
  }
  if(action==='read'){
    if(state?.entry?.sessionId!==sessionId)return response(state?.entry?'STALE_SESSION':'EMPTY',{card:null});
    const proof=state.entry.refresh?.()??state.entry.proof();if(!proof.ok)return reject(proof.status);
    return response('OK',{card:{sessionId,eventId:state.entry.eventId,decisionStatus:state.entry.decisionStatus,status:state.entry.status,receipt:state.entry.receipt?{...state.entry.receipt}:null,placement:state.entry.placement??null}});
  }
  if(testOnly!==false)return reject('SYNTHETIC_TEST_NOT_HISTORICAL_MARKET_EVIDENCE');
  if(typeof allowResearchMultiChart!=='boolean')return reject('EXPLICIT_REPLAY_CHART_POLICY_REQUIRED');
  if(expectedInstrument!=='CME_MINI:NQ1!'||expectedTimeframe!=='1')return reject('EXPECTED_NQ_ONE_MINUTE_REQUIRED');
  const witness=replayWitness,meta=witness?.metadata,fieldNames=['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END','ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B'];
  if(witness?.synthetic===true||witness?.testOnly===true||meta?.synthetic===true||meta?.testOnly===true)return reject('SYNTHETIC_TEST_NOT_HISTORICAL_MARKET_EVIDENCE');
  if(!witness||witness.kind!=='TRADINGVIEW_REPLAY_WINDOW_WITNESS'||witness.mode!=='REPLAY'||witness.replay!==true||witness.liveEligible!==false||witness.checksumsVerified!==true||!integer(witness.runEpoch)||witness.runEpoch<1577836800000||!integer(witness.sequence)||witness.sequence<0||witness.runId!==expectedInstrument+'|'+expectedTimeframe+'|'+witness.runEpoch||!integer(witness.currentTime)||witness.currentTime<0||!integer(witness.currentCloseTime)||!finite(new Date(witness.currentCloseTime).getTime())||witness.currentCloseTime-witness.currentTime!==60000||witness.current?.time!==witness.currentTime||witness.current?.closeTime!==witness.currentCloseTime||meta?.source!=='ohlc'||meta.instrument!==expectedInstrument||meta.timeframe!==expectedTimeframe||meta.timeframeMs!==60000||meta.tickSize!==.25||meta.pointValue!==20||meta.currency!=='USD'||meta.chartType!=='standard'||fieldNames.some(name=>typeof witness.fields?.[name]!=='string'||!witness.fields[name].trim()||witness.fields[name].length>128))return reject('INVALID_REPLAY_WITNESS');
  const d=decision,signal=d?.signal,technical=d?.kind==='GUIDE_TECHNICAL_DIRECTION_DECISION';
  if(!d||!['NO_APPROVAL','PENDING','CONFIRMED',...(technical?['AMBIGUOUS']:[])].includes(d.status)||!integer(d.asOfTime)||d.asOfTime<witness.currentTime||d.asOfTime>witness.currentCloseTime)return reject('INVALID_REPLAY_DECISION');
  const checkIds=['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME'],flagIds=['requireRisk','requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'];
  // This function is serialized without imports. Keep this bounded catalog in
  // agreement with guide-strategy-policy.mjs (covered by policy tests).
  const strategyRequired={...Object.fromEntries(['CANDLE_TREND_AT_ZONE','CANDLE_REVERSAL_AT_ZONE','CANDLE_RANGE_EDGE','PIN_TREND_AT_ZONE','PIN_RANGE_EDGE','ENGULFING_RANGE','ENGULFING_RANGE_RECLAIM','HANGING_MAN_REVERSAL','INVERTED_HAMMER_REVERSAL','INSIDE_BREAKOUT','INSIDE_FALSE_BREAK','ROLE_REVERSAL_RETEST'].map(id=>[id,['STRUCTURE','KNOWN_LOCATION']])),PIN_CONFLUENCE:['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME'],ENGULFING_EMA:['STRUCTURE','EMA'],ENGULFING_FIB:['STRUCTURE','FIB'],ENGULFING_TRENDLINE:['STRUCTURE','TRENDLINE'],ENGULFING_SUPPLY_DEMAND:['STRUCTURE','SUPPLY_DEMAND'],INSIDE_FALSE_BREAK_FIB:['STRUCTURE','FIB']};
  const pass=row=>row&&['required','enabled','available','passed'].every(key=>row[key]===true)&&row.state==='PASS'&&row.pendingConfirmation!==true;
  const strategyApproval=s=>{
    const proofs=s?.strategyProofs,source=s?.sourceEventIds,checks=s?.requiredChecks;
    if(s?.approvalPolicy!=='guide_scenarios_v1'||!Array.isArray(proofs)||!proofs.length||proofs.length>18||!Array.isArray(source)||!source.length||source.length>600||source.some(id=>!bounded(id,512))||new Set(source).size!==source.length||new Set(proofs.map(p=>p?.profileId)).size!==proofs.length||!Array.isArray(checks)||checks.length<1||checks.length>7)return false;
    const covered=[],required=new Set();
    for(const p of proofs){
      const ids=strategyRequired[p?.profileId];
      if(!Array.isArray(ids)||JSON.stringify(p.requiredCheckIds)!==JSON.stringify(ids)||!Array.isArray(p.requiredChecks)||p.requiredChecks.length!==ids.length||ids.some(id=>p.requiredChecks.filter(row=>row?.id===id&&pass(row)).length!==1)||!Array.isArray(p.sourceEventIds)||!p.sourceEventIds.length||p.sourceEventIds.some(id=>!source.includes(id)))return false;
      ids.forEach(id=>required.add(id));covered.push(...p.sourceEventIds);
    }
    return covered.length===source.length&&new Set(covered).size===covered.length&&source.every(id=>covered.includes(id))&&checks.length===required.size&&[...required].every(id=>checks.filter(row=>row?.id===id&&pass(row)).length===1);
  };
  const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*Number.EPSILON*64;
  if(technical&&(d.definitionVersion!=='guide-technical-decision-1'||d.engineVersion!=='guide-signals-5'||d.execution!=='OBSERVATION_ONLY'||d.orderEligible!==false||d.testOnly===true||d.synthetic===true))return reject('TECHNICAL_OBSERVATION_REQUIRED');
  if(d.status==='CONFIRMED'&&technical){
    const closed=witness.current?.closed===true&&witness.current?.sourceClosed===true?witness.current:witness.previous;
    if(d.currentClosedBarCloseTime!==d.asOfTime||d.direction!==signal?.direction||closed?.closed!==true||closed.sourceClosed!==true||closed.closeTime!==d.asOfTime||closed.close!==signal?.confirmationClose)return reject('TECHNICAL_CLOSED_SOURCE_MISMATCH');
    const checks=signal?.requiredChecks,scoped=signal?.approvalPolicy==='guide_scenarios_v1',validChecks=scoped?strategyApproval(signal):(signal?.approvalPolicy===undefined||signal.approvalPolicy==='all_seven')&&Array.isArray(checks)&&checks.length===7&&checkIds.every(id=>checks.filter(row=>row.id===id&&pass(row)).length===1);
    if(signal?.kind!=='GUIDE_TECHNICAL_DIRECTION_SIGNAL'||signal.status!=='CONFIRMED'||signal.execution!=='OBSERVATION_ONLY'||signal.orderEligible!==false||signal.testOnly===true||signal.synthetic===true||signal.instrument!==expectedInstrument||signal.timeframe!==expectedTimeframe||!bounded(signal.eventId,512)||!['LONG','SHORT'].includes(signal.direction)||!finite(signal.confirmationClose)||signal.confirmationBarCloseTime!==d.asOfTime||signal.confirmedAt!==d.asOfTime||!validChecks||!Array.isArray(signal.patternIds)||signal.patternIds.length>32||signal.patternIds.some(id=>!bounded(id,80))||!Array.isArray(signal.setups)||signal.setups.length<1||signal.setups.length>10000||signal.setups.some(setup=>!finite(setup.structuralInvalidation)))return reject(scoped?'STRATEGY_SPECIFIC_TECHNICAL_CLOSE_REQUIRED':'ALL_SEVEN_TECHNICAL_CLOSE_REQUIRED');
  }
  if(d.status==='CONFIRMED'&&!technical){
    const config=signal?.parameterSnapshot?.config,risk=signal?.parameterSnapshot?.risk,plan=signal?.riskPlan,checks=signal?.contextSnapshot?.checks;
    if(!signal||signal.status!=='CONFIRMED'||signal.execution!=='OBSERVATION_ONLY'||signal.orderEligible!==false||signal.instrument!==expectedInstrument||signal.timeframe!==expectedTimeframe||!bounded(signal.eventId,512)||!['LONG','SHORT'].includes(signal.direction)||![signal.confirmationClose,signal.invalidation].every(finite)||!integer(signal.confirmationBarCloseTime)||signal.confirmationBarCloseTime<0||!integer(signal.confirmedAt)||signal.confirmedAt<signal.confirmationBarCloseTime||signal.confirmationBarCloseTime>d.asOfTime||signal.confirmedAt>d.asOfTime||flagIds.some(id=>config?.[id]!==true)||!Array.isArray(checks)||checkIds.some(id=>{const matches=checks.filter(check=>check.id===id);return matches.length!==1||matches[0].required!==true||matches[0].enabled!==true||matches[0].available!==true||matches[0].passed!==true||matches[0].state!=='PASS';}))return reject('STRICT_HISTORICAL_APPROVAL_REQUIRED');
    if(!risk||risk.riskBudget!==200||risk.maxContracts!==1||risk.pointValue!==20||!finite(risk.commissionPerContract)||risk.commissionPerContract<0||!finite(risk.slippageTicks)||risk.slippageTicks<0||plan?.status!=='PLANNED'||plan.quantity!==1||plan.ordersCreated!==false||plan.fillInferred!==false||![plan.effectiveEntry,plan.initialStop,plan.target,plan.totalPlannedRisk].every(finite)||plan.totalPlannedRisk<=0||plan.totalPlannedRisk>200)return reject('ONE_CONTRACT_ALL_IN_RESEARCH_RISK_REQUIRED');
    const riskPoints=signal.direction==='LONG'?plan.effectiveEntry-plan.initialStop:plan.initialStop-plan.effectiveEntry,rewardPoints=signal.direction==='LONG'?plan.target-plan.effectiveEntry:plan.effectiveEntry-plan.target,cost=risk.commissionPerContract+risk.slippageTicks*.25*20;
    if(!(riskPoints>0&&rewardPoints>0)||!near(plan.totalPlannedRisk,riskPoints*20+cost)||!near(plan.commissionAllowance,risk.commissionPerContract)||!near(plan.slippageAllowance,risk.slippageTicks*.25*20)||!near(plan.effectiveEntry,signal.confirmationClose))return reject('HISTORICAL_RISK_ARITHMETIC_MISMATCH');
    if(!Array.isArray(signal.patternIds)||signal.patternIds.length>32||signal.patternIds.some(id=>!bounded(id,80)))return reject('INVALID_HISTORICAL_PATTERNS');
  }
  const rendered=node=>{
    const box=node?.getBoundingClientRect?.();if(!box||box.width<=0||box.height<=0)return false;
    let parent=node,depth=0;for(;parent&&depth<64;parent=parent.parentElement,depth++){const style=getComputedStyle(parent);if(style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.contentVisibility==='hidden'||style.opacity!==''&&Number(style.opacity)===0)return false;}return !parent;
  };
  const visibleBox=node=>{
    if(!rendered(node))return null;const rect=node.getBoundingClientRect();let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom),parent=node,depth=0;
    for(;parent&&depth<64;parent=parent.parentElement,depth++){const style=getComputedStyle(parent),clipX=['auto','scroll','hidden','clip','overlay'].includes(style.overflowX??style.overflow),clipY=['auto','scroll','hidden','clip','overlay'].includes(style.overflowY??style.overflow);if(clipX||clipY){const box=parent.getBoundingClientRect(),x=box.left+(parent.clientLeft??0),y=box.top+(parent.clientTop??0);if(clipX){left=Math.max(left,x);right=Math.min(right,x+(parent.clientWidth??box.width));}if(clipY){top=Math.max(top,y);bottom=Math.min(bottom,y+(parent.clientHeight??box.height));}}if(right<=left||bottom<=top)return null;}return parent?null:{left,right,top,bottom,width:right-left,height:bottom-top};
  };
  const sourceProof=()=>{
    if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||!location.pathname.startsWith('/chart/'))return {ok:false,status:'TRADINGVIEW_CHART_REQUIRED'};
    if(allowResearchMultiChart){
      let url;try{url=new URL(expectedResearchUrl);}catch{return {ok:false,status:'EXPLICIT_REPLAY_RESEARCH_URL_REQUIRED'};}
      if(url.protocol!=='https:'||url.search||url.hash||url.username||url.password||url.origin+url.pathname!==location.origin+location.pathname)return {ok:false,status:'REPLAY_RESEARCH_URL_CHANGED'};
      const layouts=Array.from(document.querySelectorAll('[aria-label^="Logged in as"]')).filter(rendered);
      if(layouts.length!==1||!/Active layout: Arrow /.test(layouts[0].getAttribute('aria-label')??''))return {ok:false,status:'NAMED_REPLAY_RESEARCH_LAYOUT_REQUIRED'};
    }
    if(document.visibilityState!=='visible'||document.hidden===true)return {ok:false,status:'DOCUMENT_HIDDEN'};
    const canvases=Array.from(document.querySelectorAll('canvas[aria-label^="Chart for "]'));if(canvases.length>20)return {ok:false,status:'CHART_SCOPE_LIMIT'};
    const charts=canvases.filter(node=>visibleBox(node)),targets=charts.filter(chart=>chart.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute');
    if(allowResearchMultiChart?charts.length<1||charts.length>3||targets.length!==1||charts.some(chart=>!/^Chart for CME_MINI:NQ1!, [^,]+$/.test(chart.getAttribute('aria-label')??'')):charts.length!==1)return {ok:false,status:'SINGLE_VISIBLE_CHART_REQUIRED'};
    const selectedChart=allowResearchMultiChart?targets[0]:charts[0],label=selectedChart.getAttribute('aria-label')??'',instrument=/^Chart for (.+), [^,]+$/.exec(label)?.[1],interval=document.querySelector('#header-toolbar-intervals [aria-checked="true"]')?.getAttribute('data-value');
    if(instrument!==expectedInstrument||interval!==expectedTimeframe)return {ok:false,status:'CHART_IDENTITY_MISMATCH'};
    const replay=document.querySelector('#header-toolbar-replay'),pressed=replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked');if(pressed!=='true')return {ok:false,status:pressed==='false'?'REPLAY_NOT_ACTIVE':'REPLAY_STATUS_UNVERIFIED'};
    const tabs=Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')),selected=tabs.filter(node=>/data\s*window/i.test((node.getAttribute('aria-label')??'')+' '+(node.getAttribute('title')??'')+' '+(node.textContent??''))&&visibleBox(node));if(selected.length!==1)return {ok:false,status:'REPLAY_DATA_WINDOW_REQUIRED'};
    const studies=Array.from(document.querySelectorAll('[role="treegrid"] [role="row"][data-role="menuitem"]')).filter(row=>rendered(row)&&Array.from(row.querySelectorAll('span[title]')).some(node=>(node.getAttribute('title')??'').startsWith('Arrow OHLC Window v2')&&visibleBox(node)));if(studies.length!==1)return {ok:false,status:'REPLAY_STUDY_NOT_UNIQUE'};
    const values=new Map();for(const node of studies[0].querySelectorAll('[data-test-id-value-title]')){const name=node.getAttribute('data-test-id-value-title');if(!fieldNames.includes(name))continue;const parent=node.parentElement;if(values.has(name)||!parent||parent.children.length!==2||parent.children[0]!==node)return {ok:false,status:'REPLAY_WITNESS_FIELD_STRUCTURE_CHANGED'};values.set(name,parent.children[1]?.textContent);}
    if(fieldNames.some(name=>values.get(name)!==witness.fields[name]))return {ok:false,status:'REPLAY_WITNESS_CHANGED'};
    const box=visibleBox(selectedChart);if(!box||box.width<260||box.height<240)return {ok:false,status:'CHART_VISIBLE_AREA_TOO_SMALL'};
    return {ok:true,box,chart:selectedChart,...(allowResearchMultiChart?{researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:charts.length,targetCharts:1,selectedChartLabel:label,interval:'1',researchLayoutVerified:true}}:{})};
  };
  const placeOwnedCard=(entry,box)=>{
    const width=Math.min(390,box.width-24),layout={width:width+'px',maxHeight:(box.height-24)+'px',left:(box.right-width-12)+'px',top:(box.top+12)+'px'};
    let changed=false;for(const [name,value]of Object.entries(layout))if(entry.root.style[name]!==value){entry.root.style[name]=value;changed=true;}
    const rect=entry.root.getBoundingClientRect();
    if(![rect.left,rect.top,rect.right,rect.bottom,rect.width,rect.height].every(finite)||rect.width<=0||rect.height<=0||rect.left<box.left||rect.right>box.right||rect.top<box.top||rect.bottom>box.bottom)return {ok:false,status:'OVERLAY_OFFSCREEN'};
    const previous=entry.placement;
    entry.placement={chartBox:{...box},cardBox:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},repositions:(previous?.repositions??0)+(previous&&changed?1:0),lastRepositionEpoch:changed||!previous?epoch():previous.lastRepositionEpoch,sourceObservedEpochMs:witness.sourceObservedEpochMs??null};
    return {ok:true,box};
  };
  const proof=sourceProof();if(!proof.ok)return reject(proof.status);if(!document.body)return reject('DOCUMENT_BODY_UNAVAILABLE');
  const collision=document.getElementById(rootId);if(collision&&collision!==state?.entry?.root)return reject('OWNED_ROOT_ID_COLLISION');
  // Replace an older owned listener set when an extension update leaves this
  // isolated world alive. Only this module's own card/state can be released.
  if(state&&state.geometryVersion!==2){state.remove('GEOMETRY_LISTENER_UPGRADE');state=null;}
  if(!state){
    state={entry:null,geometryVersion:2};state.release=()=>{if(state.entry)return;state.observer?.disconnect();state.resizeObserver?.disconnect();state.observedChart=null;removeEventListener('resize',state.resize);removeEventListener('pagehide',state.pagehide);document.removeEventListener('visibilitychange',state.visibility);if(globalThis[key]===state)delete globalThis[key];};
    state.remove=status=>{const entry=state.entry;if(!entry)return;entry.cancel?.(status);if(state.entry===entry){entry.root.remove();state.entry=null;}state.release();};
    state.refresh=()=>{const entry=state.entry;if(!entry)return;const current=entry.refresh();if(!current.ok)state.remove(current.status);};
    state.observeChart=chart=>{if(state.observedChart===chart)return;state.resizeObserver?.disconnect();state.observedChart=chart;state.resizeObserver?.observe(chart);};
    state.resize=()=>state.refresh();addEventListener('resize',state.resize,{passive:true});
    if(typeof ResizeObserver==='function')state.resizeObserver=new ResizeObserver(()=>state.refresh());
    state.pagehide=()=>state.remove('PAGE_HIDDEN');state.visibility=()=>{if(document.visibilityState!=='visible'||document.hidden===true)state.remove('DOCUMENT_HIDDEN');};globalThis[key]=state;addEventListener('pagehide',state.pagehide,{once:true});document.addEventListener('visibilitychange',state.visibility);
    if(typeof MutationObserver==='function'){state.observer=new MutationObserver(()=>state.refresh());state.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-pressed','aria-checked','aria-label','data-value','style','class','hidden']});}
  }
  if(state.entry){state.entry.cancel?.('SUPERSEDED');state.entry.root.remove();state.entry=null;}
  // Re-check the complete public witness immediately before the owned mutation.
  const finalProof=sourceProof();if(!finalProof.ok){state.release();return response(finalProof.status);}
  const root=document.createElement('div');root.id=rootId;root.setAttribute('data-arrow-replay-overlay-owned','v1');root.setAttribute('data-arrow-overlay-mode','REPLAY');root.setAttribute('dir','rtl');root.setAttribute('role','status');root.dataset.approved=String(d.status==='CONFIRMED');root.style.pointerEvents='none';
  Object.assign(root.style,{position:'fixed',zIndex:'2147482999',boxSizing:'border-box',overflow:'hidden',padding:'12px 14px',borderRadius:'9px',border:d.status==='CONFIRMED'?'2px solid #59d0b3':'2px solid #8090b3',background:d.status==='CONFIRMED'?'#10312a':'#1b2436',color:'#fff',fontFamily:'Arial, sans-serif',fontSize:'13px',lineHeight:'1.45',boxShadow:'inset 0 0 0 1px #0007'});
  const line=(text,strong=false)=>{const node=document.createElement(strong?'strong':'div');node.textContent=text;if(strong){node.style.display='block';node.style.marginBottom='5px';}return node;},stamp=time=>new Date(time).toISOString(),number=value=>Number(value).toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:8});
  const directionLine=()=>{
    const row=line('',true),arrow=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path'),color=signal.direction==='LONG'?'#7dd3fc':'#fb923c';
    arrow.setAttribute('data-arrow-approved-direction',signal.direction);arrow.setAttribute('data-arrow-size','medium');arrow.setAttribute('data-arrow-placement','signal-card');arrow.setAttribute('width','32');arrow.setAttribute('height','36');arrow.setAttribute('viewBox','0 0 32 36');arrow.setAttribute('role','img');arrow.setAttribute('aria-label',signal.direction==='LONG'?'חץ לונג מאושר ב־Replay היסטורי':'חץ שורט מאושר ב־Replay היסטורי');
    Object.assign(arrow.style,{width:'32px',height:'36px',flex:'0 0 32px',pointerEvents:'none'});path.setAttribute('fill',color);path.setAttribute('d',signal.direction==='LONG'?'M16 2L2 16H10V34H22V16H30Z':'M16 34L2 20H10V2H22V20H30Z');arrow.append(path);Object.assign(row.style,{display:'flex',alignItems:'center',gap:'10px',minHeight:'36px'});row.append(arrow,line(signal.direction==='LONG'?'לונג · LONG':'שורט · SHORT'));return row;
  };
  const labels={STRUCTURE:'מבנה',KNOWN_LOCATION:'מיקום',EMA:'EMA',FIB:'FIB',TRENDLINE:'קו מגמה',SUPPLY_DEMAND:'היצע/ביקוש',HIGHER_TIMEFRAME:'HTF'},checkLine=checks=>checkIds.filter(id=>!technical||d.status!=='CONFIRMED'||checks?.some(item=>item.id===id&&item.required===true)).map(id=>{const check=Array.isArray(checks)?checks.find(item=>item.id===id):null;return labels[id]+':'+(check?.state==='PASS'&&check.passed===true?'✓':check?.state==='FAIL'?'×':'?');}).join(' · ');
  const reasonsLine=checks=>checkIds.flatMap(id=>{const check=Array.isArray(checks)?checks.find(item=>item.id===id):null;if(check?.state==='PASS'&&check.passed===true)return [];const codes=Array.isArray(check?.reasonCodes)?check.reasonCodes.filter(code=>bounded(code,160)):[];return [labels[id]+':'+(codes.length?codes.join('/'):check?.state==='DISABLED'?'הכלל כבוי':check?.state==='FAIL'?'התנאי לא התקיים':'הנתון אינו זמין')];}).join(' · ');
  root.append(line(d.status==='CONFIRMED'?(technical?'REPLAY · אישור כיוון טכני':'REPLAY · איתות היסטורי מאושר'):'REPLAY · ניתוח היסטורי בלבד',true),line(expectedInstrument+' · '+expectedTimeframe+'m · HISTORICAL'),line('כרטיס ניתוח · מצב הביצוע מוצג ב־Arrow'),line('נר בגרף: '+stamp(witness.currentTime)),line('זמן החלטה היסטורי: '+stamp(d.asOfTime)));
  if(d.status==='CONFIRMED'&&technical)root.append(directionLine(),line('אישור טכני: '+stamp(signal.confirmationBarCloseTime)),line('מחיר אישור: '+number(signal.confirmationClose)),line('רמות ביטול מבניות: '+[...new Set(signal.setups.map(setup=>setup.structuralInvalidation))].map(number).join(' · ')),line('הכמות והסיכון לפי הגדרותיך · ניהול העסקה בידיך'),line(checkLine(signal.requiredChecks)),line('תבניות: '+signal.patternIds.join(' · ')));
  else if(d.status==='CONFIRMED')root.append(directionLine(),line('אישור היסטורי: '+stamp(signal.confirmationBarCloseTime)),line('מחיר אישור: '+number(signal.confirmationClose)+' · ביטול: '+number(signal.invalidation)),line('כמות: 1 · סיכון כולל מתוכנן: $'+number(signal.riskPlan.totalPlannedRisk)+' / $200'),line('עמלה והחלקה: הנחות מחקר, ללא אימות חשבון'),line(checkLine(signal.contextSnapshot.checks)),line('תבניות: '+signal.patternIds.join(' · ')));
  else root.append(line(d.status==='AMBIGUOUS'?'תרחישי לונג ושורט סותרים; אין כיוון יחיד לכניסה.':d.status==='PENDING'?'מערך היסטורי ממתין לאישור; אין איתות מאושר.':'אין איתות מאושר לפי כל מסנני החובה.',true),line('LONG · '+checkLine(d.currentChecks?.directions?.LONG?.checks)),line('סיבות LONG · '+reasonsLine(d.currentChecks?.directions?.LONG?.checks)),line('SHORT · '+checkLine(d.currentChecks?.directions?.SHORT?.checks)),line('סיבות SHORT · '+reasonsLine(d.currentChecks?.directions?.SHORT?.checks)));
  root.append(line(technical?'REPLAY / HISTORICAL · כרטיס ניתוח בלבד · אינו איתות LIVE':'REPLAY / HISTORICAL · ללא פקודות · אינו איתות LIVE'));
  const eventId='REPLAY:'+(d.status==='CONFIRMED'?signal.eventId:witness.runId+':'+witness.sequence+':'+witness.currentTime+':'+d.asOfTime+':'+d.status),entry={root,sessionId,eventId,decisionStatus:d.status,status:'PENDING',receipt:null,cancel:null,proof:sourceProof,placement:null};
  entry.refresh=()=>{const current=sourceProof();if(!current.ok)return current;entry.researchSelection=current.researchSelection??null;state.observeChart(current.chart);return placeOwnedCard(entry,current.box);};
  state.entry=entry;document.body.append(root);const placed=entry.refresh(),mutationAt=epoch();if(!placed.ok)return reject(placed.status);
  if(!finite(receiptAt)||!finite(mutationAt)||mutationAt<receiptAt)return reject('INVALID_LOCAL_CLOCK');
  const sourceEpoch=witness.sourceDocumentTimeOrigin===performance.timeOrigin&&finite(witness.sourceObservedEpochMs)&&witness.sourceObservedEpochMs>=0&&witness.sourceObservedEpochMs<=receiptAt?witness.sourceObservedEpochMs:null;
  return await new Promise(resolve=>{
    const work={done:false,first:null,handles:[],timer:null};
    const finish=(status,first=null,second=null)=>{if(work.done)return;work.done=true;if(work.timer!==null)clearTimeout(work.timer);for(const handle of work.handles)try{cancelAnimationFrame(handle);}catch{}entry.cancel=null;entry.status=status;const result=response(status,{eventId,decisionStatus:d.status,approvedHistorical:d.status==='CONFIRMED',sourceRunId:witness.runId,sourceSequence:witness.sequence,researchSelection:entry.researchSelection,mutationEpoch:mutationAt,firstPaintEpoch:first,secondPaintEpoch:second,sourceObservedEpochMs:sourceEpoch,sourceToChartLowerMs:status==='RENDERED'&&sourceEpoch!==null?first-sourceEpoch:null,sourceToChartUpperMs:status==='RENDERED'&&sourceEpoch!==null?second-sourceEpoch:null});entry.receipt=result;if(status!=='RENDERED'&&status!=='SUPERSEDED'&&state.entry===entry){root.remove();state.entry=null;state.release();}resolve(result);};
    entry.cancel=status=>finish(status,work.first,null);
    const observable=()=>{if(globalThis[key]!==state||state.entry!==entry){finish('SUPERSEDED');return false;}const current=entry.refresh();if(!current.ok){finish(current.status,work.first,null);return false;}return true;};
    work.timer=setTimeout(()=>finish('RENDER_TIMEOUT',work.first,null),750);
    if(!observable())return;
    try{work.handles.push(requestAnimationFrame(()=>{if(work.done||!observable())return;const first=epoch();if(!finite(first)||first<mutationAt){finish('INVALID_LOCAL_CLOCK');return;}work.first=first;try{work.handles.push(requestAnimationFrame(()=>{if(work.done||!observable())return;const second=epoch();if(!finite(second)||second<first){finish('INVALID_LOCAL_CLOCK',first,null);return;}finish('RENDERED',first,second);}));}catch{finish('ANIMATION_CALLBACK_UNAVAILABLE',first,null);}}));}catch{finish('ANIMATION_CALLBACK_UNAVAILABLE');}
  });
}
