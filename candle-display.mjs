// Display updates are throttled independently of frame-by-frame observation.
// Pixel measurements describe the received images, not exchange tick data.
const reasons={
  BASELINE:'נקבע בסיס חדש; ממתין לתמונה נוספת.',
  CONTEXT_CHANGED:'זהות הגרף השתנתה; בונה בסיס חדש.',
  GEOMETRY_CHANGED:'תצוגת הגרף השתנתה; בונה בסיס חדש.',
  CAPTURE_GAP:'הקליטה חודשה; בונה בסיס חדש.',
  NO_CANDLES:'לא נמצאו נרות ברורים באזור הקריאה.',
  NO_ANCHORS:'נדרשים נרות קודמים ברורים לאימות תנועת הגרף.',
  AMBIGUOUS_MOTION:'תנועת הגרף אינה ברורה; ממתין לבסיס יציב.',
  UNVERIFIED_MOTION:'נדרשים נרות קודמים יציבים לאימות תנועת הגרף.',
  AMBIGUOUS_CANDLES:'יש צורות חופפות; סמנו את אזור המחיר ללא עמודות נפח.',
  LATEST_CLIPPED:'הנר הימני ביותר חתוך; הציגו את הנר והפתילים בשלמותם.',
  LATEST_DISAPPEARED:'הנר שנמדד הוסתר או נעלם; ממתין לזיהויו מחדש.',
  CANDLE_RECOVERED:'הנר זוהה מחדש; מתחיל בסיס מדידה חדש.',
  NEW_CANDLE_PENDING:'נראה נר חדש מימין; ממתין לאימות בתמונה נוספת.',
  CANDLE_IDENTITY_CHANGED:'צורת הנר השתנתה; מתחיל בסיס מדידה חדש.',
  NEW_CANDLE:'נראה נר חדש מימין; מתחיל תיעוד חדש.',
  PIXEL_BUDGET:'אזור הקריאה גדול מדי; צמצמו את אזור הגרף.',
};

export function createCandleDisplay({document,intervalMs=100}={}){
  const get=id=>document.getElementById(id);
  let lastPaint=-Infinity;
  function clear(text='ממתין למעקב אחר הנרות.'){
    lastPaint=-Infinity;
    get('candle-state').textContent=text;get('candle-state').dataset.state='UNAVAILABLE';
    for(const id of ['candle-delta','candle-speed','candle-range','candle-reversals'])get(id).textContent='—';
    get('candle-detail').textContent='קריאת גוף ופתילים של נרות מלאים באדום וטורקיז. המדידה מתחילה מרגע הזיהוי.';
    get('candle-diagnostics').textContent='ממתין לתמונות נרות.';
    const canvas=get('candle-trace');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  }
  function render(result,{capturedAt,processingMs,diagnostics}={}){
    if(capturedAt-lastPaint<intervalMs)return;lastPaint=capturedAt;
    const tracking=result.status==='TRACKING',active=result.active,m=result.metrics;
    const state=get('candle-state');state.dataset.state=result.status;
    const side=active?.direction==='UP'?'עולה':active?.direction==='DOWN'?'יורד':'לא ברור';
    state.textContent=tracking?`נר ${side} · ${result.candles.length} נרות באזור הקריאה`:reasons[result.reason]??'ממתין להתאמה ברורה בין הנרות בתמונות.';
    const number=value=>Number.isFinite(value)?value.toFixed(1):'—';
    get('candle-delta').textContent=tracking?number(m.netPx):'—';
    get('candle-speed').textContent=tracking?number(m.velocityPxPerSecond):'—';
    get('candle-range').textContent=tracking?number(m.rangePx):'—';
    get('candle-reversals').textContent=tracking?String(m.reversals):'—';
    get('candle-detail').textContent=tracking?`גוף: ${number(Math.abs(active.bodyBottom-active.bodyTop))} px · פתיל עליון: ${number(active.bodyTop-active.highY)} px · פתיל תחתון: ${number(active.lowY-active.bodyBottom)} px. תועדו ${m.updates} עדכונים מאז תחילת המעקב אחר הנר.`:'הערכים מתאפסים כשהזהות או התמונה אינן ברורות. הזזה ושינוי קנה מידה דורשים התאמה מחדש.';
    get('candle-diagnostics').textContent=`קריאת נרות: ${number(processingMs)} ms | סריקה: ${diagnostics?.pixels??0} פיקסלים | סיבה: ${result.reason} | נרות קודמים שתועדו: ${result.history?.length??0} | אזורים היסטוריים חופפים שהושמטו: ${result.ignoredHistoricalGroups??0}. המדידה בפיקסלים; אין כאן מחירי OHLC או שחזור של תנועות בין תמונות.`;
    const canvas=get('candle-trace'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,samples=tracking?result.samples:[];
    ctx.clearRect(0,0,w,h);ctx.strokeStyle='#2b3544';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
    if(samples.length<2)return;
    const first=samples[0].atMs,last=samples.at(-1).atMs,span=Math.max(1,last-first),scale=Math.max(2,...samples.map(s=>Math.abs(s.valuePx)));
    ctx.strokeStyle='#7dd3c7';ctx.lineWidth=2;ctx.beginPath();
    samples.forEach((sample,i)=>{const x=4+(w-8)*(sample.atMs-first)/span,y=h/2-sample.valuePx/scale*(h/2-5);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
  }
  return {clear,render};
}
