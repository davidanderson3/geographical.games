#!/usr/bin/env node
/*
  Generate GeoScore questions for world capitals grouped by first letter.

  - Downloads countries.csv from https://github.com/lorey/list-of-countries
  - Builds question: "Name a world capital city beginning with the letter X"
    for each letter with at least 5 capitals.
  - Answers are deduplicated and sorted; scores are uniform.

  Usage:
    node scripts/generateWorldCapitalLetters.js [--merge-json] [--score=1]
*/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'geoscore_questions.json');
const COUNTRIES_CSV_URL = 'https://raw.githubusercontent.com/lorey/list-of-countries/master/csv/countries.csv';

function fetchCsv() {
  try {
    return execSync(`curl -L ${COUNTRIES_CSV_URL}`, { encoding: 'utf8' });
  } catch (e) {
    console.error('Failed to fetch countries CSV:', e.message || e);
    process.exit(1);
  }
}

function parseCapitals(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(';');
  const idx = header.indexOf('capital');
  if (idx < 0) return [];
  const caps = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    const cap = (cols[idx] || '').trim();
    if (cap) caps.push(cap);
  }
  return caps;
}

function groupCapitalsByLetter(caps) {
  const map = new Map();
  for (const cap of caps) {
    const letter = cap[0].toUpperCase();
    if (!/^[A-Z]$/.test(letter)) continue;
    if (!map.has(letter)) map.set(letter, new Set());
    map.get(letter).add(cap);
  }
  return map;
}

function buildQuestions(map, score) {
  const questions = [];
  const letters = Array.from(map.keys()).sort();
  for (const letter of letters) {
    const caps = Array.from(map.get(letter)).sort((a, b) => a.localeCompare(b));
    if (caps.length < 5) continue;
    const answers = caps.map(c => ({ answer: c, score, count: score }));
    questions.push({ question: `Name a world capital city beginning with the letter ${letter}`, answers });
  }
  return questions;
}

function mergeQuestions(existing, additional) {
  for (const q of additional) {
    const idx = existing.findIndex(x => x.question === q.question);
    if (idx >= 0) existing[idx] = q;
    else existing.push(q);
  }
  return existing;
}

async function main() {
  const argv = process.argv.slice(2);
  const mergeJson = argv.includes('--merge-json');
  const scoreArg = argv.find(a => a.startsWith('--score='));
  const score = scoreArg ? Math.max(1, Number(scoreArg.split('=')[1]) || 1) : 1;

  const csv = fetchCsv();
  const capitals = parseCapitals(csv);
  const grouped = groupCapitalsByLetter(capitals);
  const questions = buildQuestions(grouped, score);

  let outArr = questions;
  if (mergeJson && fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      outArr = mergeQuestions(existing, questions);
    } catch {}
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(outArr, null, 2));
  console.log(`Wrote ${questions.length} questions to ${OUT_FILE}`);
}

main().catch(e => {
  console.error('ERROR:', e && e.message || e);
  process.exit(1);
});
