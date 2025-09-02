const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tilesDir = path.join(__dirname, '../tiles');
const outFile = path.join(tilesDir, 'geodata.mbtiles');
const rivers = path.join(__dirname, '../vector-data/rivers.geojson');
const elevation = path.join(__dirname, '../vector-data/elevation.geojson');

if (!fs.existsSync(rivers) || !fs.existsSync(elevation)) {
  console.error('Source GeoJSON files missing in vector-data/');
  process.exit(1);
}

fs.mkdirSync(tilesDir, { recursive: true });

try {
  execFileSync('tippecanoe', [
    '-o', outFile,
    '--force',
    '-L', `rivers:${rivers}`,
    '-L', `elevation:${elevation}`
  ], { stdio: 'inherit' });
  console.log('Generated', outFile);
} catch (err) {
  console.error('Failed to run tippecanoe. Is it installed?');
  process.exit(1);
}
