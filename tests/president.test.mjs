// Simule des parties de président entre robots.
import assert from 'node:assert/strict';
import * as P from '../js/games/president.js';

let rounds = 0;
for (let n = 3; n <= 6; n++) {
  for (let g = 0; g < 60; g++) {
    const names = Array.from({ length: n }, (_, i) => `J${i}`);
    const state = P.createGame({ names, target: 5 });
    let guard = 0;
    while (state.phase !== 'gameOver') {
      assert.ok(++guard < 100000, 'boucle infinie');
      // Conservation des 52 cartes (mains + pile + cartes déjà posées comptées à part)
      if (state.phase === 'exchange' || (state.phase === 'playing' && !state.pile && state.finished.length === 0)) {
        const all = state.hands.flat();
        if (all.length === 52) assert.equal(new Set(all).size, 52);
      }
      const sys = P.systemAction(state);
      if (sys) {
        assert.equal(P.applyAction(state, 'system', sys), null);
        continue;
      }
      if (state.phase === 'roundEnd') {
        const r = state.roundResult;
        assert.equal(r.order.length, n, 'chaque joueur a une place');
        assert.equal(new Set(r.order).size, n);
        rounds++;
        assert.equal(P.applyAction(state, 0, { type: 'next' }), null);
        if (state.phase === 'exchange') {
          assert.ok(state.hands.flat().length === 52);
          // Le Président a reçu 2 cartes en plus avant de rendre.
          const pres = state.places.indexOf(0);
          assert.equal(Object.keys(state.exchange.pending).length, n >= 4 ? 2 : 1);
          assert.ok(state.exchange.pending[pres]);
        }
        continue;
      }
      const seats = P.waiting(state);
      assert.ok(seats.length > 0, `quelqu'un doit jouer (phase ${state.phase})`);
      for (const seat of seats) {
        if (state.phase === 'playing') {
          assert.ok(state.hands[seat].length > 0, 'un joueur sorti ne joue plus');
          // Une combinaison invalide est refusée
          if (state.pile) {
            assert.notEqual(P.applyAction(state, seat, { type: 'play', cards: [state.hands[seat][0], 'XX'] }), null);
          }
        }
        const a = P.botAction(state, seat);
        assert.equal(P.applyAction(state, seat, a), null, JSON.stringify(a));
      }
    }
    assert.equal(state.round, 5);
    assert.equal(
      state.scores.reduce((x, y) => x + y, 0),
      5 * ((n * (n - 1)) / 2),
      'total des points distribués'
    );
  }
}

// Vérifications ciblées de checkPlay
assert.equal(P.checkPlay(null, ['7H', '7S', '9C'], ['7H', '7S']), null);
assert.notEqual(P.checkPlay(null, ['7H', '8S'], ['7H', '8S']), null, 'valeurs différentes');
assert.notEqual(P.checkPlay({ cards: ['9H', '9S'] }, ['10H', '10S', '10C'], ['10H']), null, 'mauvais nombre');
assert.notEqual(P.checkPlay({ cards: ['9H'] }, ['9C'], ['9C']), null, 'pas plus fort');
assert.equal(P.checkPlay({ cards: ['AH'] }, ['2C'], ['2C']), null, 'le 2 bat l\'as');

console.log(`OK : président, ${rounds} manches de 3 à 6 joueurs.`);
