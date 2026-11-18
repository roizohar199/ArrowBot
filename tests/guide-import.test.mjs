import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGuideImport,parseGuideCsv,parseGuideTime} from '../guide-import.mjs';
const metadata={source:'ohlc',instrument:'SYNTHETIC',timeframe:'1m',timeframeMs:60000,tickSize:.25,timezone:'UTC',session:'synthetic',chartType:'standard'};
const time=Date.parse('2026-11-13T10:00:00Z');
const bar=(offset=0,extra={})=>({time:time+offset*60000,closeTime:time+(offset+1)*60000,open:100,high:102,low:99,close:101,closed:true,...extra});
const json=bars=>JSON.stringify({metadata,bars});
const csv='time,open,high,low,close,volume\r\n2026-11-13T10:00:00Z,100,102,99,101,0\r\n';
const rejects=(call,code)=>assert.throws(call,error=>error.code===code);

test('canonical JSON preserves explicit open last bar and never overwrites metadata or close flags',()=>{
  const r=parseGuideImport(json([bar(),bar(1,{closed:false})]),{metadata:{...metadata,instrument:'OVERRIDE'},closedBarsConfirmed:true});
  assert.equal(r.metadata.instrument,'SYNTHETIC');assert.equal(r.bars[1].closed,false);assert.equal(r.importInfo.closedBars,1);assert.equal(r.bars[0].knownAt,time+60000);
  assert.ok(r.importInfo.warnings.includes('AVAILABILITY_ASSUMED_AT_BAR_CLOSE'));
  assert.ok(!parseGuideImport(json([bar(0,{knownAt:time+90000})])).importInfo.warnings.includes('AVAILABILITY_ASSUMED_AT_BAR_CLOSE'));
  rejects(()=>parseGuideImport(json([bar(0,{closed:undefined})])),'EXPLICIT_CLOSE_REQUIRED');
  rejects(()=>parseGuideImport(json([bar(0,{closed:false}),bar(1)])),'OPEN_INTERIOR_BAR');
});

test('CSV without close column requires explicit user close confirmation, including the last row',()=>{
  rejects(()=>parseGuideImport(csv,{metadata}),'CLOSE_CONFIRMATION_REQUIRED');
  const r=parseGuideImport(csv,{metadata,closedBarsConfirmed:true});assert.equal(r.bars[0].closed,true);assert.equal(r.bars[0].volume,0);assert.equal(r.bars[0].closeTime,time+60000);
  assert.ok(r.importInfo.warnings.includes('CSV_CLOSE_FLAGS_FROM_EXPLICIT_USER_CONFIRMATION'));
});

test('CSV quoted fields, escaped quotes, CRLF and explicit final-open flags parse without numeric coercion',()=>{
  assert.deepEqual(parseGuideCsv('a,b\r\n"one, two","a""b"\r\n'),[['a','b'],['one, two','a"b']]);
  const data='timestamp,O,H,L,C,closed\n"2026-11-13T10:00:00+00:00",100,102,99,101,false';
  const r=parseGuideImport(data,{metadata});assert.equal(r.bars[0].closed,false);
  rejects(()=>parseGuideImport(data.replace(',100,',',"1,000",'),{metadata}),'INVALID_NUMBER');
  rejects(()=>parseGuideImport(data.replace(',100,',',,'),{metadata}),'INVALID_NUMBER');
  rejects(()=>parseGuideImport(data.replace(',false',','),{metadata}),'EXPLICIT_CLOSE_REQUIRED');
});

test('ambiguous date and epoch seconds, invalid calendar values, malformed quotes and ragged rows are rejected',()=>{
  rejects(()=>parseGuideTime('2026-11-13 10:00:00',{csv:true}),'AMBIGUOUS_TIME');
  rejects(()=>parseGuideTime('1794564000',{csv:true}),'AMBIGUOUS_TIME');
  rejects(()=>parseGuideTime('2026-02-30T10:00:00Z'),'INVALID_TIME');
  rejects(()=>parseGuideTime('2026-11-13T24:00:00Z'),'INVALID_TIME');
  assert.equal(parseGuideTime(String(time),{csv:true}),time);
  assert.equal(parseGuideTime('2026-11-13T12:00:00+02:00'),time);
  rejects(()=>parseGuideCsv('a,b\n"broken,b'),'UNTERMINATED_CSV_QUOTE');
  rejects(()=>parseGuideImport(csv.replace(',101,0',',101'),{metadata,closedBarsConfirmed:true}),'CSV_ROW_SHAPE');
});

test('zero-filled missing cells, invalid OHLC, duplicates and descending time cannot enter the engine',()=>{
  rejects(()=>parseGuideImport(json([bar(0,{high:98})])),'INVALID_OHLC');
  rejects(()=>parseGuideImport(json([bar(),bar()])),'INVALID_TIME_ORDER');
  rejects(()=>parseGuideImport(json([bar(1),bar(0)])),'INVALID_TIME_ORDER');
  rejects(()=>parseGuideImport(json([bar(0,{open:null})])),'INVALID_OHLC');
  rejects(()=>parseGuideImport(json([bar(0,{knownAt:time})])),'INVALID_BAR_TIMES');
});

test('missing bars are retained as explicit gap information rather than silently reindexed',()=>{
  const r=parseGuideImport(json([bar(),bar(2)]));assert.equal(r.bars.length,2);assert.equal(r.importInfo.gaps.length,1);assert.ok(r.importInfo.warnings.includes('UNDECLARED_DATA_GAP'));
  const declared={...metadata,sessionGaps:[{from:time+60000,to:time+120000,kind:'market_closed'}]};
  const known=parseGuideImport(JSON.stringify({metadata:declared,bars:[bar(),bar(2)]}));assert.equal(known.importInfo.gaps[0].declared,true);
});

test('metadata, array-only documents, frame limit and malformed volume are not guessed or truncated',()=>{
  rejects(()=>parseGuideImport(JSON.stringify([bar()])),'CANONICAL_DOCUMENT_REQUIRED');
  rejects(()=>parseGuideImport(JSON.stringify({metadata:{...metadata,tickSize:null},bars:[bar()]})),'INVALID_METADATA');
  rejects(()=>parseGuideImport(json([bar(),bar(1)]),{maxBars:1}),'BAR_COUNT_LIMIT');
  rejects(()=>parseGuideImport(json([bar(0,{volume:-1})])),'INVALID_VOLUME');
});
