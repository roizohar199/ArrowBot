// Exact identities of canonical text pixels. No OCR text, fuzzy comparison or
// numeric guess participates in the key.
export function normalizedTextKey(image,{mode='WHITE',rect}={}){
 const width=image?.width,height=image?.height,data=image?.data;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!data||data.length!==width*height*4)return null;
 const area=rect??{x:0,y:0,width,height};
 if(!area||!['x','y','width','height'].every(k=>Number.isSafeInteger(area[k]))||area.x<0||area.y<0||area.width<1||area.height<1||area.x+area.width>width||area.y+area.height>height||!['WHITE','LABEL_UP','LABEL_DOWN','BINARY_BLACK'].includes(mode))return null;
 let key='',byte=0,bits=0,ink=0;
 for(let y=area.y;y<area.y+area.height;y++)for(let x=area.x;x<area.x+area.width;x++){
  const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2];
  if(data[p+3]!==255)return null;
  const text=mode==='LABEL_UP'?r<200&&g<185&&b<110:mode==='LABEL_DOWN'?r>165&&g>165&&b>165:mode==='BINARY_BLACK'?r<128&&g<128&&b<128:r>175&&g>175&&b>175;
  byte=(byte<<1)|Number(text);bits++;ink+=Number(text);
  if(bits===8){key+=String.fromCharCode(byte);byte=bits=0;}
 }
 if(!ink)return null;
 if(bits)key+=String.fromCharCode(byte<<(8-bits));
 return `${mode}:${area.width}x${area.height}:`+key;
}

export function createReadCache({limit=128,accept=value=>value!==null&&value!==undefined,maxKeyLength=32768}={}){
 if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(maxKeyLength)||maxKeyLength<1||typeof accept!=='function')throw Error('INVALID_READ_CACHE_OPTIONS');
 const entries=new Map();
 return {
  get(key){
   if(!entries.has(key))return undefined;
   const value=entries.get(key);entries.delete(key);entries.set(key,value);
   return structuredClone(value);
  },
  put(key,value){
   if(typeof key!=='string'||!key||key.length>maxKeyLength||!accept(value))return false;
   let copy;try{copy=structuredClone(value);}catch{return false;}
   entries.delete(key);entries.set(key,copy);
   if(entries.size>limit)entries.delete(entries.keys().next().value);
   return true;
  },
  clear(){entries.clear();},
  get size(){return entries.size;},
 };
}
