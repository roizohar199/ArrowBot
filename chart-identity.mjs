// Displayed chart-toolbar identity, never order-book or account data.
export function normalizeChartIdentity(value){
 if(!value||typeof value.symbol!=='string'||typeof value.interval!=='string'||typeof value.replay!=='boolean')return null;
 const symbol=value.symbol.trim().toUpperCase(),interval=value.interval.trim().toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9_!:./-]{0,59}$/.test(symbol)||!/^\d{1,5}[SMWD]?$/.test(interval)||/^0/.test(interval))return null;
 return {symbol,interval,replay:value.replay};
}
export const sameChartIdentity=(a,b)=>!!a&&!!b&&a.symbol===b.symbol&&a.interval===b.interval&&a.replay===b.replay;
