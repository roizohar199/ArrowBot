// Read-only attribution against the Paper Trading Trade history export.
const minute=60_000;
const finite=Number.isFinite;
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const timeZone='Asia/Jerusalem';
const wallClock=new Intl.DateTimeFormat('en-GB',{timeZone,timeZoneName:'longOffset'});
const headers=['Symbol','Trade number','Type','Date and time','Order ID','Price','Size (qty)','Net PnL USD','Commission USD'];

function csvRows(input){
  const rows=[];
  let row=[],value='',quoted=false,quoteEnded=false;
  const field=()=>{row.push(value);value='';quoteEnded=false;};
  const line=()=>{field();if(row.some(cell=>cell!==''))rows.push(row);row=[];};
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){
      if(c!=='"')value+=c;
      else if(input[i+1]==='"'){value+='"';i++;}
      else {quoted=false;quoteEnded=true;}
    }else if(c===',')field();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;line();}
    else if(c==='"'&&!value&&!quoteEnded)quoted=true;
    else if(quoteEnded||c==='"')throw Error('מבנה CSV לא תקין.');
    else value+=c;
  }
  if(quoted)throw Error('מבנה CSV לא תקין.');
  line();
  return rows;
}

const numeric=text=>/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)?Number(text):null;
function wallMinute(value){
  const parts=/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{2}):(\d{2})$/.exec(value);
  if(!parts)return null;
  const [,mon,day,year,hour,min]=parts,index=months.indexOf(mon);
  if(index<0||Number(hour)>23||Number(min)>59)return null;
  const time=Date.UTC(+year,index,+day,+hour,+min),date=new Date(time);
  return date.getUTCMonth()===index&&date.getUTCDate()===+day?time:null;
}

export function parsePaperTradeHistory(csv){
  if(typeof csv!=='string'||!csv.length||csv.length>2_000_000)throw Error('נדרש ייצוא Trade History עד 2MB.');
  const [header=[],...lines]=csvRows(csv.replace(/^\uFEFF/,''));
  const columns=headers.map(field=>header.indexOf(field));
  if(columns.includes(-1)||new Set(header).size!==header.length||!lines.length)throw Error('נדרש ייצוא Trade History באנגלית מ־TradingView Paper Trading.');
  const grouped=new Map(),identities=new Set();
  for(const line of lines){
    if(line.length!==header.length)throw Error('רוחב שורת CSV אינו תואם לכותרות.');
    const [symbol,trade,type,timeText,id,px,size,pnl,fee]=columns.map(i=>line[i].trim());
    const match=/^(Entry|Exit) (long|short)$/.exec(type),time=wallMinute(timeText);
    const price=numeric(px),quantity=numeric(size),netPnl=numeric(pnl),commission=numeric(fee);
    if(!match||!symbol||!/^\d{1,12}$/.test(trade)||!/^\d{1,20}$/.test(id)||!finite(time)||
      !finite(price)||price<=0||!Number.isSafeInteger(quantity)||quantity<=0||fee!==''&&(!finite(commission)||commission<0)||
      pnl!==''&&!finite(netPnl))throw Error('שורת עסקה בייצוא חסרה נתוני מילוי תקינים.');
    const key=JSON.stringify([symbol,trade]),identity=JSON.stringify([key,match[1],id]);
    const group=grouped.get(key)??{symbol,trade,entries:[],exits:[]};
    if(identities.has(identity))throw Error('כפילויות מזהי מילוי בייצוא.');
    identities.add(identity);
    group[match[1]==='Entry'?'entries':'exits'].push({id,time,timeText,price,quantity,direction:match[2].toUpperCase(),netPnl,commission});
    grouped.set(key,group);
  }
  return [...grouped.values()];
}

const total=rows=>rows.reduce((sum,row)=>sum+row.quantity,0);
const sumKnown=(rows,key)=>rows.every(row=>finite(row[key]))?rows.reduce((sum,row)=>sum+row[key],0):null;
const epochMinute=ms=>Math.floor(ms/minute)*minute;

function offsetAt(time){
  const offset=wallClock.formatToParts(time).find(part=>part.type==='timeZoneName')?.value??'';
  const m=/^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  return m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3])):null;
}

export function observedPaperPricePath(record,actual){
  if(actual?.status!=='CLOSED'||!finite(actual.exitMinute)||actual.exits.length===0)return null;
  const firstFull=Math.ceil((record.entryTime+(record.entryTimestampPrecisionMs??1000))/minute)*minute;
  const n=(actual.exitMinute-firstFull)/minute;
  if(!Number.isInteger(n)||n<1||n>480)return null;
  const bars=(record.observedBars??[]).filter(bar=>bar.time>=firstFull&&bar.closeTime<=actual.exitMinute);
  if(bars.length!==n||bars.some((bar,i)=>bar.time!==firstFull+i*minute||bar.closeTime!==bar.time+minute||
    ![bar.high,bar.low].every(finite)))return null;
  const long=record.direction==='LONG';
  return {bars:n,mfePoints:Math.max(0,...bars.map(bar=>long?bar.high-record.entry:record.entry-bar.low)),
    maePoints:Math.max(0,...bars.map(bar=>long?record.entry-bar.low:bar.high-record.entry))};
}

function matchRecord(record,groups,filename){
  const entryId=record.entryOrderId??record.id?.split(':').at(-1);
  if(typeof entryId!=='string'||!/^\d{1,20}$/.test(entryId)||!finite(record.entryTime))return null;
  const selected=groups.filter(group=>group.entries.some(row=>row.id===entryId));
  if(!selected.length)return null;
  const quantities=[],exits=[];
  const entryOffset=offsetAt(record.entryTime),minuteFloor=epochMinute(record.entryTime);
  if(entryOffset===null)return null;
  for(const {entries,exits:closes,symbol,trade} of selected){
    const entry=entries[0];
    if(entries.length!==1||symbol!==record.contract||entry.direction!==record.direction||
      entry.price!==record.entry||entry.time!==minuteFloor+entryOffset*minute||
      finite(record.entryUtcOffsetMinutes)&&record.entryUtcOffsetMinutes!==entryOffset||
      total(closes)>entry.quantity||closes.some(row=>row.direction!==record.direction||row.time<entry.time))return null;
    quantities.push(entry);
    for(const row of closes)exits.push({...row,trade});
  }
  const quantity=total(exits);
  if(!quantity||total(quantities)>record.quantity||quantity>record.quantity)return null;
  exits.sort((a,b)=>a.time-b.time||a.trade.localeCompare(b.trade)||a.id.localeCompare(b.id));
  const last=exits.at(-1),candidate=last.time-entryOffset*minute;
  const exitMinute=offsetAt(candidate)===entryOffset&&candidate>=minuteFloor?candidate:null;
  const grossPnl=exits.reduce((sum,row)=>sum+(row.price-record.entry)*(record.direction==='LONG'?1:-1)*record.pointValue*row.quantity,0);
  return {kind:'IMPORTED_PAPER_TRADE_HISTORY',status:quantity===record.quantity?'CLOSED':'PARTIAL',
    matchBasis:'EXACT_NATIVE_ENTRY_ORDER_ID_AND_TRADE_NUMBER',entryId,quantity,grossPnl,
    exitMinute,netPnl:sumKnown(exits,'netPnl'),commission:sumKnown(exits,'commission'),
    averageExit:exits.reduce((sum,row)=>sum+row.price*row.quantity,0)/quantity,
    exits,filename:String(filename??'').slice(0,180)};
}

export function applyPaperTradeHistory(records,groups,filename){
  let changed=0,matched=0;
  const owners=new Map();
  for(const record of records){
    const id=record.entryOrderId??record.id?.split(':').at(-1);
    owners.set(id,(owners.get(id)??0)+1);
  }
  const output=records.map(record=>{
    const id=record.entryOrderId??record.id?.split(':').at(-1);
    if(owners.get(id)!==1)return record;
    const actual=matchRecord(record,groups,filename);
    if(!actual)return record;
    matched++;
    const before=record.actual;
    if(before&&before.exits.some(row=>!actual.exits.some(candidate=>candidate.trade===row.trade&&candidate.id===row.id&&
      candidate.quantity===row.quantity&&candidate.price===row.price&&candidate.time===row.time)))return record;
    const pricePath=observedPaperPricePath(record,actual)??before?.pricePath??null;
    const next={...actual,pricePath};
    if(before&&JSON.stringify({...before,filename:null})===JSON.stringify({...next,filename:null}))return record;
    changed++;
    return {...record,actual:next};
  });
  return {records:output,changed,matched};
}
