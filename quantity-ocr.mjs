import Tesseract from './vendor/tesseract/tesseract.esm.min.js';
import {ocrGeometry} from './ocr-normalization.mjs';
import {quantityFromRead,stripQuantitySigns} from './position-quantity.mjs';
import {enlargeBeforeMask,readMasked} from './ocr-small-text.mjs';
export async function createQuantityOcr({createWorker=(...args)=>Tesseract.createWorker(...args),createCanvas=()=>document.createElement('canvas')}={}){
 const url=p=>chrome.runtime.getURL('vendor/tesseract/'+p);
 const worker=await createWorker('eng',1,{workerPath:url('worker.min.js'),corePath:url('core'),langPath:url('lang'),workerBlobURL:false,cacheMethod:'none'});
 await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'7',user_defined_dpi:'300'});
 return {async recognize(canvas){
  const source=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height),small=createCanvas();small.width=canvas.width;small.height=canvas.height;
  const sc=small.getContext('2d'),mask=sc.createImageData(small.width,small.height);
  for(let i=0;i<source.data.length;i+=4){const r=source.data[i],g=source.data[i+1],b=source.data[i+2],on=source.data[i+3]>=200&&Math.min(r,g,b)>=145&&Math.max(r,g,b)-Math.min(r,g,b)<100;mask.data[i]=mask.data[i+1]=mask.data[i+2]=on?0:255;mask.data[i+3]=255;}stripQuantitySigns(mask);sc.putImageData(mask,0,0);
  const reads=[];for(const height of [56,48]){const g=ocrGeometry(mask,{targetHeight:height,padding:16});if(!g)return {quantity:null,first:null,second:null};const large=createCanvas();large.width=g.width;large.height=g.height;const c=large.getContext('2d');c.fillStyle='white';c.fillRect(0,0,large.width,large.height);c.imageSmoothingEnabled=false;c.drawImage(small,g.padding,g.padding,g.drawWidth,g.drawHeight);const r=(await worker.recognize(large)).data;reads.push({text:r.text,confidence:r.confidence});}
  const result={first:reads[0],second:reads[1]},quantity=quantityFromRead(result);
  const geometry=ocrGeometry(mask);
  if(quantity===null&&geometry&&geometry.glyphHeight<=12){
   const enlarged=enlargeBeforeMask(canvas,{x:0,y:0,width:canvas.width,height:canvas.height},(r,g,b)=>Math.min(r,g,b)>=145&&Math.max(r,g,b)-Math.min(r,g,b)<100,createCanvas,stripQuantitySigns);
   const first=await readMasked(worker,createCanvas,enlarged,56,16),second=await readMasked(worker,createCanvas,enlarged,48,16);
   const fallback={first,second},value=quantityFromRead(fallback);
   if(value!==null)return {...fallback,quantity:value};
  }
  return {...result,quantity};
 },terminate:()=>worker.terminate()};
}
