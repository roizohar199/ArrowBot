// A gap is carried only when TradingView marks both session boundaries and
// the requested provider bar indices prove that no provider row was skipped.
export const PINE_SESSION_GAP_BASIS='PINE_SESSION_FLAGS_AND_PROVIDER_INDEX';
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function verifiedSessionGap(previous,next){
  if(!previous||!next||!integer(previous.closeTime)||!integer(next.time)||next.time<=previous.closeTime||
    !integer(previous.providerBarIndex)||!integer(next.providerBarIndex)||next.providerBarIndex!==previous.providerBarIndex+1||
    previous.sessionLast!==true||next.sessionFirst!==true)return null;
  return {from:previous.closeTime,to:next.time,kind:'market_closed',basis:PINE_SESSION_GAP_BASIS,
    previousBarIndex:previous.providerBarIndex,nextBarIndex:next.providerBarIndex,previousSessionLast:true,nextSessionFirst:true};
}
export function declaredSessionGapMatches(gap,previous,next){
  const expected=verifiedSessionGap(previous,next);
  return !!expected&&!!gap&&Object.keys(expected).every(key=>gap[key]===expected[key]);
}
export function deriveVerifiedSessionGaps(bars){
  if(!Array.isArray(bars)||bars.some(bar=>!bar||!integer(bar.time)||!integer(bar.closeTime)||bar.closeTime<=bar.time||['providerBarIndex','sessionFirst','sessionLast'].some(key=>Object.hasOwn(bar,key))&&(!integer(bar.providerBarIndex)||typeof bar.sessionFirst!=='boolean'||typeof bar.sessionLast!=='boolean')))return {valid:false,gaps:[],reasonCodes:['INVALID_SESSION_GAP_BARS']};
  const gaps=[];
  for(let i=1;i<bars.length;i++){
    const previous=bars[i-1],next=bars[i];
    if(next.time<previous.closeTime)return {valid:false,gaps:[],reasonCodes:['INVALID_BAR_ORDER']};
    if(next.time===previous.closeTime){
      if(integer(previous.providerBarIndex)&&integer(next.providerBarIndex)&&next.providerBarIndex!==previous.providerBarIndex+1)
        return {valid:false,gaps:[],reasonCodes:['PROVIDER_BAR_INDEX_GAP']};
    }else{
      const gap=verifiedSessionGap(previous,next);
      if(!gap)return {valid:false,gaps:[],reasonCodes:['UNVERIFIED_SESSION_GAP']};
      gaps.push(gap);
    }
  }
  return {valid:true,gaps,reasonCodes:[]};
}
