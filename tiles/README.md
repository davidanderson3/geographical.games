# Vector Tiles

This directory holds generated MBTiles archives for the backend tile service.
Run `npm run generate:tiles` to recreate `geodata.mbtiles` from the GeoJSON
files in `vector-data/`. By default, it includes `rivers.geojson` and
`elevation.geojson`. If `vector-data/roads.geojson` exists, it will be added
as a `roads` layer automatically. The `.mbtiles` output is ignored by git.
