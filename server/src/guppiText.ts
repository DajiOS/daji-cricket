// The words Guppi answers with, in English, Gujarati, Hindi and romanized Gujarati and Hindi. Only wording lives here. Every number in a sentence (a price, an advance,
// a balance, a date) is filled in from what the booking system returned, formatted the same way in every language, so a translation cannot change a figure.

import type { Lang } from './guppiLang.ts';

export type Key =
  | 'need' | 'fDate' | 'fTime' | 'fDuration' | 'fGround' | 'fOption' | 'askAmPm' | 'askDate2' | 'askDateBad' | 'askDuration2' | 'askGround'
  | 'found' | 'foundMany' | 'foundOthers' | 'none' | 'noneLater' | 'selected' | 'hold' | 'rejected' | 'waiver' | 'payAct' | 'refund' | 'changeAsk' | 'claim' | 'claimNone'
  | 'balance' | 'balanceMany' | 'balanceNone' | 'price' | 'deposit' | 'needOffer' | 'pickOption' | 'expired' | 'prevHold' | 'normalFlow' | 'unknown'
  | 'sHeld' | 'sConfirmed' | 'sCancelled' | 'sExpired' | 'sNoShow' | 'sCompleted' | 'hour' | 'hours' | 'minutes' | 'am' | 'pm';

const EN: Record<Key, string> = {
  need: 'To go ahead I need: {list}.', fDate: 'the date', fTime: 'the start time', fDuration: 'how many hours', fGround: 'which ground', fOption: 'which option',
  askAmPm: 'Do you mean {a} or {b}?', askDate2: 'Which date do you mean: {a} or {b}?', askDateBad: 'That date does not exist or has passed. Which date do you want?',
  askDuration2: 'Bookings here are in {n}-minute slots. Do you want {a} or {b}?', askGround: 'Which ground: {list}?',
  found: '{ground}: {when} is free. Total {total}, advance {advance}. Say yes to hold it, or pick another option.',
  foundMany: '{ground} is not free then. According to the booking system these are free. Pick one by number, or tell me what to change.',
  foundOthers: 'According to the booking system these are free. Pick one by number.',
  none: 'Nothing is free near that time. Try another date or time.', noneLater: 'No later time is free that day.',
  selected: 'Selected: {ground}, {when}, {dur}. Total {total}; advance to pay now {advance}. Say yes to hold it and go to secure payment, or choose another option.',
  hold: 'Holding {when}. Taking you to secure payment. I cannot confirm any payment myself.',
  rejected: 'Okay, nothing is held. Choose another option or tell me what to change.',
  waiver: 'I cannot waive or reduce a deposit or any payment. Please contact the ground. Nothing was changed.',
  payAct: 'I cannot take, confirm or record a payment, and I cannot mark anything as paid. Payments are made only on the secure payment screen, and only the payment system confirms them. Nothing was changed.',
  refund: 'I cannot approve, issue or change a refund. Refunds follow the cancellation rules and are decided by the ground. Nothing was changed.',
  changeAsk: 'I cannot cancel or change a booking from here. Please use My bookings or contact the ground. Nothing was changed.',
  claim: 'I cannot mark a payment as paid from a message. Daji shows booking {ref} as {status}: paid {paid} of {total}, balance {balance}. Only the payment system confirms payments.',
  claimNone: 'I could not find a booking to check. Open the booking and I will check it. A message cannot mark anything paid.',
  balance: 'Daji shows balance {balance} on booking {ref} ({status}): total {total}, paid {paid}.', balanceMany: 'Daji shows {balance} outstanding across {n} bookings.', balanceNone: 'Daji shows nothing outstanding.',
  price: 'Total {total} for {when}. The booking system sets the price; I cannot change it.',
  deposit: 'Advance to pay now: {advance} of a total {total}. The advance is part of the booking price. A refundable security deposit, if the ground takes one, is separate and is handled by the ground, not by me. The booking system sets these figures; I cannot change them.',
  needOffer: 'Tell me the date, time and hours first, then I can show the price.', pickOption: 'Which option? Say the number (for example: option 2).',
  expired: 'Those options have expired. Here are fresh ones.', prevHold: 'Your earlier hold {ref} stays until {until}. I cannot cancel it for you; it will lapse by itself.',
  normalFlow: 'This ground needs you to choose a session from its price list. Please use the normal booking screen.', unknown: 'I did not understand that. Tell me the date, start time and how many hours.',
  sHeld: 'on hold, waiting for payment', sConfirmed: 'confirmed', sCancelled: 'cancelled', sExpired: 'expired', sNoShow: 'marked no-show', sCompleted: 'completed',
  hour: 'hour', hours: 'hours', minutes: 'minutes', am: 'AM', pm: 'PM',
};

const GU: Record<Key, string> = {
  need: 'આગળ વધવા માટે મને જણાવો: {list}.', fDate: 'તારીખ', fTime: 'શરૂઆતનો સમય', fDuration: 'કેટલા કલાક', fGround: 'કયું ગ્રાઉન્ડ', fOption: 'કયો વિકલ્પ',
  askAmPm: 'તમારો મતલબ {a} છે કે {b}?', askDate2: 'કઈ તારીખ: {a} કે {b}?', askDateBad: 'તે તારીખ માન્ય નથી અથવા વીતી ગઈ છે. કઈ તારીખ જોઈએ છે?',
  askDuration2: 'અહીં {n} મિનિટના સ્લોટમાં બુકિંગ થાય છે. {a} કે {b}?', askGround: 'કયું ગ્રાઉન્ડ: {list}?',
  found: '{ground}: {when} ખાલી છે. કુલ {total}, એડવાન્સ {advance}. હોલ્ડ કરવા માટે "હા" કહો, અથવા બીજો વિકલ્પ પસંદ કરો.',
  foundMany: '{ground} તે સમયે ખાલી નથી. બુકિંગ સિસ્ટમ મુજબ આ વિકલ્પો ખાલી છે. નંબર કહીને પસંદ કરો, અથવા શું બદલવું તે કહો.',
  foundOthers: 'બુકિંગ સિસ્ટમ મુજબ આ ખાલી છે. નંબર કહીને પસંદ કરો.',
  none: 'તે સમયની આસપાસ કંઈ ખાલી નથી. બીજી તારીખ કે સમય અજમાવો.', noneLater: 'તે દિવસે પછીનો કોઈ સમય ખાલી નથી.',
  selected: 'પસંદ કર્યું: {ground}, {when}, {dur}. કુલ {total}; હમણાં ચૂકવવાનું એડવાન્સ {advance}. હોલ્ડ કરીને સુરક્ષિત ચુકવણી પર જવા "હા" કહો, અથવા બીજો વિકલ્પ પસંદ કરો.',
  hold: '{when} હોલ્ડ કરું છું. સુરક્ષિત ચુકવણી સ્ક્રીન પર લઈ જાઉં છું. ચુકવણી હું જાતે કન્ફર્મ કરી શકતો નથી.',
  rejected: 'ઠીક છે, કંઈ હોલ્ડ કર્યું નથી. બીજો વિકલ્પ પસંદ કરો અથવા શું બદલવું તે કહો.',
  waiver: 'હું ડિપોઝિટ કે કોઈ ચુકવણી માફ કે ઓછી કરી શકતો નથી. કૃપા કરીને ગ્રાઉન્ડનો સંપર્ક કરો. કંઈ બદલાયું નથી.',
  payAct: 'હું ચુકવણી લઈ શકતો નથી, કન્ફર્મ કરી શકતો નથી કે નોંધી શકતો નથી, અને કંઈ પણ "ચૂકવેલ" તરીકે માર્ક કરી શકતો નથી. ચુકવણી ફક્ત સુરક્ષિત પેમેન્ટ સ્ક્રીન પર થાય છે અને ફક્ત પેમેન્ટ સિસ્ટમ જ તેને કન્ફર્મ કરે છે. કંઈ બદલાયું નથી.',
  refund: 'હું રિફંડ મંજૂર કરી શકતો નથી, આપી શકતો નથી કે બદલી શકતો નથી. રિફંડ રદ કરવાના નિયમો મુજબ ગ્રાઉન્ડ નક્કી કરે છે. કંઈ બદલાયું નથી.',
  changeAsk: 'હું અહીંથી બુકિંગ રદ કે બદલી શકતો નથી. કૃપા કરીને મારા બુકિંગ વાપરો અથવા ગ્રાઉન્ડનો સંપર્ક કરો. કંઈ બદલાયું નથી.',
  claim: 'મેસેજ પરથી હું ચુકવણી "ચૂકવાઈ ગઈ" તરીકે નોંધી શકતો નથી. ડાજીમાં બુકિંગ {ref} {status} છે: {total} માંથી {paid} ચૂકવ્યા, બાકી {balance}. ચુકવણી ફક્ત પેમેન્ટ સિસ્ટમ કન્ફર્મ કરે છે.',
  claimNone: 'ચકાસવા માટે કોઈ બુકિંગ મળ્યું નથી. બુકિંગ ખોલો, હું તપાસીશ. મેસેજથી કંઈ "ચૂકવેલ" થતું નથી.',
  balance: 'ડાજી મુજબ બુકિંગ {ref} ({status}) પર બાકી {balance}: કુલ {total}, ચૂકવેલ {paid}.', balanceMany: 'ડાજી મુજબ {n} બુકિંગ પર કુલ બાકી {balance}.', balanceNone: 'ડાજી મુજબ કંઈ બાકી નથી.',
  price: '{when} માટે કુલ {total}. ભાવ બુકિંગ સિસ્ટમ નક્કી કરે છે; હું બદલી શકતો નથી.',
  deposit: 'હમણાં ચૂકવવાનું એડવાન્સ: કુલ {total} માંથી {advance}. એડવાન્સ બુકિંગની કિંમતનો ભાગ છે. રિફંડપાત્ર સિક્યોરિટી ડિપોઝિટ, જો ગ્રાઉન્ડ લેતું હોય, તો તે અલગ છે અને ગ્રાઉન્ડ જ સંભાળે છે, હું નહીં. આ આંકડા બુકિંગ સિસ્ટમ નક્કી કરે છે; હું બદલી શકતો નથી.',
  needOffer: 'પહેલા તારીખ, સમય અને કલાક કહો, પછી હું ભાવ બતાવીશ.', pickOption: 'કયો વિકલ્પ? નંબર કહો (જેમ કે: વિકલ્પ 2).',
  expired: 'તે વિકલ્પોની સમયમર્યાદા પૂરી થઈ. આ નવા વિકલ્પો છે.', prevHold: 'તમારું અગાઉનું હોલ્ડ {ref} {until} સુધી રહેશે. હું તેને રદ કરી શકતો નથી; તે જાતે પૂરું થઈ જશે.',
  normalFlow: 'આ ગ્રાઉન્ડમાં ભાવ યાદીમાંથી સેશન પસંદ કરવું પડે છે. કૃપા કરીને સામાન્ય બુકિંગ સ્ક્રીન વાપરો.', unknown: 'મને સમજાયું નહીં. તારીખ, શરૂઆતનો સમય અને કેટલા કલાક કહો.',
  sHeld: 'હોલ્ડ પર, ચુકવણીની રાહ', sConfirmed: 'કન્ફર્મ', sCancelled: 'રદ', sExpired: 'સમય પૂરો', sNoShow: 'ન આવ્યા તરીકે નોંધાયેલ', sCompleted: 'પૂર્ણ',
  hour: 'કલાક', hours: 'કલાક', minutes: 'મિનિટ', am: 'સવારે', pm: 'સાંજે',
};

const HI: Record<Key, string> = {
  need: 'आगे बढ़ने के लिए बताइए: {list}।', fDate: 'तारीख', fTime: 'शुरू होने का समय', fDuration: 'कितने घंटे', fGround: 'कौन सा ग्राउंड', fOption: 'कौन सा विकल्प',
  askAmPm: 'आपका मतलब {a} है या {b}?', askDate2: 'कौन सी तारीख: {a} या {b}?', askDateBad: 'वह तारीख मान्य नहीं है या बीत चुकी है। कौन सी तारीख चाहिए?',
  askDuration2: 'यहाँ बुकिंग {n} मिनट के स्लॉट में होती है। {a} या {b}?', askGround: 'कौन सा ग्राउंड: {list}?',
  found: '{ground}: {when} खाली है। कुल {total}, एडवांस {advance}। होल्ड करने के लिए "हाँ" कहें, या दूसरा विकल्प चुनें।',
  foundMany: '{ground} उस समय खाली नहीं है। बुकिंग सिस्टम के अनुसार ये विकल्प खाली हैं। नंबर बोलकर चुनें, या बताइए क्या बदलना है।',
  foundOthers: 'बुकिंग सिस्टम के अनुसार ये खाली हैं। नंबर बोलकर चुनें।',
  none: 'उस समय के आसपास कुछ खाली नहीं है। कोई और तारीख या समय आज़माइए।', noneLater: 'उस दिन बाद का कोई समय खाली नहीं है।',
  selected: 'चुना गया: {ground}, {when}, {dur}। कुल {total}; अभी देने वाला एडवांस {advance}। होल्ड करके सुरक्षित भुगतान पर जाने के लिए "हाँ" कहें, या दूसरा विकल्प चुनें।',
  hold: '{when} होल्ड कर रहा हूँ। सुरक्षित भुगतान स्क्रीन पर ले जा रहा हूँ। भुगतान मैं खुद कन्फर्म नहीं कर सकता।',
  rejected: 'ठीक है, कुछ होल्ड नहीं किया है। दूसरा विकल्प चुनें या बताइए क्या बदलना है।',
  waiver: 'मैं डिपॉज़िट या कोई भुगतान माफ़ या कम नहीं कर सकता। कृपया ग्राउंड से संपर्क करें। कुछ नहीं बदला है।',
  payAct: 'मैं भुगतान ले नहीं सकता, कन्फर्म नहीं कर सकता, दर्ज नहीं कर सकता, और कुछ भी "चुकाया हुआ" नहीं कर सकता। भुगतान केवल सुरक्षित पेमेंट स्क्रीन पर होता है और केवल पेमेंट सिस्टम ही उसे कन्फर्म करता है। कुछ नहीं बदला है।',
  refund: 'मैं रिफंड मंज़ूर, जारी या बदल नहीं सकता। रिफंड रद्द करने के नियमों के अनुसार ग्राउंड तय करता है। कुछ नहीं बदला है।',
  changeAsk: 'मैं यहाँ से बुकिंग रद्द या बदल नहीं सकता। कृपया मेरी बुकिंग इस्तेमाल करें या ग्राउंड से संपर्क करें। कुछ नहीं बदला है।',
  claim: 'संदेश से मैं भुगतान को "हो गया" दर्ज नहीं कर सकता। डाजी में बुकिंग {ref} {status} है: {total} में से {paid} दिया गया, बाकी {balance}। भुगतान की पुष्टि सिर्फ़ पेमेंट सिस्टम करता है।',
  claimNone: 'जाँचने के लिए कोई बुकिंग नहीं मिली। बुकिंग खोलिए, मैं जाँच लूँगा। संदेश से कुछ "भुगतान" नहीं होता।',
  balance: 'डाजी के अनुसार बुकिंग {ref} ({status}) पर बाकी {balance}: कुल {total}, दिया गया {paid}।', balanceMany: 'डाजी के अनुसार {n} बुकिंग पर कुल बाकी {balance}।', balanceNone: 'डाजी के अनुसार कुछ बाकी नहीं है।',
  price: '{when} के लिए कुल {total}। कीमत बुकिंग सिस्टम तय करता है; मैं बदल नहीं सकता।',
  deposit: 'अभी देने वाला एडवांस: कुल {total} में से {advance}। एडवांस बुकिंग की कीमत का हिस्सा है। रिफंड होने वाला सिक्योरिटी डिपॉज़िट, अगर ग्राउंड लेता है, इससे अलग है और ग्राउंड ही संभालता है, मैं नहीं। ये आँकड़े बुकिंग सिस्टम तय करता है; मैं बदल नहीं सकता।',
  needOffer: 'पहले तारीख, समय और घंटे बताइए, फिर मैं कीमत दिखाऊँगा।', pickOption: 'कौन सा विकल्प? नंबर बताइए (जैसे: विकल्प 2)।',
  expired: 'उन विकल्पों की समय-सीमा खत्म हो गई। ये नए विकल्प हैं।', prevHold: 'आपका पिछला होल्ड {ref} {until} तक रहेगा। मैं उसे रद्द नहीं कर सकता; वह अपने आप खत्म हो जाएगा।',
  normalFlow: 'इस ग्राउंड में कीमत सूची से सेशन चुनना होता है। कृपया सामान्य बुकिंग स्क्रीन इस्तेमाल करें।', unknown: 'मैं समझ नहीं पाया। तारीख, शुरू होने का समय और कितने घंटे बताइए।',
  sHeld: 'होल्ड पर, भुगतान की प्रतीक्षा', sConfirmed: 'कन्फर्म', sCancelled: 'रद्द', sExpired: 'समय समाप्त', sNoShow: 'नो-शो दर्ज', sCompleted: 'पूर्ण',
  hour: 'घंटा', hours: 'घंटे', minutes: 'मिनट', am: 'सुबह', pm: 'शाम',
};

const GU_L: Record<Key, string> = {
  need: 'Aagal vadhva mate mane janavo: {list}.', fDate: 'tarikh', fTime: 'shuruaat no samay', fDuration: 'ketla kalak', fGround: 'kyu ground', fOption: 'kyo vikalp',
  askAmPm: 'Tamaro matlab {a} chhe ke {b}?', askDate2: 'Kai tarikh: {a} ke {b}?', askDateBad: 'Te tarikh manya nathi athva vati gai chhe. Kai tarikh joie chhe?',
  askDuration2: 'Ahi {n} minute na slot ma booking thay chhe. {a} ke {b}?', askGround: 'Kyu ground: {list}?',
  found: '{ground}: {when} khali chhe. Kul {total}, advance {advance}. Hold karva "haa" kaho, athva biju vikalp pasand karo.',
  foundMany: '{ground} te samaye khali nathi. Booking system mujab aa vikalpo khali chhe. Number kahine pasand karo, athva shu badalvu te kaho.',
  foundOthers: 'Booking system mujab aa khali chhe. Number kahine pasand karo.',
  none: 'Te samay ni aaspas kai khali nathi. Biji tarikh ke samay try karo.', noneLater: 'Te divase pachhi no koi samay khali nathi.',
  selected: 'Pasand karyu: {ground}, {when}, {dur}. Kul {total}; hamna chukvvanu advance {advance}. Hold kari secure payment par java "haa" kaho, athva biju vikalp pasand karo.',
  hold: '{when} hold karu chhu. Secure payment screen par lai jau chhu. Payment hu jate confirm kari shakto nathi.',
  rejected: 'Theek chhe, kai hold karyu nathi. Biju vikalp pasand karo athva shu badalvu te kaho.',
  waiver: 'Hu deposit ke koi payment maaf ke ochhu kari shakto nathi. Krupa kari ground no sampark karo. Kai badlayu nathi.',
  payAct: 'Hu payment lai shakto nathi, confirm kari shakto nathi ke noondhi shakto nathi, ane kai pan "paid" tarike mark kari shakto nathi. Payment fakt secure payment screen par thay chhe ane fakt payment system j tene confirm kare chhe. Kai badlayu nathi.',
  refund: 'Hu refund approve kari shakto nathi, aapi shakto nathi ke badli shakto nathi. Refund radd karva na niyamo mujab ground nakki kare chhe. Kai badlayu nathi.',
  changeAsk: 'Hu ahithi booking radd ke badli shakto nathi. Krupa kari My bookings vapro athva ground no sampark karo. Kai badlayu nathi.',
  claim: 'Message parthi hu payment "thai gayu" tarike nondhi shakto nathi. Daji ma booking {ref} {status} chhe: {total} mathi {paid} chukvya, baki {balance}. Payment fakt payment system confirm kare chhe.',
  claimNone: 'Tapasva mate koi booking malyu nathi. Booking kholo, hu tapasish. Message thi kai "paid" thatu nathi.',
  balance: 'Daji mujab booking {ref} ({status}) par baki {balance}: kul {total}, chukvelu {paid}.', balanceMany: 'Daji mujab {n} booking par kul baki {balance}.', balanceNone: 'Daji mujab kai baki nathi.',
  price: '{when} mate kul {total}. Bhav booking system nakki kare chhe; hu badli shakto nathi.',
  deposit: 'Hamna chukvvanu advance: kul {total} mathi {advance}. Advance booking ni kimmat no bhag chhe. Refund thai shake evu security deposit, jo ground le to, tena thi alag chhe ane ground j sambhale chhe, hu nahi. Aa aankda booking system nakki kare chhe; hu badli shakto nathi.',
  needOffer: 'Pahela tarikh, samay ane kalak kaho, pachhi hu bhav batavish.', pickOption: 'Kyo vikalp? Number kaho (jem ke: vikalp 2).',
  expired: 'Te vikalpo ni samay-maryada puri thai. Aa nava vikalpo chhe.', prevHold: 'Tamaru agau nu hold {ref} {until} sudhi raheshe. Hu tene radd kari shakto nathi; te jate puru thai jashe.',
  normalFlow: 'Aa ground ma bhav yadi mathi session pasand karvu pade chhe. Krupa kari saamanya booking screen vapro.', unknown: 'Mane samjayu nahi. Tarikh, shuruaat no samay ane ketla kalak kaho.',
  sHeld: 'hold par, chukvani raah', sConfirmed: 'confirm', sCancelled: 'radd', sExpired: 'samay puro', sNoShow: 'no-show nondhayel', sCompleted: 'purn',
  hour: 'kalak', hours: 'kalak', minutes: 'minute', am: 'savare', pm: 'sanje',
};

const HI_L: Record<Key, string> = {
  need: 'Aage badhne ke liye bataiye: {list}.', fDate: 'tarikh', fTime: 'shuru hone ka samay', fDuration: 'kitne ghante', fGround: 'kaun sa ground', fOption: 'kaun sa vikalp',
  askAmPm: 'Aapka matlab {a} hai ya {b}?', askDate2: 'Kaun si tarikh: {a} ya {b}?', askDateBad: 'Woh tarikh manya nahi hai ya beet chuki hai. Kaun si tarikh chahiye?',
  askDuration2: 'Yahan booking {n} minute ke slot mein hoti hai. {a} ya {b}?', askGround: 'Kaun sa ground: {list}?',
  found: '{ground}: {when} khali hai. Kul {total}, advance {advance}. Hold karne ke liye "haan" kahiye, ya doosra vikalp chuniye.',
  foundMany: '{ground} us samay khali nahi hai. Booking system ke anusar ye vikalp khali hain. Number bolkar chuniye, ya bataiye kya badalna hai.',
  foundOthers: 'Booking system ke anusar ye khali hain. Number bolkar chuniye.',
  none: 'Us samay ke aaspaas kuch khali nahi hai. Koi aur tarikh ya samay try kijiye.', noneLater: 'Us din baad ka koi samay khali nahi hai.',
  selected: 'Chuna gaya: {ground}, {when}, {dur}. Kul {total}; abhi dene wala advance {advance}. Hold karke secure payment par jaane ke liye "haan" kahiye, ya doosra vikalp chuniye.',
  hold: '{when} hold kar raha hoon. Secure payment screen par le ja raha hoon. Payment main khud confirm nahi kar sakta.',
  rejected: 'Theek hai, kuch hold nahi kiya hai. Doosra vikalp chuniye ya bataiye kya badalna hai.',
  waiver: 'Main deposit ya koi payment maaf ya kam nahi kar sakta. Kripya ground se sampark kijiye. Kuch nahi badla hai.',
  payAct: 'Main payment le nahi sakta, confirm nahi kar sakta, darj nahi kar sakta, aur kuch bhi "paid" mark nahi kar sakta. Payment sirf secure payment screen par hota hai aur sirf payment system hi use confirm karta hai. Kuch nahi badla hai.',
  refund: 'Main refund approve, jari ya badal nahi sakta. Refund cancellation ke niyamon ke anusar ground tay karta hai. Kuch nahi badla hai.',
  changeAsk: 'Main yahan se booking radd ya badal nahi sakta. Kripya My bookings use kijiye ya ground se sampark kijiye. Kuch nahi badla hai.',
  claim: 'Message se main payment ko "ho gaya" darj nahi kar sakta. Daji mein booking {ref} {status} hai: {total} mein se {paid} diya gaya, baaki {balance}. Payment ki pushti sirf payment system karta hai.',
  claimNone: 'Jaanchne ke liye koi booking nahi mili. Booking kholiye, main jaanch loonga. Message se kuch "paid" nahi hota.',
  balance: 'Daji ke anusar booking {ref} ({status}) par baaki {balance}: kul {total}, diya gaya {paid}.', balanceMany: 'Daji ke anusar {n} booking par kul baaki {balance}.', balanceNone: 'Daji ke anusar kuch baaki nahi hai.',
  price: '{when} ke liye kul {total}. Keemat booking system tay karta hai; main badal nahi sakta.',
  deposit: 'Abhi dene wala advance: kul {total} mein se {advance}. Advance booking ki keemat ka hissa hai. Refund hone wala security deposit, agar ground leta hai, isse alag hai aur ground hi sambhalta hai, main nahi. Yeh aankde booking system tay karta hai; main badal nahi sakta.',
  needOffer: 'Pehle tarikh, samay aur ghante bataiye, phir main keemat dikhaunga.', pickOption: 'Kaun sa vikalp? Number bataiye (jaise: vikalp 2).',
  expired: 'Un vikalpon ki samay-seema khatam ho gayi. Ye naye vikalp hain.', prevHold: 'Aapka pichla hold {ref} {until} tak rahega. Main use radd nahi kar sakta; woh apne aap khatam ho jayega.',
  normalFlow: 'Is ground mein keemat suchi se session chunna hota hai. Kripya saamanya booking screen istemal kijiye.', unknown: 'Main samajh nahi paya. Tarikh, shuru hone ka samay aur kitne ghante bataiye.',
  sHeld: 'hold par, payment ki pratiksha', sConfirmed: 'confirm', sCancelled: 'radd', sExpired: 'samay samapt', sNoShow: 'no-show darj', sCompleted: 'poorn',
  hour: 'ghanta', hours: 'ghante', minutes: 'minute', am: 'subah', pm: 'shaam',
};

const PACKS: Record<Lang, Record<Key, string>> = { en: EN, gu: GU, hi: HI, 'gu-Latn': GU_L, 'hi-Latn': HI_L };

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS: Record<Lang, string[]> = {
  en: MONTH_EN, 'gu-Latn': MONTH_EN, 'hi-Latn': MONTH_EN,
  gu: ['જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઓગસ્ટ', 'સપ્ટેમ્બર', 'ઓક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
const ROMAN_DAYS = ['Ravivar', 'Somvar', 'Mangalvar', 'Budhvar', 'Guruvar', 'Shukravar', 'Shanivar'];
const WEEKDAYS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], 'gu-Latn': ROMAN_DAYS, 'hi-Latn': ROMAN_DAYS,
  gu: ['રવિવાર', 'સોમવાર', 'મંગળવાર', 'બુધવાર', 'ગુરુવાર', 'શુક્રવાર', 'શનિવાર'], hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
};
export const WEEKDAY_EN = WEEKDAYS.en;

export const say = (lang: Lang, key: Key, vars: Record<string, string | number> = {}): string =>
  PACKS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

/** Amounts are written the same way in every language: the figure comes from the booking system, only the sentence around it is translated. */
export const inr = (paise: number): string => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function time12(lang: Lang, t: string): string {
  const h = Number(t.slice(0, 2)), m = t.slice(3, 5);
  void lang;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}
export function dateText(lang: Lang, date: string, weekday: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS[lang][weekday]}, ${d} ${MONTHS[lang][m - 1]} ${y}`;
}
export function whenText(lang: Lang, date: string, weekday: number, start: string, end?: string): string {
  return `${dateText(lang, date, weekday)}, ${time12(lang, start)}${end ? ` – ${time12(lang, end)}` : ''}`;
}
export function durText(lang: Lang, minutes: number): string {
  if (minutes % 60 === 0) { const h = minutes / 60; return `${h} ${say(lang, h === 1 ? 'hour' : 'hours')}`; }
  return `${minutes} ${say(lang, 'minutes')}`;
}

export interface Labels { title: string; placeholder: string; send: string; option: string; total: string; advance: string; hold: string; change: string; secure: string; reset: string; signIn: string; example: string }
export const LABELS: Record<Lang, Labels> = {
  en: { title: 'DCG booking assistant', placeholder: 'Tell DCG what you need, in any language', send: 'Send', option: 'Option', total: 'Total', advance: 'Advance', hold: 'Hold and go to secure payment', change: 'Change', secure: 'DCG never takes payment. Payment happens only on the secure payment screen.', reset: 'Start over', signIn: 'Sign in to book with DCG.', example: 'Example: Sunday 7 PM for 3 hours' },
  gu: { title: 'DCG બુકિંગ સહાયક', placeholder: 'DCG ને કોઈપણ ભાષામાં જણાવો', send: 'મોકલો', option: 'વિકલ્પ', total: 'કુલ', advance: 'એડવાન્સ', hold: 'હોલ્ડ કરો અને સુરક્ષિત ચુકવણી પર જાઓ', change: 'બદલો', secure: 'DCG ચુકવણી લેતું નથી. ચુકવણી ફક્ત સુરક્ષિત ચુકવણી સ્ક્રીન પર થાય છે.', reset: 'ફરી શરૂ કરો', signIn: 'DCG સાથે બુક કરવા સાઇન ઇન કરો.', example: 'ઉદાહરણ: રવિવારે સાંજે ૭ વાગ્યે ૩ કલાક' },
  hi: { title: 'DCG बुकिंग सहायक', placeholder: 'DCG को किसी भी भाषा में बताइए', send: 'भेजें', option: 'विकल्प', total: 'कुल', advance: 'एडवांस', hold: 'होल्ड करें और सुरक्षित भुगतान पर जाएँ', change: 'बदलें', secure: 'DCG भुगतान नहीं लेता। भुगतान सिर्फ़ सुरक्षित भुगतान स्क्रीन पर होता है।', reset: 'फिर से शुरू करें', signIn: 'DCG से बुक करने के लिए साइन इन करें।', example: 'उदाहरण: रविवार शाम 7 बजे 3 घंटे' },
  'gu-Latn': { title: 'DCG booking sahayak', placeholder: 'DCG ne koi pan bhasha ma kaho', send: 'Moklo', option: 'Vikalp', total: 'Kul', advance: 'Advance', hold: 'Hold karo ane secure payment par jao', change: 'Badlo', secure: 'DCG payment letu nathi. Payment fakt secure payment screen par thay chhe.', reset: 'Fari sharu karo', signIn: 'DCG sathe book karva sign in karo.', example: 'Udaharan: ravivar sanje 7 vagye 3 kalak' },
  'hi-Latn': { title: 'DCG booking sahayak', placeholder: 'DCG ko kisi bhi bhasha mein bataiye', send: 'Bhejiye', option: 'Vikalp', total: 'Kul', advance: 'Advance', hold: 'Hold karein aur secure payment par jayein', change: 'Badlein', secure: 'DCG payment nahi leta. Payment sirf secure payment screen par hota hai.', reset: 'Phir se shuru karein', signIn: 'DCG se book karne ke liye sign in kijiye.', example: 'Udaharan: Ravivar shaam 7 baje 3 ghante' },
};
