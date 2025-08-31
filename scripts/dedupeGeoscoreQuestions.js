#!/usr/bin/env node
/*
  De-duplicate country-city (and other) GeoScore questions in geoscore_questions.json.

  Strategy (default: merge):
  - Group by exact question string (trimmed)
  - Merge answers by normalized answer (case-insensitive, trimmed)
  - For duplicates of the same answer, keep the one with the larger score (then larger count)
  - Sort answers by score desc, then count desc, then name asc

  Alternative strategy (keep-larger):
  - For each duplicate group, keep the entry with the most answers; ties resolved by total score sum.

  Usage:
    node scripts/dedupeGeoscoreQuestions.js              # merge strategy, writes in place
    node scripts/dedupeGeoscoreQuestions.js --keep-larger
    node scripts/dedupeGeoscoreQuestions.js --dry-run
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'geoscore_questions.json');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function normAnswer(a){ return String(a||'').trim().toLowerCase(); }
function cleanAnswer(a){ return String(a||'').trim(); }

function mergeGroup(entries){
  if(entries.length === 1) return entries[0];
  const q = entries[0].question;
  const amap = new Map();
  for(const e of entries){
    const ans = Array.isArray(e.answers) ? e.answers : [];
    for(const a of ans){
      const key = normAnswer(a.answer);
      if(!key) continue;
      const prev = amap.get(key);
      const score = Number(a.score)||0; const count = Number(a.count)||0;
      if(!prev){
        amap.set(key, { answer: cleanAnswer(a.answer), score, count });
      }else{
        // Keep the more complete entry: prefer higher score, then higher count
        if(score > prev.score || (score===prev.score && count>prev.count)){
          amap.set(key, { answer: cleanAnswer(a.answer), score, count });
        }
      }
    }
  }
  const merged = Array.from(amap.values())
    .sort((a,b)=> (b.score - a.score) || (b.count - a.count) || a.answer.localeCompare(b.answer));
  return { question: q, answers: merged };
}

function keepLargerGroup(entries){
  if(entries.length === 1) return entries[0];
  let best = entries[0];
  let bestScoreSum = sumScore(entries[0]);
  for(const e of entries){
    const len = (e.answers||[]).length;
    const bestLen = (best.answers||[]).length;
    const ssum = sumScore(e);
    if(len > bestLen || (len===bestLen && ssum > bestScoreSum)){
      best = e; bestScoreSum = ssum;
    }
  }
  return best;
}

function sumScore(e){ return (e.answers||[]).reduce((s,a)=> s + (Number(a.score)||0), 0); }

function normalizeNameBasic(s){
  return String(s||'')
    .trim()
    .replace(/^the\s+/i,'')
    .replace(/[()]/g,' ')
    .replace(/[^\p{L}\p{N}\s\-']/gu,' ')
    .replace(/\s+/g,' ')
    .toLowerCase();
}

function buildCountryResolver(){
  const map = new Map(); // normalized name -> { code, name }
  const codeSet = new Set(); // ISO3 codes present
  try{
    const arr = JSON.parse(fs.readFileSync(COUNTRIES_FILE,'utf8'));
    for(const r of arr){
      const name = String(r.name||'').trim();
      const code = String(r.code||'').trim().toUpperCase();
      if(!name || !/^[A-Z]{3}$/.test(code)) continue;
      const norm = normalizeNameBasic(name);
      map.set(norm, { code, name });
      codeSet.add(code);
    }
  }catch{}
  // Common aliases
  const aliases = {
    // USA
    'united states of america':'USA', 'united states':'USA', 'usa':'USA', 'u.s.a.':'USA', 'u.s.':'USA', 'us':'USA',
    // UK / GB
    'united kingdom':'GBR', 'u.k.':'GBR', 'uk':'GBR', 'great britain':'GBR', 'gb':'GBR',
    // UAE
    'united arab emirates':'ARE', 'uae':'ARE',
    'russian federation':'russia',
    'republic of korea':'south korea','korea, republic of':'south korea','korea (republic of)':'south korea',
    'democratic people\'s republic of korea':'north korea','korea, democratic people\'s republic of':'north korea',
    'czech republic':'czechia',
    'turkiye':'turkey','türkiye':'turkey',
    'syrian arab republic':'syria',
    'iran (islamic republic of)':'iran',
    'viet nam':'vietnam',
    'lao people\'s democratic republic':'laos',
    'moldova, republic of':'moldova',
    'tanzania, united republic of':'TZA','united republic of tanzania':'TZA',
    'china, taiwan province of':'taiwan',
    'china, hong kong sar':'hong kong',
    'china, macao sar':'MAC','macao s.a.r':'MAC','macau':'MAC','macao':'MAC',
    'hong kong s.a.r.':'HKG','hong kong sar':'HKG',
    'palestinian territories':'palestine','state of palestine':'palestine',
    'congo, democratic republic of the':'democratic republic of the congo','drc':'COD','congo-kinshasa':'democratic republic of the congo',
    'congo, republic of the':'republic of the congo','congo-brazzaville':'republic of the congo',
    'republic of serbia':'SRB','serbia, republic of':'SRB',
    'cote d\'ivoire':'CIV','côte d\'ivoire':'CIV','ivory coast':'CIV',
    'sao tome and principe':'STP','são tomé and principe':'STP',
    'eswatini':'SWZ','swaziland':'SWZ',
    'burma':'MMR','myanmar':'MMR',
    'cape verde':'CPV','cabo verde':'CPV'
  };
  for(const [alias, target] of Object.entries(aliases)){
    let rec = null;
    // target could be a normalized name or an ISO3 code
    if(/^[A-Z]{3}$/.test(String(target))){
      const code = String(target).toUpperCase();
      if(codeSet.has(code)) rec = { code, name: [...map.values()].find(v=>v.code===code)?.name || code };
    } else {
      rec = map.get(normalizeNameBasic(target));
    }
    if(rec) map.set(alias, rec);
  }
  return (rawName)=>{
    const norm = normalizeNameBasic(rawName);
    // direct ISO3 code?
    const plain = norm.replace(/[^a-z0-9]/g,'');
    if(plain.length===3){
      const code = plain.toUpperCase();
      if(codeSet.has(code)) return { code, name: [...map.values()].find(v=>v.code===code)?.name || code };
    }
    return map.get(norm) || null;
  };
}

// US state names to prevent ambiguous merging (e.g., Georgia state vs Georgia country)
const US_STATE_SET = new Set([
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
  'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts',
  'michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
  'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
  'wisconsin','wyoming','district of columbia'
]);

function main(){
  const argv = process.argv.slice(2);
  const keepLarger = argv.includes('--keep-larger');
  const dry = argv.includes('--dry-run');
  if(!fs.existsSync(FILE)){
    console.error('Missing geoscore_questions.json'); process.exit(1);
  }
  const arr = readJson(FILE);
  const resolveCountry = buildCountryResolver();
  const byQ = new Map(); // key -> list of entries
  for(const e of Array.isArray(arr)?arr:[]){
    if(!e || !e.question) continue;
    const qstr = String(e.question).trim();
    // Try to parse country-city questions and resolve to ISO3 for grouping
    let key = qstr;
    const m = /^name a city in\s+(.+)$/i.exec(qstr);
    if(m && m[1]){
      const target = m[1].trim();
      const tnorm = normalizeNameBasic(target);
      // If target is a US state, do NOT group as a country
      if(!US_STATE_SET.has(tnorm)){
        const res = resolveCountry(target);
        if(res){ key = `__COUNTRY__:${res.code}`; }
      }
    }
    if(!byQ.has(key)) byQ.set(key, []);
    byQ.get(key).push({ question: qstr, answers: Array.isArray(e.answers)? e.answers.slice(): [] });
  }
  let duplicates = 0;
  const out = [];
  for(const [key, list] of byQ.entries()){
    if(list.length > 1) duplicates += (list.length - 1);
    let resolved = keepLarger ? keepLargerGroup(list) : mergeGroup(list);
    // If grouped by country ISO3, normalize question text to countries.json name
    if(/^__COUNTRY__:[A-Z]{3}$/.test(key)){
      const iso3 = key.slice('__COUNTRY__:'.length);
      try{
        const countries = JSON.parse(fs.readFileSync(COUNTRIES_FILE,'utf8'));
        const rec = countries.find(r=>String(r.code).toUpperCase()===iso3);
        const cname = (rec && rec.name) ? rec.name : iso3;
        resolved = { question: `Name a city in ${cname}`, answers: resolved.answers };
      }catch{}
    }
    out.push(resolved);
  }
  console.log(`Found ${duplicates} duplicate entries across ${byQ.size} questions.`);
  if(dry){
    console.log('Dry run — no file written.');
    return;
  }
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${out.length} de-duplicated questions to ${path.relative(ROOT, FILE)}`);
}

main();
