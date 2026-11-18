import {FOLLOW_UP_BARS,PATTERN_STUDY_VERSION,STUDY_PATTERNS} from './research-pattern-study.mjs';
import {QUALITY_VERSION} from './research-pattern-quality.mjs';
import {CHART_STRUCTURE_VERSION} from './research-chart-structures.mjs';
import {STUDY_INDICATORS_VERSION} from './research-study-indicators.mjs';

const storageKey='arrow.pattern-study.3000.v1';
const dayFormat=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric'});
const timeFormat=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'});
const stamp=time=>`${dayFormat.format(time)} ${timeFormat.format(time)}`;
const minute=60_000;
const decimals=new Intl.NumberFormat('he-IL',{maximumFractionDigits:2});
const price=value=>decimals.format(value);
const signed=value=>value>0?`+${price(value)}`:price(value);
const checkLabels={
  allBullish:'שלושת הנרות עולים',higherHighs:'השיאים עולים',higherCloses:'הסגירות עולות',
  shrinkingBodies:'הגופים מתקצרים',growingUpperWicks:'הפתילים העליונים מתארכים',
  finalWickAtLeastBody:'הפתיל העליון האחרון לפחות באורך הגוף',longBody:'גוף ארוך ביחס לנרות הקודמים',
  bear:'נר יורד',openAtHigh:'פתיחה בטווח טיק מהשיא',lowClose:'סגירה ברבע התחתון',
};
const missing={
  SESSION_BOUNDARY:'המדידה חוצה גבול מסחר.',
  OUTSIDE_WINDOW:'אין די נרות בהמשך הייצוא.',
  UNAVAILABLE:'נתוני המשך מתאימים חסרים.',
};
const safeTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8.64e15;
const qualityDimensions={session:'סשן',zone:'אזור מחיר',direction5:'כיוון 5 דקות',direction15:'כיוון 15 דקות',market:'מבנה בדקה',
  rsi:'RSI',stochastic:'Stochastic',bollinger:'רוחב Bollinger יחסי',macd:'MACD מול קו האות',rvol:'נפח יחסי',vwap:'מחיר מול אומדן VWAP'};
const qualityLabels={NEW_YORK_OPEN:'פתיחת ניו יורק',NEW_YORK_DAY:'המשך היום בניו יורק',OVERNIGHT:'לילה ומחוץ לשעות היום',
  SUPPORT:'נגיעה בתמיכה',RESISTANCE:'נגיעה בהתנגדות',BOTH_ZONES:'תמיכה והתנגדות',AWAY:'מחוץ לאזור',
  NO_ACTIVE_ZONE:'ללא אזור פעיל',UNKNOWN:'מידע חסר',TREND_UP:'עולה',TREND_DOWN:'יורד',RANGE:'דשדוש',TRANSITION:'מעבר'};
const percent=new Intl.NumberFormat('he-IL',{style:'percent',maximumFractionDigits:0});
const structureLabels={DOUBLE_TOP:'Double Top',DOUBLE_BOTTOM:'Double Bottom',RECTANGLE:'פריצת טווח',BREAK_RETEST:'פריצה וריטסט'};
const metricValues={macd:{LOW:'מתחת לקו האות',MID:'שווה לקו האות',HIGH:'מעל קו האות'},
  vwap:{LOW:'מתחת ל־VWAP',MID:'ב־VWAP',HIGH:'מעל VWAP'}};

function validReport(report){
  const legacy=report?.version==='pattern-study-3000-v1',candles=report?.candles;
  if(!legacy&&(!Array.isArray(candles)||candles.length!==3000||
    !candles.every((bar,i)=>Array.isArray(bar)&&bar.length===5&&safeTime(bar[0])&&
      bar.slice(1).every(Number.isFinite)&&(!i||bar[0]>=candles[i-1][0]+minute))))return false;
  return (legacy||report?.version===PATTERN_STUDY_VERSION)&&report.researchOnly===true&&report.barCount===3000&&
    [report.from,report.to].every(safeTime)&&report.to>report.from&&
    Array.isArray(report.groups)&&report.groups.length===STUDY_PATTERNS.length&&
    STUDY_PATTERNS.every(({id},index)=>{
      const group=report.groups[index];
      return group?.id===id&&Array.isArray(group.times)&&group.times.length<=3000&&
        group.times.every((time,i)=>safeTime(time)&&time>report.from&&time<=report.to&&(!i||time>group.times[i-1]))&&
        (legacy||Array.isArray(group.detections)&&group.detections.length===group.times.length&&
          group.detections.every((hit,i)=>validDetection(hit,group.times[i],candles)));
    });
}

function validDetection(hit,time,candles){
  return !!hit&&[hit.chartStart,hit.startIndex,hit.endIndex].every(i=>Number.isInteger(i)&&i>=0&&i<candles.length)&&
    hit.chartStart<=hit.startIndex&&hit.startIndex<=hit.endIndex&&candles[hit.endIndex][0]+minute===time&&
    safeTime(hit.knownAt)&&hit.knownAt>=time&&['LONG','SHORT'].includes(hit.direction)&&
    Array.isArray(hit.checks)&&hit.checks.every(check=>Object.hasOwn(checkLabels,check))&&
    Array.isArray(hit.horizons)&&hit.horizons.length===FOLLOW_UP_BARS.length&&
    hit.horizons.every((item,i)=>item&&(Object.hasOwn(missing,item.status)||item.status==='AVAILABLE'&&
      hit.endIndex+FOLLOW_UP_BARS[i]<candles.length&&[item.close,item.change,item.mfe,item.mae].every(Number.isFinite)));
}

function drawCase(canvas,bars,detection,candlesAfter){
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const {width,height}=canvas,top=14,bottom=height-25,right=width-69;
  const lastShape=bars.length-candlesAfter-1,shapeLength=detection.endIndex-detection.startIndex+1;
  const lastTime=bars[lastShape][0]+minute,reference=bars[lastShape][4];
  const low=Math.min(...bars.map(bar=>bar[3])),high=Math.max(...bars.map(bar=>bar[2])),span=high-low||.25;
  const y=value=>top+(high-value)/span*(bottom-top);
  const slot=(right-12)/bars.length,x=i=>12+(i+.5)*slot;
  ctx.clearRect(0,0,width,height);
  ctx.fillStyle='#101923';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#553f27';ctx.fillRect(x(lastShape-shapeLength+1)-slot/2,top,shapeLength*slot,bottom-top);
  ctx.font='15px system-ui';ctx.textAlign='left';ctx.textBaseline='middle';
  const grid=(value,color,label)=>{
    ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(12,y(value));ctx.lineTo(right,y(value));ctx.stroke();
    if(label){ctx.fillStyle=color;ctx.fillText(price(value),right+5,y(value));}
  };
  grid(high,'#aabdd0',true);grid(low,'#aabdd0',true);
  grid(reference,'#fbbf80',y(reference)-top>17&&bottom-y(reference)>17);
  for(const [i,[,open,barHigh,barLow,close]] of bars.entries()){
    ctx.strokeStyle=ctx.fillStyle=close>=open?'#80ddba':'#fb9497';
    ctx.beginPath();ctx.moveTo(x(i),y(barHigh));ctx.lineTo(x(i),y(barLow));ctx.stroke();
    const body=Math.min(15,slot*.6);
    ctx.fillRect(x(i)-body/2,y(Math.max(open,close)),body,Math.max(2,Math.abs(y(open)-y(close))));
  }
  ctx.fillStyle='#fbbf80';ctx.textAlign='center';
  ctx.fillText(timeFormat.format(lastTime),Math.min(right-23,Math.max(32,x(lastShape))),height-11);
}

const picker=document.getElementById('pattern-study-file');
if(picker){
  const status=document.getElementById('pattern-study-status');
  const output=document.getElementById('pattern-study-result');
  const storage=globalThis.chrome?.storage?.local;
  const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
  const button=(label,fn)=>{const element=node('button',label);element.type='button';element.addEventListener('click',fn);return element;};
  function showQuality(quality){
    const panel=node('details','');panel.className='pattern-study-quality';
    panel.append(node('summary','פילוח איכות הזיהויים'));
    if(quality?.version!==QUALITY_VERSION||!Array.isArray(quality.rows)){
      panel.append(node('p','טען את ייצוא הנרות שוב כדי לחשב את הפילוח.'));
      return panel;
    }
    const controls=node('div',''),results=node('div','');
    controls.className='pattern-study-actions';
    function select(label,items){
      const field=node('label',label),input=node('select','');
      for(const [value,title] of items){const option=node('option',title);option.value=value;input.append(option);}
      field.append(input);controls.append(field);
      return input;
    }
    const pattern=select('תבנית',STUDY_PATTERNS.map(({id,label})=>[id,label]));
    const available=new Set(quality.rows.map(row=>row.dimension));
    const dimension=select('פילוח',Object.entries(qualityDimensions).filter(([key])=>available.has(key)||['session','zone','direction5','direction15'].includes(key)));
    const horizon=select('חלון',FOLLOW_UP_BARS.map(n=>[n,`${n} נרות`]));
    function renderQuality(){
      const rows=quality.rows.filter(row=>row.patternId===pattern.value&&row.dimension===dimension.value&&row.horizon===Number(horizon.value));
      const cards=rows.map(row=>{
        const card=node('article','');card.className='pattern-study-quality-row';
        card.append(node('strong',metricValues[row.dimension]?.[row.value]??qualityLabels[row.value]??({LOW:'נמוך',MID:'אמצע',HIGH:'גבוה'}[row.value]??'מידע חסר')),
          node('p',`${row.favorable} בכיוון מתוך ${row.eligible} עם מעקב · ${row.flat} ללא שינוי · ${row.missing} חסרי מדידה · ${row.days} ימי ניו יורק`));
        card.append(node('p',row.matched>0
          ?`השוואה מותאמת · ${row.matchedFavorable} מתוך ${row.matched} זיהויים (${percent.format(row.matchedFavorable/row.matched)}) · קו ייחוס ${percent.format(row.baselineRate)}`
          :'אין נרות ביקורת תואמים בקבוצה.'));
        return card;
      });
      results.replaceChildren(...(cards.length?cards:[node('p','אין זיהויים בפילוח הזה.')]));
    }
    for(const control of [pattern,dimension,horizon])control.addEventListener('change',renderQuality);
    panel.append(node('p','פתיחת ניו יורק 09:30–10:29 · המשך היום 10:30–15:59 · יתר השעות מחוץ לשעות היום. הזמנים בפילוח הם לפי ניו יורק.'),
      node('p','קו הייחוס משתמש בנרות ללא אחת משתי התבניות באותה חצי שעה ובקבוצת הפילוח שנבחרה. שינוי הסגירה נמדד מול סגירת הזיהוי.'),
      controls,results);
    if(!quality.nativeFrames?.['5']||!quality.nativeFrames?.['15'])panel.append(node('p','חסר רצף נרות 5 או 15 דקות מאומת בייצוא. הפריטים החסרים מוצגים בנפרד.'));
    renderQuality();
    return panel;
  }
  function showStructures(study){
    const panel=node('details','');panel.className='pattern-study-quality';
    panel.append(node('summary','תבניות מבנה ב־3,000 נרות'));
    if(study?.version!==CHART_STRUCTURE_VERSION||study.status!=='OK'){
      panel.append(node('p','טען שוב ייצוא תקין כדי לחשב את תבניות המבנה.'));
      return panel;
    }
    const counts=Object.entries(structureLabels).map(([id,label])=>{
      const count=study.counts[id]??{confirmed:0,retested:0,candidates:0};
      const observed=count.followUp?.[15];
      const follow=observed?` · אחרי 15 נרות ${observed.favorable}/${observed.eligible} בכיוון · ${observed.missing} ללא מעקב מלא`:'';
      return node('p',`${label} · ${count.candidates} מועמדים · ${count.confirmed} אושרו בסגירה · ${count.retested} נבדקו בריטסט${follow}`);
    });
    panel.append(...counts);
    const confirmed=study.records.filter(row=>row.status==='CONFIRMED').slice(0,8);
    for(const row of confirmed){
      const caseView=node('details','');caseView.append(node('summary',`${stamp(row.confirmedClose)} · ${structureLabels[row.type]} · ${row.direction==='SHORT'?'שורט':'לונג'}`),
        node('p',`רמת פריצה ${price(row.breakoutLevel)} · מועמד מסגירת ${stamp(row.candidateClose)}`),
        node('p',row.anchors.map(anchor=>`${stamp(anchor.time)} · ${price(anchor.price)}`).join(' | ')));
      if(row.retestClose)caseView.append(node('p',`ריטסט אושר בסגירת ${stamp(row.retestClose)}`));
      panel.append(caseView);
    }
    return panel;
  }
  function showIndicators(data){
    const panel=node('details','');panel.className='pattern-study-quality';
    panel.append(node('summary','נפח ומתנדים'));
    if(data?.version!==STUDY_INDICATORS_VERSION||!Array.isArray(data.coverage)){
      panel.append(node('p','טען שוב ייצוא תקין כדי לחשב כיסוי נפח ומתנדים.'));
      return panel;
    }
    const valid=data.coverage.reduce((sum,row)=>sum+row.known,0),zeros=data.coverage.reduce((sum,row)=>sum+row.zero,0);
    const {completeSessions,minSessions,usableComparisons,vwapBars,conflicts}=data.volumeReference;
    const format=value=>Number.isFinite(value)?price(value):'חסר';
    panel.append(node('p',`כיסוי נפח · ${valid} מתוך 3,000 · ${zeros} נרות עם נפח אפס מדווח`),
      node('p',`נפח יחסי באותה דקה בסשנים קודמים · ${usableComparisons} מדידות · ${completeSessions} סשנים מלאים זמינים · דרושים לפחות ${minSessions} סשני ייחוס קודמים לכל מדידה`),
      node('p',`אומדן VWAP לפי HLC3 · ${vwapBars} נרות עם רצף נפח מלא מתחילת הסשן`),
      node('p',`RSI(14) ${format(data.latest.rsi)} · רוחב Bollinger יחסי ${format(data.latest.widthRatio)} · MACD ${format(data.latest.macd)} · קו אות ${format(data.latest.macdSignal)}`));
    if(data.auxiliaryExports)panel.append(node('p',`${data.auxiliaryExports} ייצואי ייחוס נוספים · ${conflicts} סשנים הוצאו בשל סתירה בנפח`));
    const coverage=node('details','');coverage.append(node('summary','כיסוי לפי יום וסשן'));
    for(const row of data.coverage)coverage.append(node('p',`${row.day} · ${qualityLabels[row.session]} · ${row.known} מתוך ${row.bars} עם נפח`));
    panel.append(coverage);
    return panel;
  }
  function showDetection(candles,hit,label,time){
    const part=node('section','');part.className='pattern-study-case';
    const selected=candles.slice(hit.startIndex,hit.endIndex+1);
    const anchor=selected.at(-1)[4],high=Math.max(...selected.map(bar=>bar[2])),low=Math.min(...selected.map(bar=>bar[3]));
    part.append(node('h4',`${label} · סגירת ${stamp(time)}`),
      node('p',`גבוה התבנית ${price(high)} · נמוך ${price(low)} · סגירה ${price(anchor)}`),
      node('p',hit.checks.map(check=>checkLabels[check]).join(' · ')));
    if(hit.knownAt!==time)part.append(node('p',`התבנית הייתה זמינה לפי נתוני הייצוא ב־${stamp(hit.knownAt)}.`));
    if(hit.context){
      const {session,zone,direction5,direction15,levels}=hit.context;
      part.append(node('p',`${qualityLabels[session]} · ${qualityLabels[zone]} · 5 דק׳ ${qualityLabels[direction5]} · 15 דק׳ ${qualityLabels[direction15]}`));
      if(Array.isArray(levels)&&levels.length)part.append(node('p',levels.map(level=>`${level.type==='SUPPORT'?'תמיכה':'התנגדות'} ${price(level.lower)}–${price(level.upper)}`).join(' · ')));
    }
    if(Number.isFinite(hit.referenceMedian))part.append(node('p',`חציון גופי הנרות ששימש סף השוואה ${price(hit.referenceMedian)} נק׳.`));
    const anatomy=node('ul','');anatomy.className='pattern-study-anatomy';
    for(const [openTime,open,barHigh,barLow,close] of selected){
      anatomy.append(node('li',`${timeFormat.format(openTime+minute)} · גוף ${price(Math.abs(open-close))} · פתיל עליון ${price(barHigh-Math.max(open,close))} · פתיל תחתון ${price(Math.min(open,close)-barLow)} נק׳`));
    }
    part.append(anatomy);
    const canvas=node('canvas','תרשים נרות הזיהוי');canvas.width=650;canvas.height=244;canvas.setAttribute('role','img');
    const actions=node('div','');actions.className='pattern-study-actions';
    const outcome=node('p','');outcome.setAttribute('aria-live','polite');
    const options=[0,...FOLLOW_UP_BARS];
    function reveal(choice){
      const count=options[choice],data=hit.horizons[choice-1],after=data?.status==='AVAILABLE'?count:0;
      for(const [i,control] of [...actions.children].entries())control.setAttribute('aria-pressed',String(i===choice));
      drawCase(canvas,candles.slice(hit.chartStart,hit.endIndex+after+1),hit,after);
      canvas.setAttribute('aria-label',after?`נרות עד הזיהוי ועוד ${after} נרות לאחריו`:'נרות הידועים עד הזיהוי. התבנית מסומנת ברקע חום.');
      if(!count)outcome.textContent='התבנית מסומנת ברקע חום. בחר חלון כדי לחשוף את נרות ההמשך.';
      else if(!after)outcome.textContent=`אחרי ${count} נרות · ${missing[data.status]}`;
      else outcome.textContent=`אחרי ${count} נרות · סגירה ${price(data.close)} · שינוי מחיר ${signed(data.change)} נק׳. מתחילת חלון ההמשך · ${price(data.mfe)} נק׳ בכיוון התבנית ו־${price(data.mae)} נגד הכיוון ביחס לסגירת הזיהוי.`;
    }
    options.forEach((count,index)=>actions.append(button(count?`חשוף ${count} נרות`:'עד הזיהוי',()=>reveal(index))));
    part.append(canvas,actions,outcome);reveal(0);
    return part;
  }
  function render(report){
    if(!validReport(report))return false;
    const intro=node('p',`NQ · 3,000 נרות דקה סגורים · ${stamp(report.from)} – ${stamp(report.to)} (שעון ישראל)`);
    let selectedButton=null,selectedDetail=null;
    const groups=STUDY_PATTERNS.map(({label},index)=>{
      const {times,detections}=report.groups[index];
      const details=document.createElement('details');
      details.open=true;
      details.append(node('summary',`${label} · ${times.length} זיהויים`));
      if(detections?.length){
        const coverage=FOLLOW_UP_BARS.map((count,i)=>{
          const usable=detections.filter(hit=>hit.horizons[i].status==='AVAILABLE');
          const moved=usable.filter(hit=>hit.direction==='SHORT'?hit.horizons[i].change<0:hit.horizons[i].change>0).length;
          return `${count} נרות: ${moved} בכיוון מתוך ${usable.length} עם נתונים · ${times.length-usable.length} חסרים`;
        });
        details.append(node('p',coverage.join(' | ')));
      }
      const byDay=new Map();
      for(let i=times.length-1;i>=0;i--){
        const time=times[i];
        const day=dayFormat.format(time);
        if(!byDay.has(day))byDay.set(day,[]);
        byDay.get(day).push({time,hit:detections?.[i]});
      }
      for(const [day,hours] of byDay){
        if(!detections){details.append(node('p',`${day} · ${hours.map(({time})=>timeFormat.format(time)).join(', ')}`));continue;}
        const dayBlock=node('div',''),choices=node('div','');
        choices.className='pattern-study-actions';choices.dir='ltr';
        for(const {time,hit} of hours){
          const option=button(timeFormat.format(time),()=>{
            const wasSelected=selectedButton===option;
            selectedDetail?.remove();selectedButton?.setAttribute('aria-expanded','false');
            selectedButton=null;selectedDetail=null;
            if(wasSelected)return;
            selectedButton=option;option.setAttribute('aria-expanded','true');
            selectedDetail=showDetection(report.candles,hit,label,time);
            selectedDetail.id='pattern-study-active-case';
            dayBlock.append(selectedDetail);
            selectedDetail.scrollIntoView({block:'nearest'});
          });
          option.setAttribute('aria-label',`תחקור ${label} · ${stamp(time)}`);
          option.setAttribute('aria-expanded','false');
          choices.append(option);
        }
        dayBlock.append(node('p',day),choices);details.append(dayBlock);
      }
      if(!times.length)details.append(node('p','אין זיהויים בחלון שנבדק.'));
      return details;
    });
    output.replaceChildren(intro,showQuality(report.quality),showStructures(report.chartStructures),showIndicators(report.indicators),...groups);
    status.textContent=report.version===PATTERN_STUDY_VERSION?'לחץ על שעת הסגירה כדי לתחקר את הזיהוי.':'זמני סגירת הנרות מהסריקה השמורה. טען שוב את הייצוא כדי לפתוח תחקור.';
    return true;
  }

  const restored=storage?.get(storageKey);
  const ready=Promise.resolve(restored).then(saved=>render(saved?.[storageKey])).catch(()=>false);
  picker.addEventListener('change',async()=>{
    const files=Array.from(picker.files??[]);
    if(!files.length||picker.disabled)return;
    picker.disabled=true;
    await ready;
    status.textContent='סורק את חלון הנרות…';
    let worker;
    try{
      if(files.length>8||files.some(file=>!file.size||file.size>160*1024*1024)||files.reduce((sum,file)=>sum+file.size,0)>480*1024*1024){
        throw Error('אפשר לטעון עד שמונה ייצואים, עד 160MB לקובץ ועד 480MB בסך הכול.');
      }
      worker=new Worker(new URL('./research-upgrades-worker.mjs',import.meta.url),{type:'module'});
      const result=await new Promise((resolve,reject)=>{
        worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
        worker.onerror=()=>reject(Error('עובד הסריקה לא נטען.'));
        worker.postMessage({kind:'pattern-study',id:1,files});
      });
      if(!render(result))throw Error('התוצאה אינה תקינה.');
      try{await storage?.set({[storageKey]:result});}catch{status.textContent+=' שמירת התוצאה במחשב לא הצליחה.';}
    }catch(error){status.textContent=`הסריקה לא הושלמה. ${error.message}`;}
    finally{worker?.terminate();picker.value='';picker.disabled=false;}
  });
}
