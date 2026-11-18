import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readTradingViewCsv} from '../tests/verify-live-ohlc-recording.mjs';

// Offline comparison only. Native CSVs are another extraction from TradingView,
// not an independent market feed or source of authenticated broker information.
const fields=['open','high','low','close'],timeframes=['1','5','15'];
const maxRecordingBytes=5*1024*1024,maxCsvBytes=20*1024*1024,maxCsvRows=200000,maxSeedBars=100;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const iso=value=>Number.isSafeInteger(value)?new Date(value).toISOString():null;
function intervalOf(bars){
  const counts=new Map();for(let index=1;index<bars.length;index++){const width=bars[index].time-bars[index-1].time;counts.set(width,(counts.get(width)??0)+1);}
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??null;
}
function windowOf(bars){return {rows:bars.length,firstOpenUtc:iso(bars[0]?.time),lastOpenUtc:iso(bars.at(-1)?.time)};}
function validateSeed(bars,duration,sourceAt){
  if(!Array.isArray(bars)||!bars.length||bars.length>maxSeedBars)return ['SEED_BAR_COUNT_INVALID'];
  const reasons=[];
  for(let index=0;index<bars.length;index++){
    const bar=bars[index];
    if(!plain(bar)||!Number.isSafeInteger(bar.time)||!Number.isSafeInteger(bar.closeTime)||bar.time<0||bar.closeTime-bar.time!==duration||bar.closeTime>sourceAt||index&&bar.time<=bars[index-1].time)reasons.push('SEED_TIMES_INVALID');
    if(bar?.closed!==true||bar?.sourceClosed!==true)reasons.push('SEED_PROVIDER_FINAL_REQUIRED');
    if(fields.some(field=>!Number.isFinite(bar?.[field]))||bar?.high<Math.max(bar?.open,bar?.close)||bar?.low>Math.min(bar?.open,bar?.close)||bar?.high<bar?.low)reasons.push('SEED_OHLC_INVALID');
  }
  return [...new Set(reasons)];
}
function compareSeries(timeframe,bars,csvText,sourceAt){
  const duration=Number(timeframe)*60000,reasonCodes=validateSeed(bars,duration,sourceAt),base={timeframe,timeframeMs:duration,sourceBars:Array.isArray(bars)?bars.length:0,comparedFields:['time',...fields],timestampPolicy:'CSV Unix seconds multiplied by1000 exactly; compare UTC bar-open epoch milliseconds',pricePolicy:'EXACT_NUMERIC_EQUALITY_NO_TOLERANCE'};
  if(reasonCodes.length)return {...base,status:'UNAVAILABLE',reasonCodes,compared:0,matched:0,mismatched:0,missing:0,volume:{status:'UNAVAILABLE',reason:'SOURCE_SERIES_INVALID'}};
  if(typeof csvText!=='string'||Buffer.byteLength(csvText,'utf8')>maxCsvBytes)return {...base,status:'UNAVAILABLE',reasonCodes:['CSV_MISSING_OR_SIZE_LIMIT'],compared:0,matched:0,mismatched:0,missing:bars.length,volume:{status:'UNAVAILABLE',reason:'CSV_NOT_AVAILABLE'}};
  let csv;
  try{csv=readTradingViewCsv(csvText);}catch(error){return {...base,status:'UNAVAILABLE',reasonCodes:['CSV_PARSE_FAILED'],detail:String(error.message).slice(0,150),compared:0,matched:0,mismatched:0,missing:bars.length,volume:{status:'UNAVAILABLE',reason:'CSV_NOT_AVAILABLE'}};}
  if(csv.length>maxCsvRows)return {...base,status:'UNAVAILABLE',reasonCodes:['CSV_ROW_LIMIT'],compared:0,matched:0,mismatched:0,missing:bars.length,volume:{status:'UNAVAILABLE',reason:'CSV_ROW_LIMIT'}};
  const observedCsvIntervalMs=intervalOf(csv),csvVolumeIncluded=csv.some(bar=>Object.hasOwn(bar,'volume'));
  const volume={status:'UNAVAILABLE',csvColumnIncluded:csvVolumeIncluded,compared:0,reason:csvVolumeIncluded?'VOLUME_OUTSIDE_THIS_PRICE_AUDIT':'NATIVE_CSV_VOLUME_COLUMN_ABSENT',scope:'ARROW2_* indicator plot columns are not native bar Volume and are never substituted for it.'};
  if(observedCsvIntervalMs!==duration)return {...base,status:'UNAVAILABLE',reasonCodes:['CSV_TIMEFRAME_UNVERIFIED_OR_MISMATCH'],observedCsvIntervalMs,csvRows:csv.length,compared:0,matched:0,mismatched:0,missing:bars.length,volume};
  const byTime=new Map(csv.map(bar=>[bar.time,bar])),checks=[];let matched=0,mismatched=0,missing=0,maximumAbsoluteDifference=0;
  for(const bar of bars){
    const reference=byTime.get(bar.time),row={time:bar.time,timeUtc:iso(bar.time),closeTime:bar.closeTime};
    if(!reference){missing++;checks.push({...row,status:'MISSING_CSV_ROW'});continue;}
    const differences=fields.flatMap(field=>{const difference=Math.abs(bar[field]-reference[field]);maximumAbsoluteDifference=Math.max(maximumAbsoluteDifference,difference);return bar[field]===reference[field]?[]:[{field,recorded:bar[field],csv:reference[field],absoluteDifference:difference}];});
    if(differences.length){mismatched++;checks.push({...row,status:'MISMATCH',differences});}else{matched++;checks.push({...row,status:'MATCH'});}
  }
  return {...base,status:mismatched?'MISMATCH':missing?'PARTIAL':'MATCH',reasonCodes:[],csvRows:csv.length,observedCsvIntervalMs,sourceWindow:windowOf(bars),csvWindow:windowOf(csv),compared:matched+mismatched,matched,mismatched,missing,coverageFraction:(matched+mismatched)/bars.length,maximumAbsoluteDifference,volume,checks};
}

export function verifyPreopenPrices(recording,csvByTimeframe,{verifiedAt=new Date().toISOString()}={}){
  const context=recording?.preopenContext,history=context?.bootstrapHistory;
  if(recording?.kind!=='LIVE_OHLC_OBSERVATION'||context?.kind!=='PREOPEN_CONTEXT_ONLY'||context?.contextOnly!==true||context?.liveEligible!==false||!plain(history)||!plain(history.metadata)||!Number.isSafeInteger(history.sourceEmittedAt))throw Error('BOUNDED_PREOPEN_CONTEXT_REQUIRED');
  if(history.metadata.source!=='ohlc'||history.metadata.chartType!=='standard'||history.metadata.timeframe!=='1'||history.metadata.timeframeMs!==60000)throw Error('STANDARD_ONE_MINUTE_PREOPEN_SOURCE_REQUIRED');
  if(!Array.isArray(history.higherTimeframes)||history.higherTimeframes.length!==2||new Set(history.higherTimeframes.map(item=>item?.timeframe)).size!==2)throw Error('EXACT_5_AND_15_PREOPEN_SERIES_REQUIRED');
  const higher=Object.fromEntries(history.higherTimeframes.map(item=>[item.timeframe,item]));
  for(const timeframe of ['5','15'])if(higher[timeframe]?.timeframeMs!==Number(timeframe)*60000)throw Error('HIGHER_TIMEFRAME_IDENTITY_MISMATCH');
  const series=Object.fromEntries(timeframes.map(timeframe=>[timeframe,compareSeries(timeframe,timeframe==='1'?history.baseBars:higher[timeframe].bars,csvByTimeframe?.[timeframe],history.sourceEmittedAt)]));
  const values=Object.values(series),total=key=>values.reduce((sum,item)=>sum+(item[key]??0),0);
  return {kind:'PREOPEN_NATIVE_TRADINGVIEW_PRICE_AUDIT',schemaVersion:1,verifiedAt,status:values.some(item=>item.status==='MISMATCH')?'MISMATCH':values.every(item=>item.status==='MATCH')?'MATCH_ALL_RECORDED_PRICES':'PARTIAL',extensionVersion:recording.extensionVersion??null,instrument:history.metadata.instrument,timeframes,sourceRunId:history.runId,sourceEmittedAt:history.sourceEmittedAt,contextOnly:true,liveSignalVerified:false,exchangeAccuracyVerified:false,sourceBars:total('sourceBars'),compared:total('compared'),matched:total('matched'),mismatched:total('mismatched'),missing:total('missing'),series,scope:'Exact retained closed seed OHLC compared with separately exported native TradingView CSV rows at1/5/15minutes. Internal TradingView extraction consistency only; CSV symbol/session identity relies on the accompanying public UI evidence, not the CSV header.',limitations:['No independent exchange feed comparison, profitability or all-market accuracy is established.','Missing CSV rows, invalid intervals or absent series remain incomplete; they never count as matches.','Native Volume is unavailable when the native CSV Volume column is absent. Indicator plot values are not substituted.','This price-only audit does not verify an approved live signal, data freshness, order execution or end-to-end latency.']};
}

async function readBounded(path,maximumBytes){const info=await stat(path);if(!info.isFile()||info.size>maximumBytes)throw Error('INPUT_SIZE_OR_TYPE_LIMIT:'+path);return await readFile(path);}
async function main(){
  const [recordingArg,oneArg,fiveArg,fifteenArg,reportArg,...extra]=process.argv.slice(2);
  if(!recordingArg||!oneArg||!fiveArg||!fifteenArg||extra.length)throw Error('Usage: node scripts/verify-preopen-prices.mjs RECORDING.json NATIVE-1.csv NATIVE-5.csv NATIVE-15.csv [REPORT.json]');
  const recordingPath=resolve(recordingArg),csvPaths={'1':resolve(oneArg),'5':resolve(fiveArg),'15':resolve(fifteenArg)};
  const [recordingBytes,...csvBytes]=await Promise.all([readBounded(recordingPath,maxRecordingBytes),...timeframes.map(tf=>readBounded(csvPaths[tf],maxCsvBytes))]);
  const report=verifyPreopenPrices(JSON.parse(recordingBytes.toString('utf8')),Object.fromEntries(timeframes.map((tf,index)=>[tf,csvBytes[index].toString('utf8')])));
  report.artifacts={recording:{path:recordingPath,bytes:recordingBytes.length,sha256:sha256(recordingBytes)},csv:Object.fromEntries(timeframes.map((tf,index)=>[tf,{path:csvPaths[tf],bytes:csvBytes[index].length,sha256:sha256(csvBytes[index])}]))};
  if(reportArg)await writeFile(resolve(reportArg),JSON.stringify(report,null,2)+'\n','utf8');
  process.stdout.write(JSON.stringify({status:report.status,instrument:report.instrument,sourceBars:report.sourceBars,compared:report.compared,matched:report.matched,mismatched:report.mismatched,missing:report.missing,series:Object.fromEntries(timeframes.map(tf=>[tf,{status:report.series[tf].status,matched:report.series[tf].matched,missing:report.series[tf].missing,volume:report.series[tf].volume.status}])),...(reportArg?{report:resolve(reportArg)}:{})},null,2)+'\n');
  if(report.status!=='MATCH_ALL_RECORDED_PRICES')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({status:'ERROR',reason:String(error?.message??error)})+'\n');process.exitCode=1;});
