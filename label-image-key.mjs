// Fingerprint only the normalized text area; ignore the moving background and pointer.
export function labelTextKey(image,box,direction) {
 const {data,width,height}=image??{}, {x,y,width:w,height:h}=box??{};
 if(!data||!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(w)||!Number.isInteger(h)||x<0||y<0||x+w>width||y+h>height||w<1||h<1)return null;
 const x0=Math.floor(w*.13),x1=Math.ceil(w*.87),y0=Math.floor(h*(direction==='UP'?.27:.09)),y1=Math.ceil(h*(direction==='UP'?.83:.70));
 let bits='';for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=((y+yy)*width+x+xx)*4,r=data[i],g=data[i+1],b=data[i+2];const text=direction==='UP'?r<200&&g<185&&b<110:r>165&&g>165&&b>165;bits+=text?'1':'0';}
 return direction+':'+w+'x'+h+':'+bits;
}
export function ambiguityCoversLatest(boxes, arrow) {
 if(!arrow?.box)return boxes.length>0;
 // An ambiguous region at or to the right of the candidate could contain a newer signal.
 return boxes.some(b=>b.x+b.width>=arrow.box.x);
}
