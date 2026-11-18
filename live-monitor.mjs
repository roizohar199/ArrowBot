// Experimental visual observations only; never authorizes trading.
import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';

const appearanceCache=new Map();
function rasterAppearance(key){
  if(appearanceCache.has(key))return appearanceCache.get(key);
  const match=/^(UP|DOWN):(\d+)x(\d+):([01]+)$/.exec(key);
  if(!match)return null;
  const [,direction,ws,hs,bits]=match,width=Number(ws),height=Number(hs);
  if(width<10||height<10||width>250||height>250)return null;
  const cropLeft=Math.floor(width*.13),cropTop=Math.floor(height*(direction==='UP'?.27:.09));
  const cropWidth=Math.ceil(width*.87)-cropLeft;
  const cropHeight=Math.ceil(height*(direction==='UP'?.83:.70))-cropTop;
  if(bits.length!==cropWidth*cropHeight)return null;
  let left=cropWidth,top=cropHeight,right=-1,bottom=-1,ink=0;
  for(let i=0;i<bits.length;i++)if(bits[i]==='1'){const x=i%cropWidth,y=Math.floor(i/cropWidth);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);ink++;}
  // A glyph touching the crop edge may be incomplete. It cannot establish a
  // zoom correspondence, even if its visible fragment resembles another key.
  if(ink<5||right-left<2||bottom-top<3||left<1||top<1||right>=cropWidth-1||bottom>=cropHeight-1)return null;
  const value={width,height,bits,cropLeft,cropTop,cropWidth,cropHeight,aspect:(right-left+1)/(bottom-top+1)};
  if(appearanceCache.size>=256)appearanceCache.delete(appearanceCache.keys().next().value);
  appearanceCache.set(key,value);return value;
}
function scaledAppearanceDistance(a,b){
  if(a.direction!==b.direction)return Infinity;
  const old=rasterAppearance(a.appearanceKey),next=rasterAppearance(b.appearanceKey);
  if(!old||!next||old.width===next.width&&old.height===next.height)return Infinity;
  const sx=next.width/old.width,sy=next.height/old.height;
  if(Math.min(sx,sy)<.5||Math.max(sx,sy)>2||Math.abs(sx-sy)>.07*Math.max(sx,sy)||Math.abs(old.aspect-next.aspect)>.18*Math.max(old.aspect,next.aspect))return Infinity;
  // Compare actual crop pixels after resampling the lower-resolution glyph
  // into the other label's coordinate system. No OCR or number-only identity
  // is used, and small raster alignment changes cannot alter ordinary matching.
  const small=old.width*old.height<next.width*next.height?old:next,large=small===old?next:old;
  let best=Infinity;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    let difference=0,union=0;
    for(let y=0;y<large.cropHeight;y++)for(let x=0;x<large.cropWidth;x++){
      const sx=Math.floor((x+large.cropLeft-dx)*small.width/large.width)-small.cropLeft;
      const sy=Math.floor((y+large.cropTop-dy)*small.height/large.height)-small.cropTop;
      const expected=sx>=0&&sy>=0&&sx<small.cropWidth&&sy<small.cropHeight&&small.bits[sy*small.cropWidth+sx]==='1';
      const actual=large.bits[y*large.cropWidth+x]==='1';
      union+=Number(expected||actual);difference+=Number(expected!==actual);
    }
    if(union)best=Math.min(best,difference/union);
  }
  return best;
}
function scaledAnchors(oldItems,newItems){
  // A resize must not turn hundreds of visible labels into an unbounded
  // all-pairs raster search. Spatially distributed representatives retain
  // the needed context; exact-key correspondence still considers every label.
  const representatives=items=>{
    if(items.length<=24)return items;
    const ordered=[...items].sort((a,b)=>a.x-b.x||a.y-b.y);
    return Array.from({length:24},(_,i)=>ordered[Math.round(i*(ordered.length-1)/23)]);
  };
  const old=representatives(oldItems),next=representatives(newItems);
  const distances=old.map(a=>next.map(b=>scaledAppearanceDistance(a,b)));
  const choose=values=>{
    let first=Infinity,second=Infinity,index=-1;
    for(let i=0;i<values.length;i++){const value=values[i];if(value<first){second=first;first=value;index=i;}else if(value<second)second=value;}
    return first<=.14&&second-first>=.08?index:-1;
  };
  const oldBest=distances.map(choose),newBest=next.map((_,i)=>choose(distances.map(row=>row[i])));
  return oldBest.flatMap((i,n)=>i>=0&&newBest[i]===n?[{old:old[n],next:next[i],normalized:true}]:[]);
}

// A layout rectangle alone cannot prove how candles moved. Require distinct
// label appearances which agree on one affine mapping before moving history.
export function estimateLayoutTransform(previous,current,{tolerance=4}={}){
  const keyed=list=>{
    const groups=new Map();
    for(const item of list){
      if(typeof item.appearanceKey!=='string'||!item.appearanceKey)continue;
      const key=item.direction+':'+item.appearanceKey;
      const group=groups.get(key)??[];group.push(item);groups.set(key,group);
    }
    return groups;
  };
  const a=keyed(previous),b=keyed(current),anchors=[];
  for(const [key,old] of a)if(old.length===1&&b.get(key)?.length===1)anchors.push({old:old[0],next:b.get(key)[0]});
  if(anchors.length<3){
    const usedOld=new Set(anchors.map(p=>p.old)),usedNew=new Set(anchors.map(p=>p.next));
    anchors.push(...scaledAnchors([...a.values()].filter(group=>group.length===1&&!usedOld.has(group[0])).map(group=>group[0]),[...b.values()].filter(group=>group.length===1&&!usedNew.has(group[0])).map(group=>group[0])));
  }
  if(anchors.length<3)return null;
  function fit(pairs){
   const normalized=pairs.filter(p=>p.normalized);
   if(normalized.length){
    const ratios=normalized.map(p=>{const old=rasterAppearance(p.old.appearanceKey),next=rasterAppearance(p.next.appearanceKey);return (next.width/old.width+next.height/old.height)/2;});
    if(Math.max(...ratios)-Math.min(...ratios)>.07*Math.max(...ratios))return null;
   }
   function axis(name){
    const values=pairs.map(p=>p.old[name]),span=Math.max(...values)-Math.min(...values);
    if(span<40)return null;
    const meanOld=values.reduce((x,y)=>x+y,0)/values.length;
    const meanNew=pairs.reduce((sum,p)=>sum+p.next[name],0)/pairs.length;
    let numerator=0,denominator=0;
    for(const p of pairs){const delta=p.old[name]-meanOld;numerator+=delta*(p.next[name]-meanNew);denominator+=delta*delta;}
    const scale=numerator/denominator,offset=meanNew-scale*meanOld;
    return Number.isFinite(scale)&&scale>=.5&&scale<=2?{scale,offset}:null;
   }
   const x=axis('x'),y=axis('y');
   return x&&y?{scaleX:x.scale,scaleY:y.scale,x:x.offset,y:y.offset}:null;
  }
  const agrees=(p,m)=>Math.abs(p.old.x*m.scaleX+m.x-p.next.x)<=tolerance&&Math.abs(p.old.y*m.scaleY+m.y-p.next.y)<=tolerance;
  const clean=fit(anchors);
  if(clean&&anchors.every(p=>agrees(p,clean)))return {...clean,anchors:anchors.length};
  if(anchors.length<4)return null;
  // Strictly more than half the unique appearances must agree. A fixed set
  // of spatial/order representatives bounds deterministic model generation.
  const minimum=Math.max(3,Math.floor(anchors.length/2)+1),seeds=[];
  const add=p=>{if(!seeds.includes(p)&&seeds.length<16)seeds.push(p);};
  for(const axis of ['x','y']){
    const ordered=[...anchors].sort((a,b)=>a.old[axis]-b.old[axis]);add(ordered[0]);add(ordered.at(-1));
  }
  for(let i=0;i<16;i++)add(anchors[Math.round(i*(anchors.length-1)/15)]);
  const models=[];
  for(let i=0;i<seeds.length;i++)for(let j=i+1;j<seeds.length;j++){
    const candidate=fit([seeds[i],seeds[j]]);if(!candidate)continue;
    let inliers=anchors.filter(p=>agrees(p,candidate));if(inliers.length<minimum)continue;
    let mapping=fit(inliers);if(!mapping)continue;
    inliers=anchors.filter(p=>agrees(p,mapping));if(inliers.length<minimum)continue;
    mapping=fit(inliers);if(!mapping||!inliers.every(p=>agrees(p,mapping)))continue;
    const outliers=anchors.filter(p=>!inliers.includes(p));
    models.push({mapping,inliers,outliers});
  }
  if(!models.length)return null;
  models.sort((a,b)=>b.inliers.length-a.inliers.length);
  const best=models[0];
  for(const model of models)if(anchors.some(p=>Math.abs(p.old.x*model.mapping.scaleX+model.mapping.x-(p.old.x*best.mapping.scaleX+best.mapping.x))>tolerance*2||Math.abs(p.old.y*model.mapping.scaleY+model.mapping.y-(p.old.y*best.mapping.scaleY+best.mapping.y))>tolerance*2))return null;
  // A normalized outlier has no exact pixel identity to keep quiet after
  // rebasing. Withhold this uncertain mapping rather than inventing a label.
  if(best.outliers.some(p=>p.old.appearanceKey!==p.next.appearanceKey))return null;
  const result={...best.mapping,anchors:best.inliers.length,outliers:best.outliers.length};
  // Internal correspondence is intentionally absent from logs/serialized
  // motion metadata, whose compact shape remains stable.
  Object.defineProperty(result,'outlierPairs',{value:best.outliers});
  return result;
}

export function createLiveMonitor({ tolerance = 4, memoryMs = 60000, maxGapMs = MAX_CAPTURE_GAP_MS, continuous = false } = {}) {
  let state = 'NEW', geometry = '', context = null, previousTime = null, tracks = [], nextId = 0, partial = false;
  const pause = reason => { state = 'PAUSED'; return { state, reason, events: [] }; };
  const near = (a, b) => Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
  const firstBoxOf = candidate => {
    const box=candidate?.box;
    return box&&['x','y','width','height'].every(k=>Number.isSafeInteger(box[k]))&&box.x>=0&&box.y>=0&&box.width>0&&box.height>0&&
      Math.abs(candidate.x-(box.x+box.width/2))<=2&&Math.abs(candidate.y-(box.y+box.height/2))<=2
      ? {x:box.x,y:box.y,width:box.width,height:box.height} : null;
  };
  function applyLayoutMapping(mapping){
    const outliers=new Map((mapping.outlierPairs??[]).map(pair=>[pair.old.id,pair.next]));
    tracks=tracks.map(track=>{
      const known=outliers.get(track.id);
      return {...track,x:known?known.x:track.x*mapping.scaleX+mapping.x,y:known?known.y:track.y*mapping.scaleY+mapping.y};
    });
  }
  // Numbers only corroborate a visual identity which the spatial matcher
  // already knows. Missing or rejected OCR never gates ordinary arrow events.
  function numberHintOf(candidate,frame){
    const hint=candidate.numberHint,key=candidate.appearanceKey;
    if(!hint||typeof key!=='string'||!key||!/^(0[1-9]|[1-9][0-9])$/.test(hint.number)||
      hint.key!==key||hint.appearanceKey!=null&&hint.appearanceKey!==key||
      !frame.context||hint.context!==frame.context||hint.geometry!==frame.geometry||
      hint.direction!=null&&hint.direction!==candidate.direction||hint.complete!==true||hint.fresh!==true||
      !Number.isFinite(hint.confidence)||hint.confidence<85||!Number.isSafeInteger(hint.proofGeneration)||hint.proofGeneration<0||
      !Number.isFinite(hint.firstCapturedAt)||!Number.isFinite(hint.confirmedAt)||hint.firstCapturedAt>=hint.confirmedAt||hint.confirmedAt>frame.capturedAt)return null;
    const ids=hint.frameIds;
    if(!Array.isArray(ids)||ids.length<2||ids.some(id=>!['number','string'].includes(typeof id)||typeof id==='number'&&!Number.isFinite(id))||
      ids[0]===ids.at(-1)||hint.firstFrameId!=null&&hint.firstFrameId!==ids[0]||hint.lastFrameId!=null&&hint.lastFrameId!==ids.at(-1))return null;
    if((hint.x!=null||hint.y!=null)&&(!Number.isFinite(hint.x)||!Number.isFinite(hint.y)||!near(hint,candidate)))return null;
    return {...hint,number:String(hint.number)};
  }
  const identityOf=hint=>hint?{number:hint.number,key:hint.key,proofGeneration:hint.proofGeneration,context:hint.context,geometry:hint.geometry}:null;
  const resetNumberState=(track,hint=null)=>({...track,numberIdentity:identityOf(hint),numberReplacement:null,numberPredecessors:[]});
  const eventOf=(track,item,now)=>({...item,signalId:track.signalId,firstX:track.firstX,firstY:track.firstY,lastAbsentAt:track.lastAbsentAt,firstSeenAt:track.firstSeenAt,confirmedAt:now,...(track.firstBox?{firstBox:{...track.firstBox}}:{})});
  function updateNumberIdentity(track,item,frame,{stationary,sourceCandidate,requests,events}){
    const now=frame.capturedAt,hint=item.numberHint;
    let next={...track,...item,lastSeen:now,confirmed:true};
    if(!stationary)return resetNumberState(next,hint);
    const identity=track.numberIdentity;
    if(!identity)return {...next,numberIdentity:identityOf(hint),numberReplacement:null,numberPredecessors:[]};
    // A proof reset ends the old comparison epoch. A later annotation can seed
    // the new epoch, but cannot retroactively turn its baseline into a signal.
    if(hint&&hint.proofGeneration!==identity.proofGeneration)return resetNumberState(next,hint);
    if(item.appearanceKey===identity.key)return {...next,numberReplacement:null};
    if(!item.appearanceKey)return {...next,numberReplacement:track.numberReplacement?{...track.numberReplacement,key:null,minCapturedAt:now,lastSeen:now,stableFrames:0}:null};
    const predecessors=(track.numberPredecessors??[]).filter(prior=>now-prior.retiredAt<=maxGapMs);
    const prior=predecessors.find(prior=>prior.numberIdentity.key===item.appearanceKey&&near(prior,item));
    if(prior){
      // A briefly occluded/repainted old label keeps its UUID. This bounded
      // local pixel history is deliberately unrelated to a number's value.
      const retired={...track,retiredAt:now,numberReplacement:null,numberPredecessors:undefined};
      return {...next,signalId:prior.signalId,firstX:prior.firstX,firstY:prior.firstY,firstSeenAt:prior.firstSeenAt,lastAbsentAt:prior.lastAbsentAt,firstBox:prior.firstBox,numberIdentity:prior.numberIdentity,numberReplacement:null,numberPredecessors:[retired,...predecessors.filter(value=>value!==prior)].slice(0,4)};
    }
    const previous=track.numberReplacement;
    const sameEpisode=previous?.key===item.appearanceKey;
    // A partially drawn label can change its raster before OCR can read it.
    // Restart proof collection for those new pixels, while keeping the start
    // of this uninterrupted non-baseline appearance for execution barriers.
    const pending=sameEpisode?{...previous,lastSeen:now,stableFrames:previous.stableFrames+1}:{key:item.appearanceKey,firstSeenAt:previous?.firstSeenAt??now,minCapturedAt:now,lastAbsentAt:previous?.lastAbsentAt??previousTime,firstX:previous?.firstX??item.x,firstY:previous?.firstY??item.y,firstBox:previous?previous.firstBox:firstBoxOf(sourceCandidate),lastSeen:now,stableFrames:1};
    next.numberPredecessors=predecessors;next.numberReplacement=pending;
    if(hint&&hint.number===identity.number){
      // Antialiasing can change the pixels of the very same printed number.
      return {...next,numberIdentity:identityOf(hint),numberReplacement:null};
    }
    if(!hint||hint.firstCapturedAt<pending.minCapturedAt){
      requests.push({x:item.x,y:item.y,direction:item.direction,key:item.appearanceKey,minCapturedAt:pending.minCapturedAt,reason:'REPLACEMENT_VERIFY'});
      return next;
    }
    if(pending.stableFrames<2)return next;
    const replacement={...next,id:nextId++,signalId:crypto.randomUUID(),firstX:pending.firstX,firstY:pending.firstY,firstSeenAt:pending.firstSeenAt,lastAbsentAt:pending.lastAbsentAt,firstBox:pending.firstBox,numberIdentity:identityOf(hint),numberReplacement:null,numberPredecessors:[{...track,retiredAt:now,numberReplacement:null,numberPredecessors:undefined},...predecessors].slice(0,4)};
    events.push(eventOf(replacement,item,now));
    return replacement;
  }
  function assignment(items, shift) {
    const used = new Set(), pairs = new Map();
    // Build all possible matches before choosing one: greedy matching can
    // silently assign a single observation to the wrong historical arrow.
    const cell=Math.max(1,tolerance),buckets=new Map();
    if(continuous)for(let i=0;i<items.length;i++){
      const item=items[i],key=`${item.direction}:${Math.floor(item.x/cell)},${Math.floor(item.y/cell)}`;
      const bucket=buckets.get(key)??[];bucket.push(i);buckets.set(key,bucket);
    }
    const possible = tracks.map(track => {
      const predicted = { x: track.x + shift.x, y: track.y + shift.y };
      if(continuous){
        const result=[],bx=Math.floor(predicted.x/cell),by=Math.floor(predicted.y/cell);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const i of buckets.get(`${track.direction}:${bx+dx},${by+dy}`)??[])if(near(predicted,items[i]))result.push(i);
        return result;
      }
      return items.map((item, i) => ({ item, i })).filter(({ item }) =>
        item.direction === track.direction && near(predicted, item)).map(({ i }) => i);
    });
    const ambiguous = possible.some(options => options.length > 1) ||
      items.some((_, i) => possible.filter(options => options.includes(i)).length > 1);
    const ambiguousItems=new Set();
    if(continuous){
      const references=new Map();for(const options of possible)for(const i of options)references.set(i,(references.get(i)??0)+1);
      for(const options of possible)if(options.length>1)for(const i of options)ambiguousItems.add(i);
      for(const [i,count] of references)if(count>1)ambiguousItems.add(i);
    }
    if (!ambiguous||continuous) for (let n=0; n<tracks.length; n++) if (possible[n].length===1) {
      const i=possible[n][0];if(ambiguousItems.has(i))continue;used.add(i);pairs.set(tracks[n].id,i);
    }
    return { pairs, used, ambiguous, ambiguousItems };
  }
  function estimateShift(items, now) {
    const recent = tracks.filter(t => now - t.lastSeen <= maxGapMs && t.confirmed);
    const bins = new Map();
    for (const a of recent) for (const b of items) {
      const x = b.x - a.x, y = b.y - a.y;
      if (a.direction !== b.direction || Math.abs(x) > 50 || Math.abs(y) > 50) continue;
      const key = `${Math.round(x / 3)},${Math.round(y / 3)}`;
      const bin = bins.get(key) ?? { x, y, count: 0 }; bin.count++; bins.set(key, bin);
    }
    const options = [{ x: 0, y: 0 }, ...[...bins.values()].sort((a,b) => b.count - a.count).slice(0, 12)];
    const scores = options.map(shift => ({ shift, matched: assignment(items, shift).pairs.size }));
    scores.sort((a,b) => b.matched - a.matched || (Math.abs(a.shift.x)+Math.abs(a.shift.y))-(Math.abs(b.shift.x)+Math.abs(b.shift.y)));
    const best = scores[0];
    if (Math.abs(best.shift.x) > tolerance || Math.abs(best.shift.y) > tolerance) {
      if (best.matched < 2) return { x: 0, y: 0 };
      if (scores.some(s => s.matched === best.matched && (Math.abs(s.shift.x-best.shift.x) > tolerance*2 || Math.abs(s.shift.y-best.shift.y) > tolerance*2))) return null;
    }
    // Small shifts already fall within matching tolerance; do not use a
    // speculative shift to break a tie between competing identities.
    return Math.abs(best.shift.x) <= tolerance && Math.abs(best.shift.y) <= tolerance ? { x: 0, y: 0 } : best.shift;
  }
  function silentBaseline(frame,items,{preserveHistory=false,shift={x:0,y:0},cause}={}){
    const old=tracks,matched=preserveHistory?assignment(items,shift):{pairs:new Map(),used:new Set()};
    const byItem=new Map([...matched.pairs].map(([id,i])=>[i,old.find(track=>track.id===id)]));
    const visible=items.map((item,i)=>{
      const prior=byItem.get(i);
      return resetNumberState({...(prior?.confirmed?prior:{id:nextId++,signalId:crypto.randomUUID()}),...item,lastSeen:frame.capturedAt,confirmed:true},item.numberHint);
    });
    const absent=preserveHistory?old.filter(track=>track.confirmed&&!matched.pairs.has(track.id)).map(track=>resetNumberState({...track,x:track.x+shift.x,y:track.y+shift.y})):[];
    tracks=[...visible,...absent];
    if(tracks.length>2000)tracks=visible;
    state='MONITORING';geometry=frame.geometry;context=typeof frame.context==='string'&&frame.context?frame.context:null;previousTime=frame.capturedAt;partial=false;
    return {state,reason:'BASELINE',events:[],missing:0,expired:0,motion:{...shift},...(cause?{baselineReason:cause}:{})};
  }
  return {
    annotateNumberHint(candidate){
      if(!continuous||state!=='MONITORING'||previousTime===null||!candidate)return false;
      const hint=numberHintOf(candidate,{capturedAt:previousTime,context,geometry});
      if(!hint)return false;
      const matches=tracks.filter(track=>track.confirmed&&track.lastSeen===previousTime&&track.direction===candidate.direction&&track.appearanceKey===candidate.appearanceKey&&track.x===candidate.x&&track.y===candidate.y);
      if(matches.length!==1||matches[0].numberIdentity||matches[0].numberReplacement)return false;
      matches[0].numberIdentity=identityOf(hint);
      return true;
    },
    observe(frame) {
      if (state === 'PAUSED') return { state, reason: 'RESTART_REQUIRED', events: [] };
      if (!frame || !Number.isFinite(frame.capturedAt) || typeof frame.geometry !== 'string' || !frame.geometry || !Array.isArray(frame.candidates) || !continuous&&frame.candidates.length > 300 || frame.candidates.some(c => !c || !['UP','DOWN'].includes(c.direction) || !Number.isFinite(c.x) || !Number.isFinite(c.y))) {
        if(continuous){tracks=tracks.map(track=>resetNumberState(track));return {state,reason:'INVALID_FRAME',events:[]};}
        return pause('INVALID_FRAME');
      }
      const now = frame.capturedAt, items = frame.candidates.map(candidate => {
        const {x,y,direction,appearanceKey}=candidate;
        return {x,y,direction,...(continuous?{appearanceKey:typeof appearanceKey==='string'&&appearanceKey?appearanceKey:null,numberHint:numberHintOf(candidate,frame)}:{})};
      });
      const collisions=new Set();
      for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(near(items[i],items[j])){collisions.add(i);collisions.add(j);}
      if (collisions.size&&!continuous) return pause('AMBIGUOUS_CANDIDATES');
      if (state === 'NEW') {
        if(continuous)return silentBaseline(frame,items);
        geometry = frame.geometry; context=typeof frame.context==='string'&&frame.context?frame.context:null; previousTime = now; state = 'MONITORING';
        tracks = items.map(item => ({ ...item, id: nextId++, signalId: crypto.randomUUID(), lastSeen: now, confirmed: true }));
        return { state, reason: 'BASELINE', events: [] };
      }
      if (now <= previousTime) return continuous?{state,reason:'DUPLICATE_FRAME',events:[]}:pause('CAPTURE_GAP');
      const nextContext=typeof frame.context==='string'&&frame.context?frame.context:null;
      if(context&&nextContext&&context!==nextContext)return continuous?silentBaseline(frame,items,{cause:'CONTEXT_CHANGED'}):pause('CONTEXT_CHANGED');
      let rebase=null,stationaryAnchors=false;
      if(frame.geometry!==geometry){
        if(!continuous)return pause('GEOMETRY_CHANGED');
        if(context&&nextContext===context&&now-previousTime<=maxGapMs){
          rebase=estimateLayoutTransform(tracks.filter(t=>t.confirmed&&t.lastSeen===previousTime),items,{tolerance});
        }
        if(!rebase)return silentBaseline(frame,items,{cause:'GEOMETRY_CHANGED'});
        applyLayoutMapping(rebase);
        geometry=frame.geometry;
      }else if(continuous&&context&&context===nextContext&&frame.chartMotion==null&&now-previousTime<=maxGapMs){
        // Price-axis auto-fit can move/scale labels without changing the canvas
        // rectangle. Use the same anchor proof instead of inventing new UUIDs.
        const visible=tracks.filter(t=>t.confirmed&&t.lastSeen===previousTime);
        const mapping=estimateLayoutTransform(visible,items,{tolerance});
        stationaryAnchors=!!mapping&&!mapping.outliers&&Math.abs(mapping.scaleX-1)<=.002&&Math.abs(mapping.scaleY-1)<=.002&&Math.abs(mapping.x)<=.5&&Math.abs(mapping.y)<=.5;
        if(mapping&&visible.some(track=>Math.abs(track.x*mapping.scaleX+mapping.x-track.x)>tolerance||Math.abs(track.y*mapping.scaleY+mapping.y-track.y)>tolerance)){
          rebase=mapping;
          applyLayoutMapping(rebase);
        }
      }
      if(nextContext)context=nextContext;
      if (now - previousTime > maxGapMs) return continuous?silentBaseline(frame,items,{preserveHistory:true,cause:'CAPTURE_GAP'}):pause('CAPTURE_GAP');
      // Prefer chart motion measured from pixels, including sub-tolerance movement.
      // A missing estimate uses the conservative historical matcher; malformed
      // estimates never become an assumed zero displacement.
      const motion = rebase?{x:0,y:0}:frame.chartMotion;
      if (motion != null && (!Number.isFinite(motion.x) || !Number.isFinite(motion.y) || Math.abs(motion.x)>16 || Math.abs(motion.y)>16)) return continuous?silentBaseline(frame,items,{cause:'AMBIGUOUS_CHART_MOTION'}):pause('AMBIGUOUS_CHART_MOTION');
      const motionVerified = motion != null;
      const shift = motionVerified ? {x:motion.x,y:motion.y} : estimateShift(items, now);
      if (!shift) return continuous?silentBaseline(frame,items,{cause:'AMBIGUOUS_CHART_MOTION'}):pause('AMBIGUOUS_CHART_MOTION');
      const { pairs, used, ambiguous,ambiguousItems } = assignment(items, shift), events = [], numberHintRequests = [], oldPartial = partial;
      const stationary=continuous&&!rebase&&context&&context===nextContext&&
        (frame.chartMotion!=null?Math.abs(frame.chartMotion.x)<=.25&&Math.abs(frame.chartMotion.y)<=.25:stationaryAnchors);
      if (ambiguous&&!continuous) return pause('AMBIGUOUS_CANDIDATES');
      if(continuous){
        for(const i of collisions)ambiguousItems.add(i);
        // A lone historical label cannot establish a common chart translation.
        // Quarantine only its plausible moved copy, while unrelated new labels
        // remain eligible even though the old history is now partial.
        if(!motionVerified&&pairs.size<2){
          const unresolved=tracks.filter(track=>track.confirmed&&!pairs.has(track.id));
          for(let i=0;i<items.length;i++)if(!used.has(i)&&unresolved.some(track=>track.direction===items[i].direction&&(!track.appearanceKey||!items[i].appearanceKey||track.appearanceKey===items[i].appearanceKey)&&Math.abs(track.x+shift.x-items[i].x)<=60&&Math.abs(track.y+shift.y-items[i].y)<=60))ambiguousItems.add(i);
        }
        for(const [id,i] of pairs)if(ambiguousItems.has(i)){pairs.delete(id);used.delete(i);}
      }
      let missing = 0, expired = 0;
      const updated = [];
      for (const track of tracks) {
        const index = pairs.get(track.id);
        if (index !== undefined) {
          const item = items[index];
          if (!track.confirmed) events.push(eventOf(track,item,now));
          updated.push(continuous&&track.confirmed?updateNumberIdentity(track,item,frame,{stationary:stationary&&track.lastSeen===previousTime,sourceCandidate:frame.candidates[index],requests:numberHintRequests,events}):resetNumberState({...track,...item,lastSeen:now,confirmed:true},item.numberHint));
        } else if (track.confirmed) {
          const moved = continuous?resetNumberState({ ...track, x: track.x + shift.x, y: track.y + shift.y }):{ ...track, x: track.x + shift.x, y: track.y + shift.y };
          const b=frame.bounds;
          const bounded = b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width>0 && b.height>0;
          const outside = bounded && (moved.x < b.x || moved.x >= b.x+b.width || moved.y < b.y || moved.y >= b.y+b.height);
          // Keep an off-screen tombstone so a return is matched to the old UUID.
          // If motion is unknown, do not treat a disappearance as a proven exit.
          if (motionVerified && outside) { updated.push({...moved,outside:true}); continue; }
          if (now - track.lastSeen > memoryMs && !track.outside&&!continuous) return pause('TRACKING_UNCERTAIN');
          updated.push({...moved,outside:track.outside && outside}); missing++;
        }
      }
      for (let i=0; i<items.length; i++) if (!used.has(i)&&!(continuous&&ambiguousItems.has(i))) { const firstBox=firstBoxOf(frame.candidates[i]);updated.push({ ...items[i], id: nextId++, signalId: crypto.randomUUID(), lastSeen: now, confirmed: false, firstX: items[i].x, firstY: items[i].y, firstSeenAt: now, lastAbsentAt: previousTime, ...(firstBox?{firstBox}:{}) }); }
      // Never silently discard a tombstone or reinterpret it as a new arrow.
      if (updated.length > 2000) return continuous?silentBaseline(frame,items,{cause:'HISTORY_COMPACTED'}):pause('TRACKING_UNCERTAIN');
      tracks = updated; previousTime = now; partial = missing > 0 || expired > 0;
      return { state, reason: partial ? 'PARTIAL' : 'OK', events, missing, expired,
        ...(continuous?{motion:{...shift},numberHintRequests}:{}),...(rebase?{rebase:{...rebase}}:{}),
        transition: !oldPartial && partial ? 'PARTIAL_START' : oldPartial && !partial ? 'PARTIAL_END' : undefined };
    },
  };
}
