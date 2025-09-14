#!/usr/bin/env node
/**
 * Generate flag metadata for countries (by ISO3) and US states.
 * - Countries: fetched from Rest Countries (flags svg/png + ISO2 mapping)
 * - US States: Wikimedia Commons Special:FilePath URLs (no fetch needed)
 *
 * Output: flags/flags.metadata.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game/public/countries.json');
const OUT_DIR = path.join(ROOT, 'flags');
const OUT_FILE = path.join(OUT_DIR, 'flags.metadata.json');

const US_STATES = [
  ['AL','Alabama'], ['AK','Alaska'], ['AZ','Arizona'], ['AR','Arkansas'], ['CA','California'], ['CO','Colorado'],
  ['CT','Connecticut'], ['DE','Delaware'], ['FL','Florida'], ['GA','Georgia'], ['HI','Hawaii'], ['ID','Idaho'],
  ['IL','Illinois'], ['IN','Indiana'], ['IA','Iowa'], ['KS','Kansas'], ['KY','Kentucky'], ['LA','Louisiana'],
  ['ME','Maine'], ['MD','Maryland'], ['MA','Massachusetts'], ['MI','Michigan'], ['MN','Minnesota'], ['MS','Mississippi'],
  ['MO','Missouri'], ['MT','Montana'], ['NE','Nebraska'], ['NV','Nevada'], ['NH','New Hampshire'], ['NJ','New Jersey'],
  ['NM','New Mexico'], ['NY','New York'], ['NC','North Carolina'], ['ND','North Dakota'], ['OH','Ohio'], ['OK','Oklahoma'],
  ['OR','Oregon'], ['PA','Pennsylvania'], ['RI','Rhode Island'], ['SC','South Carolina'], ['SD','South Dakota'], ['TN','Tennessee'],
  ['TX','Texas'], ['UT','Utah'], ['VT','Vermont'], ['VA','Virginia'], ['WA','Washington'], ['WV','West Virginia'],
  ['WI','Wisconsin'], ['WY','Wyoming']
  // DC intentionally omitted based on prior exclusion
];

function wikimediaFlagSvgUrlForState(name){
  // Most states follow "Flag of <Name>.svg" on Commons
  const file = `Flag of ${name}.svg`;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
}

async function fetchRestCountries(){
  const url = 'https://restcountries.com/v3.1/all?fields=cca2,cca3,flags';
  const res = await fetch(url);
  if(!res.ok) throw new Error(`restcountries failed: ${res.status}`);
  return res.json();
}

async function main(){
  const countries = JSON.parse(fs.readFileSync(COUNTRIES_FILE, 'utf8'));
  let rc = [];
  try{
    rc = await fetchRestCountries();
  }catch(err){
    console.error('Failed to fetch restcountries; only states metadata will be written.', err && err.message);
  }
  const byCca3 = new Map();
  for(const r of rc){
    const key = String(r && r.cca3 || '').toUpperCase();
    if(!key) continue;
    const flags = (r && r.flags) || {};
    byCca3.set(key, {
      iso2: String(r.cca2||'').toUpperCase() || null,
      svg: flags.svg || null,
      png: flags.png || null,
      source: 'restcountries'
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    countries: {},
    states: {
      byCode: {},
      byName: {}
    }
  };

  for(const c of countries){
    const iso3 = String(c.code || '').toUpperCase();
    const name = c.name || '';
    const rcEntry = byCca3.get(iso3) || null;
    if(rcEntry){
      out.countries[iso3] = {
        name,
        iso2: rcEntry.iso2,
        flagSvg: rcEntry.svg,
        flagPng: rcEntry.png,
        source: rcEntry.source
      };
    } else {
      out.countries[iso3] = {
        name,
        iso2: null,
        flagSvg: null,
        flagPng: null,
        source: null
      };
    }
  }

  for(const [code, name] of US_STATES){
    const svg = wikimediaFlagSvgUrlForState(name);
    out.states.byCode[code] = { name, flagSvg: svg, source: 'wikimedia' };
    out.states.byName[name] = { code, flagSvg: svg, source: 'wikimedia' };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log('Wrote', path.relative(ROOT, OUT_FILE));
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });

