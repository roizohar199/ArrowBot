import {analyzeResearchCandles} from './research-candle-patterns.mjs';
import {analyzeResearchStructure} from './research-market-structure.mjs';
import {analyzeResearchStochastic} from './research-stochastic.mjs';
import {analyzePatternStudy} from './research-pattern-study.mjs';
import {analyzeChartStructures} from './research-chart-structures.mjs';
import {createTradeComparison,advanceTradeComparison,summarizeTradeComparisons} from './research-trade-comparison.mjs';

export function analyzeResearchUpgrade({bars,metadata,asOfTime,comparisons=[]}){
  const options={tickSize:metadata.tickSize,asOfTime,sessionGaps:metadata.sessionGaps??[]};
  const candles=analyzeResearchCandles(bars,{tickSize:options.tickSize,asOfTime,sessionGaps:options.sessionGaps});
  const structure=analyzeResearchStructure(bars,options);
  const stochastic=analyzeResearchStochastic(bars,{...options,timeframeMs:metadata.timeframeMs});
  const chartStructures=analyzeChartStructures(bars,options);
  const updated=comparisons.map(record=>advanceTradeComparison(record,bars,{metadata,sessionGaps:options.sessionGaps,asOfTime}));
  return {version:'research-upgrades-1',researchOnly:true,orderEligible:false,asOfTime,sourceId:metadata.sourceId,
    candles,structure,stochastic,chartStructures,comparisons:updated,comparisonSummary:summarizeTradeComparisons(updated)};
}

export function capturePaperResearchComparison(input){
  const record=createTradeComparison(input);
  if(!record)return null;
  const {bars,metadata,signal}=input;
  const signalClose=signal.confirmationBarCloseTime;
  const confirmationHistory=Array.isArray(bars)?bars.filter(bar=>bar?.closeTime<=signalClose):[];
  const momentum=analyzeResearchStochastic(confirmationHistory,{
    asOfTime:signal.confirmedAt??signalClose,sessionGaps:metadata.sessionGaps??[],timeframeMs:metadata.timeframeMs,
  });
  // Require the confirmation candle itself, so missing evidence cannot reuse an older reading.
  const stochasticAtConfirmation=momentum.latest?.barCloseTime===signalClose
    ?momentum:{...momentum,status:'UNAVAILABLE',latest:null,reason:momentum.reason??'CONFIRMATION_BAR_UNAVAILABLE'};
  return {...record,stochasticAtConfirmation};
}

export function importPaperResearchComparison(input){
  const record=capturePaperResearchComparison(input);
  if(!record)return null;
  const updated=advanceTradeComparison(record,input.bars,{metadata:input.metadata,sessionGaps:input.metadata.sessionGaps??[],asOfTime:input.asOfTime});
  return {...updated,createdFrom:'IMPORTED_PAPER_EXPORT',importProvenance:structuredClone(input.provenance)};
}

async function readPatternStudy(files){
  const archives=[];
  for(const file of files){
    const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const {kind,schemaVersion,selectedRun,exportedAt,analysisInputs}=raw;
    archives.push({kind,schemaVersion,selectedRun,exportedAt,analysisInputs});
  }
  archives.sort((a,b)=>(b.analysisInputs?.bars?.at(-1)?.closeTime??0)-(a.analysisInputs?.bars?.at(-1)?.closeTime??0)||
    (b.analysisInputs?.options?.asOfTime??0)-(a.analysisInputs?.options?.asOfTime??0));
  const [primary,...volumeArchives]=archives;
  return analyzePatternStudy(primary,{volumeArchives});
}

if(typeof self!=='undefined'&&typeof self.postMessage==='function')self.onmessage=async ({data})=>{
  try{
    if(data.kind==='pattern-study'){
      const files=data.files??[data.file];
      self.postMessage({id:data.id,kind:data.kind,result:await readPatternStudy(files)});
      return;
    }
    const result=data.kind==='import'?importPaperResearchComparison(data.input):data.kind==='fill'?capturePaperResearchComparison(data.input):analyzeResearchUpgrade(data.input);
    self.postMessage({id:data.id,kind:data.kind,scope:data.scope,result});
  }catch(error){self.postMessage({id:data.id,kind:data.kind,scope:data.scope,error:String(error?.message??error).slice(0,240)});}
};
