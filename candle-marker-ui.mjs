// Serialized into the explicitly selected TradingView research tab. Public
// study Settings and Data Window fields only; no chart internals or orders.
export async function nativeCandleMarkerUiCommand(command={}){
  const repairing=command.action==='repair_archive';
  const studyTitle='Arrow Approved Candle Markers',inputTitle=repairing?'History archive repair request':'Approved marker payload';
  const fieldNames=['ARROW_MARKER_SCHEMA','ARROW_MARKER_SIGNATURE','ARROW_MARKER_EXPECTED_COUNT','ARROW_MARKER_MATCHED_COUNT','ARROW_MARKER_DRAWN_COUNT','ARROW_MARKER_MODE','ARROW_MARKER_LAST_TIME','ARROW_MARKER_LAST_PRICE_TICKS','ARROW_MARKER_LAST_DIRECTION','ARROW_MARKER_CUTOFF','ARROW_MARKER_CONTEXT_VALID'];
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_!:.|-/\n';
  const epoch=()=>performance.timeOrigin+performance.now(),receipt=epoch(),timing={renderReceiptEpoch:receipt};
  const norm=value=>String(value??'').replace(/\s+/g,' ').trim();
  const rendered=node=>{if(!node?.getBoundingClientRect)return false;const r=node.getBoundingClientRect(),style=getComputedStyle(node);return r.width>0&&r.height>0&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);};
  const all=(selector,root=document,max=6000)=>{const found=[...root.querySelectorAll(selector)];if(found.length>max)fail('MARKER_DOM_SCOPE_LIMIT');return found.filter(rendered);};
  const fail=code=>{throw Object.assign(new Error(code),{markerCode:code});};
  const integer=Number.isSafeInteger,finite=Number.isFinite;
  const nativeNumber=raw=>{if(typeof raw==='number')return raw;if(typeof raw!=='string')return NaN;const text=raw.trim().replace(/^\u2212(?=\d)/,'-');return /^-?[\d,]+(?:\.0+)?$/.test(text)?Number(text.replace(/,/g,'')):NaN;};
  const exactText=node=>norm(node?.getAttribute?.('aria-label')||node?.getAttribute?.('title')||node?.innerText||node?.textContent);
  const named=(name,root)=>{const found=all('button,[role="button"],[role="tab"]',root).filter(node=>exactText(node)===name);return found.length===1?found[0]:null;};
  let allowOwnDialog=false,expandedLegend=null,openedByCommand=false,lastFields=null,lastDebugFields=null,lastControls=null,lastChartSelection=null;
  const gestureAttempts=[];
  const expected=command.expected??{},payload=command.payload;
  function ownDialog(dialog){
    const labelled=(dialog.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById?.(id)?.textContent??'').join(' ');
    const title=norm(dialog.getAttribute('aria-label')||labelled);
    return title===studyTitle||norm((dialog.innerText??dialog.textContent??'').split('\n')[0])===studyTitle;
  }
  function studyRow(title){
    const rows=all('[role="treegrid"] [role="row"][data-role="menuitem"],[role="treegrid"] > div[role="row"]',document,300),matches=[];
    for(const row of rows)if(all('span[title]',row,30).some(node=>(node.getAttribute('title')??'').startsWith(title))||all(':scope > div[class*="header-"] > span[class*="headerTitle-"]',row,30).some(node=>!node.getAttribute('title')&&norm(node.textContent).startsWith(title+' (')))matches.push(row);
    if(matches.length!==1)fail(matches.length?'MARKER_STUDY_AMBIGUOUS':'MARKER_STUDY_NOT_FOUND');
    return matches[0];
  }
  function fieldsFrom(title,names){
    const row=studyRow(title),plots=all('[data-test-id-value-title]',row,100),fields={};
    for(const name of names){
      const found=plots.filter(node=>node.getAttribute('data-test-id-value-title')===name);
      if(found.length!==1)fail('MARKER_NATIVE_FIELD_UNAVAILABLE');
      const node=found[0],parent=node.parentElement;
      if(!parent||parent.children.length!==2||parent.children[0]!==node)fail('MARKER_NATIVE_FIELD_STRUCTURE_CHANGED');
      fields[name]=norm(parent.children[1].textContent);
    }
    return fields;
  }
  function nativeFields(){
    const fields=fieldsFrom(studyTitle,fieldNames),row=studyRow(studyTitle),plots=all('[data-test-id-value-title]',row,100),debug={};
    for(const plot of plots){const name=plot.getAttribute('data-test-id-value-title');if(!/^ARROW_MARKER_DEBUG_[A-Z_]+$/.test(name??''))continue;const parent=plot.parentElement;if(parent?.children?.length===2&&parent.children[0]===plot&&!Object.hasOwn(debug,name))debug[name]=norm(parent.children[1].textContent);}
    lastDebugFields=debug;return fields;
  }
  function guard(){
    if(document.visibilityState!=='visible'||document.hidden===true)fail('MARKER_RESEARCH_TAB_NOT_VISIBLE');
    let requested;try{requested=new URL(expected.researchUrl);}catch{fail('EXPLICIT_MARKER_RESEARCH_URL_REQUIRED');}
    if(location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname)||location.origin+location.pathname!==requested.origin+requested.pathname||!/^\/chart\/[A-Za-z0-9]+\/$/.test(location.pathname))fail('MARKER_RESEARCH_URL_MISMATCH');
    if(expected.timeframe!=='1'||!/^CME_MINI:NQ(?:1!|[HMUZ]20\d\d)$/.test(expected.instrument??'')||!['LIVE','REPLAY'].includes(expected.sourceMode))fail('EXACT_MARKER_NQ_SCOPE_REQUIRED');
    const layouts=all('[aria-label^="Logged in as"]',document,10);
    const liveMulti=expected.allowResearchLiveMultiChart===true&&expected.sourceMode==='LIVE',knownLiveName=({'/chart/ARROWFR1/':'Full Screens Live','/chart/ARROWRV1/':'Arrow OHLC Live Verification'})[location.pathname];
    if(layouts.length!==1||(liveMulti?requested.href!==location.href||!knownLiveName||!norm(layouts[0].getAttribute('aria-label')).endsWith('Active layout: '+knownLiveName):!/Active layout: Arrow /.test(layouts[0].getAttribute('aria-label')??'')))fail('NAMED_MARKER_RESEARCH_LAYOUT_REQUIRED');
    const charts=all('canvas[aria-label^="Chart for "]',document,20);
    if(expected.allowResearchMultiChart!==undefined&&typeof expected.allowResearchMultiChart!=='boolean')fail('EXPLICIT_MARKER_CHART_POLICY_REQUIRED');
    const targets=charts.filter(chart=>chart.getAttribute('aria-label')===`Chart for ${expected.instrument}, 1 minute`),multi=expected.allowResearchMultiChart===true||liveMulti;
    if(targets.length!==1||(multi?(!liveMulti&&expected.sourceMode!=='REPLAY')||expected.instrument!=='CME_MINI:NQ1!'||charts.length<1||charts.length>3||charts.some(chart=>!/^Chart for CME_MINI:NQ1!, [^,]+$/.test(chart.getAttribute('aria-label')??'')):charts.length!==1))fail('SINGLE_MATCHING_MARKER_CHART_REQUIRED');
    const interval=document.querySelector('#header-toolbar-intervals [aria-checked="true"]');
    if(interval?.getAttribute('data-value')!=='1')fail('MARKER_CHART_TIMEFRAME_CHANGED');
    lastChartSelection={kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:charts.length,targetCharts:1,selectedChartLabel:targets[0].getAttribute('aria-label'),interval:'1',researchLayoutVerified:true};
    const replay=document.querySelector('#header-toolbar-replay'),replayValue=replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked');
    if(replayValue!==(expected.sourceMode==='REPLAY'?'true':'false'))fail('MARKER_SOURCE_MODE_CHANGED');
    const dialogs=all('[role="dialog"],[aria-modal="true"]',document,20);
    if(dialogs.some(dialog=>!allowOwnDialog||!ownDialog(dialog))||dialogs.length>1)fail('UNRELATED_MARKER_DIALOG_OPEN');
    if(expected.runEpoch!==undefined||expected.fields!==undefined){
      if(expected.runEpoch!==undefined&&(!integer(expected.runEpoch)||expected.runEpoch<1577836800000))fail('INVALID_MARKER_SOURCE_RUN');
      const supplied=expected.fields??{};
      if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).length>70||Object.entries(supplied).some(([name,value])=>!/^ARROW2_[A-Z0-9_]+$/.test(name)||typeof value!=='string'||value.length>128))fail('INVALID_MARKER_SOURCE_FIELDS');
      const names=[...new Set([...Object.keys(supplied),...(expected.runEpoch!==undefined?['ARROW2_RUN_EPOCH']:[])])],source=fieldsFrom('Arrow OHLC Window v2',names);
      if(expected.runEpoch!==undefined&&nativeNumber(source.ARROW2_RUN_EPOCH)!==expected.runEpoch||Object.entries(supplied).some(([name,value])=>source[name]!==norm(value)))fail('MARKER_SOURCE_WITNESS_CHANGED');
    }
  }
  async function checked(promise){guard();const result=await promise;guard();return result;}
  async function until(predicate,{timeoutMs=5000}={}){
    const started=epoch();
    for(;;){guard();const result=predicate();if(result)return result;if(epoch()-started>timeoutMs)fail('NATIVE_MARKER_UI_TIMEOUT');await checked(new Promise(resolve=>setTimeout(resolve,35)));}
  }
  async function waitOwnedDialog(timeoutMs){
    const started=epoch();
    for(;;){guard();const dialogs=all('[role="dialog"],[aria-modal="true"]',document,20);if(dialogs.length===1&&ownDialog(dialogs[0]))return dialogs[0];if(epoch()-started>=timeoutMs)return null;await checked(new Promise(resolve=>setTimeout(resolve,35)));}
  }
  function validatePayload(){
    const technical=payload?.kind==='TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD'&&payload.approvalKind==='TECHNICAL';
    if(!payload||!technical&&payload.kind!=='APPROVED_NATIVE_CANDLE_MARKER_PAYLOAD'||!['READY','EMPTY'].includes(payload.status)||payload.sourceMode!==expected.sourceMode||payload.instrument!==expected.instrument||payload.timeframe!=='1'||payload.ordersCreated!==false||payload.orderEligible!==false||payload.fillInferred!==false||payload.testOnly===true||payload.synthetic===true||typeof payload.textPayload!=='string'||payload.textPayload.length>(payload.schemaVersion>=3?32768:8192)||!Array.isArray(payload.records)||payload.records.length>(payload.schemaVersion>=3?100:20)||!integer(payload.asOfTime)||payload.asOfTime<0)fail('STRICT_APPROVED_MARKER_PAYLOAD_REQUIRED');
    if(technical&&(!(payload.schemaVersion===2&&expected.sourceMode==='REPLAY'||[3,4,5].includes(payload.schemaVersion)&&expected.sourceMode==='LIVE')||payload.riskApprovalGranted!==false))fail('TECHNICAL_MARKER_SCOPE_REQUIRED');
    let signature=17;
    for(const char of payload.textPayload){const index=alphabet.indexOf(char);if(index<0)fail('UNREPRESENTABLE_MARKER_PAYLOAD');signature=(signature*31+index+1)%1000000007;}
    const rows=payload.textPayload.split('\n');
    if(payload.payloadSignature!==signature||rows.length!==payload.records.length+1||rows[0]!==[technical?payload.schemaVersion===5?'ARROW_FILL_MARKERS_V1':payload.schemaVersion===4?'ARROW_ENTRY_MARKERS_V1':payload.schemaVersion===3?'ARROW_DIRECTION_MARKERS_V1':'ARROW_TECHNICAL_MARKERS_V1':'ARROW_CANDLE_MARKERS_V1',expected.instrument,'1',expected.sourceMode,payload.asOfTime].join('|')||payload.status!==(payload.records.length?'READY':'EMPTY'))fail('MARKER_PAYLOAD_BINDING_CHANGED');
    for(let i=0;i<payload.records.length;i++){
      const record=payload.records[i],numbers=['time','closeTime','openTicks','highTicks','lowTicks','closeTicks','directionCode','priceTicks',...(technical?[]:['riskMicros'])];
      if(!record||!/^m\d+_\d+$/.test(record.markerId??'')||numbers.some(key=>!integer(record[key]))||record.closeTime-record.time!==60000||record.closeTime>payload.asOfTime||record.priceTicks!==(payload.schemaVersion===5&&record.entryFilled?record.fillPriceTicks:record.closeTicks)||record.directionCode!==(record.direction==='LONG'?1:record.direction==='SHORT'?-1:0)||record.sourceMode!==expected.sourceMode)fail('INVALID_APPROVED_MARKER_RECORD');
      if(technical){
        if(record.approvalKind!=='TECHNICAL'||['quantity','totalPlannedRisk','riskMicros','riskPlan'].some(key=>Object.hasOwn(record,key))||record.time<0||record.openTicks<=0||record.lowTicks<=0||record.highTicks<Math.max(record.openTicks,record.closeTicks,record.lowTicks)||record.lowTicks>Math.min(record.openTicks,record.closeTicks,record.highTicks))fail('INVALID_TECHNICAL_MARKER_RECORD');
      }else if(record.quantity!==1||record.riskMicros<=0||record.riskMicros>200000000||!finite(record.totalPlannedRisk)||Math.abs(record.totalPlannedRisk*1000000-record.riskMicros)>1)fail('INVALID_APPROVED_MARKER_RECORD');
      if(payload.schemaVersion===5&&(![record.fillTime,record.fillPriceTicks,record.fillUtcOffsetMinutes].every(integer)||Math.abs(record.fillUtcOffsetMinutes)>840||typeof record.entryFilled!=='boolean'||(record.entryFilled?record.fillTime<record.closeTime-5000||record.fillTime>payload.asOfTime+65000||record.fillPriceTicks<=0:record.fillTime!==0||record.fillPriceTicks!==0||record.fillUtcOffsetMinutes!==0)))fail('INVALID_NATIVE_FILL_MARKER_RECORD');
      if(rows[i+1]!==[record.markerId,record.time,record.closeTime,record.openTicks,record.highTicks,record.lowTicks,record.closeTicks,record.directionCode,payload.schemaVersion===5?record.closeTicks:record.priceTicks,...(technical?payload.schemaVersion===5?[record.entryFilled===true?1:0,record.fillTime,record.fillPriceTicks,record.fillUtcOffsetMinutes]:payload.schemaVersion===4?[record.entrySubmitted===true?1:0]:payload.schemaVersion===3?[record.liveApproved===true?1:0]:[]:[record.riskMicros])].join('|'))fail('MARKER_RECORD_TEXT_CHANGED');
    }
  }
  function expectedNative(){
    const last=payload.records.at(-1);
    return {ARROW_MARKER_SCHEMA:payload.kind==='TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD'&&payload.approvalKind==='TECHNICAL'?payload.schemaVersion:1,ARROW_MARKER_SIGNATURE:payload.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:payload.records.length,ARROW_MARKER_MATCHED_COUNT:payload.records.length,ARROW_MARKER_DRAWN_COUNT:payload.records.length,ARROW_MARKER_MODE:expected.sourceMode==='LIVE'?1:2,ARROW_MARKER_LAST_TIME:payload.schemaVersion===5&&last?.entryFilled?last.fillTime:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:payload.schemaVersion===5&&last?.entryFilled?last.fillPriceTicks:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:payload.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};
  }
  const nativeMatches=fields=>Object.entries(expectedNative()).every(([name,value])=>nativeNumber(fields[name])===value);
  function markerToolbar(){
    const titles=all('[title],[aria-label]',document).filter(node=>[node.getAttribute('title'),node.getAttribute('aria-label')].some(title=>title?.startsWith(studyTitle)));
    let toolbars=[...new Set(titles.map(node=>node.closest('[role="toolbar"]')).filter(Boolean))].filter(toolbar=>named('Settings',toolbar));
    if(toolbars.length===0){
      // The observed native legend can expose its study title only as rendered
      // text. Restrict this fallback to complete toolbar titles and an owned
      // unique Settings control; Data Window Hide-data toolbars cannot match.
      toolbars=all('[role="toolbar"]',document,300).filter(toolbar=>{
        const text=String(toolbar.innerText??toolbar.textContent??'').trim();
        if(!text.startsWith(studyTitle))return false;
        const suffix=text.slice(studyTitle.length);
        return (!suffix||/^[\s(]/.test(suffix))&&!!named('Settings',toolbar);
      });
    }
    if(toolbars.length!==1)fail(toolbars.length?'NATIVE_MARKER_TOOLBAR_AMBIGUOUS':'NATIVE_MARKER_SETTINGS_NOT_FOUND');
    return toolbars[0];
  }
  function markerLegendText(toolbar){
    const candidates=all('[title],[aria-label],span,div',toolbar,500).filter(node=>node.children.length===0&&norm(node.innerText??node.textContent)===studyTitle&&node.closest('[role="toolbar"]')===toolbar);
    if(candidates.length!==1)fail(candidates.length?'NATIVE_MARKER_LEGEND_TITLE_AMBIGUOUS':'NATIVE_MARKER_LEGEND_TITLE_NOT_FOUND');
    return candidates[0];
  }
  function describeControl(node){
    if(!node)return null;
    const attrs={};for(const name of ['role','aria-label','title','data-qa-id','data-name','data-entity-id','tabindex']){const value=node.getAttribute(name);if(value!==null)attrs[name]=String(value).slice(0,160);}
    const rect=node.getBoundingClientRect();
    return {tag:String(node.tagName??'').slice(0,20),attrs,text:norm(node.innerText??node.textContent).slice(0,160),connected:node.isConnected!==false,rendered:rendered(node),rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},pointerEvents:getComputedStyle(node).pointerEvents??null};
  }
  function inspectControls(){
    const toolbar=markerToolbar(),settings=named('Settings',toolbar),legend=markerLegendText(toolbar);
    return {toolbar:describeControl(toolbar),settings:describeControl(settings),legend:describeControl(legend)};
  }
  function currentOwnedDialog(){
    const dialogs=all('[role="dialog"],[aria-modal="true"]',document,20);
    return dialogs.length===1&&ownDialog(dialogs[0])?dialogs[0]:null;
  }
  async function publicControlGesture(target,toolbar,{double=false,kind}={}){
    const attempt={kind,target:describeControl(target),events:[],synthetic:true,opened:false};gestureAttempts.push(attempt);
    const rect=target.getBoundingClientRect(),clientX=rect.left+rect.width/2,clientY=rect.top+rect.height/2;
    if(!finite(clientX)||!finite(clientY)||rect.width<=0||rect.height<=0)fail('NATIVE_MARKER_GESTURE_TARGET_INVALID');
    function emit(type,{detail=0,buttons=0,pointer=false}={}){
      guard();if(currentOwnedDialog()){attempt.opened=true;return false;}
      if(target.isConnected===false||!rendered(target)||target.closest('[role="toolbar"]')!==toolbar)fail('NATIVE_MARKER_GESTURE_TARGET_CHANGED');
      const Constructor=pointer?globalThis.PointerEvent:MouseEvent;
      if(typeof Constructor!=='function')return true;
      const event=new Constructor(type,{bubbles:!['pointerenter','mouseenter'].includes(type),cancelable:true,composed:true,view:globalThis.window,clientX,clientY,button:0,buttons,detail,pointerId:1,pointerType:'mouse',isPrimary:true});
      target.dispatchEvent(event);attempt.events.push({type,detail,isTrusted:event.isTrusted===true});guard();
      if(currentOwnedDialog()){attempt.opened=true;return false;}return true;
    }
    // Public DOM events on this owned control only. Synthetic event trust is
    // deliberately not forged; success still requires the real owned dialog.
    for(const [type,pointer] of [['pointerover',true],['mouseover',false],['pointerenter',true],['mouseenter',false],['pointermove',true],['mousemove',false]])if(!emit(type,{pointer}))return currentOwnedDialog();
    for(let click=1;click<=(double?2:1);click++){
      if(!emit('pointerdown',{pointer:true,buttons:1})||!emit('mousedown',{buttons:1,detail:click}))return currentOwnedDialog();
      await checked(new Promise(resolve=>setTimeout(resolve,24)));if(currentOwnedDialog()){attempt.opened=true;return currentOwnedDialog();}
      if(!emit('pointerup',{pointer:true})||!emit('mouseup',{detail:click})||!emit('click',{detail:click}))return currentOwnedDialog();
      if(double&&click===1){await checked(new Promise(resolve=>setTimeout(resolve,45)));if(currentOwnedDialog()){attempt.opened=true;return currentOwnedDialog();}}
    }
    if(double)emit('dblclick',{detail:2});
    attempt.opened=!!currentOwnedDialog();return currentOwnedDialog();
  }
  function payloadTextarea(dialog){
    const areas=all('textarea',dialog,20),matches=areas.filter(area=>{
      if(norm(area.getAttribute('aria-label'))===inputTitle)return true;
      const labelled=(area.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById?.(id)?.textContent??'').join(' ');
      if(norm(labelled)===inputTitle)return true;
      if(area.id&&all('label[for]',dialog,100).some(label=>label.getAttribute('for')===area.id&&norm(label.textContent)===inputTitle))return true;
      let parent=area.parentElement;
      for(let depth=0;parent&&parent!==dialog&&depth<4;depth++,parent=parent.parentElement){
        if(all('textarea',parent,20).length!==1)continue;
        const labels=all('span,label,div',parent,100).filter(label=>label.children.length===0&&norm(label.textContent)===inputTitle);
        if(labels.length===1)return true;
      }
      return false;
    });
    if(matches.length!==1)fail(matches.length?'NATIVE_MARKER_INPUT_AMBIGUOUS':'NATIVE_MARKER_INPUT_NOT_FOUND');
    return matches[0];
  }
  async function paint(){
    let handle,timer;
    const frame=()=>new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{markerCode:'NATIVE_MARKER_PAINT_TIMEOUT'})),750);handle=requestAnimationFrame(()=>{clearTimeout(timer);resolve(epoch());});});
    try{timing.firstPaintEpoch=await checked(frame());timing.secondPaintEpoch=await checked(frame());}
    finally{clearTimeout(timer);if(handle!==undefined)cancelAnimationFrame(handle);}
  }
  const response=(status,reasonCodes=[])=>({status,reasonCodes,sourceMode:expected.sourceMode,instrument:expected.instrument,timeframe:'1',fields:lastFields,debugFields:lastDebugFields,controls:lastControls,gestureAttempts,researchSelection:lastChartSelection,documentTimeOrigin:performance.timeOrigin,...timing,elapsedMs:epoch()-receipt,ordersCreated:false,orderEligible:false,fillInferred:false,physicalDisplayMeasured:false,proofKind:repairing?'OWNED_ARCHIVE_SETTINGS_REQUEST_NOT_DATA_COVERAGE_PROOF':'NATIVE_PINE_FIELDS_TIME_PRICE_AND_OHLC_NOT_PHYSICAL_PIXELS'});
  try{
    if(!['read','inspect','deliver','repair_archive'].includes(command.action))fail('INVALID_NATIVE_MARKER_ACTION');
    let inputText=payload?.textPayload;
    if(repairing){const r=command.repair;if(payload!==undefined||expected.sourceMode!=='LIVE'||!integer(r?.requestedAt)||r.requestedAt<1577836800000||!Array.isArray(r.requests)||!r.requests.length||r.requests.length>8||r.requests.some(q=>!['1','5','15'].includes(q.timeframe)||!integer(q.time)||q.time<1577836800000||q.time%60000!==0||q.time>r.requestedAt))fail('INVALID_ARCHIVE_REPAIR_REQUEST');inputText='ARROW_ARCHIVE_REPAIR_V1|'+r.requestedAt+'\n'+r.requests.map(q=>q.timeframe+'|'+q.time).join('\n');}
    if(payload)validatePayload();
    const initialDialogs=all('[role="dialog"],[aria-modal="true"]',document,20);
    if(expected.backgroundSync===true&&initialDialogs.length)fail('NATIVE_MARKER_WAITING_FOR_USER_DIALOG');
    // Resume only our exact input dialog; all source/layout/witness checks are
    // still performed before touching its textarea or accepting the dialog.
    if(['inspect','deliver','repair_archive'].includes(command.action)&&initialDialogs.length===1&&ownDialog(initialDialogs[0]))allowOwnDialog=true;
    guard();
    if(command.action==='inspect'){lastControls=inspectControls();return response('NATIVE_MARKER_CONTROLS_INSPECTED');}
    if(command.action==='deliver'||repairing){
      if(!repairing)validatePayload();
      try{if(!repairing&&payload.schemaVersion>=3){lastFields=nativeFields();if(nativeMatches(lastFields))return response(payload.records.length?'NATIVE_MARKERS_VERIFIED':'NATIVE_EMPTY_MARKERS_VERIFIED');}}catch{}
      const activeCharts=all('[data-qa-id="chart-container"]',document,20).filter(node=>(node.getAttribute('class')??'').split(/\s+/).includes('active'));
      if(activeCharts.length===1){const show=named('Show indicators legend',activeCharts[0]);if(show&&!show.disabled){expandedLegend=activeCharts[0];show.click();await checked(new Promise(resolve=>requestAnimationFrame(resolve)));}}
      let dialog=initialDialogs.length===1&&ownDialog(initialDialogs[0])?initialDialogs[0]:null;
      if(dialog)timing.settingsResumedEpoch=epoch();
      else{
        const toolbar=markerToolbar(),button=named('Settings',toolbar);if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')fail('NATIVE_MARKER_SETTINGS_DISABLED');
        lastControls=inspectControls();
        // The actual native Settings control opens on mousedown. Use its
        // verified public gesture first; a preceding .click() and fixed wait
        // only added delay. The dialog, source and target guards are unchanged.
        allowOwnDialog=true;openedByCommand=true;guard();
        if(markerToolbar()!==toolbar||named('Settings',toolbar)!==button)fail('NATIVE_MARKER_GESTURE_TARGET_CHANGED');
        timing.settingsRequestedEpoch=epoch();timing.settingsGestureRequestedEpoch=timing.settingsRequestedEpoch;
        dialog=await publicControlGesture(button,toolbar,{kind:'OWNED_SETTINGS_POINTER_MOUSE'});
        if(!dialog)dialog=await waitOwnedDialog(280);
        if(!dialog){
          if(markerToolbar()!==toolbar)fail('NATIVE_MARKER_GESTURE_TARGET_CHANGED');
          const title=markerLegendText(toolbar);timing.legendDoubleClickRequestedEpoch=epoch();dialog=await publicControlGesture(title,toolbar,{double:true,kind:'OWNED_LEGEND_DOUBLE_POINTER_MOUSE'});
          if(!dialog)
          dialog=await until(()=>{const dialogs=all('[role="dialog"],[aria-modal="true"]',document,20);return dialogs.length===1&&ownDialog(dialogs[0])?dialogs[0]:null;});
        }
      }
      timing.settingsOpenedEpoch=epoch();
      const inputs=named('Inputs',dialog);if(inputs?.getAttribute('aria-selected')==='false'){inputs.click();await checked(new Promise(resolve=>requestAnimationFrame(resolve)));}
      const area=payloadTextarea(dialog),setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
      if(!setter||area.disabled||area.readOnly)fail('NATIVE_MARKER_INPUT_NOT_EDITABLE');
      guard();setter.call(area,inputText);area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new Event('change',{bubbles:true}));timing.payloadWrittenEpoch=epoch();
      await until(()=>area.value===inputText);
      const buttons=all('button,[role="button"]',dialog).filter(node=>['Ok','OK'].includes(exactText(node)));
      if(buttons.length!==1||buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')fail('NATIVE_MARKER_OK_NOT_ACTIONABLE');
      guard();buttons[0].click();timing.settingsSubmittedEpoch=epoch();
      await until(()=>all('[role="dialog"],[aria-modal="true"]',document,20).length===0);allowOwnDialog=false;
      if(repairing)return response('NATIVE_ARCHIVE_REPAIR_REQUEST_ACCEPTED');
      await until(()=>{try{lastFields=nativeFields();return nativeMatches(lastFields);}catch(error){if(['MARKER_STUDY_NOT_FOUND','MARKER_NATIVE_FIELD_UNAVAILABLE'].includes(error.markerCode))return false;throw error;}});
      timing.nativeVerifiedEpoch=epoch();await paint();return response(payload.records.length?'NATIVE_MARKERS_VERIFIED':'NATIVE_EMPTY_MARKERS_VERIFIED');
    }
    lastFields=nativeFields();
    if(payload&&!nativeMatches(lastFields))fail('NATIVE_MARKER_PROOF_MISMATCH');
    timing.nativeVerifiedEpoch=epoch();
    return response(payload?payload.records.length?'NATIVE_MARKERS_VERIFIED':'NATIVE_EMPTY_MARKERS_VERIFIED':'NATIVE_MARKER_FIELDS_READ');
  }catch(error){return response('BLOCKED',[typeof error?.markerCode==='string'?error.markerCode:'NATIVE_MARKER_UI_FAILED']);}
  finally{
    // Leave the chart's original legend visibility and no abandoned own dialog.
    try{if(openedByCommand){const own=all('[role="dialog"],[aria-modal="true"]',document,20).filter(ownDialog);if(own.length===1){const cancel=named('Cancel',own[0]);if(cancel&&!cancel.disabled)cancel.click();}}}catch{}
    try{if(expandedLegend?.isConnected){const hide=named('Hide indicators legend',expandedLegend);if(hide&&!hide.disabled)hide.click();}}catch{}
  }
}
