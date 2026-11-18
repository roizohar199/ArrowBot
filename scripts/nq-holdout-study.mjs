import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {analyzeResearchCandles,RESEARCH_CANDLE_VERSION} from '../research-candle-patterns.mjs';
import {analyzeChartStructures,CHART_STRUCTURE_VERSION} from '../research-chart-structures.mjs';
import {analyzeStudyIndicators,STUDY_INDICATORS_VERSION} from '../research-study-indicators.mjs';

const minute=60_000,day=86_400_000,horizons=[15,5],sessionLength=1380,minimumControls=4;
const patternIds=['ADVANCE_BLOCK','BEARISH_BELT_HOLD','DOUBLE_TOP','DOUBLE_BOTTOM','RECTANGLE','BREAK_RETEST'];
const modifierIds=['STOCHASTIC','RSI','BOLLINGER','MACD','RVOL','VWAP'];
const hypotheses=patternIds.length+modifierIds.length;
const field=Number.isFinite;
const config={
  primary:{id:'alfordlabs',source:'AlfordLabs',url:'https://github.com/kfccolonel1/BARS#raw',
    sha256:'a6fdb229a7ed91be82a381d5bddc73fb8e0b49526ed19a1f3b4865dc68d19527',
    warmupFrom:'2026-07-13',from:'2026-08-03',to:'2026-09-04',utcOffset:-240,gzip:true},
  replication:{id:'firstrate',source:'FirstRate Data',url:'https://firstratedata.com/i/futures/NQ',
    sha256:'b87ca816f47e60c35ae87256faf102c1b0975f352c1e2a74c26496a324159915',
    warmupFrom:'2026-11-02',from:'2026-11-02',to:'2026-11-12',utcOffset:-300,gzip:false},
};
const [primaryPath,replicationPath,out]=process.argv.slice(2);
if(!primaryPath||!replicationPath||!out)throw Error('Usage: node scripts/nq-holdout-study.mjs <Alford .csv.gz> <FirstRate 1min .csv> <report .json>');

const ny=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',timeZoneName:'longOffset'});
const dateKey=epoch=>new Date(epoch).toISOString().slice(0,10);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function datasets(path,source){
  const bytes=readFileSync(path);
  if(digest(bytes)!==source.sha256)throw Error('Source digest mismatch: '+source.id);
  const text=(source.gzip?gunzipSync(bytes):bytes).toString('utf8'),groups=new Map();
  const earliest=dateKey(Date.parse(source.warmupFrom)-day);
  for(const line of text.split(/\r?\n/)){
    if(line[0]<'0'||line[0]>'9')continue;
    const date=line.slice(0,10);
    if(date<earliest||date>source.to)continue;
    const parts=line.split(',');
    const stamp=parts[0].trim(),localEpoch=Date.parse(stamp.replace(' ','T')+'Z');
    const time=localEpoch-source.utcOffset*minute;
    const minuteOfDay=Number(stamp.slice(11,13))*60+Number(stamp.slice(14,16));
    const tradeDate=minuteOfDay>=1080?dateKey(localEpoch+day):date;
    if(tradeDate<source.warmupFrom||tradeDate>source.to)continue;
    const [open,high,low,close,volume]=parts.slice(1).map(v=>v.trim()===''?NaN:Number(v));
    if(parts.length!==6||!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:00$/.test(stamp)||!Number.isSafeInteger(time)||
      [open,high,low,close].some(px=>!Number.isSafeInteger(px*4)||px<=0)||high<Math.max(open,close,low)||low>Math.min(open,close)||
      !Number.isSafeInteger(volume)||volume<0)throw Error('Invalid OHLCV: '+source.id+' '+stamp);
    const session=groups.get(tradeDate)??[];
    session.push({time,closeTime:time+minute,knownAt:time+minute,open,high,low,close,volume,closed:true,
      sourceClosed:true,minuteOfDay});
    groups.set(tradeDate,session);
  }
  const expected=[];
  for(let t=Date.parse(source.warmupFrom);t<=Date.parse(source.to);t+=day){
    const weekday=new Date(t).getUTCDay();
    if(weekday>0&&weekday<6)expected.push(dateKey(t));
  }
  if(groups.size!==expected.length)throw Error('Unexpected sessions: '+source.id);
  const utcCode=source.utcOffset===-240?'GMT-04:00':'GMT-05:00';
  for(const date of expected){
    const bars=groups.get(date),first=bars?.[0],last=bars?.at(-1);
    if(!bars||bars.length!==sessionLength||first.minuteOfDay!==1080||last.minuteOfDay!==1019||
      [first,last].some(row=>ny.formatToParts(row.time).find(part=>part.type==='timeZoneName')?.value!==utcCode)||
      bars.some((bar,i)=>bar.time!==first.time+i*minute))throw Error('Session incomplete: '+source.id+' '+date);
    first.sessionFirst=true;
    last.sessionLast=true;
  }
  return expected.map(date=>({date,bars:groups.get(date)}));
}

function anchors(sessions){
  const result=[];
  for(const [i,{date,bars}] of sessions.entries()){
    const asOfTime=bars.at(-1).closeTime,previous=sessions[i-1]?.bars.slice(-25)??[];
    const candles=analyzeResearchCandles([...previous,...bars],{tickSize:.25,asOfTime,maxPatterns:5000,patternIds:patternIds.slice(0,2)});
    if(candles.status!=='OK'||candles.totalDetected!==candles.patterns.length)throw Error('Candle coverage incomplete: '+date);
    const structure=analyzeChartStructures(bars,{tickSize:.25,asOfTime,maxRecords:500});
    if(structure.status!=='OK'||structure.records.length!==Object.values(structure.counts).reduce((n,c)=>n+c.candidates,0)){
      throw Error('Structure coverage incomplete: '+date);
    }
    const hits=new Map(),byIndex=new Map(bars.map((bar,j)=>[bar.closeTime,j]));
    for(const row of [...candles.patterns,...structure.records.filter(row=>row.status==='CONFIRMED')]){
      const index=byIndex.get(row.barCloseTime??row.confirmedClose);
      if(index===undefined)continue;
      const id=row.patternId??row.type,key=[id,index,row.direction].join('|');
      if(!hits.has(key))hits.set(key,{id,index,direction:row.direction});
    }
    result.push([...hits.values()]);
  }
  return result;
}

const sessionPart=minutes=>minutes<570||minutes>=960?'OVERNIGHT':minutes<630?'OPEN':'DAY';
const sign=direction=>direction==='LONG'?1:-1;
const indicatorRule=(id,r,direction)=>{
  const long=direction==='LONG';
  switch(id){
    case 'STOCHASTIC':return field(r.stochastic)?long?r.stochastic<=20:r.stochastic>=80:null;
    case 'RSI':return field(r.rsi)?long?r.rsi<=30:r.rsi>=70:null;
    case 'BOLLINGER':return field(r.widthRatio)?r.widthRatio>=1.2:null;
    case 'MACD':return field(r.macdSignal)?sign(direction)*(r.macd-r.macdSignal)>0:null;
    case 'RVOL':return field(r.rvol)?r.rvol>=1.5:null;
    case 'VWAP':return field(r.vwap)?sign(direction)*(r.close-r.vwap)>0:null;
  }
};

function compareSession({date,bars},events,metrics,horizon){
  const hitIndices=new Set(events.map(event=>event.index)),controls=new Map();
  const key=i=>[Math.floor(bars[i].minuteOfDay/30),Math.sign(bars[i].close-bars[i].open),Math.sign(bars[i].close-bars[i-15].close)].join('|');
  for(let i=15;i+horizon<bars.length;i++){
    if(hitIndices.has(i))continue;
    const k=key(i),bucket=controls.get(k)??{n:0,sum:0,up:0,down:0};
    const change=bars[i+horizon].close-bars[i].close;
    bucket.n++;bucket.sum+=change;
    if(change>0)bucket.up++;
    if(change<0)bucket.down++;
    controls.set(k,bucket);
  }
  return events.map(({id,index,direction})=>{
    const before={id,date,index,direction};
    if(index<15||index+horizon>=bars.length)return before;
    const bucket=controls.get(key(index));
    if(!bucket||bucket.n<minimumControls)return before;
    const side=sign(direction),actual=side*(bars[index+horizon].close-bars[index].close),benchmark=side*bucket.sum/bucket.n;
    const hit=Number(actual>0),baseHit=(side===1?bucket.up:bucket.down)/bucket.n;
    return {...before,actual,benchmark,hit,baseHit,points:actual-benchmark,hitDelta:hit-baseHit,
      part:sessionPart(bars[index].minuteOfDay),metrics:metrics[index]};
  });
}

const hasPair=row=>field(row.points);
const sum=(rows,key)=>rows.reduce((n,row)=>n+row[key],0);
function dailyTotals(rows){
  const days=new Map();
  for(const row of rows){
    const d=days.get(row.date)??{points:0,n:0};
    d.points+=row.points;d.n++;
    days.set(row.date,d);
  }
  return [...days.values()];
}

function interval(days){
  if(days.length<10)return null;
  let seed=0x93ae125b;
  const estimates=[];
  const repetitions=10_000;
  for(let rep=0;rep<repetitions;rep++){
    let numerator=0,denominator=0;
    for(let i=0;i<days.length;i++){
      seed=(Math.imul(1664525,seed)+1013904223)>>>0;
      const draw=days[Math.floor(seed/2**32*days.length)];
      numerator+=draw.points;denominator+=draw.n;
    }
    estimates.push(numerator/denominator);
  }
  estimates.sort((a,b)=>a-b);
  const edge=.05/(hypotheses*2);
  return [estimates[Math.floor(edge*repetitions)],estimates[Math.ceil((1-edge)*repetitions)-1]];
}

function summarize(id,rows,{total,controls=null,covered=total,horizon}){
  const n=rows.length,days=dailyTotals(rows);
  const avg=key=>n?sum(rows,key)/n:null;
  const bounds=horizon===15?interval(days):null;
  const sufficient=n>=50&&(controls===null||controls>=50)&&days.length>=10;
  return {id,total,covered,n,controls,sessions:days.length,meanPoints:avg('points'),hitDelta:avg('hitDelta'),
    hitRate:avg('hit'),baselineRate:avg('baseHit'),interval:bounds,
    finding:!sufficient?'LIMITED':!bounds?'DESCRIPTIVE':bounds[0]>0?'POSITIVE':bounds[1]<0?'NEGATIVE':'INCONCLUSIVE'};
}

function evaluateModifier(id,events,horizon){
  const strata=new Map(),covered=[];
  for(const event of events){
    const flag=indicatorRule(id,event.metrics,event.direction);
    if(flag===null)continue;
    covered.push(event);
    const key=[event.date,event.id,event.direction,event.part].join('|');
    const bucket=strata.get(key)??{with:[],without:[]};
    bucket[flag?'with':'without'].push(event);
    strata.set(key,bucket);
  }
  let controls=0;
  const pairs=[];
  for(const bucket of strata.values()){
    const {with:treated,without:comparison}=bucket;
    if(!treated.length||!comparison.length)continue;
    controls+=comparison.length;
    const points=sum(comparison,'points')/comparison.length,hitDelta=sum(comparison,'hitDelta')/comparison.length;
    for(const row of treated)pairs.push({...row,points:row.points-points,hitDelta:row.hitDelta-hitDelta,
      baseHit:row.baseHit+hitDelta});
  }
  const output=summarize(id,pairs,{total:events.length,controls,covered:covered.length,horizon});
  // For modifiers the hit measure is the difference of excess hit-rates.
  // The implied benchmark need not itself be a rate for a standalone group.
  return {...output,hitRate:null,baselineRate:null};
}

function run(path,source){
  const sessions=datasets(path,source),detections=anchors(sessions);
  const indicator=analyzeStudyIndicators(sessions.flatMap(s=>s.bars));
  const selected=sessions.filter(s=>s.date>=source.from);
  const startIndex=sessions.length-selected.length;
  const reports=horizons.map(horizon=>{
    const events=selected.flatMap((session,i)=>{
      const index=i+startIndex;
      return compareSession(session,detections[index],indicator.rows.slice(index*sessionLength,(index+1)*sessionLength),horizon);
    });
    const matched=events.filter(hasPair);
    return {horizon,patterns:patternIds.map(id=>summarize(id,matched.filter(row=>row.id===id),
      {total:events.filter(row=>row.id===id).length,horizon})),modifiers:modifierIds.map(id=>evaluateModifier(id,matched,horizon))};
  });
  const measuredRows=indicator.rows.slice(startIndex*sessionLength);
  return {source:source.source,url:source.url,sha256:source.sha256,from:source.from,to:source.to,
    warmupSessions:startIndex,sessions:selected.length,bars:selected.length*sessionLength,
    volumeBars:selected.length*sessionLength,vwapBars:measuredRows.filter(row=>field(row.vwap)).length,
    rvolBars:measuredRows.filter(row=>field(row.rvol)).length,reports};
}

const result={kind:'ARROW_NQ_HOLDOUT_V1',instrument:'CME E-mini NQ',timeframe:1,researchOnly:true,
  developmentWindow:{from:'2026-11-13',to:'2026-11-17'},definitions:{candles:RESEARCH_CANDLE_VERSION,
    chart:CHART_STRUCTURE_VERSION,indicators:STUDY_INDICATORS_VERSION},familySize:hypotheses,
  primary:run(primaryPath,config.primary),replication:run(replicationPath,config.replication)};
writeFileSync(out,JSON.stringify(result,null,2)+'\n');
