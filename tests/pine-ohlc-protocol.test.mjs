import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePineOhlcMessage,parsePineOhlcLogs,PINE_OHLC_PREFIX,pineFixedTimeframeMs} from '../pine-ohlc-protocol.mjs';
const at=Date.UTC(2026,0,1),receipt=at+180000;
const options={receivedAt:receipt,tabId:42};
const bar=(index,closed=true)=>({time:at+index*60000,closeTime:at+(index+1)*60000,open:100,high:102,low:99,close:101,closed,sourceClosed:closed});
const envelope=(overrides={})=>({schemaVersion:1,kind:'snapshot',runId:'SYNTHETIC|1|1234',sequence:1,sourceEmittedAt:receipt,realtime:false,dataDelayUnverified:true,metadata:{source:'ohlc',instrument:'SYNTHETIC',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,timezone:'UTC',session:'regular',chartType:'standard'},bars:[bar(0),bar(1)],reasonCodes:[],...overrides});
const message=raw=>PINE_OHLC_PREFIX+' '+JSON.stringify(raw);

test('snapshot preserves explicit OHLC/closure and enriches local receipt without inventing live status',()=>{
  const raw=envelope(),result=parsePineOhlcMessage('[2026-01-01T00:03:00Z] '+message(raw),options);
  assert.equal(result.ok,true);assert.deepEqual(result.packet.bars,raw.bars);assert.equal(result.packet.receivedAt,receipt);
  assert.equal(result.packet.metadata.sourceId,raw.runId);assert.equal(result.packet.metadata.tabId,42);assert.equal(result.packet.metadata.sourceRealtime,false);
  assert.equal(result.packet.metadata.realtime,undefined);assert.equal(result.packet.metadata.replay,undefined);assert.equal(result.packet.metadata.dataDelayUnverified,true);
  result.packet.metadata.instrument='CHANGED';assert.equal(raw.metadata.instrument,'SYNTHETIC');
});

test('realtime update can contain prior explicit final and an open current bar, never guessed finality',()=>{
  const raw=envelope({kind:'update',realtime:true,bars:[bar(1),bar(2,false)]}),result=parsePineOhlcMessage(message(raw),options);
  assert.equal(result.ok,true);assert.equal(result.packet.metadata.sourceRealtime,true);assert.equal(result.packet.metadata.realtime,undefined);
  raw.bars[0].sourceClosed=false;assert.equal(parsePineOhlcMessage(message(raw),options).reasonCodes[0],'PINE_UNVERIFIED_BAR_CLOSE');
});

test('nonstandard, unsupported, malformed or unconfirmed snapshots fail closed',()=>{
  for(const change of [raw=>raw.metadata.chartType='nonstandard',raw=>raw.metadata.timeframeMs=0,raw=>raw.metadata.tickSize=0,raw=>raw.metadata.timezone='Bad/Zone',raw=>raw.bars[0].high=90,raw=>raw.bars[0].time=raw.bars[1].time,raw=>raw.bars[0].closed=false,raw=>raw.schemaVersion=2,raw=>raw.metadata.realtime=true]){
    const raw=envelope();change(raw);assert.equal(parsePineOhlcMessage(message(raw),options).ok,false);
  }
  assert.equal(parsePineOhlcMessage(message(envelope()),{receivedAt:receipt}).ok,false);
});

test('realtime recovery snapshot remains history and does not invent a live current bar',()=>{
  const snapshot=envelope({kind:'snapshot',realtime:true,sequence:20});
  const update=envelope({kind:'update',realtime:true,sequence:21,bars:[bar(2,false)]});
  const result=parsePineOhlcLogs(message(snapshot)+'\n'+message(update),options);
  assert.equal(result.ok,true);assert.deepEqual(result.packets.map(packet=>packet.kind),['snapshot','update']);
  assert.ok(result.packets[0].bars.every(bar=>bar.closed&&bar.sourceClosed));
  assert.equal(result.packets[0].metadata.sourceRealtime,true);assert.equal(result.packets[0].metadata.realtime,undefined);
  assert.equal(result.packets[1].bars[0].closed,false);
});

test('visible multiple log rows parse JSON braces inside strings and deduplicate repeated DOM containers',()=>{
  const a=envelope({runId:'some} "quote" \\ run ARROW_OHLC_V1'}),b=envelope({sequence:2,kind:'update',realtime:true,bars:[bar(2,false)]});
  const text='Pine Logs\n[2026-01-01T00:03:00Z] '+message(a)+'\nSource code\n'+message(a)+'\n'+message(b)+'\nScroll to bar';
  const result=parsePineOhlcLogs(text,options);assert.equal(result.ok,true);assert.equal(result.packets.length,2);assert.equal(result.packets[0].runId,a.runId);
});

test('truncated, malformed, oversized or executable-looking logs are rejected without evaluation',()=>{
  const good=message(envelope());
  assert.equal(parsePineOhlcMessage(good.slice(0,-1),options).reasonCodes[0],'PINE_TRUNCATED_LOG');
  assert.equal(parsePineOhlcMessage(good+';fetch("https://example.invalid")',options).ok,false);
  assert.equal(parsePineOhlcMessage(PINE_OHLC_PREFIX+' {oops}',options).reasonCodes[0],'PINE_INVALID_JSON');
  assert.equal(parsePineOhlcMessage('x'.repeat(100001),options).reasonCodes[0],'PINE_LOG_SIZE_LIMIT');
  const text=good.slice(0,-10)+'\n'+message(envelope({sequence:2}));
  const multiple=parsePineOhlcLogs(text,options);assert.equal(multiple.ok,false);assert.equal(multiple.errors[0].reasonCodes[0],'PINE_TRUNCATED_LOG');assert.equal(multiple.packets.length,1);
});

test('diagnostic blocked messages carry a reason and cannot masquerade as usable snapshots',()=>{
  const raw=envelope({kind:'blocked',bars:[],reasonCodes:['NONSTANDARD_CHART'],metadata:{...envelope().metadata,chartType:'nonstandard',timeframeMs:null}});
  const result=parsePineOhlcMessage(message(raw),options);assert.equal(result.ok,true);assert.equal(result.packet.kind,'blocked');assert.deepEqual(result.packet.reasonCodes,['NONSTANDARD_CHART']);
  raw.bars=[bar(0)];assert.equal(parsePineOhlcMessage(message(raw),options).ok,false);
});

test('optional source currency and real numeric or missing volume preserve legacy compatibility',()=>{
  const raw=envelope();raw.metadata.currency='USD';raw.bars[0].volume=12345.5;raw.bars[1].volume=null;
  const result=parsePineOhlcMessage(message(raw),options);assert.equal(result.ok,true);
  assert.equal(result.packet.metadata.currency,'USD');assert.equal(result.packet.bars[0].volume,12345.5);assert.equal(result.packet.bars[1].volume,null);
  assert.equal(parsePineOhlcMessage(message(envelope()),options).packet.bars[0].volume,undefined);
  for(const value of [-1,'123',Infinity]){const invalid=envelope();invalid.bars[0].volume=value;assert.equal(parsePineOhlcMessage(message(invalid),options).ok,value===Infinity,'JSON serializes Infinity to null, which explicitly means missing');}
  raw.metadata.currency='USD\n';assert.equal(parsePineOhlcMessage(message(raw),options).ok,false);
});

function higherEnvelope(overrides={}){
  return envelope({kind:'timeframe_snapshot',sourceEmittedAt:at+600000,bars:[],higherTimeframes:[{timeframe:'5',timeframeMs:300000,bars:[{...bar(0),closeTime:at+300000,volume:123}],reasonCodes:[]}],...overrides});
}

test('provider-confirmed HTF envelopes keep base identity and separate bounded closed OHLCV',()=>{
  const raw=higherEnvelope(),result=parsePineOhlcMessage(message(raw),options);
  assert.equal(result.ok,true);assert.deepEqual(result.packet.bars,[]);assert.equal(result.packet.metadata.timeframe,'1');assert.deepEqual(result.packet.higherTimeframes,raw.higherTimeframes);
  const update=higherEnvelope({kind:'timeframe_update',realtime:true});assert.equal(parsePineOhlcMessage(message(update),options).ok,true);
  update.realtime=false;assert.equal(parsePineOhlcMessage(message(update),options).ok,false);
});

test('open, future, mismatched, lower, calendar and excessive higher data cannot enter the provider series',()=>{
  for(const mutate of [
    raw=>raw.higherTimeframes[0].bars[0].closed=false,
    raw=>raw.higherTimeframes[0].bars[0].sourceClosed=false,
    raw=>raw.sourceEmittedAt=at+299999,
    raw=>raw.higherTimeframes[0].timeframeMs=600000,
    raw=>raw.higherTimeframes[0].timeframe='1D',
    raw=>raw.higherTimeframes[0].timeframe='1',
    raw=>raw.bars=[bar(0)],
    raw=>raw.higherTimeframes.push(structuredClone(raw.higherTimeframes[0])),
    raw=>raw.higherTimeframes[0].bars=[],
    raw=>raw.higherTimeframes[0].instrument='OTHER',
    raw=>raw.higherTimeframes[0].bars[0].volume=-1,
  ]){const raw=higherEnvelope();mutate(raw);assert.equal(parsePineOhlcMessage(message(raw),options).ok,false);}
  const many=higherEnvelope({sourceEmittedAt:at+40000000});many.higherTimeframes[0].bars=Array.from({length:101},(_,i)=>({...bar(0),time:at+i*300000,closeTime:at+(i+1)*300000}));
  assert.equal(parsePineOhlcMessage(message(many),options).ok,false);
  assert.equal(parsePineOhlcMessage(message(envelope({higherTimeframes:[]})),options).ok,false);
});

test('unsupported HTF choices are explicit empty diagnostics, never invented provider bars',()=>{
  for(const tf of ['1D','1']){
    const raw=higherEnvelope();raw.higherTimeframes[0]={timeframe:tf,timeframeMs:tf==='1'?60000:null,bars:[],reasonCodes:['HIGHER_TIMEFRAME_MUST_EXCEED_BASE']};
    const result=parsePineOhlcMessage(message(raw),options);assert.equal(result.ok,true);assert.deepEqual(result.packet.higherTimeframes[0].bars,[]);
  }
  assert.equal(pineFixedTimeframeMs('1S'),1000);assert.equal(pineFixedTimeframeMs('15'),900000);
  for(const tf of ['0','1D','1W','1M','1.5','15m','-1',15])assert.equal(pineFixedTimeframeMs(tf),null);
});
