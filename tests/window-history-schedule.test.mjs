import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';

const source=await readFile(new URL('../tradingview-data-window-bridge.pine',import.meta.url),'utf8');
// Evaluate the producer's ACTUAL pure scheduling function. This deliberately
// accepts only its small assignment/if/tuple subset, rather than reproducing
// its algorithm in a JavaScript model. TradingView compilation remains required.
function producerSchedule(){
  const text=source.split('// BEGIN_HISTORY_SCHEDULE')[1]?.split('// END_HISTORY_SCHEDULE')[0]?.trim();
  assert.ok(text,'bounded scheduling function is explicitly delimited');
  const [header,...lines]=text.split(/\r?\n/),args=/^historySchedule\((.+)\) =>$/.exec(header)?.[1].split(',').map(arg=>arg.trim().replace(/^(?:int|bool) /,''));assert.ok(args);
  const generated=[],blocks=[];
  const expression=text=>text.replace(/\band\b/g,'&&').replace(/\bor\b/g,'||');
  for(const raw of lines){
    if(!raw.trim())continue;const indent=raw.length-raw.trimStart().length,line=raw.trim();
    while(blocks.length&&indent<=blocks.at(-1)){generated.push('}');blocks.pop();}
    if(line.startsWith('if ')){generated.push('if('+expression(line.slice(3))+'){');blocks.push(indent);}
    else if(line==='else'){generated.push('else{');blocks.push(indent);}
    else if(/^(?:int|bool) \w+ = /.test(line))generated.push(expression(line.replace(/^(?:int|bool) /,'let '))+';');
    else if(/^\w+ := /.test(line))generated.push(expression(line.replace(' := ',' = '))+';');
    else if(/^\[[\w, ]+\]$/.test(line))generated.push('return '+line+';');
    else assert.fail('Unsupported Pine scheduler statement: '+line);
  }
  while(blocks.length){blocks.pop();generated.push('}');}
  return new Function(...args,generated.join('\n'));
}
const schedule=producerSchedule();

test('the actual producer schedule prioritizes eight recent rows and then resumes its preserved100-slot cursor',()=>{
  let scan=49,recent=0,remaining=8,turn=true;const published=[],older=[];
  for(let step=0;step<116;step++){
    const wasRecent=remaining>0&&turn;const [slot,nextScan,nextRecent,nextRemaining,nextTurn]=schedule(scan,recent,remaining,turn);
    [scan,recent,remaining,turn]=[nextScan,nextRecent,nextRemaining,nextTurn];published.push(slot);if(!wasRecent)older.push(slot);
    assert.ok(slot>=0&&slot<100);assert.ok(remaining>=0&&remaining<=8);assert.ok(recent>=0&&recent<=8);
  }
  assert.deepEqual(published.slice(0,16),[0,50,1,51,2,52,3,53,4,54,5,55,6,56,7,57]);
  assert.deepEqual(older.slice(0,100),Array.from({length:100},(_,index)=>(50+index)%100));assert.equal(remaining,0);
});

test('even a new base bar on EVERY rotation cannot starve any older history slot or alias the metadata phase',()=>{
  let scan=99,turn=true,phase=0;const oldSlots=[],recentSlots=[];
  for(let held=0;held<222;held++){
    phase=(phase+1)%11;if(phase===0)continue;
    // This is the adversarial case: every source execution resets recent work.
    const wasRecent=turn;const [slot,nextScan,,,nextTurn]=schedule(scan,0,8,turn);scan=nextScan;turn=nextTurn;
    (wasRecent?recentSlots:oldSlots).push(slot);
  }
  assert.ok(oldSlots.length>=100);assert.deepEqual(oldSlots.slice(0,100),Array.from({length:100},(_,index)=>index));assert.ok(recentSlots.every(slot=>slot===0));
  const code=source.split('\n').map(line=>line.replace(/\/\/.*$/,'')).join('\n'),boundary=code.slice(code.indexOf('if na(recentHistoryBaseTime)'),code.indexOf('if na(lastHistoryRotation)'));
  assert.doesNotMatch(boundary,/historyScanSlot :=|recentHistoryTurn :=/);
});

test('late pre-open connection fills the missing recent provider rows before the distant full scan and restores all100 exact closed OHLC',()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12),bootstrap={...makeBootstrap(),wireVersion:3};
  const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
  const all=indexed(rows(105,minute,start+3*minute),1),base=all.slice(-100),seedBase=all.slice(2,102),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)];
  const current={...base.at(-1),time:base.at(-1).closeTime,closeTime:base.at(-1).closeTime+minute,providerBarIndex:106,closed:false,sourceClosed:false};
  let sequence=1,sourceAt=start+3*minute+1000,slot=49;
  function raw(){
    const values=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,slot,counts:[100,20,20]});values.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1-slot),HISTORY_HIGHER1:higher[0].at(-1-slot),HISTORY_HIGHER2:higher[1].at(-1-slot)};
    for(const [name,bar]of Object.entries(groups))if(bar)values['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    return recalculateChecksums(values);
  }
  const f=makeWindowFixture({bootstrap,raw:raw()}),seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start+1000,metadata:bootstrap.metadata,baseBars:seedBase,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  f.advance(3*minute);f.read({bootstrapHistory:seed});let scan=49,recent=0,remaining=8,turn=true,result;
  for(let rotation=0;rotation<5;rotation++){
    [slot,scan,recent,remaining,turn]=schedule(scan,recent,remaining,turn);f.advance(2500);sourceAt+=2500;sequence++;f.setRaw(raw());result=f.read({needsSnapshot:true});
    if(rotation<4)assert.ok(!result.messages.some(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)).kind==='snapshot'),'missing provider rows must still block the base baseline');
  }
  const packets=result.messages.map(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length))),snapshot=packets.find(packet=>packet.kind==='snapshot');assert.ok(snapshot);assert.equal(scan,51,'full cursor did not need to wrap to the newest offsets');assert.equal(snapshot.bars.length,100);
  assert.deepEqual(snapshot.bars,base);assert.ok(snapshot.bars.every((bar,index)=>index===0||bar.providerBarIndex===snapshot.bars[index-1].providerBarIndex+1));assert.equal(result.history[0].contiguousBars,100);
});
