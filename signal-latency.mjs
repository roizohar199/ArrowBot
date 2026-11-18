// These timestamps end at the local Chrome key request, not an exchange fill.
export function createSignalLatency(limit=300){
 const entries=new Map();
 const duration=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
 function record(item){
  if(typeof item?.id!=='string'||!item.id||entries.has(item.id)||duration(item.firstSeenAt,item.confirmedAt)===null)return null;
  const attempted=Number.isFinite(item.keyDownAt)&&item.keyDownAt>=item.confirmedAt;
  const confirmedToKeyMs=attempted?duration(item.confirmedAt,item.keyDownAt):null;
  const delayMs=Number.isFinite(item.delayMs)&&item.delayMs>=0?item.delayMs:null;
  const value=Object.freeze({id:item.id,code:item.code??'UNKNOWN',firstSeenAt:item.firstSeenAt,confirmedAt:item.confirmedAt,keyRequestedAt:attempted?item.keyDownAt:null,delayMs,
   confirmationMs:duration(item.firstSeenAt,item.confirmedAt),confirmedToKeyMs,
   firstFrameToKeyMs:attempted?duration(item.firstSeenAt,item.keyDownAt):null,
   dispatchToKeyMs:attempted?duration(item.dispatchAt,item.keyDownAt):null,
   beyondDelayMs:confirmedToKeyMs!==null&&delayMs!==null?Math.max(0,confirmedToKeyMs-delayMs):null,
   replyMs:duration(item.confirmedAt,item.replyAt)});
  entries.set(item.id,value);if(entries.size>limit)entries.delete(entries.keys().next().value);
  return value;
 }
 function snapshot(){
  const rows=[...entries.values()],last=rows.reduce((latest,row)=>!latest||row.confirmedAt>=latest.confirmedAt?row:latest,null),result={count:rows.length,attempted:rows.filter(r=>r.keyRequestedAt!==null).length,last};
  for(const key of ['confirmationMs','confirmedToKeyMs','firstFrameToKeyMs','dispatchToKeyMs','beyondDelayMs','replyMs']){
   const values=rows.map(r=>r[key]).filter(Number.isFinite).sort((a,b)=>a-b);
   result[key]={count:values.length,p50:values.length?values[Math.ceil(values.length*.5)-1]:null,p95:values.length?values[Math.ceil(values.length*.95)-1]:null};
  }
  return result;
 }
 return {record,snapshot,reset(){entries.clear();}};
}
