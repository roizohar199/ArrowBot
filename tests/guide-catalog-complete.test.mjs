import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GUIDE_TOPICS,GUIDE_SECTIONS,GUIDE_SOURCE_INFO,GUIDE_DIAGRAMS,GUIDE_APPENDICES,GUIDE_PRELUDE,GUIDE_SOURCE_EXERCISES,GUIDE_COVERAGE,getGuideTopic,searchGuideTopics} from '../guide-catalog.mjs';
import {analyzeCandlePatterns,candleAnatomy} from '../candle-patterns.mjs';

const root=new URL('../',import.meta.url);
const raw=await readFile(new URL('Candlestick_Codex_Guide_HE.txt',root));
const lines=raw.toString('utf8').replace(/\r\n?/g,'\n').split('\n');
const expectedHeadings=[
  '1.1 מבוא','1.2 סקירת מסלול הלימוד','1.3 רקע היסטורי של נרות יפניים','1.4 מהו נר יפני',
  '2.1 יסודות תבניות נרות','2.2 נר בולע — Engulfing',"2.3 דוג'י — Doji","2.4 דוג'י שפירית — Dragonfly Doji","2.5 דוג'י מצבה — Gravestone Doji",'2.6 כוכב בוקר — Morning Star','2.7 כוכב ערב — Evening Star','2.8 פטיש — Hammer','2.9 כוכב נופל — Shooting Star','2.10 תבנית Harami','2.11 פינצטה עליונה ותחתונה — Tweezer Top / Bottom',
  '3.1 תרגול תבניות נרות','3.2 מבנה השוק','3.3 מסחר בשוק מגמתי','3.4 תמיכה והתנגדות','3.5 ציור קווי מגמה','3.6 שוק מדשדש','3.7 טיימפריימים וניתוח מלמעלה למטה',
  '4.1 אסטרטגיות וטקטיקות מסחר','4.2 אסטרטגיות Pin Bar — יסודות','4.3 Pin Bar עם המגמה','4.4 טקטיקות כניסה וניהול','4.5 Pin Bar עם מפגש גורמים — Confluence','4.6 דוגמאות עסקאות Pin Bar','4.7 Pin Bar בשוק מדשדש',
  '5.1 תבנית נר בולע כמערך מסחר','5.2 כיצד לבנות עסקה על נר בולע','5.3 נר בולע עם ממוצעים נעים',"5.4 נר בולע עם תיקוני פיבונאצ'י",'5.5 נר בולע עם קו מגמה','5.6 נר בולע בשוק צדדי','5.7 נר בולע באזורי היצע וביקוש','5.8 כללי ניהול כסף למסחר בנר בולע',
  '6.1 תבנית Inside Bar','6.2 הפירוש של התכנסות הטווח','6.3 Inside Bar עם תמיכה והתנגדות','6.4 כללי עבודה עם Inside Bar','6.5 פריצת שווא של Inside Bar','6.6 דוגמאות פריצת שווא',"6.7 פריצת שווא עם תיקון פיבונאצ'י",'6.8 דוגמאות עסקאות Inside Bar','6.9 אסטרטגיות ניהול כסף','6.10 מסקנות ותהליך עבודה מסודר',
];

test('all 47 original topic headings survive, in all six original categories',()=>{
  const sourceHeadings=lines.filter((line,index)=>/^[1-6]\.\d+ /.test(line)&&/^-+$/.test(lines[index+1]??''));
  assert.deepEqual(sourceHeadings,expectedHeadings,'source heading inventory changed and needs an explicit reviewed update');
  assert.deepEqual(GUIDE_TOPICS.map(topic=>topic.heading),expectedHeadings);
  assert.equal(new Set(GUIDE_TOPICS.map(topic=>topic.id)).size,47);
  assert.deepEqual(GUIDE_SECTIONS.map(section=>GUIDE_TOPICS.filter(topic=>topic.category===section.id).length),[4,11,7,7,8,10]);
  assert.equal(getGuideTopic('2.2').id,'2.2');
  assert.equal(getGuideTopic('2.12'),null);
});

test('full source bodies and exact 1-based line citations are retained without summary replacement',()=>{
  assert.equal(GUIDE_SOURCE_INFO.sha256,createHash('sha256').update(raw).digest('hex'));
  for(const topic of GUIDE_TOPICS){
    const [start,end]=topic.sourceLines;
    assert.equal(lines[start-1],topic.heading,topic.id+' heading citation');
    assert.match(lines[start],/^-+$/);
    const body=lines.slice(start+1,end).join('\n').trim();
    assert.equal(topic.body,body,topic.id+' complete body');
    assert.equal(topic.original_explanation_he,body);
    assert.ok(body.length>250,topic.id+' has original explanation, not only title');
    assert.equal(lines[end]?.trim()??'','',topic.id+' ends at original nonblank boundary');
    assert.ok(!/^מדור [1-6] — /m.test(topic.body));
    assert.ok(!/^נספח [אבגד] — /m.test(topic.body));
    assert.deepEqual(topic.source.lines,topic.sourceLines);
    assert.equal(topic.source.file,GUIDE_SOURCE_INFO.file);
    assert.equal(topic.source.sha256,GUIDE_SOURCE_INFO.sha256);
    assert.equal(topic.source_kind,'original_research_definition');
    assert.ok(Number.isInteger(topic.original_toc_page));
    assert.ok(topic.original_toc_page>=GUIDE_SECTIONS[topic.category-1].originalPages[0]);
    assert.ok(topic.original_toc_page<=GUIDE_SECTIONS[topic.category-1].originalPages[1]);
  }
});

test('prelude, all four appendices, all 14 original exercises and answers remain accessible',()=>{
  assert.ok(GUIDE_PRELUDE.includes('מעמד המסמך'));
  assert.ok(GUIDE_PRELUDE.includes('RANGE = H − L.'));
  assert.deepEqual(GUIDE_APPENDICES.map(appendix=>appendix.id),['א','ב','ג','ד']);
  for(const appendix of GUIDE_APPENDICES){
    const [start,end]=appendix.sourceLines;
    assert.equal(lines[start-1],appendix.title);
    assert.equal(appendix.body,lines.slice(start+1,end).join('\n').trim());
  }
  assert.equal(GUIDE_SOURCE_EXERCISES.length,14);
  for(const exercise of GUIDE_SOURCE_EXERCISES){
    const [start,end]=exercise.sourceLines;
    assert.equal(lines[start-1],exercise.title);
    const original=lines.slice(start,end).join('\n');
    assert.equal(original,exercise.question+'\nפתרון: '+exercise.answer);
    assert.ok(exercise.answer.length>25);
  }
  assert.equal(getGuideTopic('1.4').sourceExercises[0].id,1);
  assert.equal(getGuideTopic('2.2').sourceExercises[0].id,2);
  assert.equal(getGuideTopic('2.10').sourceExercises[0].id,3);
  assert.ok(getGuideTopic('6.9').sourceExercises.some(exercise=>exercise.id===14));
});

test('every topic has an explicit honest coverage kind, explanation, example, counterexample and exercise',()=>{
  assert.deepEqual(Object.keys(GUIDE_COVERAGE).sort(),['analytic','conditional','educational','manual']);
  for(const topic of GUIDE_TOPICS){
    assert.ok(GUIDE_COVERAGE[topic.coverage.status],topic.id);
    assert.ok(topic.coverage.note.length>40);
    assert.ok(topic.explanation.length>70,topic.id);
    assert.equal(topic.example.kind,'synthetic_learning_aid');
    assert.equal(topic.counterexample.kind,'synthetic_learning_aid');
    assert.ok(topic.example.text.length>25,topic.id+' example');
    assert.ok(topic.counterexample.text.length>25,topic.id+' counterexample');
    assert.equal(topic.exercise.kind,'original_supplement');
    assert.ok(topic.exercise.question.length>15,topic.id+' question');
    assert.ok(topic.exercise.answer.length>20,topic.id+' answer');
    assert.ok(topic.diagramData.length>0,topic.id+' diagram');
    assert.ok(Object.isFrozen(topic)&&Object.isFrozen(topic.diagrams));
  }
  assert.equal(getGuideTopic('1.3').coverage.status,'educational','history is not invented as an automatic strategy');
  assert.equal(getGuideTopic('4.4').coverage.status,'manual','entry variants require a separate execution model');
  assert.match(GUIDE_SOURCE_INFO.notice,/אינו 47|אינן 47|47 אסטרטגיות/);
  assert.match(GUIDE_SOURCE_INFO.notice,/לא אומתו כל 168/);
});

test('all 38 source-derived chart datasets have valid OHLC; positive and negative shapes match source definitions',()=>{
  assert.equal(Object.keys(GUIDE_DIAGRAMS).length,38);
  let assertions=0;
  for(const [id,diagram] of Object.entries(GUIDE_DIAGRAMS)){
    assert.equal(diagram.kind,'synthetic_illustration');
    assert.ok(diagram.candles.length>=3,id+' includes temporal context');
    for(const candle of [...(diagram.warmup??[]),...diagram.candles])assert.ok(candleAnatomy(candle),id+' valid prices');
    const bars=[...(diagram.warmup??[]),...diagram.candles].map((bar,index)=>({...bar,closed:true,time:index*60000,closeTime:(index+1)*60000}));
    const result=analyzeCandlePatterns(bars,{tickSize:.25,minRangeTicks:1,...diagram.testConfig});
    assert.notEqual(result.status,'INVALID_INPUT',id);
    const lastPatterns=result.patterns.filter(pattern=>pattern.endIndex===bars.length-1).map(pattern=>pattern.id);
    if(diagram.expectedPattern){assert.ok(lastPatterns.includes(diagram.expectedPattern),id+' is '+diagram.expectedPattern);assertions++;}
    if(diagram.absentPattern){assert.ok(!lastPatterns.includes(diagram.absentPattern),id+' is not '+diagram.absentPattern);assertions++;}
  }
  assert.ok(assertions>=24,'key pattern examples include executable positive/counterexample assertions');
  for(const id of ['2.2','2.3','2.4','2.5','2.6','2.7','2.8','2.9','2.10','2.11','4.2','6.1','6.5','6.6'])assert.equal(getGuideTopic(id).diagramData.length,3,id+' has three contrasting chart examples');
});

test('variants retain source distinctions instead of silently merging different models',()=>{
  const names=id=>getGuideTopic(id).variants.map(variant=>variant.name);
  assert.deepEqual(names('2.6'),['continuous_market','strict_gap']);
  assert.deepEqual(names('2.10'),['opposite_color','harami_cross']);
  assert.deepEqual(names('4.4'),['close','breakout_stop','pullback_limit']);
  assert.deepEqual(names('6.1'),['strict','inclusive','original_mother','previous_bar']);
  assert.deepEqual(names('6.5'),['wick_rejection','close_then_reclaim']);
  assert.match(getGuideTopic('5.8').formulas.join('\n'),/commission_round_trip/);
  assert.match(getGuideTopic('5.8').formulas.join('\n'),/slippage_ticks_round_trip/);
  assert.match(getGuideTopic('6.9').explanation,/ממומש/);
});

test('source inconsistency is preserved with a warning, and never silently used as valid candle data',()=>{
  const topic=getGuideTopic('6.6');
  assert.ok(topic.body.includes('יורד ל־99 וסוגר ב־98.5'));
  assert.ok(topic.sourceQualityNote.includes('L=99'));
  assert.ok(topic.sourceQualityNote.includes('C=98.5'));
  const counter=GUIDE_DIAGRAMS.falseBreakCounter.candles.at(-1);
  assert.equal(counter.low,98);
  assert.equal(counter.close,98.5);
  assert.ok(GUIDE_DIAGRAMS.falseBreakCounter.caption.includes('L=98'));
});

test('search covers full source, Hebrew/English names, variants and all six topic filters',()=>{
  assert.equal(searchGuideTopics().length,47);
  assert.deepEqual(searchGuideTopics('',{category:5}).map(topic=>topic.id),['5.1','5.2','5.3','5.4','5.5','5.6','5.7','5.8']);
  assert.ok(searchGuideTopics('STRICT_GAP').some(topic=>topic.id==='2.6'));
  assert.ok(searchGuideTopics('הראמי').some(topic=>topic.id==='2.10'),'Hebrew name finds the source topic titled Harami');
  assert.ok(searchGuideTopics('close_then_reclaim').some(topic=>topic.id==='6.5'));
  assert.ok(searchGuideTopics('ידועים רק').length>0,'searches original body, not only titles');
  assert.ok(searchGuideTopics('דּוֹג׳י').some(topic=>topic.id==='2.3'),'Hebrew diacritics normalized');
  assert.equal(searchGuideTopics('no-such-topic-neverexists').length,0);
  assert.ok(searchGuideTopics('',{status:'educational'}).every(topic=>topic.coverage.status==='educational'));
  assert.equal(searchGuideTopics('strict_gap',{category:1}).length,0);
});

test('library shell is RTL, keyboard accessible, local-only and loads exact full source with a download',async()=>{
  const html=await readFile(new URL('guide-library.html',root),'utf8');
  const script=await readFile(new URL('guide-library.mjs',root),'utf8');
  assert.match(html,/<html lang="he" dir="rtl">/);
  for(const id of ['filters','topic-search','section-filter','coverage-filter','clear-search','topic-count','topic-list','lesson'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/href="#lesson"/);
  assert.match(html,/Candlestick_Codex_Guide_HE\.txt" download/);
  assert.match(html,/connect-src 'none'/);
  assert.match(script,/element\('div',topic\.body,'source-text'\)/);
  assert.match(script,/document\.createElementNS/,'native SVG diagrams');
  assert.ok(script.includes("event.key==='/'"));
  assert.ok(script.includes("event.key==='Escape'"));
  assert.ok(script.includes("'aria-current','page'"));
  for(const text of [html,script]){
    assert.doesNotMatch(text,/(?:fetch|eval|WebSocket|XMLHttpRequest)\s*\(/);
    assert.doesNotMatch(text,/new Function\s*\(/);
    assert.doesNotMatch(text,/innerHTML\s*=/);
    assert.doesNotMatch(text,/<(?:script|link)[^>]+(?:src|href)=["']https?:/);
  }
});

test('the generated catalog is deterministic and up to date',()=>{
  const output=execFileSync(process.execPath,['scripts/generate-guide-catalog.mjs','--check'],{cwd:fileURLToPath(root),encoding:'utf8'});
  assert.match(output,/47 topics, 6 sections, 4 appendices, 14 exercises/);
});
