import {performance} from 'node:perf_hooks';
import {cpus,platform} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {createGuideVisualAdvisor} from '../guide-visual-advisor.mjs';
import {analyzeGuideSignals,createGuideAnalyzer} from '../guide-signal-engine.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';

// Deterministic CPU measurements; deliberately exclude capture and DOM paint.
const start=Date.UTC(2026,0,1),minute=60000;
const bar=(i,o,h,l,c)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open:o,high:h,low:l,close:c,closed:true});
const metadata={source:'ohlc',chartType:'standard',instrument:'SYNTHETIC_BENCHMARK',timeframe:'1m',timeframeMs:minute,tickSize:.25,timezone:'UTC',session:'synthetic'};
const bars=Array.from({length:600},(_,i)=>{
  const v=100+Math.round(Math.sin(i*Math.PI/4)*5);
  return i%3===2?bar(i,v+.5,v+1.25,v-1.25,v+1):bar(i,v,v+1,v-1,v);
});
const candles=bars.slice(-40).map((b,i)=>({x:10+i*10,openY:1000-4*b.open,highY:1000-4*b.high,lowY:1000-4*b.low,closeY:1000-4*b.close,bodyWidth:5,clipped:false}));
const reader={status:'TRACKING',candles,active:{...candles.at(-1),observedId:1}};
const advisor=createGuideVisualAdvisor({intervalMs:0});let frameAt=start;
const measure=(name,fn,warmup,samples)=>{
  for(let i=0;i<warmup;i++)fn();
  const durations=[];let result;
  for(let i=0;i<samples;i++){const before=performance.now();result=fn();durations.push(performance.now()-before);}
  durations.sort((a,b)=>a-b);
  return {name,samples,p50Ms:durations[Math.floor(samples*.5)],p95Ms:durations[Math.min(samples-1,Math.ceil(samples*.95)-1)],maxMs:durations.at(-1),status:result.status,setups:result.events?.length,cacheHit:result.cache?.hit,reusedTerminalEvents:result.cache?.reusedTerminalEvents};
};
const settings={metadata,asOfTime:bars.at(-1).closeTime,config:{requireRisk:false}},cached=createGuideAnalyzer(),incremental=createGuideAnalyzer();
const analyzed=cached.analyze(bars,settings);let nextLength=550;incremental.analyze(bars.slice(0,nextLength),settings);
const report={recordedAt:new Date().toISOString(),scope:'Synthetic local CPU only; excludes screen capture, decode, DOM render, market timing and profitability validation. Append-only timing grows history from 551 to 600 bars; a shifted rolling window/correction/config/feed change invalidates the memo and requires cold evaluation.',environment:{node:process.version,platform:platform(),cpu:cpus()[0]?.model},measurements:[
  measure('visual_rules_40_candles',()=>advisor.inspect(reader,{context:'benchmark',geometry:'fixed',capturedAt:++frameAt}),40,200),
  measure('offline_rules_600_bars',()=>analyzeGuideSignals(bars,{metadata,asOfTime:bars.at(-1).closeTime,config:{requireRisk:false}}),2,10),
  measure('unchanged_closed_history_600_bars',()=>cached.analyze(bars,settings),5,100),
  measure('append_only_close_551_to_600_bars',()=>incremental.analyze(bars.slice(0,++nextLength),settings),0,50),
  measure('explain_18_shapes_7_filters_last_120_scenarios',()=>describeGuideAnalysis(analyzed),3,30),
]};
if(process.argv.includes('--save')){
  const directory=new URL('../verification/guide-signals/',import.meta.url);
  await mkdir(directory,{recursive:true});await writeFile(new URL('benchmark.json',directory),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
