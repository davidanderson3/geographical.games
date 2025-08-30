import { loadQuestions } from './geoscore.js';

function pickN(arr, n){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a.slice(0, n);
}

function createQuestionCard(q, idx){
  const wrap = document.createElement('div');
  wrap.className = 'geoscore-qcard';
  const title = document.createElement('div');
  title.className = 'geoscore-qtitle';
  title.textContent = `Q${idx+1}. ${q.question}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type answer (5+ letters for suggestions)';
  input.autocomplete = 'off';
  const listId = `gs-suggest-${idx}`;
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.setAttribute('list', listId);
  const feedback = document.createElement('div');
  feedback.className = 'geoscore-feedback';

  const norm = s => String(s||'').trim().toLowerCase();
  const answers = (q.answers||[]).map(a => ({ raw:a, key: norm(a.answer) }));
  const answerSet = new Set(answers.map(a=>a.key));

  function updateSuggestions(val){
    while(datalist.firstChild) datalist.firstChild.remove();
    const v = norm(val);
    if(v.length < 5) return;
    const hits = answers.filter(a=> a.key.includes(v)).slice(0,20);
    for(const h of hits){ const opt=document.createElement('option'); opt.value=h.raw.answer; datalist.appendChild(opt);}    
  }
  input.addEventListener('input', () => updateSuggestions(input.value));

  function submit(){
    const key = norm(input.value);
    if(!key) return;
    input.value='';
    if(answerSet.has(key)){
      const hit = answers.find(a=>a.key===key);
      feedback.textContent = `✓ ${hit.raw.answer} (+${hit.raw.score})`;
      feedback.style.color = '#0a0';
      input.disabled = true;
      return { correct: true, score: hit.raw.score||0 };
    }else{
      feedback.textContent = `✗ Not on the board`;
      feedback.style.color = '#a00';
      return { correct: false, score: 0 };
    }
  }
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const res=submit(); wrap.dispatchEvent(new CustomEvent('answered',{detail:res})); }});

  wrap.append(title, input, datalist, feedback);
  return wrap;
}

export async function initGeoScoreGame(){
  const mount = document.getElementById('geoscoreGame');
  if(!mount) return;
  mount.innerHTML='';

  const all = await loadQuestions();
  const picked = pickN(all, Math.min(6, all.length));

  const header = document.createElement('div');
  const scoreEl = document.createElement('div');
  let total = 0; let answered = 0;
  header.style.display='flex'; header.style.justifyContent='space-between'; header.style.alignItems='center';
  const startBtn = document.createElement('button');
  startBtn.textContent = 'New Round';
  startBtn.addEventListener('click', ()=>{ initGeoScoreGame(); });
  scoreEl.textContent = 'Score: 0 / 6';
  header.append(scoreEl, startBtn);
  mount.appendChild(header);

  const grid = document.createElement('div');
  grid.style.display='grid'; grid.style.gridTemplateColumns='1fr'; grid.style.gap='10px';
  mount.appendChild(grid);

  picked.forEach((q, i) =>{
    const card = createQuestionCard(q, i);
    card.addEventListener('answered', (e)=>{
      if(!e.detail) return;
      answered += 1; total += e.detail.score||0;
      scoreEl.textContent = `Score: ${total} / ${picked.length}`;
    });
    grid.appendChild(card);
  });
}

if(typeof window!=='undefined') window.initGeoScoreGame = initGeoScoreGame;

