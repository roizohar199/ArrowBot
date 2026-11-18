const path=new URL('./verification/0.31.6/nq-holdout-report.json',import.meta.url);
const labels={
  ADVANCE_BLOCK:'Advance Block',BEARISH_BELT_HOLD:'Belt Hold דובי',DOUBLE_TOP:'Double Top',DOUBLE_BOTTOM:'Double Bottom',
  RECTANGLE:'פריצת מלבן',BREAK_RETEST:'פריצת רמה קבועה',STOCHASTIC:'Stochastic בקצה 20/80',RSI:'RSI בקצה 30/70',
  BOLLINGER:'רוחב Bollinger מוגדל',MACD:'MACD תואם לכיוון',RVOL:'נפח יחסי 1.5 ומעלה',VWAP:'מחיר בצד הכיוון מול VWAP',
};
const findings={
  POSITIVE:'ראיה לשיפור במדגם הראשי',NEGATIVE:'ראיה לתוצאה חלשה יותר במדגם הראשי',
  INCONCLUSIVE:'רווח הסמך כולל אפס',LIMITED:'מדגם מצומצם',DESCRIPTIVE:'השוואה תיאורית',
};
const date=new Intl.DateTimeFormat('he-IL',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'});
const points=new Intl.NumberFormat('he-IL',{maximumFractionDigits:2,signDisplay:'exceptZero'});
const number=new Intl.NumberFormat('he-IL');
const percent=new Intl.NumberFormat('he-IL',{style:'percent',maximumFractionDigits:1});
const display=value=>Number.isFinite(value)?points.format(value):'חסר';
const signed=(value,unit)=>Number.isFinite(value)?`${display(value)} ${unit}`:'חסר';
const sourceRange=({from,to})=>`${date.format(Date.parse(from))} – ${date.format(Date.parse(to))}`;

function validSource(data){
  return !!data&&/^\d{4}-\d\d-\d\d$/.test(data.from)&&/^\d{4}-\d\d-\d\d$/.test(data.to)&&
    Number.isInteger(data.sessions)&&data.sessions>0&&data.bars===data.sessions*1380&&data.volumeBars===data.bars&&
    Array.isArray(data.reports)&&[5,15].every(n=>data.reports.some(r=>r.horizon===n&&
      Array.isArray(r.patterns)&&Array.isArray(r.modifiers)&&[...r.patterns,...r.modifiers].every(row=>Object.hasOwn(labels,row.id))));
}

const panel=document.getElementById('nq-holdout');
if(panel){
  const doc=panel.ownerDocument,output=doc.getElementById('nq-holdout-result');
  const node=(tag,text)=>{const n=doc.createElement(tag);n.textContent=text;return n;};
  function source(data){
    const row=node('p',`${sourceRange(data)} · ${number.format(data.sessions)} סשנים · ${number.format(data.volumeBars)} נרות עם נפח מלא · `);
    const link=node('a',data.source);link.href=data.url;link.target='_blank';link.rel='noopener noreferrer';
    row.append(link);
    return row;
  }
  function render(data){
    const stats=node('p',''),selector=node('label','חלון לאחר הזיהוי'),select=node('select',''),rows=node('div','');
    for(const n of [15,5]){const option=node('option',`${n} נרות דקה`);option.value=n;select.append(option);}
    selector.append(select);selector.className='nq-holdout-window';
    const sources=node('details','');
    sources.append(node('summary','מקורות וכלל ההשוואה'),
      node('strong','מדגם ראשי'),source(data.primary),node('strong','מדגם שחזור'),source(data.replication),
      node('p','קו הייחוס לתבנית משתמש בנרות מאותה חצי שעה, עם אותו כיוון גוף ואותו כיוון שינוי ב־15 הנרות הקודמים. תוספת המדד נבדקה בתוך אותו סוג תבנית, כיוון, יום וחלק סשן.'),
      node('p','המדד הוא שינוי סגירה בנקודות בכיוון התבנית. רווחי הסמך מבוססים על סשנים שלמים ומתוקנים ל־12 השוואות. תוצאות המחיר הן תצפיות היסטוריות.'));
    const protocol=node('a','פרוטוקול הבדיקה');protocol.href='verification/0.31.6/nq-holdout-protocol.md';protocol.target='_blank';protocol.rel='noopener';
    sources.append(protocol);
    output.replaceChildren(
      node('p',`מדגם ראשי · ${number.format(data.primary.bars)} נרות · ${data.primary.sessions} סשנים`),
      node('p',`מדגם שחזור · ${number.format(data.replication.bars)} נרות · ${data.replication.sessions} סשנים · נפח בכל נר בשני המדגמים`),
      stats,selector,rows,sources);

    function show(){
      const horizon=Number(select.value),main=data.primary.reports.find(r=>r.horizon===horizon),repeat=data.replication.reports.find(r=>r.horizon===horizon);
      const measured=[...main.patterns,...main.modifiers],up=measured.filter(r=>r.finding==='POSITIVE').length,down=measured.filter(r=>r.finding==='NEGATIVE').length;
      stats.textContent=horizon===15
        ?`${up} השוואות עם ראיה לשיפור · ${down} עם ראיה לתוצאה חלשה יותר · ${measured.length-up-down} ללא הכרעה או עם מדגם מצומצם.`
        :'השוואה תיאורית אחרי 5 נרות. חלון הבדיקה הראשי הוא 15 נרות.';
      function table(title,entries,checks,modifier=false){
        const section=node('section','');section.append(node('h4',title));
        for(const row of entries){
          const secondary=checks.find(r=>r.id===row.id);
          const card=node('details','');card.className='nq-holdout-row';
          const summary=node('summary',''),label=node('strong',labels[row.id]),effect=node('span',signed(row.meanPoints,'נק׳'));
          effect.dir='ltr';summary.append(label,effect);
          const sizes=modifier?`${row.n} זיהויים עם התנאי · ${row.controls} בהשוואה · ${row.sessions} סשנים · ${row.covered}/${row.total} עם ערך תקין`
            :`${row.n} מתוך ${row.total} זיהויים תואמים · ${row.sessions} סשנים`;
          card.append(summary,node('p',`מדגם ראשי · ${sizes}`),
            node('p',`${findings[row.finding]??''}${row.interval?` · רווח סמך ${display(row.interval[0])} עד ${display(row.interval[1])} נק׳`:''}`),
            node('p',`הפרש בשיעור הסגירות בכיוון · ${signed(Number.isFinite(row.hitDelta)?row.hitDelta*100:null,'נק׳ אחוז')}`));
          if(!modifier&&Number.isFinite(row.hitRate))card.append(node('p',`סגרו בכיוון · ${percent.format(row.hitRate)} מהזיהויים · ${percent.format(row.baselineRate)} בקו הייחוס`));
          if(secondary)card.append(node('p',`מדגם שחזור · ${signed(secondary.meanPoints,'נק׳')} · ${secondary.n} תואמים${modifier?` · ${secondary.controls} בהשוואה`:''} · ${secondary.sessions} סשנים`));
          section.append(card);
        }
        return section;
      }
      rows.replaceChildren(table('תבניות מול קו הייחוס',main.patterns,repeat.patterns),
        table('תוספת של מדד מעל התבנית',main.modifiers,repeat.modifiers,true));
    }
    select.addEventListener('change',show);show();
  }

  let loading=false,loaded=false;
  panel.addEventListener('toggle',async()=>{
    if(!panel.open||loading||loaded)return;
    loading=true;
    try{
      const response=await fetch(path);
      if(!response.ok)throw Error('report unavailable');
      const data=await response.json();
      if(data.kind!=='ARROW_NQ_HOLDOUT_V1'||data.researchOnly!==true||!validSource(data.primary)||!validSource(data.replication))throw Error('report invalid');
      render(data);loaded=true;
    }catch{output.textContent='תוצאות המדגם לא נטענו. סגור ופתח שוב כדי לנסות מחדש.';}
    finally{loading=false;}
  });
}
