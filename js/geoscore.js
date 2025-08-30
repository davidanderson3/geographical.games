const STORAGE_KEY = 'geoscoreQuestions';

export const DEFAULT_QUESTIONS = [
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
  }
];

export async function loadQuestions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed;
    }
  } catch {}
  try {
    const res = await fetch('geoscore_questions.json');
    if (res.ok) {
      const data = await res.json();
      saveQuestions(data);
      return data;
    }
  } catch {}
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

  // Categorize questions from their text
  function categorize(question){
    const q = String(question||'').toLowerCase();
    if(q.startsWith('name a city in')) return 'State Cities';
    if(q.includes('capital')) return 'Capital Cities';
    if(q.includes('u.s. state')) return 'US States';
    if(q.includes('country')) return 'Countries';
    return 'Other';
  }

  const byCat = new Map();
  all.forEach((q)=>{
    const c = categorize(q.question);
    if(!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(q);
  });

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
      li.textContent = q.question;
      li.title = q.question;
      li.addEventListener('click', ()=>{
        selectedQuestion = q;
        renderQuestions();
        renderAnswers();
      });
      ul.appendChild(li);
    });
    qUI.body.appendChild(ul);
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
    (selectedQuestion.answers||[]).forEach(a => {
      const li = document.createElement('li');
      li.textContent = `${formatPlaceName(a.answer)} (${a.count || 0})`;
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
