#!/usr/bin/env node
/*
  Generate geoscore questions from Natural Earth populated places.
  - Fetch world cities with population >= 5000
  - Build Category, Question and Answer records
  - Categories: Country Capitals, Country Cities, State Cities
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'geoscore_questions.json');
const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const NE_CACHE = path.join(__dirname, 'ne_10m_populated_places_simple.geojson');
const MIN_POP = 5000;

class Category {
  constructor(id, name){
    this.id = id;
    this.name = name;
  }
}

class Answer {
  constructor(answer, score, meta={}){
    this.answer = answer;
    this.score = score;
    this.meta = meta;
  }
}

class Question {
  constructor(categoryId, question, answers){
    this.categoryId = categoryId;
    this.question = question;
    this.answers = answers;
  }
}

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

async function ensureNE(){
  if(fs.existsSync(NE_CACHE)) return;
  const res = await fetch(NE_URL);
  if(!res.ok){ throw new Error(`Failed to download NE data ${res.status}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(NE_CACHE, buf);
}

function scoreForPop(pop){
  const minLog = Math.log10(MIN_POP);
  const maxLog = Math.log10(40000000);
  const val = Math.log10(Math.max(pop, MIN_POP));
  const norm = (val - minLog) / (maxLog - minLog);
  return Math.max(1, Math.min(100, Math.round(norm * 99 + 1)));
}

function buildData(){
  const ne = readJson(NE_CACHE);
  const feats = Array.isArray(ne.features) ? ne.features : [];
  const cities = [];
  for(const f of feats){
    const p = f.properties || {};
    const pop = Number(p.pop_max || p.pop_min || 0);
    if(pop < MIN_POP) continue;
    const city = {
      name: p.nameascii || p.name,
      country: p.adm0name,
      iso2: p.iso_a2,
      state: p.adm1name,
      lat: p.latitude,
      lon: p.longitude,
      population: pop,
      isCapital: p.adm0cap === 1 || /Admin-0 capital/i.test(p.featurecla)
    };
    if(!city.name || !city.country) continue;
    cities.push(city);
  }
  const byCountry = new Map();
  const byState = new Map();
  for(const c of cities){
    if(!byCountry.has(c.country)) byCountry.set(c.country, []);
    byCountry.get(c.country).push(c);
    if(c.iso2 === 'US' && c.state){
      if(!byState.has(c.state)) byState.set(c.state, []);
      byState.get(c.state).push(c);
    }
  }
  const categories = [
    new Category('country-capitals','Country Capitals'),
    new Category('country-cities','Country Cities'),
    new Category('state-cities','State Cities')
  ];
  const questions = [];
  for(const [country, list] of byCountry.entries()){
    const sorted = list.sort((a,b)=>b.population - a.population);
    const answers = sorted.map(c => new Answer(c.name, scoreForPop(c.population), {
      lat:c.lat, lon:c.lon, population:c.population
    }));
    questions.push(new Question('country-cities', `Name a city in ${country}`, answers));
    const cap = list.find(c=>c.isCapital);
    if(cap){
      questions.push(new Question('country-capitals', `What is the capital of ${country}?`, [
        new Answer(cap.name, 100, { lat:cap.lat, lon:cap.lon, population:cap.population })
      ]));
    }
  }
  for(const [state, list] of byState.entries()){
    const sorted = list.sort((a,b)=>b.population - a.population);
    const answers = sorted.map(c => new Answer(c.name, scoreForPop(c.population), {
      lat:c.lat, lon:c.lon, population:c.population
    }));
    questions.push(new Question('state-cities', `Name a city in ${state}`, answers));
  }
  return { categories, questions };
}

async function main(){
  await ensureNE();
  const data = buildData();
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));
  console.log(`Wrote ${data.questions.length} questions to ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch(err=>{ console.error('ERROR:', err); process.exit(1); });
