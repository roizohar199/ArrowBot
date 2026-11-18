// Compare an offline detector report with independent screenshot annotations.
// Usage: node tests/score-candle-recording.mjs REPORT.json ANNOTATIONS.json OUTPUT.json
// Defaults read verification/tradingview-live and write score-recomputed.json;
// the original score.json is deliberately preserved as baseline evidence.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const directory=path.resolve('verification/tradingview-live');
const reportPath=path.resolve(process.argv[2]??path.join(directory,'report.json'));
const annotationsPath=path.resolve(process.argv[3]??path.join(directory,'manual-annotations.json'));
const outputPath=path.resolve(process.argv[4]??path.join(directory,'score-recomputed.json'));
if(outputPath===reportPath||outputPath===annotationsPath)throw Error('Output must not overwrite a source report or annotations.');
const reportText=await readFile(reportPath,'utf8'),annotationsText=await readFile(annotationsPath,'utf8');
const report=JSON.parse(reportText),manual=JSON.parse(annotationsText);
const frame=report.frames?.find(f=>f.file===manual.sourceFrame);
if(!frame||!Array.isArray(frame.candles)||!Array.isArray(manual.candles))throw Error('Report must contain the independently annotated source frame and candles.');
const uncertainty=manual.uncertaintyPx?.x;
if(!Number.isFinite(uncertainty)||uncertainty<0)throw Error('Manual x uncertainty must be a nonnegative number.');
const fields=['x','bodyTop','bodyBottom','highY','lowY','bodyWidth'];
for(const candle of [...frame.candles,...manual.candles])if(!fields.every(k=>Number.isFinite(candle[k])))throw Error('Every scored candle must contain finite geometry.');

// Global nearest-x assignment is one-to-one. An additional nearby detection
// cannot increase the matched count or hide an extra detection.
function matchCenters(expected,detected){
 const pairs=[];
 expected.forEach((truth,i)=>detected.forEach((candidate,j)=>{const distance=Math.abs(truth.x-candidate.x);if(distance<=uncertainty)pairs.push({i,j,distance});}));
 pairs.sort((a,b)=>a.distance-b.distance||a.i-b.i||a.j-b.j);
 const truthUsed=new Set(),detectedUsed=new Set(),matched=[];
 for(const pair of pairs)if(!truthUsed.has(pair.i)&&!detectedUsed.has(pair.j)){truthUsed.add(pair.i);detectedUsed.add(pair.j);matched.push(pair);}
 matched.sort((a,b)=>a.i-b.i);
 return {matched,missing:expected.filter((_,i)=>!truthUsed.has(i)),extra:detected.filter((_,j)=>!detectedUsed.has(j))};
}
function errors(values){
 const sorted=values.map(Math.abs).sort((a,b)=>a-b);
 return {n:sorted.length,medianAbsPx:sorted.length?sorted[Math.floor(sorted.length/2)]:null,maxAbsPx:sorted.at(-1)??null,meanAbsPx:sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:null};
}
const assigned=matchCenters(manual.candles,frame.candles);
const matches=assigned.matched.map(({i,j})=>{const truth=manual.candles[i],detected=frame.candles[j];return {x:truth.x,directionMatch:truth.direction===detected.direction,geometryIncluded:!truth.clipped&&!truth.occluded&&!truth.excludeFromGeometry&&!detected.clipped,detector:detected,manual:truth,errors:Object.fromEntries(fields.map(k=>[k,detected[k]-truth[k]]))};});
const geometryMatches=matches.filter(m=>m.geometryIncluded);
const tight=manual.tightVisualCount,region=tight?.region;
if(!region||!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||!Array.isArray(tight.bodyCenters)||tight.bodyCenters.some(x=>!Number.isFinite(x))||tight.visibleCandleBodies!==tight.bodyCenters.length)throw Error('Tight ROI needs valid region and independently counted bodyCenters.');
const detectedTight=frame.candles.filter(c=>c.x>=region.x&&c.x<region.x+region.width&&c.bodyBottom>=region.y&&c.bodyTop<region.y+region.height);
const tightAssignment=matchCenters(tight.bodyCenters.map(x=>({x})),detectedTight);

const m=manual.activeMovementComparison;
let movement=null;
if(m){
 const firstIndex=report.frames.findIndex(f=>f.file===m.firstFrame),lastIndex=report.frames.findIndex(f=>f.file===m.lastFrame);
 if(firstIndex<0||lastIndex<firstIndex)throw Error('Movement first/last frames must exist in capture order.');
 const first=report.frames[firstIndex],last=report.frames[lastIndex],segment=report.frames.slice(firstIndex,lastIndex+1);
 const sameX=first.active&&last.active&&Math.abs(first.active.x-m.sameCandleX)<=uncertainty&&Math.abs(last.active.x-m.sameCandleX)<=uncertainty;
 const sameObservedCandle=first.active?.observedId!=null&&first.active.observedId===last.active?.observedId;
 const continuous=segment.slice(1).every(f=>f.status==='TRACKING'&&!f.captureGap&&!f.geometryChanged&&f.active?.observedId===first.active?.observedId);
 const stationary=segment.slice(1).every(f=>f.candleMotion&&Math.abs(f.candleMotion.x)<=.75&&Math.abs(f.candleMotion.y)<=.75);
 const eligible=!!sameX&&sameObservedCandle&&continuous&&stationary&&m.historicalViewStable===true;
 const detectedMovement=eligible?last.metrics.netPx-first.metrics.netPx:null,expectedMovement=m.expectedSignedUpwardDeltaPx;
 const error=detectedMovement===null?null:detectedMovement-expectedMovement;
 movement={firstFrame:m.firstFrame,lastFrame:m.lastFrame,x:m.sameCandleX,manualFirstCloseY:m.firstCloseY,manualLastCloseY:m.lastCloseY,detectedFirstCloseY:first.active?.closeY??null,detectedLastCloseY:last.active?.closeY??null,
  sameCandleX:!!sameX,sameObservedCandle,continuousTracking:continuous,historicalMotionStable:stationary,eligibleForComparison:eligible,
  manualDeltaPx:expectedMovement,detectorDeltaPx:detectedMovement,errorPx:error,agreesWithinManualUncertainty:error===null?null:Math.abs(error)<=m.uncertaintyPx,correctDirection:detectedMovement===null?null:Math.sign(detectedMovement)===Math.sign(expectedMovement)};
}
const warnings=[];
if(manual.image&&(manual.image.width!==frame.image?.width||manual.image.height!==frame.image?.height))warnings.push('Annotated image dimensions differ from the report; coordinates are compared without rescaling. Check source/crop alignment before claiming precise edge accuracy.');
const score={schemaVersion:1,sourceReport:path.basename(reportPath),annotations:path.basename(annotationsPath),sourceReportSha256:createHash('sha256').update(reportText).digest('hex'),annotationsSha256:createHash('sha256').update(annotationsText).digest('hex'),implementation:report.implementation??null,method:manual.method,
 scope:`${manual.candles.length} independently annotated candle geometries and ${tight.bodyCenters.length} independently counted bodies in one real screenshot; plus first/last active-candle displacement`,uncertaintyPx:manual.uncertaintyPx,warnings,
 annotated:{expected:manual.candles.length,matched:matches.length,missingX:assigned.missing.map(c=>c.x),directionMatched:matches.filter(m=>m.directionMatch).length,geometryMatched:geometryMatches.length,geometryExcludedX:matches.filter(m=>!m.geometryIncluded).map(m=>m.x),errors:Object.fromEntries(fields.map(k=>[k,errors(geometryMatches.map(m=>m.errors[k]))]))},
 tightROI:{region,expected:tight.bodyCenters.length,detected:detectedTight.length,matched:tightAssignment.matched.length,missingX:tightAssignment.missing.map(c=>c.x),extraX:tightAssignment.extra.map(c=>c.x),sampleRecall:tightAssignment.matched.length/tight.bodyCenters.length,samplePrecision:detectedTight.length?tightAssignment.matched.length/detectedTight.length:null},
 movement,limitations:[...(manual.limitations??[]),'Metrics apply only to the selected sample and approximate manual labels, not all candles or all market conditions.','Matched edge statistics exclude annotated occlusion/clipping and detector-clipped candles; missing bodies remain misses.'],matches};
await writeFile(outputPath,JSON.stringify(score,null,2)+'\n');
process.stdout.write(JSON.stringify({output:outputPath,annotated:score.annotated,tightROI:score.tightROI,movement:score.movement,warnings},null,2)+'\n');
