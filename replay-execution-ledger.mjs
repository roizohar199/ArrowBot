export const REPLAY_RESERVATION_STORAGE_KEY='arrow.replayExecutionReservations.v2';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validKey=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/.test(value);
// Chrome may reorder dictionary keys while serializing storage values. Verify
// the exact primitive claim, not the insertion order of its JSON encoding.
const sameClaim=(saved,claim)=>plain(saved)&&Object.keys(saved).length===Object.keys(claim).length&&Object.keys(claim).every(key=>{
  const value=claim[key];return Object.hasOwn(saved,key)&&(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))&&saved[key]===value;
});

// One extension-origin lock covers the complete storage read/write/readback.
// A consumed claim is retained even when no fill is confirmed.
export function createReplayReservationLedger({storage,locks,now=Date.now}={}){
  return async(key,record={})=>{
    if(!validKey(key)||typeof storage?.get!=='function'||typeof storage?.set!=='function'||typeof locks?.request!=='function')return {ok:false,reason:'REPLAY_DURABLE_EVENT_LEDGER_REQUIRED'};
    try{return await locks.request('arrow-replay-execution-ledger-v2',{mode:'exclusive'},async()=>{
      const stored=(await storage.get(REPLAY_RESERVATION_STORAGE_KEY))?.[REPLAY_RESERVATION_STORAGE_KEY];
      if(stored!==undefined&&(!plain(stored)||stored.schemaVersion!==2||!plain(stored.claims)))return {ok:false,reason:'REPLAY_EVENT_LEDGER_INVALID'};
      const claims=stored?.claims??{};
      if(Object.hasOwn(claims,key))return {ok:false,reason:'REPLAY_EVENT_ALREADY_RESERVED'};
      if(Object.keys(claims).length>=512)return {ok:false,reason:'REPLAY_EVENT_LEDGER_CAPACITY_REACHED'};
      const claim=Object.fromEntries(Object.entries({reservedAt:now(),eventId:String(record.eventId??'').slice(0,512),asOfTime:record.asOfTime,sourceTabId:record.sourceTabId,runId:String(record.runId??'').slice(0,512),state:'RESERVED_NO_BLIND_RETRY'}).filter(([,value])=>value!==undefined));
      await storage.set({[REPLAY_RESERVATION_STORAGE_KEY]:{schemaVersion:2,claims:{...claims,[key]:claim}}});
      const saved=(await storage.get(REPLAY_RESERVATION_STORAGE_KEY))?.[REPLAY_RESERVATION_STORAGE_KEY]?.claims?.[key];
      return sameClaim(saved,claim)?{ok:true,status:'RESERVED'}:{ok:false,reason:'REPLAY_EVENT_RESERVATION_NOT_PERSISTED'};
    });}catch{return {ok:false,reason:'REPLAY_EVENT_LEDGER_FAILED'};}
  };
}
