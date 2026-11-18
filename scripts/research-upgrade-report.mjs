// Usage: node scripts/research-upgrade-report.mjs <original Arrow JSON export> <output JSON>
// Reads a captured market snapshot. Does not connect to a broker or start the bot.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {analyzeResearchUpgrade} from '../research-upgrades-worker.mjs';
import {createTradeComparison} from '../research-trade-comparison.mjs';
import {RESEARCH_CANDLE_CATALOG} from '../research-candle-patterns.mjs';
const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath)throw Error('Usage: node scripts/research-upgrade-report.mjs <Arrow export.json> <report.json>');
const raw=await readFile(inputPath),source=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
const bars=source.analysisInputs?.bars??source.store?.bars,metadata=source.analysisInputs?.options?.metadata??source.store?.metadata;
const asOfTime=source.analysisInputs?.options?.asOfTime??source.latestAnalysis?.asOfTime;
if(!Array.isArray(bars)||!metadata||!Number.isFinite(asOfTime))throw Error('Original closed bars, metadata and causal analysis cutoff required');
const fill=source.paperUserExecution?.lastVerifiedFill;
const signal=source.alerts?.find(a=>a.signal?.confirmationBarCloseTime===fill?.latestClosedAt&&a.signal?.direction===fill?.direction)?.signal;
const comparison=signal?createTradeComparison({fill,signal,bars,metadata}):null;
const started=performance.now(),analysis=analyzeResearchUpgrade({bars,metadata,asOfTime,comparisons:comparison?[comparison]:[]});
const report={kind:'CAPTURED_DATA_RESEARCH_DIAGNOSTIC',version:'0.31.0',sourceFile:inputPath,sourceSha256:createHash('sha256').update(raw).digest('hex'),
  sourceExportedAt:source.exportedAt,scope:'Captured closed-bar history only. Not a backtest of all executions. No personal realized PnL inferred.',
  interval:{firstOpen:bars[0]?.time,lastClose:bars.at(-1)?.closeTime,asOfTime,bars:bars.length},
  patternIdsImplemented:RESEARCH_CANDLE_CATALOG.length,elapsedMs:performance.now()-started,costAssumptions:null,
  liveEntryRulesChanged:false,ordersCreated:false,profitabilityEstablished:false,...analysis};
await writeFile(outputPath,JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify({report:outputPath,bars:bars.length,candles:analysis.candles?.stats??analysis.candles?.patterns?.length,
  structure:analysis.structure?.stats,comparison:analysis.comparisonSummary,elapsedMs:report.elapsedMs},null,2));
