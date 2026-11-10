// Moteur de règles du pouilleux (2 à 6 joueurs).
// Module pur (ni réseau ni affichage), même API que belote.js.
//
// Jeu de 52 cartes dont on retire le valet de trèfle : le valet de pique (le « pouilleux »)
// n'a donc pas de paire. On défausse les paires (même valeur, même couleur rouge/noire) ;
// à son tour, on pioche une carte au hasard chez son voisin. Le dernier avec le pouilleux perd.

import { RANKS_52, SUITS, rankOf, suitOf, isRed, makeDeck, shuffle, randomInt, pushEvent } from '../cards.js';

export const id = 'pouilleux';
export const name = 'Pouilleux';
export const minSeats = 2;
export const maxSeats = 6;
export const defaultSeats = 4;
export const teams = false;
export const targets = null;
export const defaultTarget = null;
export const targetLabel = () => '';
export const variants = [];
export const delays = { bot: 800 };

export const POUILLEUX = 'JS';
const RANK_NAME = { J: 'valets', Q: 'dames', K: 'rois', A: 'as' };
const pairKey = (c) => rankOf(c) + (isRed(suitOf(c)) ? 'r' : 'n');
const pairName = (c) => `paire de ${RANK_NAME[rankOf(c)] || rankOf(c)} ${isRed(suitOf(c)) ? 'rouges' : 'noirs'}`;

const count = (state) => state.names.length;
const active = (state, s) => state.hands[s].length > 0;
const activeSeats = (state) => state.hands.map((_, s) => s).filter((s) => active(state, s));

function nextActive(state, from) {
  const n = count(state);
  for (let k = 1; k < n; k++) {
    const s = (from + k) % n;
    if (active(state, s)) return s;
  }
  return null;
}

// Joueur chez qui `seat` pioche.
export const sourceOf = (state, seat) => nextActive(state, seat);

function removePairs(hand) {
  const kept = [];
  let pairs = 0;
  for (const c of hand) {
    const i = kept.findIndex((k) => pairKey(k) === pairKey(c));
    if (i >= 0) {
      kept.splice(i, 1);
      pairs++;
    } else {
      kept.push(c);
    }
  }
  return { kept, pairs };
}

export function createGame({ names }) {
  const n = names.length;
  const state = {
    game: id,
    names: [...names],
    variants: {},
    target: null,
    events: [],
    eventSeq: 0,
    drawSeq: 0,
  };
  const deck = shuffle(makeDeck(RANKS_52).filter((c) => c !== 'JC'));
  const first = randomInt(n);
  state.hands = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => state.hands[(first + i) % n].push(c));
  state.dealId = randomInt(1e9); // identifiant de la donne (animations)
  state.initialPairs = [];
  state.hands = state.hands.map((h, s) => {
    const { kept, pairs } = removePairs(h);
    state.initialPairs[s] = pairs;
    pushEvent(state, `${names[s]} défausse ${pairs} paire${pairs > 1 ? 's' : ''}.`);
    return shuffle(kept);
  });
  state.out = [];
  state.lastDraw = null;
  state.loser = null;
  state.phase = 'playing';
  markOut(state);
  if (!checkEnd(state)) {
    state.turn = active(state, first) ? first : nextActive(state, first);
    pushEvent(state, `${state.names[state.turn]} commence.`);
  }
  return state;
}

function markOut(state) {
  for (let s = 0; s < count(state); s++) {
    if (!active(state, s) && !state.out.includes(s)) {
      state.out.push(s);
      pushEvent(state, `${state.names[s]} n'a plus de cartes : sauvé !`);
    }
  }
}

function checkEnd(state) {
  const left = activeSeats(state);
  if (left.length > 1) return false;
  state.phase = 'gameOver';
  state.turn = null;
  state.loser = left[0] ?? null;
  if (state.loser !== null) pushEvent(state, `${state.names[state.loser]} garde le pouilleux et perd la partie !`);
  return true;
}

function draw(state, seat, a) {
  if (a.type !== 'draw') return 'Action invalide.';
  if (seat !== state.turn) return "Ce n'est pas ton tour.";
  const from = sourceOf(state, seat);
  const hand = state.hands[from];
  if (!Number.isInteger(a.index) || a.index < 0 || a.index >= hand.length) return 'Carte invalide.';

  const [card] = hand.splice(a.index, 1);
  const mine = state.hands[seat];
  const mate = mine.findIndex((c) => pairKey(c) === pairKey(card));
  const paired = mate >= 0;
  const pair = paired ? [card, mine[mate]] : null;
  if (paired) mine.splice(mate, 1);
  else mine.push(card);
  // On remélange : la position d'une carte ne révèle rien.
  state.hands[from] = shuffle(hand);
  state.hands[seat] = shuffle(mine);
  state.lastDraw = { id: ++state.drawSeq, from, to: seat, card, paired, pair };
  pushEvent(
    state,
    `${state.names[seat]} pioche chez ${state.names[from]}${paired ? ` et défausse une ${pairName(card)}` : ''}.`
  );

  markOut(state);
  if (!checkEnd(state)) state.turn = nextActive(state, seat);
  return null;
}

export function applyAction(state, seat, a) {
  if (!a || typeof a !== 'object') return 'Action invalide.';
  if (state.phase === 'playing') return draw(state, seat, a);
  return 'Action invalide.';
}

export function systemAction() {
  return null;
}

const SUIT_ORDER = SUITS;
const sortHand = (hand) =>
  [...hand].sort(
    (a, b) => RANKS_52.indexOf(rankOf(a)) - RANKS_52.indexOf(rankOf(b)) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b))
  );

export function view(state, seat) {
  const n = count(state);
  const mine = seat >= 0 && seat < n;
  const d = state.lastDraw;
  // La carte piochée n'est connue que de celui qui pioche et de celui qui la perd.
  // Une paire défaussée est montrée à tous.
  const lastDraw = d && {
    id: d.id,
    from: d.from,
    to: d.to,
    paired: d.paired,
    pair: d.pair || null,
    card: seat === d.from || seat === d.to || d.paired ? d.card : null,
  };
  return {
    game: id,
    seat: mine ? seat : -1,
    names: state.names,
    variants: state.variants,
    phase: state.phase,
    turn: state.turn,
    source: state.turn === null ? null : sourceOf(state, state.turn),
    hand: mine ? sortHand(state.hands[seat]) : [],
    handCounts: state.hands.map((h) => h.length),
    out: state.out,
    loser: state.loser,
    dealId: state.dealId,
    initialPairs: state.initialPairs,
    lastDraw,
    events: state.events,
  };
}

export function botAction(state, seat) {
  if (state.phase !== 'playing' || state.turn !== seat) return null;
  return { type: 'draw', index: randomInt(state.hands[sourceOf(state, seat)].length) };
}
