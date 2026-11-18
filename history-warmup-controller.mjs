import {readHistory24Window} from './history-24-reader.mjs';
const copy=x=>structuredClone(x);
export const WARMUP_BAR_COUNT=3000,WARMUP_RESULT_KEY='arrow.warmup3000.processed.v1';
export function createHistoryWarmupController({getContext,historyCache,execute,requestRepair,storage,createWorker=()=>new Worker(new URL('./history-warmup-worker.mjs',import.meta.url),{type:'module'}),onChange=()=>{},onReady=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let state={status:'NOT_STARTED',requestedBars:WARMUP_BAR_COUNT,receivedBars:0,processedBars:0,ordersCreated:false,liveExecutionBlocked:false},timer=null,worker=null,job=0,busy=false,disposed=false,requested=false,targetEnd=null,result=null,lastRepairAt=-Infinity;
  const snapshot=()=>copy({...state,busy,requested,targetEnd,result});
  const emit=()=>onChange(snapshot());
  const schedule=(ms=200)=>{if(!disposed&&requested&&timer===null)timer=setTimer(()=>{timer=null;void tick();},ms);};
  async function tick(){
    if(disposed||busy||!requested||state.status==='PROCESSING')return;busy=true;const token=job;
    try{
      const c=getContext();if(!c?.active||!c.metadata||!c.bars?.length){state={...state,status:'WAITING_SOURCE'};emit();schedule(500);return;}
      targetEnd??=c.bars.at(-1).closeTime;
      let dataset=historyCache.countDataset(targetEnd,WARMUP_BAR_COUNT);
      state={...state,status:'COLLECTING',receivedBars:dataset?.series?.['1']?.length??0,coverage:dataset?.coverage??[],reasonCodes:dataset?.reasonCodes??[]};
      if(!dataset?.complete&&dataset?.series?.['1']?.length===WARMUP_BAR_COUNT&&dataset.repairRequests?.length&&typeof requestRepair==='function'&&now()-lastRepairAt>=45000){
        lastRepairAt=now();const repair={requestedAt:lastRepairAt,requests:copy(dataset.repairRequests)};state={...state,repair};
        const reply=await requestRepair(repair);if(disposed||job!==token)return;state={...state,repair:{...repair,status:reply?.status??'UNAVAILABLE'}};
        if(reply?.status==='PRESENTATION_DEFERRED')lastRepairAt=now()-42000;
      }
      if(!dataset?.complete){
        const frame=await execute(readHistory24Window,{sourceUrl:c.sourceUrl,instrument:c.metadata.instrument,tickSize:c.metadata.tickSize,pointValue:c.metadata.pointValue,currency:c.metadata.currency});
        if(disposed||job!==token)return;
        if(frame?.status==='OK'&&frame.checksumsVerified===true&&frame.sourceUrl===c.sourceUrl&&frame.instrument===c.metadata.instrument)historyCache.ingestArchive(frame);
        else state={...state,transportStatus:frame?.status??'ARCHIVE_UNAVAILABLE'};
        dataset=historyCache.countDataset(targetEnd,WARMUP_BAR_COUNT);state={...state,receivedBars:dataset?.series?.['1']?.length??0,coverage:dataset?.coverage??[],reasonCodes:dataset?.reasonCodes??[]};
      }
      if(!dataset?.complete){emit();schedule();return;}
      state={...state,status:'PROCESSING',processedBars:0,processingStartedAt:now(),reasonCodes:[]};emit();worker=createWorker();
      worker.onmessage=event=>{
        const m=event.data;if(disposed||job!==token||m?.jobId!==token)return;
        if(m.type==='WARMUP_PROGRESS'){state={...state,...m.progress};emit();}
        else if(m.type==='WARMUP_RESULT'){
          result=m.result;requested=false;state={...state,status:result.status==='COMPLETE'?'WAITING_SAFE_ACTIVATION':'BLOCKED',processedBars:result.processedBars,reasonCodes:result.reasonCodes,completedAt:now(),processingElapsedMs:now()-state.processingStartedAt};
          void Promise.resolve(storage?.set?.({[WARMUP_RESULT_KEY]:{result,completedAt:state.completedAt}})).catch(()=>{});emit();worker?.terminate?.();worker=null;
          if(result.status==='COMPLETE')onReady({dataset:copy(dataset),result:copy(result)});
        }else if(m.type==='WARMUP_ERROR'){requested=false;state={...state,status:'BLOCKED',reasonCodes:[m.message]};emit();worker?.terminate?.();worker=null;}
      };
      worker.postMessage({type:'PROCESS_WARMUP_HISTORY',jobId:token,dataset,metadata:copy(c.metadata)});
    }catch(error){state={...state,status:'COLLECTING',transportStatus:String(error?.message??error).slice(0,160)};emit();schedule(1000);}
    finally{busy=false;}
  }
  return {snapshot,tick,start(){job++;worker?.terminate?.();worker=null;if(timer!==null)clearTimer(timer);timer=null;requested=true;targetEnd=null;result=null;lastRepairAt=-Infinity;state={status:'WAITING_SOURCE',requestedBars:WARMUP_BAR_COUNT,receivedBars:0,processedBars:0,startedAt:now(),ordersCreated:false,liveExecutionBlocked:false};emit();schedule(0);},activated(proof){state={...state,status:'ACTIVE',activation:copy(proof)};emit();},deactivated(reason){if(state.status==='ACTIVE'){state={...state,status:'WAITING_SAFE_ACTIVATION',reasonCodes:[reason],activation:null};emit();}},dispose(){disposed=true;job++;requested=false;if(timer!==null)clearTimer(timer);worker?.terminate?.();}};
}
