const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATES_DIR = path.join(ROOT, 'states_wiki');
const OUT_FILE = path.join(ROOT, 'us_cities.json');

function collectCities(){
  const files = fs.readdirSync(STATES_DIR).filter(f => f.endsWith('.csv'));
  const names = new Set();
  for(const file of files){
    const lines = fs.readFileSync(path.join(STATES_DIR, file), 'utf8').split(/\r?\n/);
    for(let i=1;i<lines.length;i++){
      const line = lines[i];
      if(!line) continue;
      const parts = line.split(',');
      if(parts.length >= 3){
        const name = parts[2].trim();
        if(name) names.add(name);
      }
    }
  }
  return Array.from(names).sort();
}

function main(){
  const cities = collectCities();
  fs.writeFileSync(OUT_FILE, JSON.stringify(cities));
  console.log(`Wrote ${cities.length} city names to ${path.relative(ROOT, OUT_FILE)}`);
}

if(require.main === module){
  main();
}
