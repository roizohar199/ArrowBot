// Infer each label's scale from its own shape. Price text length, browser zoom
// and capture dimensions are independent and cannot provide an arrow scale.
const ascending=(a,b)=>a-b;
export function createNumberedLabelReader(){
 let maskBuffer=new Uint8Array(0),seenBuffer=new Uint8Array(0),queueBuffer=new Int32Array(0),allocations=0;
 return {
  inspect({data,width,height},region,scaleHint){
   if(!data||data.length!==width*height*4||!region)throw Error('INVALID_IMAGE');
   if(scaleHint!==undefined&&(!Number.isFinite(scaleHint)||scaleHint<.35||scaleHint>3))return {candidates:[],ambiguous:[]};
   const x0=Math.max(0,Math.ceil(region.x)),y0=Math.max(0,Math.ceil(region.y)),x1=Math.min(width,Math.floor(region.x+region.width)),y1=Math.min(height,Math.floor(region.y+region.height)),w=x1-x0,h=y1-y0,size=w*h;
   if(w<1||h<1)return {candidates:[],ambiguous:[]};
   if(maskBuffer.length<size||maskBuffer.length>size*4){maskBuffer=new Uint8Array(size);seenBuffer=new Uint8Array(size);queueBuffer=new Int32Array(size);allocations++;}
   const mask=maskBuffer,seen=seenBuffer,queue=queueBuffer;
   seen.fill(0,0,size);
   let index=0;
   for(let y=0;y<h;y++){
    let p=((y+y0)*width+x0)*4;
    for(let x=0;x<w;x++,p+=4,index++){
     const r=data[p],g=data[p+1],b=data[p+2];
     const kind=r>170&&g>140&&g>r*.72&&b<140&&r>b*1.5&&g>b*1.4?1:r>95&&b>115&&g<115&&r>g*1.5&&b>g*1.5?2:0;
     mask[index]=kind&&data[p+3]<200?0:kind;
    }
   }
   const candidates=[],ambiguous=[];
   for(let n=0;n<size;n++){
    const kind=mask[n];if(!kind||seen[n])continue;let begin=0,end=0;queue[end++]=n;seen[n]=1;let minX=n%w,maxX=minX,minY=Math.floor(n/w),maxY=minY;
    // Keep the flood fill closure-free. Capturing per-component locals here
    // also forces a lexical context into the surrounding every-pixel scan.
    while(begin<end){
     const i=queue[begin++],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
     let j;
     if(x>0){j=i-1;if(!seen[j]&&mask[j]===kind){seen[j]=1;queue[end++]=j;}}
     if(x+1<w){j=i+1;if(!seen[j]&&mask[j]===kind){seen[j]=1;queue[end++]=j;}}
     if(y>0){j=i-w;if(!seen[j]&&mask[j]===kind){seen[j]=1;queue[end++]=j;}}
     if(y+1<h){j=i+w;if(!seen[j]&&mask[j]===kind){seen[j]=1;queue[end++]=j;}}
    }
    const bw=maxX-minX+1,bh=maxY-minY+1,box={x:x0+minX,y:y0+minY,width:bw,height:bh},scale=bh/33,aspect=bw/bh;
    if(bh<11||bh>114||bw<8||end<Math.max(24,Math.round(230*scale*scale))||minX===0||minY===0||maxX===w-1||maxY===h-1)continue;
    if(aspect<.78||aspect>1.35){if(aspect>=.45&&aspect<=2.5)ambiguous.push(box);continue;}
    // A single label has straight body sides. A merged pair can have the same
    // bounding-box aspect but its body steps sideways part-way down the box.
    let minLeft=bw,maxLeft=-1,minRight=bw,maxRight=-1,bodyRows=0;
    const leftEdges=[],rightEdges=[];
    for(let yy=Math.ceil(bh*.25);yy<=Math.floor(bh*.70);yy++){
     let left=-1,right=-1;for(let xx=0;xx<bw;xx++)if(mask[(minY+yy)*w+minX+xx]===kind){if(left<0)left=xx;right=xx;}
     if(left>=0){minLeft=Math.min(minLeft,left);maxLeft=Math.max(maxLeft,left);minRight=Math.min(minRight,right);maxRight=Math.max(maxRight,right);leftEdges.push(left);rightEdges.push(right);bodyRows++;}
    }
    const edgeTolerance=Math.max(3,bw*.20);
    let straightBody=bodyRows>=3&&maxLeft-minLeft<=edgeTolerance&&maxRight-minRight<=edgeTolerance;
    if(!straightBody&&bodyRows>=8){
     const orderedLeft=leftEdges.slice().sort(ascending),orderedRight=rightEdges.slice().sort(ascending),medianLeft=orderedLeft[bodyRows>>1],medianRight=orderedRight[bodyRows>>1];
     let consistent=0;
     for(let row=0;row<bodyRows;row++)if(Math.abs(leftEdges[row]-medianLeft)<=edgeTolerance&&Math.abs(rightEdges[row]-medianRight)<=edgeTolerance)consistent++;
     // A single antialiased or occluded edge row can disappear at reduced
     // scale. Two persistent side plateaus remain ambiguous, as before.
     straightBody=consistent>=bodyRows-1&&consistent/bodyRows>=.9;
    }
    if(!straightBody){ambiguous.push(box);continue;}
    let coloredBody=0,contrast=0,bodyCount=0,tip=0,tipCount=0;
    for(let yy=0;yy<bh;yy++)for(let xx=0;xx<bw;xx++){
     const body=kind===1?yy>bh*.23:yy<bh*.77;
     if(body){bodyCount++;if(mask[(minY+yy)*w+minX+xx]===kind)coloredBody++;const p=((y0+minY+yy)*width+x0+minX+xx)*4,r=data[p],g=data[p+1],b=data[p+2];if(kind===1?r<155&&g<145&&b<110:r>160&&g>135&&b>170)contrast++;}
     else{tipCount++;if(mask[(minY+yy)*w+minX+xx]===kind)tip++;}
    }
    const bodyFraction=coloredBody/bodyCount,tipFraction=tip/tipCount;
    if(bodyFraction<.55||tipFraction<.08||tipFraction>.9||bodyFraction-tipFraction<.06||contrast<Math.max(1,Math.round(4*scale*scale)))continue;
    candidates.push({x:Math.round(box.x+bw/2),y:Math.round(box.y+bh/2),direction:kind===1?'UP':'DOWN',box,scale});
   }
   return {candidates,ambiguous};
  },
  snapshot(){return {bufferPixels:maskBuffer.length,allocations};},
  reset(){maskBuffer=new Uint8Array(0);seenBuffer=new Uint8Array(0);queueBuffer=new Int32Array(0);},
 };
}
const sharedReader=createNumberedLabelReader();
export function findNumberedLabels(image,region,scaleHint){return sharedReader.inspect(image,region,scaleHint);}
