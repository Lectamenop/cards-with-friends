// Simule des parties complètes entre robots et vérifie les invariants du moteur.
// Lancer : node tests/belote.test.mjs
import assert from 'node:assert/strict';
import * as B from '../js/games/belote.js';

let rounds = 0;
const GAMES = 500;

for (let g = 0; g < GAMES; g++) {
  const state = B.createGame({ names: ['A', 'B', 'C', 'D'], target: 1000 });
  let guard = 0;
  while (state.phase !== 'gameOver') {
    assert.ok(++guard < 100000, 'boucle infinie');
    const sys = B.systemAction(state);
    if (sys) {
      assert.equal(B.applyAction(state, 'system', sys), null);
      continue;
    }
    if (state.phase === 'roundEnd') {
      const r = state.roundResult;
      assert.equal(r.raw[0] + r.raw[1], 162, 'total des plis = 162');
      assert.ok(state.hands.every((h) => h.length === 0));
      rounds++;
      assert.equal(B.applyAction(state, 0, { type: 'next' }), null);
      continue;
    }
    const seat = state.turn;
    if (state.phase === 'playing') {
      const legal = B.legalCards(state, seat);
      assert.ok(legal.length > 0, 'au moins une carte jouable');
      assert.ok(legal.every((c) => state.hands[seat].includes(c)));
      // les autres joueurs ne peuvent pas jouer
      assert.notEqual(B.applyAction(state, (seat + 1) % 4, { type: 'play', card: state.hands[(seat + 1) % 4][0] }), null);
      // une carte illégale est refusée
      const illegal = state.hands[seat].find((c) => !legal.includes(c));
      if (illegal) assert.notEqual(B.applyAction(state, seat, { type: 'play', card: illegal }), null);
      // vue d'un adversaire : ne contient pas la main du joueur
      const v = B.view(state, (seat + 1) % 4);
      assert.ok(!JSON.stringify(v.hand).includes(JSON.stringify(state.hands[seat])) || state.hands[seat].length === 0);
    }
    const a = B.botAction(state, seat);
    assert.equal(B.applyAction(state, seat, a), null, JSON.stringify(a));
    if (state.phase === 'playing' && state.trick.length === 0 && state.hands[0].length === 8) {
      const total = state.hands.reduce((n, h) => n + h.length, 0);
      assert.equal(total, 32, '32 cartes distribuées');
      assert.equal(new Set(state.hands.flat()).size, 32);
    }
  }
  assert.ok(state.scores.some((s) => s >= 1000));
}

// Cas précis : obligation de couper / monter
const s = { trump: 'H', trick: [{ seat: 0, card: 'AS' }], hands: [[], ['7H', 'JH', '8C'], [], []] };
assert.deepEqual(B.legalCards(s, 1).sort(), ['7H', 'JH'], 'doit couper');
s.trick = [{ seat: 0, card: 'AS' }, { seat: 1, card: '9H' }];
s.hands[2] = ['7H', 'JH', '8C'];
assert.deepEqual(B.legalCards(s, 2), ['JH'], 'doit surcouper');
s.hands[2] = ['7H', '8C'];
assert.deepEqual(B.legalCards(s, 2), ['7H'], 'doit sous-couper');
s.trick = [{ seat: 0, card: 'AS' }, { seat: 1, card: '7S' }];
s.hands[2] = ['7H', '8C'];
assert.deepEqual(B.legalCards(s, 2).sort(), ['7H', '8C'], 'partenaire maître : libre');
s.trick = [{ seat: 0, card: '10H' }];
s.hands[1] = ['7H', 'JH', 'AS'];
assert.deepEqual(B.legalCards(s, 1), ['JH'], 'doit monter à l’atout');

console.log(`OK : ${GAMES} parties, ${rounds} manches jouées sans erreur.`);
