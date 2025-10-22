const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATES_DIR = path.join(ROOT, 'states_wiki');
const OUT_FILE = path.join(ROOT, 'us_cities.json');

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
  DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky',
  LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana',
  NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee',
  TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
  DC:'District of Columbia', PR:'Puerto Rico'
};

function safeParseInt(str){
  if(str == null) return 0;
  const n = Number(str);
  if(Number.isFinite(n)) return n;
  const cleaned = String(str).replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsvLine(line){
  const out = [];
  let current = '';
  let inQuotes = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){
      if(inQuotes && line[i+1] === '"'){
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if(ch === ',' && !inQuotes){
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function collectCities(){
  const files = fs.readdirSync(STATES_DIR).filter(f => f.endsWith('.csv'));
  const map = new Map(); // normalized city name -> { name, states: Map }
  for(const file of files){
    const full = path.join(STATES_DIR, file);
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    if(!lines.length) continue;
    const header = parseCsvLine(lines[0]).map(h=>h.trim());
    const idx = Object.fromEntries(header.map((h,i)=>[h, i]));
    for(let i=1;i<lines.length;i++){
      const line = lines[i];
      if(!line) continue;
      const parts = parseCsvLine(line);
      const stusps = (parts[idx.stusps] || '').trim();
      const basename = (parts[idx.basename] || '').trim();
      const pop = safeParseInt(parts[idx.pop2020]);
      if(!basename || !stusps) continue;
      const stateName = STATE_NAMES[stusps] || stusps;
      const key = basename.toLowerCase();
      if(!map.has(key)){
        map.set(key, {
          name: basename,
          states: new Map(),
          maxPopulation: 0
        });
      }
      const entry = map.get(key);
      const max = Math.max(entry.maxPopulation, pop);
      entry.maxPopulation = max;
      const stateEntry = entry.states.get(stusps);
      if(!stateEntry || pop > stateEntry.population){
        entry.states.set(stusps, {
          stateCode: stusps,
          stateName,
          population: pop
        });
      }
    }
  }

  const out = Array.from(map.values())
    .map(entry => ({
      name: entry.name,
      maxPopulation: entry.maxPopulation,
      states: Array.from(entry.states.values()).sort((a,b)=> a.stateName.localeCompare(b.stateName))
    }))
    .sort((a,b)=> entryNameSort(a.name, b.name));

  return out;
}

function entryNameSort(a, b){
  return String(a).localeCompare(String(b));
}

function main(){
  const cities = collectCities();
  fs.writeFileSync(OUT_FILE, JSON.stringify(cities, null, 2));
  console.log(`Wrote ${cities.length} city records to ${path.relative(ROOT, OUT_FILE)}`);
}

if(require.main === module){
  main();
}
