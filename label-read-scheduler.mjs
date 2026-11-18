import {verifiedLabelNumber} from './label-number-policy.mjs';

const direction=value=>value==='UP'||value==='DOWN';
const keyOf=value=>value?.appearanceKey??value?.key;
const frameId=value=>typeof value==='number'?Number.isFinite(value):typeof value==='string'&&value.length>0;
const validBox=box=>box&&['x','y','width','height'].every(key=>Number.isSafeInteger(box[key]))&&box.x>=0&&box.y>=0&&box.width>0&&box.height>0;

// Schedule numerical annotation only. This module has no event, entry or key
// dispatch policy, and keeps no images or list of historical printed numbers.
export function createLabelReadScheduler({needsRead=meta=>meta.needsHintRead===true,now=Date.now,backoffMs=1500,maxDisplayAttempts=3,maxBaselineCandidates=4,tolerance=4}={}){
 let generation=0,binding=null,visible=[],active=null,lastFrame=null,displayEntry=null,nextEpisode=0,nextJob=0,served=0,finishedThrough=-Infinity;
 const near=(a,b)=>Math.abs(a.x-b.x)<=tolerance&&Math.abs(a.y-b.y)<=tolerance;
 const scopeOf=value=>value&&typeof value.context==='string'&&value.context&&typeof value.geometry==='string'&&value.geometry&&Number.isSafeInteger(value.proofGeneration)&&value.proofGeneration>=0?{context:value.context,geometry:value.geometry,proofGeneration:value.proofGeneration}:null;
 const sameScope=(a,b)=>!!a&&!!b&&a.context===b.context&&a.geometry===b.geometry&&a.proofGeneration===b.proofGeneration;
 const validCandidate=c=>c&&typeof keyOf(c)==='string'&&keyOf(c)&&direction(c.direction)&&Number.isFinite(c.x)&&Number.isFinite(c.y)&&validBox(c.box)&&Math.abs(c.x-(c.box.x+c.box.width/2))<=2&&Math.abs(c.y-(c.box.y+c.box.height/2))<=2;
 const sameCandidate=(a,b)=>a&&b&&keyOf(a)===keyOf(b)&&a.direction===b.direction&&near(a,b);
 function reset(scope){
  generation++;binding=scopeOf(scope);visible=[];lastFrame=null;displayEntry=null;finishedThrough=-Infinity;
  // Reset invalidates the result, but cannot make the old OCR worker idle.
  // Its completion/failure releases this reservation before another pick.
 }
 function current(task){
  if(!task||task.generation!==generation||!sameScope(task.meta,binding))return null;
  const entry=visible.find(value=>value.episode===task.episode);
  return entry&&sameCandidate(entry.candidate,task.candidate)&&task.meta.minCapturedAt>=entry.meta.minCapturedAt?entry:null;
 }
 function release(task){
  if(!active||active.id!==task?.id)return false;
  active=null;if(lastFrame)finishedThrough=Math.max(finishedThrough,lastFrame.capturedAt);
  return true;
 }
 function pick(frame){
  const scope=scopeOf(frame);
  if(!scope||!Number.isFinite(frame.capturedAt)||!frameId(frame.frameId)||!Array.isArray(frame.candidates))return null;
  if(!sameScope(binding,scope))reset(scope);
  if(lastFrame&&frame.capturedAt<=lastFrame.capturedAt)return null;
  const candidates=frame.candidates.filter(validCandidate),prior=visible,used=new Set(),requests=Array.isArray(frame.requests)?frame.requests:[];
  visible=candidates.map(candidate=>{
   const matches=prior.filter(entry=>!used.has(entry)&&sameCandidate(entry.candidate,candidate));
   const entry=matches.length===1?matches[0]:{episode:++nextEpisode,firstSeenAt:frame.capturedAt,attempts:0,retryAt:0,lastServed:0,number:null,status:'waiting',lastAttemptAt:-Infinity,lastAttemptFrame:null};
   used.add(entry);
   const key=keyOf(candidate),matching=requests.filter(request=>request?.key===key&&request.direction===candidate.direction&&near(request,candidate)&&Number.isFinite(request.minCapturedAt)&&request.minCapturedAt<=frame.capturedAt);
   const minCapturedAt=Math.max(entry.firstSeenAt,entry.meta?.minCapturedAt??-Infinity,...matching.map(request=>request.minCapturedAt));
   entry.candidate={...candidate,box:{...candidate.box}};entry.requested=matching.length>0;
   entry.meta={...scope,capturedAt:frame.capturedAt,frameId:frame.frameId,key,appearanceKey:key,direction:candidate.direction,x:candidate.x,y:candidate.y,box:{...candidate.box},quality:candidate.numberHintQuality??candidate.quality,minCapturedAt,needsHintRead:candidate.needsHintRead};
   return entry;
  });
  lastFrame={capturedAt:frame.capturedAt,frameId:frame.frameId};
  const sorted=[...visible].sort((a,b)=>b.candidate.x-a.candidate.x);
  const rightmost=sorted[0]&&!sorted.slice(1).some(entry=>Math.abs(entry.candidate.x-sorted[0].candidate.x)<=tolerance)?sorted[0]:null;
  displayEntry=frame.display?visible.find(entry=>sameCandidate(entry.candidate,frame.display))??null:null;
  const baseline=new Set(sorted.slice(0,Math.max(0,maxBaselineCandidates)));
  if(rightmost)baseline.add(rightmost);if(displayEntry)baseline.add(displayEntry);
  const eligible=[];
  for(const entry of visible){
   if(!entry.requested&&!baseline.has(entry))continue;
   // This also advances the evidence floor while the worker is busy, so an
   // obsolete callback cannot populate a later same-pixels episode.
   const fresh=needsRead(entry.meta)===true;
   if(!fresh&&(entry!==rightmost&&entry!==displayEntry||entry.number!==null||entry.attempts>=maxDisplayAttempts))continue;
   if(!fresh&&entry.requested&&entry!==rightmost&&entry!==displayEntry)continue;
   if(now()<entry.retryAt||frame.capturedAt<=entry.lastAttemptAt||frame.frameId===entry.lastAttemptFrame)continue;
   const priority=entry.requested&&fresh?0:entry===rightmost||entry===displayEntry?1:2;
   eligible.push({entry,fresh,priority});
  }
  if(active||frame.capturedAt<=finishedThrough)return null;
  eligible.sort((a,b)=>a.priority-b.priority||a.entry.lastServed-b.entry.lastServed||a.entry.firstSeenAt-b.entry.firstSeenAt||b.entry.candidate.x-a.entry.candidate.x);
  const selected=eligible[0];if(!selected)return null;
  const {entry,fresh,priority}=selected;
  entry.attempts++;entry.lastServed=++served;entry.lastAttemptAt=frame.capturedAt;entry.lastAttemptFrame=frame.frameId;entry.status='reading';
  const candidate=Object.freeze({...entry.candidate,box:Object.freeze({...entry.candidate.box})});
  const meta=Object.freeze({...entry.meta,box:Object.freeze({...entry.meta.box})});
  active=Object.freeze({id:++nextJob,generation,episode:entry.episode,candidate,meta,fresh,reason:priority===0?'REPLACEMENT_VERIFY':priority===1?'LATEST_LABEL':'NEARBY_BASELINE'});
  return active;
 }
 function complete(task,result){
  if(!release(task))return {accepted:false,display:false};
  const entry=current(task);if(!entry)return {accepted:false,display:false};
  // The OCR engine owns its display-number validation. Only proof retry needs
  // the stronger two-pass evidence; annotation itself never authorizes input.
  const number=typeof result?.number==='string'&&/^(0[1-9]|[1-9][0-9])$/.test(result.number)?result.number:null,strong=task.fresh&&result?.fresh===true&&result.cached!==true&&!!number&&verifiedLabelNumber(result.first,result.second,85)===number;
  entry.number=number;entry.status=entry.number?'read':'unreadable';entry.retryAt=strong?0:now()+backoffMs;
  return {accepted:true,display:entry===displayEntry,number:entry.number,status:entry.status};
 }
 function fail(task){
  if(!release(task))return {accepted:false,display:false};
  const entry=current(task);if(!entry)return {accepted:false,display:false};
  // A worker/snapshot exception is not a completed numerical read. Preserve
  // retry backoff without exhausting the display-only consensus budget.
  entry.attempts=Math.max(0,entry.attempts-1);entry.status='unreadable';entry.retryAt=now()+backoffMs;
  return {accepted:true,display:entry===displayEntry};
 }
 function read(candidate){
  const matches=visible.filter(entry=>sameCandidate(entry.candidate,candidate));
  const entry=matches.length===1?matches[0]:null;
  return entry?{number:entry.number,status:entry.status,attempts:entry.attempts,episode:entry.episode,firstSeenAt:entry.firstSeenAt}:{number:null,status:'waiting',attempts:0,episode:null,firstSeenAt:null};
 }
 return {reset,pick,complete,fail,read,snapshot:()=>({generation,context:binding?.context??null,geometry:binding?.geometry??null,proofGeneration:binding?.proofGeneration??null,busy:!!active,activeId:active?.id??null,visible:visible.length})};
}
