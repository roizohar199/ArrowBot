import Tesseract from './vendor/tesseract/tesseract.esm.min.js';
import { singlePassPrice } from './price-validation.mjs';
import {createReadCache,normalizedTextKey} from './read-cache.mjs';
import {ocrGeometry} from './ocr-normalization.mjs';
import {enlargeBeforeMask,readMasked} from './ocr-small-text.mjs';
export async function createPriceOcr({createWorker=(...args)=>Tesseract.createWorker(...args),createCanvas=()=>document.createElement('canvas')}={}) {
  const url = path => chrome.runtime.getURL(`vendor/tesseract/${path}`);
  const worker = await createWorker('eng', 1, {
    workerPath: url('worker.min.js'), corePath: url('core'), langPath: url('lang'),
    workerBlobURL: false, cacheMethod: 'none',
  });
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789,.' });
  const cache=createReadCache({accept:result=>Number.isFinite(result?.value)&&Number.isFinite(result?.confidence)&&result.confidence>=85});
  return {
    async recognize(badgeCanvas, badgeColor) {
      const source=badgeCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,badgeCanvas.width,badgeCanvas.height);
      // Use the same white-glyph mask as the cache identity: dark digits on a
      // neutral white field, independent of the badge's red/teal background.
      const textCanvas=createCanvas();textCanvas.width=badgeCanvas.width;textCanvas.height=badgeCanvas.height;
      const textContext=textCanvas.getContext('2d'),textImage=textContext.createImageData(textCanvas.width,textCanvas.height);
      for(let p=0;p<source.data.length;p+=4){
        const r=source.data[p],g=source.data[p+1],b=source.data[p+2],min=Math.min(r,g,b),max=Math.max(r,g,b);
        const text=source.data[p+3]>=200&&min>120&&max-min<95&&(r+g+b)/3>150;
        textImage.data[p]=textImage.data[p+1]=textImage.data[p+2]=text?0:255;textImage.data[p+3]=255;
      }
      textContext.putImageData(textImage,0,0);
      const key=normalizedTextKey(textImage,{mode:'BINARY_BLACK'}),geometry=ocrGeometry(textImage);
      if(!key||!geometry)return {value:null,confidence:0};
      const cached=cache.get(key);if(cached)return {...cached,cached:true};
      const scaled = createCanvas();
      scaled.width=geometry.width;scaled.height=geometry.height;
      const ctx = scaled.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle='white';ctx.fillRect(0,0,scaled.width,scaled.height);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(textCanvas,geometry.padding,geometry.padding,geometry.drawWidth,geometry.drawHeight);
      const { data: raw } = await worker.recognize(scaled);
      const result={ value: singlePassPrice(raw), confidence: raw.confidence };
      if(result.value===null&&geometry.glyphHeight<=12){
        const mask=enlargeBeforeMask(badgeCanvas,{x:0,y:0,width:badgeCanvas.width,height:badgeCanvas.height},(r,g,b)=>Math.min(r,g,b)>120&&Math.max(r,g,b)-Math.min(r,g,b)<95&&(r+g+b)/3>150,createCanvas);
        const a=await readMasked(worker,createCanvas,mask,56,20),b=await readMasked(worker,createCanvas,mask,48,16);
        const first=singlePassPrice(a),second=singlePassPrice(b);
        if(first!==null&&first===second)return {value:first,confidence:Math.min(a.confidence,b.confidence)};
      }
      cache.put(key,result);
      return result;
    },
    terminate: () => {cache.clear();return worker.terminate();},
  };
}
