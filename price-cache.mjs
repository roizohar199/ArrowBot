// Exact image identity: cache only previous OCR consensus for identical pixels.
// Values live in memory for one monitoring session and never authorize trades.
export function priceImageKey(image, rect) {
  const bytes=new Uint8Array(rect.width*rect.height*3); let n=0;
  for(let y=rect.y;y<rect.y+rect.height;y++) for(let x=rect.x;x<rect.x+rect.width;x++) {
    const i=(y*image.width+x)*4; bytes[n++]=image.data[i]; bytes[n++]=image.data[i+1]; bytes[n++]=image.data[i+2];
  }
  return `${rect.width}x${rect.height}:`+String.fromCharCode(...bytes);
}
export function createPriceCache(limit=128) {
  const entries=new Map();
  return {
    get(key){return entries.get(key);},
    put(key,value){if(typeof key!=='string'||!Number.isFinite(value))return;entries.delete(key);entries.set(key,value);if(entries.size>limit)entries.delete(entries.keys().next().value);},
    clear(){entries.clear();},
  };
}
