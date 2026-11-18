import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveIntrabar} from '../live-intrabar.mjs';
const packet=(sequence,close=100,extra={})=>({kind:'update',runId:'run',sequence,sourceEmittedAt:1000+sequence*100,bars:[{time:1000,open:100,high:105,low:95,close,closed:false,volume:sequence}],...extra});
test('observed intrabar prices retain signed motion, speed and reversals without claiming tick history',()=>{
  const trace=createLiveIntrabar({maxPoints:3});[100,101,99,100].forEach((c,i)=>trace.ingest(packet(i+1,c)));
  const s=trace.snapshot();assert.equal(s.totalUpdates,4);assert.equal(s.retainedPoints,3);assert.equal(s.reversals,2);assert.equal(s.latest.observedSpeedPerSecond,10);assert.equal(s.completeTickHistory,false);
});
test('global HTF sequences are accounted for and real missing sequences remain explicit',()=>{
  const t=createLiveIntrabar();t.ingest(packet(1));t.ingest(packet(2,100,{kind:'timeframe_update'}));t.ingest(packet(3));assert.equal(t.snapshot().missingSequences,0);
  t.ingest(packet(6));assert.equal(t.snapshot().missingSequences,2);assert.equal(t.ingest(packet(5)),false);
});
test('new candle and source reset the observed trace; snapshot copies cannot mutate it',()=>{
  const t=createLiveIntrabar();t.ingest(packet(1));t.ingest(packet(2,101,{bars:[{time:2000,open:101,high:102,low:100,close:101,closed:false}]}));assert.equal(t.snapshot().totalUpdates,1);
  t.ingest(packet(1,100,{runId:'new'}));const s=t.snapshot();assert.equal(s.totalUpdates,1);s.points[0].close=3;assert.equal(t.snapshot().points[0].close,100);
});

test('historical snapshots and higher-timeframe backlog cannot prime a live trace or invent pre-baseline gaps',()=>{
  const t=createLiveIntrabar();
  const historical=packet(1,100,{kind:'snapshot',bars:[{time:0,open:100,high:105,low:95,close:100,closed:true}]});
  assert.equal(t.ingest(historical),false);
  assert.equal(t.ingest(packet(80,100,{kind:'timeframe_snapshot',runId:'historical'})),false);
  assert.equal(t.ingest(packet(300,100,{kind:'timeframe_update'})),false);
  let s=t.snapshot();assert.equal(s.runId,null);assert.equal(s.barTime,null);assert.equal(s.retainedPoints,0);assert.equal(s.missingSequences,0);
  assert.equal(t.ingest(packet(500)),true);
  s=t.snapshot();assert.equal(s.runId,'run');assert.equal(s.totalUpdates,1);assert.equal(s.latest.sequence,500);assert.equal(s.missingSequences,0);
  t.ingest(packet(501,100,{kind:'timeframe_update'}));t.ingest(packet(502,101));
  assert.equal(t.snapshot().missingSequences,0);assert.equal(t.snapshot().totalUpdates,2);
  t.ingest(packet(505,102));assert.equal(t.snapshot().missingSequences,2);
});

test('unrelated historical or higher-timeframe runs cannot reset an initialized live trace',()=>{
  const t=createLiveIntrabar();t.ingest(packet(500));
  t.ingest(packet(900,100,{kind:'timeframe_update',runId:'other'}));
  t.ingest(packet(901,100,{kind:'snapshot',runId:'other',bars:[{time:0,open:100,high:105,low:95,close:100,closed:true}]}));
  assert.equal(t.snapshot().runId,'run');assert.equal(t.snapshot().latest.sequence,500);assert.equal(t.snapshot().missingSequences,0);
  t.ingest(packet(501,101));assert.equal(t.snapshot().missingSequences,0);
  t.ingest(packet(900,101,{runId:'new'}));assert.equal(t.snapshot().runId,'new');assert.equal(t.snapshot().missingSequences,0);assert.equal(t.snapshot().totalUpdates,1);
});

test('same-run historical/closed packets consume global sequences only after live baseline exists',()=>{
  const t=createLiveIntrabar();
  t.ingest(packet(1,100,{bars:[{time:0,open:100,high:105,low:95,close:100,closed:true}]}));
  assert.equal(t.snapshot().runId,null);assert.equal(t.snapshot().missingSequences,0);
  t.ingest(packet(500));
  t.ingest(packet(501,100,{kind:'snapshot',bars:[{time:0,open:100,high:105,low:95,close:100,closed:true}]}));
  t.ingest(packet(502,100,{bars:[{time:1000,open:100,high:105,low:95,close:100,closed:true}]}));
  t.ingest(packet(503,101));
  const s=t.snapshot();assert.equal(s.totalUpdates,2);assert.equal(s.retainedPoints,2);assert.equal(s.missingSequences,0);
});

test('invalid base updates do not initialize or erase a valid trace and retained observations remain bounded',()=>{
  const t=createLiveIntrabar({maxPoints:2});
  assert.equal(t.ingest(packet(200,100,{bars:[{time:1000,open:100,high:99,low:95,close:100,closed:false}]})),false);
  assert.equal(t.snapshot().runId,null);
  t.ingest(packet(500));
  assert.equal(t.ingest(packet(900,100,{runId:'bad',bars:[{time:1000,open:100,high:99,low:95,close:100,closed:false}]})),false);
  assert.equal(t.snapshot().runId,'run');
  t.ingest(packet(501,101));t.ingest(packet(502,102));
  const s=t.snapshot();assert.equal(s.totalUpdates,3);assert.equal(s.retainedPoints,2);assert.equal(s.missingSequences,0);assert.equal(s.points[0].sequence,501);assert.equal(s.completeTickHistory,false);
});
