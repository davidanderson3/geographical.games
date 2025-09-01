import { loadQuestions } from './geoscore.js';

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

function createQuestionCard(q, idx, onAnswered){
  const wrap = document.createElement('div');
  wrap.className = 'geoscore-qcard';
  const title = document.createElement('div');
  title.className = 'geoscore-qtitle';
  title.textContent = `Q${idx+1}. ${q.question}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type answer (5+ letters for suggestions)';
  input.autocomplete = 'off';
  const skipBtn = document.createElement('button');
  skipBtn.textContent = "I don't know";
  skipBtn.style.marginLeft = '6px';
  const listId = `gs-suggest-${idx}`;
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.setAttribute('list', listId);
  const feedback = document.createElement('div');
  feedback.className = 'geoscore-feedback';

  const answers = (q.answers||[]).map(a => ({ raw:a, key: normalizeAnswer(a.answer) }));
  const answerSet = new Set(answers.map(a=>a.key));

  function updateSuggestions(val){
    while(datalist.firstChild) datalist.firstChild.remove();
    const v = normalizeAnswer(val);
    if(v.length < 5) return;
    const hits = answers.filter(a=> a.key.includes(v)).slice(0,20);
    for(const h of hits){ const opt=document.createElement('option'); opt.value=h.raw.answer; datalist.appendChild(opt);}
  }
  input.addEventListener('input', () => updateSuggestions(input.value));

  let locked = false;
  function lock(){ input.disabled = true; skipBtn.disabled = true; locked = true; }
  function submit(){
    const key = normalizeAnswer(input.value);
    if(!key) return;
    input.value='';
    if(answerSet.has(key)){
      const hit = answers.find(a=>a.key===key);
      feedback.textContent = `✓ ${hit.raw.answer} (+${hit.raw.score})`;
      feedback.style.color = '#0a0';
      lock();
      const res = { correct: true, score: hit.raw.score||0 };
      try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
      return res;
    }else{
      feedback.textContent = `✗ Not on the board`;
      feedback.style.color = '#a00';
      lock();
      const res = { correct: false, score: 0 };
      try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
      return res;
    }
  }
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const res=submit(); wrap.dispatchEvent(new CustomEvent('answered',{detail:res})); }});
  skipBtn.addEventListener('click', ()=>{
    if(locked) return;
    feedback.textContent = '— Skipped';
    feedback.style.color = '#555';
    lock();
    const res = { correct: false, score: 0, skipped: true };
    try{ typeof onAnswered === 'function' && onAnswered(res); }catch{}
    wrap.dispatchEvent(new CustomEvent('answered',{detail:res}));
  });

  const inputRow = document.createElement('div');
  inputRow.append(input, skipBtn, datalist);
  wrap.append(title, inputRow, feedback);
  return wrap;
}

let currentGameType = 'country';
function isUSStateName(name){
  const n = String(name||'').toLowerCase();
  const set = new Set([
    'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
    'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
    'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
    'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
    'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
    'wisconsin','wyoming','district of columbia'
  ]);
  return set.has(n);
}
function categorizeQuestion(q){
  const qraw = String(q && q.question || '');
  const m = /^\s*Name a city in\s+(.+)$/i.exec(qraw);
  if(m && m[1]){
    const target = m[1].trim().replace(/^[Tt]he\s+/, '').replace(/[\s\.-]+$/,'');
    const tnorm = target.toLowerCase();
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
  return 'other';
}

export async function initGeoScoreGame(){
  const mount = document.getElementById('geoscoreGame');
  if(!mount) return;
  if(mount.dataset.initialized === '1') return; // don't auto-refresh when opening tab
  mount.innerHTML='';

  const tabs = document.getElementById('geoscoreGameSubtabs');

  const all = await loadQuestions();
  const byType = { country: [], state: [] };
  all.forEach(q=>{ const t=categorizeQuestion(q); if(t==='country') byType.country.push(q); else if(t==='state') byType.state.push(q); });

  const header = document.createElement('div');
  const scoreEl = document.createElement('div');
  let total = 0; let answered = 0;
  header.style.display='flex'; header.style.justifyContent='space-between'; header.style.alignItems='center'; header.style.gap='8px';
  const startBtn = document.createElement('button'); startBtn.textContent='New Round';
  header.append(scoreEl, startBtn);
  mount.appendChild(header);

  const grid = document.createElement('div');
  grid.style.display='grid'; grid.style.gridTemplateColumns='1fr'; grid.style.gap='10px';
  mount.appendChild(grid);
  function buildRound(){
    const pool = byType[currentGameType] || [];
    const picked = pickN(pool, Math.min(6, pool.length));
    const maxPossible = picked.reduce((sum, q) => {
      const max = Math.max(0, ...((q.answers||[]).map(a => Number(a.score)||0)));
      return sum + (isFinite(max) ? max : 0);
    }, 0);
    grid.innerHTML=''; total=0; answered=0; scoreEl.textContent = `Score: 0 / ${maxPossible}`;
    picked.forEach((q, i) =>{
      const card = createQuestionCard(q, i, (res)=>{
        if(!res) return;
        answered += 1;
        total += res.score||0;
        scoreEl.textContent = `Score: ${total} / ${maxPossible}`;
      });
      grid.appendChild(card);
    });
  }
  startBtn.addEventListener('click', buildRound);
  scoreEl.textContent = 'Score: 0';

  if(tabs){
    tabs.querySelectorAll('.subtab-button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        tabs.querySelectorAll('.subtab-button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        currentGameType = (btn.dataset.mode==='us') ? 'state' : 'country';
        grid.innerHTML=''; total=0; answered=0; scoreEl.textContent='Score: 0';
        try{
          const url = new URL(location.href);
          url.searchParams.set('gs', btn.dataset.mode);
          history.replaceState({ tab:'geoscoreGame', gs: btn.dataset.mode }, '', url);
        }catch{}
      });
    });
    try{
      const params = new URLSearchParams(location.search);
      const gs = params.get('gs');
      const initBtn = tabs.querySelector(`.subtab-button[data-mode="${gs}"]`) || tabs.querySelector('.subtab-button[data-mode="world"]');
      if(initBtn){
        tabs.querySelectorAll('.subtab-button').forEach(b=>b.classList.remove('active'));
        initBtn.classList.add('active');
        currentGameType = (initBtn.dataset.mode==='us') ? 'state' : 'country';
      }
    }catch{}
  }

  mount.dataset.initialized = '1';
}

if(typeof window!=='undefined') window.initGeoScoreGame = initGeoScoreGame;
