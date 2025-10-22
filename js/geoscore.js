import { apiFetch } from './apiClient.js';

const STORAGE_KEY = 'geoscoreQuestions';
const ANSWER_OVERRIDES_KEY = 'geoscoreAnswerOverrides';
const ANSWER_WEIGHT_OVERRIDES_KEY = 'geoscoreAnswerWeightOverrides';
const EXCLUSIONS_KEY = 'geoscoreExclusions'; // { CategoryName: { normalizedName: true } }

function clampMetric(val, max = 100) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > max) return max;
  return num;
}

function normalizeAnswerMetrics(list, { maxScore = 100 } = {}) {
  if (!Array.isArray(list)) return;
  for (const q of list) {
    if (!q || !Array.isArray(q.answers)) continue;
    for (const a of q.answers) {
      if (!a || typeof a !== 'object') continue;
      if ('score' in a) a.score = clampMetric(a.score, maxScore);
      if ('count' in a) a.count = clampMetric(a.count, maxScore);
    }
  }
}

// Discard algorithmic weighting: we no longer normalize scores globally.
function normalizeAllQuestions(list){ /* no-op by design */ }

function generateCountryLetterQuestions(){
  const countries = [
    'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan',
    'Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi',
    'Cambodia','Cameroon','Canada','Cape Verde','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo (Congo-Brazzaville)','Costa Rica','Côte d\'Ivoire','Croatia','Cuba','Cyprus','Czechia',
    'Democratic Republic of the Congo','Denmark','Djibouti','Dominica','Dominican Republic',
    'Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia',
    'Fiji','Finland','France',
    'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana',
    'Haiti','Honduras','Hungary',
    'Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
    'Jamaica','Japan','Jordan',
    'Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan',
    'Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg',
    'Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
    'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway',
    'Oman',
    'Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal',
    'Qatar',
    'Romania','Russia','Rwanda',
    'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria',
    'Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu',
    'Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan',
    'Vanuatu','Vatican City','Venezuela','Vietnam',
    'Yemen',
    'Zambia','Zimbabwe'
  ];
  const byLetter = {};
  countries.forEach(c => {
    const letter = c[0].toUpperCase();
    if(!byLetter[letter]) byLetter[letter] = [];
    byLetter[letter].push(c);
  });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const questions = [];
  for(const letter of letters){
    const list = (byLetter[letter] || []).sort();
    const answers = list.map((name)=>({ answer: name, score: 0, count: 0 }));
    if(!answers.length){ answers.push({ answer: 'None', score: 0, count: 0 }); }
    while(answers.length < 5){ answers.push({ answer: 'None', score: 0, count: 0 }); }
    questions.push({ question: `Name a country that starts with ${letter}`, answers });
  }
  return questions;
}

function generateCapitalLetterQuestions(){
  const capitals = [
    'Abu Dhabi','Abuja','Accra','Addis Ababa','Algiers','Amman','Amsterdam','Ankara','Antananarivo','Apia','Ashgabat','Asmara','Astana','Asuncion','Athens',
    'Bangkok','Beijing','Beirut','Belgrade','Belmopan','Berlin','Bern','Bishkek','Bissau','Bogota','Brasilia','Bratislava','Brazzaville','Bridgetown','Brussels','Bucharest','Budapest','Buenos Aires','Bujumbura',
    'Cairo','Canberra','Caracas','Castries','Cayenne','Charlotte Amalie','Chisinau','Conakry','Copenhagen',
    'Damascus','Dhaka','Dili','Djibouti','Dodoma','Doha','Dublin','Dushanbe',
    'Gaborone','George Town','Georgetown','Gitega','Guatemala City','Gustavia',
    'Hanoi','Harare','Havana','Helsinki','Honiara',
    'Kabul','Kampala','Kathmandu','Khartoum','Kigali','Kingston','Kingstown','Kinshasa','Kuala Lumpur','Kuwait City',
    'La Paz','Libreville','Lilongwe','Lima','Lisbon','Ljubljana','Lomé','London','Luxembourg','Lusaka',
    'Madrid','Majuro','Malabo','Male','Managua','Manila','Maputo','Maseru','Mbabane','Mexico City','Minsk','Mogadishu','Monaco','Monrovia','Montevideo','Moroni','Moscow','Muscat',
    'Nairobi','Nassau','Naypyidaw','Ngerulmud','Niamey','Nicosia','Nouakchott','Noumea','Nuku\'alofa','Nuuk',
    'Panama City','Paramaribo','Paris','Phnom Penh','Podgorica','Port-au-Prince','Port Louis','Port Moresby','Porto-Novo','Prague','Praia','Pretoria','Pristina','Pyongyang','Palikir',
    'Rabat','Reykjavik','Riga','Riyadh','Rome','Roseau',
    'San Jose','San Marino','San Salvador','Sana\'a','Santiago','Santo Domingo','Sao Tome','Sarajevo','Seoul','Singapore','Skopje','Sofia','South Tarawa','Sri Jayawardenepura Kotte','Stockholm','Sucre','Suva',
    'Tallinn','Tashkent','Tbilisi','Tegucigalpa','Tehran','Thimphu','Tirana','Tokyo','Tripoli','Tunis','Torshavn','Taipei',
    'Vaduz','Valletta','Vatican City','Victoria','Vienna','Vientiane','Vilnius',
    'Warsaw','Washington','Wellington','West Island','Willemstad','Windhoek',
    // Added to complete set
    'Andorra la Vella','Baghdad','Baku','Bamako','Bandar Seri Begawan','Bangui','Banjul','Basseterre','Freetown','Funafuti',
    'Islamabad','Jakarta','Jerusalem','Juba','Luanda','N\'Djamena','Oslo','Ottawa','Ouagadougou','Papeete',
    'Port of Spain','Port Vila','Quito','Saint George\'s','Saint John\'s','Ulaanbaatar','Yamoussoukro','Yaounde','Yerevan','Zagreb'
  ];
  const byLetter = {};
  capitals.forEach(c => {
    const letter = c[0].toUpperCase();
    if(!byLetter[letter]) byLetter[letter] = [];
    byLetter[letter].push(c);
  });
  const questions = [];
  for(const [letter, list] of Object.entries(byLetter)){
    const sorted = list.sort();
    if(sorted.length >= 5){
      const answers = sorted.map((name)=>({ answer: name, score: 0, count: 0 }));
      questions.push({ question: `Name a world capital city beginning with the letter ${letter}`, answers });
    }
  }
  return questions;
}

// --- Capitals ending with a given letter ---
function generateCapitalEndingQuestions(){
  const capitals = [
    'Abu Dhabi','Abuja','Accra','Addis Ababa','Algiers','Amman','Amsterdam','Ankara','Antananarivo','Apia','Ashgabat','Asmara','Astana','Asuncion','Athens',
    'Bangkok','Beijing','Beirut','Belgrade','Belmopan','Berlin','Bern','Bishkek','Bissau','Bogota','Brasilia','Bratislava','Brazzaville','Bridgetown','Brussels','Bucharest','Budapest','Buenos Aires','Bujumbura',
    'Cairo','Canberra','Caracas','Castries','Cayenne','Charlotte Amalie','Chisinau','Conakry','Copenhagen',
    'Damascus','Dhaka','Dili','Djibouti','Dodoma','Doha','Dublin','Dushanbe',
    'Gaborone','George Town','Georgetown','Gitega','Guatemala City','Gustavia',
    'Hanoi','Harare','Havana','Helsinki','Honiara',
    'Kabul','Kampala','Kathmandu','Khartoum','Kigali','Kingston','Kingstown','Kinshasa','Kuala Lumpur','Kuwait City',
    'La Paz','Libreville','Lilongwe','Lima','Lisbon','Ljubljana','Lomé','London','Luxembourg','Lusaka',
    'Madrid','Majuro','Malabo','Male','Managua','Manila','Maputo','Maseru','Mbabane','Mexico City','Minsk','Mogadishu','Monaco','Monrovia','Montevideo','Moroni','Moscow','Muscat',
    'Nairobi','Nassau','Naypyidaw','Ngerulmud','Niamey','Nicosia','Nouakchott','Noumea','Nuku\'alofa','Nuuk',
    'Panama City','Paramaribo','Paris','Phnom Penh','Podgorica','Port-au-Prince','Port Louis','Port Moresby','Porto-Novo','Prague','Praia','Pretoria','Pristina','Pyongyang','Palikir',
    'Rabat','Reykjavik','Riga','Riyadh','Rome','Roseau',
    'San Jose','San Marino','San Salvador','Sana\'a','Santiago','Santo Domingo','Sao Tome','Sarajevo','Seoul','Singapore','Skopje','Sofia','South Tarawa','Sri Jayawardenepura Kotte','Stockholm','Sucre','Suva',
    'Tallinn','Tashkent','Tbilisi','Tegucigalpa','Tehran','Thimphu','Tirana','Tokyo','Tripoli','Tunis','Torshavn','Taipei',
    'Vaduz','Valletta','Vatican City','Victoria','Vienna','Vientiane','Vilnius',
    'Warsaw','Washington','Wellington','West Island','Willemstad','Windhoek',
    // Added to complete set
    'Andorra la Vella','Baghdad','Baku','Bamako','Bandar Seri Begawan','Bangui','Banjul','Basseterre','Freetown','Funafuti',
    'Islamabad','Jakarta','Jerusalem','Juba','Luanda','N\'Djamena','Oslo','Ottawa','Ouagadougou','Papeete',
    'Port of Spain','Port Vila','Quito','Saint George\'s','Saint John\'s','Ulaanbaatar','Yamoussoukro','Yaounde','Yerevan','Zagreb'
  ];
  const byEnd = new Map();
  function lastLetter(name){
    const s = String(name||'').trim();
    const m = /([A-Za-z])[^A-Za-z]*$/.exec(s);
    return m ? m[1].toUpperCase() : '';
  }
  for(const cap of capitals){
    const L = lastLetter(cap);
    if(!L) continue;
    if(!byEnd.has(L)) byEnd.set(L, []);
    byEnd.get(L).push(cap);
  }
  const questions = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for(const L of letters){
    const list = (byEnd.get(L)||[]).sort();
    if(list.length < 3) continue; // only include if at least 3 options
    const answers = list.map(name => ({ answer: name, score: 0, count: 0 }));
    questions.push({ question: `Name a world capital city ending with the letter ${L}`, answers });
  }
  return questions;
}

function augmentWithCapitalEndingQuestions(list){
  const existing = new Set((Array.isArray(list)?list:[]).map(q=>q && q.question));
  for(const q of generateCapitalEndingQuestions()){
    if(!existing.has(q.question)) list.push(q);
  }
}
const BASE_DEFAULT_QUESTIONS = [
  {
    question: 'Name a country in South America',
    answers: [
      { answer: 'Brazil', score: 10, count: 35 },
      { answer: 'Argentina', score: 9, count: 20 },
      { answer: 'Chile', score: 8, count: 15 },
      { answer: 'Peru', score: 7, count: 10 },
      { answer: 'Colombia', score: 6, count: 8 }
    ]
  },
  {
    question: 'Name a U.S. state that starts with M',
    answers: [
      { answer: 'Michigan', score: 10, count: 25 },
      { answer: 'Mississippi', score: 9, count: 15 },
      { answer: 'Montana', score: 8, count: 12 },
      { answer: 'Missouri', score: 7, count: 10 },
      { answer: 'Maryland', score: 6, count: 8 }
    ]
  },
  {
    question: 'Name a European capital city',
    answers: [
      { answer: 'Paris', score: 10, count: 28 },
      { answer: 'London', score: 9, count: 26 },
      { answer: 'Berlin', score: 8, count: 20 },
      { answer: 'Rome', score: 7, count: 18 },
      { answer: 'Madrid', score: 6, count: 12 }
    ]
  },
  {
    question: 'Name a mountain with an elevation over 8,000 meters',
    answers: [
      { answer: 'Mount Everest', score: 10, count: 30 },
      { answer: 'K2', score: 9, count: 25 },
      { answer: 'Kangchenjunga', score: 8, count: 20 },
      { answer: 'Lhotse', score: 7, count: 15 },
      { answer: 'Makalu', score: 6, count: 10 }
    ]
  }
];

export const DEFAULT_QUESTIONS = BASE_DEFAULT_QUESTIONS
  .concat(generateCountryLetterQuestions(), generateCapitalLetterQuestions());
normalizeAllQuestions(DEFAULT_QUESTIONS);
const US_STATE_SET = new Set([
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
  'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
  'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
  'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
  'wisconsin','wyoming'
]);

export function categorizeQuestion(qobj){
  const question = qobj && qobj.question;
  const qraw = String(question||'').trim();
  const q = qraw.toLowerCase();
  const m = /^name a city in\s+(.+)$/i.exec(qraw);
  if(m && m[1]){
    const target = m[1].trim().replace(/^[Tt]he\s+/, '').replace(/[\s\.-]+$/, '');
    const tnorm = target.toLowerCase();
    if(US_STATE_SET.has(tnorm)){
      if(tnorm === 'georgia'){
        const ans = ((qobj && qobj.answers) || []).map(a => String(a && a.answer || '').toLowerCase());
        const geCountryHints = ['tbilisi','batumi','kutaisi','rustavi','poti','gori','zugdidi','samtredia','khashuri'];
        const looksCountry = geCountryHints.some(h => ans.some(x => x.includes(h)));
        if(looksCountry) return 'Country Cities';
      }
      return 'State Cities';
    }
    return 'Country Cities';
  }
  if(q.includes('elevation') || q.includes('altitude') || q.includes('highest point') || q.includes('lowest point')) return 'Elevation';
  if(/^name a world capital city beginning with the letter [a-z]/i.test(qraw)) return 'Country Capitals';
  if(/^name a world capital city ending with the letter [a-z]/i.test(qraw)) return 'Country Capitals';
  if(q.includes('european capital')) return 'European Capitals';
  if(/^name a country (with|that has)\s+\d+\s+(?:or\s+more\s+)?letters?/i.test(qraw)) return 'Countries by Length';
  if(q.includes('capital')) return 'Capital Cities';
  if(q.includes('u.s. state')) return 'US States';
  if(q.includes('country')) return 'Countries';
  return 'Other';
}

function readAnswerOverrides(){
  try{ const raw = localStorage.getItem(ANSWER_OVERRIDES_KEY); const obj = raw?JSON.parse(raw):{}; return obj&&typeof obj==='object'?obj:{}; }catch{ return {}; }
}
function readAnswerWeightOverrides(){
  try{ const raw = localStorage.getItem(ANSWER_WEIGHT_OVERRIDES_KEY); const obj = raw?JSON.parse(raw):{}; return obj&&typeof obj==='object'?obj:{}; }catch{ return {}; }
}
async function fetchServerOverrides(){
  try{
    const res = await apiFetch('/api/geoscore-overrides', { cache: 'no-store' });
    if(res.ok){ return await res.json(); }
  }catch{}
  // Try static fallback if API route not available
  try{
    const res2 = await fetch('/backend/geoscore-overrides.json', { cache: 'no-store' });
    if(res2.ok){ return await res2.json(); }
  }catch{}
  // Fallback to legacy local storage
  return {
    answerOverrides: readAnswerOverrides(),
    weightOverrides: readAnswerWeightOverrides(),
    removedAnswers: {},
    removedQuestions: {},
    weightByCountry: {},
    weightByCity: {}
  };
}

let __countriesCache = null;
async function getCountryNameSet(){
  if(__countriesCache) return __countriesCache;
  try{
    const r = await fetch('geolayers-game/public/countries.json', { cache:'no-store' });
    if(r.ok){
      const arr = await r.json();
      const set = new Set(arr.map(c=> String(c && c.name || '').trim().toLowerCase()));
      __countriesCache = set;
      return set;
    }
  }catch{}
  __countriesCache = new Set();
  return __countriesCache;
}

function normPlainName(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }

async function applyGlobalWeights(list, ovAll){
  const wCountry = ovAll && ovAll.weightByCountry ? ovAll.weightByCountry : {};
  const wCity = ovAll && ovAll.weightByCity ? ovAll.weightByCity : {};
  const countrySet = await getCountryNameSet();
  for(const q of (Array.isArray(list)?list:[])){
    if(!Array.isArray(q && q.answers)) continue;
    for(const a of q.answers){
      const orig = String(a && a.answer || '');
      const norm = normPlainName(orig);
      // Country vs City
      if(countrySet.has(norm)){
        const wc = (wCountry[orig] ?? wCountry[norm]);
        if(Number.isFinite(wc)) { a.score = wc; a.count = wc; }
      } else {
        const wy = (wCity[orig] ?? wCity[norm]);
        if(Number.isFinite(wy)) { a.score = wy; a.count = wy; }
      }
    }
  }
}
async function writeAnswerWeightOverride(questionKey, originalAnswer, newWeight){
  const clamped = Math.max(0, Math.min(100, Math.round(Number(newWeight)||0)));
  try{
    await apiFetch('/api/geoscore/weight-override', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ questionKey, originalAnswer, weight: clamped })
    });
  }catch{}
  // Mirror to localStorage for offline continuity
  const map = readAnswerWeightOverrides();
  if(!map[questionKey]) map[questionKey] = {};
  map[questionKey][originalAnswer] = clamped;
  try{ localStorage.setItem(ANSWER_WEIGHT_OVERRIDES_KEY, JSON.stringify(map)); }catch{}
}
function getAnswerWeightOverride(questionKey, originalAnswer){
  const map = readAnswerWeightOverrides();
  const val = (map[questionKey] && map[questionKey][originalAnswer]);
  return Number.isFinite(val) ? val : null;
}
async function writeAnswerOverride(questionKey, originalAnswer, newValue){
  try{
    await apiFetch('/api/geoscore/answer-override', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ questionKey, originalAnswer, newValue })
    });
  }catch{}
  // Mirror to localStorage for offline continuity
  const map = readAnswerOverrides();
  if(!map[questionKey]) map[questionKey] = {};
  if(newValue){ map[questionKey][originalAnswer] = newValue; }
  else { if(map[questionKey]) delete map[questionKey][originalAnswer]; }
  try{ localStorage.setItem(ANSWER_OVERRIDES_KEY, JSON.stringify(map)); }catch{}
}
function getAnswerOverride(questionKey, originalAnswer){
  const map = readAnswerOverrides();
  return (map[questionKey] && map[questionKey][originalAnswer]) || '';
}

function augmentWithCountryLetterQuestions(list){
  const existing = new Set((Array.isArray(list)?list:[]).map(q=>q && q.question));
  for(const q of generateCountryLetterQuestions()){
    if(!existing.has(q.question)) list.push(q);
  }
}

function augmentWithCapitalLetterQuestions(list){
  const existing = new Set((Array.isArray(list)?list:[]).map(q=>q && q.question));
  for(const q of generateCapitalLetterQuestions()){
    if(!existing.has(q.question)) list.push(q);
  }
}

// --- Countries by Length ---
function generateCountryLengthQuestions(){
  const countries = [
    'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan',
    'Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi',
    'Cambodia','Cameroon','Canada','Cape Verde','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo (Congo-Brazzaville)','Costa Rica','Côte d\'Ivoire','Croatia','Cuba','Cyprus','Czechia',
    'Democratic Republic of the Congo','Denmark','Djibouti','Dominica','Dominican Republic',
    'Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia',
    'Fiji','Finland','France',
    'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana',
    'Haiti','Honduras','Hungary',
    'Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
    'Jamaica','Japan','Jordan',
    'Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan',
    'Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg',
    'Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
    'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway',
    'Oman',
    'Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal',
    'Qatar',
    'Romania','Russia','Rwanda',
    'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria',
    'Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu',
    'Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan',
    'Vanuatu','Vatican City','Venezuela','Vietnam',
    'Yemen',
    'Zambia','Zimbabwe'
  ];
  const byLen = new Map();
  function stripLetters(s){
    return String(s||'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/^the\s+/i,'')
      .replace(/[^a-z]/gi,'');
  }
  for(const name of countries){
    const letters = stripLetters(name);
    const n = letters.length;
    if(n<=0) continue;
    if(!byLen.has(n)) byLen.set(n, []);
    byLen.get(n).push(name);
  }
  const out = [];
  const lens = Array.from(byLen.keys()).sort((a,b)=>a-b);
  // Individual-length questions for shorter names (require at least 5 items to be useful)
  for(const n of lens){
    if(n >= 12) continue; // handled by combined question below
    const list = (byLen.get(n)||[]).sort((a,b)=> a.localeCompare(b));
    if(list.length < 5) continue;
    const answers = list.map(name => ({ answer: name, score: 0, count: 0 }));
    out.push({ question: `Name a country with ${n} letters`, answers });
  }
  // Combined question for 12 or more letters
  const many = lens.filter(n=> n>=12).flatMap(n => (byLen.get(n)||[]));
  if(many.length){
    const uniq = Array.from(new Set(many)).sort((a,b)=> a.localeCompare(b));
    const answers = uniq.map(name => ({ answer: name, score: 0, count: 0 }));
    out.push({ question: `Name a country with 12 or more letters`, answers });
  }
  return out;
}

function augmentWithCountryLengthQuestions(list){
  const existing = new Set((Array.isArray(list)?list:[]).map(q=>q && q.question));
  for(const q of generateCountryLengthQuestions()){
    if(!existing.has(q.question)) list.push(q);
  }
}

// Build country-derived letter and length questions from countries.json to ensure completeness
async function buildCountryDerivedQuestions(list){
  const existing = new Set((Array.isArray(list)?list:[]).map(q=> String(q && q.question || '')));
  const namesSet = await getCountryNameSet();
  const names = Array.from(namesSet || []).filter(Boolean).sort((a,b)=> String(a).localeCompare(String(b)));
  // Letters
  const byLetter = new Map();
  for(const name of names){
    const L = String(name).trim()[0]?.toUpperCase();
    if(!L) continue;
    if(!byLetter.has(L)) byLetter.set(L, []);
    byLetter.get(L).push(name);
  }
  for(const [L, arr] of byLetter.entries()){
    const listSorted = arr.slice().sort((a,b)=> String(a).localeCompare(String(b)));
    if(listSorted.length < 5) continue;
    const qtext = `Name a country that starts with ${L}`;
    if(!existing.has(qtext)){
      const answers = listSorted.map(name => ({ answer: name, score: 0, count: 0 }));
      list.push({ question: qtext, answers });
      existing.add(qtext);
    }
  }
  // Lengths
  const byLen = new Map();
  for(const name of names){
    const n = String(name || '').replace(/^the\s+/i,'').trim();
    const L = n.length;
    if(!byLen.has(L)) byLen.set(L, []);
    byLen.get(L).push(name);
  }
  const lens = Array.from(byLen.keys()).sort((a,b)=>a-b);
  for(const n of lens){
    if(n >= 12) continue;
    const listN = (byLen.get(n)||[]).slice().sort((a,b)=> String(a).localeCompare(String(b)));
    if(listN.length < 5) continue;
    const qtext = `Name a country with ${n} letters`;
    if(!existing.has(qtext)){
      const answers = listN.map(name => ({ answer: name, score: 0, count: 0 }));
      list.push({ question: qtext, answers });
      existing.add(qtext);
    }
  }
  const many = lens.filter(n=> n>=12).flatMap(n => (byLen.get(n)||[]));
  if(many.length){
    const uniq = Array.from(new Set(many)).sort((a,b)=> String(a).localeCompare(String(b)));
    const qtext = `Name a country with 12 or more letters`;
    if(!existing.has(qtext)){
      const answers = uniq.map(name => ({ answer: name, score: 0, count: 0 }));
      list.push({ question: qtext, answers });
      existing.add(qtext);
    }
  }
}

// Build capital-derived letter and ending questions using capitals present in dataset; fallback to static list
function buildCapitalDerivedQuestions(list){
  const existing = new Set((Array.isArray(list)?list:[]).map(q=> String(q && q.question || '')));
  // Collect capitals from explicit Qs
  const caps = new Set();
  for(const q of (Array.isArray(list)?list:[])){
    const qt = String(q && q.question || '');
    const m = /^\s*What is the capital of\s+(.+?)\?\s*$/i.exec(qt);
    if(m && m[1]){
      const ans = Array.isArray(q && q.answers) && q.answers[0] && q.answers[0].answer ? String(q.answers[0].answer) : '';
      if(ans) caps.add(ans);
    }
  }
  if(caps.size === 0){
    // Fallback to static list
    for(const name of generateCapitalLetterQuestions().flatMap(q=> q.answers.map(a=>a.answer))){ caps.add(name); }
  }
  const capList = Array.from(caps).filter(Boolean);
  // By starting letter (min 5)
  const byStart = new Map();
  for(const c of capList){ const L = String(c).trim()[0]?.toUpperCase(); if(!L) continue; if(!byStart.has(L)) byStart.set(L,[]); byStart.get(L).push(c); }
  for(const [L, arr] of byStart.entries()){
    const listSorted = arr.slice().sort((a,b)=> String(a).localeCompare(String(b)));
    if(listSorted.length < 5) continue;
    const qtext = `Name a world capital city beginning with the letter ${L}`;
    if(!existing.has(qtext)){
      const answers = listSorted.map(name => ({ answer: name, score: 0, count: 0 }));
      list.push({ question: qtext, answers });
      existing.add(qtext);
    }
  }
  // By ending letter (min 3)
  const byEnd = new Map();
  function lastLetter(name){
    const s = String(name||'').trim();
    const m = /([A-Za-z])[^A-Za-z]*$/.exec(s);
    return m ? m[1].toUpperCase() : '';
  }
  for(const c of capList){ const L = lastLetter(c); if(!L) continue; if(!byEnd.has(L)) byEnd.set(L,[]); byEnd.get(L).push(c); }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for(const L of letters){
    const listSorted = (byEnd.get(L)||[]).slice().sort((a,b)=> String(a).localeCompare(String(b)));
    if(listSorted.length < 3) continue;
    const qtext = `Name a world capital city ending with the letter ${L}`;
    if(!existing.has(qtext)){
      const answers = listSorted.map(name => ({ answer: name, score: 0, count: 0 }));
      list.push({ question: qtext, answers });
      existing.add(qtext);
    }
  }
}

export async function loadQuestions() {
  // Prefer fresh file from server; fall back to cached localStorage or defaults
  let cached = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = JSON.parse(raw);
  } catch {}
  try {
    const res = await fetch('geoscore_questions.json', { cache: 'no-store' });
    if (res.ok) {
      let data = await res.json();
      // Accept either an array of questions or an object with { questions }
      if (!Array.isArray(data) && data && Array.isArray(data.questions)) {
        data = data.questions;
      }
      // First, augment with generated sets (derive country-based lists from countries.json)
      await buildCountryDerivedQuestions(data);
      buildCapitalDerivedQuestions(data);
      // Drop fully removed questions
      const ovAll = await fetchServerOverrides();
      const removedQs = (ovAll && ovAll.removedQuestions) || {};
      data = (Array.isArray(data)?data:[]).filter(q => !(removedQs && removedQs[String(q && q.question || '')]));
      // Then apply server-side answer + weight overrides (persisted by admin editing) so augmented items get their persisted edits
      {
        const ov = ovAll && ovAll.answerOverrides ? ovAll.answerOverrides : {};
        const wov = ovAll && ovAll.weightOverrides ? ovAll.weightOverrides : {};
        const rm = ovAll && ovAll.removedAnswers ? ovAll.removedAnswers : {};
        for(const q of (Array.isArray(data)?data:[])){
          const qkey = String(q && q.question || '');
          const amap = ov[qkey] || {};
          if(Array.isArray(q && q.answers)){
            const next = [];
            const removedMap = rm[qkey] || {};
            for(const a of q.answers){
              const orig = String(a && a.answer || '');
              if(removedMap[orig]){ continue; }
              const repl = amap[orig];
              if(repl){ a._orig = orig; a.answer = repl; } else { a._orig = orig; }
              const w = (wov[qkey] && wov[qkey][orig]);
              if(Number.isFinite(w)) { a.score = w; a.count = w; }
              next.push(a);
            }
            const seen = new Set();
            function normName(s){
              let n = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
              const suffixes = [
                'city municipality','town municipality','unified government','metropolitan government','city-county',
                'census designated place','cdp','county','parish','borough','municipality','town','village','commune'
              ];
              let changed=true; while(changed){
                changed=false;
                for(const suf of suffixes){
                  const re = new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i');
                  if(re.test(n)){ n = n.replace(re,'').trim(); changed=true; break; }
                }
              }
              return n;
            }
            q.answers = next.filter(a=>{
              const k = normName(a && a.answer);
              if(seen.has(k)) return false; seen.add(k); return true;
            });
          }
        }
      }
      // Apply global by-country/by-city weights
      await applyGlobalWeights(data, ovAll);
      normalizeAnswerMetrics(data);
      saveQuestions(data);
      return data;
    }
  } catch {}
  if (Array.isArray(cached) && cached.length) {
    await buildCountryDerivedQuestions(cached);
    buildCapitalDerivedQuestions(cached);
    // Drop fully removed questions
    const ovAll = await fetchServerOverrides();
    const removedQs = (ovAll && ovAll.removedQuestions) || {};
    cached = (Array.isArray(cached)?cached:[]).filter(q => !(removedQs && removedQs[String(q && q.question || '')]));
    // Apply overrides to cached+augmented
    const ov = ovAll && ovAll.answerOverrides ? ovAll.answerOverrides : {};
    const wov = ovAll && ovAll.weightOverrides ? ovAll.weightOverrides : {};
    const rm = ovAll && ovAll.removedAnswers ? ovAll.removedAnswers : {};
    for(const q of (Array.isArray(cached)?cached:[])){
      const qkey = String(q && q.question || '');
      const amap = ov[qkey] || {};
      if(Array.isArray(q && q.answers)){
        const next = [];
        const removedMap = rm[qkey] || {};
        for(const a of q.answers){
          const orig = String(a && a.answer || '');
          if(removedMap[orig]){ continue; }
          const repl = amap[orig];
          if(repl){ a._orig = orig; a.answer = repl; } else { a._orig = orig; }
          const w = (wov[qkey] && wov[qkey][orig]);
          if(Number.isFinite(w)) { a.score = w; a.count = w; }
          next.push(a);
        }
        const seen = new Set();
        function normName(s){
          let n = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
          const suffixes = [
            'city municipality','town municipality','unified government','metropolitan government','city-county',
            'census designated place','cdp','county','parish','borough','municipality','town','village','commune'
          ];
          let changed=true; while(changed){
            changed=false;
            for(const suf of suffixes){
              const re = new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i');
              if(re.test(n)){ n = n.replace(re,'').trim(); changed=true; break; }
            }
          }
          return n;
        }
        q.answers = next.filter(a=>{
          const k = normName(a && a.answer);
          if(seen.has(k)) return false; seen.add(k); return true;
        });
      }
    }
    await applyGlobalWeights(cached, ovAll);
    normalizeAnswerMetrics(cached);
    return cached;
  }
  // If nothing stored, seed with defaults and generated questions
  const seeded = JSON.parse(JSON.stringify(DEFAULT_QUESTIONS));
  await buildCountryDerivedQuestions(seeded);
  buildCapitalDerivedQuestions(seeded);
  const ovAll = await fetchServerOverrides();
  const removedQs = (ovAll && ovAll.removedQuestions) || {};
  const seededFiltered = (Array.isArray(seeded)?seeded:[]).filter(q => !(removedQs && removedQs[String(q && q.question || '')]));
  const ov = ovAll && ovAll.answerOverrides ? ovAll.answerOverrides : {};
  const wov = ovAll && ovAll.weightOverrides ? ovAll.weightOverrides : {};
  const rm = ovAll && ovAll.removedAnswers ? ovAll.removedAnswers : {};
  for(const q of (Array.isArray(seededFiltered)?seededFiltered:[])){
    const qkey = String(q && q.question || '');
    const amap = ov[qkey] || {};
    if(Array.isArray(q && q.answers)){
      const next = [];
      const removedMap = rm[qkey] || {};
      for(const a of q.answers){
        const orig = String(a && a.answer || '');
        if(removedMap[orig]){ continue; }
        const repl = amap[orig];
        if(repl){ a._orig = orig; a.answer = repl; } else { a._orig = orig; }
        const w = (wov[qkey] && wov[qkey][orig]);
        if(Number.isFinite(w)) { a.score = w; a.count = w; }
        next.push(a);
      }
      const seen = new Set();
      function normName(s){
        let n = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
        const suffixes = [
          'city municipality','town municipality','unified government','metropolitan government','city-county',
          'census designated place','cdp','county','parish','borough','municipality','town','village','commune'
        ];
        let changed=true; while(changed){
          changed=false;
          for(const suf of suffixes){
            const re = new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i');
            if(re.test(n)){ n = n.replace(re,'').trim(); changed=true; break; }
          }
        }
        return n;
      }
      q.answers = next.filter(a=>{
        const k = normName(a && a.answer);
        if(seen.has(k)) return false; seen.add(k); return true;
      });
    }
  }
  await applyGlobalWeights(seededFiltered, ovAll);
  normalizeAnswerMetrics(seededFiltered);
  saveQuestions(seededFiltered);
  return seededFiltered;
}

export function saveQuestions(qs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(qs));
  } catch {}
}

export async function initGeoScorePanel() {
  const container = document.getElementById('geoscoreAdmin');
  if (!container) return;
  container.innerHTML = '';

  function formatPlaceName(name){
    let n = String(name||'').trim();
    if(!n) return n;
    const suffixes = [
      'city municipality','town municipality',
      'unified government','metropolitan government','city-county',
      'census designated place','cdp',
      'county','parish','borough','municipality','town','village','commune'
    ];
    let changed=true;
    while(changed){
      changed=false;
      for(const suf of suffixes){
        const re = new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i');
        if(re.test(n)){ n=n.replace(re,'').trim(); changed=true; break; }
      }
    }
    return n;
  }

  // Build country-organized admin: Country | World/US | Categories | Questions | Answers (+ Map)
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  const title = document.createElement('h3');
  title.textContent = 'Browse questions by country';
  const note = document.createElement('span');
  note.textContent = 'Read-only preview';
  note.style.fontSize = '0.9em';
  note.style.opacity = '0.7';
  header.append(title, note);
  container.appendChild(header);

  const shell = document.createElement('div');
  shell.className = 'geoscore-admin-shell';
  container.appendChild(shell);

  function makeCol(titleText){
    const col = document.createElement('div');
    col.className = 'geoscore-col';
    const h = document.createElement('div');
    h.className = 'geoscore-col-title';
    h.textContent = titleText;
    const body = document.createElement('div');
    body.className = 'geoscore-col-body';
    col.append(h, body);
    return { col, body, header: h };
  }

  const realmUI = makeCol('World / US');
  const countryUI = makeCol('Countries / States');
  const catUI = makeCol('Categories');
  const qUI = makeCol('Questions');
  const ansUI = makeCol('Answers');
  countryUI.col.style.width = '240px';
  realmUI.col.style.width = '160px';
  // Categories column removed; order: World/US | Countries/States | Questions | Answers
  shell.append(realmUI.col, countryUI.col, qUI.col, ansUI.col);

  const all = await loadQuestions();
  // Build a map of country -> capital (from explicit capital questions in dataset)
  const capitalByCountry = new Map(); // key: normalized country name -> canonical capital string
  try{
    for(const q of (Array.isArray(all)?all:[])){
      const qt = String(q && q.question || '');
      const m = /^\s*What is the capital of\s+(.+?)\?\s*$/i.exec(qt);
      if(m && m[1]){
        const countryName = normalizeCountryName(m[1].trim());
        const ans = Array.isArray(q && q.answers) && q.answers[0] && q.answers[0].answer ? String(q.answers[0].answer) : '';
        if(countryName && ans){ capitalByCountry.set(countryName.toLowerCase(), ans); }
      }
    }
  }catch{}
  // Load countries list
  let countriesData = [];
  try{
    const r = await fetch('geolayers-game/public/countries.json', { cache: 'no-store' });
    if(r.ok){ countriesData = await r.json(); }
  }catch{}
  countriesData.sort((a,b)=> String(a.name).localeCompare(String(b.name)));

  // Normalize country display names to avoid duplicate variants in the list
  function normalizeCountryName(raw){
    let n = String(raw||'').trim();
    n = n.replace(/^the\s+/i,'');
    const key = n.toLowerCase();
    const aliases = {
      'united states of america':'United States', 'united states':'United States', 'usa':'United States', 'u.s.':'United States',
      'united kingdom':'United Kingdom', 'u.k.':'United Kingdom', 'uk':'United Kingdom', 'great britain':'United Kingdom',
      'czech republic':'Czechia',
      // Türkiye canonical
      'turkey':'Türkiye', 'turkiye':'Türkiye', 'türkiye':'Türkiye',
      'syrian arab republic':'Syria', 'iran (islamic republic of)':'Iran', 'viet nam':'Vietnam',
      'lao people\'s democratic republic':'Laos', 'moldova, republic of':'Moldova',
      'tanzania, united republic of':'Tanzania', 'united republic of tanzania':'Tanzania',
      'china, taiwan province of':'Taiwan', 'china, hong kong sar':'Hong Kong', 'hong kong s.a.r.':'Hong Kong',
      'china, macao sar':'Macao', 'macao s.a.r':'Macao', 'macau':'Macao',
      'republic of serbia':'Serbia',
      'congo (kinshasa)':'Democratic Republic of the Congo', 'democratic republic of the congo':'Democratic Republic of the Congo',
      'congo, democratic republic of the':'Democratic Republic of the Congo',
      'congo (congo-brazzaville)':'Republic of the Congo', 'republic of the congo':'Republic of the Congo',
      // Côte d'Ivoire canonical
      'ivory coast':"Côte d'Ivoire", 'cote d\'ivoire':"Côte d'Ivoire", 'côte d\'ivoire':"Côte d'Ivoire",
      'sao tome and principe':'São Tomé and Principe', 'eswatini':'eSwatini', 'swaziland':'eSwatini',
      'burma':'Myanmar'
    };
    if(aliases[key]) return aliases[key];
    // Title-case fallback
    return n.replace(/\w\S*/g, (w)=> w.charAt(0).toUpperCase()+w.slice(1));
  }

  // Exclusions (per-category)
  function readExclusions(){
    try{ const raw=localStorage.getItem(EXCLUSIONS_KEY); const obj=raw?JSON.parse(raw):{}; return obj&&typeof obj==='object'?obj:{}; }catch{ return {}; }
  }
  function writeExclusions(map){ try{ localStorage.setItem(EXCLUSIONS_KEY, JSON.stringify(map)); }catch{} }
  function isExcluded(category, name){
    const ex = readExclusions();
    const set = (ex && ex[category]) || {};
    const key = category==='Country Cities' ? normalizeCountryName(name) : String(name||'').trim();
    return !!set[key];
  }
  function excludeItem(category, name){
    const ex = readExclusions();
    if(!ex[category]) ex[category]={};
    const key = category==='Country Cities' ? normalizeCountryName(name) : String(name||'').trim();
    ex[category][key]=true; writeExclusions(ex);
  }
  function includeItem(category, name){
    const ex = readExclusions();
    const key = category==='Country Cities' ? normalizeCountryName(name) : String(name||'').trim();
    if(ex[category]){ delete ex[category][key]; writeExclusions(ex); }
  }
  // Categorize questions from their text (pass full question object to disambiguate)
  function categorizeQ(qobj){
    const question = qobj && qobj.question;
    const qraw = String(question||'').trim();
    const q = qraw.toLowerCase();
    // Distinguish US state vs country city questions
    const m = /^name a city in\s+(.+)$/i.exec(qraw);
    if(m && m[1]){
      const target = m[1].trim().replace(/^[Tt]he\s+/, '').replace(/[\s\.-]+$/,'');
      const tnorm = target.toLowerCase();
      if(US_STATE_SET.has(tnorm)){
        // Special-case: "Georgia" can be a US state or the country. If the answers look like
        // Georgian country cities, treat as Country Cities.
        if(tnorm === 'georgia'){
          const ans = ((qobj && qobj.answers) || []).map(a => String(a && a.answer || '').toLowerCase());
          const geCountryHints = ['tbilisi','batumi','kutaisi','rustavi','poti','gori','zugdidi','samtredia','khashuri'];
          const looksCountry = geCountryHints.some(h => ans.some(x => x.includes(h)));
          if(looksCountry) return 'Country Cities';
        }
        return 'State Cities';
      }
      return 'Country Cities';
    }
    if(/name a country that starts with/i.test(qraw)) return 'Countries by Letter';
    if(q.includes('european capital')) return 'European Capitals';
    if(q.includes('capital')) return 'Capital Cities';
    if(q.includes('u.s. state')) return 'US States';
    if(q.includes('country')) return 'Countries';
    return 'Other';
  }

  // Build category map with country list de-duplicated by normalized country name
  const byCat = new Map();
  const tmpByCat = new Map();
  all.forEach((q)=>{
    const c = categorizeQuestion(q);
    // Drop Capital Cities category entirely
    if(c === 'Capital Cities') return;
    // Exclude District of Columbia entirely from city questions
    const m = /^\s*Name a city in\s+(.+)$/i.exec(String(q && q.question || ''));
    const target = m && m[1] ? m[1].trim().toLowerCase() : '';
    if(target === 'district of columbia') return; // skip adding
    if(!tmpByCat.has(c)) tmpByCat.set(c, []);
    tmpByCat.get(c).push(q);
  });
  // Directly assign for non-country categories
  for(const [cat, qs] of tmpByCat.entries()){
    if(cat !== 'Country Cities'){ byCat.set(cat, qs); }
  }
  // Deduplicate Country Cities display by canonical name
  if(tmpByCat.has('Country Cities')){
    const list = tmpByCat.get('Country Cities');
    const bestByName = new Map();
    for(const q of list){
      const m = /^\s*Name a city in\s+(.+)$/i.exec(String(q.question||''));
      const target = m && m[1] ? m[1].trim() : '';
      const key = normalizeCountryName(target);
      if(isExcluded('Country Cities', key)) continue;
      if(!bestByName.has(key)) bestByName.set(key, q);
      else {
        const prev = bestByName.get(key);
        const lenA = Array.isArray(prev.answers)?prev.answers.length:0;
        const lenB = Array.isArray(q.answers)?q.answers.length:0;
        if(lenB > lenA) bestByName.set(key, q);
      }
    }
    byCat.set('Country Cities', Array.from(bestByName.values()).sort((a,b)=> String(a.question).localeCompare(String(b.question))));
  }

  // Selection state
  function realmForCategory(cat){
    const usSet = new Set(['State Cities','US States']);
    return usSet.has(String(cat)) ? 'US' : 'World';
  }

  const realms = ['World','US'];
  let selectedCountry = null; // { name, code, isState }
  let selectedRealm = 'World';
  let selectedCat = null;
  let selectedQuestion = null;
  let selectedAnswerFilter = '';

  // Render helpers

  function questionInvolvesCountry(q, countryObj){
    if(!q || !countryObj) return false;
    const qtext = String(q.question||'');
    const cname = String(countryObj.name||'');
    const isState = !!countryObj.isState;
    const mm = /^\s*Name a city in\s+(.+)$/i.exec(qtext);
    if(mm && mm[1]){
      // City questions must match the exact target only (country or state), never by city answers
      const target = mm[1].trim();
      if(isState){
        return target.toLowerCase() === cname.toLowerCase();
      }
      return normalizeCountryName(target).toLowerCase() === normalizeCountryName(cname).toLowerCase();
    }
    // Explicit country-capital question: include if it targets this country
    {
      const m = /^\s*What is the capital of\s+(.+?)\?\s*$/i.exec(qtext);
      if(m && m[1]){
        const target = normalizeCountryName(m[1].trim());
        return target.toLowerCase() === normalizeCountryName(cname).toLowerCase();
      }
    }
    // For country questions (e.g., starts with, length), include if answers contain this country name
    if(/\bcountry\b/i.test(qtext)){
      const answers = Array.isArray(q.answers)? q.answers : [];
      return answers.some(a => normalizeCountryName(a && a.answer).toLowerCase() === normalizeCountryName(cname).toLowerCase());
    }
    // For world capital letter questions, include if this country's capital matches the letter constraint
    {
      const cap = capitalByCountry.get(normalizeCountryName(cname).toLowerCase()) || '';
      if(cap){
        let m = /^\s*Name a world capital city beginning with the letter\s+([A-Za-z])\s*$/i.exec(qtext);
        if(m && m[1]){ return cap.toLowerCase().startsWith(m[1].toLowerCase()); }
        m = /^\s*Name a world capital city ending with the letter\s+([A-Za-z])\s*$/i.exec(qtext);
        if(m && m[1]){ return cap.toLowerCase().replace(/[^a-z]$/i,'').endsWith(m[1].toLowerCase()); }
      }
    }
    return false;
  }

  function renderCountries(){
    countryUI.body.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    const stateNames = [
      'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia',
      'Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts',
      'Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
      'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
      'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
      'Wisconsin','Wyoming'
    ];
    const list = (selectedRealm==='US') ? stateNames.map(n=>({ name:n, code:null, isState:true })) : countriesData.map(c=>({ name:c.name, code:c.code, isState:false }));
    for(const c of list){
      const li = document.createElement('li');
      const isSel = selectedCountry && selectedCountry.name === c.name && !!selectedCountry.isState === !!c.isState;
      li.className = 'geoscore-item' + (isSel ? ' selected' : '');
      li.textContent = c.name;
      li.addEventListener('click', ()=>{
        selectedCountry = c;
        // Select first relevant question across all categories
        const pooled = [];
        for(const arr of byCat.values()){ Array.isArray(arr) && pooled.push(...arr); }
        const qs = pooled.filter(q => questionInvolvesCountry(q, c))
          .sort((a,b)=> String(a.question).localeCompare(String(b.question)));
        selectedQuestion = qs[0] || null;
        renderCountries(); renderRealms(); renderQuestions(); renderAnswers();
      });
      ul.appendChild(li);
    }
    countryUI.body.appendChild(ul);
  }
  function renderRealms(){
    realmUI.body.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    realms.forEach(r => {
      const li = document.createElement('li');
      li.className = 'geoscore-item' + (r===selectedRealm ? ' selected' : '');
      li.textContent = r;
      li.addEventListener('click', ()=>{
        selectedRealm = r;
        // Reset category to first available in this realm
        const catsInRealm = Array.from(byCat.keys()).filter(c => realmForCategory(c)===selectedRealm).sort();
        selectedCat = catsInRealm[0] || null;
        if(selectedCat){
          const initQs = (byCat.get(selectedCat) || []).slice().sort((a,b)=> String(a.question).localeCompare(String(b.question)));
          selectedQuestion = initQs[0] || null;
        } else {
          selectedQuestion = null;
        }
        renderRealms();
        renderCategories();
        renderQuestions();
        renderAnswers();
      });
      ul.appendChild(li);
    });
    realmUI.body.appendChild(ul);
  }

  function renderCategories(){
    catUI.body.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    const cats = Array.from(byCat.keys()).filter(c => realmForCategory(c)===selectedRealm)
      .filter(c => !selectedCountry || (byCat.get(c)||[]).some(q=>questionInvolvesCountry(q, selectedCountry)))
      .sort();
    cats.forEach(c => {
      const li = document.createElement('li');
      li.className = 'geoscore-item' + (c===selectedCat ? ' selected' : '');
      li.textContent = `${c} (${byCat.get(c).length})`;
      li.addEventListener('click', ()=>{
        selectedCat = c;
        const qs = (byCat.get(c) || []).slice().sort((a,b)=> String(a.question).localeCompare(String(b.question)));
        selectedQuestion = qs[0] || null;
        renderCategories();
        renderQuestions();
        renderAnswers();
      });
      ul.appendChild(li);
    });
    catUI.body.appendChild(ul);
  }

  function renderQuestions(){
    qUI.body.innerHTML = '';
    // Show active answer filter (if any)
    if(selectedAnswerFilter){
      const filterBar = document.createElement('div');
      filterBar.style.display='flex'; filterBar.style.gap='8px'; filterBar.style.alignItems='center'; filterBar.style.marginBottom='6px';
      const tag = document.createElement('span'); tag.textContent = `Filtered by answer: ${selectedAnswerFilter}`; tag.style.fontWeight='600';
      const clear = document.createElement('button'); clear.type='button'; clear.textContent='Clear'; clear.style.fontSize='12px';
      clear.addEventListener('click', ()=>{ selectedAnswerFilter=''; renderQuestions(); });
      filterBar.append(tag, clear);
      qUI.body.appendChild(filterBar);
    }
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    // Pool all questions across categories (since Categories column is removed)
    const pooled = [];
    for(const arr of byCat.values()){ Array.isArray(arr) && pooled.push(...arr); }
    const qs = pooled
      .filter(q=> !selectedCountry || questionInvolvesCountry(q, selectedCountry))
      .filter(q=> !selectedAnswerFilter || (Array.isArray(q.answers) && q.answers.some(a=> String(a && a.answer||'') === selectedAnswerFilter)))
      .slice().sort((a,b)=> String(a.question).localeCompare(String(b.question)));
    qs.forEach(q => {
      const li = document.createElement('li');
      const sel = (selectedQuestion && selectedQuestion.question === q.question);
      li.className = 'geoscore-item' + (sel ? ' selected' : '');
      // Row content with optional Exclude button
      const text = document.createElement('span');
      // Normalize display of country-city questions (e.g., Congo (Brazzaville) -> Republic of the Congo)
      (function(){
        const m = /^\s*Name a city in\s+(.+)$/i.exec(String(q.question||''));
        if(m && m[1]){
          const disp = normalizeCountryName(m[1].trim());
          text.textContent = `Name a city in ${disp}`;
        } else {
          text.textContent = q.question;
        }
      })();
      li.appendChild(text);
      if(selectedCat === 'Country Cities'){
        const btn = document.createElement('button');
        btn.type='button'; btn.textContent='Exclude';
        btn.style.marginLeft='8px'; btn.style.fontSize='12px';
        btn.addEventListener('click', (e)=>{
          e.stopPropagation();
          const m = /^\s*Name a city in\s+(.+)$/i.exec(String(q.question||''));
          const target = m && m[1] ? m[1].trim() : '';
          excludeItem('Country Cities', target);
          // Rebuild maps and re-render
          // Reconstruct byCat for Country Cities only
          const orig = tmpByCat.get('Country Cities')||[];
          const bestByName = new Map();
          for(const qq of orig){
            const mm = /^\s*Name a city in\s+(.+)$/i.exec(String(qq.question||''));
            const targ = mm && mm[1] ? mm[1].trim() : '';
            const key = normalizeCountryName(targ);
            if(isExcluded('Country Cities', key)) continue;
            if(!bestByName.has(key)) bestByName.set(key, qq);
            else{
              const prev = bestByName.get(key);
              const lenA = Array.isArray(prev.answers)?prev.answers.length:0;
              const lenB = Array.isArray(qq.answers)?qq.answers.length:0;
              if(lenB > lenA) bestByName.set(key, qq);
            }
          }
          byCat.set('Country Cities', Array.from(bestByName.values()).sort((a,b)=> String(a.question).localeCompare(String(b.question))));
          renderQuestions();
          // If current selection got excluded, clear answers panel
          if(selectedQuestion && selectedQuestion.question === q.question){ selectedQuestion = null; renderAnswers(); }
        });
        li.appendChild(btn);
      }

      // Remove a single question (applies globally). Only show if a country/state is selected
      if(selectedCountry && questionInvolvesCountry(q, selectedCountry)){
        const rmQBtn = document.createElement('button');
        rmQBtn.type='button'; rmQBtn.textContent='Remove';
        rmQBtn.style.marginLeft='8px'; rmQBtn.style.fontSize='12px';
        rmQBtn.addEventListener('click', async (e)=>{
          e.stopPropagation();
          const ok = confirm(`Remove this question globally?\n\n${q.question}`);
          if(!ok) return;
          try{
            await apiFetch('/api/geoscore/remove-question', {
              method:'POST', headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify({ questionKey: q.question })
            });
          }catch{}
          // Remove from category maps locally
          try{
            for(const [cat, arr] of byCat.entries()){
              const idx = arr.indexOf(q);
              if(idx>=0) arr.splice(idx,1);
            }
            for(const [cat, arr] of tmpByCat.entries()){
              const idx = arr.indexOf(q);
              if(idx>=0) arr.splice(idx,1);
            }
          }catch{}
          // Update selection and re-render
          if(selectedQuestion && selectedQuestion.question === q.question){ selectedQuestion = null; }
          renderQuestions();
          renderAnswers();
        });
        li.appendChild(rmQBtn);
      }
      li.title = q.question;
      li.addEventListener('click', ()=>{
        selectedQuestion = q;
        renderQuestions();
        renderAnswers();
      });
      ul.appendChild(li);
    });
    qUI.body.appendChild(ul);

    // Manage exclusions UI for Country Cities
    if(selectedCat === 'Country Cities'){
      const manage = document.createElement('div');
      manage.style.marginTop='8px'; manage.style.fontSize='12px';
      const btn = document.createElement('button'); btn.type='button'; btn.textContent='Manage Exclusions'; btn.style.fontSize='12px';
      btn.addEventListener('click', ()=>{
        const ex = readExclusions();
        const cur = Object.keys((ex && ex['Country Cities'])||{}).join(', ');
        const val = prompt('Excluded countries (comma-separated, by name):', cur);
        if(val!==null){
          const nextSet = {};
          val.split(',').map(s=>normalizeCountryName(s.trim())).filter(Boolean).forEach(k=> nextSet[k]=true);
          ex['Country Cities'] = nextSet;
          writeExclusions(ex);
          // Rebuild
          const orig = tmpByCat.get('Country Cities')||[];
          const bestByName = new Map();
          for(const qq of orig){
            const mm = /^\s*Name a city in\s+(.+)$/i.exec(String(qq.question||''));
            const targ = mm && mm[1] ? mm[1].trim() : '';
            const key = normalizeCountryName(targ);
            if(isExcluded('Country Cities', key)) continue;
            if(!bestByName.has(key)) bestByName.set(key, qq);
            else{
              const prev = bestByName.get(key);
              const lenA = Array.isArray(prev.answers)?prev.answers.length:0;
              const lenB = Array.isArray(qq.answers)?qq.answers.length:0;
              if(lenB > lenA) bestByName.set(key, qq);
            }
          }
          byCat.set('Country Cities', Array.from(bestByName.values()).sort((a,b)=> String(a.question).localeCompare(String(b.question))));
          renderQuestions();
          renderAnswers();
        }
      });
      manage.appendChild(btn);
      qUI.body.appendChild(manage);
    }
  }

  function renderAnswers(){
    ansUI.body.innerHTML = '';
    if(!selectedQuestion){
      const p = document.createElement('p');
      p.textContent = 'Choose a question to view answers.';
      ansUI.body.appendChild(p);
      return;
    }
    // Controls removed per request (no bulk zeroing)
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    const qkey = String(selectedQuestion.question||'');
    (selectedQuestion.answers||[]).forEach(a => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.style.cursor = 'pointer';
      name.title = 'Click to filter questions by this answer';
      const display = formatPlaceName(a.answer);
      const count = Number.isFinite(a && a.score) ? a.score : (a.count || 0);
      name.textContent = display;
      li.appendChild(name);
      // Weight input 0..100
      const weightWrap = document.createElement('span');
      weightWrap.style.marginLeft = '8px'; weightWrap.style.opacity = '0.9';
      const wInput = document.createElement('input');
      wInput.type = 'number'; wInput.min = '0'; wInput.max = '100'; wInput.step = '1';
      wInput.value = String(Math.max(0, Math.min(100, Math.round(count||0))));
      wInput.style.width = '64px'; wInput.title = 'Weight 0–100';
      weightWrap.appendChild(wInput);
      li.appendChild(weightWrap);

      // Edit + Remove buttons
      const editBtn = document.createElement('button');
      editBtn.type='button'; editBtn.textContent='Edit'; editBtn.style.marginLeft='8px'; editBtn.style.fontSize='12px';
      li.appendChild(editBtn);

      const rmBtn = document.createElement('button');
      rmBtn.type='button'; rmBtn.textContent='Remove'; rmBtn.style.marginLeft='8px'; rmBtn.style.fontSize='12px';
      li.appendChild(rmBtn);

      const originalKey = String(a._orig || a.answer || '');
      // Filter questions by clicking the answer name
      name.addEventListener('click', ()=>{ selectedAnswerFilter = String(a && a.answer || ''); renderQuestions(); });

      // Edit via prompt (no inline editing)
      editBtn.addEventListener('click', ()=>{
        const val = prompt('Edit answer name:', a.answer);
        if(val && val.trim() && val.trim() !== a.answer){
          writeAnswerOverride(qkey, originalKey, val.trim());
          a.answer = val.trim();
          name.textContent = a.answer;
        }
      });

      // Persist weight edits
      function persistWeight(){
        const val = Math.max(0, Math.min(100, Math.round(Number(wInput.value)||0)));
        wInput.value = String(val);
        a.score = val; a.count = val;
        writeAnswerWeightOverride(qkey, originalKey, val);
      }
      wInput.addEventListener('change', persistWeight);
      wInput.addEventListener('blur', persistWeight);

      // Persist removal
      rmBtn.addEventListener('click', async ()=>{
        const ok = confirm(`Remove "${a.answer}" from this question? This persists on the server.`);
        if(!ok) return;
        try{
          await apiFetch('/api/geoscore/remove-answer', {
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ questionKey: qkey, originalAnswer: originalKey })
          });
        }catch{}
        try{
          const arr = selectedQuestion.answers || [];
          const idx = arr.indexOf(a);
          if(idx >= 0){ arr.splice(idx,1); }
        }catch{}
        renderAnswers();
      });
      ul.appendChild(li);
    });
    ansUI.body.appendChild(ul);
  }

  // Initial realm and selection
  selectedRealm = 'World';
  selectedCountry = countriesData[0] ? { name: countriesData[0].name, code: countriesData[0].code } : null;
  const initCats = Array.from(byCat.keys()).filter(c => realmForCategory(c)===selectedRealm)
    .filter(c => !selectedCountry || (byCat.get(c)||[]).some(q=>{
      const name = selectedCountry.name;
      const mm = /^\s*Name a city in\s+(.+)$/i.exec(String(q.question||''));
      if(mm && mm[1]){
        const targetNorm = String(mm[1]).trim().toLowerCase();
        return targetNorm === name.toLowerCase() || normalizeCountryName(mm[1].trim()).toLowerCase() === normalizeCountryName(name).toLowerCase();
      }
      if(!selectedCountry.isState){
        const answers = Array.isArray(q.answers)? q.answers : [];
        return answers.some(a => normalizeCountryName(a && a.answer).toLowerCase() === normalizeCountryName(name).toLowerCase());
      }
      return false;
    }))
    .sort();
  selectedCat = initCats[0] || null;
  if(selectedCat){
    const initQs = (byCat.get(selectedCat) || []).filter(q=>{
      const name = selectedCountry.name;
      const mm = /^\s*Name a city in\s+(.+)$/i.exec(String(q.question||''));
      if(mm && mm[1]){
        const targetNorm = String(mm[1]).trim().toLowerCase();
        return targetNorm === name.toLowerCase() || normalizeCountryName(mm[1].trim()).toLowerCase() === normalizeCountryName(name).toLowerCase();
      }
      if(!selectedCountry.isState){
        const answers = Array.isArray(q.answers)? q.answers : [];
        return answers.some(a => normalizeCountryName(a && a.answer).toLowerCase() === normalizeCountryName(name).toLowerCase());
      }
      return false;
    })
      .slice().sort((a,b)=> String(a.question).localeCompare(String(b.question)));
    selectedQuestion = initQs[0] || null;
  }

  renderRealms();
  renderCountries();
  renderQuestions();
  renderAnswers();

}

if (typeof window !== 'undefined') {
  window.initGeoScorePanel = initGeoScorePanel;
}
