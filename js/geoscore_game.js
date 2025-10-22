import { loadQuestions } from './geoscore.js';
import { apiFetch } from './apiClient.js';

const STATE_NAME_TO_CODE = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA', 'colorado': 'CO',
  'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA',
  'maine': 'ME', 'maryland': 'MD', 'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
  'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR',
  'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR'
};

let usCitiesPromise;
let usCitiesMetaByKey = null;

export function normalizeAnswer(s){
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const DONT_KNOW_KEYS = new Set(['i dont know', 'dont know', 'idk', 'i do not know']);

function isDontKnowValue(value){
  if(value == null) return false;
  return DONT_KNOW_KEYS.has(normalizeAnswer(value));
}

function normalizeSuggestionEntry(entry, idx){
  if(!entry) return null;
  let label = '';
  let score = 0;
  let count = 0;
  if(typeof entry === 'string'){
    label = entry;
  } else if(entry && typeof entry === 'object'){
    if(entry.answer){
      label = String(entry.answer);
      score = Number(entry.score) || 0;
      count = Number(entry.count) || 0;
    } else if(entry.name){
      label = String(entry.name);
      score = Number(entry.score) || 0;
      count = Number(entry.count) || 0;
    } else if(entry._orig){
      label = String(entry._orig);
      score = Number(entry.score) || 0;
      count = Number(entry.count) || 0;
    }
  }
  if(!label) return null;
  return { label, score, count, idx };
}

function computeTopAnswerEntries(list, limit = 5){
  const normalized = [];
  if(Array.isArray(list)){
    list.forEach((entry, idx)=>{
      const norm = normalizeSuggestionEntry(entry, idx);
      if(norm) normalized.push(norm);
    });
  }
  normalized.sort((a, b)=>{
    if(b.score !== a.score) return b.score - a.score;
    if(b.count !== a.count) return b.count - a.count;
    return a.idx - b.idx;
  });
  return normalized.slice(0, limit);
}

function renderDontKnowSuggestions(parent, answers){
  if(!parent) return;
  const topEntries = computeTopAnswerEntries(answers, 5);
  if(!topEntries.length) return;
  const existing = parent.querySelector('.gs-suggestion-panel');
  if(existing) existing.remove();
  const panel = document.createElement('div');
  panel.className = 'gs-suggestion-panel';
  panel.style.marginTop = '8px';
  panel.style.padding = '10px';
  panel.style.border = '1px solid #dbeafe';
  panel.style.borderRadius = '6px';
  panel.style.background = '#f8fafc';
  panel.style.fontSize = '0.95rem';

  const could = document.createElement('div');
  could.style.fontWeight = '600';
  could.style.marginBottom = '4px';
  could.textContent = 'You could have said:';
  panel.appendChild(could);

  const sampleList = document.createElement('ul');
  sampleList.style.margin = '0 0 8px 18px';
  sampleList.style.padding = '0';
  const sampleEntries = topEntries.slice(0, Math.min(3, topEntries.length));
  sampleEntries.forEach(entry=>{
    const li = document.createElement('li');
    li.textContent = entry.label;
    sampleList.appendChild(li);
  });
  panel.appendChild(sampleList);

  const topLabel = document.createElement('div');
  topLabel.style.fontWeight = '600';
  topLabel.style.marginBottom = '4px';
  topLabel.textContent = 'Top answers:';
  panel.appendChild(topLabel);

  const topList = document.createElement('ol');
  topList.style.margin = '0';
  topList.style.padding = '0 0 0 18px';
  topEntries.forEach(entry=>{
    const li = document.createElement('li');
    const scoreText = entry.score > 0 ? ` (score ${entry.score})` : '';
    li.textContent = `${entry.label}${scoreText}`;
    topList.appendChild(li);
  });
  panel.appendChild(topList);

  parent.appendChild(panel);
}

function normalizeCityRecord(item){
  if(!item) return null;
  if(typeof item === 'string'){
    return { name: item, states: [], maxPopulation: null };
  }
  if(typeof item === 'object'){
    if(typeof item.name === 'string'){
      return {
        name: item.name,
        states: Array.isArray(item.states) ? item.states : [],
        maxPopulation: item.maxPopulation
      };
    }
    if(typeof item.answer === 'string'){
      return {
        name: item.answer,
        states: [],
        maxPopulation: item.meta && item.meta.population
      };
    }
  }
  return null;
}

function buildUsCitiesMeta(list){
  const meta = new Map();
  for(const item of (Array.isArray(list)?list:[])){
    const record = normalizeCityRecord(item);
    if(!record || !record.name) continue;
    const key = normalizeAnswer(record.name);
    const states = Array.isArray(record.states) ? record.states.map(state => ({
      stateCode: state && state.stateCode ? String(state.stateCode).toUpperCase() : null,
      stateName: state && state.stateName ? String(state.stateName) : null,
      population: Number(state && state.population)
    })) : [];
    const byState = new Map();
    let maxPopulation = Number(record.maxPopulation);
    if(!Number.isFinite(maxPopulation)) maxPopulation = 0;
    for(const state of states){
      if(!Number.isFinite(state.population)) state.population = 0;
      if(state.stateCode) byState.set(state.stateCode, state);
      if(state.population > maxPopulation) maxPopulation = state.population;
    }
    meta.set(key, {
      name: record.name,
      maxPopulation,
      states,
      byState
    });
  }
  return meta;
}

async function getUsCities(){
  if(!usCitiesPromise){
    usCitiesPromise = (async () => {
      try{
        const res = await fetch('us_cities.json', { cache: 'no-store' });
        if(res && res.ok){
          const data = await res.json();
          usCitiesMetaByKey = buildUsCitiesMeta(data);
          return Array.from(usCitiesMetaByKey.values()).map(entry => ({
            name: entry.name,
            states: entry.states,
            maxPopulation: entry.maxPopulation
          }));
        }
      }catch{}
      usCitiesMetaByKey = new Map();
      return [];
    })();
  }
  return usCitiesPromise;
}

function getUsCityMeta(key){
  if(!key) return null;
  const norm = normalizeAnswer(key);
  return usCitiesMetaByKey && usCitiesMetaByKey.get(norm) || null;
}

function pickN(arr, n){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a.slice(0, n);
}

async function loadFlagsMetadata(){
  try{
    const res = await fetch('flags/flags.metadata.json', { cache: 'no-store' });
    if(res.ok) return res.json();
  }catch{}
  return { countries:{}, states:{ byCode:{}, byName:{} } };
}

async function loadCountryList(){
  try{
    const res = await fetch('geolayers-game/public/countries.json', { cache: 'no-store' });
    if(res.ok) return res.json();
  }catch{}
  return [];
}

let __worldCitiesCache = null;
async function loadWorldCityList(){
  if(__worldCitiesCache) return __worldCitiesCache;
  try{
    const res = await fetch('world_cities_5k.json', { cache: 'no-store' });
    if(res.ok){
      const arr = await res.json();
      __worldCitiesCache = Array.isArray(arr) ? arr : [];
      return __worldCitiesCache;
    }
  }catch{}
  // Fallback: build from questions at runtime (less comprehensive)
  try{
    const all = await loadQuestions();
    const set = new Set();
    for(const q of (Array.isArray(all)?all:[])){
      for(const a of (q && q.answers) || []){
        const nm = String(a && a.answer || '').trim();
        if(nm) set.add(nm);
      }
    }
    __worldCitiesCache = Array.from(set);
    return __worldCitiesCache;
  }catch{ return []; }
}

async function fetchOverridesForFlags(){
  // Try API first, then static file, else empty
  try{ const r=await apiFetch('/api/geoscore-overrides',{cache:'no-store'}); if(r.ok) return r.json(); }catch{}
  try{ const r=await fetch('/backend/geoscore-overrides.json',{cache:'no-store'}); if(r.ok) return r.json(); }catch{}
  return { weightByCountry:{}, weightByCity:{} };
}

function normCountryName(s){
  return String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/^the\s+/i,'')
    .trim().toLowerCase();
}

function buildNameToIso3(countries){
  const map = new Map();
  for(const c of (countries||[])){
    if(!c || !c.name || !c.code) continue;
    map.set(String(c.name).toLowerCase(), String(c.code).toUpperCase());
  }
  return map;
}

function createFlagTypingCard(options, onAnswered, allSuggestions, getScore, qIndexForTitle=null, entity='country'){
  // options: [{ name, flagSvg, flagPng }...]
  const wrap = document.createElement('div');
  wrap.className = 'geoscore-qcard';
  const title = document.createElement('div');
  title.className = 'geoscore-qtitle';
  const qTitlePrefix = (Number.isFinite(qIndexForTitle) ? `Q${(qIndexForTitle+1)}. ` : '');
  const noun = entity === 'state' ? 'state' : 'country';
  title.textContent = qTitlePrefix + `Pick a flag: type the ${noun} name of any one shown`;
  const flagsRow = document.createElement('div');
  flagsRow.style.display='grid'; flagsRow.style.gridTemplateColumns='repeat(auto-fit,minmax(100px,1fr))'; flagsRow.style.gap='12px'; flagsRow.style.alignItems='center';
  const cellByName = new Map();
  const labelByName = new Map();
  for(const opt of options){
    const cell = document.createElement('div');
    cell.style.border='1px solid #ddd'; cell.style.borderRadius='6px'; cell.style.background='#fff'; cell.style.padding='6px';
    const img = document.createElement('img');
    img.src = opt.flagSvg || opt.flagPng || '';
    img.alt = opt.name + ' flag';
    img.style.width='100%'; img.style.height='64px';
    img.style.objectFit='contain';
    img.style.background = '#f8fafc';
    img.loading='lazy';
    cell.appendChild(img);
    const label = document.createElement('div');
    label.textContent = opt.name;
    label.className = 'gs-flag-label';
    label.style.fontSize = '12px';
    label.style.textAlign = 'center';
    label.style.marginTop = '4px';
    label.style.opacity = '0';
    label.style.transition = 'opacity 150ms ease-out';
    cell.appendChild(label);
    flagsRow.appendChild(cell);
    try { cellByName.set(normCountryName(opt.name), cell); } catch {}
    try { labelByName.set(normCountryName(opt.name), label); } catch {}
  }
  const input = document.createElement('input'); input.type='text'; input.placeholder='Type country name'; input.autocomplete='new-password'; input.setAttribute('autocapitalize','off'); input.spellcheck=false;
  const submitBtn = document.createElement('button'); submitBtn.type='button'; submitBtn.textContent='Submit'; submitBtn.className='gs-btn';
  const skipBtn = document.createElement('button'); skipBtn.type='button'; skipBtn.textContent="I don't know"; skipBtn.className='gs-btn gs-btn-secondary';
  const listId = `gs-flag-suggest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const datalist = document.createElement('datalist'); datalist.id=listId; input.setAttribute('list', listId);
  const feedback = document.createElement('div'); feedback.className='geoscore-feedback';

  function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }
  const optionNames = options.map(o => String(o && o.name || ''));
  const suggestionPool = (()=>{
    if(Array.isArray(allSuggestions) && allSuggestions.length){
      const arr = Array.from(new Set(allSuggestions.concat(optionNames)));
      return arr.map(n => String(n || ''));
    }
    return optionNames;
  })();
  const valid = new Set(optionNames.map(n=> norm(n)));
  function updateSuggestions(val){
    while(datalist.firstChild) datalist.firstChild.remove();
    const v = norm(val);
    if(v.length < 3) return;
    const hits = suggestionPool.filter(n=> norm(n).includes(v)).slice(0, 30);
    for(const h of hits){ const opt=document.createElement('option'); opt.value=h; datalist.appendChild(opt); }
  }
  input.addEventListener('input', ()=> updateSuggestions(input.value));

  let locked=false; function lock(){ locked=true; input.disabled=true; submitBtn.disabled=true; skipBtn.disabled=true; }
  function presentDontKnow(labelText){
    if(locked) return;
    lock();
    try{
      const solved = document.createElement('div');
      solved.className = 'gs-solved-row';
      solved.style.marginTop = '6px';
      const txt = document.createElement('span');
      txt.style.color = '#a00';
      txt.style.fontWeight='700';
      txt.textContent = labelText || `Don't know (+100)`;
      solved.appendChild(txt);
      if(controls && controls.parentNode===wrap) wrap.replaceChild(solved, controls);
    }catch{}
    try{ for(const opt of options){ const lbl = labelByName.get(normCountryName(opt.name)); if(lbl) lbl.style.opacity = '1'; } }catch{}
    feedback.textContent = '';
    renderDontKnowSuggestions(wrap, options);
    try{ onAnswered && onAnswered({ correct:false, score:100, skipped:true, dontKnow:true }); }catch{}
  }
  function submit(){
    if(locked) return;
    const raw = input.value;
    const v = norm(raw);
    if(!v) return;
    if(isDontKnowValue(raw)){
      presentDontKnow(raw && raw.trim() ? `${raw.trim()} (+100)` : `Don't know (+100)`);
      return;
    }
    const match = options.find(o => norm(o.name) === v);
    if(match){
      // Resolve canonical option name to compute score
      const chosenName = match.name;
      const sc = typeof getScore === 'function' ? (getScore(chosenName) || 0) : 100;
      // Replace controls with solved row showing country and score
      try{
        const solved = document.createElement('div');
        solved.className = 'gs-solved-row';
        const txt = document.createElement('span');
        txt.style.color = '#0a0'; txt.style.fontWeight='700';
        txt.textContent = `✓ ${chosenName} (+${Math.max(0,Math.min(100,Math.round(sc)))} )`;
        solved.appendChild(txt);
        if(controls && controls.parentNode===wrap) wrap.replaceChild(solved, controls);
      }catch{}
      feedback.textContent='';
      lock();
      // Highlight the correct flag cell
      try{
        const cell = cellByName.get(normCountryName(chosenName));
        if(cell){ cell.classList.add('gs-flag-correct'); cell.style.borderColor = '#16a34a'; cell.style.borderWidth='2px'; }
      }catch{}
      // Reveal labels for all flags
      try{ for(const opt of options){ const lbl = labelByName.get(normCountryName(opt.name)); if(lbl) lbl.style.opacity = '1'; } }catch{}
      try{ onAnswered && onAnswered({ correct:true, score: sc }); }catch{}
    }else{
      // Treat any non-option answer as an incorrect guess worth 100 points
      feedback.textContent = '';
      feedback.style.color = '#a00';
      lock();
      try{
        const solved = document.createElement('div');
        solved.className = 'gs-solved-row';
        const txt = document.createElement('span');
        txt.style.color = '#a00'; txt.style.fontWeight='700';
        const shownName = raw && raw.trim() ? raw.trim() : 'Incorrect';
        txt.textContent = `✗ ${shownName} (+100)`;
        solved.appendChild(txt);
        if(controls && controls.parentNode===wrap) wrap.replaceChild(solved, controls);
      }catch{}
      // Reveal labels so the player can see the available options
      try{ for(const opt of options){ const lbl = labelByName.get(normCountryName(opt.name)); if(lbl) lbl.style.opacity = '1'; } }catch{}
      try{ onAnswered && onAnswered({ correct:false, score:100, invalidGuess:true, guess:raw }); }catch{}
    }
  }
  input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') submit(); });
  submitBtn.addEventListener('click', submit);
  skipBtn.addEventListener('click', ()=>{
    if(locked) return;
    presentDontKnow(`Don't know (+100)`);
  });

  const controls = document.createElement('div');
  controls.className='gs-input-row';
  controls.style.display='grid'; controls.style.gridTemplateColumns='minmax(220px,1fr) auto auto'; controls.style.gap='8px'; controls.style.alignItems='center';
  submitBtn.style.margin='0'; skipBtn.style.margin='0';
  controls.append(input, submitBtn, skipBtn, datalist);

  wrap.append(title, flagsRow, controls, feedback);
  return wrap;
}

function createQuestionCard(q, idx, onAnswered, suggestList, isState=false, globalCitySet=null){
  const wrap = document.createElement('div');
  wrap.className = 'geoscore-qcard';
  const title = document.createElement('div');
  title.className = 'geoscore-qtitle';
  // Fix display for Congo naming
  function formatQuestionText(s){
    let t = String(s||'');
    t = t.replace(/Congo \(Brazzaville\)/gi, 'Republic of the Congo');
    t = t.replace(/Congo \(Kinshasa\)/gi, 'Democratic Republic of the Congo');
    return t;
  }
  title.textContent = `Q${idx+1}. ${formatQuestionText(q.question)}`;
  const input = document.createElement('input');
  input.type = 'text';
  // Leave placeholder blank per request
  input.placeholder = '';
  input.autocomplete = 'new-password'; input.setAttribute('autocapitalize','off'); input.spellcheck=false;
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Submit';
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.textContent = "I don't know";
  const listId = `gs-suggest-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`;
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.setAttribute('list', listId);
  const feedback = document.createElement('div');
  feedback.className = 'geoscore-feedback';

  const isStateMode = Boolean(isState);
  const locationLabelMatch = isStateMode ? /^Name a city in\s+(.+)$/.exec(String(q.question||'')) : null;
  const locationLabel = locationLabelMatch ? locationLabelMatch[1] : null;
  const locationKey = locationLabel ? normalizeAnswer(locationLabel) : '';
  const stateCode = locationKey ? (STATE_NAME_TO_CODE[locationKey] || null) : null;

  const answers = (q.answers||[]).map(a => ({ raw:a, key: normalizeAnswer(a.answer) }));
  const answerSet = new Set(answers.map(a=>a.key));
  const answerLookup = new Map();
  for(const entry of answers){
    try{ answerLookup.set(entry.key, entry.raw); }catch{}
  }
  function populationForKey(key, overrideStateCode = stateCode){
    if(!isStateMode) return null;
    const raw = answerLookup.get(key);
    const popFromAnswer = extractPopulation(raw);
    if(Number.isFinite(popFromAnswer)) return popFromAnswer;
    const globalMeta = getUsCityMeta(key);
    if(globalMeta){
      const targetCode = overrideStateCode || null;
      if(targetCode && globalMeta.byState && globalMeta.byState.has(targetCode)){
        const byState = globalMeta.byState.get(targetCode);
        if(byState && Number.isFinite(byState.population)) return byState.population;
      }
      if(Number.isFinite(globalMeta.maxPopulation)) return globalMeta.maxPopulation;
    }
    return null;
  }
  function extractPopulation(raw){
    if(!raw) return null;
    const metaPop = raw && raw.meta && Number(raw.meta.population);
    if(Number.isFinite(metaPop)) return metaPop;
    const direct = Number(raw.population);
    if(Number.isFinite(direct)) return direct;
    return null;
  }
  function describeCityLocation(meta, fallbackLabel=null){
    if(!isStateMode) return fallbackLabel ? ` in ${fallbackLabel}` : '';
    if(meta && stateCode && meta.byState && meta.byState.has(stateCode)){
      const info = meta.byState.get(stateCode);
      if(info && info.stateName) return ` in ${info.stateName}`;
    }
    if(meta && Array.isArray(meta.states) && meta.states.length){
      const info = meta.states.find(s => s && s.stateName) || meta.states[0];
      if(info && info.stateName) return ` in ${info.stateName}`;
    }
    if(fallbackLabel) return ` in ${fallbackLabel}`;
    return '';
  }
  const CITY_SUGGEST_MIN_POP = 5000;
  // Prefer provided suggestList (e.g., global US cities in state mode); fallback to this question's answers
  const suggestionsSource = ((suggestList && suggestList.length ? suggestList : q.answers) || []);
  const suggestionsAll = suggestionsSource
    .map(item => {
      if(item == null) return null;
      let raw;
      if(typeof item === 'string'){
        raw = { answer: item };
      }else if(typeof item === 'object'){
        if(typeof item.answer === 'string'){
          raw = item;
        }else if(typeof item.name === 'string'){
          raw = { answer: item.name, meta: item.meta };
        }else{
          return null;
        }
      }else{
        return null;
      }
      const key = normalizeAnswer(raw.answer);
      if(!key) return null;
      const globalMeta = isStateMode ? getUsCityMeta(key) : null;
      return { raw, key, globalMeta };
    })
    .filter(Boolean);
  const suggestions = isStateMode
    ? suggestionsAll.filter(entry => {
        const pop = populationForKey(entry.key);
        if(Number.isFinite(pop)) return pop >= CITY_SUGGEST_MIN_POP;
        const meta = entry.globalMeta;
        if(!meta || !stateCode || !meta.byState) return false;
        const info = meta.byState.get ? meta.byState.get(stateCode) : null;
        if(!info || !Number.isFinite(info.population)) return false;
        return info.population >= CITY_SUGGEST_MIN_POP;
      })
    : suggestionsAll;

  function updateSuggestions(val){
    while(datalist.firstChild) datalist.firstChild.remove();
    const v = normalizeAnswer(val);
    if(v.length < 3) return;
    const hits = suggestions.filter(a=> a.key.includes(v)).slice(0,20);
    for(const h of hits){ const opt=document.createElement('option'); opt.value=h.raw.answer; datalist.appendChild(opt);}
  }
  input.addEventListener('input', () => updateSuggestions(input.value));

  let locked = false;
  function lock(){ input.disabled = true; skipBtn.disabled = true; locked = true; }
  function completeDontKnow(labelText){
    if(locked) return;
    lock();
    try {
      if (inputRow && inputRow.parentNode === wrap) {
        const solvedRow = document.createElement('div');
        solvedRow.className = 'gs-solved-row';
        solvedRow.style.marginTop = '6px';
        const solvedText = document.createElement('span');
        solvedText.style.color = '#a00';
        solvedText.style.fontWeight = '700';
        solvedText.textContent = labelText || `Don't know (+100)`;
        solvedRow.appendChild(solvedText);
        wrap.replaceChild(solvedRow, inputRow);
      }
    } catch {}
    feedback.textContent = '';
    renderDontKnowSuggestions(wrap, q && q.answers);
    const res = { correct: false, score: 100, skipped: true, dontKnow: true };
    try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
    return res;
  }
  function submit(){
    if(isDontKnowValue(input.value)){
      const label = input.value && input.value.trim() ? `${input.value.trim()} (+100)` : `Don't know (+100)`;
      completeDontKnow(label);
      return;
    }
    const key = normalizeAnswer(input.value);
    if(!key) return;
    // If not an exact match, try to resolve a single suggestion match (prefix or contains)
    let submitKey = key;
    if(!answerSet.has(submitKey)){
      const pref = suggestions.filter(a=> a.key.startsWith(submitKey));
      const incl = suggestions.filter(a=> a.key.includes(submitKey));
      const chosen = (pref.length===1 ? pref[0] : (incl.length===1 ? incl[0] : null));
      if(chosen){
        input.value = chosen.raw.answer;
        submitKey = normalizeAnswer(chosen.raw.answer);
      }
    }
    const isValidAnswer = answerSet.has(submitKey);
    const answerPop = isStateMode ? populationForKey(submitKey) : null;
    // Validate the city exists in our suggestion pool unless it is a known valid answer
    const chosenFiltered = suggestions.find(e => e.key === submitKey) || null;
    const chosenAll = suggestionsAll.find(e => e.key === submitKey) || null;
    if(!chosenAll && !isValidAnswer){
      feedback.textContent = 'Please choose a city from the suggestions for this question.';
      feedback.style.color = '#a00';
      try{ input.focus(); input.select(); }catch{}
      return;
    }
    if(isStateMode && !chosenFiltered){
      const popVal = populationForKey(submitKey);
      const globalMeta = chosenAll.globalMeta || getUsCityMeta(submitKey);
      const fallbackPop = Number.isFinite(popVal) ? popVal : (globalMeta && Number.isFinite(globalMeta.maxPopulation) ? globalMeta.maxPopulation : null);
      if(isValidAnswer && Number.isFinite(answerPop) && answerPop < CITY_SUGGEST_MIN_POP){
        const hitLabel = answerLookup.get(submitKey)?.answer || input.value;
        const where = locationLabel ? ` in ${locationLabel}` : '';
        feedback.textContent = `${hitLabel}${where} has a population of ${answerPop.toLocaleString()} (< ${CITY_SUGGEST_MIN_POP}). Try another.`;
        feedback.style.color = '#a00';
        try{ input.focus(); input.select(); }catch{}
        return;
      }
      if(!isValidAnswer && Number.isFinite(fallbackPop) && fallbackPop < CITY_SUGGEST_MIN_POP){
        const cityLabel = chosenAll.raw && chosenAll.raw.answer ? chosenAll.raw.answer : input.value;
        const where = describeCityLocation(globalMeta, locationLabel);
        feedback.textContent = `${cityLabel}${where} has a population of ${fallbackPop.toLocaleString()} (< ${CITY_SUGGEST_MIN_POP}). Try another.`;
        feedback.style.color = '#a00';
        try{ input.focus(); input.select(); }catch{}
        return;
      }
      if(!isValidAnswer){
        feedback.textContent = 'Please choose a city from the suggestions for this question.';
        feedback.style.color = '#a00';
        try{ input.focus(); input.select(); }catch{}
        return;
      }
    }
    if(isStateMode){
      let popVal = populationForKey(submitKey);
      if(Number.isFinite(popVal) && popVal < CITY_SUGGEST_MIN_POP){
        const cityLabel = chosenFiltered && chosenFiltered.raw && chosenFiltered.raw.answer ? chosenFiltered.raw.answer : input.value;
        const where = locationLabel ? ` in ${locationLabel}` : '';
        feedback.textContent = `${cityLabel}${where} has a population of ${popVal.toLocaleString()} (< ${CITY_SUGGEST_MIN_POP}). Try another.`;
        feedback.style.color = '#a00';
        try{ input.focus(); input.select(); }catch{}
        return;
      }
    }

    // Do not clear input before we render feedback; preserve for display
    if(answerSet.has(submitKey)){
      const hit = answers.find(a=>a.key===submitKey);
      const hitPop = populationForKey(submitKey);
      if(isStateMode && Number.isFinite(hitPop) && hitPop < CITY_SUGGEST_MIN_POP){
        const cityLabel = hit && hit.raw && hit.raw.answer ? hit.raw.answer : input.value;
        const where = locationLabel ? ` in ${locationLabel}` : '';
        feedback.textContent = `${cityLabel}${where} has a population of ${hitPop.toLocaleString()} (< ${CITY_SUGGEST_MIN_POP}). Try another.`;
        feedback.style.color = '#a00';
        try{ input.focus(); input.select(); }catch{}
        return;
      }
      // Replace the input row with the solved answer and score
      lock();
      try {
        if (inputRow && inputRow.parentNode === wrap) {
          const solvedRow = document.createElement('div');
          solvedRow.className = 'gs-solved-row';
          const solvedText = document.createElement('span');
          solvedText.style.color = '#0a0';
          solvedText.style.fontWeight = '700';
          solvedText.textContent = `✓ ${hit.raw.answer} (+${hit.raw.score})`;
          solvedRow.appendChild(solvedText);
          wrap.replaceChild(solvedRow, inputRow);
        }
      } catch {}
      // Clear feedback to avoid duplicate answer display
      feedback.textContent = '';
      const res = { correct: true, score: hit.raw.score||0 };
      try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
      return res;
    }else{
      // Recognized city, but not valid for this question's region -> mark incorrect (+100) and note region
      lock();
      try {
        if (inputRow && inputRow.parentNode === wrap) {
          const solvedRow = document.createElement('div');
          solvedRow.className = 'gs-solved-row';
          solvedRow.style.marginTop = '6px';
          const solvedText = document.createElement('span');
          solvedText.style.color = '#a00';
          solvedText.style.fontWeight = '700';
          const userTyped = String(input.value || '').trim();
          const m = /^\s*Name a city in\s+(.+)$/i.exec(String(q && q.question || ''));
          const region = m && m[1] ? m[1].trim() : '';
          solvedText.textContent = `✗ ${userTyped} (+100${region ? ` — not in ${region}` : ''})`;
          solvedRow.appendChild(solvedText);
          wrap.replaceChild(solvedRow, inputRow);
        }
      } catch {}
      feedback.textContent = '';
      const res = { correct: false, score: 100 };
      try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
      return res;
    }
  }
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ submit(); }});
  submitBtn.addEventListener('click', ()=>{ submit(); });
  skipBtn.addEventListener('click', ()=>{
    if(locked) return;
    completeDontKnow(`Don't know (+100)`);
  });

  // Single row layout: input | Submit | I don't know
  const inputRow = document.createElement('div');
  inputRow.className = 'gs-input-row';
  inputRow.style.display = 'grid';
  inputRow.style.gridTemplateColumns = 'minmax(220px,1fr) auto auto';
  inputRow.style.gap = '8px';
  inputRow.style.alignItems = 'center';
  submitBtn.style.margin = '0';
  skipBtn.style.margin = '0';
  inputRow.append(input, submitBtn, skipBtn, datalist);
  wrap.append(title, inputRow, feedback);
  return wrap;
}

// Note: mode is maintained per-instance inside initGeoScoreGame
function isUSStateName(name){
  const n = String(name||'').toLowerCase();
  const set = new Set([
    'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
    'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
    'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
    'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
    'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
    'wisconsin','wyoming'
  ]);
  return set.has(n);
}
export function categorizeQuestion(q){
  const qraw = String(q && q.question || '');
  const m = /^\s*Name a city in\s+(.+)$/i.exec(qraw);
  if(m && m[1]){
    const target = m[1].trim().replace(/^[Tt]he\s+/, '').replace(/[\s\.-]+$/,'');
    const tnorm = target.toLowerCase();
    // Exclude District of Columbia from state-city questions
    if(tnorm === 'district of columbia') return 'other';
    if(isUSStateName(tnorm)){
      if(tnorm==='georgia'){
        const ans = ((q && q.answers) || []).map(a=> String(a && a.answer || '').toLowerCase());
        const hints=['tbilisi','batumi','kutaisi','rustavi','poti','gori'];
        const looksCountry = hints.some(h=> ans.some(x=> x.includes(h)));
        return looksCountry ? 'country' : 'state';
      }
      return 'state';
    }
    return 'country';
  }
  if(/^\s*Name a country\b/i.test(qraw)) return 'country';
  if(/^\s*Name a world capital city beginning with the letter [a-z]/i.test(qraw)) return 'capital';
  return 'other';
}

export async function initGeoScoreGame(mountId='geoscoreGame', initialMode=null){
  const mount = document.getElementById(mountId);
  if(!mount) return;
  if(mount.dataset.initialized === '1') return; // don't auto-refresh when opening tab
  mount.innerHTML='';

  const tabs = document.getElementById(mountId + 'Subtabs');

  const all = await loadQuestions();

  const byType = { country: [], state: [] };
  all.forEach(q=>{
    const t = categorizeQuestion(q);
    if(t === 'state') byType.state.push(q);
    else if(t === 'country' || t === 'capital') byType.country.push(q);
  });
  // Build a global set of known city names across all questions for validation
  const globalCitySet = new Set();
  const globalCityListArr = [];
  try{
    for(const q of (Array.isArray(all)?all:[])){
      for(const a of (q && q.answers) || []){
        const nm = String(a && a.answer || '');
        const key = normalizeAnswer(nm);
        if(key){
          if(!globalCitySet.has(key)) globalCityListArr.push(nm);
          globalCitySet.add(key);
        }
      }
    }
  }catch{}
  const globalCityList = globalCityListArr;

  // Build country answer pool for flags mode from Countries category answers
  const countryAnswerSet = new Map(); // name -> max score
  for(const q of byType.country){
    for(const a of (q.answers||[])){
      const nm = String(a && a.answer || '').trim();
      if(!nm) continue;
      const prev = countryAnswerSet.get(nm) || 0;
      const sc = Number(a && a.score) || 0;
      if(sc > prev) countryAnswerSet.set(nm, sc);
    }
  }
  const countryAnswerList = Array.from(countryAnswerSet.keys());
  const countryList = await loadCountryList();
  const nameToIso3 = buildNameToIso3(countryList);
  const flagsMeta = await loadFlagsMetadata();
  const overrides = await fetchOverridesForFlags();
  const weightByCountry = overrides && overrides.weightByCountry ? overrides.weightByCountry : {};
  // Build score map for flags: prefer global country weights, else fallback to question-derived weights
  const flagScoreMap = new Map(); // key: normalized country name -> score
  for(const c of (countryList||[])){
    const raw = String(c && c.name || '');
    const norm = normCountryName(raw);
    const wGlobal = weightByCountry[raw] ?? weightByCountry[norm];
    if(Number.isFinite(wGlobal)) flagScoreMap.set(norm, Math.max(0, Math.min(100, Math.round(wGlobal))));
  }
  for(const [name, sc] of countryAnswerSet.entries()){
    const norm = normCountryName(name);
    if(!flagScoreMap.has(norm)) flagScoreMap.set(norm, Math.max(0, Math.min(100, Math.round(Number(sc)||0))));
  }
  // Build a global pool of countries that have a flag available (svg/png or iso2 fallback)
  const allFlagNames = (countryList || []).filter(c => {
    const rec = flagsMeta && flagsMeta.countries && flagsMeta.countries[c.code];
    return !!(rec && (rec.flagSvg || rec.flagPng || (rec.iso2 && String(rec.iso2).length === 2)));
  }).map(c => c.name);
  // Build a pool of US state names that have a flag (svg available)
  const allStateFlagNames = (()=>{
    try{
      const byName = flagsMeta && flagsMeta.states && flagsMeta.states.byName || {};
      return Object.keys(byName || {}).filter(name => {
        const rec = byName[name];
        return !!(rec && (rec.flagSvg));
      });
    }catch{ return []; }
  })();


  const header = document.createElement('div');
  header.className = 'geoscore-header';
  const controlsWrap = document.createElement('div');
  controlsWrap.className = 'gs-controls';
  const scoreWrap = document.createElement('div');
  scoreWrap.className = 'gs-score-wrap';
  const scoreEl = document.createElement('div');
  scoreEl.className = 'gs-score';
  scoreEl.title = 'Lower is better';
  let total = 0; let answered = 0;
  const startBtn = document.createElement('button'); startBtn.textContent='New Round'; startBtn.classList.add('gs-btn');
  controlsWrap.appendChild(startBtn);
  scoreWrap.appendChild(scoreEl);
  header.append(controlsWrap, scoreWrap);
  mount.appendChild(header);

  // Tip banner
  try{
    const tip = document.createElement('div');
    tip.className = 'gs-tip';
    tip.textContent = 'Choose the rarest answer for a better score.';
    mount.appendChild(tip);
  }catch{}

  function showRoundComplete(finalScore, maxScore){
    try{ document.body.classList.add('mild-glow'); setTimeout(()=>document.body.classList.remove('mild-glow'), 1500);}catch{}
    const overlay = document.createElement('div');
    overlay.className = 'gs-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'gs-modal';
    const h = document.createElement('h3'); h.textContent = 'Round Complete!';
    const p = document.createElement('p'); p.textContent = `Your score: ${finalScore} (lower is better)`;
    const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='8px'; actions.style.justifyContent='flex-end';
    const closeBtn = document.createElement('button'); closeBtn.textContent='Close'; closeBtn.className='gs-btn gs-btn-secondary';
    const againBtn = document.createElement('button'); againBtn.textContent='New Round'; againBtn.className='gs-btn';
    actions.append(closeBtn, againBtn);
    modal.append(h, p, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Simple confetti burst
    try{
      const confWrap = document.createElement('div');
      confWrap.className = 'gs-confetti-wrap';
      overlay.appendChild(confWrap);
      const colors = ['#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6'];
      const count = 50;
      for(let i=0;i<count;i++){
        const dot = document.createElement('div');
        dot.className = 'gs-confetti';
        dot.style.left = Math.random()*100 + '%';
        dot.style.background = colors[i%colors.length];
        dot.style.animationDelay = (Math.random()*0.5)+'s';
        dot.style.opacity = '0.9';
        confWrap.appendChild(dot);
      }
      setTimeout(()=>{ try{ confWrap.remove(); }catch{} }, 2000);
    }catch{}

    function close(){ try{ overlay.remove(); }catch{} }
    closeBtn.addEventListener('click', close);
    againBtn.addEventListener('click', ()=>{ close(); startBtn.click(); });
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) close(); });
  }

  const grid = document.createElement('div');
  grid.style.display='grid'; grid.style.gridTemplateColumns='1fr'; grid.style.gap='10px';
  mount.appendChild(grid);
  // Resolve initial mode
  let currentGameType = (initialMode === 'us') ? 'state' : (initialMode === 'world' ? 'country' : 'country');
  // Only honor URL override if no explicit initialMode provided
  if(initialMode == null){
    try{
      const params = new URLSearchParams(location.search);
      const gs = params.get('gs');
      if(gs === 'us') currentGameType = 'state';
      else if(gs === 'world') currentGameType = 'country';
    }catch{}
  }

  async function buildRound(){
    grid.innerHTML=''; total=0; answered=0;
    const pool = byType[currentGameType] || [];
    const includeFlagCard = (currentGameType === 'country' || currentGameType === 'state');

    // Determine if a flag card can be included (country mode and have enough options)
    const poolNames = (currentGameType === 'country') ? allFlagNames : (currentGameType === 'state' ? allStateFlagNames : []);
    const canIncludeFlag = includeFlagCard && poolNames.length >= 1;

    // Determine how many normal questions to pick so total cards = 6 with flag as last
    const normalCount = Math.min((canIncludeFlag?5:6), pool.length);
    const picked = pickN(pool, normalCount);

    const roundMax = 600; // always 6 cards * 100
    scoreEl.textContent = `Score: 0`;
    const sugg = currentGameType === 'state' ? await getUsCities() : await loadWorldCityList();

    // Build ordered list of cards: first text questions, then flag last
    const cards = [];
    picked.forEach((q)=>{ cards.push({ type:'text', q }); });
    if(canIncludeFlag) cards.push({ type:'flag' });

    const targetCount = cards.length;

    function renderAt(index){
      // Do not clear the grid here; we want previously answered cards to remain visible.
      if(index >= targetCount){
        showRoundComplete(total, roundMax);
        return;
      }
      const item = cards[index];
      if(item.type === 'flag'){
        // Build a fresh flag card for this index so the title shows correct Q#
        const onAns = (res)=>{
          if(!res) return;
          answered += 1;
          const s = Math.max(0, Math.min(100, Number(res.score)||0));
          total += s;
          scoreEl.textContent = `Score: ${total}`;
          if(answered >= targetCount){ showRoundComplete(total, roundMax); }
          else { renderAt(index+1); }
        };
        const isCountryMode = (currentGameType === 'country');
        const getScore = (name)=> isCountryMode ? (flagScoreMap.get(normCountryName(name)) || 0) : 0;
        // Create options with proper flag assets
        const targets = pickN(poolNames, Math.min(5, poolNames.length));
        let opts;
        if(isCountryMode){
          opts = targets.map(n=>{
            const iso3 = nameToIso3.get(String(n).toLowerCase());
            const m = (flagsMeta.countries && flagsMeta.countries[iso3]) || {};
            const iso2 = (m.iso2||'').toLowerCase();
            const fallback = iso2 ? `https://flagcdn.com/w320/${iso2}.png` : '';
            return { name:n, flagSvg:(m.flagSvg||''), flagPng:(m.flagPng||fallback) };
          });
        } else {
          const byName = flagsMeta && flagsMeta.states && flagsMeta.states.byName || {};
          opts = targets.map(n=>{
            const m = byName[n] || {};
            return { name:n, flagSvg:(m.flagSvg||''), flagPng:'' };
          });
        }
        const el = createFlagTypingCard(opts, onAns, poolNames, getScore, index, isCountryMode ? 'country' : 'state');
        grid.appendChild(el);
      } else {
        const q = item.q;
        const onAnswered = (res)=>{
          if(!res) return;
          answered += 1;
          const raw = Number(res.score)||0;
          const s = Math.max(0, Math.min(100, Math.round(raw)));
          total += s;
          scoreEl.textContent = `Score: ${total}`;
          if(answered >= targetCount){ showRoundComplete(total, roundMax); }
          else { renderAt(index+1); }
        };
        const card = createQuestionCard(q, index, onAnswered, sugg, currentGameType === 'state', globalCitySet);
        grid.appendChild(card);
      }
    }

    // Start with the first card
    renderAt(0);
  }
  startBtn.addEventListener('click', () => { buildRound(); });
  scoreEl.textContent = 'Score: 0';

    if(tabs){
      tabs.querySelectorAll('.tab-button').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          tabs.querySelectorAll('.tab-button').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
          btn.classList.add('active');
          btn.setAttribute('aria-selected','true');
          currentGameType = (btn.dataset.mode==='us') ? 'state' : 'country';
          grid.innerHTML=''; total=0; answered=0; scoreEl.textContent='Score: 0';
          try{
            const url = new URL(location.href);
            url.searchParams.set('gs', btn.dataset.mode);
            history.replaceState({ tab:(currentGameType==='state'?'geoscoreUS':'geoscoreWorld'), gs: btn.dataset.mode }, '', url);
          }catch{}
        });
      });
      try{
        const params = new URLSearchParams(location.search);
        const gs = params.get('gs');
        const initBtn = tabs.querySelector(`.tab-button[data-mode="${gs}"]`) || tabs.querySelector('.tab-button[data-mode="world"]');
        if(initBtn){
          tabs.querySelectorAll('.tab-button').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
          initBtn.classList.add('active');
          initBtn.setAttribute('aria-selected','true');
          currentGameType = (initBtn.dataset.mode==='us') ? 'state' : 'country';
        }
      }catch{}
    }

  mount.dataset.initialized = '1';
}

if(typeof window!=='undefined') window.initGeoScoreGame = initGeoScoreGame;
