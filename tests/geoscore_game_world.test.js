/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { initGeoScoreGame } from '../js/geoscore_game.js';
import { saveQuestions } from '../js/geoscore.js';

describe('geoscore world game', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: key => (key in store ? store[key] : null),
      setItem: (key, val) => { store[key] = String(val); },
      removeItem: key => { delete store[key]; }
    };
    global.fetch = async () => ({ ok: false });
    document.body.innerHTML = '<div id="geoscoreGame"></div>';
    saveQuestions([
      {
        question: 'Name a city in France',
        answers: [{ answer: 'Paris', score: 10, count: 10 }]
      }
    ]);
  });

  it('initializes world mode interface', async () => {
    await initGeoScoreGame();
    expect(document.querySelector('#geoscoreGame button')).not.toBeNull();
  });
});
