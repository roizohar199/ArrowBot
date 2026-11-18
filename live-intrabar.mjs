// A bounded trace of observed source updates, never an invented tick history.
export function createLiveIntrabar({maxPoints=160}={}){
  if(!Number.isSafeInteger(maxPoints)||maxPoints<2||maxPoints>5000)throw TypeError('INVALID_INTRABAR_LIMIT');
  let run=null,time=null,points=[],missingSequences=0,lastSequence=null,totalUpdates=0;
  function reset(){run=null;time=null;points=[];missingSequences=0;lastSequence=null;totalUpdates=0;}
  function advanceSequence(sequence){
    if(lastSequence!==null&&sequence<=lastSequence)return false;
    if(lastSequence!==null)missingSequences+=Math.max(0,sequence-lastSequence-1);
    lastSequence=sequence;return true;
  }
  function ingest(packet){
    if(typeof packet?.runId!=='string'||!Number.isSafeInteger(packet.sequence)||packet.sequence<1)return false;
    // The connection backlog has no live trace baseline. Higher-timeframe and
    // historical rows cannot establish one or replace an already observed run.
    if(['timeframe_snapshot','timeframe_update'].includes(packet.kind)){
      if(packet.runId===run&&lastSequence!==null)advanceSequence(packet.sequence);
      return false;
    }
    if(!['snapshot','update'].includes(packet.kind)||!Array.isArray(packet.bars))return false;
    const b=packet.bars.at(-1);
    if(!b||typeof b.closed!=='boolean'||![b.open,b.high,b.low,b.close,b.time,packet.sourceEmittedAt].every(Number.isFinite)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low)return false;
    if(packet.kind==='snapshot'||b.closed){
      // Once live observation has begun, legitimate same-run nonpoint packets
      // still consume global sequence numbers. Before then they are warm-up.
      if(packet.runId===run&&lastSequence!==null)advanceSequence(packet.sequence);
      return false;
    }
    if(packet.runId===run&&(packet.sequence<=lastSequence||b.time<time))return false;
    const previous=packet.runId===run&&b.time===time?points.at(-1):null,dt=previous?packet.sourceEmittedAt-previous.sourceEmittedAt:null;
    if(dt!==null&&dt<0)return false;
    if(packet.runId!==run){reset();run=packet.runId;}
    advanceSequence(packet.sequence);
    if(b.time!==time){time=b.time;points=[];totalUpdates=0;}
    points.push({sequence:packet.sequence,sourceEmittedAt:packet.sourceEmittedAt,receivedAt:packet.receivedAt??null,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??null,delta:previous?b.close-previous.close:0,observedSpeedPerSecond:dt>0?(b.close-previous.close)*1000/dt:null});
    totalUpdates++;if(points.length>maxPoints)points.shift();return true;
  }
  function snapshot(){
    let reversals=0,lastSign=0;for(const p of points){const sign=Math.sign(p.delta);if(sign&&lastSign&&sign!==lastSign)reversals++;if(sign)lastSign=sign;}
    return {runId:run,barTime:time,totalUpdates,retainedPoints:points.length,missingSequences,reversals,latest:points.at(-1)?{...points.at(-1)}:null,points:points.map(p=>({...p})),completeTickHistory:false,scope:'Observed Pine OHLC updates only; source executions, DOM rows or polls can be coalesced. OHLC alone cannot reveal the order of unobserved movements.'};
  }
  return {reset,ingest,snapshot};
}
