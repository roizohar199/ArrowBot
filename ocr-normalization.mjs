// Normalize OCR work to the actual digit height, rather than multiplying the
// entire badge by a fixed zoom-dependent factor. This adds no missing pixels.
export function ocrGeometry(image,{targetHeight=56,padding=20}={}){
 const {width,height,data}=image??{};
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!data||data.length!==width*height*4)return null;
 let top=height,bottom=-1,ink=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4;
  if(data[p+3]>=200&&data[p]<128&&data[p+1]<128&&data[p+2]<128){top=Math.min(top,y);bottom=Math.max(bottom,y);ink++;}
 }
 const glyphHeight=bottom-top+1;if(ink<3||glyphHeight<3)return null;
 const scale=Math.max(1,Math.min(16,targetHeight/glyphHeight,1800/width));
 return {scale,padding,glyphHeight,width:Math.ceil(width*scale)+padding*2,height:Math.ceil(height*scale)+padding*2,drawWidth:Math.ceil(width*scale),drawHeight:Math.ceil(height*scale)};
}
