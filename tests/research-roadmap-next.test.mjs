import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePatternQuality,newYorkBarSlot} from '../research-pattern-quality.mjs';
import {analyzeChartStructures} from '../research-chart-structures.mjs';
import {analyzeStudyIndicators} from '../research-study-indicators.mjs';
import {applyPaperTradeHistory,parsePaperTradeHistory} from '../research-paper-history.mjs';

const minute=60_000;
const start=Date.parse('2026-11-17T12:00:00Z');
const barsFrom=(prices,duration=minute,initial=start)=>prices.map((close,index)=>{
  const time=initial+index*duration;
  return {time,closeTime:time+duration,knownAt:time+duration,open:close,close,high:close+.25,low:close-.25,
    sourceClosed:true,closed:true,finalOhlcVerified:true,providerBarIndex:index,sessionFirst:false,sessionLast:false};
});
const meta={instrument:'CME_MINI:NQ1!',sourceId:'nq',tickSize:.25,timeframe:'1',session:'regular',chartType:'standard'};

test('New York clock classification follows DST and exact local opening and daytime boundaries',()=>{
  assert.equal(newYorkBarSlot(Date.parse('2026-11-17T14:29:00Z')).session,'OVERNIGHT');
  assert.equal(newYorkBarSlot(Date.parse('2026-11-17T14:30:00Z')).session,'NEW_YORK_OPEN');
  assert.equal(newYorkBarSlot(Date.parse('2026-11-17T15:30:00Z')).session,'NEW_YORK_DAY');
  assert.equal(newYorkBarSlot(Date.parse('2026-07-17T13:30:00Z')).session,'NEW_YORK_OPEN');
});

test('quality reads an observed native higher-frame prefix and keeps outcome and control counts separate',()=>{
  const bars=barsFrom(Array.from({length:100},(_,i)=>100+i*.25));
  const anchor=bars[32],end=anchor.closeTime-3*minute;
  const makeHTF=(tf,closedAt)=>({metadata:{...meta,timeframe:tf},bars:barsFrom(
    Array.from({length:32},(_,i)=>100+i+(i%5===2?3:i%5===4?-3:0)),Number(tf)*minute,closedAt-30*Number(tf)*minute)});
  const higher={'5':makeHTF('5',end),'15':makeHTF('15',end)};
  const getQuality=()=> {
    const hit={endIndex:32,direction:'SHORT',horizons:[{status:'AVAILABLE',change:1.25}]};
    const data=analyzePatternQuality({bars,groups:[{id:'X',detections:[hit]}],metadata:meta,
      higherTimeframes:higher,sessionGaps:[],horizons:[5]});
    return {hit,data};
  };
  const initial=getQuality(),row=initial.data.rows.find(r=>r.dimension==='session');
  assert.deepEqual(initial.data.nativeFrames,{'5':true,'15':true});
  assert.equal(initial.hit.context.close5,end);
  assert.equal(initial.hit.context.close15,end);
  assert.ok(initial.data.rows.some(r=>r.dimension==='zone'));
  assert.deepEqual([row.total,row.eligible,row.matched,row.favorable,row.baselineRate],[1,1,1,0,0]);
  for(const item of higher['5'].bars.slice(-3))item.knownAt=anchor.closeTime+1;
  assert.equal(getQuality().hit.context.close5,null);
  assert.equal(getQuality().hit.context.close15,end);
});

test('double-top neckline is discovered only at the right-side pivot, and confirms on a later close',()=>{
  const prices=[103,106,110,107,105,102,105,106,110,108,106,105,100,103,104,101,100,99,98,97];
  const bars=barsFrom(prices),run=n=>analyzeChartStructures(bars,{tickSize:.25,asOfTime:bars[n].closeTime,horizons:[5]});
  assert.equal(run(9).records.some(row=>row.type==='DOUBLE_TOP'),false);
  const candidate=run(10).records.find(row=>row.type==='DOUBLE_TOP');
  assert.equal(candidate.status,'CANDIDATE');
  assert.equal(candidate.candidateClose,bars[10].closeTime);
  const confirmed=run(19).records.find(row=>row.id===candidate.id);
  assert.equal(confirmed.confirmedClose,bars[12].closeTime);
  assert.equal(confirmed.breakoutLevel,101.75);
  assert.equal(confirmed.followUp[5],-1);
  assert.equal(run(19).counts.DOUBLE_TOP.followUp[5].favorable,1);
});

test('session volume audit keeps reported zero, requires complete history and rejects a gap for VWAP',()=>{
  const references=Array.from({length:5},(_,i)=>{
    const rows=barsFrom([100,101,102],minute,start-(5-i)*86_400_000);
    return rows.map((bar,j)=>({...bar,sessionFirst:j===0,sessionLast:j===2,volume:20}));
  });
  const current=barsFrom([100,101,102,103]).map((bar,i)=>({...bar,sessionFirst:i===0,volume:[40,0,null,40][i]}));
  const {rows,coverage,volumeReference}=analyzeStudyIndicators(current,references);
  assert.deepEqual(rows.map(row=>row.rvol),[2,0,null,null]);
  assert.deepEqual(rows.map(row=>row.vwap),[100,100,null,null]);
  assert.deepEqual([coverage[0].known,coverage[0].zero],[3,1]);
  assert.equal(volumeReference.completeSessions,5);
  assert.equal(analyzeStudyIndicators(current,[...references.slice(0,4),references[0]]).rows[0].rvol,null);
});

test('Paper history joins the exact native entry and trade numbers, handles split exits and deduplicates reimports',()=>{
  const head='Symbol,Trade number,Type,Date and time,Order ID,Price,Size (qty),Net PnL USD,Commission USD';
  const record={id:'TRADINGVIEW_PAPER:account:CME_MINI:NQZ2026:123',contract:'CME_MINI:NQZ2026',direction:'LONG',
    entryTime:start+1000,entry:100,quantity:2,pointValue:20,entryUtcOffsetMinutes:120,
    observedBars:barsFrom([100,101,102,103])};
  const entry=(trade,order=123)=>`CME_MINI:NQZ2026,${trade},Entry long,"Nov 17, 2026, 14:00",${order},100,1,,`;
  const exit=(trade,order,px,pnl)=>`CME_MINI:NQZ2026,${trade},Exit long,"Nov 17, 2026, 14:04",${order},${px},1,${pnl},0.5`;
  const part=parsePaperTradeHistory([head,entry(1),exit(1,200,102,39.5)].join('\r\n'));
  const next=parsePaperTradeHistory([head,entry(1),exit(1,200,102,39.5),entry(2),exit(2,201,103,59.5)].join('\n'));
  const first=applyPaperTradeHistory([record],part,'one.csv');
  assert.equal(first.records[0].actual.status,'PARTIAL');
  const linked=applyPaperTradeHistory(first.records,next,'two.csv'),actual=linked.records[0].actual;
  assert.equal(actual.status,'CLOSED');
  assert.equal(actual.averageExit,102.5);
  assert.equal(actual.netPnl,99);
  assert.deepEqual(actual.pricePath,{bars:3,mfePoints:3.25,maePoints:0});
  assert.equal(applyPaperTradeHistory(linked.records,next,'same.csv').changed,0);
  assert.equal(applyPaperTradeHistory(linked.records,part,'old.csv').changed,0);
  assert.equal(applyPaperTradeHistory([{...record,entry:101}],next).matched,0);
  assert.equal(applyPaperTradeHistory([record,{...record,id:record.id.replace(':account:',':other:')}],next).matched,0);
});
