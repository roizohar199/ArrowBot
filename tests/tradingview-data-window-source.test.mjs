import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../tradingview-data-window-bridge.pine',import.meta.url),'utf8');
const code=source.split('\n').map(line=>line.replace(/\/\/.*$/,'')).join('\n');
const row=['TIME','CLOSE_TIME','OPEN','HIGH','LOW','CLOSE','VOLUME'];
const payloadNames=['SOURCE_EPOCH','BASE_MS','TICK','POINT','HIGHER1_MS','HIGHER2_MS','SUPPORTED','HISTORY_STATE',...row.concat('CLOSED').map(name=>'CURRENT_'+name),...['PREVIOUS','HIGHER1','HIGHER2','HISTORY_BASE','HISTORY_HIGHER1','HISTORY_HIGHER2'].flatMap(group=>row.map(name=>group+'_'+name))];

// Static producer-contract audits and integer-bound checks, not a Pine runtime
// emulator. TradingView compilation/live tests remain independently required.
test('public-window producer has exactly the64 agreed, uniquely named numeric-only plots',()=>{
  const lines=code.split('\n').filter(line=>/^plot\(/.test(line));
  const names=lines.map(line=>/"ARROW2_([A-Z0-9_]+)"/.exec(line)?.[1]);
  assert.equal(lines.length,64);assert.deepEqual(names,['PROTOCOL','RUN_EPOCH','SEQ_BEGIN',...payloadNames,'CHECKSUM_A','CHECKSUM_B','SEQ_END']);assert.equal(new Set(names).size,64);
  for(const line of lines){assert.match(line,/^plot\(publish \?/);assert.match(line,/display = display\.data_window/);assert.match(line,/format = format\.price, precision = 0/);assert.match(line,/editable = false/);}
  assert.equal(payloadNames.length,58);assert.doesNotMatch(code,/alertcondition\(|strategy\.|bgcolor\(|barcolor\(/);
});

test('window transport emits only one bounded optional bootstrap burst and keeps bounded numeric state',()=>{
  assert.equal((code.match(/log\.(?:info|error|warning)\(/g)??[]).length,3);assert.doesNotMatch(code,/metadataLogged|ARROW_WINDOW_META/);
  assert.match(code,/calc_bars_count = 102/);assert.equal((code.match(/calc_bars_count = historyCount \+ 2/g)??[]).length,2);
  assert.match(code,/varip array<float> payload = array\.new<float>\(58, na\)/);assert.match(code,/matrix\.new<float>\(historyCount, 10, na\)/);assert.doesNotMatch(code,/varip array<string>|matrix\.add_/);
  assert.match(code,/if emitBootstrap and not bootstrapEmitted and barstate\.islast/);assert.match(code,/bootstrapEmitted := true/);assert.match(code,/str\.length\(baseBootstrap\) <= 40960/);assert.match(code,/totalBootstrapChars <= 122880/);
  assert.match(code,/int bootstrapSourceAt = timenow/);assert.equal((code.match(/Duration, bootstrapSourceAt, /g)??[]).length,3);assert.match(code,/sourceEmittedAt":' \+ n\(sourceAt\)/);
  assert.match(code,/\[barstate\.islast \? cached : na, barstate\.islast \? count : 0\]/);assert.match(code,/for offset = 1 to available/);
});

test('held newest-first history slots avoid modulo sampling aliasing and preserve real execution flags',()=>{
  assert.match(code,/int historyHoldMs = 200/);assert.match(code,/if barstate\.isrealtime\n\s+sourceSequence \+= 1/);assert.match(code,/historyPhase := \(historyPhase \+ 1\) % 11\n\s+if historyPhase != 0\n\s+\[selectedSlot, nextScanSlot, nextRecentSlot, nextRemaining, nextRecentTurn\] = historySchedule/);assert.doesNotMatch(code,/sourceSequence % 100|math\.floor\(timenow/);
  assert.match(code,/\(\(baseCount \* 101 \+ oneCount\) \* 101 \+ twoCount\) \* 100 \+ historySlot/);assert.match(code,/baseCount - 1 - historySlot/);assert.match(code,/oneCount - 1 - historySlot/);assert.match(code,/twoCount - 1 - historySlot/);
  assert.match(code,/\(sourceSupported \? 1 : 0\) \+ \(barstate\.isrealtime \? 2 : 0\)/);
  for(const count of [0,1,20,100])for(const one of [0,20,100])for(const two of [0,20,100])for(const slot of [0,1,99]){
    const packed=((count*101+one)*101+two)*100+slot;let rest=Math.floor(packed/100);assert.equal(packed%100,slot);assert.equal(rest%101,two);rest=Math.floor(rest/101);assert.equal(rest%101,one);assert.equal(Math.floor(rest/101),count);
  }
});

test('encoded numeric domains and checksum products fit JavaScript safeinteger bounds',()=>{
  const maxTagged=4095*1e12+(1e12-1),maxPrice=4095*2e10+(2e10-1);
  assert.ok(Number.isSafeInteger(maxTagged)&&maxTagged<Number.MAX_SAFE_INTEGER);assert.ok(Number.isSafeInteger(maxPrice));
  for(const [prime,multiplier] of [[1000000007,65599],[1000000009,131071]])assert.ok(Number.isSafeInteger((prime-1)*multiplier+(prime-1)));
  assert.match(code,/syminfo\.mintick \* 10000 - math\.round\(syminfo\.mintick \* 10000\)/);assert.match(code,/math\.abs\(value - math\.round\(value \* 10000\) \/ 10000\.0\)/);
  for(const tick of [.25,.01,.0001])assert.ok(Math.abs(tick*10000-Math.round(tick*10000))<=1e-6);
  for(const tick of [.00015,1/32])assert.ok(Math.abs(tick*10000-Math.round(tick*10000))>1e-6);
  assert.match(source,/Volume is explicitly QUANTIZED/);assert.match(code,/int volumeMissing = 999999999999/);assert.match(code,/value < 1000000/);
});

test('inband metadata uses84ASCIIbytes and explicit phases without consuming extra plot slots',()=>{
  assert.match(code,/var string compactMetadata = "3\|"/);assert.match(code,/str\.length\(compactMetadata\) <= 84/);assert.match(code,/array\.new<int>\(21, 0\)/);assert.match(code,/packedWord := packedWord \* 256 \+ characterCode/);
  assert.match(code,/bool metadataFrame = historyPhase == 0/);assert.match(code,/metadataFrame \? 134217728 : 0/);assert.match(code,/tag \* carrierBase \+ array\.get\(metadataWords, word\)/);assert.match(code,/metadataSupported \? 0 : 4/);
  const text='2|CME_MINI:NQ1!|1|America/Chicago|regular|USD',bytes=Array.from(text,character=>character.charCodeAt(0));assert.ok(bytes.length<=84&&bytes.every(byte=>byte>=32&&byte<=126));while(bytes.length<84)bytes.push(0);
  const words=Array.from({length:21},(_,word)=>bytes.slice(word*4,word*4+4).reduce((value,byte)=>value*256+byte,0));
  const decoded=words.flatMap(word=>[Math.floor(word/16777216)%256,Math.floor(word/65536)%256,Math.floor(word/256)%256,word%256]);assert.equal(String.fromCharCode(...decoded).replace(/\0+$/,''),text);
  for(const word of words){assert.ok(word<=4294967295&&word<2e10);assert.ok(Number.isSafeInteger(4095*1e12+word));assert.ok(Number.isSafeInteger(4095*2e10+word));}
  assert.match(code,/recentHistoryRemaining := math\.min\(8, baseCount\)/);
  const onBoundary=code.slice(code.indexOf('if na(recentHistoryBaseTime)'),code.indexOf('if na(lastHistoryRotation)'));
  assert.doesNotMatch(onBoundary,/historyScanSlot :=|recentHistoryTurn :=/,'bar boundaries cannot reset full-scan progress or alternation');
});

test('dual checksums cover run identity and every tagged cell in canonical order',()=>{
  assert.match(code,/hashStep\(0, epoch, prime, multiplier\)/);assert.match(code,/hashStep\(result, number, prime, multiplier\)/);assert.match(code,/for index = 0 to 57\n\s+result := hashStep\(result, array\.get\(values, index\), prime, multiplier\)/);
  assert.match(code,/int integerValue = na\(value\) \? -1 : int\(value\)/);assert.match(code,/remainder < 0 \? remainder \+ prime : remainder/);
  assert.match(code,/hashPayload\(payload, runEpoch, sourceSequence, 1000000007, 65599\)/);assert.match(code,/hashPayload\(payload, runEpoch, sourceSequence, 1000000009, 131071\)/);
  const hash=(values,prime,multiplier)=>values.reduce((h,value)=>(h*multiplier+(((value??-1)%prime)+prime)%prime)%prime,0);
  const before=[1794640000000,4096,...Array.from({length:58},(_,i)=>i===7?null:123456789+i)],after=[before[0],8192,...before.slice(2)];
  assert.notEqual(hash(before,1000000007,65599),hash(after,1000000007,65599));assert.notEqual(hash(before,1000000009,131071),hash(after,1000000009,131071));
});
