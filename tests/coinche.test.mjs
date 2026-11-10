// Simule des parties de coinche (et de belote avec variantes) entre robots.
import assert from 'node:assert/strict';
import * as C from '../js/games/coinche.js';
import * as B from '../js/games/belote.js';
import * as T from '../js/games/trick-common.js';

function simulate(mod, opts, games, onRoundEnd) {
  let rounds = 0;
  for (let g = 0; g < games; g++) {
    const state = mod.createGame({ names: ['A', 'B', 'C', 'D'], target: 1000, variants: opts });
    let guard = 0;
    while (state.phase !== 'gameOver') {
      assert.ok(++guard < 100000, 'boucle infinie');
      const sys = mod.systemAction(state);
      if (sys) {
        assert.equal(mod.applyAction(state, 'system', sys), null);
        if (state.phase === 'roundEnd' || state.phase === 'gameOver') {
          onRoundEnd(state);
          rounds++;
        }
        continue;
      }
      if (state.phase === 'roundEnd') {
        assert.equal(mod.applyAction(state, 0, { type: 'next' }), null);
        continue;
      }
      const seat = state.turn;
      let a = mod.botAction(state, seat);
      // Coinche forcée de temps en temps pour tester le décompte ×2 / ×4.
      const c = state.contract;
      if (mod === C && state.phase === 'bidding' && c && !state.coinche && c.seat % 2 !== seat % 2 && Math.random() < 0.15) {
        a = { type: 'coinche' };
      } else if (mod === C && state.phase === 'bidding' && state.coinche === 1 && Math.random() < 0.3) {
        a = { type: 'surcoinche' };
      }
      assert.equal(mod.applyAction(state, seat, a), null, JSON.stringify(a));
    }
  }
  return rounds;
}

const trumpsSeen = new Set();
let coinches = 0;
const rounds = simulate(C, { sansToutAtout: true, annonces: true }, 300, (state) => {
  const r = state.roundResult;
  assert.equal(r.raw[0] + r.raw[1], 162, 'total des plis = 162');
  assert.ok(state.hands.every((h) => h.length === 0));
  trumpsSeen.add(r.contract.suit);
  if (r.coinche) coinches++;
  const att = r.contract.seat % 2;
  const mult = [1, 2, 4][r.coinche];
  if (r.made) assert.ok(r.gained[att] >= r.contract.value * mult);
  else assert.equal(r.gained[1 - att], (160 + r.contract.value) * mult + r.bel[1 - att] + r.ann[1 - att]);
});
assert.ok(trumpsSeen.size >= 4, 'plusieurs atouts joués');

// Belote avec annonces et sans-atout / tout-atout
const beloteRounds = simulate(B, { annonces: true, sansToutAtout: true }, 200, (state) => {
  const r = state.roundResult;
  assert.equal(r.raw[0] + r.raw[1], 162);
});

// Enchères : refus d'une enchère trop basse, coinche par l'adversaire uniquement
const s = C.createGame({ names: ['A', 'B', 'C', 'D'], variants: { sansToutAtout: true } });
const p0 = s.turn;
assert.equal(C.applyAction(s, p0, { type: 'bid', value: 100, suit: 'H' }), null);
const p1 = s.turn;
assert.notEqual(C.applyAction(s, p1, { type: 'bid', value: 90, suit: 'S' }), null, 'enchère trop basse');
assert.equal(C.applyAction(s, p1, { type: 'pass' }), null);
const p2 = s.turn; // partenaire de p0
assert.notEqual(C.applyAction(s, p2, { type: 'coinche' }), null, 'on ne coinche pas son partenaire');
assert.equal(C.applyAction(s, p2, { type: 'pass' }), null);
const p3 = s.turn;
assert.equal(C.applyAction(s, p3, { type: 'coinche' }), null);
assert.equal(s.turn, p0, 'le preneur peut surcoincher');
assert.equal(C.applyAction(s, p0, { type: 'surcoinche' }), null);
assert.equal(s.phase, 'playing');
assert.equal(s.coinche, 2);

// Règles de jeu sans-atout / tout-atout
const st = { trump: 'SA', trick: [{ seat: 0, card: 'AS' }], hands: [[], ['7S', 'JH'], [], []] };
assert.deepEqual(T.legalCards(st, 1), ['7S'], 'SA : fournir');
st.hands[1] = ['7H', 'JH'];
assert.deepEqual(T.legalCards(st, 1).sort(), ['7H', 'JH'], 'SA : pas de coupe obligatoire');
st.trump = 'TA';
st.trick = [{ seat: 0, card: 'AS' }];
st.hands[1] = ['7S', '9S', 'JH'];
assert.deepEqual(T.legalCards(st, 1), ['9S'], 'TA : monter');
assert.equal(T.trickWinner([{ seat: 0, card: 'AS' }, { seat: 1, card: '9S' }, { seat: 2, card: 'JH' }], 'TA'), 1);

// Annonces
const ann = T.findAnnonces(['7H', '8H', '9H', '10H', 'JS', 'JH', 'JD', 'JC']);
assert.ok(ann.some((a) => a.points === 200), 'carré de valets');
assert.ok(ann.some((a) => a.points === 100 && a.kind === 'suite'), 'cent (7 8 9 10 V à cœur)');

console.log(`OK : coinche ${rounds} manches (${coinches} coinchées), belote à variantes ${beloteRounds} manches.`);
