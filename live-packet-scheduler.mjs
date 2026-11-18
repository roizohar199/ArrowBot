// A bounded, deterministic availability queue for a source whose Unix clock
// may lead the receiver's. It never advances the receiver clock or alters a
// packet's original receipt time. Store validation remains strict at intake.
const finite=Number.isFinite,copy=value=>structuredClone(value);
const canonical=packet=>JSON.stringify({kind:packet.kind,runId:packet.runId,sequence:packet.sequence,sourceEmittedAt:packet.sourceEmittedAt,
  metadata:Object.fromEntries(['instrument','timeframe','timeframeMs','tickSize','pointValue','chartType','sourceId','tabId'].map(key=>[key,packet.metadata?.[key]])),bars:packet.bars});
function boundary(packet){
  if(!Array.isArray(packet.bars))return null;
  let latest=0;
  for(const bar of packet.bars){
    if(!bar||!Number.isSafeInteger(bar.time)||bar.time<0||typeof bar.closed!=='boolean'||bar.closed&&(!Number.isSafeInteger(bar.closeTime)||bar.closeTime<bar.time))return null;
    latest=Math.max(latest,bar.time,bar.closed?bar.closeTime:bar.time);
  }
  return latest;
}
export function createLivePacketScheduler({maxDeferralMs=3000,maxPending=256,maxQueuedAgeMs=8000,now=Date.now}={}){
  if(!finite(maxDeferralMs)||maxDeferralMs<0||maxDeferralMs>5000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>1024||!finite(maxQueuedAgeMs)||maxQueuedAgeMs<maxDeferralMs||maxQueuedAgeMs>60000||typeof now!=='function')throw TypeError('INVALID_PACKET_SCHEDULER_CONFIGURATION');
  let queue=[],runId=null,highestSequence=0,requiresSnapshot=true,lastClock=null,generation=0,lastReason='INITIAL',fingerprints=new Map();
  const state=()=>({generation,runId,pending:queue.length,highestSequence,requiresSnapshot,lastReason,nextEligibleAt:queue[0]?.notBefore??null});
  function clear(reason='RESET',nextRun=null){queue=[];runId=nextRun;highestSequence=0;requiresSnapshot=true;lastClock=null;fingerprints.clear();generation++;lastReason=reason;return state();}
  function block(reason){queue=[];requiresSnapshot=true;lastReason=reason;return {...state(),accepted:false,queued:false,reasonCodes:[reason]};}
  function clock(at){if(!finite(at)||at<0)return 'INVALID_RECEIVER_CLOCK';if(lastClock!==null&&at<lastClock)return 'RECEIVER_CLOCK_WENT_BACKWARD';lastClock=at;return null;}
  function enqueue(packet){
    const at=now(),clockError=clock(at);if(clockError)return block(clockError);
    if(!packet||!['snapshot','update','blocked'].includes(packet.kind)||typeof packet.runId!=='string'||!packet.runId||packet.runId.length>400||!Number.isSafeInteger(packet.sequence)||packet.sequence<1||!Number.isSafeInteger(packet.receivedAt)||packet.receivedAt<0)return block('INVALID_SCHEDULED_PACKET');
    if(packet.receivedAt>at)return block('RECEIPT_IN_FUTURE');
    const latestBoundary=boundary(packet);if(latestBoundary===null)return block('INVALID_SCHEDULED_BAR_TIME');
    if(runId!==packet.runId){clear('SOURCE_RUN_CHANGED',packet.runId);lastClock=at;}
    const fingerprint=canonical(packet),previous=fingerprints.get(packet.sequence);
    if(previous!==undefined){if(previous!==fingerprint)return block('CONFLICTING_SOURCE_SEQUENCE');return {...state(),accepted:false,queued:false,reasonCodes:['DUPLICATE_SOURCE_SEQUENCE']};}
    if(packet.sequence<=highestSequence)return {...state(),accepted:false,queued:false,reasonCodes:['OLD_SOURCE_SEQUENCE']};
    if(requiresSnapshot&&packet.kind!=='snapshot')return {...state(),accepted:false,queued:false,reasonCodes:['SCHEDULER_SNAPSHOT_REQUIRED']};
    const notBefore=Math.max(packet.receivedAt,latestBoundary),futureMs=notBefore-packet.receivedAt;
    if(futureMs>maxDeferralMs)return block('SOURCE_FUTURE_BOUND_EXCEEDED');
    if(queue.length>=maxPending)return block('DEFERRAL_QUEUE_LIMIT');
    queue.push({packet:copy(packet),receivedAt:packet.receivedAt,notBefore,futureMs});highestSequence=packet.sequence;fingerprints.set(packet.sequence,fingerprint);
    while(fingerprints.size>maxPending*2)fingerprints.delete(fingerprints.keys().next().value);
    requiresSnapshot=false;lastReason=futureMs>0?'SOURCE_BOUNDARY_DEFERRED':'PACKET_SCHEDULED';
    return {...state(),accepted:true,queued:true,deferred:futureMs>0,notBefore,futureMs,reasonCodes:futureMs>0?['SOURCE_BOUNDARY_DEFERRED']:[]};
  }
  function drain(at=now()){
    const clockError=clock(at);if(clockError){const result=block(clockError);return {...result,ready:[]};}
    if(queue.some(item=>at-item.receivedAt>maxQueuedAgeMs)){const result=block('DEFERRAL_QUEUE_EXPIRED');return {...result,ready:[]};}
    const ready=[];
    while(queue.length&&queue[0].notBefore<=at){const item=queue.shift();ready.push({...copy(item),intakeAt:at,heldMs:at-item.receivedAt,clockAdjusted:false});}
    return {...state(),ready,reasonCodes:[]};
  }
  return {enqueue,drain,snapshot:state,reset:clear};
}
