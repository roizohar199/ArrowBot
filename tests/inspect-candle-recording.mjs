// Inspect actual captured screenshots offline with the production readers.
// Usage: node tests/inspect-candle-recording.mjs DIRECTORY [OUTPUT.json]
// DIRECTORY/manifest.json: {region:{x,y,width,height},frames:[{file,capturedAt}]}.
// PYTHON_BIN may name an isolated Python with Pillow. Raw .rgba files can be
// used without Python when each frame also supplies its width and height.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createCandleVision} from '../candle-vision.mjs';
import {createCandleReader} from '../candle-reader.mjs';
import {createChartMotionReader} from '../chart-motion-reader.mjs';
import {MAX_CAPTURE_GAP_MS} from '../capture-timing.mjs';

const directory=path.resolve(process.argv[2]??'verification/tradingview-live');
const manifestPath=path.join(directory,'manifest.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const implementationFiles=['candle-vision.mjs','candle-reader.mjs','chart-motion-reader.mjs','chart-motion.mjs','capture-timing.mjs','tests/inspect-candle-recording.mjs'];
async function implementationHashes(){return Object.fromEntries(await Promise.all(implementationFiles.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));}
const sourceSha256=await implementationHashes();
const region=manifest.region;
if(!region||!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||region.width<=0||region.height<=0)throw Error('A finite positive manifest.region is required.');
if(!Array.isArray(manifest.frames)||!manifest.frames.length||manifest.frames.length>2000)throw Error('manifest.frames must contain 1–2000 frames.');
const python=process.env.PYTHON_BIN??'python';
const decode=`import sys,struct
from PIL import Image
with Image.open(sys.argv[1]) as source:
 image=source.convert('RGBA')
 if image.width*image.height>16000000: raise ValueError('Image exceeds 16 million pixels')
 sys.stdout.buffer.write(struct.pack('<II',image.width,image.height))
 sys.stdout.buffer.write(image.tobytes())`;
const percentile=(values,p)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?Number(sorted[Math.ceil(sorted.length*p)-1].toFixed(3)):null;};
const timings=values=>({samples:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:percentile(values,1)});
async function imageFor(frame){
 if(typeof frame.file!=='string')throw Error('Every frame needs a file.');
 const file=path.resolve(directory,frame.file);
 if(!file.startsWith(directory+path.sep))throw Error('Frame must stay inside its recording directory.');
 let width,height,buffer,offset=0;
 if(path.extname(file).toLowerCase()==='.rgba'){
  width=frame.width;height=frame.height;buffer=await readFile(file);
 }else{
  try{buffer=execFileSync(python,['-c',decode,file],{windowsHide:true,maxBuffer:65000008,stdio:['ignore','pipe','pipe']});}
  catch(error){throw Error('Image decode failed. Set PYTHON_BIN to Python with Pillow installed. '+String(error.stderr??error.message));}
  if(buffer.length<8)throw Error('Invalid decoded image header.');
  width=buffer.readUInt32LE(0);height=buffer.readUInt32LE(4);offset=8;
 }
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16000000||buffer.length-offset!==width*height*4)throw Error('Invalid RGBA dimensions or length.');
 return {width,height,data:new Uint8ClampedArray(buffer.buffer,buffer.byteOffset+offset,buffer.length-offset)};
}

const vision=createCandleVision(),reader=createCandleReader(),motionReader=createChartMotionReader();
const frames=[],counts={status:{},reason:{},motionReason:{}},timing={decode:[],vision:[],motion:[],reader:[],combined:[]};
let previousAt=null,previousGeometry=null;
for(const [index,frame] of manifest.frames.entries()){
 const capturedAt=typeof frame.capturedAt==='string'?Date.parse(frame.capturedAt):frame.capturedAt;
 if(!Number.isFinite(capturedAt)||previousAt!==null&&capturedAt<=previousAt)throw Error('Capture timestamps must be finite and strictly increasing; timestamps are never invented.');
 const decodeStarted=performance.now(),image=await imageFor(frame),decodeMs=performance.now()-decodeStarted;
 const geometry=image.width+'x'+image.height+':'+JSON.stringify(region),context=String(manifest.context??'offline-real-screenshots');
 if(region.x<0||region.y<0||region.x+region.width>image.width||region.y+region.height>image.height)throw Error('manifest.region must be inside every image.');
 const started=performance.now(),detection=vision.inspect(image,region,manifest.palette?{palette:manifest.palette}:{}),visionMs=performance.now()-started;
 const motionStarted=performance.now(),motion=motionReader.inspect(image,region,{context,geometry,capturedAt}),motionMs=performance.now()-motionStarted;
 const readerStarted=performance.now(),result=reader.inspect(detection,{context,geometry,capturedAt,motion:motion.motion}),readerMs=performance.now()-readerStarted;
 const combinedMs=performance.now()-started;
 for(const [key,value] of Object.entries({decode:decodeMs,vision:visionMs,motion:motionMs,reader:readerMs,combined:combinedMs}))timing[key].push(value);
 counts.status[result.status]=(counts.status[result.status]??0)+1;
 counts.reason[result.reason]=(counts.reason[result.reason]??0)+1;
 counts.motionReason[motion.reason]=(counts.motionReason[motion.reason]??0)+1;
 frames.push({index,file:frame.file,capturedAt,gapMs:previousAt===null?null:capturedAt-previousAt,captureGap:previousAt!==null&&capturedAt-previousAt>MAX_CAPTURE_GAP_MS,geometryChanged:previousGeometry!==null&&geometry!==previousGeometry,
  image:{width:image.width,height:image.height},detected:detection.candles.length,status:result.status,reason:result.reason,active:result.active,metrics:result.metrics,
  chartMotion:motion.motion,motionReason:motion.reason,candleMotion:result.motion,diagnostics:detection.diagnostics,candles:detection.candles,
  timings:{decodeMs,visionMs,motionMs,readerMs,combinedMs}});
 previousAt=capturedAt;previousGeometry=geometry;
 if((index+1)%40===0)process.stderr.write('Inspected '+(index+1)+'/'+manifest.frames.length+' captured frames\n');
}
const durationMs=frames.at(-1).capturedAt-frames[0].capturedAt;
const sourceSha256AfterRun=await implementationHashes(),codeChangedDuringRun=implementationFiles.some(file=>sourceSha256[file]!==sourceSha256AfterRun[file]);
const report={schemaVersion:1,source:manifest.source??'Captured screenshots',manifest:manifestPath,region,implementation:{sourceSha256,sourceSha256AfterRun,codeChangedDuringRun},
 caveats:['Offline inspection of captured images; screenshot acquisition, JPEG compression and image decoding differ from the extension capture stream.','Detector output is an observation, not independently annotated ground truth. Counts do not establish precision or recall.','Timings exclude live capture delivery, arrows, position/OCR, display and keyboard paths; they are not whole-pipeline or market-tick latency.','Actual capture timestamps and continuity budget are retained. Frames separated by a large gap cannot establish continuous intrabar movement.'],
 summary:{frames:frames.length,durationMs,screenshotReceiptFps:durationMs>0?(frames.length-1)*1000/durationMs:null,counts,
  detectionCount:{min:Math.min(...frames.map(f=>f.detected)),max:Math.max(...frames.map(f=>f.detected))},
  nonzeroTrackedMoves:frames.filter(f=>f.status==='TRACKING'&&f.metrics.deltaPx!==0).length,trackedMoves:frames.filter(f=>f.status==='TRACKING'&&f.metrics.deltaPx!==0).map(f=>({index:f.index,capturedAt:f.capturedAt,x:f.active?.x,closeY:f.active?.closeY,deltaPx:f.metrics.deltaPx,netPx:f.metrics.netPx})),
  timings:Object.fromEntries(Object.entries(timing).map(([key,values])=>[key,timings(values)])),scratch:vision.snapshot()},frames};
const output=JSON.stringify(report,null,2);
if(process.argv[3]){await writeFile(path.resolve(process.argv[3]),output+'\n');process.stdout.write(JSON.stringify({output:path.resolve(process.argv[3]),...report.summary},null,2)+'\n');}
else process.stdout.write(output+'\n');
