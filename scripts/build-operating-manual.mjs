import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {GUIDE_PATTERN_DESCRIPTIONS} from '../guide-explanations.mjs';

// Standalone artifact builder. It does not open the user's browser, touch the
// extension runtime, connect to Tradovate or place any order.
const inputPath=resolve('verification/0.13.0/operating-manual-input.json');
const inputText=await readFile(inputPath,'utf8'),facts=JSON.parse(inputText);
const out=resolve('output/manual');await mkdir(out,{recursive:true});
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const ltr=value=>`<bdi dir="ltr">${esc(value)}</bdi>`;
const money=value=>ltr('$'+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
const ref=(n,label='מקור')=>`<a class="ref" href="#source-${n}">${label} ${n}</a>`;
const box=(title,text,type='info')=>`<aside class="callout ${type}"><strong>${title}</strong><div>${text}</div></aside>`;
const table=(head,rows,cls='')=>`<table class="${cls}"><thead><tr>${head.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const list=items=>`<ul>${items.map(x=>`<li>${x}</li>`).join('')}</ul>`;
const steps=items=>`<ol class="steps">${items.map(([title,text])=>`<li><strong>${title}</strong><span>${text}</span></li>`).join('')}</ol>`;
const page=(n,kicker,title,lead,body)=>`<section class="page" data-page="${n}"><header class="running"><span>ARROW / מדריך הפעלה אישי</span><span>${esc(facts.version)} · ${esc(facts.asOf)}</span></header><main class="page-content" contenteditable="true" spellcheck="false"><p class="eyebrow">${kicker}</p><h1>${title}</h1>${lead?`<p class="lead">${lead}</p>`:''}${body}</main><footer><span>מחקר, הסבר והחלטה ידנית · ללא ביצוע אוטומטי</span><span>${ltr(n+' / 8')}</span></footer></section>`;

const pages=[];
pages.push(page(1,'מכאן מתחילים','לקרוא את השוק.<br>להחליט בעצמך.','מדריך הפעלה ל־Arrow עם גרף NQ, חשבון Apex דרך Tradovate ומגבלת סיכון מתוכננת של 200 דולר לחוזה אחד.',`
<div class="hero-stats"><div><b>1 דקה</b><span>גרף בסיס למחקר</span></div><div><b>${ltr('5 + 15')}</b><span>דקות, נרות גבוהים סגורים</span></div><div><b>${ltr('$200 / 1 NQ')}</b><span>סיכון מתוכנן / כמות מרבית</span></div></div>
${box('מה המערכת אמורה לעשות','לסווג מצב שוק, לבדוק תבניות ותרחישים במקביל, להסביר מה התקיים ומה חסר ולהציג איתות מחקר מאושר רק אחרי עמידה בתנאי החובה. גם היעדר איתות הוא תוצאה תקינה.')}
<h2>התחלה מהירה בחמישה צעדים</h2>
${steps([
['שומרים על סביבת העבודה','משאירים את פריסת שלושת הגרפים המקורית ללא שינוי. עובדים בחלון Chrome נפרד עם גרף מחקר יחיד ונראה.'],
['בודקים מקור וחשבון','NQ מדויק וחודש חוזה מתאים, נרות רגילים, דקה, Replay כבוי. ב־Tradovate בודקים את החשבון והחשיפה; ב־Arrow מאשרים מחדש את פרופיל ההפעלה.'],
['מכינים היסטוריה','פותחים עורך Pine מקושר בחלון נפרד, בוחרים את לשונית הלוגים ולוחצים "טעינת היסטוריה לפני המסחר". CONTEXT_READY הוא הקשר בלבד.'],
['מחכים לנתונים חיים','משאירים את חלון המקור גלוי וער. אחרי הפתיחה דרוש אימות טרי של מקור חי, אחריו מערך חדש ונר אישור מאוחר סגור.'],
['פועלים רק בהחלטה ידנית','בודקים את האיתות, המחיר העדכני, הסיכון וכללי החשבון. כל הזנה, שינוי או ביטול פקודה נעשים ידנית ב־Tradovate.']])}
${box('שער יציאה לדרך','אין מקור טרי, אין התאמה לחשבון, יש תנאי חובה חסר או אין מרווח סיכון מאומת? נשארים במעקב ללא כניסה. אין צורך לעקוף חסימה כדי לראות איתות.','warn')}
<p class="small">האישור הוא לפי כללי המחקר, ולא אישור של Apex לעסקה. המערכת אינה מחוברת ליתרה, לרצפת הסגירה או לפוזיציות החשבון. ${ref(1)} ${ref(8)}</p>
`));

pages.push(page(2,'מקור והכנה','מכינים הקשר.<br>מאמתים Live בנפרד.','טעינה מוקדמת חוסכת המתנה לבניית היסטוריה אחרי פתיחת השוק. היא אינה הופכת נתון ישן לאיתות חדש.',`
<h2>הסביבה הקבועה</h2>
${table(['מה בודקים','התצורה הרצויה'],[
['חלון המחקר','גרף NQ יחיד בדקה, נרות רגילים, ללא Replay. Data Window וקבוצת Arrow נשארים גלויים.'],
['שלושת הגרפים שלך','נשארים בפריסה המקורית. Arrow קורא את גרף המקור שנבחר ולא את כל הגרפים והשרטוטים שלך.'],
['5 ו־15 דקות','נתוני ספק סגורים נמשכים מהסקריפט; אין צורך להציג עוד שני גרפים. עם תצורה זו הבסיס חייב להיות קטן מ־5 דקות.'],
['נתוני בורסה','ב־TradingView וב־Tradovate בודקים הרשאת נתונים ואת מקור העיכוב. רעננות ב־Arrow אינה אימות עצמאי של המנוי.']])}
<h2>לפני הפתיחה</h2>
${steps([
['פותחים עורך מקושר בחלון נפרד','ב־Pine Editor של גרף המחקר: More ← Open editor in new window. בחלון העורך הנפרד: More ← Pine Logs. משאירים אותו מקושר לגרף וגלוי.'],
['בוחרים מקור גרף ומקור לוגים','ב־Arrow בוחרים את גרף המחקר ב"לשונית TradingView" ואת חלון העורך ב"לשונית לוגי ההכנה". הלוגים הם של סקריפט Arrow המקושר לאותו גרף.'],
['טוענים ובודקים CONTEXT_READY','לוחצים "טעינת היסטוריה לפני המסחר"; בודקים שלוש הודעות בסיס וסדרות בסיס/5/15. זהו הקשר בלבד. משאירים את חלון העורך והלוגים פתוח; סגירתו או שינוי המקור מחייבים הכנה מחדש.']])}
<p>אחרי ההכנה בוחרים במסלול <strong>חלון הנתונים</strong> ובלשונית המחקר, ולוחצים <strong>"הגדרת חשבון והתחלת מעקב"</strong>. בודקים ומאשרים את פרופיל החשבון והעלויות להפעלה הזו.</p>
<div class="flow"><span>היסטוריה</span><i>←</i><span>שתי מסגרות חיות טריות</span><i>←</i><span>מערך חדש</span><i>←</i><span>אישור בסגירה מאוחרת</span></div>
${box('מה כבר נבדק ומה עדיין לא','ב־NQ אומתה טעינה של 100 נרות בסיס, 100 נרות 5 דקות ו־100 נרות 15 דקות, כולל גבול סשן של הספק. זו בדיקת הקשר בשוק סגור. מסירה חיה ואיתות NQ חדש אחרי הפתיחה עדיין מחייבים בדיקה בפועל.','good')}
<p class="small">פתיחה/סגירה של Pine Logs בתוך גרף המחקר עלולה לאתחל את הסקריפט, כפי שנצפה בבדיקה. העורך המקושר הנפרד מאפשר לוגים לצד Data Window קבוע. הנתונים החיים ממשיכים מספרית ללא לוג מחירים מתמשך. ${ref(12)} ${ref(13)}</p>
`));

pages.push(page(3,'פירוש התוצאה','מצורה אפשרית<br>לאישור מתועד','המערכת מציגה בנפרד מצב שוק, התאמות של צורות, תרחישים ותנאי אישור. התאמת צורה אינה לבדה הוראת כניסה.',`
${table(['מצב מוצג','איך קוראים אותו'],[
['נר מתהווה / מועמד','O/H/L/C עדיין יכולים להשתנות. תצפית או תכנון בלבד; אין אישור סופי מהנר הפתוח.'],
['ממתין לאישור','נמצא מערך סגור עם הקשר מתאים. ממתינים לנר מאוחר שסוגר מעבר לרמה ולמרווח שהוגדר.'],
['איתות מחקר מאושר','תנאי החובה והסיכון עברו בזמן ההחלטה. בודקים גם נכס, כיוון, זמן, מחיר אישור, ביטול וכמות.'],
['חסר / נכשל / פג תוקף','חוסר מידע אינו תנאי שעבר. תנאי סותר, ביטול מבני או אישור שהגיע מאוחר מדי אינם כניסה.']])}
<h2>היקף הכללים בגרסה הזו</h2>
<p>ספריית המקור כוללת את כל 47 הסעיפים, ששת המדורים וארבעת הנספחים. במנוע קיימות <strong>${GUIDE_PATTERN_DESCRIPTIONS.length} בדיקות תווית</strong>: 18 צורות גאומטריות ושתי משמעויות הקשריות, Hanging Man לשורט ו־Inverted Hammer ללונג. תשע משפחות התרחישים כוללות גם המשך, היפוך, קצה טווח, Inside, בליעה שחוזרת לטווח ובדיקת אזור שהחליף תפקיד.</p>
<div class="two-col"><div><h3>תנאי ההקשר</h3>${list(['מבנה שוק ואזור מחיר ידוע.','EMA, פיבונאצ׳י וקו מגמה.','היצע/ביקוש והתאמת 5/15 דקות.'])}</div><div><h3>בתצורת NQ המחמירה</h3><p>כל שבע בדיקות ההקשר וסיכון תקין הם חובה. כל תנאי חסר או נכשל חוסם אישור. לא מכבים מסנן כדי לקבל עסקה. מספר התנאים שהתקיימו אינו אחוז הצלחה.</p></div></div>
${box('מה פירוש "נבדק במקביל"','נבחנות האפשרויות שבמנוע והסיבות שלהן; אין בחירה מאולצת כשהנתונים אינם מכריעים. וריאנטים פועלים לפי ההגדרה שנבחרה. בדיקת אזור שהחליף תפקיד היא כלל מחקר אופציונלי, כבוי כברירת מחדל.')}
<h2>מה אינו מסחר אוטומטי</h2>
<p>מודלי Market/Stop/Limit, יעד או סטופ בתכנון אינם פקודות ואינם מילוי. תנועה בתוך נר כוללת רק עדכונים שנצפו; אין שחזור ודאי של כל טיק או של מי פגע ראשון בסטופ וביעד. המערכת אינה קוראת באופן סמנטי כל אינדיקטור או ציור בגרפים.</p>
<p class="small">תוכן מלא אינו 47 אסטרטגיות עצמאיות, וכללי זיהוי אינם הוכחת רווחיות. טקסט המקור והספי המחקר נשמרים בספריית המדריך, לצד דוגמאות ופתרונות. פירוט גרסאות וגבולות האימות בעמוד 8.</p>
`));

pages.push(page(4,'סיכון והחלטה','200 דולר הם תקציב.<br>לא הבטחת הפסד מרבי.','בכל התחלה בודקים מחדש את החשבון, מפרט הנכס והעלויות. תכנון תקין עדיין דורש התאמה למחיר שניתן לבצע עכשיו.',`
<div class="hero-stats compact"><div><b>${ltr('$20')}</b><span>לנקודה בחוזה NQ</span></div><div><b>${ltr('0.25 / $5')}</b><span>גודל / ערך טיק</span></div><div><b>1</b><span>כמות מרבית בפרופיל</span></div></div>
<p>העמלה המפורסמת של Apex Tradovate ל־NQ היא ${money(1.55)} לצד, ${money(facts.risk.publishedCommissionRoundTrip)} לפתיחה וסגירה. בודקים אותה מול דוח Performance של החשבון; זו אינה עמלה אישית שאומתה בחיבור חי. החלקה של 2 טיקים לסיבוב היא הנחת תכנון מפורשת, לא מדידה. ${ref(7)} ${ref(10)}</p>
<div class="formula" dir="ltr">Planned risk = stop ticks × $5 × quantity + commission + slippage</div>
${table(['דוגמה לחוזה אחד','סיכון מחיר','עמלה + החלקה','סה״כ מתוכנן'],[
['37 טיקים',money(185),ltr('$3.10 + $10.00'),`<strong class="yes">${money(198.10)}</strong>`],
['38 טיקים',money(190),ltr('$3.10 + $10.00'),`<strong class="no">${money(203.10)}</strong>`]
])}
<p class="small">הדוגמאות מניחות עלות סיבוב ${money(3.10)} והחלקה כוללת של 2 טיקים. אינן ממליצות על סטופ של 37 טיקים. אם הסטופ המבני דורש יותר מהתקציב, העסקה נפסלת; לא מקרבים אותו כדי לקבל אישור.</p>
<h2>לפני הזנת פקודה ידנית</h2>
${list([
['וודאו שזה החשבון הרצוי וחוזה NQ המתאים לחודש המסחר. NQ ו־MNQ אינם אותו מפרט.'],
['השוו מחיר נוכחי למחיר האישור. אם הכניסה זזה, חשבו מחדש סיכון, יעד ומרווח; אל תרדפו אחרי מחיר ישן.'],
['בדקו פוזיציות ופקודות קיימות, רצפת סגירה עדכנית ומרווח הפסד פנוי ב־Tradovate. Arrow אינו יודע אותם.'],
['הזינו ידנית, ובדקו הגנות SL/TP מקוריות שהגדרתם ידנית בפלטפורמה. אין הנחת מילוי מהגרף.']
])}
${box('עצירת Arrow אינה סגירת חשבון','כפתור "עצירת מעקב" מפסיק את המעקב בלבד. הוא אינו סוגר פוזיציות ואינו מבטל פקודות ברוקר. פעולה כגון Exit All ב־Tradovate היא פעולה נפרדת ומשמעותית של המשתמש.','warn')}
<p class="small">לפי הסכם Apex, תוכנת ניתוח ואיתותים יכולה לסייע להחלטה ידנית כשהיא אינה פועלת בממשק הזנת הפקודות. אין לחבר את Arrow לביצוע, שינוי או ביטול אוטומטי. ${ref(1)}</p>
`));

pages.push(page(5,'Apex דרך Tradovate','מזהים את המסלול.<br>בודקים את המרווח האמיתי.','הנתונים כאן הגיעו מצילומי המסך שסיפקת. הם אינם חיבור חי לחשבון ואינם קביעה שהחשבון תקין עכשיו.',`
${table(['נתון שסופק','משמעות זהירה'],[
['יתרה התחלתית / נוכחית',`${money(50000)} / ${money(49545.10)}; רווח מצטבר ${money(-454.90)}.`],
['ימי מסחר / סף משיכה',`הוצגו 7 מתוך 8 ימים וסף ${money(52600)}. שילוב זה מתאים ל־Legacy PA 50K; יש לאמת את שם המסלול בחשבון.`],
['רווח ביום הגבוה / יום אחרון',`${money(386.40)} / ${money(-1458.40)}. אינם יתרת סיכון יומית לעסקה חדשה.`],
['TRMAXDD הציג 843 דולר','משמעות המספר לא הוכחה. אין לחשב ממנו רצפת סגירה מדויקת. אם הוא יתרת כרית, 200 דולר הם כ־23.7% ממנה. זו המחשה, לא המלצה.']])}
<div class="two-col"><div><h3>Legacy PA</h3><p>ל־50K מגבלה התחלתית של 5 מיני עד עמידה ברף EOD של 52,600 ומעבר לסשן הבא; מגבלתך נשארת חוזה אחד. קיימים גם יחס סיכון עד פי 5 מהיעד ואיסור גידור/כיוונים נגדיים. ${ref(4)}</p><p>כלל 30% מתייחס להפסד פתוח, לא לתקרת הפסד יומי. ב־50K חדש/ברווח נמוך מובאת דוגמת 750 דולר לפי 30% מ־2,500; תנאי החשבון והצמיחה משנים את החישוב. ${ref(5)}</p></div><div><h3>חשבון Evaluation נפרד</h3><p>ל־Legacy 50K FULL מפורסמים יעד 3,000 דולר ו־Trailing של 2,500. במסלול Tradovate Eval הרצפה ממשיכה לעקוב גם אחרי שיא בלתי ממומש; מינימום הימים הרגיל הוא 7, בכפוף למבצע המסוים. ${ref(2)} ${ref(3)}</p><p>עמוד המכירה מציע Legacy לזמן מוגבל. שם ותנאי המוצר בעגלת הרכישה קובעים; אין להחליפם בכללי EOD/Intraday החדשים. לא בוצעה רכישה.</p></div></div>
${box('בדיקת משיכה נפרדת',`ב־Legacy PA מפורסמים 8 ימי מסחר, מהם 5 ברווח של לפחות 50 דולר, עקביות יום מרבי של 30% וסף 52,600 ל־50K. מינימום משיכה 500 דולר; בחמש המשיכות הראשונות תקרה של 2,000 ל־50K. החרגות Safety Net ומצב המשיכות חשובים. תנאי חמשת הימים הוצג כמתקיים, אבל 7/8 ימים ורווח מצטבר שלילי אינם זכאות. ${ref(6)}`,'warn')}
<p class="small">שמרו פרופילי PA ו־Eval נפרדים. 200 דולר בכל אחד הם 400 דולר חשיפה מתוכננת יחד. כותרת 50K אינה כרית סיכון פנויה. אין לשתף פרטי כניסה או לשנות בקרות של החברה. בחשבון Apex תקין ייתכן שיופיע אזור Simulation ב־Tradovate. ${ref(8)} ${ref(9)}</p>
`));

pages.push(page(6,'נוהל יום מסחר','לפני. בזמן. אחרי.','חוזרים לאותו סדר פעולות בכל סשן. בדיקה חוזרת של חשבון ומקור חשובה יותר מכרטיס איתות שנראה טוב.',`
<div class="sop"><h2><span>01</span> לפני תחילת מעקב</h2>${list(['פתחו Tradovate ובדקו חשבון, פוזיציות, פקודות ממתינות, יתרה, רצפת סגירה ומרווח עדכניים.','בדקו את כללי המוצר המדויק, שעות חריגות ולוח חדשות; אל תשנו מגבלות חברה כדי לאפשר עסקה.','בחלון המחקר בלבד: NQ מדויק, דקה, נרות רגילים, Replay כבוי, סקריפט הגרסה הנכונה ומקור גלוי.','הכינו היסטוריה, אשרו את פרופיל ההפעלה והעלויות, ודאו שכל מסנני החובה שנבחרו נשארו מופעלים.'])}</div>
<div class="sop"><h2><span>02</span> בזמן המעקב</h2>${list(['המתינו למקור חי טרי ולמערך חדש. אין להיכנס בגלל תבנית היסטורית או מועמד מתהווה.','קראו את סיבות האישור והפסילה, זמן נר האישור, הכיוון, מחיר הביטול והסיכון.','לפני כל פעולה ידנית בדקו שוב חשבון ומחיר. נטרו חשיפה והגנות מתוך Tradovate, לא רק דרך Arrow.','אם המקור נעצר, הסמל השתנה או החלון הוסתר: מפסיקים להסתמך על התצוגה עד לאימות מחדש.'])}</div>
<div class="sop"><h2><span>03</span> בסיום</h2>${list(['סיימו פוזיציות ובטלו פקודות פעילות ב־Tradovate לפי המועד המחייב של החשבון; בדקו שהמצב באמת שטוח.','עצירת Arrow היא פעולה נפרדת. שמרו יצוא ותיעוד ההחלטות, העלויות והכניסות/יציאות שבוצעו בפועל.','תעדו חריגות ופערים. שינוי הגדרות למחקר הבא נשמר כגרסה חדשה, ולא תיקון בדיעבד של התוצאה.'])}</div>
${box('זמנים לשבוע 15-16 בנובמבר 2026',`פתיחת Globex הרגילה הקרובה: יום א׳ 15.11 ב־${ltr('23:00 UTC')}, יום ב׳ 16.11 ב־01:00 בישראל. פתיחת שוק המניות האמריקאי ב־16:30 בישראל היא שעה אחרת. מועד Apex של ${ltr('16:59 ET')} הוא 23:59 בישראל באותו שבוע; מסיימים לפניו ולא מסתמכים על סגירה אוטומטית. בדקו מחדש חגים ושעוני קיץ. ${ref(3)} ${ref(11)}`)}
<p class="small">שעות Globex הרגילות הן מיום א׳ 17:00 CT ועד יום ו׳ 16:00 CT, עם הפסקה יומית 16:00-17:00 CT. מסחר פתוח אינו חובה לבצע עסקה, והכנת הקשר אינה אישור להחזיק פוזיציה מעבר למועד החברה.</p>
`));

pages.push(page(7,'כשמשהו לא מסתדר','מאבחנים את החסימה.<br>לא עוקפים אותה.','רשמו מה הוצג, באיזה מקור ובאיזו שעה. אחרי תיקון מקור מתחילים מבסיס בטוח ומחכים שוב למערך חדש.',`
${table(['מה רואים','מה בודקים ומה עושים'],[
['CONTEXT_READY בלבד','ההיסטוריה מוכנה, אך אין הוכחת מקור חי. בשוק סגור זה צפוי. לא מפרשים את הבסיס כאיתות Live.'],
['מקור ישן / אין עדכון','בדקו שוק פתוח, גרף גלוי, סקריפט פועל וחלון עורך מקושר עם Pine Logs פתוחים. בדקו נתונים גם ישירות בפלטפורמה.'],
['שדות מעורבים / Coherence','מציגים את Data Window ואת קבוצת Arrow וממתינים למסגרת מספרית מלאה. אין להסיק כיוון משדות של עדכונים שונים.'],
['HTF חסר / חימום','בדקו סדרות 5/15 סגורות, זהות סשן ומקור. טענו הקשר מחדש אם צריך; לא מכבים HTF כדי לעבור חסימה.'],
['סמל / טיימפריים / Replay','התאימו את פרופיל Arrow לגרף המדויק; נרות רגילים ו־Replay כבוי. שינוי מקור מחייב בדיקה חדשה.'],
['פער שעון / הרצת מקור חדשה','בדקו שעון ומקור. אחרי סגירת חלון הלוגים, רענון או שינוי נכס: עצרו, פתחו עורך מקושר, בחרו את לשונית לוגי ההכנה וטענו בסיס חדש.'],
['הסיכון נפסל','בדקו גודל טיק, ערך נקודה, כמות, עמלה, החלקה וסטופ מבני. כמות אפס נשארת פסילה; אין להגדיל תקציב אוטומטית.'],
['אין איתות למרות הכול','ייתכן שאין חפיפה של כל התנאים. בודקים הסברים ונתונים, ושומרים גם תוצאה ללא עסקה.']])}
<h2>איך בודקים מהירות בצורה שימושית</h2>
<p>מבחינים בין קצב יצירת עדכוני השוק לבין זמן העברתם והצגתם. בדוח בודקים את מספר הדגימות, החציון, אחוזון 95 והמקסימום, ואת גבול המדידה המדויק. שומרים גם את החריגים התקינים.</p>
${box('מה נמדד במילישניות','המדידה מתחילה בתצפית הראשונה של ההרחבה על מסגרת DOM עקבית ונראית, ומסתיימת בהזדמנויות ציור בדפדפן. היא אינה זמן מהבורסה, צילום המסך או הופעת פיקסלים פיזית. יש להפריד מדידה ללוח ממדידה לכרטיס בגרף.')}
<h2>מה שומרים לבדיקה</h2>
<p>יצוא JSON מהלוח; צילום מצב עם השעה והסיבות; סימול/חודש חוזה וטיימפריים; גרסת המערכת והגדרות החובה; והאם היה LIVE אמיתי או TEST. לפני שיתוף מסתירים מזהי חשבון. רשומת החלטה ידנית נשמרת בנפרד מהאיתות.</p>
<p class="small">בדיקות קוד, היסטוריה או הצלחה קודמת ב־BTCUSD אינן מדידת NQ חיה חדשה. אין להחליף ראיה חסרה במספר או לאפיין דגימת TEST כאיתות מהשוק.</p>
`));

const sources=[
['Apex - הסכם משתמש',facts.officialSources[0].url,'כלי איתות, החלטה ידנית והפרדה מממשק פקודות.'],
['Apex - מוצרי Legacy',facts.officialSources[1].url,'זיהוי המסלול; הצעת מכירה משתנה ואינה המלצה לרכישה.'],
['Apex - כללי Legacy Evaluation',facts.officialSources[2].url,'Trailing, ימים וסיום פוזיציות.'],
['Apex - כללי Legacy PA',facts.officialSources[3].url,'דירוג חוזים, MAE, כיוונים ויחס סיכון.'],
['Apex - כלל הפסד פתוח 30%',facts.officialSources[4].url,'הפסד פתוח ולא מגבלת הפסד יומית.'],
['Apex - תנאי משיכת Legacy PA',facts.officialSources[5].url,'ימים, עקביות, Safety Net וספים.'],
['Apex - עמלות Tradovate',facts.officialSources[6].url,'פרסום עלויות NQ; יש לבדוק דוח חשבון אישי.'],
['Apex - הפעלת Tradovate',facts.officialSources[7].url,'Simulation, הפעלת נתונים וניטור מקורי.'],
['NinjaTrader - בקרות סיכון ב־Tradovate',facts.officialSources[8].url,'בקרות חשבון ומגבלות שבשליטת חברת המימון.'],
['CME - מפרט E-mini Nasdaq-100','https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html','מכפיל חוזה וגודל טיק.'],
['NinjaTrader - מפרט ושעות NQ','https://ninjatrader.com/futures/futures-contracts/equity-index/e-mini-nasdaq/','שעות רגילות; יש לבדוק חריגי מסחר.'],
['TradingView - מודל הרצת Pine','https://www.tradingview.com/pine-script-docs/language/execution-model/','הרצות חוזרות והפרדה בין היסטוריה לעדכונים חיים.'],
['TradingView - עורך Pine מקושר נפרד','https://www.tradingview.com/blog/en/updated-detach-mode-in-pine-editor-47304/','Pine Logs בעורך נפרד לצד Data Window בגרף.'],
];
pages.push(page(8,'מקורות וגבולות האימות','מסמך שאפשר לבדוק<br>ולעדכן','המקורות הרשמיים נבדקו ב־14.11.2026. התנאים החלים בחשבון ובחברה גוברים על תקציר תפעולי זה.',`
<div class="source-list">${sources.map(([title,url,why],i)=>`<div id="source-${i+1}" class="source-item"><b>${i+1}</b><div><a href="${esc(url)}">${title}</a><p>${why}</p></div></div>`).join('')}</div>
<h2>מה מאומת במדריך הזה</h2>
<p>תצורת המחקר, הכנת ההיסטוריה, פירוש המצבים ותכנון הסיכון מתוארים לפי גרסה ${esc(facts.version)}. נתוני החשבון הם פרטים שסופקו, ללא מזהי חשבון וללא חיבור חי. היסטוריית NQ של ${ltr('100 / 100 / 100')} נבדקה כהקשר בלבד; בדיקת NQ חיה חדשה אחרי הפתיחה נותרת נפרדת.</p>
${box('שומרים על ההפרדות','אישור כללים אינו עסקה שהתמלאה; סיכון מתוכנן אינו תקרת הפסד מובטחת; מוכנות הקשר אינה Live; כיסוי המדריך אינו הוכחת רווחיות. לא בוצעה באמצעות המסמך רכישה, הזנת פקודה או שינוי הגבלת חשבון.','good')}
<p class="small">הקובץ זמין גם כ־HTML ניתן לעריכה. שינוי המסמך אינו משנה את ההרחבה או את פרופיל החשבון. לפני שימוש בגרסה חדשה יש להשוות את תוויות הלוח, כללי המקור והמקורות הרשמיים, ולאשר שוב את התצורה בפועל.</p>
`));

const css=`
@page{size:A4;margin:0}*{box-sizing:border-box}html{background:#e5e9ef}body{margin:0;color:#142438;font-family:Arial,'Segoe UI',sans-serif;direction:rtl;font-size:10.6pt;line-height:1.48}.page{width:210mm;height:297mm;position:relative;margin:8mm auto;background:white;padding:19mm 17mm 18mm;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.running{position:absolute;top:8mm;left:17mm;right:17mm;display:flex;justify-content:space-between;direction:rtl;font-size:8pt;color:#596a7c;border-bottom:.4mm solid #dbe4eb;padding-bottom:2.5mm}.running span:first-child{font-weight:700;color:#173f54}.page-content{outline:0;max-height:258mm}.eyebrow{color:#127b77;font-weight:700;letter-spacing:.02em;font-size:9pt;margin:0 0 2.5mm}h1{font-size:27pt;line-height:1.14;color:#102e45;margin:0 0 4mm;letter-spacing:-.5pt}h2{font-size:13.5pt;line-height:1.25;margin:5mm 0 2mm;color:#123c52}h3{font-size:11.5pt;margin:0 0 1.5mm;color:#163b50}p{margin:0 0 2.8mm}.lead{font-size:12pt;line-height:1.48;color:#526173;margin-bottom:4mm}bdi{unicode-bidi:isolate;white-space:nowrap}a{color:#116a75;text-decoration:none}.ref{font-size:8pt;color:#08736f;white-space:nowrap}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:2mm 0 3mm;font-size:9.6pt;line-height:1.4}th{background:#173f54;color:white;text-align:right;padding:2.1mm 2.4mm;font-size:9pt}td{vertical-align:top;padding:2.2mm 2.4mm;border-bottom:.25mm solid #d9e2e9}tr:nth-child(even) td{background:#f3f6f8}th:first-child,td:first-child{width:30%}.hero-stats{display:flex;gap:3mm;margin:3mm 0 4mm}.hero-stats>div{flex:1;padding:4mm 2mm;background:#edf6f4;border-top:1mm solid #1a8d84;border-radius:2mm;text-align:center}.hero-stats b{display:block;font-size:20pt;line-height:1.15;color:#0f5d60}.hero-stats span{display:block;font-size:8.3pt;margin-top:2mm;color:#455d66}.hero-stats.compact b{font-size:18pt}.callout{background:#edf4f7;border-right:1.2mm solid #277384;border-radius:1.5mm;padding:3mm 3.5mm;margin:3mm 0}.callout strong{display:block;color:#103f50;margin-bottom:1mm}.callout>div{font-size:10pt}.callout.warn{background:#fff4df;border-color:#c28b28}.callout.warn strong{color:#74501b}.callout.good{background:#edf7f2;border-color:#398667}.steps{padding:0;margin:2mm 0;list-style:none;counter-reset:step}.steps li{counter-increment:step;position:relative;padding:0 10mm 0 0;margin:0 0 3.2mm}.steps li:before{content:counter(step);position:absolute;right:0;top:0;width:7mm;height:7mm;border-radius:50%;background:#173f54;color:white;text-align:center;line-height:7mm;font-weight:700}.steps strong{display:block;margin-bottom:.3mm}.steps span{display:block;font-size:10pt;color:#46596c}ul{padding-right:4.5mm;margin:1mm 0 3mm}li{margin-bottom:1.7mm}.small{font-size:8.8pt;color:#546475;line-height:1.45}.two-col{display:flex;gap:6mm;margin-top:3mm}.two-col>div{flex:1}.two-col p{font-size:9.5pt}.flow{display:flex;align-items:center;gap:1.5mm;background:#f3f6f8;padding:3mm 1mm;margin:4mm 0;font-size:8.5pt;font-weight:700;text-align:center}.flow span{flex:1}.flow i{color:#11847d;font-style:normal}.formula{background:#173f54;color:white;text-align:center;padding:3mm;font-size:10pt;border-radius:1.5mm;margin:3mm 0}.yes{color:#11715a}.no{color:#a23b28}.sop h2{display:flex;align-items:center;gap:2mm}.sop h2 span{font-size:10pt;direction:ltr;background:#e5f0f0;padding:1mm 2mm;border-radius:1mm;color:#167570}.sop ul{font-size:9.6pt}.sop li{margin-bottom:1.2mm}.source-list{display:grid;grid-template-columns:1fr 1fr;gap:2.4mm 5mm;margin:1mm 0 4mm}.source-item{display:flex;align-items:flex-start;gap:2mm;break-inside:avoid}.source-item>b{background:#edf4f6;border-radius:1mm;min-width:5mm;text-align:center;color:#176d78;font-size:9pt}.source-item a{font-size:9.2pt;font-weight:700}.source-item p{font-size:8.2pt;line-height:1.3;margin:.6mm 0 0;color:#617083}footer{position:absolute;bottom:7mm;right:17mm;left:17mm;border-top:.3mm solid #dbe4eb;padding-top:2.5mm;display:flex;justify-content:space-between;color:#68798b;font-size:8pt}.editor-toolbar{max-width:210mm;margin:5mm auto;background:#173f54;color:#fff;padding:3mm 5mm;display:flex;align-items:center;justify-content:space-between;font-size:10pt}.editor-toolbar button{font:inherit;background:#fff;border:0;border-radius:3px;padding:5px 10px;color:#173f54;cursor:pointer}[contenteditable]:focus{box-shadow:0 0 0 1px #b1dedb}@media print{html,body{background:white}.page{margin:0;box-shadow:none}.editor-toolbar{display:none}[contenteditable]:focus{box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
const html=`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="מדריך הפעלה ל-Arrow, גרף NQ ו-Apex Tradovate. מחקר והחלטה ידנית בלבד."><title>Arrow - מדריך הפעלה אישי</title><style>${css}</style></head><body><div class="editor-toolbar"><span>לחצו על הטקסט לעריכה. המסמך אינו משנה את הבוט.</span><button type="button" id="save-html">שמירת HTML ערוך</button><button type="button" onclick="print()">הדפסה / PDF</button></div>${pages.join('')}<script>document.getElementById('save-html').addEventListener('click',()=>{const blob=new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Arrow_Operating_Manual_HE.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});</script></body></html>`;
await writeFile(resolve(out,'Arrow_Operating_Manual_HE.html'),html,'utf8');
await writeFile(resolve(out,'manual-build-metadata.json'),JSON.stringify({kind:'ARROW_OPERATING_MANUAL',version:facts.version,asOf:facts.asOf,language:'he',pages:8,inputFile:inputPath,inputSha256:createHash('sha256').update(inputText).digest('hex'),htmlSha256:createHash('sha256').update(html).digest('hex'),patternLabelChecks:GUIDE_PATTERN_DESCRIPTIONS.length,geometricDefinitions:18,contextualAliases:2,scenarioFamilies:9,officialSources:sources.map(([title,url],i)=>({id:i+1,title,url})),accountIdsIncluded:false,accountScreenshotsIncluded:false,execution:'MANUAL_DECISIONS_ONLY',renderer:'Isolated owned headless Chrome, A4, RTL, Arial. PDF page inspection pending.'},null,2)+'\n','utf8');
console.log(JSON.stringify({html:resolve(out,'Arrow_Operating_Manual_HE.html'),pages:pages.length,shapeDefinitions:GUIDE_PATTERN_DESCRIPTIONS.length},null,2));
