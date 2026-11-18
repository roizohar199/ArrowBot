import {summarizeTradeComparisons,RESEARCH_EXIT_VERSION} from './research-trade-comparison.mjs';
import {applyPaperTradeHistory,observedPaperPricePath,parsePaperTradeHistory} from './research-paper-history.mjs';
export const RESEARCH_STORAGE_KEY='arrow.research-upgrades.v1';
const copy=value=>structuredClone(value),finite=Number.isFinite;
const price=value=>finite(value)?new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(value):'—';
const recentPatternNames=[
  ['ADVANCE_BLOCK','Advance Block'],
  ['BEARISH_BELT_HOLD','Belt Hold דובי'],
];
const detectionTime=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'});
function stochasticText(reading){
  const {k,d,zone,cross}=reading;
  const range=zone==='HIGH'?'אזור גבוה':zone==='LOW'?'אזור נמוך':'אמצע הטווח';
  const crossing=cross==='UP'?' · חצייה מעלה':cross==='DOWN'?' · חצייה מטה':'';
  return `%K ${price(k)} · %D ${price(d)} · ${range}${crossing}`;
}
const outcomeLabels={OPEN:'במעקב',UNAVAILABLE:'חסרים נתונים',TARGET_REACHED:'היעד נגע',STOP_REACHED:'הסטופ נגע',AMBIGUOUS:'סדר הנגיעות אינו ידוע',ENTRY_BAR_UNCERTAIN:'סדר המחיר בנר הכניסה אינו ידוע',DATA_GAP:'פער בנתונים',INVALID_DATA:'נתון לא תקין',OBSERVATION_WINDOW_ENDED:'הסתיים חלון המעקב'};

function historicalImportInput(recording,{filename,costs}){
  if(recording?.kind!=='LIVE_OHLC_OBSERVATION'||recording.schemaVersion!==1)throw Error('נדרש קובץ ייצוא מקורי של מצב המעקב ב־Arrow.');
  const original=recording.analysisInputs,bars=original?.bars,metadata=original?.options?.metadata,asOfTime=original?.options?.asOfTime;
  if(!Array.isArray(bars)||bars.length<5||bars.length>4096||!metadata||typeof metadata.sourceId!=='string'||metadata.sourceId!==recording.selectedRun||!finite(asOfTime))throw Error('בייצוא חסרים נרות המקור, זהות המקור או זמן הניתוח המקורי.');
  const fill=recording.paperUserExecution?.lastVerifiedFill,native=fill?.nativeFill;
  if(fill?.fillVerified!==true||native?.kind!=='NATIVE_EXECUTED_FILL_V1'||native.provider!=='TRADINGVIEW_PAPER'||native.environment!=='DEMO'||native.synthetic!==false||native.testOnly!==false||!finite(native.filledAt)||native.filledAt>asOfTime||!['LONG','SHORT'].includes(native.direction)||fill.direction!==native.direction)throw Error('בייצוא לא נמצא מילוי פייפר מקורי מאומת שמתאים לזמן הניתוח.');
  const signal=(Array.isArray(recording.alerts)?recording.alerts:[]).findLast(a=>a?.runId===metadata.sourceId&&a?.sourceTabId===recording.selectedTabId&&a?.sessionId===recording.observationSession?.sessionId&&
    a.signal?.status==='CONFIRMED'&&a.signal.instrument===metadata.instrument&&a.signal.timeframe===metadata.timeframe&&a.signal.direction===native.direction&&a.signal.confirmationBarCloseTime===fill.latestClosedAt&&finite(a.signal.confirmedAt)&&a.signal.confirmedAt<=native.filledAt)?.signal;
  if(!signal)throw Error('לא נמצא אישור מקורי מאותו מקור, סשן, כיוון וזמן של המילוי.');
  if(typeof native.nativeAccountId!=='string'||!native.nativeAccountId||typeof native.nativeOrderId!=='string'||!native.nativeOrderId||typeof native.orderRow?.symbol!=='string'||!native.orderRow.symbol)throw Error('חסרים מזהי החשבון, החוזה או פקודת המילוי המקורית.');
  const safeFilename=typeof filename==='string'?filename.replace(/^.*[\\/]/,'').slice(0,160):'Arrow export';
  return {fill:copy(fill),signal:copy(signal),bars:copy(bars),metadata:copy(metadata),asOfTime,costs:copy(costs),
    provenance:{kind:'IMPORTED_ARROW_PAPER_EXPORT',filename:safeFilename,exportedAt:typeof recording.exportedAt==='string'?recording.exportedAt:null,costPolicy:'CURRENT_EXPLICIT_RESEARCH_ASSUMPTION'}};
}

export function createLiveResearchUpgrades({document,storage,WorkerClass=globalThis.Worker}={}){
  const $=id=>document.getElementById(id),root=$('research-upgrades');
  let enabled=true,loaded=false,canPersist=false,worker=null,serial=0,busy=false,pending=null,scope=null,lastKey=null,latest=null,error=null,records=[],disposed=false,saveTimer=null;
  let costs={commissionPerContract:null,slippageTicks:null},importStatus='';const fills=[],importRequests=new Map();
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  function importedStatus(message){importStatus=message;if($('research-import-status'))$('research-import-status').textContent=message;}
  function cancelImports(reason){for(const resolve of importRequests.values())resolve({ok:false,reason});importRequests.clear();for(const job of fills)job.resolve?.({ok:false,reason});}
  function summary(){return summarizeTradeComparisons(records);}
  function render(){
    if(!root)return;
    $('research-status').textContent=!enabled?'המחקר המקביל כבוי.':error?'המחקר ממתין: '+error:latest?`עודכן ${new Date(latest.asOfTime).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem'})} · תיעוד בלבד`:'ממתין לניתוח נרות סגורים.';
    const output=$('research-findings');output.replaceChildren();
    if(enabled&&latest){
      const momentum=latest.stochastic;
      if(momentum)output.append(node('p',momentum.latest
        ?`Stochastic ‏(12, 3, 3) · ${stochasticText(momentum.latest)}`
        :momentum.reason==='FLAT_RANGE'?'Stochastic · טווח המחירים שטוח':'Stochastic · ממתין לרצף נרות סגורים תקין'));
      const patterns=latest.candles?.latest??[],setups=latest.structure?.setups??[];
      output.append(node('p',patterns.length?`צורות נוספות בנר האחרון: ${[...new Set(patterns.map(p=>p.label??p.patternId))].join(' · ')}`:'לא זוהתה צורה נוספת בנר האחרון.'));
      for(const [id,label] of recentPatternNames){
        const last=latest.candles?.patterns?.findLast(pattern=>pattern.patternId===id);
        const status=last&&finite(last.barCloseTime)
          ?`זיהוי אחרון בסגירת ${detectionTime.format(last.barCloseTime)}`
          :latest.candles?.status==='OK'?'אין זיהוי בחלון המחקר המוצג':'ממתין לנתוני נרות';
        output.append(node('p',`${label} · ${status}`));
      }
      const events=latest.structure?.events??[];
      output.append(node('p',`מבנה Sweep / MSS / FVG: ${setups.length} מערכים מתועדים · ${events.length} אירועי התקדמות. זיהוי אינו אישור כניסה.`));
      if(latest.chartStructures?.status==='OK'){
        const counts=latest.chartStructures.counts;
        output.append(node('p',`תבניות מבנה שאושרו בחלון · Double Top ${counts.DOUBLE_TOP?.confirmed??0} · Double Bottom ${counts.DOUBLE_BOTTOM?.confirmed??0} · ריטסטים ${counts.BREAK_RETEST?.retested??0}`));
      }
      if(!['OK','NO_DATA'].includes(latest.candles?.status)||latest.structure?.status==='UNAVAILABLE')output.append(node('p','חלק מהגלאים ממתינים לנתונים תקינים; הפרטים נשמרים בייצוא.'));
    }
    const total=summary(),stats=$('research-comparison-summary');
    stats.textContent=`${total.totalRecords} כניסות פייפר מתועדות · ${total.pairedResolved} השוואות שהוכרעו בשני המסלולים · ${total.excluded} ממתינות או לא ודאיות.`;
    const actualClosed=records.filter(record=>record.actual?.status==='CLOSED');
    if(actualClosed.length)stats.textContent+=` תוצאות פייפר מהיסטוריית העסקאות · ${actualClosed.length} עסקות סגורות מקושרות.`;
    if(total.pairedResolved)stats.textContent+=` רווח מדומה ברוטו: קיים ${price(total.baseline.grossPnl)}; מבני ${price(total.structural.grossPnl)}. `+(total.baseline.netPnl===null?'עלויות לא הוגדרו לכל המדגם.':`נטו לפי הנחות העלות: קיים ${price(total.baseline.netPnl)}; מבני ${price(total.structural.netPnl)}.`);
    const list=$('research-trades');
    // Keep a note editor mounted while a user is typing through an update.
    if(document.activeElement?.className==='research-trade-note'&&list.contains(document.activeElement))return;
    list.replaceChildren();
    for(const record of records.slice(-10).reverse()){
      const item=node('li'),time=new Date(record.entryTime).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem'});
      item.append(node('strong',`${time} · ${record.direction==='LONG'?'לונג':'שורט'} ${price(record.entry)} · ${record.contract}`));
      if(record.stochasticAtConfirmation?.latest)item.append(node('p',`Stochastic באישור · ${stochasticText(record.stochasticAtConfirmation.latest)}`));
      if(record.createdFrom==='IMPORTED_PAPER_EXPORT'||record.importProvenance?.kind==='IMPORTED_ARROW_PAPER_EXPORT')item.append(node('p',`תיעוד עבר מיובא · ${new Date(record.entryTime).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem'})} · ${record.importProvenance?.filename??'Arrow export'}`));
      const actual=record.actual;
      if(actual){
        const pnl=finite(actual.netPnl)?` · נטו ${price(actual.netPnl)} USD`:'';
        const fee=finite(actual.commission)?` · עמלה מדווחת ${price(actual.commission)} USD`:'';
        item.append(node('p',`בפועל בפייפר · ${actual.status==='CLOSED'?'נסגרה':`מילוי חלקי ${actual.quantity}/${record.quantity}`} · מחיר יציאה ממוצע ${price(actual.averageExit)}${pnl}${fee}`));
        for(const exit of actual.exits)item.append(node('p',`יציאה · ${exit.timeText} · ${exit.quantity} חוזים · ${price(exit.price)}`));
        if(actual.pricePath)item.append(node('p',`מסלול מחיר בפועל · ${price(actual.pricePath.mfePoints)} לטובת הכיוון · ${price(actual.pricePath.maePoints)} נגדו · ${actual.pricePath.bars} נרות דקה מלאים`));
      }else item.append(node('p','בפועל בפייפר · ממתין ליציאות מקושרות מ־Trade History.'));
      for(const [key,label] of [['baseline','ניהול קיים'],['structural','הצעה מבנית']]){
        const leg=record[key],plan=leg.plan;
        const reason=plan.reasonCodes?.includes('NO_KNOWN_UNBROKEN_TARGET')?' · אין יעד מבני ידוע מתאים':'';
        item.append(node('p',`${label}: SL ${price(plan.stop)} · TP ${price(plan.target)}${finite(plan.rewardRisk)?` · יחס ${price(plan.rewardRisk)}`:''} · ${outcomeLabels[leg.outcome.status]??leg.outcome.status}${reason}`));
        if(plan.status==='PLANNED')item.append(node('p',`נרות מלאים לפני יציאה מדומה · ${price(leg.mfePoints)} נק׳ לטובת הכיוון · ${price(leg.maePoints)} נגדו`));
      }
      const notes=node('label','הערת תחקור'),input=node('textarea','');
      input.rows=1;input.maxLength=240;input.className='research-trade-note';input.value=record.note??'';
      input.addEventListener('input',()=>{
        records=records.map(row=>row.id===record.id?{...row,note:input.value.slice(0,240)}:row);save();
      });
      notes.append(input);item.append(notes);
      list.append(item);
    }
  }
  function persist(){
      // Never overwrite unread history with defaults during close/reload or a
      // failed storage read. Closing before hydration has nothing new to save.
      if(!loaded||!canPersist)return;
      // Keep summaries/levels/outcomes after restart, bounded independently of the OHLC history.
      const saved=records.slice(-100).map(r=>({...copy(r),observedBars:(r.observedBars??[]).slice(-8)}));
      try{Promise.resolve(storage?.set?.({[RESEARCH_STORAGE_KEY]:{version:1,enabled,costs,records:saved}})).catch(()=>{error='לא ניתן לשמור את המחקר המקומי';render();});}catch{error='לא ניתן לשמור את המחקר המקומי';render();}
  }
  function save(){
    clearTimeout(saveTimer);saveTimer=setTimeout(persist,150);
  }
  function submit(){
    if(disposed||!loaded||!enabled||busy||!worker)return;
    const job=fills.shift()??pending;if(!job)return;if(job===pending)pending=null;
    if(job.kind==='analysis')job.input.comparisons=copy(records);
    const {resolve,...message}=job,id=++serial;if(resolve)importRequests.set(id,resolve);
    busy=true;try{worker.postMessage({...message,id});}catch(e){busy=false;error=String(e.message);importRequests.delete(id);resolve?.({ok:false,reason:error});render();}
  }
  try{
    worker=new WorkerClass(new URL('./research-upgrades-worker.mjs',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      if(disposed)return;
      busy=false;
      const imported=importRequests.get(data.id);importRequests.delete(data.id);
      if(data.error){if(imported){importedStatus('טעינת התיעוד לא הושלמה: '+data.error);imported({ok:false,reason:data.error});}if(data.scope===scope){error=data.error;render();}submit();return;}
      if(data.kind==='fill'||data.kind==='import'){
        const duplicate=!!data.result&&records.some(r=>r.id===data.result.id);
        if(data.result&&!records.some(r=>r.id===data.result.id))records.push(data.result);
        records=records.slice(-100);
        if(imported){const message=!data.result?'לא ניתן לחשב את המילוי המקורי בקובץ.':duplicate?'הרשומה כבר שמורה; התיעוד הקיים נשמר ללא החלפה.':'נטען תיעוד עבר מיובא. הרמות והתוצאות מוצגות כהשוואת מחקר בלבד.';importedStatus(message);imported({ok:!!data.result,duplicate,id:data.result?.id??null,reason:data.result?null:message});}
      }else{
        // Merge by id: a fill arriving during a worker scan is never discarded.
        const updates=new Map((data.result?.comparisons??[]).map(r=>[r.id,r]));
        records=records.map(record=>{
          const update=updates.get(record.id);
          if(!update)return record;
          const actual=record.actual&&{...record.actual,pricePath:observedPaperPricePath(update,record.actual)??record.actual.pricePath??null};
          return {...update,...(actual?{actual}:{}),...(record.note!==undefined?{note:record.note}:{})};
        });
        if(data.scope===scope)latest=data.result;
      }
      error=null;save();render();submit();
    };
    worker.onerror=()=>{busy=false;error='גלאי המחקר לא נטענו; מסלול הכניסה ממשיך בנפרד';cancelImports(error);fills.length=0;worker?.terminate();worker=null;render();};
  }catch{error='המחקר דורש תמיכה בעובד רקע בדפדפן';}
  const ready=(async()=>{
    try{
      const saved=(await storage?.get?.(RESEARCH_STORAGE_KEY))?.[RESEARCH_STORAGE_KEY];
      canPersist=true;
      if(saved?.version===1){
        enabled=saved.enabled!==false;
        if(saved.costs&&['commissionPerContract','slippageTicks'].every(k=>saved.costs[k]===null||finite(saved.costs[k])&&saved.costs[k]>=0))costs=copy(saved.costs);
        const restored=(Array.isArray(saved.records)?saved.records:[]).filter(r=>r?.version===RESEARCH_EXIT_VERSION&&r.researchOnly===true&&r.entryVeto===false&&typeof r.id==='string'&&finite(r.entryTime)&&r.baseline?.plan&&r.baseline?.outcome&&r.structural?.plan&&r.structural?.outcome).slice(-100);
        const currentIds=new Set(records.map(r=>r.id));records=[...restored.filter(r=>!currentIds.has(r.id)),...records].slice(-100);
      }
    }catch{error='לא ניתן לקרוא את המחקר השמור';}
    if(disposed)return;
    if(root){$('research-enabled').checked=enabled;for(const [key,id] of [['commissionPerContract','research-commission'],['slippageTicks','research-slippage']])$(id).value=costs[key]??'';}
    loaded=true;render();submit();
  })();
  if(root){
    $('research-enabled').addEventListener('change',()=>{enabled=$('research-enabled').checked;lastKey=null;if(!enabled){pending=null;for(const job of fills)job.resolve?.({ok:false,reason:'המחקר המקביל כובה'});fills.length=0;}save();render();submit();});
    for(const [key,id] of [['commissionPerContract','research-commission'],['slippageTicks','research-slippage']])$(id).addEventListener('change',()=>{const value=$(id).value.trim();costs[key]=value!==''&&finite(Number(value))&&Number(value)>=0?Number(value):null;save();render();});
  }
  async function importRecording(recording,{filename}={}){
    await ready;
    const fail=reason=>{importedStatus(reason);return {ok:false,reason};};
    if(disposed||!loaded)return fail('לוח המחקר כבר נסגר.');
    if(!enabled)return fail('יש להפעיל חישוב ותיעוד ברקע לפני טעינת תיעוד.');
    if(!worker)return fail('עובד המחקר אינו זמין.');
    let input;try{input=historicalImportInput(recording,{filename,costs});}catch(e){return fail(String(e.message??e));}
    const id=[input.fill.nativeFill.provider,input.fill.nativeFill.nativeAccountId,input.fill.nativeFill.orderRow.symbol,input.fill.nativeFill.nativeOrderId].join(':');
    if(records.some(r=>r.id===id)){importedStatus('הרשומה כבר שמורה; התיעוד הקיים נשמר ללא החלפה.');return {ok:true,duplicate:true,id};}
    importedStatus('טוען תיעוד עבר ומחשב את שתי תוכניות היציאה…');
    return new Promise(resolve=>{fills.push({kind:'import',scope:JSON.stringify([input.metadata.sourceId,input.metadata.instrument,input.metadata.timeframe]),input,resolve});submit();});
  }
  $('research-import')?.addEventListener('change',async event=>{
    const field=event.target,file=field.files?.[0];if(!file)return;
    try{if(!finite(file.size)||file.size<=0||file.size>80*1024*1024)throw Error('קובץ הייצוא חייב להיות עד 80MB.');const recording=JSON.parse((await file.text()).replace(/^\uFEFF/,''));await importRecording(recording,{filename:file.name});}
    catch(e){importedStatus('לא ניתן לטעון את התיעוד: '+String(e.message??e));}
    finally{field.value='';}
  });
  $('research-paper-history')?.addEventListener('change',async event=>{
    const picker=event.currentTarget,file=picker.files?.[0],status=$('research-paper-history-status');
    if(!file)return;
    picker.disabled=true;
    try{
      await ready;
      if(file.size>2_000_000)throw Error('קובץ Trade History חייב להיות עד 2MB.');
      const parsed=parsePaperTradeHistory(await file.text()),result=applyPaperTradeHistory(records,parsed,file.name);
      records=result.records;
      if(result.changed){save();render();}
      status.textContent=result.matched?`קושרו ${result.matched} רשומות פייפר לפי מזהי הפקודות ומספרי העסקאות.`:'לא נמצאה התאמה לכניסת פייפר שמורה. טען תחילה את ייצוא Arrow עם המילוי.';
    }catch(error){status.textContent=String(error.message??error);}
    finally{picker.value='';picker.disabled=false;}
  });
  render();
  return {
    ready,
    importRecording,
    available:()=>!!worker&&enabled&&!disposed,
    observe({bars,metadata,asOfTime}){
      if(disposed||!enabled||!metadata||!finite(asOfTime)||!Array.isArray(bars))return;
      scope=JSON.stringify([metadata.sourceId,metadata.instrument,metadata.timeframe]);
      const key=scope+':'+asOfTime;if(key===lastKey)return;lastKey=key;
      pending={kind:'analysis',scope,input:{bars,metadata,asOfTime,comparisons:copy(records)}};submit();
    },
    capture({fill,signal,bars,metadata}){
      if(disposed||!enabled||!fill||!metadata)return;
      fills.push({kind:'fill',scope,input:{fill:copy(fill),signal:copy(signal),bars:copy(bars),metadata:copy(metadata),costs:copy(costs)}});
      if(fills.length>10)fills.shift()?.resolve?.({ok:false,reason:'תור המחקר מלא'});lastKey=null;submit();
    },
    snapshot:()=>({version:'research-upgrades-1',enabled,researchOnly:true,orderEligible:false,entryVeto:false,costs:copy(costs),latest:copy(latest),comparisons:copy(records),summary:summary(),error,importStatus}),
    dispose(){disposed=true;cancelImports('לוח המחקר נסגר');clearTimeout(saveTimer);persist();worker?.terminate();},
  };
}
