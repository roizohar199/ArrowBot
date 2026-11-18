import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeBootstrap,makeWindowFixture,fieldNames,recalculateChecksums} from './window-reader-fixture.mjs';

const captured=JSON.parse(await readFile(new URL('../verification/0.11.0/window-fields-example.json',import.meta.url),'utf8'));
const raw=Object.fromEntries(captured.fields.map(field=>[field.name,Number(field.value.replaceAll(',',''))]));
test('actual TradingView Data Window text retains64 safe integers, matching tags and both source-produced checksums',()=>{
  assert.deepEqual(captured.fields.map(field=>field.name),fieldNames);assert.ok(Object.values(raw).every(Number.isSafeInteger));assert.equal(raw.ARROW2_SEQ_BEGIN,360);assert.equal(raw.ARROW2_SEQ_END,360);
  const computed=recalculateChecksums({...raw});assert.equal(computed.ARROW2_CHECKSUM_A,115390688);assert.equal(computed.ARROW2_CHECKSUM_B,914808998);assert.equal(computed.ARROW2_CHECKSUM_A,raw.ARROW2_CHECKSUM_A);assert.equal(computed.ARROW2_CHECKSUM_B,raw.ARROW2_CHECKSUM_B);
  const fixture=makeWindowFixture();for(const field of captured.fields)fixture.fieldNodes.get(field.name).textContent=field.value;
  const evidence=fixture.read({bootstrap:undefined});assert.equal(evidence.reasonCodes[0],'WINDOW_METADATA_FRAME_REQUIRED');assert.equal(evidence.frame.checksumsVerified,true);assert.equal(evidence.frame.sequence,360);assert.equal(evidence.frame.runEpoch,1794651448480);
});
test('the actual frame decodes exact BTC price and volume operands through the serialized reader',()=>{
  // The capture contains a normal data frame, not an in-band metadata frame.
  // Known chart identity/numeric contract seed the codec test. UTC/session
  // strings here are test inputs, not assertions about captured metadata.
  const bootstrap=makeBootstrap();bootstrap.runEpoch=raw.ARROW2_RUN_EPOCH;bootstrap.metadata={...bootstrap.metadata,instrument:'COINBASE:BTCUSD',tickSize:.01,pointValue:1,timezone:'UTC'};bootstrap.runId=bootstrap.metadata.instrument+'|1|'+bootstrap.runEpoch;
  const fixture=makeWindowFixture({bootstrap,wallTime:1794651596902});for(const field of captured.fields)fixture.fieldNodes.get(field.name).textContent=field.value;
  const evidence=fixture.read();assert.equal(evidence.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.equal(evidence.messages.length,0);
  const frame=evidence.windowFrame;assert.equal(frame.realtime,true);assert.equal(frame.sourceEmittedAt,1794651596902);assert.equal(frame.current.time,1794651540000);assert.equal(frame.current.closeTime,1794651600000);
  assert.deepEqual([frame.current.open,frame.current.high,frame.current.low,frame.current.close,frame.current.volume],[67266.5,67294.65,67262.51,67283.29,1.096706]);
  assert.equal(frame.previous.close,67266.49);assert.equal(frame.higher[0].close,67185.48);assert.equal(frame.higher[1].close,67185.48);assert.equal(frame.historySlot,90);assert.deepEqual(frame.historyCounts,[100,100,100]);
});
