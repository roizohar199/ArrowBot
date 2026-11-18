import {analyzeWarmupSequential} from './history-warmup-analysis.mjs';
// No DOM, broker API, native gesture or execution capability.
if(typeof self!=='undefined')self.onmessage=async event=>{
  const m=event.data;if(m?.type!=='PROCESS_WARMUP_HISTORY')return;
  try{const result=await analyzeWarmupSequential(m.dataset,m.metadata,{onProgress:progress=>self.postMessage({type:'WARMUP_PROGRESS',jobId:m.jobId,progress})});self.postMessage({type:'WARMUP_RESULT',jobId:m.jobId,result});}
  catch(error){self.postMessage({type:'WARMUP_ERROR',jobId:m.jobId,message:String(error?.message??error).slice(0,160)});}
};
