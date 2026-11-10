// Moteur de règles de la bataille (2 à 4 joueurs).
// Module pur (ni réseau ni affichage), même API que belote.js.
//
// Chaque joueur a une pile face cachée. À chaque tour, tous les joueurs retournent leur carte
// en même temps : la plus forte remporte tout. En cas d'égalité, c'est la « bataille » :
// les ex-æquo posent une carte cachée puis une carte visible, et on recommence.

import { RANKS_32, RANKS_52, rankOf, makeDeck, shuffle, randomInt, pushEvent, cardLabel } from '../cards.js';

export const id = 'bataille';
export const name = 'Bataille';
export const minSeats = 2;
export const maxSeats = 4;
export const defaultSeats = 2;
export const teams = false;
export const targets = [100, 200, 500, 0];
export const defaultTarget = 200;
export const targetLabel = (t) => (t ? `${t} tours maximum` : 'sans limite');
export const variants = [{ key: 'jeu32', label: 'Jeu de 32 cartes (partie plus courte)', default: false }];
// Rythme propre à la bataille (ms) : robots rapides, comparaison courte le temps de l'animation.
export const delays = { bot: 600, system: 900 };

const val = (card) => RANKS_52.indexOf(rankOf(card));
const RANK_PLURAL = { J: 'valets', Q: 'dames', K: 'rois', A: 'as' };
const count = (state) => state.names.length;
const activeSeats = (state) => state.piles.map((_, s) => s).filter((s) => state.piles[s].length > 0);

export function createGame({ names, target = defaultTarget, variants: opts = {} }) {
  const n = names.length;
  const deck = shuffle(makeDeck(opts.jeu32 ? RANKS_32 : RANKS_52));
  const first = randomInt(n);
  const piles = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => piles[(first + i) % n].push(c));
  const state = {
    game: id,
    names: [...names],
    variants: { jeu32: !!opts.jeu32 },
    target,
    piles,
    table: Array.from({ length: n }, () => []),
    turn: null,
    tours: 0,
    battle: 0,
    out: [],
    winner: null,
    lastWin: null,
    dealId: randomInt(1e9), // identifiant de la donne (animations)
    events: [],
    eventSeq: 0,
  };
  newTour(state, activeSeats(state));
  return state;
}

function newTour(state, contenders) {
  state.contenders = contenders;
  state.flipped = Array(count(state)).fill(false);
  state.phase = 'flip';
}

function flip(state, seat, a) {
  if (a.type !== 'flip') return 'Action invalide.';
  if (!state.contenders.includes(seat) || state.flipped[seat]) return "Ce n'est pas à toi de retourner une carte.";
  state.table[seat].push({ card: state.piles[seat].shift(), hidden: false });
  state.flipped[seat] = true;
  if (state.contenders.every((s) => state.flipped[s])) {
    state.phase = 'reveal';
  }
  return null;
}

const topCard = (state, s) => state.table[s][state.table[s].length - 1].card;

function bestSeats(state) {
  const best = Math.max(...state.contenders.map((s) => val(topCard(state, s))));
  return state.contenders.filter((s) => val(topCard(state, s)) === best);
}

function resolve(state) {
  const tied = bestSeats(state);
  if (tied.length === 1) return win(state, tied[0]);
  const able = tied.filter((s) => state.piles[s].length > 0);
  if (able.length <= 1) return win(state, able[0] ?? tied[0]);
  state.battle++;
  const r = rankOf(topCard(state, tied[0]));
  pushEvent(state, `Bataille de ${RANK_PLURAL[r] || r} entre ${able.map((s) => state.names[s]).join(' et ')} !`);
  // Chaque joueur à égalité pose automatiquement une carte face cachée (s'il lui en reste plus d'une),
  // puis retournera une nouvelle carte.
  for (const s of able) {
    if (state.piles[s].length > 1) state.table[s].push({ card: state.piles[s].shift(), hidden: true });
  }
  newTour(state, able);
}

function win(state, w) {
  const cards = state.table.flat().map((p) => p.card);
  state.piles[w].push(...shuffle(cards));
  // Ex. « Clem remporte 6 cartes : D♣ bat 8♠ (bataille gagnée !) »
  const beaten = state.contenders.filter((s) => s !== w && state.table[s].length).map((s) => cardLabel(topCard(state, s)));
  const duel = beaten.length ? ` : ${cardLabel(topCard(state, w))} bat ${beaten.join(', ')}` : '';
  pushEvent(state, `${state.names[w]} remporte ${cards.length} cartes${duel}${state.battle ? ' (bataille gagnée !)' : ''}.`);
  state.tours++;
  state.lastWin = { id: state.tours, seat: w, table: state.table.map((t) => t.map((p) => p.card)) };
  state.table = state.table.map(() => []);
  state.battle = 0;

  for (let s = 0; s < count(state); s++) {
    if (state.piles[s].length === 0 && !state.out.includes(s)) {
      state.out.push(s);
      pushEvent(state, `${state.names[s]} n'a plus de cartes : éliminé.`);
    }
  }
  const left = activeSeats(state);
  if (left.length <= 1 || (state.target && state.tours >= state.target)) {
    const most = Math.max(...state.piles.map((p) => p.length));
    state.winner = state.piles.findIndex((p) => p.length === most);
    state.phase = 'gameOver';
    state.contenders = [];
    pushEvent(
      state,
      left.length <= 1
        ? `${state.names[state.winner]} a toutes les cartes et gagne !`
        : `Limite de ${state.target} tours atteinte : ${state.names[state.winner]} gagne avec ${most} cartes.`
    );
    return;
  }
  newTour(state, left);
}

export function applyAction(state, seat, a) {
  if (!a || typeof a !== 'object') return 'Action invalide.';
  switch (state.phase) {
    case 'flip':
      return flip(state, seat, a);
    case 'reveal':
      if (seat === 'system' && a.type === 'resolve') {
        resolve(state);
        return null;
      }
      return 'Patiente un instant…';
    default:
      return 'Action invalide.';
  }
}

export function systemAction(state) {
  return state.phase === 'reveal' ? { type: 'resolve' } : null;
}

export function waiting(state) {
  return state.phase === 'flip' ? state.contenders.filter((s) => !state.flipped[s]) : [];
}

export function view(state, seat) {
  const n = count(state);
  const mine = seat >= 0 && seat < n;
  return {
    game: id,
    seat: mine ? seat : -1,
    names: state.names,
    variants: state.variants,
    phase: state.phase,
    turn: null,
    target: state.target,
    tours: state.tours,
    battle: state.battle,
    pileCounts: state.piles.map((p) => p.length),
    table: state.table.map((t) => t.map((p) => (p.hidden ? { hidden: true } : { card: p.card }))),
    contenders: state.contenders,
    // Pendant la comparaison : siège(s) ayant la carte la plus forte.
    best: state.phase === 'reveal' ? bestSeats(state) : [],
    waiting: waiting(state),
    out: state.out,
    winner: state.winner,
    lastWin: state.lastWin,
    dealId: state.dealId,
    events: state.events,
  };
}

export function botAction(state, seat) {
  return waiting(state).includes(seat) ? { type: 'flip' } : null;
}
