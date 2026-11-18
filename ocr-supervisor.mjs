// OCR never authorizes an entry. A broken numerical reader must be replaceable
// without restarting chart observation or accepting an obsolete result.
export function createOcrSupervisor({create,initializationTimeoutMs=15000,readTimeoutMs=3000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(typeof create!=='function')throw TypeError('An OCR factory is required');
 let generation=0,engine=null,creating=null,active=null,nextJob=0,restarts=0,timeouts=0,lastError=null;
 const cancellations=new Set(),terminated=new WeakSet();
 const failure=code=>Object.assign(Error(code),{code});
 function terminate(reader){
  if(!reader||!['object','function'].includes(typeof reader)||terminated.has(reader))return;
  terminated.add(reader);try{void Promise.resolve(reader.terminate?.()).catch(()=>{});}catch{/* Cleanup cannot block replacement. */}
 }
 function reset(reason='OCR_RESET'){
  generation++;const old=engine;engine=null;creating=null;active=null;lastError=reason;restarts++;
  for(const cancel of [...cancellations])cancel();terminate(old);
 }
 function deadline(operation,ms,code){
  let timer,cancel;
  const stopped=new Promise((_,reject)=>{
   cancel=()=>reject(failure('OCR_RESET'));cancellations.add(cancel);
   timer=setTimer(()=>{timeouts++;reject(failure(code));},ms);
  });
  return Promise.race([operation,stopped]).finally(()=>{clearTimer(timer);cancellations.delete(cancel);});
 }
 function warm(){
  if(engine)return Promise.resolve(engine);
  if(creating)return creating;
  const token=generation,raw=Promise.resolve().then(create);let acquired=null;
  // Initialization may finish after its timeout. Close that obsolete worker
  // rather than leaking it or allowing it to replace the current generation.
  void raw.then(reader=>{acquired=reader;if(token!==generation)terminate(reader);},()=>{});
  let pending;
  pending=deadline(raw,initializationTimeoutMs,'OCR_INITIALIZATION_TIMEOUT').then(reader=>{
   if(token!==generation){terminate(reader);throw failure('OCR_RESET');}
   if(!reader||typeof reader.recognize!=='function'){terminate(reader);throw failure('OCR_INVALID_READER');}
   engine=reader;return reader;
  }).catch(error=>{if(acquired&&acquired!==engine)terminate(acquired);if(token===generation)reset(error?.code??'OCR_INITIALIZATION_FAILED');throw error;}).finally(()=>{if(creating===pending)creating=null;});
  creating=pending;return pending;
 }
 async function recognize(...args){
  if(active)throw failure('OCR_BUSY');
  const token=generation,id=++nextJob;active={id,token};
  try{
   const reader=await warm();if(token!==generation)throw failure('OCR_RESET');
   return await deadline(Promise.resolve().then(()=>reader.recognize(...args)),readTimeoutMs,'OCR_READ_TIMEOUT');
  }catch(error){if(token===generation)reset(error?.code??'OCR_READ_FAILED');throw error;}
  finally{if(active?.id===id)active=null;}
 }
 return {warm,recognize,reset,snapshot:()=>({generation,ready:!!engine,initializing:!!creating,busy:!!active,restarts,timeouts,lastError})};
}
