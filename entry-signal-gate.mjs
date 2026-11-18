import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';

// Entry policy only. Tracking/OCR may still observe historical labels, but a
// detector's "new UUID" is not by itself permission to enter a trade.
// Rightmost is a visual approximation of chronology, not exchange bar time.
export function createEntrySignalGate({tolerance=4,maxAgeMs=MAX_CAPTURE_GAP_MS,maxEvents=8192}={}){
  if(!Number.isFinite(tolerance)||tolerance<0||!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isSafeInteger(maxEvents)||maxEvents<1)throw Error('INVALID_CONFIGURATION');
  let binding=null,lastAt=null,quietAt=null,frontier=null,visualHistory=[],proofs=new Map(),consumed=new Set(),exhausted=false;
  const point=v=>v&&['UP','DOWN'].includes(v.direction)&&Number.isFinite(v.x)&&Number.isFinite(v.y);
  const near=(a,b)=>a.direction===b.direction&&Math.abs(a.x-b.x)<=tolerance&&Math.abs(a.y-b.y)<=tolerance;
  function latest(candidates){
    if(!candidates.length)return null;
    const x=Math.max(...candidates.map(c=>c.x)),choices=candidates.filter(c=>x-c.x<=tolerance);
    return choices.length===1?{x:choices[0].x,y:choices[0].y,direction:choices[0].direction,appearanceKey:choices[0].appearanceKey??null}:null;
  }
  function remember(candidates,shift={x:0,y:0}){
    const cell=Math.max(1,tolerance),buckets=new Map();
    visualHistory=visualHistory.map(c=>({...c,x:c.x+shift.x,y:c.y+shift.y}));
    const key=c=>`${c.direction}:${Math.floor(c.x/cell)},${Math.floor(c.y/cell)}`;
    const add=c=>{const k=key(c),list=buckets.get(k)??[];list.push(c);buckets.set(k,list);};
    for(const c of visualHistory)add(c);
    const seen=c=>{const bx=Math.floor(c.x/cell),by=Math.floor(c.y/cell);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const prior of buckets.get(`${c.direction}:${bx+dx},${by+dy}`)??[])if(near(prior,c)&&(!prior.appearanceKey||!c.appearanceKey||prior.appearanceKey===c.appearanceKey))return true;return false;};
    const previouslySeen=candidates.map(seen);
    candidates.forEach((c,i)=>{if(!previouslySeen[i]){const record={x:c.x,y:c.y,direction:c.direction,appearanceKey:c.appearanceKey??null};visualHistory.push(record);add(record);}});
    return previouslySeen;
  }
  function clearContinuity(){binding=null;lastAt=null;quietAt=null;frontier=null;visualHistory=[];proofs.clear();}
  return {
    reset(){clearContinuity();consumed.clear();exhausted=false;},
    observe(frame={}){
      const records=(Array.isArray(frame.events)?frame.events:[]).map(event=>{
        const id=event?.signalId;
        if(typeof id!=='string'||!id)return {event,reason:'INVALID_EVENT'};
        if(consumed.has(id))return {event,reason:'DUPLICATE_EVENT'};
        if(consumed.size>=maxEvents){exhausted=true;return {event,reason:'EVENT_MEMORY_LIMIT'};}
        // Consume before any asynchronous send, including every rejected arrow.
        consumed.add(id);return {event,reason:null};
      });
      const denied=reason=>({allowed:[],skipped:records.map(r=>({event:r.event,reason:r.reason??reason}))});
      if(exhausted)return denied('EVENT_MEMORY_LIMIT');
      const now=frame.capturedAt,candidates=frame.candidates;
      if(!Number.isFinite(now)||typeof frame.context!=='string'||!frame.context||typeof frame.geometry!=='string'||!frame.geometry||!Array.isArray(candidates)||candidates.some(c=>!point(c))){clearContinuity();return denied('INVALID_FRAME');}
      const scope=frame.context+'|'+frame.geometry,rightmost=latest(candidates);
      if(lastAt!==null&&now<=lastAt)return denied('DUPLICATE_FRAME');
      if(binding!==scope||lastAt===null||now-lastAt>maxAgeMs||frame.trackingReason==='BASELINE'||frame.baselineReason||frame.rebase){
        binding=scope;lastAt=quietAt=now;frontier=candidates.length?Math.max(...candidates.map(c=>c.x)):null;visualHistory=[];remember(candidates);proofs.clear();return denied('QUIET_BASELINE');
      }
      const shift=frame.motion??{x:0,y:0};
      if(!Number.isFinite(shift.x)||!Number.isFinite(shift.y)||Math.abs(shift.x)>60||Math.abs(shift.y)>60){clearContinuity();return denied('MOTION_UNCERTAIN');}
      if(frontier!==null)frontier+=shift.x;
      const previouslySeen=remember(candidates,shift);
      if(visualHistory.length>2000){clearContinuity();return denied('VISUAL_MEMORY_LIMIT');}
      // Remember the frontier even if the newest visible arrow temporarily
      // disappears. An older arrow cannot become latest merely by reappearing.
      const birthEligible=!!rightmost&&(frontier===null||rightmost.x>=frontier-tolerance);
      const rightmostIndex=rightmost?candidates.findIndex(c=>near(c,rightmost)):-1;
      proofs.set(now,{latest:rightmost,birthEligible,previouslySeen:rightmostIndex>=0?previouslySeen[rightmostIndex]:true});
      for(const at of proofs.keys())if(now-at>maxAgeMs)proofs.delete(at);
      if(proofs.size>512){clearContinuity();return denied('FRAME_MEMORY_LIMIT');}
      if(candidates.length)frontier=Math.max(frontier??-Infinity,...candidates.map(c=>c.x));
      lastAt=now;
      const allowed=[],skipped=[];
      for(const record of records){
        const e=record.event;
        let reason=record.reason;
        if(!reason&&(!point(e)||!Number.isFinite(e.firstSeenAt)||!Number.isFinite(e.confirmedAt)||!Number.isFinite(e.firstX)||!Number.isFinite(e.firstY)||e.firstSeenAt>=e.confirmedAt||e.confirmedAt!==now))reason='INVALID_EVENT_TIME';
        if(!reason&&(e.firstSeenAt<=quietAt||now-e.firstSeenAt>maxAgeMs))reason='STALE_OR_PREBASELINE';
        const first=!reason?proofs.get(e.firstSeenAt):null;
        if(!reason&&(!first?.latest||!near(first.latest,{x:e.firstX,y:e.firstY,direction:e.direction})))reason='NOT_LATEST_AT_APPEARANCE';
        if(!reason&&!first.birthEligible)reason='BEHIND_LATEST_HISTORY';
        if(!reason&&first.previouslySeen)reason='VISUAL_ALREADY_SEEN';
        if(!reason&&(!rightmost||!near(rightmost,e)))reason='NOT_LATEST_VISIBLE';
        if(!reason&&frontier!==null&&e.x<frontier-tolerance)reason='BEHIND_LATEST_HISTORY';
        if(reason)skipped.push({event:e,reason});else allowed.push(e);
      }
      if(allowed.length>1){skipped.push(...allowed.map(event=>({event,reason:'AMBIGUOUS_LATEST_EVENTS'})));allowed.length=0;}
      return {allowed,skipped};
    },
  };
}
