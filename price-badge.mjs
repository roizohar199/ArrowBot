// Locate, but do not numerically interpret, an apparent last-price badge.
// The chart scale must be manually selected; all colors/shapes are heuristic.
export function findPriceBadges({ data, width, height }, region) {
  if (!data || data.length !== width * height * 4 || !region ||
      ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
      region.x < 0 || region.y < 0 || region.width < 30 || region.height < 30 ||
      region.x + region.width > width || region.y + region.height > height) return [];
  const w = region.width, h = region.height, pixels = new Uint8Array(w*h), seen = new Uint8Array(w*h);
  function color(x,y) {
    const i=((region.y+y)*width+region.x+x)*4, r=data[i], g=data[i+1], b=data[i+2];
    // Chroma survives antialiased reduction better than a high brightness
    // cutoff. Structural fill, shape and light text still have to agree.
    if (g >= 65 && b >= 48 && g-r >= 28 && b-r >= 20 && g > r*1.4 && b > r*1.25 && g >= b*.98) return 1;
    if (r >= 100 && g <= 150 && b <= 155 && r-Math.max(g,b) >= 35 && r > g*1.35 && r > b*1.2 && b >= g*.65) return 2;
    return 0;
  }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) pixels[y*w+x]=color(x,y);
  const found=[];
  for(let start=0;start<pixels.length;start++) {
    if(!pixels[start] || seen[start]) continue;
    const kind=pixels[start], queue=[start]; seen[start]=1; let count=0, minX=w,maxX=0,minY=h,maxY=0,white=0;
    for(let q=0;q<queue.length;q++) {
      const index=queue[q], x=index%w, y=Math.floor(index/w); count++;
      minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      const neighbors=[x>0?index-1:-1,x+1<w?index+1:-1,y>0?index-w:-1,y+1<h?index+w:-1];
      for(const n of neighbors) if(n>=0 && !seen[n] && pixels[n]===kind){seen[n]=1;queue.push(n);}
    }
    const bw=maxX-minX+1,bh=maxY-minY+1;
    const area=bw*bh,aspect=bw/bh;
    if(bw<18 || bw>Math.max(240,w*.6) || bh<6 || bh>96 || area<90 || aspect<1.8 || aspect>16 || count/area<.42 || minX===0 || minY===0 || maxX===w-1 || maxY===h-1) continue;
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {const i=((region.y+y)*width+region.x+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(Math.min(r,g,b)>=150&&Math.max(r,g,b)-Math.min(r,g,b)<=60)white++;}
    if(white < Math.max(2,Math.round(area*.003))) continue;
    found.push({x:region.x+minX,y:region.y+minY,width:bw,height:bh,color:kind===1?'TURQUOISE':'RED'});
  }
  return found;
}
export function findPriceBadge(image, region) {
  const found = findPriceBadges(image, region);
  return found.length === 1 ? found[0] : null;
}
// Scale is measured from the glyph rows, rather than the number of digits in
// a price. A second text group is the optional countdown, not price content.
export function measurePriceBadge(image,badge){
  const {data,width,height}=image??{},b=badge;
  if(!data||!b||![b.x,b.y,b.width,b.height].every(Number.isInteger)||b.x<0||b.y<0||b.x+b.width>width||b.y+b.height>height)return null;
  const rows=[],groups=[],threshold=Math.max(1,Math.round(b.width*.025));
  for(let y=0;y<b.height;y++){
    let count=0;for(let x=1;x<b.width-1;x++){const i=((b.y+y)*width+b.x+x)*4,r=data[i],g=data[i+1],z=data[i+2];if(Math.min(r,g,z)>=150&&Math.max(r,g,z)-Math.min(r,g,z)<=60)count++;}
    rows.push(count>=threshold);
  }
  for(let y=0;y<rows.length;y++)if(rows[y]){const start=y;while(y+1<rows.length&&rows[y+1])y++;if(y-start+1>=2)groups.push({start,end:y,height:y-start+1});}
  const first=groups[0];if(!first)return null;
  return {glyphHeight:first.height,scale:Math.max(.4,Math.min(3,first.height/9)),rows:groups,priceHeight:groups.length>1?Math.max(first.end+1,Math.ceil((first.end+1+groups[1].start)/2)):b.height};
}
// Some TradingView badges include a second row with the bar countdown. OCR
// and freshness checks must use only the price row, not the ticking timer.
export function priceTextBounds(badge,image) {
  const measured=image?measurePriceBadge(image,badge):null;
  return { x:badge.x, y:badge.y, width:badge.width,
    height:measured?.priceHeight??Math.min(badge.height, Math.max(1, Math.round(badge.width * 17 / 66))) };
}
