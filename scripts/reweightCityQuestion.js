#!/usr/bin/env node
/**
 * Recompute scores for "Name a city in ___" questions.
 * Usage:
 *   node scripts/reweightCityQuestion.js "Name a city in France"
 *   node scripts/reweightCityQuestion.js --all --top=5 --max=90 --decay=0.6 --unknown=25
 *
 * The script reads geoscore_questions.json to find the requested question,
 * rescales answer scores based on population metadata, then writes the overrides.
 * With --all it updates every matching city question.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUESTIONS_PATH = path.join(ROOT, 'geoscore_questions.json');
const OVERRIDES_PATH = path.join(ROOT, 'backend', 'geoscore-overrides.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const opts = {
    all: false,
    max: 90,
    top: 5,
    decay: 0.6,
    unknown: 25,
    minMultiplier: 0.3,
    familiarThreshold: 0.75,
    decayBoost: 0.2,
    maxDecay: 0.95,
    questionWords: []
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      opts.all = true;
    } else if (arg.startsWith('--max=')) {
      opts.max = Number(arg.split('=')[1]);
    } else if (arg === '--max' && i + 1 < argv.length) {
      opts.max = Number(argv[++i]);
    } else if (arg.startsWith('--top=')) {
      opts.top = Number(arg.split('=')[1]);
    } else if (arg === '--top' && i + 1 < argv.length) {
      opts.top = Number(argv[++i]);
    } else if (arg.startsWith('--decay=')) {
      opts.decay = Number(arg.split('=')[1]);
    } else if (arg === '--decay' && i + 1 < argv.length) {
      opts.decay = Number(argv[++i]);
    } else if (arg.startsWith('--unknown=')) {
      opts.unknown = Number(arg.split('=')[1]);
    } else if (arg === '--unknown' && i + 1 < argv.length) {
      opts.unknown = Number(argv[++i]);
    } else if (arg.startsWith('--min-multiplier=')) {
      opts.minMultiplier = Number(arg.split('=')[1]);
    } else if (arg === '--min-multiplier' && i + 1 < argv.length) {
      opts.minMultiplier = Number(argv[++i]);
    } else if (arg.startsWith('--familiar-threshold=')) {
      opts.familiarThreshold = Number(arg.split('=')[1]);
    } else if (arg === '--familiar-threshold' && i + 1 < argv.length) {
      opts.familiarThreshold = Number(argv[++i]);
    } else if (arg.startsWith('--decay-boost=')) {
      opts.decayBoost = Number(arg.split('=')[1]);
    } else if (arg === '--decay-boost' && i + 1 < argv.length) {
      opts.decayBoost = Number(argv[++i]);
    } else if (arg.startsWith('--max-decay=')) {
      opts.maxDecay = Number(arg.split('=')[1]);
    } else if (arg === '--max-decay' && i + 1 < argv.length) {
      opts.maxDecay = Number(argv[++i]);
    } else {
      opts.questionWords.push(arg);
    }
  }
  if (!Number.isFinite(opts.max) || opts.max <= 0) {
    throw new Error('Invalid --max value; must be a positive number.');
  }
  if (!Number.isFinite(opts.top) || opts.top < 1) {
    throw new Error('Invalid --top value; must be at least 1.');
  }
  if (!Number.isFinite(opts.decay) || opts.decay <= 0 || opts.decay > 1) {
    throw new Error('Invalid --decay value; must be in (0, 1].');
  }
  if (!Number.isFinite(opts.unknown)) {
    opts.unknown = 25;
  }
  if (!Number.isFinite(opts.minMultiplier) || opts.minMultiplier < 0 || opts.minMultiplier > 1) {
    opts.minMultiplier = 0.3;
  }
  if (!Number.isFinite(opts.familiarThreshold)) {
    opts.familiarThreshold = 0.75;
  }
  if (!Number.isFinite(opts.decayBoost)) {
    opts.decayBoost = 0.2;
  }
  if (!Number.isFinite(opts.maxDecay) || opts.maxDecay <= 0 || opts.maxDecay > 1) {
    opts.maxDecay = 0.95;
  }
  return opts;
}

function normalizePlaceKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^the\s+/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function loadCountryFamiliarity(overrides) {
  const map = new Map();
  if (overrides && overrides.weightByCountry && typeof overrides.weightByCountry === 'object') {
    for (const [name, val] of Object.entries(overrides.weightByCountry)) {
      const key = normalizePlaceKey(name);
      const score = Number(val);
      if (!key || !Number.isFinite(score)) continue;
      map.set(key, Math.max(0, Math.min(100, score)));
    }
  }
  const scoresPath = path.join(ROOT, 'country-scores.json');
  if (fs.existsSync(scoresPath)) {
    try {
      const rows = readJson(scoresPath);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row || typeof row.country !== 'string') continue;
          const key = normalizePlaceKey(row.country);
          const score = Number(row.score);
          if (!key || !Number.isFinite(score) || map.has(key)) continue;
          map.set(key, Math.max(0, Math.min(100, score)));
        }
      }
    } catch (err) {
      console.warn(`Failed to read country-scores.json:`, err.message);
    }
  }
  return map;
}

function computeCountryAdjustments(baseOpts, familiarity) {
  const famRaw = Number.isFinite(familiarity) ? familiarity : baseOpts.unknown;
  const fam = Math.max(0, Math.min(100, famRaw));
  const famNorm = fam / 100;
  const minMultiplier = Math.max(0, Math.min(1, baseOpts.minMultiplier));
  const maxMultiplier = minMultiplier + (1 - minMultiplier) * famNorm;
  const maxScore = Math.max(1, Math.round(baseOpts.max * Math.min(1, maxMultiplier)));

  let decay = baseOpts.decay;
  const threshold = Math.max(0, Math.min(1, baseOpts.familiarThreshold));
  if (famNorm >= threshold) {
    const extra = (famNorm - threshold) / Math.max(0.001, (1 - threshold));
    decay = Math.min(baseOpts.maxDecay, baseOpts.decay + extra * baseOpts.decayBoost);
  }
  return { max: maxScore, decay };
}

function ensureQuestionText(args) {
  const text = args.join(' ').trim();
  if (!text) {
    console.error('Error: pass the exact question text, e.g.');
    console.error('  node scripts/reweightCityQuestion.js "Name a city in France"');
    process.exit(1);
  }
  return text;
}

function asQuestionArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.questions)) return raw.questions;
  throw new Error('Unexpected geoscore_questions.json shape');
}

function computeScores(answers, opts) {
  const enriched = answers.map((ans, idx) => {
    const original = String(ans && (ans._orig || ans.answer) || '');
    const pop = Number(ans && ans.meta && ans.meta.population);
    return {
      original,
      pop: Number.isFinite(pop) && pop > 0 ? pop : 0,
      idx
    };
  });
  if (!enriched.some((item) => item.pop > 0)) {
    throw new Error('Selected question has no population metadata to rescore');
  }
  enriched.sort((a, b) => {
    if (b.pop === a.pop) return a.idx - b.idx;
    return b.pop - a.pop;
  });

  const nonZeroCount = Math.min(opts.top, enriched.length);
  const scoresByOriginal = new Map();
  for (let rank = 0; rank < enriched.length; rank += 1) {
    const { original } = enriched[rank];
    if (!original) continue;
    let score = 0;
    if (rank < nonZeroCount) {
      const weight = Math.pow(opts.decay, rank);
      score = Math.round(opts.max * weight);
      if (score < 1) score = 1;
    }
    scoresByOriginal.set(original, score);
  }
  for (const ans of answers) {
    const original = String(ans && (ans._orig || ans.answer) || '');
    if (!original) continue;
    if (!scoresByOriginal.has(original)) {
      scoresByOriginal.set(original, 0);
    }
  }
  return Object.fromEntries(scoresByOriginal.entries());
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const runAll = parsed.all;
  const questionArgWords = parsed.questionWords;
  let singleQuestionText = null;
  if (!runAll) {
    singleQuestionText = ensureQuestionText(questionArgWords);
  } else if (questionArgWords.length) {
    console.warn('Ignoring additional arguments when using --all.');
  }

  if (!fs.existsSync(QUESTIONS_PATH)) {
    throw new Error(`Missing questions file: ${QUESTIONS_PATH}`);
  }
  const questions = asQuestionArray(readJson(QUESTIONS_PATH));
  const cityRegex = /^\s*Name a city in\b/i;
  const targets = runAll
    ? questions.filter((q) => q && typeof q.question === 'string' && cityRegex.test(q.question))
    : questions.filter((q) => q && q.question === singleQuestionText);

  if (!targets.length) {
    throw new Error(runAll
      ? 'No questions starting with "Name a city in" were found.'
      : `Question not found: ${singleQuestionText}`);
  }

  let overrides = {};
  if (fs.existsSync(OVERRIDES_PATH)) {
    overrides = readJson(OVERRIDES_PATH);
  }
  const countryFamiliarity = loadCountryFamiliarity(overrides);
  overrides.weightOverrides = overrides.weightOverrides || {};

  let updatedCount = 0;
  for (const target of targets) {
    const questionText = String(target.question);
    const answers = Array.isArray(target.answers) ? target.answers : [];
    if (!answers.length) {
      console.warn(`Skipping "${questionText}" because it has no answers.`);
      continue;
    }
    let effectiveOpts = { ...parsed };
    const match = /^\s*Name a city in\s+(.+?)\s*$/.exec(questionText);
    if (match) {
      const key = normalizePlaceKey(match[1]);
      const familiarity = countryFamiliarity.get(key);
      const adjustments = computeCountryAdjustments(parsed, familiarity);
      effectiveOpts = { ...effectiveOpts, ...adjustments };
    }
    const answerCount = answers.length;
    const scarcityPenalty = answerCount >= parsed.top ? 1 : Math.max(0.3, answerCount / Math.max(1, parsed.top));
    effectiveOpts.max = Math.max(1, Math.round(effectiveOpts.max * scarcityPenalty));
    const currentTop = Number.isFinite(effectiveOpts.top) ? effectiveOpts.top : parsed.top;
    effectiveOpts.top = Math.max(1, Math.min(currentTop, answerCount || 1));
    const newScores = computeScores(answers, effectiveOpts);
    if (!Object.keys(newScores).length) {
      console.warn(`Skipping "${questionText}" because scores could not be computed.`);
      continue;
    }
    overrides.weightOverrides[questionText] = newScores;
    updatedCount += 1;
  }

  if (!updatedCount) {
    console.error('No questions were updated.');
    process.exit(1);
  }

  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2));
  const relPath = path.relative(ROOT, OVERRIDES_PATH);
  console.log(`Updated weight overrides for ${updatedCount} question${updatedCount === 1 ? '' : 's'} in ${relPath}`);

  if (!runAll) {
    const questionText = targets[0].question;
    const preview = Object.entries(overrides.weightOverrides[questionText])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, score]) => `  ${score.toString().padStart(3)}  ${name}`)
      .join('\n');
    console.log('Top answers:');
    console.log(preview);
  }
}

main();
