import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceDomLatency} from '../live-source-timing.mjs';
const setup=()=>{const timing=createSourceDomLatency();timing.reset('session');return timing;};
const observation=(records,extra={})=>({status:'OK',sessionId:'session',sourceEpoch:100500,records,limited:0,...extra});
const record=(id='run:1',appearanceEpochMs=100300)=>({id,appearanceEpochMs,initial:false,documentVisible:true});
const bracket={beforeEpoch:200500,afterEpoch:200510,receiverTimeOrigin:200000};
const paint=(eventId='read:1')=>({eventId,mutationAt:540,firstPaintOpportunityAt:550,secondPaintOpportunityAt:570});
test('source appearance calibration bounds asymmetric RPC without assuming clock sync',()=>{
  const t=setup();assert.equal(t.observe(observation([record()]),bracket),true);t.associate('read:1','run:1');
  const result=t.complete(paint());assert.equal(result.sourceToMutationLowerMs,230);assert.equal(result.sourceToMutationUpperMs,240);assert.equal(result.sourceToPaintLowerMs,240);assert.equal(result.sourceToPaintUpperMs,270);assert.equal(t.snapshot().marketToDisplayMeasured,false);
});
test('initial visible logs cannot be backdated as new source appearances',()=>{
  const t=setup();t.observe(observation([{...record(),initial:true,appearanceEpochMs:null}]),bracket);
  assert.equal(t.associate('read:1','run:1'),false);assert.equal(t.complete(paint()),false);assert.equal(t.snapshot().excluded.ALREADY_PRESENT_AT_OBSERVER_START,1);
});
test('wrong session, invalid brackets, future appearances and hidden source are excluded',()=>{
  const t=setup();assert.equal(t.observe(observation([],{sessionId:'other'}),bracket),false);
  assert.equal(t.observe(observation([]),{...bracket,afterEpoch:200499}),false);
  assert.equal(t.observe(observation([]),{...bracket,afterEpoch:202000}),false);
  t.observe(observation([record('future',100600),{...record('hidden'),documentVisible:false}]),bracket);
  for(const id of ['future','hidden','absent'])assert.equal(t.associate('read:1',id),false);
  assert.equal(t.snapshot().samples.length,0);
});
test('render correlation requires the same event and cannot survive a reset',()=>{
  const t=setup();t.observe(observation([record()]),bracket);t.associate('read:1','run:1');assert.equal(t.complete(paint('read:2')),false);
  t.reset('new');assert.equal(t.complete(paint()),false);assert.equal(t.snapshot().samples.length,0);
});
test('duplicate observations retain first appearance and samples are bounded',()=>{
  const t=createSourceDomLatency({maxSamples:2});t.reset('session');t.observe(observation([record()]),bracket);
  t.observe(observation([record('run:1',100490)]),bracket);
  for(let i=0;i<3;i++){t.associate('read:'+i,'run:1');t.complete(paint('read:'+i));}
  const report=t.snapshot();assert.equal(report.samples.length,2);assert.equal(report.metrics.sourceToPaintUpperMs.p95Ms,270);
  report.samples[0].packetId='edited';assert.equal(t.snapshot().samples[0].packetId,'run:1');
});

const windowRecord=(extra={})=>({...record('run:84'),transport:'PUBLIC_DATA_WINDOW_V2',sourceSequence:10,meaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME',...extra});
const windowObservation=(records=[windowRecord()],extra={})=>observation(records,{documentTimeOrigin:100000,documentVisible:true,...extra});
test('packet origin is available without any result sample and keeps the original owned source/calibration boundaries',()=>{
  let at=10;const t=createSourceDomLatency({now:()=>at});t.reset('session');assert.equal(t.originFor('run:84'),null);
  assert.equal(t.observe(windowObservation(),bracket),true);
  assert.deepEqual(t.originFor('run:84'),{kind:'OWNED_SOURCE_PACKET_ORIGIN_V1',sessionId:'session',packetId:'run:84',sourceAppearanceEpochMs:100300,sourceDocumentTimeOrigin:100000,sourceSequence:10,sourceTransport:'PUBLIC_DATA_WINDOW_V2',sourceObservationMeaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME',calibrationBracketMs:10,calibration:{receiverTimeOrigin:200000,sourceAppearanceEarliestReceiverPerformanceMs:300,sourceAppearanceLatestReceiverPerformanceMs:310}});
  assert.equal(t.snapshot().samples.length,0);assert.equal(t.originFor('run:85'),null,'another packet cannot borrow the origin');
  at=20;t.observe(windowObservation([windowRecord({appearanceEpochMs:100490})]),{...bracket,beforeEpoch:200520,afterEpoch:200530});
  assert.equal(t.originFor('run:84').sourceAppearanceEpochMs,100300,'later reads cannot freshen an existing origin');assert.equal(t.originFor('run:84').calibration.sourceAppearanceEarliestReceiverPerformanceMs,300,'first calibration stays fixed');
  const copy=t.originFor('run:84');copy.packetId='edited';copy.calibration.receiverTimeOrigin=0;assert.equal(t.originFor('run:84').packetId,'run:84');assert.equal(t.originFor('run:84').calibration.receiverTimeOrigin,200000);
});
test('initial, missing, hidden, malformed and non-owned packet origins cannot be manufactured by lookup',()=>{
  const variants=[
    {initial:true,appearanceEpochMs:null},
    {appearanceEpochMs:100600},
    {appearanceEpochMs:NaN},
    {appearanceEpochMs:99999},
    {documentVisible:false},
    {sourceSequence:null},
    {sourceSequence:-1},
    {sourceSequence:11},
    {transport:'PUBLIC_PINE_LOG_DOM'},
    {meaning:'UNVERIFIED'},
  ];
  for(const change of variants){const t=setup();t.observe(windowObservation([windowRecord(change)]),bracket);assert.equal(t.originFor('run:84'),null,JSON.stringify(change));}
  const t=setup();t.observe(windowObservation(),bracket);for(const id of [null,'','missing','run:84\n',{},84])assert.equal(t.originFor(id),null);
});
test('source origin expires on the monotonic receiver clock even without another source poll',()=>{
  let at=10;const t=createSourceDomLatency({maxAgeMs:1000,now:()=>at});t.reset('session');t.observe(windowObservation(),bracket);
  at=810;assert.ok(t.originFor('run:84'),'the original200msage plus800ms elapsed is still exactly within the bound');at=811;assert.equal(t.originFor('run:84'),null);assert.equal(t.snapshot().samples.length,0);
  at=9;assert.equal(t.originFor('run:84'),null,'a regressed monotonic lookup clock cannot grant timing');
});
test('source origin requires the current observer document/session and a valid latest calibration',()=>{
  for(const change of [{status:'STOPPED'},{sessionId:'other'},{documentVisible:false},{documentTimeOrigin:100001},{documentTimeOrigin:null}]){
    const t=setup();t.observe(windowObservation(),bracket);assert.ok(t.originFor('run:84'));t.observe(windowObservation([],change),bracket);assert.equal(t.originFor('run:84'),null,JSON.stringify(change));
  }
  const t=setup();t.observe(windowObservation(),bracket);t.observe(windowObservation(),{...bracket,afterEpoch:200499});assert.equal(t.originFor('run:84'),null);
  t.observe(windowObservation(),{...bracket,receiverTimeOrigin:199999});assert.equal(t.originFor('run:84'),null,'a different receiver document cannot reuse a previous calibration');
  t.reset('new-session');assert.equal(t.originFor('run:84'),null);t.observe(windowObservation(),bracket);assert.equal(t.originFor('run:84'),null,'an old observer response cannot repopulate a reset session');
});
