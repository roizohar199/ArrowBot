import Tesseract from './vendor/tesseract/tesseract.esm.min.js';
import {verifiedLabelNumber} from './label-number-policy.mjs';
import {createReadCache,normalizedTextKey} from './read-cache.mjs';
import {ocrGeometry} from './ocr-normalization.mjs';
import {enlargeBeforeMask,readMasked} from './ocr-small-text.mjs';
export async function createLabelOcr({createWorker=(...args)=>Tesseract.createWorker(...args),createCanvas=()=>document.createElement('canvas')}={}) {
 const url=path=>chrome.runtime.getURL(`vendor/tesseract/${path}`);
 const worker=await createWorker('eng',1,{workerPath:url('worker.min.js'),corePath:url('core'),langPath:url('lang'),workerBlobURL:false,cacheMethod:'none'});
 await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'7',load_system_dawg:'0',load_freq_dawg:'0'});
 const cache=createReadCache({accept:result=>result?.number!==null&&verifiedLabelNumber(result?.first,result?.second)===result?.number});
 return {
  async recognize(snapshot,direction,{fresh=false}={}) {
   const {width:w,height:h}=snapshot,src=snapshot.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h);
   const x0=Math.floor(w*.13),x1=Math.ceil(w*.87),y0=Math.floor(h*(direction==='UP'?.27:.09)),y1=Math.ceil(h*(direction==='UP'?.83:.70));
   const small=createCanvas();small.width=x1-x0;small.height=y1-y0;const c=small.getContext('2d'),out=c.createImageData(small.width,small.height);
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*w+x)*4,r=src.data[i],g=src.data[i+1],b=src.data[i+2];const text=src.data[i+3]>=200&&(direction==='UP'?r<200&&g<185&&b<110:Math.min(r,g,b)>130&&Math.max(r,g,b)-Math.min(r,g,b)<115);const j=((y-y0)*small.width+x-x0)*4;out.data[j]=out.data[j+1]=out.data[j+2]=text?0:255;out.data[j+3]=255;}c.putImageData(out,0,0);
   const normalized=normalizedTextKey(out,{mode:'BINARY_BLACK'}),key=normalized?direction+':'+normalized:null,cached=fresh?undefined:cache.get(key);
   if(cached)return {...cached,cached:true};
   const geometry=ocrGeometry(out,{targetHeight:56,padding:16});
   if(!key||!geometry)return {number:null,first:{text:'',confidence:0},second:{text:'',confidence:0}};
   const large=createCanvas();large.width=geometry.width;large.height=geometry.height;const ctx=large.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,large.width,large.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(small,geometry.padding,geometry.padding,geometry.drawWidth,geometry.drawHeight);
   const a=(await worker.recognize(large)).data;
   const secondGeometry=ocrGeometry(out,{targetHeight:48,padding:20});
   const alternate=createCanvas();alternate.width=secondGeometry.width;alternate.height=secondGeometry.height;const ac=alternate.getContext('2d');ac.fillStyle='white';ac.fillRect(0,0,alternate.width,alternate.height);ac.imageSmoothingEnabled=false;ac.drawImage(small,secondGeometry.padding,secondGeometry.padding,secondGeometry.drawWidth,secondGeometry.drawHeight);
   const b=(await worker.recognize(alternate)).data;
   const result={number:verifiedLabelNumber(a,b),first:{text:a.text,confidence:a.confidence},second:{text:b.text,confidence:b.confidence}};
   if(result.number===null&&geometry.glyphHeight<=12){
    const mask=enlargeBeforeMask(snapshot,{x:x0,y:y0,width:x1-x0,height:y1-y0},(r,g,b)=>direction==='UP'?r<200&&g<185&&b<110:Math.min(r,g,b)>130&&Math.max(r,g,b)-Math.min(r,g,b)<115,createCanvas);
    const first=await readMasked(worker,createCanvas,mask,56,16),second=await readMasked(worker,createCanvas,mask,48,20);
    const number=verifiedLabelNumber(first,second);
    if(number)return {number,first:{text:first.text,confidence:first.confidence},second:{text:second.text,confidence:second.confidence},...(fresh?{fresh:true,cached:false}:{})};
   }
   cache.put(key,result);
   return fresh?{...result,fresh:true,cached:false}:result;
  },
  terminate:()=>{cache.clear();return worker.terminate();},
 };
}
