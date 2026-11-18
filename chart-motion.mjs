// Independent motion evidence from candle edges. Labels, neutral grid lines
// and one-pixel order/crosshair lines cannot establish chart translation.
const MAX_SAMPLES=96,MAX_PROBES=32768,STRIDE=17;
const candle=(r,g,b)=>(r>95&&r>g*1.35&&r>b*1.2)||(g>70&&g>r*1.3&&b>r*1.1&&g>b*.85);
const validImage=image=>image&&Number.isSafeInteger(image.width)&&Number.isSafeInteger(image.height)&&image.width>0&&image.height>0&&image.data?.length===image.width*image.height*4;
const patchOffsets=[[0,0],[-1,0],[1,0],[0,-1],[0,1]];

// Copy at most 96 small patches, rather than borrowing a canvas pixel buffer.
export function captureCandleFeatures(image,region,{maxShift=16,maxSamples=MAX_SAMPLES}={}){
 if(!validImage(image)||!region||!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||region.width<=0||region.height<=0)return null;
 const {data,width,height}=image,margin=Math.max(8,Math.ceil(maxShift)+2),left=Math.max(margin,Math.ceil(region.x)),top=Math.max(margin,Math.ceil(region.y)),right=Math.min(width-margin,Math.floor(region.x+region.width)),bottom=Math.min(height-margin,Math.floor(region.y+region.height));
 if(right<=left||bottom<=top)return {width,height,points:new Int32Array(0),count:0};
 const step=Math.max(2,Math.ceil(Math.sqrt((right-left)*(bottom-top)/MAX_PROBES))),indices=[];let probes=0;
 scan:for(let y=top;y<bottom;y+=step)for(let x=left;x<right;x+=step){
  if(++probes>MAX_PROBES)break scan;
  const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2];
  if(data[p+3]!==255||!candle(r,g,b))continue;
  // Horizontal order lines have no vertical candle body. Keep edge pixels
  // so resampling/subpixel changes are visible in the later patch check.
  const above=p-width*4,below=p+width*4;
  if(!candle(data[above],data[above+1],data[above+2])&&!candle(data[below],data[below+1],data[below+2]))continue;
  const farLeft=p-16,farRight=p+16,farAbove=p-width*24,farBelow=p+width*24;
  // Thick SL/TP lines also have colored neighbors above/below. Candle edges
  // must have narrow horizontal support and genuine vertical extent.
  if(candle(data[farLeft],data[farLeft+1],data[farLeft+2])&&candle(data[farRight],data[farRight+1],data[farRight+2]))continue;
  if(!candle(data[farAbove],data[farAbove+1],data[farAbove+2])&&!candle(data[farBelow],data[farBelow+1],data[farBelow+2]))continue;
  let edge=false;
  for(const offset of [-4,4,-width*4,width*4])if(Math.abs(r-data[p+offset])+Math.abs(g-data[p+offset+1])+Math.abs(b-data[p+offset+2])>=70){edge=true;break;}
  if(edge)indices.push(y*width+x);
 }
 const limit=Math.min(MAX_SAMPLES,Math.max(1,Math.floor(maxSamples))),count=Math.min(limit,indices.length),points=new Int32Array(count*STRIDE);
 for(let i=0;i<count;i++){
  const index=indices[Math.floor((i+.5)*indices.length/count)],x=index%width,y=Math.floor(index/width),base=i*STRIDE;points[base]=x;points[base+1]=y;
  let j=base+2;for(const [dx,dy] of patchOffsets){const p=((y+dy)*width+x+dx)*4;points[j++]=data[p];points[j++]=data[p+1];points[j++]=data[p+2];}
 }
 return {width,height,points,count};
}

export function matchCandleMotion(previous,current,{maxShift=16}={}){
 const fail=(reason,comparisons=0)=>({motion:null,reason,comparisons,samples:previous?.count??0});
 if(!previous||!validImage(current)||previous.width!==current.width||previous.height!==current.height)return fail('IMAGE_CHANGED');
 const {points,count,width}=previous,data=current.data;
 if(count<24)return fail('NO_CANDLE_TEXTURE');
 let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
 for(let i=0;i<count;i++){const p=i*STRIDE;left=Math.min(left,points[p]);right=Math.max(right,points[p]);top=Math.min(top,points[p+1]);bottom=Math.max(bottom,points[p+1]);}
 if(right-left<40||bottom-top<40)return fail('CANDLE_TEXTURE_NOT_DISTRIBUTED');
 const radius=Math.min(16,Math.max(0,Math.floor(maxShift))),scores=[],margin=15;let comparisons=0,best={x:0,y:0,cost:Infinity};
 function score(dx,dy){
  let sum=0;const cutoff=(best.cost+margin)*count;
  for(let i=0;i<count;i++){
   const p=i*STRIDE,k=((points[p+1]+dy)*width+points[p]+dx)*4;
   sum+=Math.min(300,Math.abs(points[p+2]-data[k])+Math.abs(points[p+3]-data[k+1])+Math.abs(points[p+4]-data[k+2]));comparisons++;
   if(sum>cutoff)break;
  }
  const value={x:dx,y:dy,cost:sum/count};scores.push(value);
  if(value.cost<best.cost)best=value;
 }
 // Zero first makes the ordinary unchanged-frame path cheap: non-matching
 // shifts stop once their partial cost already proves they cannot compete.
 score(0,0);
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(dx||dy)score(dx,dy);
 let runner=Infinity;for(const value of scores)if(Math.abs(value.x-best.x)>2||Math.abs(value.y-best.y)>2)runner=Math.min(runner,value.cost);
 if(!Number.isFinite(runner)||best.cost>30||runner-best.cost<12)return fail('AMBIGUOUS_MOTION',comparisons);
 // Integer translation must preserve edge neighborhoods, not just colored
 // interiors. This rejects autofit/scale changes and subpixel resampling
 // which could otherwise masquerade as a trustworthy zero displacement.
 let patchCost=0,clean=0;
 for(let i=0;i<count;i++){
  const base=i*STRIDE,x=points[base]+best.x,y=points[base+1]+best.y;let cost=0,j=base+2;
  for(const [dx,dy] of patchOffsets){const p=((y+dy)*width+x+dx)*4;cost+=Math.abs(points[j++]-data[p])+Math.abs(points[j++]-data[p+1])+Math.abs(points[j++]-data[p+2]);}
  patchCost+=cost/15;if(cost/15<=2)clean++;
 }
 if(clean/count<.9||patchCost/count>4)return fail('DEFORMED_FRAME',comparisons);
 return {motion:{x:best.x,y:best.y},reason:best.x||best.y?'VERIFIED_TRANSLATION':'VERIFIED_STATIONARY',comparisons,samples:count};
}

// Compatibility helper for callers with two complete frame snapshots.
export function estimateChartMotion(previous,current,region,maxShift=16){
 return matchCandleMotion(captureCandleFeatures(previous,region,{maxShift}),current,{maxShift}).motion;
}
