import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';

const source=await readFile(new URL('../tradingview-ohlc-bridge.pine',import.meta.url),'utf8');
const code=source.split('\n').map(line=>line.replace(/\/\/.*$/,'')).join('\n');
function block(name){const lines=code.split('\n'),start=lines.findIndex(line=>line.startsWith(name+'('));assert.ok(start>=0,'missing Pine function '+name);let end=start+1;while(end<lines.length&&(!lines[end].trim()||/^\s/.test(lines[end])))end++;return lines.slice(start,end).join('\n');}

// These are source-boundary audits. They do not execute Pine, reproduce its
// allocator or substitute for TradingView compilation and live verification.
test('all Pine log calls pass through the single finite-session emitter',()=>{
  const emitter=block('emitPayload');assert.equal((code.match(/log\.(?:info|warning|error)\(/g)??[]).length,2);assert.equal((emitter.match(/log\.info\(/g)??[]).length,2);
  assert.match(emitter,/if not exhausted/);assert.match(emitter,/usedChars \+ needed <= logBudgetChars - logReserveChars/);assert.match(emitter,/nextExhausted := true/);assert.match(emitter,/SOURCE_LOG_BUDGET_EXHAUSTED/);
  assert.match(code,/varip bool logBudgetExhausted = false/);assert.doesNotMatch(code,/logBudgetExhausted := false/);
  assert.match(code,/if not logBudgetExhausted and \(snapshotNow or recoveryNow or updateNow\)/);
  const budget=Number(/logBudgetChars = input\.int\((\d+)/.exec(code)?.[1]),reserve=Number(/logReserveChars = (\d+)/.exec(code)?.[1]);assert.equal(budget,1000000);assert.ok(reserve>=4096&&reserve<budget);
});

test('historical work and requested matrix state are bounded independently of loaded chart length',()=>{
  assert.match(code,/indicator\([^\n]*calc_bars_count = 102/);assert.equal((code.match(/calc_bars_count = historyCount \+ 2/g)??[]).length,2);
  assert.doesNotMatch(code,/var(?:ip)? array<string>/);assert.doesNotMatch(code,/collectHigher\(/);
  const requested=block('confirmedHigherData');assert.match(requested,/if barstate\.islast and/);assert.match(requested,/matrix\.new<float>\(historyCount, 7, na\)/);assert.match(requested,/for offset = 1 to available/);assert.match(requested,/\[barstate\.islast \? cached : na/);assert.doesNotMatch(requested,/barstate\.isconfirmed|valuesJson|barJson|log\./);
  for(const raw of ['time','time_close','open','high','low','close','volume'])assert.match(requested,new RegExp('\\b'+raw+'\\[offset\\]'));
  assert.match(code,/if not logBudgetExhausted\n\s+\[oneData/);assert.equal((code.match(/lookahead = barmerge\.lookahead_on/g)??[]).length,2);
  assert.doesNotMatch(block('matrixRowsJson'),/rows \+=/);assert.match(block('matrixRowsJson'),/array\.join\(fragments, ","\)/);
});

test('changed observations throttle to50ms while heartbeat and explicit bar boundaries retain their own triggers',()=>{
  assert.match(code,/updateEveryMs = input\.int\(50,/);assert.match(code,/int heartbeatMs = 1000/);
  assert.match(code,/barstate\.isnew or barstate\.isconfirmed or na\(lastLoggedAt\)/);assert.match(code,/timenow - lastLoggedAt >= heartbeatMs or changed and timenow - lastLoggedAt >= updateEveryMs/);
  assert.match(code,/previousFinal = bar_index > 0 and confirmedSeries\[1\]/);
});

test('terminal budget diagnostics remain compatible with existing V1 blocked envelopes',()=>{
  const at=Date.UTC(2026,10,14),raw={schemaVersion:1,kind:'blocked',runId:'SOURCE|1|123',sequence:99,sourceEmittedAt:at,realtime:true,dataDelayUnverified:true,metadata:{source:'ohlc',instrument:'SOURCE',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'regular',chartType:'standard'},bars:[],reasonCodes:['SOURCE_LOG_BUDGET_EXHAUSTED','SOURCE_LOG_BUDGET_CHARS:1000000','SOURCE_LOG_EMITTED_CHARS:995000']};
  const result=parsePineOhlcMessage('ARROW_OHLC_V1 '+JSON.stringify(raw),{receivedAt:at+10,tabId:1});assert.equal(result.ok,true);assert.equal(result.packet.kind,'blocked');assert.deepEqual(result.packet.reasonCodes,raw.reasonCodes);
});
