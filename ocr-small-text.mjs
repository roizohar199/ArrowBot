// Preserve antialiased edges before applying the existing color threshold.
// This is a fallback for small text; it cannot recreate missing detail.
export function enlargeBeforeMask(source, rect, isText, createCanvas, cleanMask=()=>{}) {
 const canvas=createCanvas(), factor=3;
 canvas.width=rect.width*factor;canvas.height=rect.height*factor;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(source,rect.x,rect.y,rect.width,rect.height,0,0,canvas.width,canvas.height);
 const image=ctx.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<image.data.length;i+=4){
  const d=image.data,black=d[i+3]>=200&&isText(d[i],d[i+1],d[i+2]);
  d[i]=d[i+1]=d[i+2]=black?0:255;d[i+3]=255;
 }
 cleanMask(image);ctx.putImageData(image,0,0);
 return {canvas,image};
}

export async function readMasked(worker,createCanvas,masked,targetHeight,padding){
 const {ocrGeometry}=await import('./ocr-normalization.mjs');
 const g=ocrGeometry(masked.image,{targetHeight,padding});if(!g)return null;
 const canvas=createCanvas();canvas.width=g.width;canvas.height=g.height;
 const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,g.width,g.height);
 ctx.imageSmoothingEnabled=false;ctx.drawImage(masked.canvas,g.padding,g.padding,g.drawWidth,g.drawHeight);
 return (await worker.recognize(canvas)).data;
}
