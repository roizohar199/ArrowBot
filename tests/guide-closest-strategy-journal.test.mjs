import test from 'node:test';
import assert from 'node:assert/strict';
import {createClosestStrategyJournal} from '../guide-closest-strategy-journal.mjs';

const scope={instrument:'CME_MINI:NQ1!',timeframe:'1',sourceId:'fixture',sessionId:'one'};
const forming={label:'נרות במגמה ובאזור',profileId:'candles',direction:'SHORT',phase:'FORMING_PATTERN',
  eventId:'forming:candles:short',sourceBarTime:60_000,patternIds:['DARK_CLOUD'],missingCheckIds:[],missingLabels:[]};
const closed={...forming,eventId:'closed:1',phase:'PENDING_CONFIRMATION',trigger:100};
function observe(journal,at,candidates,options={}){
  const {analysis,preview,openBarTime=60_000,hiddenCandidates,nextScope=scope}=options;
  return journal.observe({scope:nextScope,at,model:{status:candidates.length?'TRACKING':'WAITING_PATTERN',candidates,openBarTime,hiddenCandidates},analysis,preview});
}
const latest=journal=>journal.snapshot().groups[0].changes;

test('open pattern departures are grouped and deduplicated, and recovery of the shape is recorded',()=>{
  const journal=createClosestStrategyJournal(),pin={...forming,profileId:'pin',eventId:'forming:pin:short'};
  assert.equal(observe(journal,60_005,[forming,pin]),true);
  assert.equal(observe(journal,60_006,[forming,pin]),false);
  assert.equal(observe(journal,60_007,[],{preview:{matchedPatternIds:[]}}),true);
  assert.equal(latest(journal).length,2);
  assert.ok(latest(journal).every(change=>change.to==='HIDDEN'&&change.reason.includes('בנר הפתוח')));
  assert.equal(observe(journal,60_008,[forming,pin]),true);
  assert.equal(latest(journal).length,2);
});

test('a forming candidate promoted on close is tracked as a transition and exact terminal reasons win',()=>{
  for(const [status,reason] of [['EXPIRED','CONFIRMATION_EXPIRED'],['INVALIDATED','CLOSE_BEYOND_INVALIDATION'],['CONFIRMED','LATER_CLOSED_BAR_CONFIRMED']]){
    const journal=createClosestStrategyJournal();
    observe(journal,60_005,[forming]);
    observe(journal,120_005,[closed],{openBarTime:120_000});
    assert.deepEqual(latest(journal).map(change=>[change.from,change.to]),[['FORMING_PATTERN','PENDING_CONFIRMATION']]);
    observe(journal,180_005,[],{analysis:{events:[{...closed,status,reasonCodes:[reason],invalidation:105}]},openBarTime:180_000});
    assert.equal(latest(journal)[0].to,status);
    assert.equal(latest(journal)[0].invalidation,105);
    assert.notEqual(latest(journal)[0].reason,reason);
  }
});

test('suspension is one source event and renewed data retain the correct provisional price evidence',()=>{
  const journal=createClosestStrategyJournal();
  observe(journal,60_005,[closed]);
  assert.equal(journal.suspend(60_007,'מקור לא זמין'),true);
  assert.equal(journal.suspend(60_008,'מקור לא זמין'),false);
  assert.deepEqual(latest(journal)[0].affected,[{label:closed.label,direction:'SHORT',eventId:closed.eventId}]);
  assert.equal(latest(journal)[0].to,'UNAVAILABLE');
  observe(journal,60_009,[],{preview:{pendingConfirmations:[{eventId:closed.eventId,state:'FORMING_PRICE_BEYOND_INVALIDATION',
    levels:{confirmationTrigger:100,invalidation:105,entryReference:106}}]}});
  assert.deepEqual(latest(journal).map(change=>change.to),['TRACKING','HIDDEN']);
  assert.equal(latest(journal)[1].observedPrice,106);
});

test('an evidenced display cutoff preserves missing checks, and a new session starts a fresh sequence',()=>{
  const journal=createClosestStrategyJournal();
  observe(journal,60_005,[forming]);
  observe(journal,60_006,[],{hiddenCandidates:[{...forming,missingLabels:['אזור מחיר','מבנה השוק']}]});
  assert.match(latest(journal)[0].reason,/מחוץ לסף התצוגה.*אזור מחיר, מבנה השוק/);
  observe(journal,60_007,[forming]);
  assert.equal(observe(journal,60_008,[],{nextScope:{...scope,sessionId:'two'}}),false);
  assert.equal(observe(journal,60_009,[forming],{nextScope:{...scope,sessionId:'two'}}),true);
  assert.equal(journal.snapshot().groups[0].scope.sessionId,'two');
});

test('the persisted journal keeps at most its last twenty individual changes across reloads',()=>{
  const stored=new Map(),storage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
  const journal=createClosestStrategyJournal({storage});
  for(let index=0;index<25;index++)observe(journal,60_005+index,[{...closed,priceMet:!!(index%2)}]);
  const restored=createClosestStrategyJournal({storage});
  assert.deepEqual(restored.snapshot(),journal.snapshot());
  assert.equal(restored.snapshot().groups.flatMap(group=>group.changes).length,20);
  assert.equal(restored.snapshot().groups.at(-1).at,60_010);
});
