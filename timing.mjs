export function createTimingStats(limit = 300) {
  const values = { capture: [], ocr: [], display: [], cache: [], fast: [], fastDisplay: [], position:[], arrows:[], motion:[], candles:[], guide:[], labelOcr:[], total:[], callbackLate:[], keyReply:[], frameInterval:[] }; let stale=0, fastAccepted=0, fastRejected=0, fastMismatch=0, reads=0, unreadable=0;
  return {
    add(kind, ms) { if (!values[kind] || !Number.isFinite(ms) || ms < 0) return; values[kind].push(ms); if(values[kind].length>limit)values[kind].shift(); },
    discarded(){stale++;},
    fastResult(ok){if(ok)fastAccepted++;else fastRejected++;},
    fastDisagreement(){fastMismatch++;},
    readResult(ok){reads++;if(!ok)unreadable++;},
    snapshot(){
      const result={stale,fastAccepted,fastRejected,fastMismatch,reads,unreadable};
      for(const [key,samples] of Object.entries(values)) {
        const sorted=[...samples].sort((a,b)=>a-b), at=p=>sorted.length ? Math.round(sorted[Math.ceil(p*sorted.length)-1]) : null;
        result[key]={count:sorted.length,p50:at(.5),p95:at(.95)};
      }
      return result;
    },
  };
}
