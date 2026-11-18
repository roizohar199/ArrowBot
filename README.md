# ArrowBot

Arrow היא הרחבת Chrome לקריאת נרות TradingView, זיהוי תבניות ואיתותים חיים, ובדיקת ביצוע בחשבונות נתמכים. סקריפטי Pine נמצאים בשורש הפרויקט.

## התקנה

1. טענו את התיקייה ב־Chrome דרך `chrome://extensions` ובחרו **Load unpacked**.
2. במסלול המחקר הוסיפו ל־TradingView את `tradingview-data-window-bridge.pine` ואת `tradingview-approved-candle-markers.pine`. לאיתותי BRR הוסיפו גם את `tradingview-roi-brr.pine` לגרף NQ בדקה והשאירו את חלון הנתונים פתוח.
3. במסלולים הדורשים פריסה מזוהה, החליפו בקבצי המקור את `ARROWFR1` במזהה הפריסה שלכם בשם **Full Screens Live**, ואת `ARROWRV1` במזהה הפריסה שלכם בשם **Arrow OHLC Live Verification**. מזהי הפריסות הם החלק שאחרי `/chart/` בכתובת TradingView. טענו מחדש את התוסף לאחר העדכון.
4. הגדירו את החשבון ואת הצ׳אט הפרטי בטלגרם מתוך לוח Arrow. הגדרות החשבון וטוקן הטלגרם נשמרים מקומית בדפדפן.

## בדיקות

נדרש Node.js 24. הריצו `node scripts/test-public.mjs`. הבדיקות התלויות בהקלטות מסחר מקומיות נכללות בהרצה כאשר ההקלטות זמינות בנתיבים שהבדיקות מצפות להם. ההקלטות, ייצואי החשבון והגיבויים שמורים במחשב המקורי. תוצאות מדגם NQ מקובצות נשמרו תחת `verification/0.31.6/`.
