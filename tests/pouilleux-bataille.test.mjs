// Simule des parties de pouilleux et de bataille entre robots.
import assert from 'node:assert/strict';
import * as PX from '../js/games/pouilleux.js';
import * as BA from '../js/games/bataille.js';

// ---------------------------------------------------------------- pouilleux
let pxGames = 0;
for (let n = 2; n <= 6; n++) {
  for (let g = 0; g < 100; g++) {
    const state = PX.createGame({ names: Array.from({ length: n }, (_, i) => `J${i}`) });
    let guard = 0;
    while (state.phase !== 'gameOver') {
      assert.ok(++guard < 10000, 'boucle infinie');
      const seat = state.turn;
      assert.ok(state.hands[seat].length > 0);
      const src = PX.sourceOf(state, seat);
      assert.notEqual(src, seat);
      assert.notEqual(PX.applyAction(state, seat, { type: 'draw', index: 999 }), null, 'index invalide refusé');
      // Vue : la main de la source n'est jamais visible
      const v = PX.view(state, seat);
      assert.equal(v.hand.length, state.hands[seat].length);
      assert.equal(PX.applyAction(state, seat, PX.botAction(state, seat)), null);
      // Aucune main ne contient de paire
      for (const h of state.hands) {
        const keys = h.map((c) => c.slice(0, -1) + (/[HD]$/.test(c) ? 'r' : 'n'));
        assert.equal(new Set(keys).size, keys.length, 'pas de paire en main');
      }
    }
    assert.notEqual(state.loser, null);
    assert.deepEqual(state.hands[state.loser], ['JS'], 'le perdant garde le valet de pique');
    assert.equal(state.hands.flat().length, 1);
    pxGames++;
  }
}

// ---------------------------------------------------------------- bataille
let baGames = 0;
let battles = 0;
for (let n = 2; n <= 4; n++) {
  for (const jeu32 of [false, true]) {
    for (let g = 0; g < 50; g++) {
      const state = BA.createGame({ names: Array.from({ length: n }, (_, i) => `J${i}`), target: 300, variants: { jeu32 } });
      const total = jeu32 ? 32 : 52;
      let guard = 0;
      while (state.phase !== 'gameOver') {
        assert.ok(++guard < 100000, 'boucle infinie');
        const cards = state.piles.flat().length + state.table.flat().length;
        assert.equal(cards, total, 'conservation des cartes');
        const sys = BA.systemAction(state);
        if (sys) {
          assert.equal(BA.applyAction(state, 'system', sys), null);
          if (state.battle) battles++;
          continue;
        }
        const waiting = BA.waiting(state);
        assert.ok(waiting.length > 0);
        for (const s of waiting) {
          assert.equal(BA.applyAction(state, s, BA.botAction(state, s)), null);
          assert.notEqual(BA.applyAction(state, s, { type: 'flip' }), null, 'on ne retourne qu\'une fois');
        }
      }
      assert.ok(state.tours <= 300);
      assert.ok(state.winner !== null);
      assert.equal(state.piles.flat().length, total);
      baGames++;
    }
  }
}

console.log(`OK : pouilleux ${pxGames} parties, bataille ${baGames} parties (${battles} batailles).`);
