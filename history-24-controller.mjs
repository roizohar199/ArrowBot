import {createHistory24Cache,HISTORY24_STORAGE_KEY,HISTORY24_MS} from './history-24-core.mjs';
import {readHistory24Window} from './history-24-reader.mjs';
const copy=x=>structuredClone(x);
export function createHistory24Controller({getContext,execute,storage,createWorker=()=>new Worker(new URL('./history-24-worker.mjs',import.meta.url),{type:'module'}),onChange=()=>{},onResult=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let cache=createHistory24Cache(),loaded=false,requested=false,disposed=false,busy=false,timer=null,saveTimer=null,worker=null,job=0,targetEnd=null,readCount=0,duplicates=0,lastSeq=null,lastRun=null,lastResult=null,startedAt=null,lastLiveSignature=null;
  let state={status:'NOT_STARTED',coverage:[],reasonCodes:[],ordersCreated:false,liveExecutionBlockedByHistory:false};
  const init=Promise.resolve(storage?.get?.(HISTORY24_STORAGE_KEY)).then(v=>{const saved=v?.[HISTORY24_STORAGE_KEY];cache=createHistory24Cache(saved?.cache);lastResult=saved?.lastResult??null;loaded=true;}).catch(()=>{loaded=true;});
  const snapshot=()=>copy({...state,requested,busy,targetEnd,start:targetEnd===null?null:targetEnd-HISTORY24_MS,startedAt,readCount,duplicates,lastResult,workerIsSeparate:true,ordersCreated:false,liveExecutionBlockedByHistory:false});
  const emit=()=>onChange(snapshot());
  function persist(){if(disposed)return;void Promise.resolve(storage?.set?.({[HISTORY24_STORAGE_KEY]:{version:1,cache:cache.snapshot(),lastResult}})).catch(()=>{});}
  function saveSoon(){if(saveTimer!==null)return;saveTimer=setTimer(()=>{saveTimer=null;persist();},5000);}
  function schedule(ms=200){if(disposed||!requested||timer!==null)return;timer=setTimer(()=>{timer=null;void tick();},ms);}
  function liveRows(c){
    if(!c?.active||!c.metadata||!Array.isArray(c.bars))return false;
    const signature=JSON.stringify([c.runId,c.generation,c.bars.length,c.bars.at(-1)?.closeTime,Object.entries(c.higherTimeframes??{}).map(([tf,v])=>[tf,v.bars?.length,v.bars?.at(-1)?.closeTime])]);if(signature===lastLiveSignature)return false;lastLiveSignature=signature;
    cache.ingest(c.bars.filter(b=>b.closed===true&&b.finalOhlcVerified===true).map(b=>({...b,sourceClosed:true})), '1',{runKey:'live:'+c.runId,source:'LIVE_CLOSED_CONTEXT',windowEnd:c.bars.at(-1)?.closeTime,retainEnd:targetEnd??undefined,now:now()});
    for(const [tf,entry]of Object.entries(c.higherTimeframes??{}))if(['5','15'].includes(tf)&&Array.isArray(entry.bars))cache.ingest(entry.bars.map(b=>({...b,closed:true,sourceClosed:true,finalOhlcVerified:true})),tf,{runKey:'live:'+c.runId,source:'LIVE_CLOSED_CONTEXT',windowEnd:c.bars.at(-1)?.closeTime,retainEnd:targetEnd??undefined,now:now()});
    return true;
  }
  function analyze(dataset,c){
    state={...state,status:'ANALYZING',coverage:dataset.coverage,reasonCodes:[]};emit();persist();const current=job;
    try{worker??=createWorker();worker.onmessage=event=>{const m=event.data;if(disposed||m?.jobId!==job||m.jobId!==current)return;if(m.type==='HISTORY24_PROGRESS'){state={...state,progress:m.progress};emit();}else if(m.type==='HISTORY24_RESULT'){lastResult=m.result;state={...state,status:m.result.status==='COMPLETE'?'COMPLETE':'BLOCKED',reasonCodes:m.result.reasonCodes??[],completedAt:now(),elapsedMs:now()-startedAt};requested=false;persist();emit();if(m.result.status==='COMPLETE')onResult(copy(m.result));}else if(m.type==='HISTORY24_ERROR'){state={...state,status:'BLOCKED',reasonCodes:[m.message]};requested=false;emit();}};worker.postMessage({type:'ANALYZE_HISTORY24',jobId:current,dataset,metadata:c.metadata});}
    catch(error){requested=false;state={...state,status:'BLOCKED',reasonCodes:[String(error?.message??error)]};emit();}
  }
  async function tick(){
    if(disposed||busy||!requested||state.status==='ANALYZING')return;busy=true;
    try{
      await init;if(disposed)return;const c=getContext();
      if(!c?.active||!c.metadata||!c.bars?.length){state={...state,status:'WAITING_LIVE_SOURCE'};emit();schedule(500);return;}
      if(targetEnd===null)targetEnd=c.bars.at(-1).closeTime;
      liveRows(c);let dataset=cache.forRange(targetEnd);state={...state,coverage:dataset.coverage};
      if(dataset.complete){analyze(dataset,c);return;}
      state={...state,status:'SCANNING_MISSING',reasonCodes:dataset.reasonCodes};
      // This is a separate read-only request. Live analysis/entry never awaits it.
      const frame=await execute(readHistory24Window,{sourceUrl:c.sourceUrl,instrument:c.metadata.instrument,tickSize:c.metadata.tickSize,pointValue:c.metadata.pointValue,currency:c.metadata.currency});
      if(disposed||!requested)return;readCount++;
      if(frame?.status==='OK'&&frame.checksumsVerified===true){
        if(frame.runEpoch===lastRun&&frame.sequence===lastSeq)duplicates++;else{lastRun=frame.runEpoch;lastSeq=frame.sequence;cache.ingest(frame.bars,frame.timeframe,{runKey:'archive:'+frame.runEpoch,windowEnd:frame.windowEnd,retainEnd:targetEnd,totalRows:frame.totalRows,pageIndex:frame.pageIndex,pageCount:frame.pageCount,now:now()});saveSoon();}
        dataset=cache.forRange(targetEnd);state={...state,coverage:dataset.coverage,reasonCodes:dataset.reasonCodes};if(dataset.complete){analyze(dataset,c);return;}
      }else state={...state,transportStatus:frame?.status??'ARCHIVE_READ_UNAVAILABLE'};
      emit();schedule();
    }catch(error){state={...state,status:'SCANNING_MISSING',transportStatus:String(error?.message??error).slice(0,160)};emit();schedule(1000);}
    finally{busy=false;}
  }
  function start(){if(disposed)return;job++;worker?.terminate?.();worker=null;requested=true;targetEnd=null;startedAt=now();readCount=0;duplicates=0;lastSeq=null;lastRun=null;state={...state,status:'WAITING_LIVE_SOURCE',reasonCodes:[]};emit();schedule(0);}
  return {start,tick,snapshot,exportState:()=>({...snapshot(),cache:cache.snapshot()}),countDataset(end,count=3000){return loaded?cache.forBars(end,count):null;},ingestArchive(frame){if(!loaded||frame?.status!=='OK'||frame.checksumsVerified!==true)return false;const accepted=cache.ingest(frame.bars,frame.timeframe,{runKey:'archive:'+frame.runEpoch,windowEnd:frame.windowEnd,totalRows:frame.totalRows,pageIndex:frame.pageIndex,pageCount:frame.pageCount,now:now()});if(accepted.accepted)saveSoon();return accepted.accepted;},updateLive(c){if(loaded&&liveRows(c))saveSoon();if(requested)schedule();},dispose(){persist();disposed=true;job++;requested=false;if(timer!==null)clearTimer(timer);if(saveTimer!==null)clearTimer(saveTimer);worker?.terminate?.();}};
}
