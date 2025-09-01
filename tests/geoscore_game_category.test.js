import { describe, it, expect } from 'vitest';
import { categorizeQuestion } from '../js/geoscore_game.js';

describe('geoscore game categorization', () => {
  it('categorizes world capital letter questions', () => {
    const q = { question: 'Name a world capital city beginning with the letter B' };
    expect(categorizeQuestion(q)).toBe('capital');
  });
});
