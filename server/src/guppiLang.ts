// Guppi's reading of a booking message in English, Gujarati, Hindi, romanized Gujarati or Hindi, or a mix of them. This file only turns words into a plain request (a day,
// a start time, a length, a ground word), a choice among options already shown, or a plain flag (a rejection, a payment statement, a request to waive money). It never
// sees a price, an availability or a payment, and it cannot create or change anything: the request it produces goes through the same option search and hold as a person
// tapping the normal screens. Where the words could mean two materially different things (7 o'clock with no am/pm and nothing to go on, "4/1", a day with no month, "Sunday"
// said on a Sunday) it says so and asks; it does not pick. Spelling is not exact: romanized words match within one letter ("vagye" / "vage" / "vagya"; "kalak" / "kalaak").
// An optional AI reader (guppiBooking.ts) may fill gaps but is checked against this one and can never override it.

import { addDays, dayOfWeek, isValidDate } from './time.ts';

export type Lang = 'en' | 'gu' | 'hi' | 'gu-Latn' | 'hi-Latn';
export type InputKind = 'english' | 'gujarati' | 'hindi' | 'romanized-gujarati' | 'romanized-hindi' | 'mixed';

export interface Issue { reason: 'ambiguous' | 'past' | 'invalid'; candidates?: string[] }
export interface Choice { startTime?: string; endTime?: string; durationMinutes?: number; date?: string }
export interface RawClock { h: number; minute: number; mark: 'am' | 'pm' | '24' | null }
export type Period = 'morning' | 'afternoon' | 'evening' | 'night';

export interface Parsed {
  inputKind: InputKind;
  /** The language to answer in: the script or style the person wrote in. */
  language: Lang;
  date?: string; dateIssue?: Issue & { choices?: Choice[] };
  /** "another Sunday": the weekday (0 = Sunday); the day is worked out from the day already in the draft. */
  anotherWeekday?: number;
  startTime?: string; endTime?: string; timeIssue?: Issue & { choices?: Choice[] };
  /** An hour that could be morning or evening, kept so a one-word answer ("evening") can settle it. */
  pending?: { start: RawClock; end?: RawClock };
  period: Period | null;
  durationMinutes?: number; minDurationMinutes?: number; durationIssue?: Issue;
  anyGround?: boolean;
  /** Words left over after the date, time and length were read; used to find which ground was meant. */
  words: string[];
  select: { index?: number; relative?: 'later' | 'earlier' | 'shorter' | 'longer' | 'cheapest'; confirm?: boolean };
  flags: { reject: boolean; waiver: boolean; payClaim: boolean; payStatus: boolean; asksAvailability: boolean; correction: boolean; askPrice: boolean; askDeposit: boolean; sameDay: boolean; bookWord: boolean; payAct: boolean; refund: boolean; change: boolean };
}

/** Indian-script spelling that people vary freely (long or short i and u, chandrabindu or anusvara, nukta) is folded so both spellings match. */
const nfc = (s: string): string => s.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '')
  .replace(/\u0ac0/g, '\u0abf').replace(/\u0940/g, '\u093f').replace(/\u0ac2/g, '\u0ac1').replace(/\u0942/g, '\u0941')
  .replace(/\u0a81/g, '\u0a82').replace(/\u0901/g, '\u0902').replace(/[\u093c\u0abc]/g, '');

/** Gujarati and Devanagari digits become ordinary digits. Everything else keeps its meaning. */
export function plainDigits(s: string): string {
  return s.replace(/[૦-૯]/g, (c) => String(c.charCodeAt(0) - 0x0ae6)).replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}

// ---- matching words: Indian-script words match a stem plus a short ending; Latin words match within one letter
function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
const ASCII = /^[\x00-\x7f]+$/;
export function inList(tok: string, names: string[]): boolean {
  if (ASCII.test(tok)) return names.some((n) => tok === n || (tok.length >= 5 && n.length >= 5 && ASCII.test(n) && lev1(tok, n)));
  return names.some((n) => !ASCII.test(n) && tok.startsWith(n) && tok.length - n.length <= (n.length <= 2 ? 1 : 3));
}
const has = (toks: string[], names: string[]): boolean => toks.some((t) => inList(t, names));
const N = (xs: string[]): string[] => xs.map(nfc);

const MONTHS: string[][] = [
  N(['jan', 'january', 'જાન્યુઆરી', 'જાન્યુ', 'जनवरी']), N(['feb', 'february', 'ફેબ્રુઆરી', 'ફેબ્રુવારી', 'फरवरी', 'फ़रवरी']), N(['mar', 'march', 'માર્ચ', 'मार्च']),
  N(['apr', 'april', 'એપ્રિલ', 'अप्रैल', 'अप्रेल']), N(['may', 'મે', 'मई']), N(['jun', 'june', 'જૂન', 'જુન', 'जून']),
  N(['jul', 'july', 'જુલાઈ', 'જુલાઇ', 'जुलाई']), N(['aug', 'august', 'ઓગસ્ટ', 'ઑગસ્ટ', 'अगस्त']), N(['sep', 'sept', 'september', 'સપ્ટેમ્બર', 'સપ્ટેંબર', 'सितंबर', 'सितम्बर']),
  N(['oct', 'october', 'ઓક્ટોબર', 'ઑક્ટોબર', 'अक्टूबर', 'अक्तूबर']), N(['nov', 'november', 'નવેમ્બર', 'નવેંબર', 'नवंबर', 'नवम्बर']), N(['dec', 'december', 'ડિસેમ્બર', 'ડિસેંબર', 'दिसंबर', 'दिसम्बर']),
];
const WEEKDAYS: string[][] = [ // 0 = Sunday, as time.ts
  N(['sun', 'sunday', 'ravivar', 'ravivaar', 'ravi', 'itvar', 'itwar', 'રવિવાર', 'रविवार']),
  N(['mon', 'monday', 'somvar', 'somvaar', 'somwar', 'સોમવાર', 'सोमवार']),
  N(['tue', 'tues', 'tuesday', 'mangalvar', 'mangalvaar', 'mangalwar', 'મંગળવાર', 'मंगलवार']),
  N(['wed', 'weds', 'wednesday', 'budhvar', 'budhvaar', 'budhwar', 'બુધવાર', 'बुधवार']),
  N(['thu', 'thur', 'thurs', 'thursday', 'guruvar', 'guruvaar', 'gurvar', 'guruwar', 'brihaspativar', 'ગુરુવાર', 'गुरुवार', 'बृहस्पतिवार']),
  N(['fri', 'friday', 'shukravar', 'shukravaar', 'shukrawar', 'શુક્રવાર', 'शुक्रवार']),
  N(['sat', 'saturday', 'shanivar', 'shanivaar', 'shaniwar', 'શનિવાર', 'शनिवार']),
];
const TODAY = N(['today', 'aaj', 'aaje', 'aje', 'આજે', 'આજ', 'आज']);
const TOMORROW = N(['tomorrow', 'tmrw', 'kale', 'kal', 'કાલે', 'કાલ', 'कल']);
const DAY_AFTER = N(['parso', 'parsu', 'parmdivase', 'પરમદિવસે', 'परसों', 'परसो']);
const UPCOMING = N(['next', 'upcoming', 'coming', 'aavta', 'avta', 'aavto', 'aavti', 'aavata', 'agle', 'agla', 'agli', 'આવતા', 'આવતી', 'આવતો', 'અગલે', 'अगले', 'अगली', 'अगला', 'आने']);
const THIS = N(['this', 'aa', 'આ', 'इस']);
const ANOTHER = N(['another', 'biju', 'bijo', 'biji', 'bije', 'beeju', 'બીજા', 'બીજી', 'બીજો', 'બીજું', 'दूसरे']);

const EVENING = N(['evening', 'sanje', 'sanj', 'saanje', 'saanj', 'sanjhe', 'sham', 'shaam', 'sandhya', 'સાંજે', 'સાંજ', 'शाम', 'शामको']);
const MORNING = N(['morning', 'savare', 'savar', 'sawar', 'subah', 'subha', 'sawere', 'સવારે', 'સવાર', 'सुबह', 'सवेरे']);
const AFTERNOON = N(['afternoon', 'bapore', 'bapor', 'dopahar', 'dopehar', 'બપોરે', 'બપોર', 'दोपहर']);
const NIGHT = N(['night', 'raate', 'raat', 'ratre', 'raatre', 'રાત્રે', 'રાતે', 'રાત', 'रात']);

const NUM_WORDS: Record<string, number> = Object.fromEntries(([
  [1, ['one', 'ek', 'એક', 'एक']], [2, ['two', 'bey', 'bae', 'do', 'બે', 'दो']], [3, ['three', 'tran', 'teen', 'ત્રણ', 'तीन']], [4, ['four', 'char', 'ચાર', 'चार']],
  [5, ['five', 'paanch', 'panch', 'pach', 'પાંચ', 'पांच', 'पाँच']], [6, ['six', 'chha', 'chhe', 'chah', 'છ', 'छह', 'छः', 'छे']], [7, ['seven', 'saat', 'sat7', 'સાત', 'सात']],
  [8, ['eight', 'aath', 'ath', 'આઠ', 'आठ']], [9, ['nine', 'nav', 'nau', 'નવ', 'नौ']], [10, ['ten', 'das', 'દસ', 'दस']], [11, ['eleven', 'agiyar', 'gyarah', 'અગિયાર', 'ग्यारह']], [12, ['twelve', 'baar', 'barah', 'બાર', 'बारह']],
] as [number, string[]][]).flatMap(([n, ws]) => N(ws).map((w) => [w, n])));

const HOUR_UNIT = N(['hour', 'hours', 'hr', 'hrs', 'kalak', 'kalaak', 'ghanta', 'ghante', 'ghanta', 'ghantay', 'કલાક', 'घंटे', 'घंटा', 'घण्टे', 'घण्टा', 'घन्टे']);
const MIN_UNIT = N(['minute', 'minutes', 'min', 'mins', 'minit', 'મિનિટ', 'मिनट']);
const CLOCK_MARK = N(['vagye', 'vage', 'vagya', 'baje', 'bje', "o'clock", 'oclock', 'વાગ્યે', 'વાગ્યા', 'વાગે', 'बजे']);
const AM = ['am', 'a.m'], PM = ['pm', 'p.m'];
const RANGE_WORD = N(['thi', 'thee', 'se', 'to', 'till', 'until', 'from', 'થી', 'से']);
const END_WORD = N(['tak', 'sudhi', 'sudi', 'સુધી', 'तक']);
const HALF_WORDS: Record<string, number> = Object.fromEntries([
  ...N(['dodh', 'dedh', 'દોઢ', 'डेढ़', 'डेढ']).map((w) => [w, 1.5]), ...N(['adhai', 'dhai', 'અઢી', 'ढाई']).map((w) => [w, 2.5]), ...N(['adho', 'adha', 'aadha', 'અડધો', 'અડધા', 'आधा', 'आधे']).map((w) => [w, 0.5]),
]);
const SAADE = N(['saade', 'sade', 'સાડા', 'साढ़े', 'साढे']), SAVA = N(['sava', 'સવા', 'सवा']), PAUNE = N(['paune', 'pona', 'પોણા', 'पौने']);

const ORDINALS: [number, string[]][] = [
  [1, N(['first', '1st', 'pehlu', 'pehla', 'pehlo', 'pehli', 'pahelu', 'pahela', 'pahlu', 'પહેલો', 'પહેલું', 'પહેલી', 'પહેલા', 'पहला', 'पहली'])],
  [2, N(['second', '2nd', 'biju', 'bijo', 'biji', 'bije', 'beeju', 'dusra', 'doosra', 'dusri', 'બીજો', 'બીજું', 'બીજી', 'दूसरा', 'दूसरी'])],
  [3, N(['third', '3rd', 'triju', 'trijo', 'triji', 'teesra', 'tisra', 'teesri', 'ત્રીજો', 'ત્રીજું', 'ત્રીજી', 'तीसरा', 'तीसरी'])],
  [-1, N(['last', 'chhelu', 'chhello', 'chello', 'chhelli', 'aakhri', 'akhri', 'antim', 'છેલ્લો', 'છેલ્લું', 'છેલ્લી', 'आखिरी', 'अंतिम', 'आख़िरी'])],
];
const OPTION_WORD = N(['option', 'vikalp', 'number', 'nambar', 'no', 'વિકલ્પ', 'નંબર', 'विकल्प', 'नंबर', 'नम्बर']);
const LATER = N(['later', 'late', 'modu', 'modo', 'modi', 'moda', 'der', 'baad', 'મોડું', 'મોડો', 'મોડી', 'મોડા', 'देर', 'बाद']);
const EARLIER = N(['earlier', 'early', 'vahelu', 'vahelo', 'vaheli', 'jaldi', 'વહેલું', 'વહેલો', 'વહેલી', 'વહેલા', 'जल्दी']);
const SHORTER = N(['shorter', 'short', 'tunku', 'tunko', 'ocha', 'kam', 'chhota', 'ટૂંકું', 'ટૂંકો', 'ટૂંકી', 'ઓછા', 'ઓછો', 'कम', 'छोटा', 'छोटी']);
const LONGER = N(['longer', 'long', 'lambu', 'lambo', 'vadhu', 'vadhare', 'zyada', 'jyada', 'lamba', 'લાંબું', 'લાંબો', 'લાંબી', 'વધુ', 'વધારે', 'ज्यादा', 'ज़्यादा', 'लंबा', 'लम्बा', 'अधिक']);
const CHEAPEST = N(['cheapest', 'cheap', 'lowest', 'sasto', 'sastu', 'saste', 'sasta', 'સસ્તો', 'સસ્તું', 'सस्ता', 'सस्ती']);
const PRICE_WORD = N(['price', 'prices', 'cost', 'rate', 'rates', 'charge', 'charges', 'fee', 'fees', 'bhav', 'bhaav', 'kimat', 'keemat', 'daam', 'dam', 'ભાવ', 'કિંમત', 'भाव', 'कीमत', 'दाम']);
const DEPOSIT_WORD = N(['deposit', 'advance', 'adv', 'agrim', 'એડવાન્સ', 'डिपॉजिट', 'डिपोजिट', 'एडवांस', 'अग्रिम', 'ડિપોઝિટ', 'ડિપોઝીટ', 'ડીપોઝિટ', 'ડિપૉઝિટ', 'ડિપોજિટ', 'depozit', 'advans']);
const CONFIRM = N(['ok', 'okay', 'yes', 'yep', 'confirm', 'haan', 'haa', 'han', 'ha', 'hoy', 'sure', 'theek', 'thik', 'barabar', 'બરાબર', 'હા', 'ઠીક', 'ચાલશે', 'हाँ', 'हां', 'ठीक', 'चलेगा']);

const NEGATE = N(['no', 'not', 'nope', 'na', 'nai', 'nahi', 'nahin', 'nathi', 'naa', 'નથી', 'ના', 'નહીં', 'નહિ', 'नहीं', 'नही', 'ना']);
const NEED = N(['joie', 'joiye', 'joi', 'joitu', 'joitun', 'chahiye', 'chahie', 'chahta', 'chahti', 'want', 'need', 'જોઈએ', 'જોઈતું', 'जोइए', 'चाहिए', 'चाहिये']);
const BOOKING_WORD = N(['book', 'booking', 'reserve', 'karo', 'karvu', 'karvanu', 'karna', 'કરો', 'કરવું', 'કરવા', 'करो', 'करना', 'करें']);
const AVAILABLE = N(['available', 'availability', 'avail', 'free', 'khali', 'khaali', 'ખાલી', 'खाली', 'malse', 'malshe', 'male', 'mali', 'milega', 'milegi', 'mil', 'upalabdh', 'મળશે', 'મળશો', 'મળે', 'મળી', 'મળતું', 'મળશ', 'मिलेगा', 'मिलेगी', 'मिलेगा', 'उपलब्ध']);
const ACCEPT = N(['chale', 'chalse', 'chalshe', 'chalega', 'chalegi', 'ok', 'okay', 'fine', 'acceptable', 'ચાલશે', 'ચાલે', 'चलेगा', 'चलेगी', 'चलेंगे']);
const ANY = N(['koi', 'koyi', 'kuch', 'any', 'game', 'gamey', 'कोई', 'कोइ', 'કોઈ', 'ગમે']);
const ANY2 = N(['pan', 'bhi', 'te', 'also', 'પણ', 'भी', 'तે']);

const PAY_WORD = N(['payment', 'paid', 'paisa', 'pay', 'paise', 'pese', 'peisa', 'rakam', 'amount', 'rashi', 'raashi', 'राशि', 'રકમ', 'रकम', 'પેમેન્ટ', 'પૈસા', 'ચુકવણી', 'ચૂકવણી', 'पेमेंट', 'पैसे', 'पैसा', 'भुगतान']);
const CLAIM_VERB = N(['kari', 'kar', 'kiya', 'kiye', 'diya', 'didhu', 'didhi', 'didho', 'karyu', 'karyo', 'karli', 'karlidhu', 'bhari', 'bhar', 'done', 'made', 'paid', 'sent', 'transferred', 'થઈ', 'કરી', 'કર્યું', 'કર્યો', 'દીધું', 'દીધુ', 'ભરી', 'ચૂકવી', 'ચુકવી', 'कर', 'किया', 'कि', 'कर दिया', 'दिया', 'भर', 'भेज']);
const BALANCE = N(['baki', 'baaki', 'bakee', 'balance', 'outstanding', 'due', 'pending', 'remaining', 'બાકી', 'बाकी', 'बकाया', 'status']);
// asking Guppi to DO something with money or a booking. None of these is ever carried out; each is answered with the same refusal in every language.
const ACT_VERB = N(['pay', 'confirm', 'confirmed', 'mark', 'settle', 'clear', 'approve', 'process', 'chukavo', 'chukavi', 'chukvo', 'chukvi', 'chukav', 'chukave', 'chukavu', 'chukavyo', 'bharo', 'bharvu', 'bharvanu', 'bhugtan', 'kanfarm', 'konfarm', 'ચૂકવો', 'ચુકવો', 'ચૂકવ', 'ચુકવ', 'ભરો', 'ભરવું', 'કન્ફર્મ', 'કંફર્મ', 'चुकाओ', 'चुकाइए', 'चुकाना', 'चुकाएं', 'भरो', 'भरना', 'कन्फर्म', 'कंफर्म', 'पुष्टि']);
const REQUEST_MARK = N(['do', 'dyo', 'dijiye', 'dijie', 'karo', 'kijiye', 'please', 'plz', 'pls', 'now', 'abhi', 'hamna', 'hamnaj', 'atyare', 'turant', 'jaldi', 'दो', 'दीजिए', 'दीजिये', 'करो', 'कीजिए', 'कीजिये', 'अभी', 'तुरंत', 'દો', 'દ્યો', 'કરો', 'હમણાં', 'હમણા', 'અત્યારે', 'કૃપા']);
const QUESTION_WORD = N(['ketla', 'ketlo', 'ketli', 'kitna', 'kitni', 'kitne', 'how', 'much', 'what', 'kya', 'શું', 'કેટલા', 'કેટલો', 'કેટલી', 'कितना', 'कितनी', 'कितने', 'क्या']);
const REFUND_WORD = N(['refund', 'refunds', 'refunded', 'rifund', 'refand', 'રિફંડ', 'રીફંડ', 'रिफंड', 'रीफंड']);
const BACK_WORD = N(['wapas', 'vapas', 'vaapas', 'pachha', 'pachhu', 'वापस', 'પાછા', 'પાછું']);
const CANCEL_WORD = N(['cancel', 'cancelled', 'canceled', 'cancelling', 'cancle', 'cancal', 'cancellation', 'radd', 'raddh', 'raddd', 'રદ', 'રદ્દ', 'रद्द', 'रद']);
const WAIVE = N(['maaf', 'maf', 'mafi', 'mafee', 'waive', 'waiver', 'waived', 'discount', 'concession', 'muft', 'માફ', 'મફત', 'माफ', 'माफ़', 'माफी', 'मुफ्त', 'छूट', 'chhut']);
// romanized markers used to tell Gujarati from Hindi when the text is in Latin letters
const GU_ROM = N(['vagye', 'vage', 'vagya', 'sanje', 'saanje', 'joie', 'joiye', 'malse', 'malshe', 'kalak', 'kalaak', 'mate', 'che', 'chhe', 'nathi', 'chale', 'chalse', 'bhade', 'bhaade', 'biju', 'bijo', 'batavo', 'bataavo', 'ketla', 'didhu', 'savare', 'bapore', 'raate', 'aavta', 'avta', 'aje', 'kale', 'valu', 'nu', 'thi', 'sudhi', 'maaf', 'kari', 'karvu', 'mane', 'karo', 'mari', 'maru', 'mara', 'hamna', 'hamnaj', 'atyare', 'chukavi', 'chukavo', 'chukvi', 'chukvo', 'ahithi']);
const HI_ROM = N(['baje', 'bje', 'shaam', 'sham', 'ghante', 'ghanta', 'chahiye', 'chahie', 'karo', 'kijiye', 'ke', 'liye', 'kitna', 'baaki', 'hai', 'hain', 'nahi', 'nahin', 'milega', 'milegi', 'diya', 'maine', 'subah', 'dopahar', 'raat', 'aaj', 'chalega', 'dijiye', 'dusra', 'doosra', 'pehla', 'ko', 'se', 'tak', 'bhi', 'agle', 'mujhe', 'kar', 'meri', 'mera', 'mere', 'abhi', 'bhugtan']);
const EN_ROM = N(['hours', 'hour', 'evening', 'morning', 'next', 'this', 'upcoming', 'another', 'today', 'tomorrow', 'book', 'available', 'please', 'want', 'need', 'from', 'for', 'the', 'is', 'have', 'made', 'pm', 'am', 'sunday', 'monday', 'saturday', 'friday', 'second', 'first', 'option', 'night', 'afternoon', 'yes', 'ok', 'okay', 'price', 'balance', 'cheapest']);

const numberOf = (tok: string | undefined): number | null => {
  if (tok === undefined) return null;
  if (/^\d{1,2}$/.test(tok)) return Number(tok);
  return NUM_WORDS[tok] ?? null;
};
const decimalOf = (tok: string | undefined): number | null => {
  if (tok === undefined) return null;
  if (/^\d{1,2}(\.\d)?$/.test(tok)) return Number(tok);
  return NUM_WORDS[tok] ?? HALF_WORDS[tok] ?? null;
};
const ORD_SUFFIX = new Set(['st', 'nd', 'rd', 'th']);
const pad = (n: number): string => String(n).padStart(2, '0');
const hhmm = (h: number, m: number): string => `${pad(h)}:${pad(m)}`;
const mins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMins = (m: number): string => hhmm(Math.floor(((m % 1440) + 1440) % 1440 / 60), ((m % 60) + 60) % 60);

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;

/** Day and month with no year: the next time that day comes round, today included. */
function nextOccurrence(today: string, month: number, day: number): string | null {
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1, y + 2, y + 3, y + 4]) {
    if (day > daysIn(yy, month)) continue; // 29 Feb in a common year
    const d = ymd(yy, month, day);
    if (d >= today) return d;
  }
  return null;
}

export function scriptCounts(s: string): { latin: number; gu: number; hi: number } {
  return { latin: (s.match(/[A-Za-z]/g) ?? []).length, gu: (s.match(/[઀-૿]/g) ?? []).length, hi: (s.match(/[ऀ-ॿ]/g) ?? []).length };
}

function tokenize(text: string): string[] {
  let s = plainDigits(nfc(text)).toLowerCase();
  s = s.replace(/day after tomorrow/g, 'parso').replace(/પરમ દિવસે/g, 'પરમદિવસે');
  s = s.replace(/[।॥?!,;()"“”‘’]/g, ' ');
  s = s.replace(/(\d)(?=\p{L})/gu, '$1 ').replace(/(\p{L})(?=\d)/gu, '$1 ');
  return s.split(/\s+/).map((t) => t.replace(/^[.'\-]+|[.'\-]+$/g, '')).filter(Boolean);
}

const kindOf = (l: Lang): InputKind => (l === 'gu' ? 'gujarati' : l === 'hi' ? 'hindi' : l === 'gu-Latn' ? 'romanized-gujarati' : l === 'hi-Latn' ? 'romanized-hindi' : 'english');
export function languageOf(text: string, prior?: Lang): { inputKind: InputKind; language: Lang } {
  const c = scriptCounts(text);
  const tk = tokenize(text);
  const indic = c.gu + c.hi > 0;
  const guHits = tk.filter((t) => ASCII.test(t) && GU_ROM.includes(t)).length, hiHits = tk.filter((t) => ASCII.test(t) && HI_ROM.includes(t)).length;
  const enHits = tk.filter((t) => ASCII.test(t) && EN_ROM.includes(t)).length;
  if (indic) {
    const language: Lang = c.gu >= c.hi ? 'gu' : 'hi';
    const inputKind: InputKind = c.gu > 0 && c.hi > 0 ? 'mixed' : c.latin > 0 ? 'mixed' : language === 'gu' ? 'gujarati' : 'hindi';
    return { inputKind, language };
  }
  // a short reply that says nothing about its language (an option number, "pehlo vikalp") or a word both languages share ("haa", "karo") keeps the language the conversation is in
  const romanPrior = prior === 'gu-Latn' || prior === 'hi-Latn' || prior === 'gu' || prior === 'hi';
  if (guHits === 0 && hiHits === 0) return enHits === 0 && prior && tk.length > 0 ? { inputKind: kindOf(prior), language: prior } : { inputKind: 'english', language: 'en' };
  const language: Lang = guHits === hiHits && romanPrior ? (prior === 'gu' || prior === 'gu-Latn' ? 'gu-Latn' : 'hi-Latn') : guHits >= hiHits ? 'gu-Latn' : 'hi-Latn';
  return { inputKind: enHits > 0 ? 'mixed' : language === 'gu-Latn' ? 'romanized-gujarati' : 'romanized-hindi', language };
}

// ---- the time of day
const half = (h: number, minute: number, which: 0 | 12): string => hhmm(h % 12 + which, minute);

/** The times a clock reading can mean, given the part of the day if the person named one. One entry is a settled time; two entries are a genuine "morning or evening?". */
export function clockCandidates(c: RawClock, period: Period | null): string[] {
  const { h, minute, mark } = c;
  if (h < 0 || h > 23 || minute < 0 || minute > 59) return [];
  if (mark === 'pm') return h <= 12 ? [half(h, minute, 12)] : [hhmm(h, minute)];
  if (mark === 'am') return h <= 12 ? [half(h, minute, 0)] : [hhmm(h, minute)];
  if (mark === '24' || h >= 13 || h === 0) return [hhmm(h, minute)];
  if (period === 'evening' && h >= 4 && h <= 11) return [half(h, minute, 12)];
  if (period === 'morning' && h >= 5 && h <= 11) return [hhmm(h, minute)];
  if (period === 'afternoon' && h === 12) return [hhmm(12, minute)];
  if (period === 'afternoon' && h >= 1 && h <= 6) return [half(h, minute, 12)];
  if (period === 'night' && h >= 7 && h <= 11) return [half(h, minute, 12)];
  return h === 12 ? [hhmm(12, minute), hhmm(0, minute)] : [hhmm(h, minute), half(h, minute, 12)];
}

export interface ClockResult { startTime?: string; endTime?: string; durationMinutes?: number; issue?: Issue & { choices?: Choice[] } }

function settleEnd(start: string, end: RawClock): { endTime: string; durationMinutes: number } | null {
  const cands = clockCandidates(end, null);
  let best: { t: string; d: number } | null = null;
  for (const t of cands) {
    const d = (((mins(t) - mins(start)) % 1440) + 1440) % 1440;
    if (d > 0 && (!best || d < best.d)) best = { t, d };
  }
  return best ? { endTime: best.t, durationMinutes: best.d } : null;
}

/**
 * Settles a start (and optional end) from raw clock readings. `ctxStart` is the start time already in the conversation: when an hour could be morning or evening,
 * the part of the day the conversation was already in is used ("7 nai 8 vagye" after 7 PM means 8 PM). With no context the person is asked.
 */
export function settleClock(start: RawClock, end: RawClock | undefined, period: Period | null, ctxStart?: string): ClockResult {
  let sc = clockCandidates(start, period);
  if (!sc.length) return { issue: { reason: 'invalid' } };
  if (sc.length === 2 && ctxStart) {
    const pm = mins(ctxStart) >= 720;
    const pick = sc.find((t) => (mins(t) >= 720) === pm);
    if (pick) sc = [pick];
  }
  const out = (s: string): ClockResult => {
    if (!end) return { startTime: s };
    const e = settleEnd(s, end);
    return e ? { startTime: s, endTime: e.endTime, durationMinutes: e.durationMinutes } : { issue: { reason: 'invalid' } };
  };
  if (sc.length === 1) return out(sc[0]!);
  return { issue: { reason: 'ambiguous', candidates: sc, choices: sc.map((s) => { const r = out(s); return { startTime: s, ...(r.endTime ? { endTime: r.endTime, durationMinutes: r.durationMinutes } : {}) }; }) } };
}

function finish(year: number | null, month: number, day: number, today: string, at: number[]): { date?: string; issue?: Issue; at: number[] } {
  if (month < 1 || month > 12 || day < 1) return { issue: { reason: 'invalid' }, at };
  if (year === null) {
    const d = nextOccurrence(today, month, day);
    return d ? { date: d, at } : { issue: { reason: 'invalid' }, at };
  }
  if (day > daysIn(year, month)) return { issue: { reason: 'invalid' }, at };
  const d = ymd(year, month, day);
  return d < today ? { issue: { reason: 'past', candidates: [d] }, at } : { date: d, at };
}

/**
 * The relative-day rule (proposed, see UD-08). A weekday named alone is the first one after today; said on that very weekday it is asked (today or next week).
 * "this" / "aa" is the one in the current week: today when today is that weekday. "next", "upcoming", "coming", "aavta", "agle" is the first one after today
 * (so a week from today when today is that weekday). "another" / "biju" is the one a week after the day already being discussed.
 */
function weekdayDate(today: string, wd: number, mod: 'none' | 'this' | 'upcoming'): { date?: string; issue?: Issue & { choices?: Choice[] } } {
  const diff = (wd - dayOfWeek(today) + 7) % 7;
  if (diff === 0) {
    if (mod === 'upcoming') return { date: addDays(today, 7) };
    if (mod === 'this') return { date: today };
    const c = [today, addDays(today, 7)];
    return { issue: { reason: 'ambiguous', candidates: c, choices: c.map((date) => ({ date })) } };
  }
  return { date: addDays(today, diff) };
}

export function parseBooking(text: string, today: string, ctx: { startTime?: string; date?: string; lang?: Lang } = {}): Parsed {
  const raw = nfc(text);
  const lang = languageOf(raw, ctx.lang);
  const tk = tokenize(raw);
  const used = new Array<boolean>(tk.length).fill(false);
  const use = (...ix: number[]): void => { for (const i of ix) if (i >= 0 && i < tk.length) used[i] = true; };
  const out: Parsed = { ...lang, words: [], period: null, select: {}, flags: { reject: false, waiver: false, payClaim: false, payStatus: false, asksAvailability: false, correction: false, askPrice: false, askDeposit: false, sameDay: false, bookWord: false, payAct: false, refund: false, change: false } };

  // ---- the length(s): "3 hours", "૩ કલાક", "3 घंटे", "3 kalak", "દોઢ કલાક", "90 minutes"
  const durations: number[] = [];
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]!;
    const next = tk[i + 1];
    const isHour = next !== undefined && inList(next, HOUR_UNIT), isMin = next !== undefined && inList(next, MIN_UNIT);
    if (!isHour && !isMin) continue;
    const n = decimalOf(t);
    if (n === null) continue;
    durations.push(isHour ? Math.round(n * 60) : Math.round(n));
    use(i, i + 1);
  }
  const accepts = has(tk, ACCEPT);
  if (durations.length === 1) out.durationMinutes = durations[0];
  else if (durations.length >= 2) {
    const [a, b] = durations as [number, number];
    if (durations.length === 2 && accepts && b < a) { out.durationMinutes = a; out.minDurationMinutes = b; }
    else if (durations.every((d) => d === a)) out.durationMinutes = a;
    else out.durationIssue = { reason: 'ambiguous', candidates: durations.map(String) };
  }

  // ---- the day
  const dayOfNumber = (i: number): number | null => {
    const t = tk[i];
    if (t === undefined || used[i] || !/^\d{1,2}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= 31 ? n : null;
  };
  const found: { date?: string; issue?: Issue & { choices?: Choice[] }; at: number[]; pos?: number }[] = [];
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]!;
    if (used[i]) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { found.push(isValidDate(t) ? { date: t, at: [i] } : { issue: { reason: 'invalid' }, at: [i] }); continue; }
    const m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(t);
    if (m && (m[3] || t.includes('/'))) {
      const a = Number(m[1]), b = Number(m[2]);
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      if (a > 12 && b <= 12) found.push(finish(year, b, a, today, [i]));
      else if (b > 12 && a <= 12) found.push(finish(year, a, b, today, [i]));
      else if (a === b && a <= 12) found.push(finish(year, b, a, today, [i]));
      else if (a <= 12 && b <= 12) {
        const x = finish(year, b, a, today, [i]), y = finish(year, a, b, today, [i]);
        const c = [x.date, y.date].filter((d): d is string => !!d);
        found.push({ issue: { reason: 'ambiguous', candidates: c, choices: c.map((date) => ({ date })) }, at: [i] });
      } else found.push({ issue: { reason: 'invalid' }, at: [i] });
      continue;
    }
    const mi = MONTHS.findIndex((names) => inList(t, names));
    if (mi >= 0) {
      // a month name counts only beside a day number ("4 Jan", "Jan 4th"): "may" and "મે" are ordinary words otherwise
      let dayIx = -1;
      for (const j of [i - 1, i + 1]) {
        if (dayOfNumber(j) !== null) { dayIx = j; break; }
        if (ORD_SUFFIX.has(tk[j] ?? '') && dayOfNumber(j - 1) !== null && j > i) { dayIx = j - 1; break; }
      }
      if (dayIx < 0) continue;
      const yearIx = [i + 1, i + 2, dayIx + 1].find((j) => /^20\d{2}$/.test(tk[j] ?? '') && !used[j]);
      const at = [i, dayIx, ...(yearIx !== undefined ? [yearIx] : []), ...(ORD_SUFFIX.has(tk[dayIx + 1] ?? '') ? [dayIx + 1] : [])];
      found.push(finish(yearIx !== undefined ? Number(tk[yearIx]) : null, mi + 1, dayOfNumber(dayIx)!, today, at));
      continue;
    }
    if (TODAY.includes(t)) { found.push({ date: today, at: [i] }); continue; }
    if (TOMORROW.includes(t)) { found.push({ date: addDays(today, 1), at: [i] }); continue; }
    if (DAY_AFTER.includes(t)) { found.push({ date: addDays(today, 2), at: [i] }); continue; }
    const wd = WEEKDAYS.findIndex((names) => inList(t, names));
    if (wd >= 0) {
      const prev = tk[i - 1];
      const at = [i];
      let mod: 'none' | 'this' | 'upcoming' | 'another' = 'none';
      if (prev !== undefined && !used[i - 1]) {
        if (inList(prev, ANOTHER)) mod = 'another';
        else if (inList(prev, UPCOMING)) mod = 'upcoming';
        else if (THIS.includes(prev) || inList(prev, THIS)) mod = 'this';
        if (mod !== 'none') at.push(i - 1);
      }
      if (mod === 'another') { out.anotherWeekday = wd; found.push({ at }); } else found.push({ ...weekdayDate(today, wd, mod === 'upcoming' ? 'upcoming' : mod === 'this' ? 'this' : 'none'), at, pos: i });
    }
  }
  if (found.length) {
    // "aa ravivaar nahi, aavta ravivaar": a day named before a "not" is the one being corrected away from
    const lastNeg = tk.reduce((acc, t, i) => (inList(t, NEGATE) ? i : acc), -1);
    for (const c of found) use(...c.at);
    if (lastNeg >= 0 && found.some((c) => Math.min(...c.at) > lastNeg)) found.splice(0, found.length, ...found.filter((c) => Math.min(...c.at) > lastNeg));
    const dates = new Set(found.filter((c) => c.date).map((c) => c.date!));
    const issue = found.find((c) => c.issue);
    if (dates.size > 1) { const c = [...dates]; out.dateIssue = { reason: 'ambiguous', candidates: c, choices: c.map((date) => ({ date })) }; }
    else if (issue && !dates.size) out.dateIssue = issue.issue;
    else if (dates.size === 1) out.date = [...dates][0];
  }
  if (!out.date && !out.dateIssue && out.anotherWeekday === undefined) {
    // a day number with no month ("the 4th") is never guessed
    const orphan = tk.findIndex((_, i) => !used[i] && ORD_SUFFIX.has(tk[i + 1] ?? '') && dayOfNumber(i) !== null);
    if (orphan >= 0) { out.dateIssue = { reason: 'ambiguous' }; use(orphan, orphan + 1); }
  }

  // ---- the time of day: a start, and an end when the person gave a range ("7 thi 10", "7pm thi 10pm", "saat thi das")
  out.period = has(tk, EVENING) ? 'evening' : has(tk, MORNING) ? 'morning' : has(tk, AFTERNOON) ? 'afternoon' : has(tk, NIGHT) ? 'night' : null;
  interface Clk { raw: RawClock; at: number[]; end: number; marked: boolean }
  const clockAt = (i: number, plainOk: boolean): Clk | null => {
    if (i >= tk.length || used[i]) return null;
    const t = tk[i]!;
    const range = /^(\d{1,2})-(\d{1,2})$/.exec(t);
    if (range) return null; // handled below
    let h: number, minute = 0, explicit = false;
    const colon = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (colon) { h = Number(colon[1]); minute = Number(colon[2]); explicit = true; if (h > 23 || minute > 59) return null; }
    else { const n = numberOf(t); if (n === null) return null; h = n; }
    const nx = tk[i + 1];
    let mark: RawClock['mark'] = null, end = i + 1, marked = false;
    if (nx !== undefined && !used[i + 1]) {
      if (AM.includes(nx)) { mark = 'am'; marked = true; end = i + 2; }
      else if (PM.includes(nx)) { mark = 'pm'; marked = true; end = i + 2; }
      else if (inList(nx, CLOCK_MARK)) { marked = true; end = i + 2; }
    }
    if (!marked && !plainOk && !explicit) return null;
    if (h > 23) return null;
    const at = [i]; for (let k = i + 1; k < end; k++) at.push(k);
    if (mark === null && (h >= 13 || (explicit && colon && /^0\d$/.test(colon[1]!) === false && h >= 13))) mark = '24';
    // "સાડા સાત", "साढ़े सात" (half past), "સવા" (quarter past), "પોણા" (quarter to)
    const before = tk[i - 1];
    if (before !== undefined && !used[i - 1] && !explicit) {
      if (SAADE.includes(before)) { minute = 30; at.push(i - 1); }
      else if (SAVA.includes(before)) { minute = 15; at.push(i - 1); }
      else if (PAUNE.includes(before)) { minute = 45; h = Math.max(h - 1, 0); at.push(i - 1); }
    }
    return { raw: { h, minute, mark }, at, end, marked };
  };
  let startClk: Clk | null = null, endClk: Clk | null = null;
  // 1) a range word between two readings
  for (let i = 0; i < tk.length && !startClk; i++) {
    const dash = /^(\d{1,2})-(\d{1,2})$/.exec(tk[i] ?? '');
    if (dash && !used[i] && Number(dash[1]) <= 23 && Number(dash[2]) <= 23) {
      startClk = { raw: { h: Number(dash[1]), minute: 0, mark: Number(dash[1]) >= 13 ? '24' : null }, at: [i], end: i + 1, marked: false };
      endClk = { raw: { h: Number(dash[2]), minute: 0, mark: Number(dash[2]) >= 13 ? '24' : null }, at: [], end: i + 1, marked: false };
      break;
    }
    const a = clockAt(i, true);
    if (!a) continue;
    let j = a.end;
    const hasRange = tk[j] !== undefined && !used[j] && inList(tk[j]!, RANGE_WORD);
    const markerThi = a.marked && /થી$|से$|thi$/.test(tk[a.end - 1] ?? '');
    if (hasRange) j++;
    const b = (hasRange || markerThi) ? clockAt(j, true) : null;
    const endWord = b && tk[b.end] !== undefined && inList(tk[b.end]!, END_WORD);
    if (b && (hasRange || endWord)) { startClk = a; endClk = b; if (endWord) b.at.push(b.end); if (hasRange) startClk.at.push(a.end); }
  }
  // 2) a single reading with a clock marker (or with a part of the day beside it)
  if (!startClk) {
    for (let i = 0; i < tk.length && !startClk; i++) {
      const a = clockAt(i, false);
      if (a) startClk = a;
    }
  }
  if (!startClk && out.period) {
    const free = tk.map((t, i) => ({ t, i })).filter(({ t, i }) => !used[i] && /^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 12);
    if (free.length === 1) startClk = { raw: { h: Number(free[0]!.t), minute: 0, mark: null }, at: [free[0]!.i], end: free[0]!.i + 1, marked: false };
  }
  if (startClk) {
    use(...startClk.at); if (endClk) use(...endClk.at);
    const r = settleClock(startClk.raw, endClk?.raw, out.period, ctx.startTime);
    if (r.startTime) out.startTime = r.startTime;
    if (r.endTime) out.endTime = r.endTime;
    if (r.durationMinutes !== undefined) {
      if (out.durationMinutes !== undefined && out.durationMinutes !== r.durationMinutes) out.durationIssue = { reason: 'ambiguous', candidates: [String(out.durationMinutes), String(r.durationMinutes)] };
      else out.durationMinutes = r.durationMinutes;
    }
    if (r.issue) {
      out.timeIssue = r.issue;
      if (r.issue.reason === 'ambiguous') out.pending = { start: startClk.raw, ...(endClk ? { end: endClk.raw } : {}) };
    }
  } else if (out.period) {
    out.timeIssue = { reason: 'ambiguous' }; // "evening" alone is not a time
  }

  // ---- choosing among options already shown
  const sel = out.select;
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]!;
    if (used[i]) continue;
    for (const [idx, names] of ORDINALS) if (inList(t, names)) { sel.index = idx; use(i); }
  }
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]!;
    if (used[i]) continue;
    if (OPTION_WORD.includes(t) || /^#\d{1,2}$/.test(t)) {
      const m = /^#(\d{1,2})$/.exec(t);
      const after = m ? Number(m[1]) : numberOf(tk[i + 1]);
      const before = i > 0 && !used[i - 1] ? numberOf(tk[i - 1]) : null;
      const n = after ?? before;
      if (n !== null && n >= 1 && n <= 10) { sel.index = n; use(i, ...(m ? [] : after !== null ? [i + 1] : [i - 1])); }
    }
  }
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]!;
    if (used[i]) continue;
    if (inList(t, LATER)) sel.relative = 'later';
    else if (inList(t, EARLIER)) sel.relative = 'earlier';
    else if (inList(t, SHORTER)) sel.relative = 'shorter';
    else if (inList(t, LONGER)) sel.relative = 'longer';
    else if (inList(t, CHEAPEST)) sel.relative = 'cheapest';
    else if (CONFIRM.includes(t) && !accepts) sel.confirm = true;
    else continue;
    use(i);
  }

  const anyBooking = out.date !== undefined || out.dateIssue !== undefined || out.startTime !== undefined || out.timeIssue !== undefined || out.durationMinutes !== undefined || out.durationIssue !== undefined || out.anotherWeekday !== undefined;
  // a bare number ("2") with nothing else to read is an option number
  if (sel.index === undefined && !anyBooking) {
    const only = tk.filter((_, i) => !used[i]);
    if (only.length === 1 && /^\d{1,2}$/.test(only[0]!) && Number(only[0]) >= 1) { sel.index = Number(only[0]); use(tk.findIndex((_, i) => !used[i])); }
  }

  // ---- "any ground will do": "koi pan", "any ground", "કોઈ પણ", "कोई भी"
  for (let i = 0; i < tk.length; i++) {
    if (inList(tk[i]!, ANY) && tk[i + 1] !== undefined && inList(tk[i + 1]!, ANY2) || (tk[i] === 'any' && tk[i + 1] !== undefined)) { out.anyGround = true; use(i, i + 1); }
  }

  // ---- plain flags
  const anyTok = (list: string[]): boolean => has(tk, list);
  out.flags.waiver = anyTok(WAIVE);
  const asksQuestion = raw.includes('?') || anyTok(QUESTION_WORD);
  out.flags.refund = !out.flags.waiver && (anyTok(REFUND_WORD) || (anyTok(BACK_WORD) && anyTok(PAY_WORD)));
  out.flags.change = !out.flags.waiver && !out.flags.refund && anyTok(CANCEL_WORD);
  // "pay my balance", "payment confirm karo", "mark it paid": the person wants Guppi to act on money. A question about an amount ("ketla paisa baki che?") is only a question.
  out.flags.payAct = !out.flags.waiver && !out.flags.refund && !out.flags.change && !asksQuestion && (anyTok(PAY_WORD) || anyTok(BALANCE) || anyTok(DEPOSIT_WORD)) && (anyTok(ACT_VERB) || (anyTok(CLAIM_VERB) && anyTok(REQUEST_MARK)));
  const moneyAction = out.flags.payAct || out.flags.refund || out.flags.change;
  out.flags.payClaim = !out.flags.waiver && !moneyAction && anyTok(PAY_WORD) && anyTok(CLAIM_VERB) && !anyTok(BALANCE);
  out.flags.payStatus = !out.flags.waiver && !moneyAction && !out.flags.payClaim && anyTok(BALANCE);
  out.flags.asksAvailability = anyTok(AVAILABLE) || (raw.includes('?') && !(anyTok(BOOKING_WORD) || anyTok(NEED)));
  out.flags.correction = tk.some((t, i) => inList(t, NEGATE) && ASCII.test(t) === ASCII.test(t) && numberOf(tk[i - 1]) !== null && tk.slice(i + 1, i + 3).some((x) => numberOf(x) !== null));
  out.flags.askDeposit = !out.flags.waiver && anyTok(DEPOSIT_WORD);
  out.flags.askPrice = !out.flags.waiver && !out.flags.payClaim && !out.flags.payStatus && anyTok(PRICE_WORD);
  out.flags.bookWord = anyTok(BOOKING_WORD) || anyTok(NEED);
  out.flags.sameDay = tk.some((t, i) => (t === 'usi' && tk[i + 1] === 'din') || (t === 'same' && tk[i + 1] === 'day') || (t === nfc('उसी') && tk[i + 1] === 'दिन') || (t === 'તે' && tk[i + 1] === 'જ' && tk[i + 2]?.startsWith('દિવસ')) || (t === 'e' && tk[i + 1] === 'j' && tk[i + 2]?.startsWith('divas')));
  const negated = anyTok(NEGATE), needs = anyTok(NEED);
  out.flags.reject = negated && needs && !anyBooking && !out.flags.waiver;
  if (out.flags.reject) { /* "na aa nathi joie": nothing else is read from this message */ sel.index = undefined; }

  out.words = tk.filter((_, i) => !used[i]);
  return out;
}

// ---- which ground was meant: matched by what the ground is called, in any of the three scripts
const GROUND_CONCEPTS: Record<string, string[]> = {
  ground: N(['ground', 'grounds', 'groud', 'ગ્રાઉન્ડ', 'ગ્રાઉંડ', 'ग्राउंड', 'ग्राउन्ड', 'मैदान', 'મેદાન', 'maidan', 'medan']),
  nets: N(['net', 'nets', 'નેટ', 'નેટ્સ', 'नेट', 'नेट्स']),
  practice: N(['practice', 'પ્રેક્ટિસ', 'प्रैक्टिस', 'प्रेक्टिस']),
  box: N(['box', 'બોક્સ', 'बॉक्स', 'बाक्स']),
  cricket: N(['cricket', 'ક્રિકેટ', 'क्रिकेट']),
};
const conceptsOf = (words: string[]): Set<string> => {
  const out = new Set<string>();
  for (const w of words) for (const [c, names] of Object.entries(GROUND_CONCEPTS)) if (names.includes(w) || inList(w, names)) out.add(c);
  return out;
};

/** The kind of place a ground is: practice nets are a different kind from a match ground. */
export function groundKind(name: string): 'nets' | 'ground' {
  const c = conceptsOf(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return c.has('nets') || c.has('practice') ? 'nets' : 'ground';
}
export function wantsKind(words: string[]): 'nets' | 'ground' | null {
  const c = conceptsOf(words);
  return c.has('nets') || c.has('practice') ? 'nets' : c.size ? 'ground' : null;
}

/** Grounds whose name best matches the words left over; empty when the words name none. */
export function matchGrounds<T extends { id: string; name: string }>(words: string[], grounds: T[]): T[] {
  const want = conceptsOf(words);
  const wordSet = new Set(words);
  let best = 0;
  const scored = grounds.map((g) => {
    const nameWords = g.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const score = [...conceptsOf(nameWords)].filter((c) => want.has(c)).length + nameWords.filter((w) => !Object.values(GROUND_CONCEPTS).some((ns) => ns.includes(w)) && wordSet.has(w)).length * 2;
    best = Math.max(best, score);
    return { g, score };
  });
  return best === 0 ? [] : scored.filter((s) => s.score === best).map((s) => s.g);
}

/** For tests and diagnostics. */
export const _internals = { tokenize, lev1, mins, fromMins };
