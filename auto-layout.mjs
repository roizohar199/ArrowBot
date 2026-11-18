import {findPriceBadges,measurePriceBadge} from './price-badge.mjs';

// A price line is useful evidence, but a one-pixel dotted guide can disappear
// during reduction. Independent repeated axis text plus a coherent plot is
// required before recovering a layout without that guide.
function priceAxis(image,badge,unit){
 const {data,width,height}=image,groups=[],threshold=Math.max(2,Math.round(badge.width*.035));
 let start=null;
 for(let y=0;y<=height;y++){
  let ink=0;
  if(y<height)for(let x=badge.x;x<badge.x+badge.width;x++){
   const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
   if(Math.min(r,g,b)>130&&Math.max(r,g,b)-Math.min(r,g,b)<55)ink++;
  }
  const on=ink>=threshold;
  if(on&&start===null)start=y;
  if(!on&&start!==null){
   const h=y-start;
   if(h>=2&&h<=Math.max(12,unit*25)&&!(start<badge.y+badge.height&&y>badge.y))groups.push({start,end:y-1,center:(start+y-1)/2});
   start=null;
  }
 }
 if(groups.length<4)return null;
 const gaps=[];for(let i=1;i<groups.length;i++){const gap=groups[i].center-groups[i-1].center;if(gap>=Math.max(4,unit*5)&&gap<=Math.max(35,unit*100))gaps.push(gap);}
 if(!gaps.length)return null;gaps.sort((a,b)=>a-b);
 const pitch=gaps[Math.floor(gaps.length/2)],limit=Math.max(18*unit,pitch*2.8),clusters=[];
 for(const group of groups){let cluster=clusters.at(-1);if(!cluster||group.center-cluster.at(-1).center>limit){cluster=[];clusters.push(cluster);}cluster.push(group);}
 const cy=badge.y+badge.height/2;
 const candidates=clusters.filter(c=>c.length>=4&&c.at(-1).end-c[0].start>=Math.max(55*unit,height*.12)&&cy>=c[0].start-limit&&cy<=c.at(-1).end+limit);
 if(candidates.length!==1)return null;
 const rows=candidates[0];return {top:rows[0].start,bottom:rows.at(-1).end,pitch,groups:rows.length};
}

export function detectAutoLayout(image){
 const {data,width,height}=image??{};
 if(!data||width<200||height<120||data.length!==width*height*4)return null;
 const badges=findPriceBadges(image,{x:0,y:0,width,height});
 const channel=(x,y)=>{const i=(y*width+x)*4;return[data[i],data[i+1],data[i+2]];};
 const sameColor=(rgb,color)=>color==='RED'?rgb[0]>42&&rgb[0]>rgb[1]*1.55&&rgb[0]>rgb[2]*1.2:rgb[1]>30&&rgb[2]>25&&rgb[1]>rgb[0]*1.3&&rgb[2]>rgb[0]*1.2&&rgb[1]>=rgb[2]*.92;
 const options=[],fallbacks=[];
 for(const badge of badges){
  const metrics=measurePriceBadge(image,badge),unit=metrics?.scale??Math.max(.4,Math.min(3,badge.height/20));
  const p=n=>Math.max(1,Math.round(n*unit)),axis=priceAxis(image,badge,unit);
  let best=null;
  for(let y=Math.max(0,badge.y-p(2));y<Math.min(height,badge.y+badge.height+p(2));y++){
   const hits=[];for(let x=0;x<badge.x-p(10);x++)if(sameColor(channel(x,y),badge.color))hits.push(x);
   if(hits.length<Math.max(12,p(60)))continue;
   // Candle bodies or an order's short horizontal guide can share the price
   // badge's hue. They must not redefine the left half of a visible chart.
   const span=hits.at(-1)-hits[0];if(span<Math.max(p(180),width*.15,badge.x*.65))continue;
   if(!best||hits.length>best.hits)best={y,hits:hits.length,left:hits[0],right:hits.at(-1)};
  }
  if(best)options.push({badge,unit,axis,...best,confidence:'PRICE_LINE'});
  else if(axis&&badge.x>=Math.max(120,p(180)))fallbacks.push({badge,unit,axis,y:Math.round(badge.y+badge.height/3),hits:0,left:0,right:badge.x-p(45),confidence:'PRICE_AXIS'});
 }
 options.sort((a,b)=>b.hits-a.hits);
 if(options.length>1&&options[1].hits>=options[0].hits*.7)return null;
 if(!options.length&&fallbacks.length!==1)return null;
 const chosen=options[0]??fallbacks[0],{unit,axis}=chosen,p=n=>Math.max(1,Math.round(n*unit));
 const minWidth=Math.max(120,p(220)),minHeight=Math.max(60,p(110));
 const left=Math.max(0,chosen.left-p(8)),lineRight=Math.min(chosen.badge.x-p(10),chosen.right+p(4));
 if(lineRight-left<minWidth)return null;
 const counts=new Map(),axisCounts=new Map();
 for(let y=Math.max(0,chosen.y-p(80));y<Math.min(height,chosen.y+p(81));y+=Math.max(1,p(4)))for(let x=left+p(20);x<chosen.badge.x-p(20);x+=Math.max(8,p(31))){
  const[r,g,b]=channel(x,y);if(r<65&&g<75&&b<90&&(b>=r+5||Math.max(r,g,b)-Math.min(r,g,b)<=4)){const key=`${r},${g},${b}`;counts.set(key,(counts.get(key)??0)+1);if(x>=chosen.badge.x-Math.max(p(180),Math.round(width*.25)))axisCounts.set(key,(axisCounts.get(key)??0)+1);}
 }
 const bg=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];if(!bg||bg[1]<Math.max(12,p(20)))return null;
 const nearAxis=[...axisCounts.entries()].sort((a,b)=>b[1]-a[1])[0];
 const reference=(nearAxis&&nearAxis[1]>=Math.max(12,p(20))?nearAxis:bg)[0].split(',').map(Number),neutral=Math.max(...reference)-Math.min(...reference)<=4;
 const secondary=bg[0].split(',').map(Number),backgrounds=[reference];
 if(secondary.some((v,i)=>Math.abs(v-reference[i])>6))backgrounds.push(secondary);
 const isBackground=(x,y)=>{const rgb=channel(x,y);return backgrounds.some(color=>rgb.every((v,i)=>Math.abs(v-color[i])<=6));};
 let right=null;
 if(neutral)right=chosen.badge.x-Math.max(p(45),Math.round(chosen.badge.width));
 // The visible price guide can stop early or be interrupted by overlays.
 // Search from the independently located price axis, not from its last
 // colored pixel, so an incomplete guide cannot truncate the chart.
 else for(let x=chosen.badge.x-p(12);x>left+minWidth;x-=Math.max(1,p(2))){
  let matches=0,total=0;for(const dy of[-70,-55,-40,-25,25,40,55,70]){const y=chosen.y+p(Math.abs(dy))*Math.sign(dy);if(y>=0&&y<height){total++;if(isBackground(x,y))matches++;}}
  if(total>=4&&matches/total>=.5){right=x+1;break;}
 }
 if(right===null)return null;
 right=Math.min(right+Math.round((right-left)*.04),chosen.badge.x-p(12));if(right-left<minWidth)return null;
 // Determine vertical bounds using the original coherent plot area. The
 // axis-colored background can continue into the time toolbar below it.
 let boundaryRight=right;
 if(backgrounds.length>1){
  for(let x=right-1;x>left+minWidth;x-=Math.max(1,p(2))){
   let matches=0;for(const dy of[-70,-55,-40,-25,25,40,55,70]){const y=chosen.y+p(Math.abs(dy))*Math.sign(dy);if(y>=0&&y<height&&channel(x,y).every((v,i)=>Math.abs(v-secondary[i])<=6))matches++;}
   if(matches>=4){boundaryRight=x;break;}
  }
 }
 function plotRow(y){let count=0,total=0;for(let x=left+p(25);x<boundaryRight-p(25);x+=Math.max(10,p(50))){total++;const rgb=channel(x,y);if(rgb.every((v,i)=>Math.abs(v-secondary[i])<=6))count++;}return total>0&&count/total>=.5;}
 function boundary(start,step){let misses=0,last=start;for(let y=start;y>=0&&y<height;y+=step){if(plotRow(y)){last=y;misses=0;}else if(++misses>=Math.max(6,p(40)))break;}return last;}
 let top=boundary(chosen.y,-1),bottom=boundary(chosen.y,1);
 // Tick labels can be occluded or sparse without changing the visible plot.
 // Their extent must never crop an intact entry marker out of the chart.
 // Axis-only recovery also needs independent visible plot boundaries; a
 // truncated dark image plus some axis text is not a complete chart proof.
 if(chosen.confidence==='PRICE_AXIS'&&(top<=0||bottom>=height-1||plotRow(top-1)||plotRow(bottom+1)))return null;
 top=Math.max(0,top);bottom=Math.min(height-1,bottom);if(bottom-top<minHeight)return null;
 const chart={x:left,y:top,width:right-left,height:bottom-top+1},recentX=Math.round(left+chart.width*.78);
 const recent={x:recentX,y:top,width:left+chart.width-recentX,height:chart.height};
 const priceX=Math.max(right+1,chosen.badge.x-p(8)),price={x:priceX,y:top,width:Math.min(width-priceX,chosen.badge.width+p(16)),height:chart.height};
 if(price.width<Math.max(12,p(25))||price.x+price.width>width||recent.x+recent.width>chart.x+chart.width)return null;
 const layout={chart,recent,price,badge:chosen.badge,frame:{width,height},background:reference,backgrounds,neutralBackground:neutral,scale:unit,minChart:{width:minWidth,height:minHeight},confidence:chosen.confidence,axisGroups:axis?.groups??0};
 // A fallback based on axis glyphs must pass the same independent plot/axis
 // visibility check used while monitoring; a colorful button is insufficient.
 return cachedLayoutStillVisible(image,layout)?{...layout,validated:true}:null;
}

export function cachedLayoutStillVisible(image,layout){
 if(!image?.data||!layout?.frame||!layout?.chart||!Array.isArray(layout.background)||image.width!==layout.frame.width||image.height!==layout.frame.height||image.data.length!==image.width*image.height*4)return false;
 const{x,y,width,height}=layout.chart,min=layout.minChart??{width:300,height:150};
 if(x<0||y<0||width<min.width||height<min.height||x+width>image.width||y+height>image.height)return false;
 const colors=Array.isArray(layout.backgrounds)?layout.backgrounds:[layout.background];
 const match=(px,py)=>{const i=(py*image.width+px)*4;return colors.some(color=>color.every((v,c)=>Math.abs(image.data[i+c]-v)<=6));};
 const unit=layout.scale??1,offset=Math.max(4,Math.round(12*unit));let inside=0,total=0,outside=0,outsideTotal=0;
 for(let row=1;row<=8;row++){
  const py=Math.floor(y+height*row/9);for(let col=1;col<=10;col++){const px=Math.floor(x+width*col/11);total++;if(match(px,py))inside++;}
  const px=Math.floor(x+width+offset);if(px<image.width){outsideTotal++;if(match(px,py))outside++;}
 }
 if(inside/total<.55||outsideTotal<4)return false;
 if(!layout.neutralBackground)return outside/outsideTotal<=.35;
 const region=layout.price;if(!region||region.x<0||region.y<0||region.x+region.width>image.width||region.y+region.height>image.height)return false;
 let light=0;const stride=Math.max(1,Math.round(2*unit));
 for(let py=region.y;py<region.y+region.height;py+=stride)for(let px=region.x;px<region.x+region.width;px+=stride){const i=(py*image.width+px)*4;if(image.data[i]>125&&image.data[i+1]>125&&image.data[i+2]>125)light++;}
 return light>=Math.max(4,Math.round(12*unit*unit));
}
