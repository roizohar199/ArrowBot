import {createPanelLatencyProbe} from './latency-probe.mjs';

const installed=new WeakMap();
const finite=Number.isFinite;
const number=value=>finite(value)?value.toFixed(1):'—';
const copy=value=>structuredClone(value);
const messages={
  FEATURE_PROBE_COMPLETE:'בדיקת חותמת הצילום הסתיימה.',
  CAPTURE_TIME_UNAVAILABLE:'לא נמצאה חותמת צילום תקינה. ההשהיה מצילום לתצוגה אינה זמינה למדידה במסלול הזה.',
  FEATURE_TIMEOUT:'לא התקבלו שלוש תמונות במהלך זמן בדיקת הזמינות.',
  COMPLETE:'מדידת 30 השניות הסתיימה.',STOPPED:'המדידה נעצרה והחיבור הזמני הוסר.',
  PANEL_CLOSED:'לוח המעקב נסגר והמדידה נעצרה.',SHORTCUTS_NOT_OFF:'המדידה נעצרה: קיצורי המסחר אינם כבויים.',
  MONITORING_STOPPED:'המעקב נעצר; המדידה הסתיימה.',WATCHDOG_TIMEOUT:'המדידה הסתיימה בתום זמן ההמתנה המרבי.',
  PROBE_SETUP_FAILED:'לא ניתן להתחיל את המדידה בדפדפן הזה.',
};

// Controls are inert until the user starts a bounded diagnostic. They never
// change capture selection, trading settings, or broker/order state.
export function installCaptureProbeControls({panel,container,preview,detail}={}){
  if(!panel?.document||!container||!preview||!detail)throw TypeError('A panel, diagnostic container, preview and candle detail are required');
  if(installed.has(container))return installed.get(container);
  const doc=panel.document,root=doc.createElement('section');root.className='capture-probe';
  const make=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const title=make('h3','בדיקת השהיה מצילום לתצוגה');
  const help=make('p','הבדיקה כבויה כברירת מחדל. היא קוראת חותמת צילום רק אם הדפדפן מספק אותה, ומודדת עד שתי הזדמנויות ציור בדפדפן. אין כאן מדידת שוק או מדידת פיקסלים במסך הפיזי.','supporting-text');
  const actions=make('div',undefined,'capture-probe-actions');
  const feature=make('button','בדיקת חותמת צילום'),measure=make('button','מדידה במשך 30 שניות'),stop=make('button','עצירת המדידה'),download=make('button','הורדת דוח צילום JSON');
  for(const button of [feature,measure,stop,download]){button.type='button';actions.append(button);}
  stop.disabled=true;download.disabled=true;
  const status=make('p','לא הופעלה בדיקת צילום.','supporting-text');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const summary=make('p','חותמת צילום: לא נבדקה · דגימות תצוגה: 0','supporting-text');
  const scope=make('p','זמן קבלת תמונה וזמן מדיה אינם חותמת צילום. תמונות ללא חותמת אמינה או תוצאה נסתרת, מחוץ למסך או שהוחלפה אינן מקבלות מדידת השהיה מלאה.','supporting-text');
  const disclosure=make('details'),heading=make('summary','פרטי דוח הצילום'),technical=make('pre','טרם בוצעה בדיקה.');technical.dir='ltr';technical.style.whiteSpace='pre-wrap';technical.style.maxHeight='320px';technical.style.overflow='auto';
  disclosure.append(heading,technical);root.append(title,help,actions,status,summary,scope,disclosure);container.append(root);
  let current=null,lastReport=null,disposed=false,generation=0,lastProgressAt=-Infinity;
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push([node,event,handler]);};
  function buttons(busy){feature.disabled=busy;measure.disabled=busy;stop.disabled=!busy;download.disabled=busy||!lastReport;}
  function ready(){
    if(doc.getElementById('shortcut-toggle')?.getAttribute('aria-pressed')!=='false')return 'יש לכבות את קיצורי המסחר לפני בדיקת ההשהיה. הבדיקה לא שינתה את מצבם.';
    if(doc.getElementById('stop')?.disabled!==false)return 'יש להפעיל מעקב וצילום לפני הבדיקה.';
    return null;
  }
  function show(report){
    const lower=report.latencyMs.lowerPaintOpportunity,upper=report.latencyMs.upperPaintOpportunity;
    summary.textContent=`תמונות: ${report.totalDraws} · חותמות צילום תקינות: ${report.validCaptureFrames} · דגימות תצוגה: ${report.paintSamples}${report.latencyAvailable?` · חציון: ${number(lower.p50Ms)}–${number(upper.p50Ms)} ms · אחוזון 95: ${number(lower.p95Ms)}–${number(upper.p95Ms)} ms`:''}`;
    const reason=messages[report.reason]??`הבדיקה הסתיימה: ${report.reason}.`;
    const explanation=report.latencyAvailable?' מוצג חלון בין שתי הזדמנויות ציור, ולא זמן הצגת פיקסלים מובטח.':report.validCaptureFrames?(report.mode==='feature'?' נמצאה חותמת צילום; הפעילו מדידת 30 שניות כדי למדוד תצוגה.':' נמצאה חותמת צילום, אך לא התקבלו דגימות תצוגה תקינות. השאירו את תוצאת הנרות גלויה בתוך המסך.'):' לא הוסקה חותמת צילום מזמן מדיה או מזמן קבלה.';
    status.textContent=reason+explanation;
    technical.textContent=JSON.stringify(report,null,2);
  }
  function run(mode){
    if(disposed||current)return;
    const warning=ready();if(warning){status.textContent=warning;return;}
    const token=++generation;lastProgressAt=-Infinity;buttons(true);
    status.textContent=mode==='feature'?'בודק חותמות בשלוש התמונות הבאות שכבר מגיעות ללוח…':'מודד במשך 30 שניות. השאירו את הלוח גלוי ואת תוצאת הנרות בתוך המסך.';
    try{
      const probe=createPanelLatencyProbe({panel,preview,detail,mode,durationMs:30000,
        onProgress:progress=>{
          if(disposed||token!==generation)return;
          const at=panel.performance.now();if(at-lastProgressAt<250)return;lastProgressAt=at;
          summary.textContent=`תמונות: ${progress.totalDraws} · חותמות צילום תקינות: ${progress.validCaptureFrames} · דגימות תצוגה: ${progress.paintSamples}`;
        },
        onComplete:report=>{
          if(disposed||token!==generation)return;
          current=null;lastReport=copy(report);show(report);buttons(false);
        },
      });
      current=probe;probe.start();
    }catch(error){
      const probe=current;current=null;probe?.stop('PROBE_SETUP_FAILED');
      if(disposed||token!==generation)return;
      buttons(false);status.textContent=`לא ניתן להתחיל מדידה: ${String(error?.message??error).slice(0,180)}`;
    }
  }
  function exportReport(){
    if(disposed||current||!lastReport)return;
    let url=null;
    try{
      url=panel.URL.createObjectURL(new panel.Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}));
      const anchor=doc.createElement('a');anchor.href=url;anchor.download='arrow-capture-latency-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
      doc.body.append(anchor);anchor.click();anchor.remove();
      const objectUrl=url;panel.setTimeout(()=>panel.URL.revokeObjectURL(objectUrl),1000);
      status.textContent='דוח הצילום הורד מקומית. הדוח כולל זמינות חותמות, דגימות שנפסלו ומגבלות המדידה.';
    }catch(error){if(url)try{panel.URL.revokeObjectURL(url);}catch{}status.textContent='ייצוא הדוח נכשל: '+String(error?.message??error).slice(0,160);}
  }
  listen(feature,'click',()=>run('feature'));listen(measure,'click',()=>run('latency'));listen(stop,'click',()=>current?.stop('STOPPED'));listen(download,'click',exportReport);
  const api={
    snapshot:()=>({active:!!current,report:lastReport?copy(lastReport):null}),
    dispose(){
      if(disposed)return;disposed=true;generation++;const probe=current;current=null;probe?.stop('CONTROLS_DISPOSED');
      for(const [node,event,handler] of listeners)node.removeEventListener(event,handler);root.remove();installed.delete(container);
    },
  };
  installed.set(container,api);return api;
}
