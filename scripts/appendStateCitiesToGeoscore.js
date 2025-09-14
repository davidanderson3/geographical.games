#!/usr/bin/env node
/*
  Append US State Cities questions to geoscore_questions.json without deleting existing data.
  - Reads CSVs from states_wiki/*.csv (columns include stusps, basename, pop2020)
  - Builds/merges questions of the form: "Name a city in <State Name>"
  - Deduplicates answers per question by city name (case-insensitive)
  - Preserves existing questions and answers as-is

  Usage examples:
    node scripts/appendStateCitiesToGeoscore.js
    node scripts/appendStateCitiesToGeoscore.js --min-pop=5000

  Options:
    --min-pop=N     Minimum population threshold (default 5000)
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'geoscore_questions.json');
const STATES_DIR = path.join(ROOT, 'states_wiki');

const ARGS = Object.fromEntries(process.argv.slice(2).map(p=>{
  const m = /^--([^=]+)=(.*)$/.exec(p);
  if(m) return [m[1], m[2]];
  const k = /^--(.+)$/.exec(p);
  return k ? [k[1], 'true'] : [p, 'true'];
}));
const MIN_POP = Number(ARGS['min-pop'] || 5000);

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
  DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky',
  LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana',
  NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee',
  TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming'
};

function scoreForPop(pop){
  const minLog = Math.log10(Math.max(1000, MIN_POP));
  const maxLog = Math.log10(40000000);
  const val = Math.log10(Math.max(pop, MIN_POP));
  const norm = (val - minLog) / (maxLog - minLog);
  return Math.max(1, Math.min(100, Math.round(norm * 99 + 1)));
}

function readExisting(){
  if(!fs.existsSync(OUT_FILE)) return { type:'object', data:{ categories:[], questions:[] } };
  const raw = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  if(Array.isArray(raw)) return { type:'array', data: raw };
  if(raw && Array.isArray(raw.questions)) return { type:'object', data: raw };
  return { type:'array', data: [] };
}

function writeOut(kind, payload){
  if(kind === 'array'){
    // If the original file was an array of questions, keep that format
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  } else {
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  }
}

function safeParseInt(x){ const n = Number(x); return Number.isFinite(n) ? n : parseInt(String(x||'').replace(/[^0-9.-]/g,''),10) || 0; }

function readStateCsv(file){
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const idx = Object.fromEntries(header.map((h,i)=>[h.trim(), i]));
  const out = [];
  for(let i=1;i<lines.length;i++){
    const parts = lines[i].split(',');
    const stusps = parts[idx.stusps] || '';
    const basename = (parts[idx.basename] || '').trim();
    const pop = safeParseInt(parts[idx.pop2020] || '0');
    if(!stusps || !basename) continue;
    if(pop < MIN_POP) continue;
    out.push({ stusps, name: basename, population: pop });
  }
  return out;
}

function buildStateQuestions(){
  const files = fs.readdirSync(STATES_DIR).filter(f=>/^[A-Z]{2}\.csv$/.test(f));
  const byState = new Map();
  for(const f of files){
    const recs = readStateCsv(path.join(STATES_DIR, f));
    for(const r of recs){
      const st = STATE_NAMES[r.stusps];
      if(!st) continue;
      if(!byState.has(st)) byState.set(st, new Map());
      const m = byState.get(st);
      const key = r.name.toLowerCase();
      const prev = m.get(key);
      if(!prev || r.population > prev.population){
        m.set(key, r);
      }
    }
  }
  const questions = [];
  for(const [state, map] of byState.entries()){
    const list = Array.from(map.values()).sort((a,b)=>b.population - a.population);
    const answers = list.map(c => ({ answer: c.name, score: scoreForPop(c.population), count: scoreForPop(c.population) }));
    questions.push({ question: `Name a city in ${state}`, answers });
  }
  return questions;
}

function mergeQuestions(existingQuestions, incoming){
  const byQ = new Map();
  for(const q of existingQuestions){ byQ.set(String(q.question||''), q); }
  let addedQ = 0, addedA = 0;
  for(const inc of incoming){
    const key = String(inc.question||'');
    if(!byQ.has(key)){
      existingQuestions.push(inc);
      byQ.set(key, inc);
      addedQ++;
    } else {
      const tgt = byQ.get(key);
      const have = new Set((tgt.answers||[]).map(a=>String(a && a.answer || '').toLowerCase()));
      for(const a of (inc.answers||[])){
        const k = String(a.answer||'').toLowerCase();
        if(!have.has(k)){
          (tgt.answers = tgt.answers || []).push(a);
          have.add(k);
          addedA++;
        }
      }
    }
  }
  return { addedQ, addedA };
}

function main(){
  const { type, data } = readExisting();
  const questions = Array.isArray(data) ? data : Array.isArray(data.questions) ? data.questions : [];
  const incoming = buildStateQuestions();
  const { addedQ, addedA } = mergeQuestions(questions, incoming);
  if(Array.isArray(data)){
    writeOut(type, questions);
  } else {
    data.questions = questions;
    writeOut(type, data);
  }
  console.log(`Merged state-city questions: +${addedQ} questions, +${addedA} answers (min-pop=${MIN_POP}).`);
}

if(require.main === module){
  try{ main(); } catch(err){ console.error('ERROR:', err); process.exit(1); }
}
