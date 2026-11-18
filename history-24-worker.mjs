import {analyzeHistory24} from './history-24-analysis.mjs';
// Dedicated worker: no DOM, chrome execution API or broker adapter is imported.
let generation=0;
if(typeof self!=='undefined')self.onmessage=async event=>{
  const m=event.data;if(m?.type!=='ANALYZE_HISTORY24')return;const token=++generation;
  try{const result=await analyzeHistory24(m.dataset,m.metadata,{onProgress:progress=>{if(token===generation)self.postMessage({type:'HISTORY24_PROGRESS',jobId:m.jobId,progress});},yieldControl:()=>new Promise(resolve=>setTimeout(resolve,20))});if(token===generation)self.postMessage({type:'HISTORY24_RESULT',jobId:m.jobId,result});}
  catch(error){if(token===generation)self.postMessage({type:'HISTORY24_ERROR',jobId:m.jobId,message:String(error?.message??error).slice(0,160)});}
};
