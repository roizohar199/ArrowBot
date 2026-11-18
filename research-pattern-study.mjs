import {validateHistoryBar} from './history-24-core.mjs';
import {deriveVerifiedSessionGaps} from './session-gap-proof.mjs';
import {analyzeResearchCandles,RESEARCH_CANDLE_VERSION} from './research-candle-patterns.mjs';
import {evaluateSignalExcursions} from './guide-risk.mjs';
import {analyzePatternQuality,researchBarAvailability,researchBarsAdjacent} from './research-pattern-quality.mjs';
import {analyzeChartStructures} from './research-chart-structures.mjs';
import {analyzeStudyIndicators,indicatorBuckets} from './research-study-indicators.mjs';

export const PATTERN_STUDY_VERSION='pattern-study-3000-v2';
export const FOLLOW_UP_BARS=Object.freeze([5,15]);
const minute=60_000;
export const STUDY_PATTERNS=Object.freeze([
  Object.freeze({id:'ADVANCE_BLOCK',label:'Advance Block'}),
  Object.freeze({id:'BEARISH_BELT_HOLD',label:'Belt Hold דובי'}),
]);

const availability=researchBarAvailability,sameSession=researchBarsAdjacent;

function followUp(bars,index,horizon,direction,asOf){
  const end=index+horizon,anchor=bars[index];
  for(let i=index+1;i<=end;i++){
    if(bars[i-1].sessionLast||bars[i]&&!sameSession(bars[i-1],bars[i]))return {status:'SESSION_BOUNDARY'};
    if(!bars[i])return {status:'OUTSIDE_WINDOW'};
  }
  const window=bars.slice(index,end+1).map(bar=>({...bar,openTime:bar.time,availableAt:availability(bar)}));
  const measurement=evaluateSignalExcursions(window,{direction,confirmedAt:anchor.closeTime},
    {horizonBars:horizon,reference:'confirmation_close',asOf});
  if(measurement.status!=='AVAILABLE')return {status:'UNAVAILABLE'};
  const close=bars[end].close;
  return {status:'AVAILABLE',close,change:close-anchor.close,mfe:measurement.mfe,mae:measurement.mae};
}

function studyDetection(pattern,bars,asOf){
  const {startIndex,endIndex,knownAt,evidence,direction}=pattern;
  let chartStart=startIndex;
  while(chartStart>0&&startIndex-chartStart<11&&sameSession(bars[chartStart-1],bars[chartStart])&&availability(bars[chartStart-1])<=knownAt){
    chartStart--;
  }
  return {chartStart,startIndex,endIndex,knownAt,direction,checks:Object.keys(evidence.checks),
    referenceMedian:evidence.longBodyReferences[0]?.referenceMedian??null,
    horizons:FOLLOW_UP_BARS.map(horizon=>followUp(bars,endIndex,horizon,direction,asOf))};
}

function provenStudyWindow(recording){
  const input=recording?.analysisInputs,metadata=input?.options?.metadata;
  const bars=input?.bars,asOfTime=input?.options?.asOfTime;
  if(recording?.kind!=='LIVE_OHLC_OBSERVATION'||recording.schemaVersion!==1||
    metadata?.instrument!=='CME_MINI:NQ1!'||metadata.timeframe!=='1'||metadata.tickSize!==.25||
    typeof recording.selectedRun!=='string'||recording.selectedRun!==metadata.sourceId||
    !Number.isFinite(asOfTime)||!Array.isArray(bars)||bars.length!==3000){
    throw Error('נדרש ייצוא Arrow עם 3,000 נרות דקה של NQ.');
  }
  if(bars.some(bar=>!validateHistoryBar(bar,minute)||bar.synthetic===true||
    !Number.isFinite(availability(bar))||availability(bar)>asOfTime)){
    throw Error('הייצוא מכיל נר לא מאומת או נר שלא היה זמין במועד הסריקה.');
  }
  const proof=deriveVerifiedSessionGaps(bars);
  if(!proof.valid)throw Error('נמצא פער לא מאומת ברצף 3,000 הנרות.');
  return {input,bars,metadata,asOfTime,sessionGaps:proof.gaps};
}

export function analyzePatternStudy(recording,{volumeArchives=[]}={}){
  const {input,bars,metadata,asOfTime,sessionGaps}=provenStudyWindow(recording);
  const priorVolume=volumeArchives.map(archive=>{
    const source=provenStudyWindow(archive);
    if(source.metadata.session!==metadata.session||source.metadata.timezone!==metadata.timezone||
      source.bars.at(-1).closeTime>bars.at(-1).closeTime)throw Error('ייצוא הייחוס חייב להיות מאותו גרף תקני, מאותו סשן ובזמן מוקדם יותר.');
    return source.bars;
  });
  const result=analyzeResearchCandles(bars,{
    tickSize:metadata.tickSize,asOfTime,sessionGaps,
    maxPatterns:3000,patternIds:STUDY_PATTERNS.map(pattern=>pattern.id),
  });
  if(result.status!=='OK'||result.patterns.length!==result.totalDetected){
    throw Error('לא ניתן להשלים את סריקת התבניות בייצוא.');
  }
  const groups=STUDY_PATTERNS.map(({id,label})=>{
    const patterns=result.patterns.filter(pattern=>pattern.patternId===id);
    return {id,label,times:patterns.map(pattern=>pattern.barCloseTime),
      detections:patterns.map(pattern=>studyDetection(pattern,bars,asOfTime))};
  });
  const metrics=analyzeStudyIndicators(bars,priorVolume);
  const indicatorContext=metrics.rows.map((row,i)=>indicatorBuckets(row,availability(bars[i])));
  const quality=analyzePatternQuality({bars,groups,metadata,higherTimeframes:input.options.higherTimeframes,
    sessionGaps,horizons:FOLLOW_UP_BARS,indicatorContext});
  const chartStructures=analyzeChartStructures(bars,{tickSize:metadata.tickSize,asOfTime,sessionGaps,horizons:FOLLOW_UP_BARS});
  return {
    version:PATTERN_STUDY_VERSION,definitionVersion:RESEARCH_CANDLE_VERSION,
    instrument:metadata.instrument,barCount:bars.length,from:bars[0].time,to:bars.at(-1).closeTime,
    asOfTime,exportedAt:recording.exportedAt,researchOnly:true,
    candles:bars.map(({time,open,high,low,close})=>[time,open,high,low,close]),
    groups,quality,chartStructures,
    indicators:{version:metrics.version,latest:metrics.rows.at(-1),coverage:metrics.coverage,volumeReference:metrics.volumeReference,
      auxiliaryExports:priorVolume.length},
  };
}
