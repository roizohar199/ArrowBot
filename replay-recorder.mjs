// Optional bounded local diagnostic recording. No recording data is an entry
// condition, and detector observations are never labelled as human truth.
export function createReplayRecorder({encode,now=Date.now,durationMs=3000,maxFrames=180,maxBytes=24*1024*1024,encodeTimeoutMs=2500,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(typeof encode!=='function')throw TypeError('An image encoder is required');
 let generation=0,active=false,busy=false,pending=Promise.resolve(),frames=[],bytes=0,startedAt=0,lastAt=-Infinity,skipped=0,reason='IDLE',source={};
 const snapshot=()=>({active,busy,frames:frames.length,bytes,skipped,reason,elapsedMs:startedAt?Math.max(0,now()-startedAt):0,durationMs,maxFrames,maxBytes});
 function stop(why='STOPPED'){active=false;reason=why;return snapshot();}
 function start(meta={}){
  if(busy)throw Error('ENCODER_BUSY');
  generation++;active=true;frames=[];bytes=0;startedAt=now();lastAt=-Infinity;skipped=0;reason='RECORDING';source={...meta,kind:'recording',description:'Actual shared-tab frames; observations are unscored until independently annotated.'};return snapshot();
 }
 function offer(image,meta){
  if(!active)return false;
  const at=meta?.capturedAt;
  if(!Number.isFinite(at)||at<startedAt||at<=lastAt)return false;
  if(at-startedAt>durationMs||frames.length>=maxFrames){stop('COMPLETE');return false;}
  if(busy){skipped++;return false;}
  const token=generation;busy=true;lastAt=at;
  const description={atMs:at-startedAt,context:meta.context,geometry:meta.geometry,region:{...meta.region},chartValidated:meta.chartValidated===true,frameId:meta.frameId,
   observations:meta.observations?structuredClone(meta.observations):undefined};
  let timer;
  const work=Promise.resolve().then(()=>encode(image));
  // A timed-out native encoder may still own its image. Keep the reservation
  // until it really settles, so repeatedly starting cannot pile up images.
  void work.then(()=>{busy=false;},()=>{busy=false;});
  const timeout=new Promise((_,reject)=>{timer=setTimer(()=>reject(Error('ENCODE_TIMEOUT')),encodeTimeoutMs);});
  pending=Promise.race([work,timeout]).then(encoded=>{
   if(token!==generation)return;
   if(typeof encoded?.data!=='string'||!encoded.data||encoded.encoding!=='png-base64')throw Error('INVALID_ENCODED_FRAME');
   const size=encoded.data.length;
   if(bytes+size>maxBytes){stop('SIZE_LIMIT');return;}
   frames.push({...description,image:{encoding:encoded.encoding,data:encoded.data,width:image.width,height:image.height}});bytes+=size;
   if(frames.length>=maxFrames)stop('FRAME_LIMIT');
  }).catch(error=>{if(token===generation){skipped++;stop(error?.message??'ENCODE_FAILED');}}).finally(()=>{clearTimer(timer);});
  return true;
 }
 return {start,stop,offer,snapshot,flush:()=>pending,cancel(){generation++;active=false;frames=[];bytes=0;reason='CANCELLED';},
  async export(){const token=generation;stop(active?'COMPLETE':reason);await pending;if(token!==generation)throw Error('OBSOLETE_RECORDING');return {schemaVersion:1,source:{...source,recordedAt:new Date(startedAt).toISOString(),droppedWhileEncoding:skipped},frames:frames.map(frame=>({...frame}))};},
 };
}

export async function encodeReplayPng(image,makeCanvas=()=>document.createElement('canvas')){
 const canvas=makeCanvas();canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').putImageData(image,0,0);
 const blob=await new Promise((resolve,reject)=>{canvas.toBlob(value=>value?resolve(value):reject(Error('PNG_ENCODING_FAILED')),'image/png');});
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
 for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
 return {encoding:'png-base64',data:btoa(binary)};
}
