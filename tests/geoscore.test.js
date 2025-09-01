import { describe, it, expect, beforeEach } from 'vitest';
import { loadQuestions, saveQuestions, DEFAULT_QUESTIONS, categorizeQuestion } from '../js/geoscore.js';

describe('geoscore persistence', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: key => (key in store ? store[key] : null),
      setItem: (key, val) => { store[key] = String(val); },
      removeItem: key => { delete store[key]; }
    };
    global.fetch = async () => ({ ok: false });
  });

  it('provides default questions when storage is empty', async () => {
    const qs = await loadQuestions();
    expect(qs).toEqual(DEFAULT_QUESTIONS);
    expect(qs.some(q => /^Name a world capital city beginning with the letter /i.test(q.question))).toBe(true);
  });

  it('clamps answer scores to 0-100 range', async () => {
    const qs = [{
      question: 'Capital of France?',
      answers: [
        { answer: 'Paris', score: 1, count: 2 },
        { answer: 'Lyon', score: 0, count: 1 }
      ]
    }];
    saveQuestions(qs);
    const loaded = await loadQuestions();
    const q = loaded.find(x => x.question === 'Capital of France?');
    expect(q.answers[0]).toEqual({ answer: 'Paris', score: 1, count: 1 });
    expect(q.answers[1]).toEqual({ answer: 'Lyon', score: 0, count: 0 });
    expect(loaded.length).toBeGreaterThan(qs.length);
  });

  it('retains scores when all are equal', async () => {
    const qs = [{
      question: 'Test uniform',
      answers: [
        { answer: 'A', score: 5, count: 2 },
        { answer: 'B', score: 5, count: 1 }
      ]
    }];
    saveQuestions(qs);
    const loaded = await loadQuestions();
    const q = loaded.find(x => x.question === 'Test uniform');
    expect(q.answers.every(a => a.score === 5 && a.count === 5)).toBe(true);
  });

  it('categorizes elevation questions', () => {
    const cat = categorizeQuestion({ question: 'What is the highest elevation point on Earth?' });
    expect(cat).toBe('Elevation');
  });

  it('categorizes world capital letter questions', () => {
    const cat = categorizeQuestion({ question: 'Name a world capital city beginning with the letter B' });
    expect(cat).toBe('Country Capitals');
  });
});
