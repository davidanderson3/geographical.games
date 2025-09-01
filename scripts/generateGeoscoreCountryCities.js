#!/usr/bin/env node
/*
  Build GeoScore questions for countries using existing city points from
  geolayers-game/public/data/<ISO3>/cities.geojson.

  - Question: "Name a city in <CountryName>"
  - Answers: city names (cleaned) with scores based on population weights

  Usage:
    node scripts/generateGeoscoreCountryCities.js                 # all countries in countries.json
    node scripts/generateGeoscoreCountryCities.js BRA MEX         # specific ISO3 codes

  Flags:
    --limit=N|all     Max cities per country (use 'all' or 0 for no limit; default all)
    --min-pop=N       Minimum population threshold (default 0)
    --merge-json      Merge into geoscore_questions.json instead of overwriting
    --force           Write even if some countries are missing cities (skips those)

  Firestore:
    - Writes to collection geoscoreQuestions with doc id = ISO3 (e.g., BRA)
    - Requires serviceAccountKey.json at repo root
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');
const OUTPUT_FILE = path.join(ROOT, 'geoscore_questions.json');

const SERVICE_ACCOUNT_PATH = path.join(ROOT, 'serviceAccountKey.json');

const TOT_MENTIONS_PER_COUNTRY = 100;

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function tryReadJson(p){ try{ return readJson(p); }catch{ return null; } }

function getCountriesList(){
  try{ const arr = readJson(COUNTRIES_FILE); return arr.map(r=>({ code:r.code, name:r.name })); }catch{ return []; }
}

function loadCities(iso3){
  const p = path.join(DATA_DIR, iso3, 'cities.geojson');
  const fc = tryReadJson(p);
  const feats = fc && Array.isArray(fc.features) ? fc.features : [];
  const out = [];
  for(const f of feats){
    const g = f && f.geometry;
    const props = (f && f.properties) || {};
    const name = props.name || props.NAME || props.Name || '';
    const pop = Number(props.population || props.POP_MAX || props.pop_max || props.POP_MIN || props.pop_min || 0) || 0;
    if(!name) continue;
    out.push({ name, population: pop });
  }
  return out;
}

function cleanName(name){
  let n = String(name||'').trim();
  if(!n) return n;
  const suffixes = [
    'city municipality','town municipality','unified government','metropolitan government','city-county',
    'census designated place','cdp','municipality','borough','commune','county','parish','city','town','village'
  ];
  let changed = true;
  while(changed){
    changed=false;
    for(const suf of suffixes){
      const re = new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i');
      if(re.test(n)){ n=n.replace(re,'').trim(); changed=true; break; }
    }
  }
  return n;
}

function allocateMentions(cities){
  if(!cities.length){ return []; }
  // Recall-like independent probabilities (per 100 guesses), not normalized to sum
  const sorted = cities.slice().sort((a,b)=> (Number(b.population)||0) - (Number(a.population)||0));
  const rankMap = new Map(); sorted.forEach((c,i)=> rankMap.set(c.name, i+1));
  const sigmoid = (z)=> 1/(1+Math.exp(-z));
  const nameEase = (n)=>{
    const s=String(n||'');
    const letters = s.replace(/[^\p{L}]/gu,'');
    const ascii = letters.replace(/[^A-Za-z]/g,'');
    const asciiRatio = letters.length? (ascii.length/letters.length) : 1;
    const len = letters.length || s.length;
    let ease = 0.5 + 0.5*asciiRatio;
    if(len<=7) ease += 0.2; else if(len<=11) ease += 0.1;
    return Math.min(1.2, ease);
  };
  const A = 1.0, B = 2.5, C = 0.5, D = -8.0;
  let results = cities.map(c => {
    const pop = Math.max(1, Number(c.population)||1);
    const rr = 1/Math.sqrt(Math.max(1, rankMap.get(c.name)||1));
    const z = A*Math.log10(pop) + B*rr + C*nameEase(c.name) + D;
    const p = Math.max(0, Math.min(100, Math.round(100*sigmoid(z))));
    return { name: cleanName(c.name), score: p };
  });
  if(results.length){
    const maxScore = Math.max(...results.map(r=>r.score));
    const minScore = Math.min(...results.map(r=>r.score));
    const range = maxScore - minScore || 1;
    results = results.map(r=>{
      const s = Math.round(((r.score - minScore) / range) * 100);
      return { name: r.name, score: s, count: s };
    });
  }
  return results;
}

function mergeIntoFile(existing, newQs){
  const map = new Map();
  for(const q of Array.isArray(existing)?existing:[]){ map.set(q.question, q); }
  for(const q of newQs){ map.set(q.question, q); }
  return Array.from(map.values());
}

async function main(){
  const argv = process.argv.slice(2);
  const limitArg = argv.find(a=>a.startsWith('--limit='));
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const mergeJson = argv.includes('--merge-json');
  const force = argv.includes('--force');
  let limit = Infinity;
  if(limitArg){
    const raw = String(limitArg.split('=')[1]||'').trim().toLowerCase();
    if(raw === 'all' || raw === 'inf' || raw === 'infinity' || raw === '0'){
      limit = Infinity;
    } else {
      const n = Number(raw);
      limit = (!isFinite(n) || n<=0) ? Infinity : Math.max(1, n);
    }
  }
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||0) : 0;
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a.toUpperCase())).map(s=>s.toUpperCase());

  const countries = getCountriesList();
  const list = targets.length ? countries.filter(c=>targets.includes(c.code)) : countries;
  if(!list.length){ console.error('No countries found to process.'); process.exit(1); }

  // Firestore init (optional, only with --firestore)
  let db = null;
  if(process.argv.includes('--firestore') && fs.existsSync(SERVICE_ACCOUNT_PATH)){
    try{
      const serviceAccount = require(SERVICE_ACCOUNT_PATH);
      const projectId = serviceAccount.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
      db = admin.firestore();
      console.log('Firestore connected');
    }catch(e){ console.warn('Firestore init failed:', e && e.message || e); }
  } else {
    // JSON-only mode
  }

  const outQuestions = [];
  const batch = db ? db.batch() : null;
  const coll = db ? db.collection('geoscoreQuestions') : null;

  for(const c of list){
    const cities = loadCities(c.code)
      .filter(x => (Number(x.population)||0) >= minPop)
      .sort((a,b)=> (Number(b.population)||0) - (Number(a.population)||0))
      .slice(0, limit);
    if(!cities.length){
      const msg = `No cities for ${c.code} (${c.name}) — skipping`;
      if(force) { console.warn(msg); } else { console.warn(msg); continue; }
    }
    const answers = allocateMentions(cities);
    const doc = { question: `Name a city in ${c.name}`, answers: answers.map(a=>({ answer:a.name, score:a.score, count:a.count })) };
    outQuestions.push(doc);
    if(batch && coll){ batch.set(coll.doc(c.code), doc); }
    console.log(`Prepared ${c.code}: ${answers.length} cities`);
  }

  if(batch){ await batch.commit().catch(()=>{}); }
  console.log(`Prepared ${outQuestions.length} country questions`);

  let write = outQuestions;
  if(mergeJson && fs.existsSync(OUTPUT_FILE)){
    try{
      const existing = readJson(OUTPUT_FILE);
      // Preserve existing entries (e.g., US state questions) and append country questions.
      write = (Array.isArray(existing)?existing:[]).concat(outQuestions);
    }catch{}
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(write, null, 2));
  console.log(`Wrote ${write.length} questions to ${OUTPUT_FILE}`);
}

main().catch(e=>{ console.error('ERROR:', e && e.message || e); process.exit(1); });
