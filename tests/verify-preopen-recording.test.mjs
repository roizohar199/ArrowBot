import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyPreopenRecording} from '../scripts/verify-preopen-recording.mjs';

// Immutable recorded closed-market evidence is the baseline. Mutations below
// are deliberate forgeries and never change the captured source file.
const actual=JSON.parse(await readFile(new URL('../verification/0.13.0/nq-preopen-window-session.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(actual);

test('recorded paired NQ preopen context validates100/100/100 and37/38tick arithmetic without a live-positive or latency claim',()=>{
  const data=fixture(),before=JSON.stringify(data),report=verifyPreopenRecording(data);assert.equal(report.status,'VERIFIED_PREOPEN_CONTEXT_ONLY');assert.deepEqual(report.reasonCodes,[]);assert.deepEqual(report.series.map(series=>series.bars),[100,100,100]);assert.deepEqual(report.series.map(series=>series.verifiedSessionGaps.length),[0,0,1]);assert.equal(report.retainedSeedSchemaAndProofReparsed,true);assert.equal(report.liveSignalVerified,false);assert.equal(report.naturalLivePositive,false);assert.equal(report.liveLatencyMs,null);assert.equal(report.riskExamples[0].perContractRiskUsd,198.1);assert.equal(report.riskExamples[0].quantity,1);assert.equal(report.riskExamples[1].perContractRiskUsd,203.1);assert.equal(report.riskExamples[1].quantity,0);assert.equal(report.riskAssumptions.commissionVerified,false);assert.ok(!JSON.stringify(report).includes(data.account.review.profile.id));assert.equal(JSON.stringify(data),before);
});

test('a different run, bootstrap contract or per-source metadata cannot borrow the prepared seed',()=>{
  for(const edit of [data=>{data.windowEvidence.frame.runEpoch++;},data=>{data.windowEvidence.bootstrapMetadata.encoding.historyHoldMs=500;},data=>{data.preopenContext.bootstrapHistory.metadata.tickSize=.5;}]){const data=fixture();edit(data);const report=verifyPreopenRecording(data);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.some(reason=>/PAIRING|METADATA|BOOTSTRAP|SEED/.test(reason)));}
});

test('missing provider rows or unproved session flags fail rather than guessing a market-closed gap',()=>{
  for(const edit of [data=>{data.preopenContext.bootstrapHistory.baseBars[50].providerBarIndex++;},data=>{data.preopenContext.bootstrapHistory.higherTimeframes[1].bars[9].sessionFirst=false;}]){const data=fixture();edit(data);const report=verifyPreopenRecording(data);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.some(reason=>/PROVIDER_SESSION_PROOF_INVALID/.test(reason)));assert.equal(report.retainedSeedSchemaAndProofReparsed,false);}
});

test('an incomplete or open seed cannot keep the reported100bar ready status',()=>{
  for(const edit of [data=>{data.preopenContext.bootstrapHistory.baseBars.pop();},data=>{data.preopenContext.bootstrapHistory.higherTimeframes[0].bars[0].closed=false;},data=>{data.preopenContext.bootstrapHistory.baseBars[0].volume=1.00000001;}]){const data=fixture();edit(data);const report=verifyPreopenRecording(data);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.some(reason=>/COUNT|ROWS_INVALID|SEED/.test(reason)));}
});

test('current alerts, a realtime frame or fabricated zero-millisecond percentiles cannot pass a preopen audit',()=>{
  for(const [edit,reason]of [[data=>{data.alerts.push({signal:{status:'CONFIRMED'}});},'CURRENT_NONLIVE_LEDGER_NOT_EMPTY:alerts'],[data=>{data.windowEvidence.frame.realtime=true;},'NONREALTIME_COHERENT_INITIAL_FRAME_REQUIRED'],[data=>{data.latency.metrics.analysisMs.p50Ms=0;},'NO_FABRICATED_ZERO_MS_PERCENTILES:latency']]){const data=fixture();edit(data);const report=verifyPreopenRecording(data);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.includes(reason));assert.equal(report.liveLatencyMs,null);assert.equal(report.naturalLivePositive,false);}
});

test('research fees, account review timing and disabled orders remain explicit invariants',()=>{
  for(const edit of [data=>{data.account.review.profile.commissionPerContract=0;},data=>{data.account.review.reviewedAt=data.observationSession.startedAtWall+1;},data=>{data.account.ordersAuthorized=true;}]){const data=fixture();edit(data);const report=verifyPreopenRecording(data);assert.equal(report.status,'MISMATCH');assert.ok(report.reasonCodes.length);}
});

test('missing audit sections produce a mismatch without throwing or inventing measurements',()=>{
  const data=fixture();delete data.appliedOptions;const report=verifyPreopenRecording(data);assert.equal(report.status,'MISMATCH');assert.equal(report.liveLatencyMs,null);assert.equal(verifyPreopenRecording({}).status,'MISMATCH');
});
