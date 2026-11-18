import {parsePineOhlcMessage,pineFixedTimeframeMs} from './pine-ohlc-protocol.mjs';
import {deriveVerifiedSessionGaps,declaredSessionGapMatches} from './session-gap-proof.mjs';

// The bounded Pine burst is historical context only. This module never creates
// live packets, shifts timestamps, verifies an account, or grants live status.
export function parseWindowBootstrapEvidence(messages,{tabId,receivedAt=Date.now()}={}){
  const fail=code=>({ok:false,contextOnly:true,liveEligible:false,reasonCodes:[code]});
  if(!Array.isArray(messages)||messages.length>256)return fail('WINDOW_BOOTSTRAP_MESSAGES_REQUIRED');
  const parsed=messages.map(text=>parsePineOhlcMessage(text,{tabId,receivedAt})).filter(item=>item.ok&&item.packet.bootstrapOnly===true);
  const byRun=new Map();
  for(const item of parsed){const group=byRun.get(item.packet.runId)??new Map(),prior=group.get(item.packet.sequence);if(prior&&JSON.stringify(prior)!==JSON.stringify(item.packet))return fail('WINDOW_BOOTSTRAP_CONFLICTING_DUPLICATE');group.set(item.packet.sequence,item.packet);byRun.set(item.packet.runId,group);}
  const groups=[...byRun.values()].sort((a,b)=>Math.max(...[...b.values()].map(packet=>packet.sourceEmittedAt))-Math.max(...[...a.values()].map(packet=>packet.sourceEmittedAt)));
  const latest=groups[0];
  if(!latest||latest.size!==3||![1,2,3].every(seq=>latest.has(seq)))return fail('WINDOW_BOOTSTRAP_BURST_INCOMPLETE');
  const packets=[...latest.values()].sort((a,b)=>a.sequence-b.sequence),basePacket=packets[0],higherPackets=packets.slice(1),meta=basePacket.metadata;
  const runEpoch=Number(basePacket.runId.slice(basePacket.runId.lastIndexOf('|')+1));
  if(!Number.isSafeInteger(runEpoch)||runEpoch<1577836800000||runEpoch>basePacket.sourceEmittedAt||pineFixedTimeframeMs(meta.timeframe)!==meta.timeframeMs||basePacket.runId!==meta.instrument+'|'+meta.timeframe+'|'+runEpoch||
    basePacket.kind!=='snapshot'||higherPackets.some(packet=>packet.kind!=='timeframe_snapshot'||packet.higherTimeframes?.length!==1)||
    packets.some(packet=>packet.sourceEmittedAt!==basePacket.sourceEmittedAt||packet.realtime!==false||packet.runId!==basePacket.runId||
      ['instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session'].some(key=>packet.metadata[key]!==meta[key])))return fail('WINDOW_BOOTSTRAP_IDENTITY_MISMATCH');
  const higherTimeframes=higherPackets.map(packet=>packet.higherTimeframes[0]);
  if(new Set(higherTimeframes.map(entry=>entry.timeframe)).size!==2)return fail('WINDOW_BOOTSTRAP_HIGHER_TIMEFRAMES_MISMATCH');
  for(const entry of [{bars:basePacket.bars,sessionGaps:meta.sessionGaps},...higherTimeframes]){
    const proof=deriveVerifiedSessionGaps(entry.bars);
    if(!proof.valid||!Array.isArray(entry.sessionGaps)||entry.sessionGaps.length!==proof.gaps.length||
      entry.bars.some(bar=>!Number.isSafeInteger(bar.providerBarIndex)||bar.providerBarIndex*4+3>=1e12||typeof bar.sessionFirst!=='boolean'||typeof bar.sessionLast!=='boolean'||bar.closed!==true||bar.closeTime>basePacket.sourceEmittedAt||['open','high','low','close'].some(key=>bar[key]<=-1e6||bar[key]>=1e6||Math.abs(bar[key]*1e4-Math.round(bar[key]*1e4))>Math.max(1,Math.abs(bar[key]*1e4))*Number.EPSILON*32||Math.abs(bar[key]/meta.tickSize-Math.round(bar[key]/meta.tickSize))>Math.max(1,Math.abs(bar[key]/meta.tickSize))*Number.EPSILON*32))||
      proof.gaps.some(gap=>!entry.sessionGaps.some(declared=>{
        const i=entry.bars.findIndex(bar=>bar.time===gap.to);return i>0&&declaredSessionGapMatches(declared,entry.bars[i-1],entry.bars[i]);
      })))return fail('WINDOW_BOOTSTRAP_SESSION_PROOF_INVALID');
  }
  const cleanMeta=Object.fromEntries(['source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'].map(key=>[key,meta[key]]));
  const bootstrap={schemaVersion:2,wireVersion:3,runEpoch,runId:basePacket.runId,metadata:cleanMeta,higherTimeframes:higherTimeframes.map(({timeframe,timeframeMs})=>({timeframe,timeframeMs})),encoding:{priceDecimals:4,volumeDecimals:6,volumeQuantized:true,volumeMaxAbsoluteError:.0000005,volumeMissing:999999999999,tagModulo:4096,timeOrigin:1577836800000,historyHoldMs:200,historyOrder:'newest_first',checksumPrimes:[1000000007,1000000009],checksumMultipliers:[65599,131071]}};
  const bootstrapHistory={runEpoch,runId:basePacket.runId,sourceEmittedAt:basePacket.sourceEmittedAt,metadata:cleanMeta,baseBars:structuredClone(basePacket.bars),higherTimeframes:structuredClone(higherTimeframes)};
  return {ok:true,contextOnly:true,liveEligible:false,bootstrap,bootstrapHistory,basePacket,higherPackets,packets,ready:[basePacket.bars,...higherTimeframes.map(entry=>entry.bars)].every(bars=>bars.length>=20),reasonCodes:['HISTORICAL_BOOTSTRAP_NO_ALERT']};
}
