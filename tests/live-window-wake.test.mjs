import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createLiveWindowPollScheduler,validateWindowWakeMessage,windowWakeSourceCommand,WINDOW_WAKE_KIND} from '../live-window-wake.mjs';
import {makeWindowFixture,encodeFrame,rows} from './window-reader-fixture.mjs';

const wake=(sequence=1,sessionId='s',runEpoch=1794657590000)=>({kind:WINDOW_WAKE_KIND,schemaVersion:1,sessionId,runEpoch,sourceSequence:sequence});
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function clock(){let at=0,next=0;const timers=new Map();return {now:()=>at,setTimer(fn,ms){const id=++next;timers.set(id,{fn,due:at+ms});return id;},clearTimer(id){timers.delete(id);},jump(ms){at+=ms;},async advance(ms=0){const target=at+ms;let budget=10000;while(--budget){const entry=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;at=Math.max(at,entry[1].due);timers.delete(entry[0]);entry[1].fn();await flush();}if(!budget)throw Error('Timer loop exceeded budget');at=Math.max(at,target);await flush();},get size(){return timers.size;}};}
const scheduler=(time,run,options={})=>createLiveWindowPollScheduler({run,now:time.now,setTimer:time.setTimer,clearTimer:time.clearTimer,...options});

test('wake sender validation binds this extension, exact top-frame source tab, session and public chart URL',()=>{
  const sender={id:'extension-id',tab:{id:17,url:'https://www.tradingview.com/chart/a/'},frameId:0,url:'https://www.tradingview.com/chart/a/'};
  const options={extensionId:'extension-id',tabId:17,sessionId:'s'};assert.equal(validateWindowWakeMessage(wake(),sender,options).valid,true);
  for(const edit of [{id:'other'},{frameId:1},{tab:{id:18}},{url:'https://example.com/chart/a/'}])assert.equal(validateWindowWakeMessage(wake(),{...sender,...edit},options).valid,false);
  assert.equal(validateWindowWakeMessage(wake(1,'other'),sender,options).valid,false);assert.equal(validateWindowWakeMessage({...wake(),ohlc:[1,2,3,4]},sender,options).valid,false);
});
test('scheduler starts with50ms fallback, immediately reacts to source wakes and uses250ms idle checks only while wakes stay healthy',async()=>{
  const time=clock(),runs=[],s=scheduler(time,attempt=>{runs.push(attempt);return {outcome:'NO_FRESH_SOURCE_PACKET'};});s.start('s');await time.advance();assert.equal(runs.length,1);assert.equal(s.snapshot().nextDueAt,50);
  await time.advance(49);assert.equal(s.wake(wake()),true);await time.advance();assert.equal(runs.length,2);assert.equal(runs[1].cause,'source-wake');assert.equal(s.snapshot().nextDueAt,299);assert.equal(s.snapshot().attempts[1].result.outcome,'NO_FRESH_SOURCE_PACKET');
  s.transportFailed('ACK_FAILED');assert.equal(s.snapshot().nextDueAt,99);await time.advance(50);assert.equal(runs.length,3);assert.equal(s.snapshot().nextDueAt,149);s.stop();
});
test('wakes during a read coalesce into one pending read and never create concurrent reads',async()=>{
  const time=clock(),resolvers=[];let active=0,peak=0;
  const s=scheduler(time,()=>{active++;peak=Math.max(peak,active);return new Promise(resolve=>resolvers.push(value=>{active--;resolve(value);}));});s.start('s');await time.advance();
  assert.equal(s.snapshot().inflight,true);for(let sequence=1;sequence<=20;sequence++)s.wake(wake(sequence));assert.equal(s.snapshot().pending.cause,'source-wake');assert.equal(s.snapshot().counts.coalesced,19);
  time.jump(12);resolvers.shift()({outcome:'READY'});await flush();await time.advance();assert.equal(peak,1);assert.equal(s.snapshot().counts.started,2);resolvers.shift()({outcome:'WARMUP'});await flush();s.stop();assert.equal(s.snapshot().attempts.length,2);assert.equal(s.snapshot().attempts[1].wakeQueueMs,12);
});
test('source wakes bypass clamped timers immediately while an active RPC still coalesces subsequent wakes',async()=>{
  let at=0,next=0,calls=0,active=0,peak=0,release;const timers=new Map(),requested=[];
  const s=createLiveWindowPollScheduler({now:()=>at,setTimer(fn,delay){requested.push(delay);const id=++next;timers.set(id,{fn,due:at+Math.max(1000,delay)});return id;},clearTimer:id=>timers.delete(id),run(){calls++;active++;peak=Math.max(peak,active);if(calls===2)return new Promise(resolve=>{release=()=>{active--;resolve({outcome:'READY'});};});active--;return {outcome:'READY'};}});
  s.start('s');assert.equal(calls,1,'connect does not need a zero-delay timer');await flush();assert.equal(timers.size,1);assert.deepEqual(requested,[50]);
  at=10;s.wake(wake(1));assert.equal(calls,2,'source wake starts before a1000ms-clamped timer can fire');assert.equal(timers.size,0);assert.equal(s.snapshot().inflight,true);
  for(let sequence=2;sequence<=20;sequence++)s.wake(wake(sequence));assert.equal(calls,2);assert.equal(s.snapshot().counts.coalesced,18);
  at=25;release();await flush();assert.equal(calls,3,'the one pending read also dispatches without a timer');assert.equal(peak,1);assert.ok(requested.every(delay=>delay>0));const attempts=s.snapshot().attempts;assert.equal(attempts[1].dueAt,10);assert.equal(attempts[1].timerFiredAt,10);assert.equal(attempts[1].startedAt,10);s.stop();
});
test('coalesced timing retains the latest source wake and the oldest pending wait as separate boundaries',async()=>{
  const time=clock(),resolvers=[],s=scheduler(time,()=>new Promise(resolve=>resolvers.push(resolve)));s.start('s');await time.advance();s.wake(wake(1));time.jump(40);s.wake(wake(2));time.jump(40);s.wake(wake(3));time.jump(20);resolvers.shift()({outcome:'READY'});await flush();await time.advance();resolvers.shift()({outcome:'READY'});await flush();
  const latest=s.snapshot().attempts.at(-1);assert.equal(latest.wakeSourceSequence,3);assert.equal(latest.wakeReceivedAt,80);assert.equal(latest.firstQueuedAt,0);assert.equal(latest.wakeQueueMs,20);assert.equal(latest.coalescedQueueMs,100);s.stop();
});
test('visibility/focus requests replace delayed timers without pretending to be source wake messages',async()=>{
  const time=clock(),causes=[],s=scheduler(time,attempt=>causes.push(attempt.cause));s.start('s');await time.advance();time.jump(800);assert.equal(s.request('visibility-resume'),true);await time.advance();assert.deepEqual(causes,['connect','visibility-resume']);assert.equal(s.snapshot().counts.wakes,0);assert.equal(s.snapshot().attempts[1].timerLatenessMs,0);s.stop();
});
test('scheduler distinguishes delayed timer dispatch, read runtime and separate producer interframe gaps',async()=>{
  const time=clock(),s=scheduler(time,()=>{time.jump(5);return {outcome:'READY',readMs:2,processingMs:3};});s.start('s');await time.advance();
  s.recordSourceFrame({runEpoch:1,sequence:10,sourceEmittedAt:5000});s.recordSourceFrame({runEpoch:1,sequence:14,sourceEmittedAt:6000});time.jump(900);await time.advance();
  const report=s.snapshot(),latest=report.attempts.at(-1);assert.equal(latest.timerLatenessMs,850);assert.equal(latest.runtimeMs,5);assert.equal(report.sourceIntervals[0].producerInterframeMs,1000);assert.equal(report.sourceIntervals[0].sourceSequenceDelta,4);assert.equal(latest.result.processingMs,3);s.stop();
});
test('old sessions/duplicate wakes cannot schedule work, reconnect waits for the old read and stop prevents stale rescheduling',async()=>{
  const time=clock(),resolvers=[],s=scheduler(time,()=>new Promise(resolve=>resolvers.push(resolve)));s.start('s');await time.advance();s.start('new');assert.equal(s.wake(wake(1,'s')),false);assert.equal(s.snapshot().counts.started,1);
  resolvers.shift()({outcome:'OLD_READ'});await flush();await time.advance();assert.equal(s.snapshot().counts.started,2);assert.equal(s.snapshot().attempts[0].staleCompletion,true);s.stop();resolvers.shift()({outcome:'STOPPED'});await flush();assert.equal(time.size,0);assert.equal(s.request('focus-resume'),false);
});
test('all attempts and run outcomes are bounded, including errors, while oversized results cannot retain OHLC histories',async()=>{
  const time=clock();let count=0;const s=scheduler(time,()=>{if(count++===0)throw Error('expected');return {outcome:'NO_FRESH',bars:Array(10000).fill({close:1}),sourcePacketIds:Array(100).fill('id'),reasonCodes:Array(100).fill('reason')};},{maxSamples:3});s.start('s');await time.advance(250);const report=s.snapshot();assert.equal(report.retainedAttempts,3);assert.ok(report.retainedEvents<=3);assert.equal(report.counts.errors,1);assert.equal(report.attempts.at(-1).result.bars,undefined);assert.equal(report.attempts.at(-1).result.sourcePacketIds.length,8);s.stop();
});

function sourceFixture(){const fixture=makeWindowFixture(),messages=[],callbacks=[];fixture.context.chrome={runtime:{sendMessage(message,reply){messages.push(JSON.parse(JSON.stringify(message)));callbacks.push(reply);reply({ok:true});}}};fixture.context.__commandArgs={sessionId:'fixture'};const command=args=>{fixture.context.__commandArgs={sessionId:'fixture',...args};return JSON.parse(JSON.stringify(vm.runInContext('('+windowWakeSourceCommand.toString()+')(__commandArgs)',fixture.context)));};return {fixture,messages,callbacks,command};}
function warmSource(source){source.command({});source.fixture.read();for(let slot=0;slot<20;slot++){source.fixture.advance();source.fixture.setRaw(encodeFrame({sequence:slot+2,slot}));source.fixture.mutate();}return source;}

test('the last normal source frame37ms after a wake receives a trailing wake at the40ms boundary',()=>{
  const source=warmSource(sourceFixture()),{fixture,messages,command}=source,first=command({action:'read'}).samples.at(-1).at;
  fixture.advance(37);fixture.setRaw(encodeFrame({sequence:22,slot:0}));fixture.mutate();
  const pending=command({action:'read'});assert.equal(messages.length,1);assert.equal(pending.pending.sourceSequence,22);assert.ok(pending.trailingDueAt-first<=40.1);
  assert.equal(fixture.context.__arrowWindowWakeV1.notify(),false,'a timer or arbitrary caller cannot enter the observer-only notify path');
  fixture.advance(4);assert.equal(messages.length,2);assert.equal(messages.at(-1).sourceSequence,22);assert.equal(command({action:'read'}).counts.trailingSent,1);assert.equal(command({action:'read'}).pending,null);
  fixture.advance(250);assert.equal(messages.length,2,'the trailing candidate is sent only once');command({action:'stop'});
});

test('a busy source ACK retains only the latest trusted frame and flushes it without another observer event',()=>{
  const source=sourceFixture(),replies=[];source.fixture.context.chrome.runtime.sendMessage=(message,reply)=>{source.messages.push(JSON.parse(JSON.stringify(message)));replies.push(reply);};warmSource(source);
  for(let sequence=22;sequence<=41;sequence++){source.fixture.advance(3);source.fixture.setRaw(encodeFrame({sequence,slot:0}));source.fixture.mutate();}
  let stats=source.command({action:'read'});assert.equal(source.messages.length,1);assert.equal(stats.inFlight,true);assert.equal(stats.pending.sourceSequence,41);assert.equal(stats.counts.busy,20);
  replies.shift()({ok:true});stats=source.command({action:'read'});assert.equal(source.messages.length,2);assert.equal(source.messages[1].sourceSequence,41);assert.equal(stats.pending,null);assert.equal(stats.inFlight,true);assert.equal(stats.counts.trailingSent,1);
  replies.shift()({ok:true});source.fixture.advance(2000);assert.equal(source.messages.length,2);assert.equal(source.command({action:'read'}).inFlight,false);source.command({action:'stop'});
});

test('pending source hints cancel on stop, new session, hidden document, lost ownership, expired RPC lease or old observation',()=>{
  for(const reason of ['stop','session','hidden','owner','lease','age']){
    const source=warmSource(sourceFixture()),{fixture,messages,command}=source;
    if(reason==='age')fixture.context.chrome.runtime.sendMessage=(message,reply)=>{messages.push(JSON.parse(JSON.stringify(message)));};
    // For the age case hold a second actual message, then queue another frame.
    if(reason==='age'){fixture.advance(50);fixture.setRaw(encodeFrame({sequence:22,slot:0}));fixture.mutate();}
    fixture.advance(10);fixture.setRaw(encodeFrame({sequence:reason==='age'?23:22,slot:0}));fixture.mutate();assert.ok(command({action:'read'}).pending);
    const count=messages.length;
    if(reason==='stop')command({action:'stop'});
    if(reason==='session')command({sessionId:'replacement'});
    if(reason==='hidden')fixture.document.visibilityState='hidden';
    if(reason==='owner')fixture.context.__arrowWindowFeedV2={...fixture.context.__arrowWindowFeedV2};
    if(reason==='lease')fixture.context.__arrowWindowFeedV2.lastRealPollPerf-=60001;
    fixture.advance(reason==='age'?1001:50);assert.equal(messages.length,count,reason);
    if(!['stop','session'].includes(reason)){assert.equal(command({action:'read'}).pending,null,reason);assert.equal(command({action:'read'}).trailingDueAt,null,reason);}command({action:'stop',sessionId:reason==='session'?'replacement':'fixture'});
  }
});

test('serialized source transport emits no prices, wakes only after timing/cache commit and ACKs without new source clocks',()=>{
  const {fixture,messages,command}=sourceFixture();assert.equal(command({}).status,'INSTALLED');fixture.read();
  const original=fixture.context.chrome.runtime.sendMessage;fixture.context.chrome.runtime.sendMessage=(message,reply)=>{const state=fixture.context.__arrowWindowFeedV2;assert.equal(state.inObserverCallback,true);assert.equal(state.latestEvidence.windowFrame.sequence,message.sourceSequence);assert.ok(fixture.timings.some(record=>record.id.endsWith(':'+(message.sourceSequence*8+4))));original(message,reply);};
  for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot}));fixture.mutate();}
  assert.equal(messages.length,1);assert.deepEqual(Object.keys(messages[0]).sort(),['kind','runEpoch','schemaVersion','sessionId','sourceSequence']);const stats=command({action:'read'});assert.equal(stats.counts.acknowledged,1);assert.equal(stats.counts.sent,1);assert.equal(stats.retainedSamples,20);
  fixture.read();assert.equal(messages.length,1,'RPC reads do not send wakes');command({action:'stop'});assert.equal(fixture.context.__arrowWindowWakeV1,undefined);
});
test('source wake throttles normal frames, prioritizes a new final close and rejects out-of-callback or stale contexts',()=>{
  const {fixture,messages,command}=sourceFixture();command({});fixture.read();for(let slot=0;slot<20;slot++){fixture.advance();fixture.setRaw(encodeFrame({sequence:slot+2,slot}));fixture.mutate();}
  fixture.advance(10);fixture.setRaw(encodeFrame({sequence:22,slot:0}));fixture.mutate();assert.equal(messages.length,1);
  const base=rows(20,60000),prior=base.at(-1),current={...prior,time:prior.closeTime,closeTime:prior.closeTime+60000,closed:true,sourceClosed:true};fixture.advance(5);fixture.setRaw(encodeFrame({sequence:23,slot:0,base,current,sourceAt:current.closeTime}));fixture.mutate();assert.equal(messages.length,2);assert.equal(command({action:'read'}).samples.at(-1).outcome,'SENT_CLOSED_BAR_PRIORITY');
  assert.equal(command({action:'read'}).pending,null);fixture.advance(50);assert.equal(messages.length,2,'a close priority wake cancels the older normal trailing timer');
  assert.equal(fixture.context.__arrowWindowWakeV1.notify(),false);fixture.advance(60001);assert.equal(fixture.context.__arrowWindowWakeV1.notify(),false);
});
test('source transport is a bounded no-op without extension messaging and tolerates missing receivers',()=>{
  const fixture=makeWindowFixture();fixture.context.__commandArgs={sessionId:'fixture'};const result=vm.runInContext('('+windowWakeSourceCommand.toString()+')(__commandArgs)',fixture.context);assert.equal(result.apiAvailable,false);assert.equal(fixture.context.__arrowWindowWakeV1.notify(),false);
  const source=sourceFixture();source.fixture.context.chrome.runtime.sendMessage=()=>{throw Error('No receiver');};source.command({});source.fixture.read();for(let slot=0;slot<20;slot++){source.fixture.advance();source.fixture.setRaw(encodeFrame({sequence:slot+2,slot}));source.fixture.mutate();}assert.equal(source.command({action:'read'}).counts.failed,1);
});
