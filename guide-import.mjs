// Offline research input parsing. Declared close flags and OHLC prices are
// preserved; the parser never infers a current market bar or fetches a feed.
export class GuideImportError extends Error {
  constructor(code,message,row=null){super(message);this.name='GuideImportError';this.code=code;this.row=row;}
}
const fail=(code,message,row)=>{throw new GuideImportError(code,message,row);};
const finite=Number.isFinite;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function numberCell(value,label,row){
  const text=String(value).trim();
  if(!text||!numeric.test(text)||!finite(Number(text)))fail('INVALID_NUMBER',`${label}: נדרש מספר מפורש ללא מפריד אלפים.`,row);
  return Number(text);
}
export function parseGuideTime(value,{csv=false,row=null}={}){
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value)||value<0)fail('INVALID_TIME','חותמת הזמן חייבת להיות מספר שלם של אלפיות שנייה.',row);
    return value;
  }
  if(typeof value!=='string'||!value.trim())fail('INVALID_TIME','חסרה חותמת זמן.',row);
  const text=value.trim();
  if(/^\d+$/.test(text)){
    if(csv&&text.length<12)fail('AMBIGUOUS_TIME','ב־CSV נדרשת חותמת Epoch באלפיות שנייה (12 ספרות לפחות), או ISO עם Z/היסט זמן.',row);
    return parseGuideTime(Number(text),{row});
  }
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i.exec(text);
  if(!match)fail('AMBIGUOUS_TIME','תאריך טקסטואלי חייב להיות ISO עם Z או היסט מפורש, למשל 2026-11-13T10:00:00Z.',row);
  const [,ys,ms,ds,hs,mins,ss='0',,offset]=match,y=Number(ys),month=Number(ms),day=Number(ds),hour=Number(hs),minute=Number(mins),second=Number(ss);
  const check=new Date(Date.UTC(y,month-1,day));
  if(y<1970||month<1||month>12||day<1||check.getUTCFullYear()!==y||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||hour>23||minute>59||second>59)fail('INVALID_TIME','התאריך או השעה אינם תקינים.',row);
  if(offset.toUpperCase()!=='Z'){
    const hours=Number(offset.slice(1,3)),minutes=Number(offset.slice(4,6));
    if(hours>14||minutes>59||hours===14&&minutes!==0)fail('INVALID_TIME','היסט הזמן אינו תקין.',row);
  }
  const time=Date.parse(text);
  if(!Number.isSafeInteger(time)||time<0)fail('INVALID_TIME','חותמת הזמן אינה תקינה.',row);
  return time;
}

function metadataFor(value){
  if(!plain(value))fail('METADATA_REQUIRED','נדרשים פרטי נכס, טיימפריים ומקור הנתונים.');
  const metadata=structuredClone(value);
  if(metadata.source!=='ohlc')fail('OHLC_SOURCE_REQUIRED','מקור הנתונים המוצהר חייב להיות ohlc.');
  for(const key of ['instrument','timeframe','timezone','session','chartType'])if(typeof metadata[key]!=='string'||!metadata[key].trim())fail('METADATA_REQUIRED',`חסר פרט נתונים: ${key}.`);
  if(!Number.isSafeInteger(metadata.timeframeMs)||metadata.timeframeMs<=0||!finite(metadata.tickSize)||metadata.tickSize<=0)fail('INVALID_METADATA','נדרשים משך נר חיובי באלפיות שנייה וגודל טיק חיובי.');
  try{new Intl.DateTimeFormat('en',{timeZone:metadata.timezone});}catch{fail('INVALID_TIMEZONE','אזור הזמן אינו תקין.');}
  return metadata;
}
function validateBars(input,metadata,maxBars){
  if(!Array.isArray(input)||!input.length||input.length>maxBars)fail('BAR_COUNT_LIMIT',`נדרשים בין 1 ל־${maxBars} נרות. אין חיתוך אוטומטי של הקובץ.`);
  const bars=[],gaps=[];
  for(let i=0;i<input.length;i++){
    const source=input[i],row=i+1;
    if(!plain(source))fail('INVALID_BAR','כל נר חייב להיות אובייקט נתונים.',row);
    if(!['open','high','low','close'].every(k=>finite(source[k])))fail('INVALID_OHLC','OHLC חייבים להיות מספרים סופיים מפורשים.',row);
    if(source.high<Math.max(source.open,source.close)||source.low>Math.min(source.open,source.close)||source.high<source.low)fail('INVALID_OHLC','הגבוה/נמוך אינם מכילים את הפתיחה והסגירה.',row);
    if(typeof source.closed!=='boolean')fail('EXPLICIT_CLOSE_REQUIRED','לכל נר נדרש closed:true או closed:false מפורש.',row);
    if(!source.closed&&i!==input.length-1)fail('OPEN_INTERIOR_BAR','נר פתוח מותר רק בסוף הסדרה.',row);
    const time=parseGuideTime(source.time,{row}),closeTime=parseGuideTime(source.closeTime,{row}),knownAt=source.knownAt===undefined?closeTime:parseGuideTime(source.knownAt,{row});
    if(closeTime-time!==metadata.timeframeMs||knownAt<closeTime)fail('INVALID_BAR_TIMES','משך הנר או זמן זמינות הנתונים אינם תקינים.',row);
    const previous=bars.at(-1);
    if(previous&&(time<previous.closeTime||knownAt<previous.knownAt))fail('INVALID_TIME_ORDER','הנרות חייבים להיות ייחודיים ומסודרים, ללא חפיפת זמנים.',row);
    if(previous&&time>previous.closeTime)gaps.push({from:previous.closeTime,to:time,declared:Array.isArray(metadata.sessionGaps)&&metadata.sessionGaps.some(g=>g?.from===previous.closeTime&&g?.to===time&&g?.kind==='market_closed')});
    if(source.volume!==undefined&&(!finite(source.volume)||source.volume<0))fail('INVALID_VOLUME','נפח חייב להיות מספר לא שלילי כאשר הוא מסופק.',row);
    bars.push({...structuredClone(source),time,closeTime,knownAt});
  }
  return {bars,gaps};
}

export function parseGuideCsv(text,{delimiter=','}={}){
  if(![',',';','\t'].includes(delimiter))fail('INVALID_CSV_DELIMITER','מפריד CSV לא נתמך.');
  const rows=[];let row=[],cell='',quoted=false,afterQuote=false,started=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=char;continue;}
    if(char==='"'){
      if(started||afterQuote)fail('INVALID_CSV_QUOTE','גרשיים חייבים להקיף תא שלם.',rows.length+1);
      quoted=true;started=true;continue;
    }
    if(char===delimiter){row.push(cell);cell='';started=false;afterQuote=false;continue;}
    if(char==='\r'||char==='\n'){
      if(char==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);rows.push(row);row=[];cell='';started=false;afterQuote=false;continue;
    }
    if(afterQuote){if(char===' '||char==='\t')continue;fail('INVALID_CSV_QUOTE','תווים אחרי סגירת גרשיים אינם תקינים.',rows.length+1);}
    cell+=char;started=true;
  }
  if(quoted)fail('UNTERMINATED_CSV_QUOTE','תא CSV מכיל גרשיים שלא נסגרו.',rows.length+1);
  if(cell||row.length||started||afterQuote){row.push(cell);rows.push(row);}
  while(rows.length&&rows.at(-1).every(cell=>!cell.trim()))rows.pop();
  return rows;
}

export function parseGuideImport(text,{format='auto',metadata,closedBarsConfirmed=false,maxBars=600,delimiter=','}={}){
  if(typeof text!=='string'||text.length>2000000||!text.trim())fail('INPUT_SIZE','נדרש קובץ טקסט שאינו ריק, עד 2 מיליון תווים.');
  if(!Number.isSafeInteger(maxBars)||maxBars<1||maxBars>600||!['auto','json','csv'].includes(format))fail('INVALID_IMPORT_CONFIGURATION','הגדרות הייבוא אינן תקינות.');
  text=text.replace(/^\uFEFF/,'').trim();
  const selected=format==='auto'?text.startsWith('{')||text.startsWith('[')?'json':'csv':format;
  let document,warnings=[];
  if(selected==='json'){
    try{document=JSON.parse(text);}catch{fail('INVALID_JSON','JSON אינו תקין.');}
    if(!plain(document))fail('CANONICAL_DOCUMENT_REQUIRED','נדרש מסמך JSON הכולל metadata ו־bars; מערך נרות לבדו אינו מספיק.');
    document=structuredClone(document);document.metadata=metadataFor(document.metadata);
  }else{
    const meta=metadataFor(metadata),rows=parseGuideCsv(text,{delimiter});
    if(rows.length<2)fail('CSV_DATA_REQUIRED','נדרשת שורת כותרות ולפחות נר אחד.');
    const aliases={time:'time',timestamp:'time',open_time:'time',bar_open_time:'time',open:'open',o:'open',high:'high',h:'high',low:'low',l:'low',close:'close',c:'close',volume:'volume',v:'volume',closed:'closed',close_time:'closeTime',closetime:'closeTime',known_at:'knownAt',knownat:'knownAt',available_at:'knownAt'};
    const headers=rows[0].map(cell=>aliases[cell.trim().toLowerCase()]??cell.trim());
    if(headers.some((key,i)=>!key||headers.indexOf(key)!==i))fail('INVALID_CSV_HEADERS','כותרות CSV ריקות או כפולות אינן נתמכות.');
    for(const key of ['time','open','high','low','close'])if(!headers.includes(key))fail('CSV_COLUMN_REQUIRED',`חסרה עמודה: ${key}.`);
    if(!headers.includes('closed')&&closedBarsConfirmed!==true)fail('CLOSE_CONFIRMATION_REQUIRED','כאשר אין עמודת closed נדרש אישור מפורש שכל נרות ה־CSV סגורים, כולל האחרון.');
    const bars=rows.slice(1).map((cells,index)=>{
      const row=index+2;
      if(cells.length!==headers.length||cells.every(cell=>!cell.trim()))fail('CSV_ROW_SHAPE','שורת CSV ריקה או בעלת מספר תאים שונה מהכותרות.',row);
      const values=Object.fromEntries(headers.map((key,i)=>[key,cells[i]])),time=parseGuideTime(values.time,{csv:true,row}),bar={time};
      for(const key of ['open','high','low','close'])bar[key]=numberCell(values[key],key,row);
      if(values.volume!==undefined&&values.volume.trim())bar.volume=numberCell(values.volume,'volume',row);
      if(values.closed!==undefined){const close=values.closed.trim().toLowerCase();if(!['true','false'].includes(close))fail('EXPLICIT_CLOSE_REQUIRED','עמודת closed מקבלת רק true או false מפורשים.',row);bar.closed=close==='true';}
      else bar.closed=true;
      bar.closeTime=values.closeTime===undefined?time+meta.timeframeMs:parseGuideTime(values.closeTime,{csv:true,row});
      if(values.knownAt!==undefined)bar.knownAt=parseGuideTime(values.knownAt,{csv:true,row});
      return bar;
    });
    if(!headers.includes('closeTime'))warnings.push('CLOSE_TIME_DERIVED_FROM_DECLARED_TIMEFRAME');
    if(!headers.includes('knownAt'))warnings.push('AVAILABILITY_ASSUMED_AT_BAR_CLOSE');
    if(!headers.includes('closed'))warnings.push('CSV_CLOSE_FLAGS_FROM_EXPLICIT_USER_CONFIRMATION');
    document={metadata:meta,bars};
  }
  const normalized=validateBars(document.bars,document.metadata,maxBars);
  if(document.bars.some(bar=>bar.knownAt===undefined))warnings.push('AVAILABILITY_ASSUMED_AT_BAR_CLOSE');
  if(normalized.gaps.some(g=>!g.declared))warnings.push('UNDECLARED_DATA_GAP');
  return {...document,bars:normalized.bars,importInfo:{format:selected,bars:normalized.bars.length,closedBars:normalized.bars.filter(b=>b.closed).length,
    warnings:[...new Set(warnings)],gaps:normalized.gaps}};
}
