import {analyzeCandlePatterns} from './candle-patterns.mjs';

// Screen geometry has no verified bar times, close flags or price scale. These
// observations can describe a shape, but can never confirm a guide alert/order.
export function createGuideVisualAdvisor({intervalMs=120,maxBars=40}={}){
  if(!Number.isFinite(intervalMs)||intervalMs<0||!Number.isSafeInteger(maxBars)||maxBars<3||maxBars>96)throw TypeError('Invalid visual guide limits');
  let binding=null,lastAt=-Infinity,previous=null;
  const reset=()=>{binding=null;lastAt=-Infinity;previous=null;};
  const unavailable=reason=>({status:'UNAVAILABLE',reasonCodes:[reason],direction:null,patterns:[],final:false,orderEligible:false,unit:'pixels'});
  function inspect(result,{context,geometry,capturedAt}={}){
    if(typeof context!=='string'||typeof geometry!=='string'||!Number.isFinite(capturedAt)){reset();return unavailable('INVALID_CONTEXT');}
    const nextBinding=context+'|'+geometry;
    if(binding!==nextBinding){reset();binding=nextBinding;}
    if(capturedAt<=lastAt)return previous??unavailable('DUPLICATE_FRAME');
    if(result?.status!=='TRACKING'||!result.active){previous=unavailable(result?.reason??'WAITING_FOR_CANDLES');lastAt=capturedAt;return previous;}
    if(!Number.isSafeInteger(result.active.observedId)||result.active.observedId<1){previous=unavailable('OBSERVED_ID_REQUIRED');lastAt=capturedAt;return previous;}
    if(capturedAt-lastAt<intervalMs&&previous?.observedId===result.active.observedId)return previous;
    lastAt=capturedAt;
    if(!Array.isArray(result.candles)||result.candles.length>512){previous=unavailable('INVALID_CANDLES');return previous;}
    const raw=result.candles.filter(c=>!c.clipped).sort((a,b)=>a.x-b.x);
    if(!raw.length||Math.abs(raw.at(-1).x-result.active.x)>.75){previous=unavailable('LATEST_UNVERIFIED');return previous;}
    const gaps=raw.slice(1).map((c,i)=>c.x-raw[i].x).filter(g=>g>=3&&g<=128),bins=new Map();
    for(const gap of gaps){const key=Math.round(gap*2)/2;bins.set(key,(bins.get(key)??0)+1);}
    const pitch=[...bins].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??null;
    const contiguous=[raw.at(-1)];
    // Missing candles are gaps, never adjacent bars. Limit multi-bar shapes to
    // a regular suffix, so an omitted/occluded old candle cannot create engulfing.
    if(pitch!==null)for(let i=raw.length-2;i>=0&&contiguous.length<maxBars;i--){
      const later=contiguous[0],candidate=raw[i],gap=later.x-candidate.x;
      if(Math.abs(gap-pitch)>Math.max(.75,pitch*.08)||Math.abs(candidate.bodyWidth-later.bodyWidth)>1)break;
      contiguous.unshift(candidate);
    }
    const bars=contiguous.map(c=>({open:-c.openY,high:-c.highY,low:-c.lowY,close:-c.closeY,closed:false,chartType:'standard'}));
    const shapes=analyzeCandlePatterns(bars,{mode:'preview',unit:'pixels',tickSize:1,minRangeTicks:4,requireTimestamps:false});
    const patterns=(shapes.patterns??[]).filter(p=>p.endIndex===bars.length-1),directions=[...new Set(patterns.filter(p=>!p.evidence?.requiredPriorState).map(p=>p.direction).filter(d=>['LONG','SHORT'].includes(d)))];
    const directional=patterns.filter(p=>directions.includes(p.direction));
    previous={status:directions.length===1?'ADVISORY':directions.length>1?'AMBIGUOUS':'WAITING',direction:directions.length===1?directions[0]:null,
      candidateId:context+':'+result.active.observedId+':'+patterns.map(p=>p.id).sort().join(','),patterns:patterns.map(p=>({id:p.id,direction:p.evidence?.requiredPriorState?'CONTEXTUAL':p.direction,evidence:structuredClone(p.evidence??{}),final:false,contextRequired:!!p.evidence?.requiredPriorState})),
      reasonCodes:['VISUAL_ONLY','BAR_TIMES_UNVERIFIED','BAR_CLOSE_UNVERIFIED','CHART_TYPE_UNVERIFIED','PRICE_SCALE_UNVERIFIED',...(contiguous.length<3?['LIMITED_ADJACENT_BARS']:[])],
      explanation:directional.length?'SHAPE_WITHOUT_VERIFIED_CONTEXT':'NO_DIRECTIONAL_SHAPE',contiguousBars:contiguous.length,pitch,observedId:result.active.observedId,capturedAt,
      final:false,eligibleForConfirmation:false,orderEligible:false,unit:'pixels'};
    return previous;
  }
  return {inspect,reset};
}

export const GUIDE_PATTERN_LABELS=Object.freeze({
  DOJI:'דוג׳י',DRAGONFLY_DOJI:'דוג׳י שפירית',GRAVESTONE_DOJI:'דוג׳י מצבה',HAMMER_SHAPE:'צורת פטיש',SHOOTING_STAR_SHAPE:'צורת כוכב נופל',HANGING_MAN_SHAPE:'צורת Hanging Man',INVERTED_HAMMER_SHAPE:'צורת Inverted Hammer',
  BULLISH_PIN_SHAPE:'Pin Bar שורי',BEARISH_PIN_SHAPE:'Pin Bar דובי',BULLISH_ENGULFING:'בליעה שורית',BEARISH_ENGULFING:'בליעה דובית',
  BULLISH_HARAMI:'Harami שורי',BEARISH_HARAMI:'Harami דובי',HARAMI_CROSS:'Harami Cross',TWEEZER_BOTTOM:'פינצטה תחתונה',TWEEZER_TOP:'פינצטה עליונה',
  INSIDE_BAR:'נר פנימי',OUTSIDE_BAR:'נר חיצוני',MORNING_STAR:'כוכב בוקר',EVENING_STAR:'כוכב ערב',INSIDE_BREAKOUT:'פריצת נר אם',INSIDE_FALSE_BREAK:'חריגה וחזרה לנר האם',
});

export function createGuideSignalDisplay({document}={}){
  const get=id=>document.getElementById(id);let lastText='';
  function clear(text='ממתין לתמונות נרות.'){
    lastText='';get('guide-signal-state').textContent=text;get('guide-signal-state').dataset.state='WAITING';
    get('guide-signal-patterns').textContent='—';get('guide-signal-detail').textContent='איתות מאושר דורש נרות OHLC סגורים, הקשר שוק ואישור לפי כללי המדריך.';
  }
  function render(result){
    const patterns=(result.patterns??[]).map(p=>GUIDE_PATTERN_LABELS[p.id]??p.id),signature=[result.status,result.direction,patterns.join(','),result.contiguousBars].join('|');
    if(signature===lastText)return;lastText=signature;
    const state=get('guide-signal-state');state.dataset.state=result.status;
    state.textContent=result.status==='ADVISORY'?'מועמד חזותי '+(result.direction==='LONG'?'ללונג':'לשורט'):result.status==='AMBIGUOUS'?'צורות עם כיוונים סותרים — ממתין':result.status==='UNAVAILABLE'?'אין כרגע בסיס חזותי ברור':'ממתין לתבנית כיוונית';
    get('guide-signal-patterns').textContent=patterns.length?[...new Set(patterns)].join(' · '):'לא זוהתה תבנית כיוונית בנר הנראה.';
    get('guide-signal-detail').textContent=`נרות סמוכים שנבדקו: ${result.contiguousBars??0}. זהו תיאור צורני מהתמונה; סגירת הנר, מחיריו והקשר השוק טרם אומתו. התנאים במדריך נבדקים בנפרד מעצם הצורה.`;
  }
  return {clear,render};
}
