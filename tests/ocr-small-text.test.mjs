import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.self=globalThis;
globalThis.chrome={runtime:{getURL:path=>path}};
const {createPriceOcr}=await import('../price-ocr.mjs');
const {createQuantityOcr}=await import('../quantity-ocr.mjs');
const {createLabelOcr}=await import('../label-ocr.mjs');
class Canvas {
 constructor(){this.width=1;this.height=1;this.pixels=null;}
 getContext(){
  const canvas=this;
  const image=()=>{if(!canvas.pixels||canvas.pixels.length!==canvas.width*canvas.height*4)canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);return canvas.pixels;};
  return {
   createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
   getImageData:()=>({width:canvas.width,height:canvas.height,data:new Uint8ClampedArray(image())}),
   putImageData:value=>{canvas.pixels=new Uint8ClampedArray(value.data);},
   fillRect:()=>{const p=image();p.fill(255);},
   drawImage(source,...args){
    let sx=0,sy=0,sw=source.width,sh=source.height,dx,dy,dw,dh;
    if(args.length===4)[dx,dy,dw,dh]=args;else [sx,sy,sw,sh,dx,dy,dw,dh]=args;
    const p=image(),src=source.pixels;
    for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
     const ix=Math.floor(sx+x*sw/dw),iy=Math.floor(sy+y*sh/dh),tx=Math.floor(dx+x),ty=Math.floor(dy+y);
     if(tx>=0&&ty>=0&&tx<canvas.width&&ty<canvas.height)p.set(src.subarray((iy*source.width+ix)*4,(iy*source.width+ix)*4+4),(ty*canvas.width+tx)*4);
    }
   },
  };
 }
}
function sample(){
 const c=new Canvas();c.width=20;c.height=12;c.pixels=new Uint8ClampedArray(c.width*c.height*4);
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
  const i=(y*c.width+x)*4,on=y>=3&&y<=8&&[4,5,8,9,12,13].includes(x);
  c.pixels.set(on?[255,255,255,255]:[30,130,120,255],i);
 }
 return c;
}
function worker(reads){return {setParameters:async()=>{},recognize:async()=>({data:reads.shift()??{text:'',confidence:0}}),terminate:async()=>{}};}
const price=t=>({text:t,confidence:90});
test('small price fallback requires two matching valid reads',async()=>{
 const good=await createPriceOcr({createWorker:async()=>worker([price('bad'),price('12345.25'),price('12345.25')]),createCanvas:()=>new Canvas()});
 assert.equal((await good.recognize(sample(),'TURQUOISE')).value,12345.25);
 const bad=await createPriceOcr({createWorker:async()=>worker([price('bad'),price('12345.25'),price('12345.50')]),createCanvas:()=>new Canvas()});
 assert.equal((await bad.recognize(sample(),'TURQUOISE')).value,null);
});
test('small quantity fallback preserves agreement requirement',async()=>{
 const good=await createQuantityOcr({createWorker:async()=>worker([price(''),price(''),price('1'),price('1')]),createCanvas:()=>new Canvas()});
 assert.equal((await good.recognize(sample())).quantity,1);
 const bad=await createQuantityOcr({createWorker:async()=>worker([price(''),price(''),price('1'),price('2')]),createCanvas:()=>new Canvas()});
 assert.equal((await bad.recognize(sample())).quantity,null);
});
test('small arrow number fallback preserves two-read agreement',async()=>{
 const image=sample();
 for(let i=0;i<image.pixels.length;i+=4){
  const white=image.pixels[i]===255;
  image.pixels.set(white?[10,10,10,255]:[230,210,20,255],i);
 }
 const good=await createLabelOcr({createWorker:async()=>worker([price(''),price(''),price('12'),price('12')]),createCanvas:()=>new Canvas()});
 assert.equal((await good.recognize(image,'UP')).number,'12');
 const bad=await createLabelOcr({createWorker:async()=>worker([price(''),price(''),price('12'),price('13')]),createCanvas:()=>new Canvas()});
 assert.equal((await bad.recognize(image,'UP')).number,null);
});
