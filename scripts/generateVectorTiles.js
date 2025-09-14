const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tilesDir = path.join(__dirname, '../tiles');
const outFile = path.join(tilesDir, 'geodata.mbtiles');
const rivers = path.join(__dirname, '../vector-data/rivers.geojson');
const elevation = path.join(__dirname, '../vector-data/elevation.geojson');
const roads = path.join(__dirname, '../vector-data/roads.geojson');

if (!fs.existsSync(rivers) || !fs.existsSync(elevation)) {
  console.error('Source GeoJSON files missing in vector-data/ (need rivers.geojson and elevation.geojson)');
  process.exit(1);
}

fs.mkdirSync(tilesDir, { recursive: true });

try {
  const args = [
    '-o', outFile,
    '--force',
    '-L', `rivers:${rivers}`,
    '-L', `elevation:${elevation}`
  ];
  if (fs.existsSync(roads)) {
    // Optionally include roads layer if present
    args.push('-L', `roads:${roads}`);
  } else {
    console.warn('vector-data/roads.geojson not found; roads layer will be omitted');
  }
  execFileSync('tippecanoe', args, { stdio: 'inherit' });
  console.log('Generated', outFile);
} catch (err) {
  console.error('Failed to run tippecanoe. Is it installed?');
  process.exit(1);
}
