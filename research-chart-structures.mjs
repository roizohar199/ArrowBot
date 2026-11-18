import {calculateIndicators,confirmedPivots,normalizeContextBars} from './market-context.mjs';
import {followingCloseChange,researchBarAvailability,researchBarsAdjacent} from './research-pattern-quality.mjs';

export const CHART_STRUCTURE_VERSION='chart-structures-v1';
const maxDistance=60,minDistance=5,expiry=30,retestExpiry=15;
const initial={version:CHART_STRUCTURE_VERSION,researchOnly:true,orderEligible:false};

function crossed(direction,value,level){
  return direction==='LONG'?value>level:value<level;
}

function processSegment(bars,tick,records){
  if(bars.length<7)return;
  const pivots=confirmedPivots(bars,{tickSize:tick,equalToleranceTicks:0});
  const byIndex=new Map();
  for(const pivot of pivots){
    const at=byIndex.get(pivot.confirmedAtIndex)??[];
    at.push(pivot);byIndex.set(pivot.confirmedAtIndex,at);
  }
  const seen={HIGH:[],LOW:[]},pending=new Map();
  const {atr}=calculateIndicators(bars);
  const scale=i=>Number.isFinite(atr[i-1])?atr[i-1]:0;
  const near=(p,q,i)=>Math.abs(p.price-q.price)<=Math.max(2*tick,.25*scale(i));
  const out=value=>Math.round(value/tick)*tick;
  const pivotRef=({id,time,price,knownAt})=>({id,time,price,knownAt});
  function candidate(type,direction,anchors,lower,upper,i){
    const key=`${type}:${direction??'EITHER'}`,old=pending.get(key),bar=bars[i];
    const id=key+':'+anchors.map(anchor=>anchor.id).join('/');
    if(old?.id===id)return;
    if(old?.status==='CANDIDATE')Object.assign(old,{status:'SUPERSEDED',endedAt:bar.knownAt});
    // A confirmed event keeps its retest until resolution even when fresh pivots appear.
    if(old?.status==='CONFIRMED'&&!old.retestStatus)return;
    const row={id,type,direction,anchors:anchors.map(pivotRef),lower:out(lower),upper:out(upper),status:'CANDIDATE',
      candidateAt:bar.knownAt,candidateClose:bar.closeTime,candidateIndex:i,confirmedAt:null,confirmedClose:null,retestedAt:null};
    pending.set(key,row);records.push(row);
  }
  for(const [i,bar] of bars.entries()){
    for(const [key,row] of pending){
      if(row.status==='CANDIDATE'){
        if(i-row.candidateIndex>expiry){Object.assign(row,{status:'EXPIRED',endedAt:bar.knownAt});pending.delete(key);continue;}
        const {type,upper,lower}=row;
        const direction=row.direction??(bar.close>upper+tick?'LONG':bar.close<lower-tick?'SHORT':null);
        if(!direction)continue;
        const level=direction==='LONG'?upper+tick:lower-tick;
        if(type==='DOUBLE_TOP'&&bar.close>upper+tick||type==='DOUBLE_BOTTOM'&&bar.close<lower-tick){
          Object.assign(row,{status:'INVALIDATED',endedAt:bar.knownAt});pending.delete(key);
        }else if(crossed(direction,bar.close,level)&&!crossed(direction,bars[i-1].close,level)){
          Object.assign(row,{status:'CONFIRMED',direction,confirmedAt:bar.knownAt,confirmedClose:bar.closeTime,confirmationIndex:i,
            breakoutLevel:direction==='LONG'?upper:lower});
        }
      }else if(row.status==='CONFIRMED'){
        const level=row.breakoutLevel,age=i-row.confirmationIndex;
        const failed=crossed(row.direction==='LONG'?'SHORT':'LONG',bar.close,level+(row.direction==='LONG'?-tick:tick));
        const touched=bar.low<=level+tick&&bar.high>=level-tick&&crossed(row.direction,bar.close,level);
        if(age>retestExpiry||failed||touched){
          row.retestStatus=age>retestExpiry?'EXPIRED':failed?'FAILED':'RETESTED';
          if(row.retestStatus==='RETESTED'){row.retestedAt=bar.knownAt;row.retestClose=bar.closeTime;}
          pending.delete(key);
        }
      }
    }
    for(const pivot of byIndex.get(i)??[]){
      const list=seen[pivot.type],prior=list.at(-1),high=pivot.type==='HIGH';
      list.push(pivot);
      if(!prior||pivot.localIndex-prior.localIndex<minDistance||pivot.localIndex-prior.localIndex>maxDistance||!near(prior,pivot,i))continue;
      const opposite=seen[high?'LOW':'HIGH'].filter(point=>point.localIndex>prior.localIndex&&point.localIndex<pivot.localIndex);
      const middle=opposite.reduce((best,point)=>!best||(high?point.price<best.price:point.price>best.price)?point:best,null);
      const outer=high?Math.max(prior.price,pivot.price):Math.min(prior.price,pivot.price);
      const neckline=middle?.price;
      if(Number.isFinite(neckline)&&Math.abs(outer-neckline)>=Math.max(8*tick,.5*scale(i))){
        candidate(high?'DOUBLE_TOP':'DOUBLE_BOTTOM',high?'SHORT':'LONG',[prior,middle,pivot],Math.min(outer,neckline),Math.max(outer,neckline),i);
      }
      const edge=out((prior.price+pivot.price)/2);
      candidate('BREAK_RETEST',high?'LONG':'SHORT',[prior,pivot],edge,edge,i);
      const lows=seen.LOW.slice(-2),highs=seen.HIGH.slice(-2);
      if(lows.length===2&&highs.length===2&&near(lows[0],lows[1],i)&&near(highs[0],highs[1],i)){
        const anchors=[...lows,...highs].sort((a,b)=>a.localIndex-b.localIndex);
        const alternating=anchors.every((p,j)=>!j||p.localIndex>anchors[j-1].localIndex&&p.type!==anchors[j-1].type);
        const lower=(lows[0].price+lows[1].price)/2,upper=(highs[0].price+highs[1].price)/2;
        if(alternating&&anchors.at(-1).localIndex-anchors[0].localIndex<=maxDistance&&upper-lower>=Math.max(12*tick,scale(i))){
          candidate('RECTANGLE',null,anchors,lower,upper,i);
        }
      }
    }
  }
  if(bars.at(-1).sessionLast)for(const row of pending.values()){
    if(row.status==='CANDIDATE')Object.assign(row,{status:'SESSION_END',endedAt:bars.at(-1).knownAt});
    else if(!row.retestStatus)row.retestStatus='SESSION_END';
  }
}

export function analyzeChartStructures(input,{tickSize,asOfTime,sessionGaps=[],maxRecords=40,horizons=[]}={}){
  const fail=reason=>({...initial,status:'UNAVAILABLE',reason,records:[],counts:{}});
  if(!Number.isFinite(asOfTime)||!Number.isFinite(tickSize)||tickSize<=0||!Array.isArray(input)||
    !Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>500||
    !Array.isArray(horizons)||!horizons.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=60))return fail('INVALID_STUDY_INPUT');
  const normalized=normalizeContextBars(input.map(bar=>bar&&({...bar,knownAt:researchBarAvailability(bar)})),{asOf:asOfTime,sessionGaps});
  if(!normalized.valid)return fail(normalized.reasonCodes[0]);
  const bars=normalized.bars,records=[];
  if(bars.some(bar=>bar.synthetic===true))return fail('SYNTHETIC_BAR');
  let start=0;
  for(let i=1;i<=bars.length;i++){
    if(i<bars.length&&researchBarsAdjacent(bars[i-1],bars[i]))continue;
    let knownAt=-Infinity;
    processSegment(bars.slice(start,i).map((bar,index)=>({...bar,index,knownAt:knownAt=Math.max(knownAt,bar.knownAt)})),tickSize,records);
    start=i;
  }
  const counts={},lookup=horizons.length?new Map(bars.map((bar,i)=>[bar.closeTime,i])):null;
  for(const row of records){
    const c=counts[row.type]??{candidates:0,confirmed:0,retested:0,
      followUp:Object.fromEntries(horizons.map(n=>[n,{eligible:0,favorable:0,missing:0}]))};
    c.candidates++;
    if(row.status==='CONFIRMED'){
      c.confirmed++;
      if(lookup)row.followUp=Object.fromEntries(horizons.map(n=>{
        const change=followingCloseChange(bars,lookup.get(row.confirmedClose),n),out=c.followUp[n];
        if(change===null)out.missing++;
        else{out.eligible++;if(row.direction==='LONG'?change>0:change<0)out.favorable++;}
        return [n,change];
      }));
    }
    if(row.retestStatus==='RETESTED')c.retested++;
    counts[row.type]=c;
  }
  records.sort((a,b)=>(b.confirmedClose??b.candidateClose)-(a.confirmedClose??a.candidateClose));
  return {...initial,status:'OK',counts,records:records.slice(0,maxRecords)};
}
