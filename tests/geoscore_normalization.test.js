import { describe, it, expect } from 'vitest';
import { normalizeAnswer } from '../js/geoscore_game.js';

describe('geoscore answer normalization', () => {
  it('matches diacritic and non-diacritic versions', () => {
    const withMarks = 'São Tomé and Príncipe';
    const withoutMarks = 'Sao Tome and Principe';
    expect(normalizeAnswer(withMarks)).toBe(normalizeAnswer(withoutMarks));
  });
});
