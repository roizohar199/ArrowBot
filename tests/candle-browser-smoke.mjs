// Optional local browser smoke test. Uses synthetic canvas capture and a mock
// extension transport; no TradingView session or keyboard actions are involved.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const build=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8')).version;
const candidates=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for(const candidate of candidates){try{await access(candidate);executable=candidate;break;}catch{}}
if(!executable)throw Error('Set CHROME_BIN to a Chromium browser executable.');
const profile=await mkdtemp(path.join(os.tmpdir(),'arrow-candle-smoke-'));
const errors=[],pending=new Map();let browser,ws,id=0;
const shim=`<script>
globalThis.chrome={runtime:{getManifest:()=>({version:${JSON.stringify(build)}}),getURL:p=>new URL(p,location.href).href,sendMessage:async()=>({ok:true,targets:[],state:{enabled:false,delayMs:0,target:null}})},storage:{local:{get:async()=>({}),set:async()=>{}}}};
globalThis.fixture={phase:0};
const source=document.createElement('canvas');source.width=1280;source.height=720;const pen=source.getContext('2d');
function paintFixture(){pen.fillStyle='#131722';pen.fillRect(0,0,1280,720);
 function bar(x,open,close,high,low){pen.fillStyle=close<=open?'#26a69a':'#ef5350';pen.fillRect(x,high,1,low-high+1);pen.fillRect(x-4,Math.min(open,close),9,Math.abs(open-close)+1);}
 for(let i=0;i<20;i++){const open=230+(i*37)%160,close=open+(i%2?30:-35);bar(410+i*30,open,close,Math.min(open,close)-13,Math.max(open,close)+17);}
 const close=fixture.phase===0?350:330;bar(1040,390,close,Math.min(close,320),410);
}
paintFixture();fixture.timer=setInterval(paintFixture,30);fixture.source=source;
Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>source.captureStream(30)});
</script>`;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}
  let body=await readFile(file);if(url.pathname==='/experiment.html')body=Buffer.from(body.toString().replace('<head>','<head>'+shim));
  res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
function call(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},10000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+': '+r.exceptionDetails.exception?.description);return r.result?.value;}
async function until(expression){const end=Date.now()+12000;while(Date.now()<end){const value=await evaluate(expression);if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}const detail=await evaluate(`({status:document.getElementById('status')?.textContent,log:document.getElementById('log')?.textContent})`);throw Error('Browser condition timed out: '+expression+' '+JSON.stringify({detail,errors}));}
try{
 browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;
 for(let i=0;i<100;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 assert.ok(port,'browser debugging port');
 const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.id){const task=pending.get(message.id);if(task){clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}}});
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:origin+'/experiment.html'});
 await until(`document.getElementById('shortcut-delay-status')?.textContent==='הגדרת הדיליי מוכנה.'`);
 await evaluate(`document.getElementById('share').click()`);
 await until(`document.getElementById('chart').disabled===false`);
 await evaluate(`(()=>{const canvas=document.getElementById('preview');function drag(x1,y1,x2,y2){const r=canvas.getBoundingClientRect();for(const [type,x,y] of [['pointerdown',x1,y1],['pointerup',x2,y2]])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,clientX:r.left+x*r.width/canvas.width,clientY:r.top+y*r.height/canvas.height}));}canvas.setPointerCapture=()=>{};drag(50,50,1140,650);drag(900,50,1140,650);drag(1140,50,1240,650);document.getElementById('start').click();})()`);
 await until(`document.getElementById('candle-state').dataset.state==='TRACKING'`);
 assert.equal(await evaluate(`document.getElementById('candle-delta').textContent`),'0.0');
 await evaluate(`fixture.phase=1`);
 await until(`Number(document.getElementById('candle-delta').textContent)===20`);
 const observed=await evaluate(`({state:document.getElementById('candle-state').textContent,delta:document.getElementById('candle-delta').textContent,detail:document.getElementById('candle-detail').textContent,diagnostics:document.getElementById('candle-diagnostics').textContent,log:document.getElementById('log').textContent})`);
 assert.ok(!observed.log.includes('ANALYSIS_ERROR'),observed.log);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
 const overflow=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth})`);assert.ok(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 if(process.env.CANDLE_SCREENSHOT){const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.CANDLE_SCREENSHOT,Buffer.from(screenshot.data,'base64'));}
 await evaluate(`document.getElementById('stop').click()`);
 assert.equal(await evaluate(`document.getElementById('candle-state').dataset.state`),'UNAVAILABLE');
 assert.equal(await evaluate(`document.getElementById('candle-delta').textContent`),'—');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',syntheticCapture:true,netMovementPx:Number(observed.delta),responsiveWidth:390,stopCleared:true,diagnostics:observed.diagnostics},null,2));
}finally{
 try{if(ws?.readyState===WebSocket.OPEN)await call('Browser.close');}catch{}
 ws?.close();browser?.kill();for(const task of pending.values())clearTimeout(task.timer);
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 // mkdtemp is the only source of this recursive cleanup target.
 if(path.dirname(path.resolve(profile))===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('arrow-candle-smoke-'))try{await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:150});}catch{}
}
