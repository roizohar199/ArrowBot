// Personal Pine Logs bridge. Parse visible log text only; no executable payloads
// or private TradingView objects. A Pine realtime flag is not data-delay proof.
import {deriveVerifiedSessionGaps,declaredSessionGapMatches} from './session-gap-proof.mjs';
export const PINE_OHLC_PREFIX='ARROW_OHLC_V1';
export const PINE_OHLC_LIMITS=Object.freeze({maxText:100000,maxMessage:40960,maxBars:101,maxMessages:256});
const finite=Number.isFinite;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const fail=(code,detail)=>({ok:false,reasonCodes:[code],...(detail?{detail}:{})});
const packetKeys=['schemaVersion','kind','runId','sequence','sourceEmittedAt','realtime','dataDelayUnverified','metadata','bars','reasonCodes','higherTimeframes','bootstrapOnly'];
const metadataKeys=['source','instrument','timeframe','timeframeMs','tickSize','pointValue','timezone','session','chartType','currency','sessionGaps'];
const barKeys=['time','closeTime','open','high','low','close','volume','closed','sourceClosed','providerBarIndex','sessionFirst','sessionLast'];
const higherKeys=['timeframe','timeframeMs','bars','reasonCodes','sessionGaps'];
const timezoneCache=new Set();
const reasonsValid=value=>Array.isArray(value)&&value.length<=8&&value.every(code=>bounded(code,100));

// Only fixed second/minute intervals are supported. Calendar labels must not
// silently become nominal 24-hour or 30-day buckets.
export function pineFixedTimeframeMs(timeframe){
  if(typeof timeframe!=='string'||!/^\d+(?:S)?$/.test(timeframe))return null;
  const value=Number(timeframe.replace(/S$/,'')),duration=value*(timeframe.endsWith('S')?1000:60000);
  return value>0&&Number.isSafeInteger(duration)?duration:null;
}

function parseBars(input,{duration,closedOnly=false,maxBars=100,sourceAt=null}){
  if(!Array.isArray(input)||input.length>maxBars)return fail('PINE_BAR_COUNT_LIMIT');
  const bars=[];
  for(let i=0;i<input.length;i++){
    const bar=input[i],previous=input[i-1];
    if(!plain(bar)||!keys(bar,barKeys)||!['open','high','low','close'].every(key=>finite(bar[key]))||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low)return fail('PINE_INVALID_OHLC');
    if(Object.hasOwn(bar,'volume')&&bar.volume!==null&&(!finite(bar.volume)||bar.volume<0))return fail('PINE_INVALID_VOLUME');
    if(['providerBarIndex','sessionFirst','sessionLast'].some(key=>Object.hasOwn(bar,key))&&(!integer(bar.providerBarIndex)||typeof bar.sessionFirst!=='boolean'||typeof bar.sessionLast!=='boolean'))return fail('PINE_INVALID_PROVIDER_BAR_PROOF');
    if(!integer(bar.time)||!integer(bar.closeTime)||bar.closeTime-bar.time!==duration||previous&&bar.time<previous.closeTime)return fail('PINE_INVALID_BAR_TIMES');
    if(typeof bar.closed!=='boolean'||bar.sourceClosed!==bar.closed||closedOnly&&!bar.closed||!bar.closed&&i!==input.length-1)return fail('PINE_UNVERIFIED_BAR_CLOSE');
    if(sourceAt!==null&&bar.closeTime>sourceAt)return fail('PINE_FUTURE_HIGHER_TIMEFRAME_BAR');
    bars.push({...bar});
  }
  return {ok:true,bars};
}
function validateSessionGaps(gaps,bars){
  if(gaps===undefined)return true;
  if(!Array.isArray(gaps)||gaps.length>100)return false;
  const derived=deriveVerifiedSessionGaps(bars);
  return derived.valid&&derived.gaps.every(gap=>gaps.some(item=>item.from===gap.from&&item.to===gap.to))&&gaps.every(gap=>{
    if(!plain(gap)||Object.keys(gap).length!==8||gap.kind!=='market_closed'||gap.basis!=='PINE_SESSION_FLAGS_AND_PROVIDER_INDEX'||!integer(gap.from)||!integer(gap.to)||gap.to<=gap.from||!integer(gap.previousBarIndex)||gap.nextBarIndex!==gap.previousBarIndex+1||gap.previousSessionLast!==true||gap.nextSessionFirst!==true)return false;
    const match=bars.findIndex((bar,i)=>i>0&&bar.time===gap?.to&&bars[i-1].closeTime===gap?.from);
    if(match>0)return declaredSessionGapMatches(gap,bars[match-1],bars[match]);
    return bars.every(bar=>bar.time!==gap.to||(bar.providerBarIndex===gap.nextBarIndex&&bar.sessionFirst===true))&&bars.every(bar=>bar.closeTime!==gap.from||(bar.providerBarIndex===gap.previousBarIndex&&bar.sessionLast===true));
  });
}

function balancedEnd(text,start){
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){
    const character=text[i];
    if(quoted){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character==='"')quoted=false;continue;}
    if(character==='"'){quoted=true;continue;}
    if(character==='{')depth++;
    else if(character==='}'&&--depth===0)return i+1;
  }
  return -1;
}

export function parsePineOhlcMessage(text,{receivedAt=Date.now(),tabId}={}){
  if(typeof text!=='string'||!text.trim()||text.length>PINE_OHLC_LIMITS.maxText)return fail('PINE_LOG_SIZE_LIMIT');
  if(!integer(receivedAt)||!Number.isSafeInteger(tabId)||tabId<1)return fail('PINE_RECEIPT_CONTEXT_REQUIRED');
  const marker=text.indexOf(PINE_OHLC_PREFIX);
  if(marker<0)return fail('PINE_MARKER_REQUIRED');
  const remaining=text.slice(marker+PINE_OHLC_PREFIX.length).trim();
  if(!remaining.startsWith('{'))return fail('PINE_JSON_REQUIRED');
  const end=balancedEnd(remaining,0);
  if(end<0)return fail('PINE_TRUNCATED_LOG');
  if(remaining.slice(end).trim())return fail('PINE_LOG_TRAILING_TEXT');
  if(end>PINE_OHLC_LIMITS.maxMessage)return fail('PINE_MESSAGE_SIZE_LIMIT');
  let raw;try{raw=JSON.parse(remaining.slice(0,end));}catch{return fail('PINE_INVALID_JSON');}
  if(!plain(raw)||!keys(raw,packetKeys)||raw.schemaVersion!==1||!['snapshot','update','blocked','timeframe_snapshot','timeframe_update'].includes(raw.kind)||!bounded(raw.runId,400)||!Number.isSafeInteger(raw.sequence)||raw.sequence<1||!integer(raw.sourceEmittedAt)||typeof raw.realtime!=='boolean'||raw.dataDelayUnverified!==true)return fail('PINE_INVALID_ENVELOPE');
  if(!plain(raw.metadata)||!keys(raw.metadata,metadataKeys)||raw.metadata.source!=='ohlc'||!['standard','nonstandard'].includes(raw.metadata.chartType))return fail('PINE_INVALID_METADATA');
  const meta=raw.metadata;
  if(!['instrument','timeframe','timezone','session'].every(key=>bounded(meta[key],200)))return fail('PINE_INVALID_METADATA');
  if(Object.hasOwn(meta,'currency')&&!bounded(meta.currency,20))return fail('PINE_INVALID_CURRENCY');
  if(!timezoneCache.has(meta.timezone))try{new Intl.DateTimeFormat('en',{timeZone:meta.timezone});if(timezoneCache.size>=32)timezoneCache.clear();timezoneCache.add(meta.timezone);}catch{return fail('PINE_INVALID_TIMEZONE');}
  if(!reasonsValid(raw.reasonCodes))return fail('PINE_INVALID_REASON_CODES');
  if(!Array.isArray(raw.bars)||raw.bars.length>PINE_OHLC_LIMITS.maxBars)return fail('PINE_BAR_COUNT_LIMIT');
  const isHigher=raw.kind==='timeframe_snapshot'||raw.kind==='timeframe_update';
  if(Object.hasOwn(raw,'bootstrapOnly')&&(raw.bootstrapOnly!==true||raw.realtime||!['snapshot','timeframe_snapshot'].includes(raw.kind)))return fail('PINE_INVALID_BOOTSTRAP_SCOPE');
  if(!isHigher&&Object.hasOwn(raw,'higherTimeframes'))return fail('PINE_UNEXPECTED_HIGHER_TIMEFRAME_DATA');
  if(raw.kind==='blocked'){
    if(raw.bars.length||!raw.reasonCodes.length)return fail('PINE_INVALID_BLOCKED_LOG');
    return {ok:true,id:raw.runId+':'+raw.sequence,packet:{...structuredClone(raw),receivedAt,metadata:{...structuredClone(meta),provider:'TradingView Pine Logs',sourceId:raw.runId,tabId,sourceRealtime:raw.realtime,dataDelayUnverified:true}}};
  }
  if(meta.chartType!=='standard')return fail('PINE_STANDARD_CHART_REQUIRED');
  if(!Number.isSafeInteger(meta.timeframeMs)||meta.timeframeMs<1000||!finite(meta.tickSize)||meta.tickSize<=0||!finite(meta.pointValue)||meta.pointValue<=0)return fail('PINE_INVALID_METADATA');
  if((raw.kind==='update'||raw.kind==='timeframe_update')&&!raw.realtime)return fail('PINE_EXECUTION_STATE_MISMATCH');
  let bars=[],higherTimeframes;
  if(isHigher){
    if(raw.bars.length||!Array.isArray(raw.higherTimeframes)||raw.higherTimeframes.length<1||raw.higherTimeframes.length>3)return fail('PINE_INVALID_HIGHER_TIMEFRAME_ENVELOPE');
    higherTimeframes=[];let total=0;const timeframes=new Set();
    for(const entry of raw.higherTimeframes){
      if(!plain(entry)||!keys(entry,higherKeys)||!bounded(entry.timeframe,20)||timeframes.has(entry.timeframe)||!reasonsValid(entry.reasonCodes??[]))return fail('PINE_INVALID_HIGHER_TIMEFRAME_METADATA');
      timeframes.add(entry.timeframe);
      if(!Array.isArray(entry.bars))return fail('PINE_BAR_COUNT_LIMIT');
      const duration=pineFixedTimeframeMs(entry.timeframe),unavailable=entry.bars.length===0&&(entry.reasonCodes??[]).length>0;
      if(!unavailable&&(!duration||entry.timeframeMs!==duration||duration<=meta.timeframeMs))return fail('PINE_INVALID_HIGHER_TIMEFRAME_METADATA');
      if(unavailable&&entry.timeframeMs!==null&&entry.timeframeMs!==duration)return fail('PINE_INVALID_HIGHER_TIMEFRAME_METADATA');
      const parsed=parseBars(entry.bars,{duration:entry.timeframeMs,closedOnly:true,maxBars:raw.kind==='timeframe_snapshot'?100:2,sourceAt:raw.sourceEmittedAt});
      if(!parsed.ok)return parsed;
      if(!validateSessionGaps(entry.sessionGaps,parsed.bars))return fail('PINE_INVALID_SESSION_GAP_PROOF');
      total+=parsed.bars.length;if(total>100)return fail('PINE_BAR_COUNT_LIMIT');
      if(!parsed.bars.length&&!unavailable)return fail('PINE_EMPTY_HIGHER_TIMEFRAME_DATA');
      higherTimeframes.push({...structuredClone(entry),reasonCodes:[...(entry.reasonCodes??[])],bars:parsed.bars});
    }
  }else{
    if(!raw.bars.length)return fail('PINE_BAR_COUNT_LIMIT');
    const parsed=parseBars(raw.bars,{duration:meta.timeframeMs,closedOnly:raw.kind==='snapshot',maxBars:raw.kind==='snapshot'?100:2});
    if(!parsed.ok)return parsed;bars=parsed.bars;
    if(!validateSessionGaps(meta.sessionGaps,bars))return fail('PINE_INVALID_SESSION_GAP_PROOF');
  }
  // Never promote raw.realtime to metadata.realtime. DOM evidence must verify
  // delay status and Replay independently before the store permits live alerts.
  const packet={...structuredClone(raw),bars,...(higherTimeframes?{higherTimeframes}:{}),receivedAt,metadata:{...structuredClone(meta),provider:'TradingView Pine Logs',sourceId:raw.runId,tabId,sourceRealtime:raw.realtime,dataDelayUnverified:true}};
  return {ok:true,id:raw.runId+':'+raw.sequence,packet};
}

export function parsePineOhlcLogs(text,options={}){
  if(typeof text!=='string'||text.length>PINE_OHLC_LIMITS.maxText)return {ok:false,packets:[],errors:[fail('PINE_LOG_SIZE_LIMIT')]};
  const packets=[],errors=[],seen=new Set();let cursor=0,count=0;
  while(cursor<text.length){
    const marker=text.indexOf(PINE_OHLC_PREFIX,cursor);if(marker<0)break;
    if(++count>PINE_OHLC_LIMITS.maxMessages){errors.push(fail('PINE_LOG_COUNT_LIMIT'));break;}
    const start=marker+PINE_OHLC_PREFIX.length,bracket=text.indexOf('{',start),next=text.indexOf(PINE_OHLC_PREFIX,start);
    if(bracket<0||next>=0&&bracket>next){errors.push(fail('PINE_JSON_REQUIRED'));cursor=next>=0?next:text.length;continue;}
    const end=balancedEnd(text,bracket);
    if(end<0){errors.push(fail('PINE_TRUNCATED_LOG'));cursor=next>=0?next:text.length;continue;}
    const result=parsePineOhlcMessage(text.slice(marker,end),options);
    if(result.ok){if(!seen.has(result.id)){packets.push(result.packet);seen.add(result.id);}}else errors.push(result);
    cursor=!result.ok&&next>=0&&next<end?next:end;
  }
  return {ok:errors.length===0,packets,errors};
}
