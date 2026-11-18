// Pure parser for the user's local reference document. Content is data, not instructions.
export function parseGuideSource(text){
  if(typeof text!=='string')throw new TypeError('Guide source must be text');
  const lines=text.replace(/\r\n?/g,'\n').split('\n');
  const numbered=[];
  for(let index=0;index<lines.length-1;index++){
    const match=lines[index].match(/^([1-6]\.\d+)\s+(.+)$/);
    if(match&&/^-+$/.test(lines[index+1]))numbered.push({index,id:match[1],title:match[2],heading:lines[index]});
  }
  const sectionHeaders=lines.flatMap((line,index)=>/^מדור [1-6] — /.test(line)?[index]:[]);
  const appendixHeaders=lines.flatMap((line,index)=>/^נספח [אבגד] — /.test(line)?[index]:[]);
  const endBefore=(start,next)=>{
    let end=Math.min(...[next,...sectionHeaders,...appendixHeaders,lines.length].filter(i=>i>start))-1;
    while(end>start&&!lines[end].trim())end--;
    return end;
  };
  const topics=numbered.map((item,index)=>{
    const end=endBefore(item.index,numbered[index+1]?.index??lines.length);
    const body=lines.slice(item.index+2,end+1).join('\n').trim();
    return {id:item.id,title:item.title,heading:item.heading,category:Number(item.id.split('.')[0]),body,
      sourceLines:[item.index+1,end+1],original_toc_page:Number(body.match(/מיקום (?:בתוכן העניינים המקורי|מקורי): עמ' (\d+)/)?.[1])||null,
      sourceExamples:body.split(/\n\s*\n/).filter(paragraph=>/דוגמ/.test(paragraph))};
  });
  const appendices=appendixHeaders.map((start,index)=>{
    let end=(appendixHeaders[index+1]??lines.length)-1;
    while(end>start&&!lines[end].trim())end--;
    return {id:lines[start].match(/^נספח ([אבגד])/)[1],title:lines[start],body:lines.slice(start+2,end+1).join('\n').trim(),sourceLines:[start+1,end+1]};
  });
  const exerciseStarts=lines.flatMap((line,index)=>/^תרגיל \d+ — /.test(line)?[index]:[]);
  const exercises=exerciseStarts.map((start,index)=>{
    const end=endBefore(start,exerciseStarts[index+1]??lines.length);
    const answerIndex=lines.findIndex((line,i)=>i>start&&i<=end&&/^פתרון:/.test(line));
    if(answerIndex<0)throw new Error('Missing source exercise answer: '+lines[start]);
    return {id:Number(lines[start].match(/^תרגיל (\d+)/)[1]),title:lines[start],
      question:lines.slice(start+1,answerIndex).join('\n').trim(),
      answer:lines.slice(answerIndex,end+1).join('\n').replace(/^פתרון:\s*/,''),sourceLines:[start+1,end+1],kind:'source_exercise'};
  });
  const firstSection=sectionHeaders[0]??numbered[0]?.index??0;
  return {topics,appendices,exercises,prelude:lines.slice(0,firstSection).join('\n').trim(),lineCount:lines.length};
}
