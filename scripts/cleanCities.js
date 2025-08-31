#!/usr/bin/env node
/*
  Remove all cities.geojson (and optional suffixed variants) under
  geolayers-game/public/data/<ISO3>/.

  Usage:
    node scripts/cleanCities.js           # deletes cities*.geojson
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');

function main(){
  const dirs = fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter(d=>d.isDirectory()).map(d=>d.name);
  let removed=0; let touched=0;
  for(const iso of dirs){
    const dir = path.join(DATA_DIR, iso);
    try{
      const files = fs.readdirSync(dir).filter(f=>/^cities.*\.geojson$/i.test(f));
      for(const f of files){
        fs.unlinkSync(path.join(dir, f));
        removed++;
      }
      if(files.length) touched++;
    }catch{}
  }
  console.log(`Removed ${removed} file(s) across ${touched} country folder(s).`);
}

main();

