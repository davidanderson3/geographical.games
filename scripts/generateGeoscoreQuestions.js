#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
// Optional Firestore: only if invoked with --firestore
let db = null;
if (process.argv.includes('--firestore')) {
  const SERVICE_ACCOUNT_PATH = "./serviceAccountKey.json";
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`\u2717 Missing service account key at ${SERVICE_ACCOUNT_PATH} (required for --firestore)`);
    process.exit(1);
  }
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (isEmulator) {
    console.warn(`\u26A0\uFE0F FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}`);
  } else {
    console.log("\uD83D\uDD12 Connecting to Firestore");
  }
  const projectId = serviceAccount.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  try {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
    db = admin.firestore();
  } catch (err) {
    console.error("Failed to initialize Firebase Admin SDK:", err.message);
    process.exit(1);
  }
}

const TOT_MENTIONS_PER_STATE = 100;
const ZIPF_S = 1.25;
const CAPITAL_BOOST = 1.5;
const WP_ALPHA = 0.25;
const REQUEST_TIMEOUT = 30000;
const SLEEP_BETWEEN_CALLS = 200;

const LAYER_INC = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query";
const LAYER_CONC = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/3/query";
const CENSUS_PL_BASE = "https://api.census.gov/data/2020/dec/pl";
const POP_VAR = "P1_001N";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_BATCH = 50;
const CACHE_FILE = "wiki_cache.json";

const STATES = [
  ["AL","01","Montgomery"],["AK","02","Juneau"],["AZ","04","Phoenix"],["AR","05","Little Rock"],["CA","06","Sacramento"],
  ["CO","08","Denver"],["CT","09","Hartford"],["DE","10","Dover"],["FL","12","Tallahassee"],["GA","13","Atlanta"],
  ["HI","15","Honolulu"],["ID","16","Boise"],["IL","17","Springfield"],["IN","18","Indianapolis"],["IA","19","Des Moines"],
  ["KS","20","Topeka"],["KY","21","Frankfort"],["LA","22","Baton Rouge"],["ME","23","Augusta"],["MD","24","Annapolis"],
  ["MA","25","Boston"],["MI","26","Lansing"],["MN","27","Saint Paul"],["MS","28","Jackson"],["MO","29","Jefferson City"],
  ["MT","30","Helena"],["NE","31","Lincoln"],["NV","32","Carson City"],["NH","33","Concord"],["NJ","34","Trenton"],
  ["NM","35","Santa Fe"],["NY","36","Albany"],["NC","37","Raleigh"],["ND","38","Bismarck"],["OH","39","Columbus"],
  ["OK","40","Oklahoma City"],["OR","41","Salem"],["PA","42","Harrisburg"],["RI","44","Providence"],["SC","45","Columbia"],
  ["SD","46","Pierre"],["TN","47","Nashville"],["TX","48","Austin"],["UT","49","Salt Lake City"],["VT","50","Montpelier"],
  ["VA","51","Richmond"],["WA","53","Olympia"],["WV","54","Charleston"],["WI","55","Madison"],["WY","56","Cheyenne"]
];
const USPS_BY_FIPS = Object.fromEntries(STATES.map(([usps,fips])=>[fips,usps]));
const CAPITAL_BY_USPS = Object.fromEntries(STATES.map(([usps,_,cap])=>[usps,cap]));
const FIPS_SET = new Set(STATES.map(([,f])=>f));

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

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function qs(params){ return Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
async function fetchJson(url, params){
  const u = params ? `${url}?${qs(params)}` : url;
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), REQUEST_TIMEOUT);
  const res = await fetch(u, {signal: ctrl.signal, headers: {"User-Agent":"us-pointless-places-wiki-js/1.0"}});
  clearTimeout(t);
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
  return res.json();
}

async function arcgisPaginatedQuery(url, outFields){
  const all = [];
  let offset = 0;
  const size = 50000;
  for(;;){
    const params = { where:"1=1", outFields:outFields.join(","), returnGeometry:"false", f:"json", resultOffset:offset, resultRecordCount:size };
    const data = await fetchJson(url, params);
    const feats = (data.features||[]).map(f=>f.attributes);
    for(const a of feats) all.push(a);
    if(!feats.length || !data.exceededTransferLimit) break;
    offset += feats.length;
    await sleep(SLEEP_BETWEEN_CALLS);
  }
  return all;
}

function percentile(arr, p){
  if(arr.length===0) return 0;
  const a = [...arr].sort((x,y)=>x-y);
  const idx = (a.length-1)*p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if(lo===hi) return a[lo];
  const w = idx - lo;
  return a[lo] + (a[hi]-a[lo])*w;
}

function normalizeCapMatch(s){
  return s.toLowerCase().replace(/-/g," ").replace(/[^\p{L}\p{N}\s]/gu,"").replace(/\s+/g," ").trim();
}
function isCapitalName(city, cap){
  const a = normalizeCapMatch(city), b = normalizeCapMatch(cap);
  return a===b || a.includes(b) || b.includes(a);
}

function csvEscape(v){
  if(v===null || v===undefined) return "";
  const s = String(v);
  if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function writeCSV(file, rows, headers){
  const out = [headers.join(",")].concat(rows.map(r=>headers.map(h=>csvEscape(r[h])).join(","))).join("\n");
  fs.writeFileSync(file, out, "utf8");
}

function loadCache(){
  if(fs.existsSync(CACHE_FILE)){
    try{ return JSON.parse(fs.readFileSync(CACHE_FILE,"utf8")); }catch{ return {}; }
  }
  return {};
}
function saveCache(cache){
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function buildWikiTitles(stateRows, st){
  return stateRows.map(r=>`${r.basename.trim()}, ${st}`);
}
async function wikiQueryTitles(titles){
  const res = {};
  for(let i=0;i<titles.length;i+=WIKI_BATCH){
    const batch = titles.slice(i,i+WIKI_BATCH);
    const data = await fetchJson(WIKI_API, { action:"query", prop:"info", inprop:"url", format:"json", redirects:1, titles:batch.join("|") });
    const pages = (data.query && data.query.pages) ? data.query.pages : {};
    for(const k of Object.keys(pages)){
      const p = pages[k];
      if(p && typeof p.title==="string" && typeof p.length==="number"){
        res[p.title] = p.length;
      }
    }
    await sleep(SLEEP_BETWEEN_CALLS);
  }
  return res;
}

function computeMentionsForState(rows, st, capitalByUSPS){
  const cap = capitalByUSPS[st];
  rows.sort((a,b)=> (b.pop2020-a.pop2020) || a.basename.localeCompare(b.basename));
  rows.forEach((r,i)=> r.pop_rank = i+1);
  const hasPop = rows.reduce((s,r)=>s+r.pop2020,0) > 0;
  rows.forEach(r=>{
    r.base_w = hasPop ? 1/Math.pow(r.pop_rank, ZIPF_S) : 1;
    r.mult = 1;
  });
  if(cap){
    for(const r of rows){
      if(isCapitalName(r.basename, cap)) r.mult *= CAPITAL_BOOST;
    }
  }
  const p95 = percentile(rows.map(r=>r.wiki_len||0), 0.95);
  if(p95>0){
    for(const r of rows){
      const rel = Math.min((r.wiki_len||0)/p95, 1);
      r.mult *= (1 + WP_ALPHA*rel);
    }
  }
  let totalW = 0;
  for(const r of rows){ r.weight = r.base_w * r.mult; totalW += r.weight; }
  if(totalW<=0){
    for(const r of rows){ r.est_mentions = 0; r.est_share = 0; }
    return rows;
  }
  const raw = rows.map(r=> r.weight/totalW * TOT_MENTIONS_PER_STATE);
  const rounded = raw.map(x=>Math.round(x));
  let delta = TOT_MENTIONS_PER_STATE - rounded.reduce((s,x)=>s+x,0);
  if(delta!==0){
    const frac = raw.map((x,i)=>({i, f: x - Math.floor(x)})).sort((a,b)=> (delta>0 ? b.f-a.f : a.f-b.f));
    for(let k=0;k<Math.min(Math.abs(delta), frac.length);k++){
      rounded[frac[k].i] += delta>0 ? 1 : -1;
    }
  }
  for(let i=0;i<rows.length;i++){
    rows[i].est_mentions = Math.max(0, rounded[i]|0);
    rows[i].est_share = +(rows[i].est_mentions / TOT_MENTIONS_PER_STATE).toFixed(4);
  }
  return rows;
}

async function main(){
  // CLI filter: --states=HI,CA (USPS codes), and optional --merge-json
  const argv = process.argv.slice(2);
  const statesArg = argv.find(a=>a.startsWith('--states='));
  const mergeJson = argv.includes('--merge-json');
  const onlyStates = statesArg ? statesArg.split('=')[1].split(',').map(s=>s.trim().toUpperCase()).filter(s=>/^([A-Z]{2})$/.test(s)) : null;
  const SELECTED = onlyStates ? STATES.filter(([usps])=> onlyStates.includes(usps)) : STATES;
  const USPS_BY_FIPS_LOCAL = Object.fromEntries(SELECTED.map(([usps,fips])=>[fips,usps]));
  const CAPITAL_BY_USPS_LOCAL = Object.fromEntries(SELECTED.map(([usps,_,cap])=>[usps,cap]));
  const FIPS_SET_LOCAL = new Set(SELECTED.map(([,f])=>f));

  console.log(`Fetching Incorporated Places (${onlyStates?onlyStates.join(', '):'national'})...`);
  const inc = await arcgisPaginatedQuery(LAYER_INC, ["STATE","PLACE","GEOID","BASENAME","NAME","LSADC","FUNCSTAT"]);
  const dfInc = inc.filter(r=>FIPS_SET_LOCAL.has(String(r.STATE))).map(r=>({
    STATE:String(r.STATE), PLACE:String(r.PLACE), geoid:String(r.GEOID), basename:String(r.BASENAME),
    NAME:String(r.NAME), LSADC:r.LSADC, FUNCSTAT:r.FUNCSTAT, type:"incorporated", stusps: USPS_BY_FIPS_LOCAL[String(r.STATE)]
  }));

  console.log(`Fetching Consolidated Cities (${onlyStates?onlyStates.join(', '):'national'})...`);
  const conc = await arcgisPaginatedQuery(LAYER_CONC, ["STATE","CONCITY","GEOID","BASENAME","NAME","LSADC","FUNCSTAT"]);
  const dfConc = conc.filter(r=>FIPS_SET_LOCAL.has(String(r.STATE))).map(r=>({
    STATE:String(r.STATE), PLACE:String(r.CONCITY), geoid:String(r.GEOID), basename:String(r.BASENAME),
    NAME:String(r.NAME), LSADC:r.LSADC, FUNCSTAT:r.FUNCSTAT, type:"consolidated", stusps: USPS_BY_FIPS_LOCAL[String(r.STATE)]
  }));

  const byGeo = new Map();
  for(const r of [...dfInc, ...dfConc]) if(!byGeo.has(r.geoid)) byGeo.set(r.geoid, r);
  const places = Array.from(byGeo.values());

  console.log(`Fetching 2020 population by place via Census API (${onlyStates?onlyStates.join(', '):'all states'})...`);
  const popByGeo = new Map();
  // Also collect fallback place names directly from Census for states that lack incorporated/consolidated entries (e.g., HI CDPs)
  const fallbackPlacesByState = new Map();
  for(const [st,fips] of SELECTED){
    const data = await fetchJson(CENSUS_PL_BASE, { get:`NAME,${POP_VAR}`, for:"place:*", in:`state:${fips}` });
    const cols = data[0]; const rows = data.slice(1);
    const idxState = cols.indexOf("state");
    const idxPlace = cols.indexOf("place");
    const idxName = cols.indexOf("NAME");
    const idxPop = cols.indexOf(POP_VAR);
    const fallbacks = [];
    for(const row of rows){
      const geoid = String(row[idxState]) + String(row[idxPlace]);
      const pop = parseInt(row[idxPop]||"0",10) || 0;
      popByGeo.set(geoid, pop);
      const fullName = String(row[idxName]||"");
      fallbacks.push({ stusps: st, geoid, NAME: fullName });
    }
    fallbackPlacesByState.set(st, fallbacks);
    await sleep(SLEEP_BETWEEN_CALLS);
  }

  for(const r of places){
    r.pop2020 = popByGeo.get(r.geoid) || 0;
  }

  const cache = loadCache();
  // Optional min population filter for state cities (applies to pop2020)
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||0) : 0;
  const outputRows = [];
  // Iterate selected states; if a state has no incorporated/consolidated places, fall back to Census places (e.g., CDPs)
  const allStates = SELECTED.map(([usps])=>usps);
  function normalizeFromCensusName(full){
    let s = String(full||"");
    // Drop trailing ", State"
    s = s.replace(/,\s*[A-Za-z ]+$/, "");
    // Pull out basename by removing common legal descriptors at the end
    const base = s.replace(/\s+(city and county|city-county|consolidated city|city municipality|town municipality|municipality|city|town|village|borough|CDP)\.?$/i, "").trim();
    return { basename: base || s, display: s };
  }
  for(const st of allStates){
    let subset = places.filter(r=>r.stusps===st).map(r=>({...r}));
    if(subset.length===0){
      // Build fallback rows from Census names (will include CDPs for HI)
      const fb = fallbackPlacesByState.get(st) || [];
      subset = fb.map(r=>{
        const nm = normalizeFromCensusName(r.NAME);
        return {
          stusps: st,
          geoid: r.geoid,
          basename: nm.basename,
          NAME: nm.display,
          LSADC: 'CDP',
          FUNCSTAT: null,
          type: 'cdp'
        };
      });
    }
    // attach population if missing
    subset.forEach(r=>{ if(r.pop2020===undefined) r.pop2020 = popByGeo.get(r.geoid) || 0; });
    const titles = buildWikiTitles(subset, st);
    const wikiLens = new Array(titles.length).fill(0);
    const toFetchIdx = [];
    const toFetchTitles = [];
    for(let i=0;i<titles.length;i++){
      const key = `${titles[i]}|${st}`;
      if(cache[key]!==undefined){
        wikiLens[i]=cache[key];
      }else{
        toFetchIdx.push(i);
        toFetchTitles.push(titles[i]);
      }
    }
    if(toFetchTitles.length){
      const got = await wikiQueryTitles(toFetchTitles);
      for(let k=0;k<toFetchIdx.length;k++){
        const i = toFetchIdx[k];
        const t = toFetchTitles[k];
        let len = 0;
        if(got[t]!==undefined) len = got[t];
        else {
          const alt = t.replace(/\b\w/g, c=>c.toUpperCase());
          len = got[alt]!==undefined ? got[alt] : 0;
        }
        wikiLens[i]=len|0;
        cache[`${t}|${st}`]=wikiLens[i];
      }
      saveCache(cache);
    }
    for(let i=0;i<subset.length;i++){
      subset[i].wiki_title = titles[i];
      subset[i].wiki_len = wikiLens[i];
    }
    const scored = computeMentionsForState(subset, st, CAPITAL_BY_USPS_LOCAL);
    outputRows.push(...scored);
  }

  outputRows.sort((a,b)=> a.stusps.localeCompare(b.stusps) || a.pop_rank-b.pop_rank);

  const headers = ["stusps","geoid","basename","type","LSADC","FUNCSTAT","pop2020","wiki_title","wiki_len","pop_rank","est_mentions","est_share","NAME"];
  if(!fs.existsSync("states_wiki")) fs.mkdirSync("states_wiki",{recursive:true});
  writeCSV("us_pointless_places_wiki.csv", outputRows, headers);
  const byState = new Map();
  for(const r of outputRows){
    if(!byState.has(r.stusps)) byState.set(r.stusps, []);
    byState.get(r.stusps).push(r);
  }
  for(const [st,rows] of byState.entries()){
    writeCSV(path.join("states_wiki", `${st}.csv`), rows, headers);
  }
  console.log(`Wrote us_pointless_places_wiki.csv with ${outputRows.length} rows`);
  console.log(`Per-state CSVs in ./states_wiki/ (e.g., states_wiki/KS.csv)`);

  const questions = [];
  const batch = db ? db.batch() : null;
  const coll = db ? db.collection("geoscoreQuestions") : null;
  for(const [st,rows] of byState.entries()){
    const filtered = rows.filter(r => (Number(r.pop2020)||0) >= minPop);
    if(filtered.length === 0){
      console.log(`Skipping ${st}: no places with pop >= ${minPop}`);
      continue;
    }
    const answers = filtered
      .slice()
      .sort((a,b)=>b.est_mentions - a.est_mentions)
      .map(r=>({
        answer: r.basename || r.NAME,
        score: r.est_mentions,
        count: r.est_mentions
      }));
    const doc = {
      question: `Name a city in ${STATE_NAMES[st] || st}`,
      answers
    };
    questions.push(doc);
    if (batch && coll) {
      const docRef = coll.doc(st);
      batch.set(docRef, doc);
    }
  }
  if (batch) {
    await batch.commit();
    console.log(`Synced ${questions.length} question(s) to Firestore collection geoscoreQuestions`);
  }

  // Write JSON: merge into existing if --merge-json; otherwise overwrite with selected only
  let writeQuestions = questions;
  if(mergeJson && fs.existsSync("geoscore_questions.json")){
    try{
      const existing = JSON.parse(fs.readFileSync("geoscore_questions.json","utf8"));
      // Preserve existing entries (e.g., Country Cities) and append state questions
      writeQuestions = (Array.isArray(existing)?existing:[]).concat(questions);
    }catch{}
  }
  fs.writeFileSync("geoscore_questions.json", JSON.stringify(writeQuestions, null, 2), "utf8");
  console.log(`Wrote geoscore_questions.json with ${writeQuestions.length} question(s)`);
}

main().catch(e=>{ console.error("ERROR:", e.message||e); process.exit(1); });
