import {createSourceMarkerProbe,sourceMarkerCommand} from './source-marker-probe.mjs';

const installed=new WeakMap();
const copy=value=>structuredClone(value);
const number=value=>Number.isFinite(value)?value.toFixed(1):'—';
const reasons={COMPLETE:'מדידת הסמן הסתיימה.',STOPPED:'מדידת הסמן נעצרה.',SHORTCUTS_NOT_OFF:'המדידה נעצרה משום שקיצורי המסחר אינם כבויים.',MONITORING_STOPPED:'המעקב נעצר; מדידת הסמן הסתיימה.',SOURCE_COMMAND_FAILED:'פקודת הסמן לא הושלמה או לא אומתה.',SOURCE_CONTEXT_CHANGED:'לשונית המקור או הקשר המעקב השתנו; המדידה נעצרה.',PAGE_HIDDEN:'הלוח נסגר; נשלחה בקשת הסרת הסמן.'};
const tvUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='tradingview.com'||url.hostname.endsWith('.tradingview.com'))&&url.pathname.startsWith('/chart/');}catch{return false;}};

export function installSourceMarkerControls({panel,container,detail,getTarget,getContext,isMonitoring,executeSource}={}){
  if(!panel?.document||!container||!detail||[getTarget,getContext,isMonitoring,executeSource].some(fn=>typeof fn!=='function'))throw TypeError('Marker diagnostic panel, source callbacks and DOM result are required');
  if(installed.has(container))return installed.get(container);
  const doc=panel.document,root=doc.createElement('section');root.className='capture-probe source-marker-probe';
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const title=make('h3','בדיקת מסלול חזותי באמצעות סמן מקור');
  const help=make('p','חלופה כשאין חותמת צילום: הבדיקה מציגה למשך עד 30 שניות פס שחור־לבן קטן בפינת לשונית הגרף הנבחרת, ומזהה אותו בתמונה שכבר נקלטת. המדידה היא משינוי הסמן במקור לתוצאת הנרות ולהזדמנויות ציור; היא אינה זמן צילום ישיר, זמן בורסה או זמן פיקסלים פיזי.');help.className='supporting-text';
  const actions=make('div');actions.className='capture-probe-actions';const start=make('button','מדידת סמן מקור · 30 שניות'),stop=make('button','עצירת סמן המקור'),download=make('button','הורדת דוח סמן JSON');
  for(const node of [start,stop,download]){node.type='button';actions.append(node);}stop.disabled=true;download.disabled=true;
  const status=make('p','בדיקת הסמן כבויה. קיצורי המסחר נשארים כבויים.');status.className='supporting-text';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const summary=make('p','טרם נמדדו דגימות סמן.');summary.className='supporting-text';const disclosure=make('details'),heading=make('summary','פרטי מדידת הסמן'),technical=make('pre','טרם בוצעה בדיקה.');technical.dir='ltr';disclosure.append(heading,technical);root.append(title,help,actions,status,summary,disclosure);container.append(root);
  let current=null,lastReport=null,disposed=false,generation=0,lastProgress=-Infinity,initialScroll=null,probeScroll=null,fixedTarget=null,fixedContext=null;
  const listeners=[];const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push([node,event,handler]);};
  const shortcutsOff=()=>doc.getElementById('shortcut-toggle')?.getAttribute('aria-pressed')==='false';
  function sameContext(){const target=getTarget();return target?.id===fixedTarget?.id&&target?.url===fixedTarget?.url&&getContext()===fixedContext;}
  function buttons(busy){start.disabled=busy;stop.disabled=!busy;download.disabled=busy||!lastReport;}
  function show(report){
    const lower=report.metrics.sourceMutationToPaintLowerMs,upper=report.metrics.sourceMutationToPaintUpperMs;
    summary.textContent=`סמנים שנשלחו: ${report.sourceCommands} · תמונות סמן שזוהו: ${report.decodedFrames} · דגימות תצוגה: ${report.sampleCount}`+(upper.count?` · מקור→הזדמנויות ציור: חציון ${number(lower.p50Ms)}–${number(upper.p50Ms)} ms · אחוזון 95 עד ${number(upper.p95Ms)} ms`:'');
    status.textContent=(reasons[report.reason]??'מדידת הסמן הסתיימה: '+report.reason)+` הסרת הסמן: ${report.cleanup==='REMOVED'?'אומתה':'לא אומתה; לסמן יש גם תפוגה אוטומטית במקור'}.`+(!upper.count?' לא התקבלו דגימות תצוגה כשירות; השאירו את המקור והתוצאה נראים וודאו שהגרף המשותף הוא הגרף שנבחר.':' הגבולות כוללים אי־ודאות של בקשת המקור ואינם חותמת צילום או מדידת מסך פיזי.');
    technical.textContent=JSON.stringify(report,null,2);
  }
  function restoreScroll(){try{if(initialScroll&&probeScroll&&panel.scrollX===probeScroll.x&&panel.scrollY===probeScroll.y)panel.scrollTo(initialScroll.x,initialScroll.y);}catch{}initialScroll=null;probeScroll=null;}
  async function stopProbe(reason='STOPPED'){const probe=current;if(!probe)return lastReport;status.textContent='עוצר ומסיר את הסמן מהמקור…';return probe.stop(reason);}
  function begin(){
    if(disposed||current)return;
    if(!shortcutsOff()){status.textContent='יש לכבות קיצורי מסחר לפני בדיקת הסמן. הבדיקה לא שינתה את מצבם.';return;}
    if(!isMonitoring()){status.textContent='יש להפעיל שיתוף ומעקב נרות לפני בדיקת הסמן.';return;}
    const selected=getTarget();if(!Number.isSafeInteger(selected?.id)||selected.id<1||!tvUrl(selected.url)){status.textContent='בחרו בלוח את אותה לשונית TradingView שאתם משתפים.';return;}
    const runTarget={id:selected.id,url:selected.url},runContext=getContext();fixedTarget=runTarget;fixedContext=runContext;const token=++generation;lastProgress=-Infinity;
    const sourceMatches=()=>{const target=getTarget();return target?.id===runTarget.id&&target?.url===runTarget.url&&getContext()===runContext;};
    try{
      const probe=createSourceMarkerProbe({sendSourceCommand:async command=>{
        if(command.operation==='put'&&!sourceMatches())throw Error('SOURCE_CONTEXT_CHANGED');
        const result=await executeSource(runTarget.id,sourceMarkerCommand,command);return result;
      },now:()=>panel.performance.now(),epochNow:()=>panel.performance.timeOrigin+panel.performance.now(),wallNow:()=>Date.now(),
      requestAnimationFrame:fn=>panel.requestAnimationFrame(fn),cancelAnimationFrame:id=>panel.cancelAnimationFrame(id),isVisible:()=>doc.visibilityState==='visible'&&!doc.hidden,
      isOnscreen:()=>{const r=detail.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.bottom<=panel.innerHeight&&r.right<=panel.innerWidth;},shortcutsOff,isMonitoring:()=>isMonitoring()&&sourceMatches(),
      setTimer:(fn,ms)=>panel.setTimeout(fn,ms),clearTimer:id=>panel.clearTimeout(id),intervalMs:200,durationMs:30000,
      onProgress:report=>{if(disposed||token!==generation)return;const at=panel.performance.now();if(at-lastProgress<250)return;lastProgress=at;summary.textContent=`סמנים שנשלחו: ${report.sourceCommands} · תמונות שזוהו: ${report.decodedFrames} · דגימות תצוגה: ${report.sampleCount}`;},
      onComplete:report=>{if(disposed||token!==generation)return;current=null;lastReport={...copy(report),selectedSource:copy(runTarget),observationContext:runContext};show(lastReport);buttons(false);restoreScroll();},
      });
      current=probe;buttons(true);initialScroll={x:panel.scrollX,y:panel.scrollY};detail.closest('.candle-readout')?.scrollIntoView({block:'center',behavior:'instant'});probeScroll={x:panel.scrollX,y:panel.scrollY};probe.start();
      status.textContent='מודד סמן מקור למשך 30 שניות. השאירו את הגרף המשותף ואת תוצאת הנרות גלויים; קיצורי המסחר כבויים.';
    }catch(error){const probe=current;current=null;if(probe)void probe.stop('SETUP_FAILED');buttons(false);restoreScroll();status.textContent='בדיקת הסמן לא החלה: '+String(error?.message??error).slice(0,160);}
  }
  function onFrame(image,meta={}){
    if(!current||disposed)return false;
    if(!sameContext()){void stopProbe('SOURCE_CONTEXT_CHANGED');return false;}
    return current.onFrame(image,{frameId:meta.frameId,receivedAt:meta.receivedAt,resultRendered:meta.tracking===true&&meta.resultRendered===true});
  }
  function exportReport(){
    if(!lastReport||current||disposed)return;let url;
    try{url=panel.URL.createObjectURL(new panel.Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}));const link=make('a');link.href=url;link.download='arrow-source-marker-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';doc.body.append(link);link.click();link.remove();const own=url;panel.setTimeout(()=>panel.URL.revokeObjectURL(own),1000);}
    catch(error){if(url)try{panel.URL.revokeObjectURL(url);}catch{}status.textContent='ייצוא דוח הסמן נכשל: '+String(error?.message??error).slice(0,160);}
  }
  listen(start,'click',begin);listen(stop,'click',()=>{void stopProbe();});listen(download,'click',exportReport);
  const monitorStop=doc.getElementById('stop'),shortcutToggle=doc.getElementById('shortcut-toggle'),targetSelector=doc.getElementById('shortcut-target');
  if(monitorStop)listen(monitorStop,'click',()=>{if(current)void stopProbe('MONITORING_STOPPED');});
  if(shortcutToggle)listen(shortcutToggle,'click',()=>{if(current)void stopProbe('SHORTCUTS_NOT_OFF');});
  if(targetSelector)listen(targetSelector,'change',()=>{if(current)void stopProbe('SOURCE_CONTEXT_CHANGED');});
  const api={onFrame,stop:stopProbe,snapshot:()=>({active:!!current,report:lastReport?copy(lastReport):null}),async dispose(){if(disposed)return;disposed=true;generation++;const probe=current;current=null;if(probe)await probe.stop('PAGE_HIDDEN');for(const [node,event,handler] of listeners)node.removeEventListener(event,handler);root.remove();installed.delete(container);}};
  installed.set(container,api);return api;
}
