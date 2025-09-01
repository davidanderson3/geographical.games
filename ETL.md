# ETL Process

This project includes a Node.js ETL pipeline for generating geoscore questions.

## Workflow
1. **Extract**: `scripts/generateGeoscoreQuestions.js` requests data from
   * U.S. Census / ArcGIS endpoints for place boundaries and populations.
   * Wikipedia API for article sizes.
2. **Transform**: Combine the data, compute rankings and estimated mentions, and prepare output rows per state.
3. **Validate**: Each output row is verified to contain a two-letter state code, numeric population, geoid and score fields. The script throws if any record is invalid.
4. **Load**:
   * CSV `us_pointless_places_wiki.csv` and per-state CSVs are written to disk.
   * `geoscore_questions.json` is created with formatted question objects.
   * When invoked with `--firestore`, data is synced to the `geoscoreQuestions` collection in Firestore.

## Running

```
npm run generate:geoscore
```

Optional flags like `--states=CA,TX`, `--merge-json`, or `--firestore` are passed directly to the script.
