import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';

// Visual observations in image pixels, not exchange ticks or complete OHLC bars.
// A stable historical shape is required even when independent motion is given.
const finite=Number.isFinite;
const coordinates=['x','bodyTop','bodyBottom','highY','lowY','openY','closeY','bodyWidth'];
const vertical=['highY','lowY','openY','closeY'];
function validCandle(c){
 return c&&coordinates.every(k=>finite(c[k]))&&c.bodyWidth>0&&['UP','DOWN'].includes(c.direction)&&
  c.highY<=Math.min(c.openY,c.closeY)&&Math.max(c.openY,c.closeY)<=c.lowY&&c.bodyTop<=c.bodyBottom;
}
function shapeMatches(a,b,dx,dy,tolerance){
 return a.direction===b.direction&&Math.abs(a.x+dx-b.x)<=tolerance&&Math.abs(a.bodyWidth-b.bodyWidth)<=tolerance&&
  vertical.every(k=>Math.abs(a[k]+dy-b[k])<=tolerance);
}
const own=(a,b,tolerance)=>Math.abs(a.x-b.x)<=tolerance&&Math.abs(a.openY-b.openY)<=tolerance&&Math.abs(a.bodyWidth-b.bodyWidth)<=tolerance;
const emptyMetrics=()=>({deltaPx:0,velocityPxPerSecond:0,netPx:0,highPx:0,lowPx:0,rangePx:0,pathPx:0,reversals:0,updates:0,durationMs:0});

function anchorMotion(old,next,supplied,{tolerance,maxShift,previousHistoricalOnly=false,currentHistoricalOnly=false}){
 const a=(previousHistoricalOnly?old:old.slice(0,-1)).filter(c=>!c.clipped).slice(-24),b=(currentHistoricalOnly?next:next.slice(0,-1)).filter(c=>!c.clipped).slice(-24);
 const validMotion=m=>m&&finite(m.x)&&finite(m.y)&&Math.abs(m.x)<=maxShift&&Math.abs(m.y)<=maxShift;
 function score(dx,dy){
  const matches=[];let last=-1;
  for(const previous of a){
   let selected=-1;
   for(let j=last+1;j<b.length;j++)if(shapeMatches(previous,b[j],dx,dy,tolerance)){if(selected!==-1)return null;selected=j;}
   if(selected!==-1){matches.push(previous);last=selected;}
  }
  if(matches.length<2||matches.at(-1).x-matches[0].x<Math.max(8,matches[0].bodyWidth*2))return null;
  return {x:dx,y:dy,anchors:matches.length,source:supplied?'VERIFIED_CHART':'HISTORICAL_CANDLES'};
 }
 if(supplied!==null&&supplied!==undefined)return validMotion(supplied)?score(supplied.x,supplied.y):null;
 if(a.length<3||b.length<3)return null;
 const candidates=new Map();
 for(const previous of a)for(const current of b){
  const dx=current.x-previous.x,dy=current.openY-previous.openY;
  if(!validMotion({x:dx,y:dy})||!shapeMatches(previous,current,dx,dy,tolerance))continue;
  // Integer canvas features normally produce integer shifts; quantization only
  // deduplicates equivalent candidates and never changes the scored displacement.
  const key=Math.round(dx*2)+':'+Math.round(dy*2);
  if(!candidates.has(key))candidates.set(key,{x:dx,y:dy});
 }
 if(candidates.size>128)return null;
 const ranked=[];
 for(const candidate of candidates.values()){
  const result=score(candidate.x,candidate.y);
  if(result)ranked.push(result);
 }
 ranked.sort((x,y)=>y.anchors-x.anchors);
 const best=ranked[0];
 if(!best||best.anchors<3)return null;
 // Require nearly all available historical bars, not a coincidental local match.
 if(best.anchors<Math.ceil(Math.min(a.length,b.length)*.7))return null;
 if(ranked.some(other=>other!==best&&other.anchors>=best.anchors-1&&
  (Math.abs(other.x-best.x)>tolerance||Math.abs(other.y-best.y)>tolerance)))return null;
 return best;
}

export function createCandleReader({maxGapMs=MAX_CAPTURE_GAP_MS,maxShift=16,tolerance=.75,maxSamples=120,maxHistory=32,movementThreshold=.5}={}){
 maxSamples=Math.max(2,Math.min(600,Math.floor(maxSamples)||120));
 maxHistory=Math.max(1,Math.min(128,Math.floor(maxHistory)||32));
 let previous=null,observation=null,pending=null,barrier=null,serial=0,history=[],completed=0,observedUpdates=0,resets=0,ignoredHistorical=0,ignoredHistoricalGroups=0;
 const clearHistory=()=>{history=[];completed=0;observedUpdates=0;};
 function reset(){previous=null;observation=null;pending=null;barrier=null;serial=0;clearHistory();resets=0;ignoredHistorical=0;ignoredHistoricalGroups=0;}
 function view(status,reason,candles=[],motion=null){
  return {status,reason,active:observation&&candles.length?{...candles.at(-1),observedId:observation.id,firstObservedAt:observation.startedAt}:null,
   candles:candles.map(c=>({...c})),motion:motion?{...motion}:null,
   metrics:observation?{...observation.metrics}:emptyMetrics(),samples:observation?observation.samples.map(s=>({...s})):[],
   history:history.map(h=>({...h})),stats:{completed,observedUpdates,resets},ignoredHistorical,ignoredHistoricalGroups};
 }
 function unavailable(reason,candles=[]){previous=null;observation=null;pending=null;barrier=null;clearHistory();resets++;return view('UNAVAILABLE',reason,candles);}
 function begin(frame,reason,oldSummary=null){
  previous=frame;barrier=null;observation={id:++serial,startedAt:frame.capturedAt,lastSign:0,metrics:emptyMetrics(),samples:[{atMs:0,valuePx:0}]};
  pending=oldSummary;resets++;return view('BASELINE',reason,frame.candles);
 }
 function lost(frame,target,reason='LATEST_DISAPPEARED'){
  barrier={x:target.x,openY:target.openY,bodyWidth:target.bodyWidth};previous=frame;observation=null;pending=null;
  clearHistory();resets++;return view('UNAVAILABLE',reason,frame.candles);
 }
 function obscured(reason,candles,meta){
  if(previous&&meta.context===previous.context&&meta.geometry===previous.geometry&&meta.capturedAt>previous.capturedAt){
   let target=barrier??previous.candles.at(-1);
   if(['LATEST_CLIPPED','AMBIGUOUS_CANDLES'].includes(reason)&&candles.at(-1).x>target.x)target=candles.at(-1);
   // Keep only the last trusted historical anchors. A blank or failed detector
   // must not erase the loss barrier and permit an older closed bar on retry.
   previous={...previous,candles:previous.candles.filter(c=>c.x<target.x-tolerance)};
   barrier={x:target.x,openY:target.openY,bodyWidth:target.bodyWidth};observation=null;pending=null;clearHistory();resets++;
   return view('UNAVAILABLE',reason,candles);
  }
  return unavailable(reason,candles);
 }
 function summary(at){return {observedId:observation.id,startedAt:observation.startedAt,endedAt:at,...observation.metrics};}
 return {reset,
  inspect(detection,{context,geometry,capturedAt,motion=null}={}){
   ignoredHistorical=0;ignoredHistoricalGroups=0;
   if(typeof context!=='string'||!context||typeof geometry!=='string'||!geometry||!finite(capturedAt))return unavailable('INVALID_CONTEXT');
   if(!Array.isArray(detection?.candles)||detection.candles.length>512||detection.candles.some(c=>!validCandle(c)))return obscured('INVALID_DETECTION',[],{context,geometry,capturedAt});
   const raw=detection.candles.map(c=>({...c})).sort((a,b)=>a.x-b.x);
   if(!raw.length){
    const failure=detection.diagnostics?.reason;
    return obscured(['INVALID_IMAGE','INVALID_PALETTE','EMPTY_REGION','PIXEL_BUDGET','COMPONENT_BUDGET','CANDLE_BUDGET'].includes(failure)?failure:'NO_CANDLES',raw,{context,geometry,capturedAt});
   }
   // Occluding labels or a separate volume pane can split an old candle into
   // several bodies at one x. Exclude the entire historical group from temporal
   // evidence; never combine fragments or manufacture a larger candle range.
   const candles=[];
   for(let start=0;start<raw.length;){
    let end=start+1;
    while(end<raw.length&&raw[end].x-raw[end-1].x<=tolerance)end++;
    if(end-start>1){
     if(end===raw.length)return obscured('AMBIGUOUS_CANDLES',raw,{context,geometry,capturedAt});
     ignoredHistorical+=end-start;ignoredHistoricalGroups++;
    }else candles.push(raw[start]);
    start=end;
   }
   if(candles.at(-1).clipped)return obscured('LATEST_CLIPPED',candles,{context,geometry,capturedAt});
   const region=detection.region;
   const regionKey=region?JSON.stringify([region.x,region.y,region.width,region.height]):'';
   const frame={candles,context,geometry,capturedAt,regionKey};
   if(!previous)return begin(frame,'BASELINE');
   if(capturedAt<=previous.capturedAt)return unavailable('OUT_OF_ORDER_FRAME',candles);
   if(context!==previous.context){clearHistory();return begin(frame,'CONTEXT_CHANGED');}
   if(geometry!==previous.geometry||regionKey!==previous.regionKey){clearHistory();return begin(frame,'GEOMETRY_CHANGED');}
   if(barrier){
    // Every visible bar during a loss may be historical. Keep the expected live
    // location through corroborated panning; never promote a closed bar merely
    // because an occlusion lasts several frames.
    const shift=anchorMotion(previous.candles,candles,motion,{tolerance,maxShift,previousHistoricalOnly:true,currentHistoricalOnly:true});
    if(shift){barrier.x+=shift.x;barrier.openY+=shift.y;}
    const latest=candles.at(-1);
    if(shift&&latest.x>=barrier.x-tolerance)return begin(frame,'CANDLE_RECOVERED');
    previous=frame;return view('UNAVAILABLE','LATEST_DISAPPEARED',candles,shift);
   }
   if(capturedAt-previous.capturedAt>maxGapMs){clearHistory();return begin(frame,'CAPTURE_GAP');}
   const shift=anchorMotion(previous.candles,candles,motion,{tolerance,maxShift})??
    anchorMotion(previous.candles,candles,motion,{tolerance,maxShift,currentHistoricalOnly:true});
   if(!shift){
    clearHistory();
    if(candles.at(-1).x<previous.candles.at(-1).x-tolerance)return lost(frame,previous.candles.at(-1));
    return begin(frame,'UNVERIFIED_MOTION');
   }
   const old=previous.candles.at(-1),latest=candles.at(-1),predicted={...old,x:old.x+shift.x,openY:old.openY+shift.y};
   if(!own(predicted,latest,tolerance)){
    const beforeLatest=candles.at(-2);
    const becameHistorical=beforeLatest&&own(predicted,beforeLatest,tolerance);
    const rightward=latest.x>predicted.x+Math.max(2,old.bodyWidth*.75);
    if(becameHistorical&&rightward&&!pending)return begin(frame,'NEW_CANDLE_PENDING',summary(previous.capturedAt));
    if(latest.x<predicted.x-tolerance)return lost(frame,predicted);
    clearHistory();return begin(frame,'CANDLE_IDENTITY_CHANGED');
   }
   let reason='CONTINUOUS';
   if(pending){history.push(pending);if(history.length>maxHistory)history.shift();completed++;pending=null;reason='NEW_CANDLE_CONFIRMED';}
   const delta=old.closeY+shift.y-latest.closeY,elapsed=capturedAt-previous.capturedAt,m=observation.metrics;
   m.deltaPx=delta;m.velocityPxPerSecond=delta*1000/elapsed;m.netPx+=delta;
   m.highPx=Math.max(m.highPx,m.netPx);m.lowPx=Math.min(m.lowPx,m.netPx);m.rangePx=m.highPx-m.lowPx;
   m.pathPx+=Math.abs(delta);m.durationMs=capturedAt-observation.startedAt;m.updates++;observedUpdates++;
   if(Math.abs(delta)>=movementThreshold){const sign=Math.sign(delta);if(observation.lastSign&&sign!==observation.lastSign)m.reversals++;observation.lastSign=sign;}
   observation.samples.push({atMs:m.durationMs,valuePx:m.netPx});
   if(observation.samples.length>maxSamples)observation.samples.shift();
   previous=frame;return view('TRACKING',reason,candles,shift);
  },
 };
}
