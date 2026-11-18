import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encodeFrame,makeWindowFixture,rows} from './window-reader-fixture.mjs';
import {roiBrrEventId,selectRoiBrrLiveSignal} from '../roi-brr-live-signal.mjs';

const closeTime=Date.UTC(2026,10,14,12),sourceUrl='https://www.tradingview.com/chart/ARROWFR1/',wall=closeTime+1000;
const options={allowResearchLiveMultiChart:true};
function fixture(side=1){
  const f=makeWindowFixture(),Node=f.canvas.constructor,closed=rows(20,60000).at(-1);
  f.context.location.href=sourceUrl;
  const study=new Node(),header=new Node({title:'Roi | 5M Break + 1M Retest & Rejection v1.2 (Auto 5M pivots)'}),priceTicks=closed.close/.25;
  const display={PROTOCOL:1,READY_CLOSE:closeTime,READY_SIDE:side,READY_PRICE_TICKS:priceTicks,READY_CHECK:((closeTime%1000000007)*131+(side+1)*17+priceTicks)%1000000007};
  const values={};
  const labels=Object.entries(display).map(([key,n])=>{
    const title='ARROW_BRR_'+key,label=new Node({'data-test-id-value-title':title}),value=new Node({},String(n)),parent=new Node();
    label.parentElement=parent;value.parentElement=parent;parent.children=[label,value];values[key]=value;return label;
  });
  study.querySelectorAll=selector=>selector.startsWith('span[title]')?[header]:selector==='[data-test-id-value-title^="ARROW_BRR_"]'?labels:[];
  f.document.studies.push(study);
  return {f,study,values,closed};
}

test('the serialized Data Window reader ties both arrows to the exact provider-closed price and revokes private observations',()=>{
  for(const [side,direction] of [[1,'LONG'],[-1,'SHORT']]){
    const {f,values,closed}=fixture(side);
    const first=f.read(options);
    assert.equal(first.roiBrrStatus,'READY');
    assert.equal(first.roiBrr.closeTime,closeTime);
    assert.equal(first.roiBrr.priceTicks,closed.close/.25);
    assert.equal(first.roiBrr.direction,direction);
    values.READY_CHECK.textContent='123';
    assert.equal(f.read(options).roiBrr,null);
    assert.equal(f.context[Symbol.for('arrow.roi-brr-live-observation.v1')],undefined);
  }
});

test('duplicate studies, Replay, and a READY from a different candle cannot become a live signal',()=>{
  const duplicate=fixture();duplicate.f.document.studies.push(duplicate.study);
  assert.equal(duplicate.f.read(options).roiBrrStatus,'MULTIPLE_STUDIES');
  const replay=fixture();replay.f.replay.attrs['aria-pressed']='true';assert.equal(replay.f.read(options).roiBrr,null);
  const old=fixture();const next=closeTime+60000;
  old.f.advance(60000);old.f.setRaw(encodeFrame({bootstrap:old.f.bootstrap,sequence:2,sourceAt:next+1000,base:rows(20,60000,next)}));
  assert.equal(old.f.read(options).roiBrr,null);
});

test('a delayed Pine read can reuse only the same recently verified post-bootstrap close',()=>{
  const {f,closed}=fixture(-1),observed=f.read(options).roiBrr,runId=f.bootstrap.runId;
  const source={sessionId:'fixture',runId,sourceUrl,now:wall},origin={generation:2,runId,closeTime,receivedAt:wall-100};
  const state={bars:[{...closed,finalOhlcVerified:true}],metadata:f.bootstrap.metadata,liveEligible:true,generation:2,bootstrapAsOfTime:closeTime-1000};
  assert.equal(selectRoiBrrLiveSignal(observed,state,origin,source).eventId,roiBrrEventId(closeTime,'SHORT'));
  for(const [nextState,nextOrigin,nextSource] of [[{...state,liveEligible:false},origin,source],[{...state,bootstrapAsOfTime:closeTime},origin,source],
    [state,{...origin,generation:1},source],[state,origin,{...source,now:wall+2001}],[state,origin,{...source,sessionId:'wrong'}]]){
    assert.equal(selectRoiBrrLiveSignal(observed,nextState,nextOrigin,nextSource),null);
  }
});

test('Pine sends Arrow the confirmed rejection independently of Tester orders and limits',async()=>{
  const pine=await readFile(new URL('../tradingview-roi-brr.pine',import.meta.url),'utf8');
  const detector=pine.slice(pine.indexOf('method detect('),pine.indexOf('var BrrSetup arrowSetup'));
  assert.match(detector,/confirmed := setup\.direction \* \(close - open\) > 0 and setup\.direction \* \(close - setup\.frozenLevel\) > rejectionBuffer/);
  assert.doesNotMatch(detector,/strategy\.|maxRiskUSD|maxStopPoints|maxEntryDistance/);
  assert.match(pine,/\[breakEvent, arrowReady, cancelEvent\] = arrowSetup\.detect\(true\)\s+bool readyLong = arrowReady and arrowSetup\.direction == 1\s+bool readyShort = arrowReady and arrowSetup\.direction == -1\s+if arrowReady\s+arrowSetup\.finish\(\)/);
  assert.match(pine,/var BrrSetup testerSetup = BrrSetup\.new\(\)/);
  assert.match(pine,/if testerRejection[\s\S]+?if validRisk and validDistance[\s\S]+?strategy\.entry\("L"[\s\S]+?else\s+testerSetup\.finish\(\)\s+testerBlocked := true/);
  assert.match(pine,/if barstate\.isrealtime and barstate\.isconfirmed and \(readyLong or readyShort\)\s+arrowReadyClose := time_close/);
  assert.match(pine,/plotchar\(readyLong,[^\n]+char = "■", location = location\.belowbar,[^\n]+size = size\.small, text = "L"/);
  assert.match(pine,/plotchar\(readyShort,[^\n]+char = "■", location = location\.abovebar,[^\n]+size = size\.small, text = "S"/);
  assert.match(pine,/strategy\.entry\("L", strategy\.long, qty = 1, stop = entryPrice/);
  assert.match(pine,/strategy\.entry\("S", strategy\.short, qty = 1, stop = entryPrice/);
});
