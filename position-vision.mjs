// Reads the entry marker drawn on the chart. It does not read an account or
// infer a position from the current-price badge, candles, or SL/TP guides.
const outcome=(state,reason,boxes=[])=>({state,reason,boxes,...(state==='FLAT'?{flatProof:true}:{})});
const validRegion=(r,w,h)=>!!r&&['x','y','width','height'].every(k=>Number.isInteger(r[k]))&&r.x>=0&&r.y>=0&&r.width>=40&&r.height>=24&&r.x+r.width<=w&&r.y+r.height<=h;
// A thin border blended with the dark plot keeps its hue but loses absolute
// brightness. Chroma dominance, rather than a near-original RGB minimum,
// preserves that evidence at fractional zoom without accepting teal/purple.
const colorKind=(r,g,b)=>b>=60&&r<145&&g<185&&b-r>=35&&b-g>=22&&b>g*1.25&&b>r*1.55?1:r>=65&&g<155&&b<165&&r-g>=30&&r-b>=28&&r>g*1.75&&r>b*1.6?2:0;
// Keep local and full-chart workspaces separate: alternating a small tracking
// ROI with a full recovery scan must not reallocate the large mask every time.
const workspaces=[{mask:new Uint8Array(0)},{mask:new Uint8Array(0)}];

export function inspectVisualPosition(image,region,{chartValidated=false}={}){
 const width=image?.width,height=image?.height,data=image?.data;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!data||data.length!==width*height*4||!validRegion(region,width,height))return outcome('UNKNOWN','POSITION_IMAGE_UNAVAILABLE');
 const w=region.width,h=region.height,size=w*h;
 const workspace=workspaces[size>65536?1:0];
 if(workspace.mask.length<size)workspace.mask=new Uint8Array(size);
 const mask=workspace.mask;
 for(let y=0;y<h;y++){
  let p=((region.y+y)*width+region.x)*4,index=y*w;
  for(let x=0;x<w;x++,p+=4,index++){
   if(data[p+3]!==255)return outcome('UNKNOWN','POSITION_IMAGE_UNAVAILABLE');
   mask[index]=colorKind(data[p],data[p+1],data[p+2]);
  }
 }
 const is=(x,y,kind)=>x>=0&&x<w&&y>=0&&y<h&&mask[y*w+x]===kind;
 const dark=(x,y)=>{const p=((region.y+y)*width+region.x+x)*4;return data[p]<100&&data[p+1]<110&&data[p+2]<125;};
 const white=(x,y)=>{const p=((region.y+y)*width+region.x+x)*4;return data[p]>180&&data[p+1]>180&&data[p+2]>180;};
 function rowRun(y,x,kind){let end=x;while(end<w&&is(end,y,kind))end++;return end;}
 function closeMark(right,top,bottom,kind){
  const scale=(bottom-top+1)/19,p=n=>Math.max(1,Math.round(n*scale)),cy=Math.round((top+bottom)/2);
  for(let y=cy-p(1);y<=cy+p(1);y++)for(let x=right-p(20);x<=right-p(7);x++)for(let radius=p(2);radius<=p(4);radius++){
   let hits=0,total=0;
   for(let d=-radius;d<=radius;d++){hits+=Number(is(x+d,y+d,kind))+Number(is(x+d,y-d,kind));total+=2;}
   if(hits/total>=.8)return true;
  }
  return false;
 }
 function body(left,right,top,bottom,kind,clipped=false){
  // A filled quantity cell at the left is followed by a mostly dark outlined
  // P/L body. A solid BUY button or solid price badge cannot satisfy both.
  const scale=(bottom-top+1)/19,p=n=>Math.max(1,Math.round(n*scale));
  const columns=right-left+2;
  if(!workspace.fill||workspace.fill.length<columns){
   const capacity=2**Math.ceil(Math.log2(columns));
   for(const key of ['fill','glyph','black','ink'])workspace[key]=new Uint32Array(capacity);
  }
  const {fill,glyph,black,ink}=workspace;fill[0]=glyph[0]=black[0]=ink[0]=0;
  const startY=top+p(2),endY=bottom-p(1),rows=endY-startY;
  if(rows<=0)return null;
  // Build each column once. Testing quantity-cell splits then uses prefix
  // totals rather than rescanning the full P/L body for every possible split.
  for(let x=left;x<=right;x++){
   const column=x-left+1;
   fill[column]=fill[column-1];glyph[column]=glyph[column-1];black[column]=black[column-1];ink[column]=ink[column-1];
   for(let y=startY;y<endY;y++){
    fill[column]+=Number(is(x,y,kind));glyph[column]+=Number(white(x,y));
    const isDark=dark(x,y);black[column]+=Number(isDark);
    const p=((region.y+y)*width+region.x+x)*4;
    ink[column]+=Number(!isDark&&(data[p]>150||data[p+1]>130||data[p+2]>170)&&Math.max(data[p],data[p+1],data[p+2])-Math.min(data[p],data[p+1],data[p+2])>30);
   }
  }
  const total=(values,start,end)=>end>start?values[end-left]-values[start-left]:0;
  for(let split=left+p(14);split<=Math.min(left+p(48),right-p(clipped?20:55));split++){
   const count=(split-left-p(2))*rows,afterCount=(p(8)-p(3))*rows,bodyCount=(right-p(5)-split-p(8))*rows;
   if(count&&afterCount>0&&bodyCount>0&&total(fill,left+p(2),split)/count>=.64&&total(glyph,left+p(2),split)>=Math.max(2,Math.round(3*scale*scale))&&total(fill,split+p(3),split+p(8))/afterCount<=.26&&total(black,split+p(8),right-p(5))/bodyCount>=.63){
    return {profitText:total(ink,split+p(8),right-p(24))>=Math.max(3,Math.round(6*scale*scale)),quantityBox:{x:region.x+left+p(2),y:region.y+top+p(2),width:split-left-p(2),height:bottom-top-p(3)}};
   }
  }
  return null;
 }
 function darkInterior(left,right,top,bottom){
  let count=0,total=0;
  for(let yy=top;yy<=bottom;yy++)for(let xx=left;xx<=right;xx++){
   if(xx<0||yy<0||xx>=w||yy>=h)continue;
   total++;count+=Number(dark(xx,yy));
  }
  return total?count/total:null;
 }
 const found=[],suspects=[],unpaired=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;){
  const kind=mask[y*w+x];if(!kind){x++;continue;}
  const end=rowRun(y,x,kind),length=end-x,start=x;x=end;
  if(length<(end===w?20:30)||length>650)continue;
  // A solid order button/price badge has no dark outlined body beneath its
  // border. Reject it before trying the possible marker heights. Three widely
  // spaced probes avoid confusing a short P/L glyph with a solid background.
  const probeY=y+4;
  if(probeY<h&&[.5,.65,.8].every(f=>is(start+Math.floor(length*f),probeY,kind)))continue;
  unpaired.push({start,end,y,kind});
  // One border can survive when an entry is cut by the capture edge. Do not
  // reinterpret that visibly incomplete marker as proof of an empty chart.
  for(const [top,bottom] of [...(y>=5&&y<60?[[0,y]]:[]),...(y>=h-60&&y<=h-6?[[y,h-1]]:[])]){
   const left=Math.max(0,start-2);
   let right=Math.min(w-1,end+1),best=0;
   for(let rx=end-1;rx<=Math.min(w-1,end+2);rx++){
    let hits=0;for(let yy=top+1;yy<bottom;yy++)hits+=Number(is(rx,yy,kind));
    if(hits>best){best=hits;right=rx;}
   }
   if(best/Math.max(1,bottom-top-1)>.65&&body(left,right,top,bottom,kind))suspects.push({x:region.x+left,y:region.y+top,width:right-left+1,height:bottom-top+1,side:kind===1?'LONG':'SHORT'});
  }
  for(let bottom=y+8;bottom<=Math.min(h-1,y+60);bottom++){
   const scale=(bottom-y+1)/19,p=n=>Math.max(1,Math.round(n*scale));
   if(length<(end===w?p(30):p(60))||length>p(270))continue;
   let bottomStart=-1,bottomEnd=-1;
   for(let bx=Math.max(0,start-p(3));bx<=Math.min(w-1,start+p(3));bx++)if(is(bx,bottom,kind)){
    const be=rowRun(bottom,bx,kind)-1;
    if(Math.abs(be-(end-1))<=p(3)){bottomStart=bx;bottomEnd=be;break;}
   }
   // Fractional sampling can punch short holes in a one-pixel border. Require
   // both aligned ends and high total coverage, not an uninterrupted run.
   let nearLeft=false,nearRight=false;
   if(bottomStart<0)for(let delta=-p(3);delta<=p(3);delta++){
    nearLeft ||= is(start+delta,bottom,kind);nearRight ||= is(end-1+delta,bottom,kind);
   }
   if(bottomStart<0&&nearLeft&&nearRight){
    let hits=0,longestGap=0,gap=0,first=-1,last=-1;
    for(let bx=start;bx<end;bx++){
     if(is(bx,bottom,kind)){hits++;if(first<0)first=bx;last=bx;gap=0;}
     else{gap++;longestGap=Math.max(longestGap,gap);}
    }
    if(hits/length>=.78&&first-start<=p(3)&&end-1-last<=p(3)&&longestGap<=p(4)){
     bottomStart=first;bottomEnd=last;
    }
   }
   if(bottomStart<0)continue;
   const left=Math.max(0,Math.min(start,bottomStart)-p(2));
   let right=Math.min(w-1,Math.max(end-1,bottomEnd)+p(2)),best=0;
   for(let rx=Math.max(end-1,bottomEnd);rx<=Math.min(w-1,Math.max(end-1,bottomEnd)+p(3));rx++){
    let hits=0;for(let yy=y+p(3);yy<=bottom-p(3);yy++)hits+=Number(is(rx,yy,kind));
    if(hits>best){best=hits;right=rx;}
   }
   const box={x:region.x+left,y:region.y+y,width:right-left+1,height:bottom-y+1,side:kind===1?'LONG':'SHORT'};
   const clipped=start<=1||end>=w-1||y<=1||bottom>=h-2;
   const vertical=best/Math.max(1,bottom-y-p(6)+1)>=.65;
   const close=closeMark(right,y,bottom,kind);
   const entryBody=body(left,right,y,bottom,kind,end>=w-1);
   if(entryBody?.quantityBox)box.quantityBox=entryBody.quantityBox;
   if(!entryBody){
    // An outlined entry-like box with its quantity hidden is uncertain,
    // rather than positive evidence that the chart is flat.
    if(vertical&&(close||(right-left+1)/(bottom-y+1)>=4)&&darkInterior(left+3,right-5,y+2,bottom-2)>.65)suspects.push(box);
    continue;
   }
   // The close X can disappear under hover controls or beyond the right crop.
   // A complete quantity cell and actual P/L text still establish an entry;
   // a plain outlined control or a clipped quantity does not.
   const rightClipped=end>=w-1;
   const completeQuantity=start>1&&y>1&&bottom<h-2;
   const strongWithoutClose=completeQuantity&&entryBody.profitText&&(vertical||rightClipped);
   if((clipped||!vertical||!close)&&!strongWithoutClose){suspects.push(box);continue;}
   if(!found.some(old=>old.side===box.side&&Math.abs(old.x-box.x)<=p(4)&&Math.abs(old.y-box.y)<=p(3)))found.push(box);
  }
 }
 // A deeply clipped entry may leave only 1–10 rows at the plot edge, too few
 // to read its quantity or close control. A bounded outlined border is still
 // evidence against FLAT. Full-width guides, short candle tops and solid
 // button remnants do not satisfy this conservative partial-box check.
 if(!found.length)for(const border of unpaired){
  const {start,end,y,kind}=border,length=end-start;
  if(start<=1||end>=w-1||length<30||length>Math.min(650,w*.85)||y>10&&y<h-11)continue;
  const left=start+Math.floor(length*.3),right=start+Math.floor(length*.8);
  let shade=y<=10?darkInterior(left,right,0,y-1):darkInterior(left,right,y+1,h-1);
  if(shade===null)shade=y<=10?darkInterior(left,right,y+1,Math.min(h-1,y+2)):darkInterior(left,right,Math.max(0,y-2),y-1);
  if(shade!==null&&shade<.55)continue;
  suspects.push({x:region.x+start,y:region.y+Math.max(0,y-10),width:length,height:Math.min(h,y+11)-Math.max(0,y-10),side:kind===1?'LONG':'SHORT'});
 }
 // Downsampling can remove a one-pixel top border while preserving the bottom
 // border, quantity cell, close X and P/L text. Recover that positive evidence
 // instead of interpreting the missing border as an empty chart.
 if(!found.length)for(const border of unpaired){
  const {start,end,y:bottom,kind}=border;
  for(let top=Math.max(0,bottom-24);top<=bottom-8;top++){
   const scale=(bottom-top+1)/19,p=n=>Math.max(1,Math.round(n*scale)),length=end-start;
   if(length<p(60)||length>p(270))continue;
   const left=Math.max(0,start-p(2)),right=Math.min(w-1,end-1+p(2));
   const cy=Math.round((top+bottom)/2);
   if(!is(left+p(3),top+p(2),kind)||!is(left+p(5),cy,kind)||[.5,.65,.8].filter(f=>dark(left+Math.floor((right-left)*f),cy)).length<2||[.5,.65,.8].filter(f=>dark(left+Math.floor((right-left)*f),top+p(2))).length<2)continue;
   const entryBody=body(left,right,top,bottom,kind,end>=w-1);
   if(!entryBody)continue;
   const box={x:region.x+left,y:region.y+top,width:right-left+1,height:bottom-top+1,side:kind===1?'LONG':'SHORT'};
   if(entryBody.quantityBox)box.quantityBox=entryBody.quantityBox;
   let vertical=0;for(let yy=top+p(2);yy<bottom-p(2);yy++)vertical+=Number(is(right,yy,kind));
   const strongEdge=vertical/Math.max(1,bottom-top-p(4))>=.65;
   if(entryBody.profitText&&start>1&&top>1&&(strongEdge||closeMark(right,top,bottom,kind))){
    if(!found.some(old=>old.side===box.side&&Math.abs(old.x-box.x)<=p(4)&&Math.abs(old.y-box.y)<=p(3)))found.push(box);
   }else if(!suspects.some(old=>Math.abs(old.x-box.x)<=p(4)&&Math.abs(old.y-box.y)<=p(3)))suspects.push(box);
   break;
  }
 }
 if(found.length===1&&!suspects.some(b=>Math.abs(b.y-found[0].y)>Math.max(4,found[0].height/4)))return outcome(found[0].side,'POSITION_ENTRY_MARKER',found);
 if(found.length>1||suspects.length)return outcome('UNKNOWN','POSITION_MARKER_UNCERTAIN',[...found,...suspects]);
 // A small crop is not independently proof of an empty chart. The caller may
 // relax the legacy size floor only after validating the complete chart.
 const complete=chartValidated===true?w>=200&&h>=100:w>=300&&h>=150;
 return complete?outcome('FLAT','NO_VISIBLE_POSITION_MARKER'):outcome('UNKNOWN','POSITION_REGION_TOO_SMALL');
}

// A local hit can prove OPEN quickly. A local miss can NEVER prove FLAT:
// absence is established only by the complete validated chart scan above.
export function createVisualPositionReader(){
 let previous=null,localReads=0,fullReads=0;
 const isOpen=result=>result.state==='LONG'||result.state==='SHORT';
 return {
  inspect(image,region,{context='',chartValidated=false}={}){
   const geometry=JSON.stringify([image?.width,image?.height,region?.x,region?.y,region?.width,region?.height,context,chartValidated===true]);
   if(previous?.geometry===geometry&&validRegion(region,image?.width,image?.height)){
    const box=previous.box,padX=Math.max(24,box.height*2),padY=Math.max(12,box.height);
    const left=Math.max(region.x,Math.floor(box.x-padX)),top=Math.max(region.y,Math.floor(box.y-padY));
    const right=Math.min(region.x+region.width,Math.ceil(box.x+box.width+padX)),bottom=Math.min(region.y+region.height,Math.ceil(box.y+box.height+padY));
    if(right-left>=40&&bottom-top>=24){
     localReads++;
     const found=inspectVisualPosition(image,{x:left,y:top,width:right-left,height:bottom-top});
     if(isOpen(found)){previous={geometry,box:{...found.boxes[0]}};return {...found,scan:'LOCAL'};}
    }
   }
   fullReads++;
   const found=inspectVisualPosition(image,region,{chartValidated});
   previous=isOpen(found)?{geometry,box:{...found.boxes[0]}}:null;
   return {...found,scan:'FULL'};
  },
  reset(){previous=null;},
  snapshot(){return {localReads,fullReads};},
 };
}
