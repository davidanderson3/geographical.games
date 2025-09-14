import { loadQuestions } from './geoscore.js';

let usCitiesPromise;
async function getUsCities(){
  if(!usCitiesPromise){
    try{
      usCitiesPromise = fetch('us_cities.json', { cache: 'no-store' })
        .then(res => res.ok ? res.json() : [])
        .catch(()=>[]);
    }catch{
      usCitiesPromise = Promise.resolve([]);
    }
  }
  return usCitiesPromise;
}

export function normalizeAnswer(s){
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
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

async function fetchOverridesForFlags(){
  // Try API first, then static file, else empty
  try{ const r=await fetch('/api/geoscore-overrides',{cache:'no-store'}); if(r.ok) return r.json(); }catch{}
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

function createFlagTypingCard(options, onAnswered, allSuggestions, getScore){
  // options: [{ name, flagSvg, flagPng }...]
  const wrap = document.createElement('div');
  wrap.className = 'geoscore-qcard';
  const title = document.createElement('div');
  title.className = 'geoscore-qtitle';
  title.textContent = 'Pick a flag: type the country name of any one shown';
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
  const input = document.createElement('input'); input.type='text'; input.placeholder='Type country name'; input.autocomplete='off';
  const submitBtn = document.createElement('button'); submitBtn.type='button'; submitBtn.textContent='Submit'; submitBtn.className='gs-btn';
  const skipBtn = document.createElement('button'); skipBtn.type='button'; skipBtn.textContent="I don't know"; skipBtn.className='gs-btn gs-btn-secondary';
  const listId = `gs-flag-suggest-${Math.random().toString(36).slice(2)}`;
  const datalist = document.createElement('datalist'); datalist.id=listId; input.setAttribute('list', listId);
  const feedback = document.createElement('div'); feedback.className='geoscore-feedback';

  function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(); }
  const valid = new Set(options.map(o=> norm(o.name)));
  function updateSuggestions(val){
    while(datalist.firstChild) datalist.firstChild.remove();
    const v = norm(val);
    if(v.length < 2) return;
    const hits = (allSuggestions||[]).filter(n=> norm(n).includes(v)).slice(0, 30);
    for(const h of hits){ const opt=document.createElement('option'); opt.value=h; datalist.appendChild(opt); }
  }
  input.addEventListener('input', ()=> updateSuggestions(input.value));

  let locked=false; function lock(){ locked=true; input.disabled=true; submitBtn.disabled=true; skipBtn.disabled=true; }
  function submit(){
    if(locked) return;
    const v = norm(input.value);
    if(!v) return;
    if(valid.has(v)){
      // Resolve canonical option name to compute score
      const match = options.find(o => norm(o.name) === v);
      const chosenName = match ? match.name : '';
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
      try{ wrap.dispatchEvent(new CustomEvent('answered',{ detail: { correct:true, score: sc } })); }catch{}
    }else{
      // Show incorrect and reveal labels, keep the selection visible
      try{
        const solved = document.createElement('div');
        solved.className = 'gs-solved-row';
        const txt = document.createElement('span');
        txt.style.color = '#a00'; txt.style.fontWeight='700';
        txt.textContent = '✗ Incorrect';
        if(controls && controls.parentNode===wrap) wrap.replaceChild(solved, controls), solved.appendChild(txt);
      }catch{}
      feedback.textContent='';
      lock();
      // Reveal labels for all flags
      try{ for(const opt of options){ const lbl = labelByName.get(normCountryName(opt.name)); if(lbl) lbl.style.opacity = '1'; } }catch{}
      try{ onAnswered && onAnswered({ correct:false, score:0 }); }catch{}
      try{ wrap.dispatchEvent(new CustomEvent('answered',{ detail: { correct:false, score: 0 } })); }catch{}
    }
  }
  input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') submit(); });
  submitBtn.addEventListener('click', submit);
  skipBtn.addEventListener('click', ()=>{
    if(locked) return;
    lock();
    // Replace the controls with "Don't know (100)"
    try{
      const solvedRow = document.createElement('div');
      solvedRow.className = 'gs-solved-row';
      const solvedText = document.createElement('span');
      solvedText.style.color = '#111827';
      solvedText.style.fontWeight = '700';
      solvedText.textContent = `Don't know (100)`;
      solvedRow.appendChild(solvedText);
      if(controls && controls.parentNode === wrap){ wrap.replaceChild(solvedRow, controls); }
    }catch{}
    // Reveal labels for all flags so user learns the set
    try{ for(const opt of options){ const lbl = labelByName.get(normCountryName(opt.name)); if(lbl) lbl.style.opacity = '1'; } }catch{}
    feedback.textContent = '';
    try{ onAnswered && onAnswered({correct:false, score:100, skipped:true}); }catch{}
  });

  const controls = document.createElement('div');
  controls.className='gs-input-row';
  controls.style.display='grid'; controls.style.gridTemplateColumns='minmax(220px,1fr) auto auto'; controls.style.gap='8px'; controls.style.alignItems='center';
  submitBtn.style.margin='0'; skipBtn.style.margin='0';
  controls.append(input, submitBtn, skipBtn, datalist);

  wrap.append(title, flagsRow, controls, feedback);
  return wrap;
}

function createQuestionCard(q, idx, onAnswered, suggestList, isState=false){
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
  input.autocomplete = 'off';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Submit';
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.textContent = "I don't know";
  const listId = `gs-suggest-${idx}`;
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.setAttribute('list', listId);
  const feedback = document.createElement('div');
  feedback.className = 'geoscore-feedback';

  const answers = (q.answers||[]).map(a => ({ raw:a, key: normalizeAnswer(a.answer) }));
  const answerSet = new Set(answers.map(a=>a.key));
  const CITY_SUGGEST_MIN_POP = 5000;
  const suggestionsSource = isState ? (q.answers || []) : ((suggestList && suggestList.length ? suggestList : q.answers) || []);
  const suggestionsAll = (suggestionsSource)
    .map(a => {
      const raw = typeof a === 'string' ? { answer: a } : a;
      return { raw, key: normalizeAnswer(raw.answer) };
    });
  const suggestions = suggestionsAll
    .filter(entry => {
      const raw = entry.raw || {};
      // If population metadata exists, enforce threshold; otherwise allow
      const pop = raw && raw.meta && Number(raw.meta.population);
      if (Number.isFinite(pop)) return pop >= CITY_SUGGEST_MIN_POP;
      return true;
    });

  function updateSuggestions(val){
    while(datalist.firstChild) datalist.firstChild.remove();
    const v = normalizeAnswer(val);
    if(v.length < 5) return;
    const hits = suggestions.filter(a=> a.key.includes(v)).slice(0,20);
    for(const h of hits){ const opt=document.createElement('option'); opt.value=h.raw.answer; datalist.appendChild(opt);}
  }
  input.addEventListener('input', () => updateSuggestions(input.value));

  let locked = false;
  function lock(){ input.disabled = true; skipBtn.disabled = true; locked = true; }
  function submit(){
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
    // Validate the city exists in our known list
    const chosenAll = suggestionsAll.find(e => e.key === submitKey) || null;
    if(!chosenAll){
      // Treat as incorrect (e.g., valid city from another country/state or an invalid entry)
      feedback.textContent = '✗ Incorrect';
      feedback.style.color = '#a00';
      lock();
      const res = { correct: false, score: 0 };
      try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
      return res;
    }
    // If we know population and it is below threshold, allow retry
    const popVal = chosenAll.raw && chosenAll.raw.meta && Number(chosenAll.raw.meta.population);
    if(Number.isFinite(popVal) && popVal < CITY_SUGGEST_MIN_POP){
      feedback.textContent = `City found but population ${popVal.toLocaleString()} < ${CITY_SUGGEST_MIN_POP}. Try another.`;
      feedback.style.color = '#a00';
      try{ input.focus(); input.select(); }catch{}
      return;
    }

    input.value='';
    if(answerSet.has(submitKey)){
      const hit = answers.find(a=>a.key===submitKey);
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
      // Valid city but not on this card's accepted list — explain clearly
      const m = /^\s*Name a city in\s+(.+)$/i.exec(String(q && q.question || ''));
      const region = m && m[1] ? m[1].trim() : '';
      feedback.textContent = region
        ? `City recognized, but this card only accepts a curated list for ${region}. Try a larger or more well‑known city in ${region}.`
        : `City recognized, but this card only accepts a curated list of answers. Try a larger or more well‑known city.`;
      feedback.style.color = '#a00';
      try{ input.focus(); input.select(); }catch{}
      return;
    }
  }
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const res=submit(); wrap.dispatchEvent(new CustomEvent('answered',{detail:res})); }});
  submitBtn.addEventListener('click', ()=>{
    const res = submit();
    wrap.dispatchEvent(new CustomEvent('answered',{detail:res}));
  });
  skipBtn.addEventListener('click', ()=>{
    if(locked) return;
    lock();
    // Replace input row with "Don't know (100)"
    try {
      if (inputRow && inputRow.parentNode === wrap) {
        const solvedRow = document.createElement('div');
        solvedRow.className = 'gs-solved-row';
        const solvedText = document.createElement('span');
        solvedText.style.color = '#111827';
        solvedText.style.fontWeight = '700';
        solvedText.textContent = `Don't know (100)`;
        solvedRow.appendChild(solvedText);
        wrap.replaceChild(solvedRow, inputRow);
      }
    } catch {}
    feedback.textContent = '';
    const res = { correct: false, score: 100, skipped: true };
    try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
    wrap.dispatchEvent(new CustomEvent('answered',{detail:res}));
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
    const includeFlagCard = (currentGameType === 'country');

    // Build flags options if applicable and available
    let flagCard = null;
    if(includeFlagCard){
      // Use the full country list with flags to ensure variety across the whole world
      const poolNames = allFlagNames;
      if(poolNames.length >= 5){
        const targets = pickN(poolNames, 5);
        const opts = targets.map(n=>{
          const iso3 = nameToIso3.get(String(n).toLowerCase());
          const m = (flagsMeta.countries && flagsMeta.countries[iso3]) || {};
          // Fallback to flagcdn using iso2 if svg/png missing
          const iso2 = (m.iso2||'').toLowerCase();
          const fallback = iso2 ? `https://flagcdn.com/w320/${iso2}.png` : '';
          return { name:n, flagSvg:(m.flagSvg||''), flagPng:(m.flagPng||fallback) };
        });
        const onAns = (res)=>{
          if(!res) return;
          answered += 1;
          const s = Math.max(0, Math.min(100, Number(res.score)||0));
          total += s;
          scoreEl.textContent = `Score: ${total}`;
          if(answered >= targetCount){ showRoundComplete(total, roundMax); }
        };
        const getScore = (name)=> (flagScoreMap.get(normCountryName(name)) || 0);
        flagCard = createFlagTypingCard(opts, onAns, allFlagNames, getScore);
      }
    }

    // Determine how many normal questions to pick so total cards = 6 with flag as last
    const normalCount = Math.min((flagCard?5:6), pool.length);
    const picked = pickN(pool, normalCount);

    const roundMax = 600; // always 6 cards * 100
    scoreEl.textContent = `Score: 0`;
    const sugg = currentGameType === 'state' ? await getUsCities() : null;

    // Interleave: start with a flag card if present, then distribute roughly evenly
    const cards = [];
    picked.forEach((q)=>{ cards.push({ type:'text', q }); });
    if(flagCard) cards.push({ type:'flag', el: flagCard });

    const targetCount = cards.length;
    cards.forEach((item, idx) =>{
      if(item.type==='flag'){
        // Wrap onAns to detect completion
        const el = item.el;
        const origHandler = el.__onAnsweredFlag;
        grid.appendChild(el);
      } else {
        const q = item.q;
        const perQMax = Math.max(0, ...((q.answers||[]).map(a => Number(a.score)||0)));
        const normDen = perQMax > 0 ? perQMax : 100;
        const onAnswered = (res)=>{
          if(!res) return;
          answered += 1;
          const raw = Number(res.score)||0;
          const norm = Math.max(0, Math.min(100, Math.round((raw / normDen) * 100)));
          total += norm;
          const pct = Math.round((total / roundMax) * 100);
          scoreEl.textContent = `Score: ${total}`;
          if(answered >= targetCount){ showRoundComplete(total, roundMax); }
        };
        const card = createQuestionCard(q, idx, onAnswered, sugg, currentGameType === 'state');
        grid.appendChild(card);
      }
    });

    // Flag completion handled in onAns
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
