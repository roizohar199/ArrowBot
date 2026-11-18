import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE,PRICE_BASE,taggedFields} from './window-reader-fixture.mjs';

const sourceAt=Date.UTC(2026,10,14,12)+1000,end=Date.UTC(2026,10,13,18);
const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
function payload({bootstrap,sequence=0,flags=1,metadataFrame=false}){
  const base=indexed(rows(20,60000,end),100),higher=[indexed(rows(20,300000,end),200),indexed(rows(20,900000,end),300)],current={...base.at(-1),time:end,closeTime:end+60000,providerBarIndex:120,closed:false,sourceClosed:false};
  const raw=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt:sourceAt+sequence,flags});raw.ARROW2_PROTOCOL=3;
  const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
  for(const [name,bar] of Object.entries(groups))raw['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
  if(metadataFrame){
    raw.ARROW2_HISTORY_STATE+=134217728;
    const m=bootstrap.metadata,text=['3',m.instrument,m.timeframe,m.timezone,m.session,m.currency].join('|'),bytes=Array.from(text,char=>char.charCodeAt(0));while(bytes.length<84)bytes.push(0);
    taggedFields.slice(37).forEach((field,index)=>{const offset=index*4,word=bytes[offset]*16777216+bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3];raw[field.name]=sequence%4096*(field.kind==='price'?PRICE_BASE:SCALAR_BASE)+word;});
  }
  return recalculateChecksums(raw);
}
function fixture(options={}){const bootstrap={...makeBootstrap(),wireVersion:3},f=makeWindowFixture({bootstrap,raw:payload({bootstrap,...options})});f.replay.attrs['aria-pressed']='true';return {bootstrap,f};}
function assertReplayOnly(output){assert.equal(output.reasonCodes[0],'WINDOW_PRESESSION_CONTEXT_ONLY');assert.equal(output.contextOnly,true);assert.equal(output.liveEligible,false);assert.deepEqual(output.messages,[]);assert.equal(output.replayWitness.replay,true);assert.equal(output.replayWitness.liveEligible,false);assert.equal(output.replayWitness.checksumsVerified,true);assert.equal(output.historicalContext.mode,'REPLAY');}

test('explicit Replay remains context-only even when Pine stepping reports realtime execution',()=>{
  const {bootstrap,f}=fixture({flags:3});const output=f.read();assertReplayOnly(output);assert.equal(output.replayWitness.pineRealtimeExecution,true);assert.equal(output.replayWitness.current.closed,false);assert.equal(output.replayWitness.previous.closed,true);assert.equal(f.context.__arrowWindowFeedV2.series,undefined,'Replay never initializes a LIVE history/emission state');assert.equal(f.context.__arrowWindowFeedV2.pendingMessages.size,0);
  f.advance(200);f.setRaw(payload({bootstrap,sequence:6,flags:3}));assertReplayOnly(f.read());assert.equal(f.context.__arrowWindowFeedV2.pendingMessages.size,0);
});

test('validated metadata-zero Replay frame caches its binding for the following nonmetadata realtime step in the same session',()=>{
  const {bootstrap,f}=fixture({sequence:0,flags:1,metadataFrame:true});const initial=f.read({bootstrap:undefined});assertReplayOnly(initial);assert.equal(initial.replayWitness.sequence,0);assert.deepEqual(JSON.parse(JSON.stringify(f.context.__arrowWindowFeedV2.bootstrap)),initial.bootstrapMetadata);
  f.advance(200);f.setRaw(payload({bootstrap,sequence:6,flags:3}));const advanced=f.read({bootstrap:undefined});assertReplayOnly(advanced);assert.equal(advanced.replayWitness.sequence,6);assert.equal(advanced.replayWitness.runId,initial.replayWitness.runId);assert.equal(advanced.replayWitness.current.time,end);assert.equal(advanced.replayWitness.previous.closeTime,end);assert.equal(advanced.replayWitness.pineRealtimeExecution,true);
  const differentSession=f.read({bootstrap:undefined,sessionId:'another-replay-session'});assert.equal(differentSession.reasonCodes[0],'WINDOW_METADATA_FRAME_REQUIRED');assert.equal(differentSession.replayWitness,undefined);assert.deepEqual(differentSession.messages,[]);
});

test('Replay metadata is never borrowed across a changed epoch or cached from an invalid checksum',()=>{
  const {bootstrap,f}=fixture({metadataFrame:true});assertReplayOnly(f.read({bootstrap:undefined}));const changed=structuredClone(bootstrap);changed.runEpoch++;changed.runId=changed.metadata.instrument+'|1|'+changed.runEpoch;
  f.advance(200);f.setRaw(payload({bootstrap:changed,sequence:6,flags:3}));const missing=f.read({bootstrap:undefined});assert.equal(missing.reasonCodes[0],'WINDOW_METADATA_FRAME_REQUIRED');assert.equal(missing.replayWitness,undefined);assert.deepEqual(missing.messages,[]);assert.equal(f.context.__arrowWindowFeedV2.bootstrap.runEpoch,bootstrap.runEpoch);
  const corrupt=payload({bootstrap:changed,sequence:7,flags:3,metadataFrame:true});corrupt.ARROW2_CHECKSUM_A++;f.setRaw(corrupt);const invalid=f.read({bootstrap:undefined});assert.equal(invalid.reasonCodes[0],'WINDOW_FRAME_CHECKSUM_MISMATCH');assert.equal(invalid.replayWitness,undefined);assert.equal(f.context.__arrowWindowFeedV2.bootstrap.runEpoch,bootstrap.runEpoch);
  f.setRaw(payload({bootstrap:changed,sequence:8,flags:3,metadataFrame:true}));const rebound=f.read({bootstrap:undefined});assertReplayOnly(rebound);assert.equal(rebound.replayWitness.runEpoch,changed.runEpoch);assert.equal(f.context.__arrowWindowFeedV2.bootstrap.runEpoch,changed.runEpoch);
});
