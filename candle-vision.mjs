// Screen geometry only: no exchange prices, timestamps or hidden ticks are inferred.
// Filled TradingView red/teal candles are the default. A custom RGB palette can
// be supplied by a caller; neutral/hollow candles need a different shape model.
const DEFAULT_MAX_PIXELS=1500000;
const validImage=image=>image&&Number.isSafeInteger(image.width)&&Number.isSafeInteger(image.height)&&image.width>0&&image.height>0&&image.data?.length===image.width*image.height*4;
const validColor=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&n>=0&&n<=255);

export function createCandleVision({maxPixels=DEFAULT_MAX_PIXELS,maxCandles=160,maxBodyWidth=64,maxComponents=4096}={}){
 if(!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>8000000||!Number.isSafeInteger(maxCandles)||maxCandles<1||maxCandles>1000||!Number.isSafeInteger(maxBodyWidth)||maxBodyWidth<3||maxBodyWidth>256||!Number.isSafeInteger(maxComponents)||maxComponents<1||maxComponents>65536)throw TypeError('Invalid candle vision limits');
 let mask=new Uint8Array(0),queue=new Int32Array(0),rowLeft=new Int32Array(0),rowRight=new Int32Array(0),rowCount=new Int32Array(0),columnCount=new Int32Array(0),columnPeak=new Int32Array(0),cutColumn=new Uint8Array(0),allocations=0;
 function inspect(image,region,{palette}={}){
  const diagnostics={reason:'OK',probes:0,pixels:0,components:0,rejected:0,repairedComponents:0,bridgeColumns:0,allocations};
  const fail=reason=>({candles:[],region:null,diagnostics:{...diagnostics,reason,allocations}});
  if(!validImage(image)||!region||!['x','y','width','height'].every(k=>Number.isFinite(region[k]))||region.width<=0||region.height<=0)return fail('INVALID_IMAGE');
  if(palette!==undefined&&(!validColor(palette?.up)||!validColor(palette?.down)||palette.tolerance!==undefined&&(!Number.isFinite(palette.tolerance)||palette.tolerance<0||palette.tolerance>90)))return fail('INVALID_PALETTE');
  const {data,width,height}=image,x0=Math.max(0,Math.ceil(region.x)),y0=Math.max(0,Math.ceil(region.y)),x1=Math.min(width,Math.floor(region.x+region.width)),y1=Math.min(height,Math.floor(region.y+region.height)),w=x1-x0,h=y1-y0,size=w*h;
  if(w<1||h<1)return fail('EMPTY_REGION');
  diagnostics.pixels=size;
  if(size>maxPixels)return fail('PIXEL_BUDGET');
  if(mask.length<size||mask.length>size*4){mask=new Uint8Array(size);queue=new Int32Array(size);allocations++;}
  if(rowLeft.length<h){rowLeft=new Int32Array(h);rowRight=new Int32Array(h);rowCount=new Int32Array(h);}
  if(columnCount.length<w){columnCount=new Int32Array(w);columnPeak=new Int32Array(w);cutColumn=new Uint8Array(w);}
  const tolerance=palette?.tolerance??45;
  function kindAt(p){
   if(data[p+3]<220)return 0;
   const r=data[p],g=data[p+1],b=data[p+2];
   if(palette){
    const up=Math.max(Math.abs(r-palette.up[0]),Math.abs(g-palette.up[1]),Math.abs(b-palette.up[2])),down=Math.max(Math.abs(r-palette.down[0]),Math.abs(g-palette.down[1]),Math.abs(b-palette.down[2]));
    // Equally close colors cannot establish candle direction.
    return Math.min(up,down)>tolerance||Math.abs(up-down)<8?0:up<down?1:2;
   }
   return g>65&&g>r*1.3&&b>r*1.08&&g>b*.85?1:r>95&&r>g*1.35&&r>b*1.2?2:0;
  }
  let n=0;
  for(let y=y0;y<y1;y++)for(let p=(y*width+x0)*4,end=p+w*4;p<end;p+=4)mask[n++]=kindAt(p);
  diagnostics.probes=size;
  // A price guide can join every candle in a row into one component. Remove
  // broad horizontal strokes, retaining only pixels with independent vertical
  // support on both sides of the stroke. Look at source pixels, not edited rows.
  for(let y=0;y<h;y++)for(let x=0;x<w;){
   const kind=mask[y*w+x];if(!kind){x++;continue;}
   let end=x+1;while(end<w&&mask[y*w+end]===kind)end++;
   if(end-x>maxBodyWidth)for(let xx=x;xx<end;xx++){
    const p=((y+y0)*width+x0+xx)*4;
    if(y<4||y+4>=h||kindAt(p-width*16)!==kind||kindAt(p+width*16)!==kind)mask[y*w+xx]=0;
    diagnostics.probes+=2;
   }
   x=end;
  }
  const candles=[];
  for(let start=0;start<size;start++){
   const kind=mask[start];if(kind!==1&&kind!==2)continue;
   if(++diagnostics.components>maxComponents)return fail('COMPONENT_BUDGET');
   let begin=0,end=1,minX=start%w,maxX=minX,minY=Math.floor(start/w),maxY=minY;
   queue[0]=start;mask[start]=kind+2;
   while(begin<end){
    const i=queue[begin++],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    let j;
    if(x>0){j=i-1;if(mask[j]===kind){mask[j]=kind+2;queue[end++]=j;}}
    if(x+1<w){j=i+1;if(mask[j]===kind){mask[j]=kind+2;queue[end++]=j;}}
    if(y>0){j=i-w;if(mask[j]===kind){mask[j]=kind+2;queue[end++]=j;}}
    if(y+1<h){j=i+w;if(mask[j]===kind){mask[j]=kind+2;queue[end++]=j;}}
   }
   const bw=maxX-minX+1,bh=maxY-minY+1;
   // Capture/compression can bleed one or two dark pixels across the empty
   // column between close candles. Split only a sparse, substantially dimmer
   // column with three supported columns on both sides. A filled broad candle
   // or a solid label has no such valley. Both resulting shapes still have to
   // pass the complete candle checks below; no OHLC is guessed at a split.
   if(bw>=4&&bw<=maxBodyWidth*2&&bh>=5&&end>=8){
    columnCount.fill(0,minX,maxX+1);columnPeak.fill(0,minX,maxX+1);cutColumn.fill(0,minX,maxX+1);
    let peak=0;
    for(let i=0;i<end;i++){
     const index=queue[i],x=index%w,y=Math.floor(index/w),p=((y+y0)*width+x0+x)*4,value=Math.max(data[p],data[p+1],data[p+2]);
     columnCount[x]++;columnPeak[x]=Math.max(columnPeak[x],value);peak=Math.max(peak,value);
    }
    let cuts=0,leftSupport=0,leftPeak=0;
    for(let x=minX;x<=maxX;x++){
     if(columnCount[x]>2){leftSupport++;leftPeak=Math.max(leftPeak,columnPeak[x]);continue;}
     if(!columnCount[x]||columnPeak[x]>=peak*.65)continue;
     // Peripheral single-pixel spurs can inflate an otherwise straight body.
     // Never erase support on the ROI edge, which must remain clipped.
     if((x===minX&&minX>0||x===maxX&&maxX<w-1)&&bw>=4){cutColumn[x]=1;cuts++;continue;}
     if(leftSupport<3||columnPeak[x]>=leftPeak*.65)continue;
     let rightSupport=0,rightPeak=0;
     for(let xx=x+1;xx<=maxX;xx++)if(columnCount[xx]>2){rightSupport++;rightPeak=Math.max(rightPeak,columnPeak[xx]);}
     if(rightSupport>=3&&columnPeak[x]<rightPeak*.65){cutColumn[x]=1;cuts++;}
    }
    if(cuts){
     for(let i=0;i<end;i++){const index=queue[i];mask[index]=cutColumn[index%w]?0:kind;}
     diagnostics.repairedComponents++;diagnostics.bridgeColumns+=cuts;
     // Revisit the original component's first pixel. Every repair removes at
     // least one pixel and all retries count toward the component work budget.
     start--;continue;
    }
   }
   if(bw<3||bw>maxBodyWidth||bh<5||end<Math.max(8,bw*2)){diagnostics.rejected++;continue;}
   rowLeft.fill(w,minY,maxY+1);rowRight.fill(-1,minY,maxY+1);rowCount.fill(0,minY,maxY+1);
   for(let i=0;i<end;i++){const index=queue[i],x=index%w,y=Math.floor(index/w);rowLeft[y]=Math.min(rowLeft[y],x);rowRight[y]=Math.max(rowRight[y],x);rowCount[y]++;}
   const bodyThreshold=Math.max(3,Math.ceil(bw*.75));let bodyTop=-1,bodyBottom=-1,bodyRows=0;
   for(let y=minY;y<=maxY;y++)if(rowRight[y]-rowLeft[y]+1>=bodyThreshold&&rowCount[y]>=bodyThreshold){if(bodyTop<0)bodyTop=y;bodyBottom=y;bodyRows++;}
   if(bodyTop<0||bodyRows<Math.max(1,bodyBottom-bodyTop)||bodyRows/(bodyBottom-bodyTop+1)<.85){diagnostics.rejected++;continue;}
   const center=(minX+maxX)/2,wickLimit=Math.max(2,Math.floor(bw*.4)),bodyHeight=bodyBottom-bodyTop+1,wickHeight=bh-bodyHeight;
   let regular=true,bodyInk=0;
   for(let y=minY;y<=maxY;y++){
    const span=rowRight[y]-rowLeft[y]+1,cy=(rowLeft[y]+rowRight[y])/2;
    if(y<bodyTop||y>bodyBottom){
     // A single rounded/antialiased shoulder next to the body is allowed. A
     // widening wick farther away remains an irregular shape or an overlay.
     const shoulder=(y===bodyTop-1||y===bodyBottom+1)&&span<bodyThreshold;
     if(span>wickLimit&&!shoulder||Math.abs(cy-center)>Math.max(1,bw*.2)){regular=false;break;}
    }
    else{bodyInk+=rowCount[y];if(Math.abs(rowLeft[y]-minX)>1||Math.abs(rowRight[y]-maxX)>1){regular=false;break;}}
   }
   // Without a distinct wick, a short/square patch can also be an indicator
   // icon or label. Require clear vertical extent before assigning OHLC to
   // that shape. Tall bodies and doji with independent wicks remain readable.
   if(!regular||bodyInk/(bw*bodyHeight)<.85||wickHeight<3&&bh<Math.max(5,bw*1.5)){diagnostics.rejected++;continue;}
   const direction=kind===1?'UP':'DOWN',top=y0+bodyTop,bottom=y0+bodyBottom,clipped=minX===0||maxX===w-1||minY===0||maxY===h-1;
   candles.push({x:x0+center,bodyTop:top,bodyBottom:bottom,highY:y0+minY,lowY:y0+maxY,openY:direction==='UP'?bottom:top,closeY:direction==='UP'?top:bottom,direction,bodyWidth:bw,confidence:clipped?.45:wickHeight>=3?.92:.78,clipped});
   if(candles.length>maxCandles)return fail('CANDLE_BUDGET');
  }
  candles.sort((a,b)=>a.x-b.x);
  diagnostics.allocations=allocations;
  if(!candles.length)diagnostics.reason='NO_CANDLES';
  return {candles,region:{x:x0,y:y0,width:w,height:h},diagnostics};
 }
 return {inspect,snapshot:()=>({bufferPixels:mask.length,allocations}),reset(){mask=new Uint8Array(0);queue=new Int32Array(0);rowLeft=new Int32Array(0);rowRight=new Int32Array(0);rowCount=new Int32Array(0);columnCount=new Int32Array(0);columnPeak=new Int32Array(0);cutColumn=new Uint8Array(0);}};
}

const sharedVision=createCandleVision();
export function findCandles(image,region,options){return sharedVision.inspect(image,region,options);}
