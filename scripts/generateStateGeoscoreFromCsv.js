#!/usr/bin/env node
/*
  Generate US State GeoScore questions from existing CSVs in states_wiki/ without network.

  - Reads states_wiki/<ST>.csv (created by prior runs)
  - Filters places by pop2020 >= --min-pop (default 5000)
  - Uses CSV est_mentions as weights; rescales to a 100-point pool
  - Writes/merges into geoscore_questions.json

  Usage:
    node scripts/generateStateGeoscoreFromCsv.js --min-pop=5000 --merge-json
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_DIR = path.join(ROOT, 'states_wiki');
const OUT_FILE = path.join(ROOT, 'geoscore_questions.json');

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri',
  MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming'
};

const STATE_CAPITALS = {
  Alabama:'Montgomery', Alaska:'Juneau', Arizona:'Phoenix', Arkansas:'Little Rock', California:'Sacramento',
  Colorado:'Denver', Connecticut:'Hartford', Delaware:'Dover', Florida:'Tallahassee', Georgia:'Atlanta',
  Hawaii:'Honolulu', Idaho:'Boise', Illinois:'Springfield', Indiana:'Indianapolis', Iowa:'Des Moines',
  Kansas:'Topeka', Kentucky:'Frankfort', Louisiana:'Baton Rouge', Maine:'Augusta', Maryland:'Annapolis',
  Massachusetts:'Boston', Michigan:'Lansing', Minnesota:'Saint Paul', Mississippi:'Jackson', Missouri:'Jefferson City',
  Montana:'Helena', Nebraska:'Lincoln', Nevada:'Carson City', New_Hampshire:'Concord', New_Jersey:'Trenton',
  New_Mexico:'Santa Fe', New_York:'Albany', North_Carolina:'Raleigh', North_Dakota:'Bismarck', Ohio:'Columbus',
  Oklahoma:'Oklahoma City', Oregon:'Salem', Pennsylvania:'Harrisburg', Rhode_Island:'Providence', South_Carolina:'Columbia',
  South_Dakota:'Pierre', Tennessee:'Nashville', Texas:'Austin', Utah:'Salt Lake City', Vermont:'Montpelier',
  Virginia:'Richmond', Washington:'Olympia', West_Virginia:'Charleston', Wisconsin:'Madison', Wyoming:'Cheyenne'
};

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const header = lines[0].split(',');
  const rows = [];
  for(let i=1;i<lines.length;i++){
    // Simple CSV parse (no embedded commas assumed; matches our generator)
    const cols = lines[i].split(',');
    const rec = {};
    header.forEach((h,idx)=> rec[h] = cols[idx]);
    rows.push(rec);
  }
  return rows;
}

const sigmoid = (z)=> 1/(1+Math.exp(-z));

function maxScoreForCount(n){
  const capped = Math.min(Math.max(n, 0), 10);
  return 70 + Math.round((capped / 10) * 25);
}

async function main(){
  const argv = process.argv.slice(2);
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const merge = argv.includes('--merge-json');
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||0) : 5000;

  const states = Object.keys(STATE_NAMES);
  const questions = [];
  for(const st of states){
    const file = path.join(CSV_DIR, `${st}.csv`);
    if(!fs.existsSync(file)) continue;
    const rows = parseCSV(fs.readFileSync(file,'utf8'));
    const filtered = rows.filter(r=> (Number(r.pop2020)||0) >= minPop);
    if(!filtered.length) continue;
    // Recall-like independent scoring per city (0..100)
    // Rank within state by pop2020
    const sorted = filtered.slice().sort((a,b)=> (Number(b.pop2020)||0) - (Number(a.pop2020)||0));
    const rankMap = new Map(); sorted.forEach((r,i)=> rankMap.set(r.geoid, i+1));
    // Wiki length distribution cut points for fame
    const lens = filtered.map(r=> Number(r.wiki_len)||0).sort((a,b)=>a-b);
    const idx = (p)=> Math.max(0, Math.min(lens.length-1, Math.floor(lens.length*p)));
    const p20 = lens.length ? lens[idx(0.20)] : 0;
    const p40 = lens.length ? lens[idx(0.40)] : 0;
    const p60 = lens.length ? lens[idx(0.60)] : 0;
    const p80 = lens.length ? lens[idx(0.80)] : 0;
    const p95 = lens.length ? lens[idx(0.95)] : 0;
    const p99 = lens.length ? lens[idx(0.99)] : 0;
    const stateName = STATE_NAMES[st];
    // Capital mapping; object keys differ for spaced names; build lookup
    const capitalKey = stateName.replace(/\s+/g,'_');
    const capitalName = STATE_CAPITALS[capitalKey] || '';
    function nameEase(title){
      const s=String(title||'');
      const letters = s.replace(/[^\p{L}]/gu,'');
      const ascii = letters.replace(/[^A-Za-z]/g,'');
      const asciiRatio = letters.length? (ascii.length/letters.length) : 1;
      const len = letters.length || s.length;
      let ease = 0.5 + 0.5*asciiRatio;
      if(len<=7) ease += 0.2; else if(len<=11) ease += 0.1;
      return Math.min(1.2, ease);
    }
    // Coefficients: increase global fame (wiki E), reduce population (A) and rank (B)
    // Tuned to push globally famous cities higher even if city-proper pop is smaller
    // Heavily weight global fame; reduce pop+rank so tail cities collapse toward 0
    const A=0.05, B=0.15, C=0.15, K=0.1, D=-2.0;
    let answers = filtered.map((r)=>{
      const pop = Math.max(1, Number(r.pop2020)||1);
      const rr = 1/Math.sqrt(Math.max(1, rankMap.get(r.geoid)||1));
      const title = String(r.basename || r.NAME || '');
      const wlen = Number(r.wiki_len)||0;
      // Fame curve: below p40 -> near zero, above p95 -> near one; steep gamma to separate head/tail
      let fameFrac = 0;
      if(p95>p40){ fameFrac = Math.max(0, Math.min(1, (wlen - p40) / (p95 - p40))); }
      const wiki = Math.pow(fameFrac, 3.5);
      const isCapital = capitalName && title.toLowerCase()===capitalName.toLowerCase();
      // Bonus spike for ultra-famous pages
      const fameSpike = (p99 && wlen >= p99) ? 1.2 : 0;
      // Penalty for obscure: very low wiki length and small population
      const obscurePenalty = (wlen <= p20 && pop < 80000) ? 2.0 : 0;
      const z = A*Math.log10(pop) + B*rr + C*nameEase(title) + 4.5*wiki + fameSpike + (isCapital?K:0) + D - obscurePenalty;
      const p = Math.max(0, Math.min(100, Math.round(100*sigmoid(z))));
      return { answer: title, score: p, count: p };
    });
    if(answers.length){
      const maxRaw = Math.max(...answers.map(a=>a.score));
      const minRaw = Math.min(...answers.map(a=>a.score));
      const range = maxRaw - minRaw || 1;
      const maxScore = maxScoreForCount(answers.length);
      answers = answers.map(a=>{
        const s = Math.round(((a.score - minRaw) / range) * maxScore);
        return { answer: a.answer, score: s, count: s };
      });
    }
    const doc = { question: `Name a city in ${STATE_NAMES[st]}`, answers };
    questions.push(doc);
  }

  let write = questions;
  if(merge && fs.existsSync(OUT_FILE)){
    try{
      const existing = JSON.parse(fs.readFileSync(OUT_FILE,'utf8'));
      const stateQuestions = new Set(Object.values(STATE_NAMES).map(n=>`Name a city in ${n}`));
      const isGeorgiaCountry = (q)=>{
        const ans = Array.isArray(q && q.answers)? q.answers: [];
        const hints = /tbilisi|batumi|kutaisi|rustavi|poti|gori/i;
        return ans.some(a=> hints.test(String(a && a.answer || '')));
      };
      const filteredExisting = (Array.isArray(existing)?existing:[]).filter(q=>{
        const qq = String(q && q.question || '');
        if(!stateQuestions.has(qq)) return true;
        // Special-case: keep Georgia (country) entry
        if(qq === 'Name a city in Georgia' && isGeorgiaCountry(q)) return true;
        return false; // remove state question (to replace with new ≥min-pop list)
      });
      write = filteredExisting.concat(questions);
    }catch{}
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(write, null, 2));
  console.log(`Wrote ${write.length} questions to ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch(e=>{ console.error('ERROR:', e && e.message || e); process.exit(1); });
