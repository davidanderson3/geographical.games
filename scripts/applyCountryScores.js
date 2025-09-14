#!/usr/bin/env node
/*
  Apply country weight scores from country_scores.json to all relevant country questions.
  - Reads geoscore_questions.json (array or {questions})
  - For each question, if any answer matches a country in the provided list,
    set weightOverrides[questionKey][originalAnswer] = score
  - Writes to backend/geoscore-overrides.json merging with existing
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUESTIONS = path.join(ROOT, 'geoscore_questions.json');
// Prefer hyphenated filename if present, fallback to underscore
const SCORES_HYPHEN = path.join(ROOT, 'country-scores.json');
const SCORES_UNDERSCORE = path.join(ROOT, 'country_scores.json');
const OV_FILE = path.join(ROOT, 'backend', 'geoscore-overrides.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function normName(s){
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^the\s+/i,'')
    .replace(/[\(\)\,\-]/g,' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ALIASES = new Map([
  ['ivory coast', "cote d'ivoire"],
  ['cote d ivoire', "cote d'ivoire"],
  ['czech republic', 'czechia'],
  ['cabo verde', 'cape verde'],
  ['micronesia federated states of', 'micronesia'],
  ['gambia the', 'gambia'],
  ['congo democratic republic of the', 'democratic republic of the congo'],
  ['congo republic of the', 'congo (congo-brazzaville)'],
  ['vatican city holy see', 'vatican city']
]);

function aliasNormalize(s){
  let n = normName(s);
  return ALIASES.get(n) || n;
}

function main(){
  const rawQs = readJson(QUESTIONS);
  const questions = Array.isArray(rawQs) ? rawQs : (rawQs.questions || []);
  const scoresPath = fs.existsSync(SCORES_HYPHEN) ? SCORES_HYPHEN : SCORES_UNDERSCORE;
  if(!fs.existsSync(scoresPath)){
    console.error('Scores file not found:', SCORES_HYPHEN, 'or', SCORES_UNDERSCORE);
    process.exit(1);
  }
  const scores = readJson(scoresPath);

  // Build a set of normalized country -> score
  const scoreMap = new Map();
  for(const row of scores){
    if(!row || typeof row.country !== 'string') continue;
    const key = aliasNormalize(row.country);
    const sc = Number(row.score);
    if(Number.isFinite(sc)) scoreMap.set(key, Math.max(0, Math.min(100, Math.round(sc))));
  }

  // Prepare overrides file
  let ov = {};
  try { ov = readJson(OV_FILE); } catch { ov = {}; }
  ov.weightOverrides = ov.weightOverrides || {};
  ov.weightByCountry = ov.weightByCountry || {};

  let applied = 0;
  let touchedQuestions = 0;
  // Populate global weightByCountry map so countries get consistent weights across questions
  for(const [k, sc] of scoreMap.entries()){
    ov.weightByCountry[k] = sc;
  }
  // Also keep per-question overrides for backward compatibility (optional)
  for(const q of questions){
    const qkey = String(q && q.question || '');
    if(!qkey || !Array.isArray(q && q.answers)) continue;
    if(!/\bcountry\b/.test(qkey.toLowerCase())) continue;
    for(const a of q.answers){
      const ans = String(a && a.answer || '');
      const key = aliasNormalize(ans);
      const sc = scoreMap.get(key);
      if(Number.isFinite(sc)){
        ov.weightOverrides[qkey] = ov.weightOverrides[qkey] || {};
        ov.weightOverrides[qkey][ans] = sc;
        applied += 1;
      }
    }
  }
  // Deduplicate question count
  const qCount = Object.keys(ov.weightOverrides).length;
  writeJson(OV_FILE, ov);
  console.log(`Applied ${applied} weight overrides across ~${qCount} questions.`);
  console.log(`Scores source: ${path.relative(ROOT, scoresPath)}`);
  console.log(`Wrote ${path.relative(ROOT, OV_FILE)}`);
}

main();
