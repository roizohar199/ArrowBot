import {GUIDE_TOPICS,GUIDE_SECTIONS,GUIDE_SOURCE_INFO,GUIDE_COVERAGE,GUIDE_PRELUDE,GUIDE_APPENDICES,getGuideTopic,searchGuideTopics} from './guide-catalog.mjs';

const $=id=>document.getElementById(id);
const main=$('lesson'),search=$('topic-search'),sectionFilter=$('section-filter'),coverageFilter=$('coverage-filter');
let currentId=null,visibleTopics=GUIDE_TOPICS;
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
const append=(parent,...children)=>{parent.append(...children.filter(Boolean));return parent;};
const link=(text,href)=>{const node=element('a',text);node.href=href;return node;};
const block=(heading,...children)=>append(element('section',null,'lesson-block'),element('h3',heading),...children);
const sourceCitation=lines=>element('p',`${GUIDE_SOURCE_INFO.file} · שורות ${lines[0]}–${lines[1]} · מקור: הגדרת מחקר מקורית בעברית`,'source-citation');
const format=value=>Number(value).toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:5});

for(const section of GUIDE_SECTIONS){const option=element('option',`${section.id}. ${section.title}`);option.value=String(section.id);sectionFilter.append(option);}
for(const [id,coverage] of Object.entries(GUIDE_COVERAGE)){const option=element('option',coverage.label);option.value=id;coverageFilter.append(option);}

function renderList(){
  const fragment=document.createDocumentFragment();
  for(const section of GUIDE_SECTIONS){
    const topics=visibleTopics.filter(topic=>topic.category===section.id);
    if(!topics.length)continue;
    fragment.append(element('h3',`${section.id}. ${section.title}`));
    const list=element('ul');
    for(const topic of topics){
      const anchor=link('',`#topic=${topic.id}`);
      anchor.dataset.topicId=topic.id;
      anchor.append(element('span',topic.id,'topic-number'),element('span',topic.title));
      if(currentId===topic.id)anchor.setAttribute('aria-current','page');
      list.append(append(element('li'),anchor));
    }
    fragment.append(list);
  }
  if(!visibleTopics.length)fragment.append(element('p','אין נושאים תואמים. אפשר לנקות את החיפוש או לשנות מדור.','empty-result'));
  $('topic-list').replaceChildren(fragment);
  $('topic-count').textContent=`מוצגים ${visibleTopics.length} מתוך ${GUIDE_TOPICS.length} נושאים`;
}

function updateFilters(){
  visibleTopics=searchGuideTopics(search.value,{category:sectionFilter.value,status:coverageFilter.value});
  renderList();
}
$('filters').addEventListener('submit',event=>event.preventDefault());
search.addEventListener('input',updateFilters);
sectionFilter.addEventListener('change',updateFilters);
coverageFilter.addEventListener('change',updateFilters);
$('clear-search').addEventListener('click',()=>{search.value='';sectionFilter.value='';coverageFilter.value='';updateFilters();search.focus();});

const svgNS='http://www.w3.org/2000/svg';
function svgNode(tag,attributes={},text){
  const node=document.createElementNS(svgNS,tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  if(text!==undefined)node.textContent=text;
  return node;
}

export function createCandleDiagram(data,uniqueId){
  const candles=data.candles,width=640,height=310,left=58,right=80,top=26,bottom=44;
  const extraPrices=[...(data.levels??[]).map(level=>level.price),...(data.zones??[]).flatMap(zone=>[zone.low,zone.high]),...(data.line?[data.line.from[1],data.line.to[1]]:[])];
  const high=Math.max(...candles.map(candle=>candle.high),...extraPrices),low=Math.min(...candles.map(candle=>candle.low),...extraPrices);
  const padding=Math.max((high-low)*.12,.25),max=high+padding,min=low-padding;
  const y=price=>top+(max-price)/(max-min)*(height-top-bottom);
  const plotWidth=width-left-right,step=plotWidth/candles.length,x=index=>left+step*(index+.5);
  const titleId=`chart-title-${uniqueId}`,descriptionId=`chart-description-${uniqueId}`;
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-labelledby':`${titleId} ${descriptionId}`,direction:'ltr'});
  svg.append(svgNode('title',{id:titleId},data.title),svgNode('desc',{id:descriptionId},`${data.caption} סדר הנרות משמאל לימין. ערכי OHLC בטבלה שאחרי האיור.`));
  for(let i=0;i<=4;i++){
    const value=min+(max-min)*i/4,py=y(value);
    svg.append(svgNode('line',{x1:left,y1:py,x2:width-right,y2:py,stroke:'#31435a','stroke-width':1}),svgNode('text',{x:left-7,y:py+4,'text-anchor':'end',fill:'#b1c0d5','font-size':11},format(value)));
  }
  for(const zone of data.zones??[]){
    svg.append(svgNode('rect',{x:left,y:y(zone.high),width:plotWidth,height:Math.max(2,y(zone.low)-y(zone.high)),fill:'#84dddc','fill-opacity':.14,stroke:'#84dddc','stroke-dasharray':'5 4'}));
    svg.append(svgNode('text',{x:width-right+5,y:y((zone.low+zone.high)/2),'font-size':11,fill:'#84dddc'},zone.label));
  }
  for(const level of data.levels??[]){
    svg.append(svgNode('line',{x1:left,y1:y(level.price),x2:width-right,y2:y(level.price),stroke:'#e9cc8d','stroke-width':1,'stroke-dasharray':'5 4'}),svgNode('text',{x:width-right+5,y:y(level.price)+4,fill:'#e9cc8d','font-size':10},level.label));
  }
  if(data.line){const {from,to}=data.line;svg.append(svgNode('line',{x1:x(from[0]),y1:y(from[1]),x2:x(to[0]),y2:y(to[1]),stroke:'#84dddc','stroke-width':2}));}
  candles.forEach((candle,index)=>{
    const cx=x(index),colour=candle.close>candle.open?'#7ce2bd':candle.close<candle.open?'#ffa9b5':'#f2d697';
    const bodyWidth=Math.min(step*.45,38),bodyTop=y(Math.max(candle.open,candle.close)),bodyHeight=Math.max(2,Math.abs(y(candle.open)-y(candle.close)));
    svg.append(svgNode('line',{x1:cx,y1:y(candle.high),x2:cx,y2:y(candle.low),stroke:colour,'stroke-width':2}),svgNode('rect',{x:cx-bodyWidth/2,y:bodyTop,width:bodyWidth,height:bodyHeight,fill:colour,stroke:colour}),svgNode('text',{x:cx,y:height-bottom+22,'text-anchor':'middle',fill:'#b1c0d5','font-size':data.labels?9:12},data.labels?.[index]??String(index+1)));
  });
  svg.append(svgNode('text',{x:left,y:height-5,fill:'#b1c0d5','font-size':10},'Synthetic OHLC · time → · shape ≠ prediction'));
  return svg;
}

function diagramCard(data,index){
  const figure=element('figure',null,'diagram-card');
  append(figure,element('h4',data.title),element('p','איור קוד מקורי בעקבות הגדרות המקור · נתונים סינתטיים','diagram-label'),createCandleDiagram(data,`${currentId}-${index}`),element('figcaption',data.caption));
  const details=element('details');details.append(element('summary','הצגת מחירי הנרות באיור'));
  const table=element('table',null,'data-table');
  table.append(element('caption','נתוני המחשה בלבד. הנרות מסודרים משמאל לימין לפי זמן.'));
  const head=element('thead'),header=element('tr');
  for(const name of ['#','O','H','L','C']){const th=element('th',name);th.scope='col';header.append(th);}
  head.append(header);table.append(head);
  const body=element('tbody');
  data.candles.forEach((candle,i)=>{const row=element('tr');for(const value of [i+1,candle.open,candle.high,candle.low,candle.close])row.append(element('td',format(value)));body.append(row);});
  table.append(body);details.append(append(element('div',null,'table-wrap'),table));figure.append(details);
  return figure;
}

function exerciseCard(exercise,isSource=false){
  const card=element('article',null,'exercise');
  append(card,element('h4',exercise.title??exercise.label),isSource?element('p',`תרגיל מהמקור · שורות ${exercise.sourceLines[0]}–${exercise.sourceLines[1]}`,'source-exercise-label'):element('p',exercise.label,'example-label'),element('p',exercise.question));
  if(isSource&&exercise.id===9)card.append(element('p','הערת איכות מקור: "אותם נתונים" מתייחס ל־L=99 בתרגיל 8, אך כאן C=98.5 נמוך ממנו. זה אינו OHLC תקין. המסקנה על היעדר חזרה היא לימודית בלבד; לדוגמה תקינה אפשר להשתמש ב־L=98 כפי שמסומן באיור.','source-quality'));
  const answer=element('details');answer.append(element('summary','פתרון והסבר'),element('p',exercise.answer,'answer'));card.append(answer);return card;
}

function fullSource(topic){
  const details=element('details',null,'source-details');details.open=true;
  details.append(element('summary','טקסט הסעיף המקורי במלואו'),sourceCitation(topic.sourceLines),element('h4',topic.heading,'source-heading'),element('div',topic.body,'source-text'));
  return details;
}

function renderTopic(topic){
  currentId=topic.id;
  const section=GUIDE_SECTIONS.find(section=>section.id===topic.category),coverage=GUIDE_COVERAGE[topic.coverage.status];
  const fragment=document.createDocumentFragment();
  const heading=element('h2',topic.heading);heading.id='lesson-title';
  append(fragment,element('p',`מדור ${section.id} · ${section.title}`,'breadcrumb'),heading,
    append(element('div',null,'lesson-meta'),element('span',coverage.label,`badge badge-${topic.coverage.status}`),element('span',`תוכן העניינים המקורי: עמ׳ ${topic.original_toc_page}`,'badge')),
    element('p',topic.coverage.note,'coverage-note'),element('p',topic.explanation,'explanation'));
  if(topic.sourceQualityNote)fragment.append(element('p',topic.sourceQualityNote,'source-quality'));
  if(topic.formulas.length){const list=element('ul',null,'formula-list');for(const formula of topic.formulas)list.append(append(element('li'),element('code',formula)));fragment.append(block('הגדרה ונוסחאות',list,element('p','ספי יחס, חימום ותוקף הם בחירות מחקר שניתנות לגרסה, ולא נתוני הצלחה.','muted')));}
  fragment.append(block('דוגמה ומקרה נגדי',append(element('div',null,'example-grid'),
    append(element('article',null,'example-card valid'),element('h4','דוגמה תקינה לפי התנאים'),element('span',topic.example.label,'example-label'),element('p',topic.example.text)),
    append(element('article',null,'example-card counter'),element('h4','דוגמה נגדית / מגבלה'),element('span',topic.counterexample.label,'example-label'),element('p',topic.counterexample.text)))));
  if(topic.variants.length){const variants=block('גרסאות ומודלים במקור');for(const variant of topic.variants)variants.append(append(element('article',null,'variant'),element('h4',variant.name,'variant-name'),element('p',variant.description)));variants.append(element('p','בחירת שם מודל אינה מפעילה אותו ואינה מאשרת פקודה או מילוי. נתוני החשבון ומדיניות הביצוע נבדקים בנפרד.','muted'));fragment.append(variants);}
  const gallery=element('div',null,`diagram-gallery${topic.diagramData.length>1?' multiple':''}`);
  topic.diagramData.forEach((diagram,index)=>gallery.append(diagramCard(diagram,index)));
  fragment.append(block('איורי נרות בעקבות ההגדרות',gallery));
  const exercises=block('תרגול והסבר');
  for(const exercise of topic.sourceExercises)exercises.append(exerciseCard(exercise,true));
  exercises.append(exerciseCard(topic.exercise));fragment.append(exercises);
  if(topic.implementation_notes.length){const notes=element('ul',null,'notes');for(const note of topic.implementation_notes)notes.append(element('li',note));fragment.append(block('הערות יישום',notes));}
  fragment.append(block('מקור מלא וקישור להורדה',fullSource(topic),link('הורדת קובץ המדריך המלא',GUIDE_SOURCE_INFO.file)));
  const index=GUIDE_TOPICS.findIndex(item=>item.id===topic.id),navigation=element('nav',null,'lesson-nav');navigation.setAttribute('aria-label','הנושא הקודם והבא');
  if(index>0)navigation.append(link(`→ ${GUIDE_TOPICS[index-1].heading}`,`#topic=${GUIDE_TOPICS[index-1].id}`));
  if(index<GUIDE_TOPICS.length-1)navigation.append(link(`${GUIDE_TOPICS[index+1].heading} ←`,`#topic=${GUIDE_TOPICS[index+1].id}`));
  fragment.append(navigation);main.replaceChildren(fragment);renderList();
}

function renderAbout(){
  currentId=null;
  const title=element('h2','מקור המדריך, אופי הכיסוי והגדרות משותפות');title.id='lesson-title';
  const fragment=document.createDocumentFragment();fragment.append(title,element('p',GUIDE_SOURCE_INFO.notice,'coverage-note'));
  const grid=element('div',null,'status-grid');
  for(const [id,status] of Object.entries(GUIDE_COVERAGE))grid.append(append(element('article',null,'status-card'),element('h3',status.label),element('p',status.description),element('p',`${GUIDE_TOPICS.filter(topic=>topic.coverage.status===id).length} נושאים`,'muted')));
  fragment.append(grid,element('p','הסיווג כאן ממפה את אופי הנושא. הוא אינו מדידת דיוק בזמן אמת, רשימת מסלולי ביצוע פעילים או אישור שכל נתון נדרש זמין כרגע.','muted'),block('פתיח המקור ומילון הסימונים במלואם',element('div',GUIDE_PRELUDE,'source-text')),block('זהות המקור',element('p',`קובץ מקומי: ${GUIDE_SOURCE_INFO.file} · ${GUIDE_SOURCE_INFO.lineCount} שורות`),element('code',GUIDE_SOURCE_INFO.sha256,'source-hash'),link('הורדת המסמך המלא',GUIDE_SOURCE_INFO.file)),link('חזרה לנושא הראשון','#topic=1.1'));
  main.replaceChildren(fragment);renderList();
}

function renderAppendices(){
  currentId=null;
  const title=element('h2','כל ארבעת נספחי המדריך במלואם');title.id='lesson-title';
  const fragment=document.createDocumentFragment();fragment.append(title,element('p','הגדרות מספריות, מפרט נתונים, תרגילים ופתרונות ומקורות. כל הטקסט נשמר מהקובץ המקומי, כולל בחירות מחקר והערות המקור.','explanation'));
  for(const appendix of GUIDE_APPENDICES){const details=element('details',null,'source-details');details.open=true;details.append(element('summary',appendix.title),sourceCitation(appendix.sourceLines),element('div',appendix.body,'source-text'));fragment.append(details);}
  fragment.append(element('p','הערת איכות מקור: דוגמת L=99 ו־C=98.5 בסעיף 6.6 ובתרגיל 9 אינה OHLC תקינה. הספרייה שומרת את הנוסח המקורי; באיור הנגדי בלבד הותאם L=98 באופן מסומן.','source-quality'),link('הורדת כל המדריך',GUIDE_SOURCE_INFO.file));
  main.replaceChildren(fragment);renderList();
}

function renderRoute(focus=false){
  const hash=location.hash.slice(1);
  if(hash==='about')renderAbout();
  else if(hash==='appendices')renderAppendices();
  else{const match=hash.match(/^topic=([1-6]\.\d+)$/);renderTopic(getGuideTopic(match?.[1])??GUIDE_TOPICS[0]);}
  if(focus){main.focus({preventScroll:true});main.scrollIntoView({block:'start'});}
}
window.addEventListener('hashchange',()=>renderRoute(true));
document.addEventListener('keydown',event=>{
  const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName)||event.target?.isContentEditable;
  if(event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();search.focus();}
  if(event.key==='Escape'&&event.target===search){search.value='';updateFilters();}
});
updateFilters();renderRoute();
