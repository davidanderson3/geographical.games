const STORAGE_KEY = 'geoscoreQuestions';
const ANSWER_OVERRIDES_KEY = 'geoscoreAnswerOverrides';
const EXCLUSIONS_KEY = 'geoscoreExclusions'; // { CategoryName: { normalizedName: true } }

function normalizeQuestionScores(q){
  const answers = Array.isArray(q && q.answers) ? q.answers : [];
  answers.forEach(a => {
    let s = Number(a && a.score);
    if(!isFinite(s)) s = 100;
    s = Math.round(Math.max(0, Math.min(100, s)));
    a.score = s;
    a.count = s;
  });
  return q;
}

function normalizeAllQuestions(list){
  (Array.isArray(list)?list:[]).forEach(normalizeQuestionScores);
}

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
    const answers = list.map((name,i)=>({
      answer: name,
      score: Math.max(1,10-i),
      count: Math.max(1,10-i)
    }));
    if(!answers.length){
      answers.push({ answer: 'None', score: 10, count: 10 });
    }
    while(answers.length < 5){
      const i = answers.length;
      answers.push({ answer: 'None', score: Math.max(1,10-i), count: Math.max(1,10-i) });
    }
    questions.push({
      question: `Name a country that starts with ${letter}`,
      answers
    });
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
    'Madrid','Majuro','Malabo','Male','Manila','Maputo','Maseru','Mbabane','Mexico City','Minsk','Mogadishu','Monaco','Monrovia','Montevideo','Moroni','Moscow','Muscat',
    'Nairobi','Nassau','Naypyidaw','Ngerulmud','Niamey','Nicosia','Nouakchott','Noumea','Nuku\'alofa','Nuuk',
    'Panama City','Paramaribo','Paris','Phnom Penh','Podgorica','Port-au-Prince','Port Louis','Port Moresby','Porto-Novo','Prague','Praia','Pretoria','Pristina','Pyongyang','Palikir',
    'Rabat','Reykjavik','Riga','Riyadh','Rome','Roseau',
    'San Jose','San Marino','San Salvador','Sana\'a','Santiago','Santo Domingo','Sao Tome','Sarajevo','Seoul','Singapore','Skopje','Sofia','South Tarawa','Sri Jayawardenepura Kotte','Stockholm','Sucre','Suva',
    'Tallinn','Tashkent','Tbilisi','Tegucigalpa','Tehran','Thimphu','Tirana','Tokyo','Tripoli','Tunis','Torshavn','Taipei',
    'Vaduz','Valletta','Vatican City','Victoria','Vienna','Vientiane','Vilnius',
    'Warsaw','Washington','Wellington','West Island','Willemstad','Windhoek'
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
      const answers = sorted.map((name,i)=>({
        answer: name,
        score: Math.max(1,10-i),
        count: Math.max(1,10-i)
      }));
      questions.push({
        question: `Name a world capital city beginning with the letter ${letter}`,
        answers
      });
    }
  }
  return questions;
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
  'wisconsin','wyoming','district of columbia'
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
  if(q.includes('european capital')) return 'European Capitals';
  if(q.includes('capital')) return 'Capital Cities';
  if(q.includes('u.s. state')) return 'US States';
  if(q.includes('country')) return 'Countries';
  return 'Other';
}

function readAnswerOverrides(){
  try{ const raw = localStorage.getItem(ANSWER_OVERRIDES_KEY); const obj = raw?JSON.parse(raw):{}; return obj&&typeof obj==='object'?obj:{}; }catch{ return {}; }
}
function writeAnswerOverride(questionKey, originalAnswer, newValue){
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
      const data = await res.json();
      // Apply answer overrides (persisted by admin editing)
      const ov = readAnswerOverrides();
      for(const q of (Array.isArray(data)?data:[])){
        const qkey = String(q && q.question || '');
        const amap = ov[qkey] || {};
        if(Array.isArray(q && q.answers)){
          for(const a of q.answers){
            const orig = String(a && a.answer || '');
            const repl = amap[orig];
            if(repl){ a._orig = orig; a.answer = repl; } else { a._orig = orig; }
          }
        }
      }
      normalizeAllQuestions(data);
      augmentWithCountryLetterQuestions(data);
      augmentWithCapitalLetterQuestions(data);
      saveQuestions(data);
      return data;
    }
  } catch {}
  if (Array.isArray(cached) && cached.length) {
    normalizeAllQuestions(cached);
    augmentWithCountryLetterQuestions(cached);
    augmentWithCapitalLetterQuestions(cached);
    return cached;
  }
  // If nothing stored, seed with defaults
  saveQuestions(DEFAULT_QUESTIONS);
  return JSON.parse(JSON.stringify(DEFAULT_QUESTIONS));
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
      'county','parish','borough','municipality','city','town','village','commune'
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

  // Build 3-column admin: Categories | Questions | Answers
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  const title = document.createElement('h3');
  title.textContent = 'Browse questions by category';
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

  const catUI = makeCol('Categories');
  const qUI = makeCol('Questions');
  const ansUI = makeCol('Answers');
  shell.append(catUI.col, qUI.col, ansUI.col);

  const all = await loadQuestions();

  // Normalize country display names to avoid duplicate variants in the list
  function normalizeCountryName(raw){
    let n = String(raw||'').trim();
    n = n.replace(/^the\s+/i,'');
    const key = n.toLowerCase();
    const aliases = {
      'united states of america':'United States', 'united states':'United States', 'usa':'United States', 'u.s.':'United States',
      'united kingdom':'United Kingdom', 'u.k.':'United Kingdom', 'uk':'United Kingdom', 'great britain':'United Kingdom',
      'czech republic':'Czechia', 'turkiye':'Turkey', 'türkiye':'Turkey',
      'syrian arab republic':'Syria', 'iran (islamic republic of)':'Iran', 'viet nam':'Vietnam',
      'lao people\'s democratic republic':'Laos', 'moldova, republic of':'Moldova',
      'tanzania, united republic of':'Tanzania', 'united republic of tanzania':'Tanzania',
      'china, taiwan province of':'Taiwan', 'china, hong kong sar':'Hong Kong', 'hong kong s.a.r.':'Hong Kong',
      'china, macao sar':'Macao', 'macao s.a.r':'Macao', 'macau':'Macao',
      'republic of serbia':'Serbia',
      'cote d\'ivoire':'Ivory Coast', 'côte d\'ivoire':'Ivory Coast',
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

  // State
  let selectedCat = null;
  let selectedQuestion = null;

  // Render helpers
  function renderCategories(){
    catUI.body.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    const cats = Array.from(byCat.keys()).sort();
    cats.forEach(c => {
      const li = document.createElement('li');
      li.className = 'geoscore-item' + (c===selectedCat ? ' selected' : '');
      li.textContent = `${c} (${byCat.get(c).length})`;
      li.addEventListener('click', ()=>{
        selectedCat = c;
        selectedQuestion = (byCat.get(c)[0] || null);
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
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    const qs = selectedCat ? byCat.get(selectedCat) : [];
    qs.forEach(q => {
      const li = document.createElement('li');
      const sel = (selectedQuestion && selectedQuestion.question === q.question);
      li.className = 'geoscore-item' + (sel ? ' selected' : '');
      // Row content with optional Exclude button
      const text = document.createElement('span');
      text.textContent = q.question;
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
    const ul = document.createElement('ul');
    ul.className = 'geoscore-list';
    const qkey = String(selectedQuestion.question||'');
    (selectedQuestion.answers||[]).forEach(a => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.style.cursor = 'pointer';
      name.title = 'Click to edit';
      const display = formatPlaceName(a.answer);
      const count = a.count || 0;
      name.textContent = display;
      li.appendChild(name);
      const cnt = document.createElement('span');
      cnt.style.opacity='0.7'; cnt.style.marginLeft='6px';
      cnt.textContent = `(${count})`;
      li.appendChild(cnt);

      const originalKey = String(a._orig || a.answer || '');
      function beginEdit(){
        const input = document.createElement('input');
        input.type='text';
        input.value = name.textContent || '';
        input.style.minWidth='160px';
        li.replaceChild(input, name);
        input.focus(); input.select();
        function finish(save){
          const val = input.value.trim();
          if(save && val && val !== display){
            writeAnswerOverride(qkey, originalKey, val);
            a.answer = val;
            // keep original key stable for future merges
          }
          name.textContent = a.answer;
          try{ li.replaceChild(name, input); }catch{}
        }
        input.addEventListener('keydown', (e)=>{
          if(e.key==='Enter'){ finish(true); }
          else if(e.key==='Escape'){ finish(false); }
        });
        input.addEventListener('blur', ()=> finish(true));
      }
      name.addEventListener('click', beginEdit);
      ul.appendChild(li);
    });
    ansUI.body.appendChild(ul);
  }

  // Initialize default selection: prefer 'State Cities' if present
  const initialCat = byCat.has('State Cities') ? 'State Cities' : (Array.from(byCat.keys())[0] || null);
  selectedCat = initialCat;
  selectedQuestion = selectedCat ? (byCat.get(selectedCat)[0] || null) : null;

  renderCategories();
  renderQuestions();
  renderAnswers();

}

if (typeof window !== 'undefined') {
  window.initGeoScorePanel = initGeoScorePanel;
}
