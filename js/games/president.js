// Moteur de règles du président (3 à 6 joueurs, jeu de 52 cartes).
// Module pur (ni réseau ni affichage), même API que belote.js.
//
// Ordre des cartes : 3 (la plus faible) … 10, V, D, R, A, 2 (la plus forte).
// Le but est de se débarrasser de ses cartes le plus vite possible.

import { RANKS_52, rankOf, suitOf, makeDeck, shuffle, randomInt, pushEvent, cardLabel } from '../cards.js';

export const id = 'president';
export const name = 'Président';
export const minSeats = 3;
export const maxSeats = 6;
export const defaultSeats = 4;
export const teams = false;
export const targets = [3, 5, 10, 15];
export const defaultTarget = 5;
export const targetLabel = (t) => `${t} manches`;
export const variants = [];
export const delays = { bot: 700, system: 1000 };

export const ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const val = (card) => ORDER.indexOf(rankOf(card));
const SUIT_ORDER = ['C', 'D', 'H', 'S'];
const sortCards = (cards) => [...cards].sort((a, b) => val(a) - val(b) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)));

// Titres selon la place d'arrivée (0 = premier sorti).
export function roleNames(n) {
  if (n === 3) return ['Président', 'Neutre', 'Trou du cul'];
  const r = Array(n).fill('Neutre');
  r[0] = 'Président';
  r[1] = 'Vice-président';
  r[n - 2] = 'Vice-trou du cul';
  r[n - 1] = 'Trou du cul';
  return r;
}

const count = (state) => state.names.length;
const active = (state, s) => state.hands[s].length > 0;
const activeSeats = (state) => state.hands.map((_, s) => s).filter((s) => active(state, s));

function nextActive(state, from) {
  const n = count(state);
  for (let k = 1; k <= n; k++) {
    const s = (from + k) % n;
    if (active(state, s)) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Création et déroulement

export function createGame({ names, target = defaultTarget }) {
  const n = names.length;
  const state = {
    game: id,
    names: [...names],
    target,
    variants: {},
    scores: Array(n).fill(0),
    places: null, // place d'arrivée de chaque siège à la manche précédente
    dealer: Math.floor(Math.random() * n),
    round: 0,
    history: [],
    events: [],
    eventSeq: 0,
  };
  startRound(state);
  return state;
}

function startRound(state) {
  const n = count(state);
  state.round++;
  state.dealId = randomInt(1e9); // identifiant de la donne (animations)
  state.transfers = []; // cartes échangées : { id, from, to, cards, auto }
  const deck = shuffle(makeDeck(RANKS_52));
  state.hands = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => state.hands[(state.dealer + 1 + i) % n].push(c));
  state.finished = [];
  state.pile = null;
  state.prevPile = null;
  state.lastPile = null;
  state.lastPlayer = null;
  state.passes = 0;
  state.lastAction = Array(n).fill(null);
  state.roundResult = null;
  state.exchange = null;
  pushEvent(state, `Manche ${state.round}.`);

  if (!state.places) {
    state.phase = 'playing';
    state.turn = state.hands.findIndex((h) => h.includes('3C'));
    pushEvent(state, `${state.names[state.turn]} a le 3♣ et commence.`);
    return;
  }

  // Échanges : les perdants donnent leurs meilleures cartes, les gagnants rendent celles de leur choix.
  const bySeat = [...state.places.keys()].sort((a, b) => state.places[a] - state.places[b]);
  const pairs = [{ winner: bySeat[0], loser: bySeat[n - 1], count: 2 }];
  if (n >= 4) pairs.push({ winner: bySeat[1], loser: bySeat[n - 2], count: 1 });
  state.exchange = { pending: {}, received: {} };
  for (const { winner, loser, count: k } of pairs) {
    const best = sortCards(state.hands[loser]).slice(-k);
    state.hands[loser] = state.hands[loser].filter((c) => !best.includes(c));
    state.hands[winner].push(...best);
    state.exchange.pending[winner] = { to: loser, count: k };
    state.exchange.received[winner] = best;
    state.transfers.push({ id: state.transfers.length + 1, from: loser, to: winner, cards: best, auto: true });
    pushEvent(state, `${state.names[loser]} donne ${k === 2 ? 'ses 2 meilleures cartes' : 'sa meilleure carte'} à ${state.names[winner]}.`);
  }
  state.firstLeader = bySeat[n - 1];
  state.phase = 'exchange';
  state.turn = null;
}

function give(state, seat, a) {
  const p = state.exchange.pending[seat];
  if (!p) return "Tu n'as rien à donner.";
  if (a.type !== 'give' || !Array.isArray(a.cards)) return 'Action invalide.';
  const cards = [...new Set(a.cards)];
  if (cards.length !== p.count || !cards.every((c) => state.hands[seat].includes(c))) {
    return `Choisis ${p.count} carte${p.count > 1 ? 's' : ''} à donner.`;
  }
  state.hands[seat] = state.hands[seat].filter((c) => !cards.includes(c));
  state.hands[p.to].push(...cards);
  state.transfers.push({ id: state.transfers.length + 1, from: seat, to: p.to, cards, auto: false });
  delete state.exchange.pending[seat];
  pushEvent(state, `${state.names[seat]} rend ${p.count} carte${p.count > 1 ? 's' : ''} à ${state.names[p.to]}.`);
  if (Object.keys(state.exchange.pending).length === 0) {
    state.phase = 'playing';
    state.turn = state.firstLeader;
    pushEvent(state, `${state.names[state.turn]} commence.`);
  }
  return null;
}

// Vérifie une combinaison posée. Retourne un message d'erreur ou null.
export function checkPlay(pile, hand, cards) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4) return 'Pose 1 à 4 cartes de même valeur.';
  if (new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return 'Cartes invalides.';
  if (!cards.every((c) => rankOf(c) === rankOf(cards[0]))) return 'Les cartes posées doivent avoir la même valeur.';
  if (pile) {
    if (cards.length !== pile.cards.length) return `Il faut poser ${pile.cards.length} carte${pile.cards.length > 1 ? 's' : ''}.`;
    if (val(cards[0]) <= val(pile.cards[0])) return 'Il faut poser plus fort que la pile.';
  }
  return null;
}

function play(state, seat, a) {
  if (seat !== state.turn) return "Ce n'est pas ton tour.";
  const who = state.names[seat];

  if (a.type === 'pass') {
    if (!state.pile) return 'Tu commences le pli : pose au moins une carte.';
    state.passes++;
    state.lastAction[seat] = 'pass';
    return advance(state, seat);
  }
  if (a.type !== 'play') return 'Action invalide.';
  const error = checkPlay(state.pile, state.hands[seat], a.cards);
  if (error) return error;

  const cards = sortCards(a.cards);
  state.hands[seat] = state.hands[seat].filter((c) => !cards.includes(c));
  state.prevPile = state.pile;
  state.pile = { seat, cards };
  state.lastPlayer = seat;
  state.passes = 0;
  state.lastAction[seat] = cards;
  pushEvent(state, `${who} pose ${cards.map(cardLabel).join(' ')}.`);

  if (!active(state, seat)) {
    state.finished.push(seat);
    pushEvent(state, `${who} n'a plus de cartes (${roleNames(count(state))[state.finished.length - 1]}).`);
  }
  if (activeSeats(state).length <= 1) {
    endRound(state);
    return null;
  }
  if (rankOf(cards[0]) === '2') return closePile(state); // un 2 ferme le pli
  return advance(state, seat);
}

function advance(state, from) {
  const others = activeSeats(state).filter((s) => s !== state.lastPlayer).length;
  if (state.pile && state.passes >= others) return closePile(state);
  state.turn = nextActive(state, from);
  return null;
}

function closePile(state) {
  state.phase = 'pileEnd';
  state.turn = null;
  return null;
}

// Le pli est ramassé : le dernier à avoir posé recommence (ou le suivant s'il a fini).
function collect(state) {
  const last = state.lastPlayer;
  state.pileSeq = (state.pileSeq || 0) + 1;
  state.lastPile = { id: state.pileSeq, seat: last, cards: state.pile.cards, prev: state.prevPile?.cards || null };
  pushEvent(
    state,
    rankOf(state.pile.cards[0]) === '2'
      ? `Le 2 ferme le pli de ${state.names[last]}.`
      : `Personne ne bat ${state.pile.cards.map(cardLabel).join(' ')} : pli pour ${state.names[last]}.`
  );
  state.pile = null;
  state.prevPile = null;
  state.passes = 0;
  state.lastAction = state.lastAction.map(() => null);
  state.phase = 'playing';
  state.turn = active(state, last) ? last : nextActive(state, last);
}

function endRound(state) {
  const n = count(state);
  for (const s of activeSeats(state)) state.finished.push(s);
  const roles = roleNames(n);
  state.places = Array(n).fill(0);
  const gained = Array(n).fill(0);
  state.finished.forEach((s, place) => {
    state.places[s] = place;
    gained[s] = n - 1 - place;
    state.scores[s] += gained[s];
  });
  state.pile = null;
  state.prevPile = null;
  state.turn = null;
  state.roundResult = { order: [...state.finished], roles: state.finished.map((_, i) => roles[i]), gained };
  state.history.push({ round: state.round, order: [...state.finished] });
  pushEvent(state, `${state.names[state.finished[0]]} est Président !`);

  if (state.round >= state.target) {
    const best = Math.max(...state.scores);
    // À égalité, le mieux classé de la dernière manche l'emporte.
    state.winner = state.finished.find((s) => state.scores[s] === best);
    state.phase = 'gameOver';
  } else {
    state.phase = 'roundEnd';
  }
}

// ---------------------------------------------------------------------------
// API appelée par l'hôte

export function applyAction(state, seat, a) {
  if (!a || typeof a !== 'object') return 'Action invalide.';
  switch (state.phase) {
    case 'exchange':
      return give(state, seat, a);
    case 'playing':
      return play(state, seat, a);
    case 'pileEnd':
      if (seat === 'system' && a.type === 'collect') {
        collect(state);
        return null;
      }
      return 'Patiente un instant…';
    case 'roundEnd':
      if (a.type === 'next') {
        state.dealer = (state.dealer + 1) % count(state);
        startRound(state);
        return null;
      }
      return 'Action invalide.';
    default:
      return 'Action invalide.';
  }
}

export function systemAction(state) {
  return state.phase === 'pileEnd' ? { type: 'collect' } : null;
}

export function waiting(state) {
  if (state.phase === 'exchange') return Object.keys(state.exchange.pending).map(Number);
  return state.turn === null || state.turn === undefined ? [] : [state.turn];
}

export function view(state, seat) {
  const n = count(state);
  const mine = seat >= 0 && seat < n;
  const roles = roleNames(n);
  return {
    game: id,
    seat: mine ? seat : -1,
    names: state.names,
    variants: state.variants,
    phase: state.phase,
    round: state.round,
    target: state.target,
    turn: state.turn,
    scores: state.scores,
    roles: state.places ? state.places.map((p) => roles[p]) : null,
    hand: mine ? sortCards(state.hands[seat]) : [],
    handCounts: state.hands.map((h) => h.length),
    pile: state.pile,
    prevPile: state.prevPile,
    lastPile: state.lastPile,
    lastAction: state.lastAction,
    dealId: state.dealId,
    // Échanges : les cartes ne sont visibles que de celui qui donne et de celui qui reçoit.
    transfers: state.transfers.map((t) => ({ ...t, count: t.cards.length, cards: seat === t.from || seat === t.to ? t.cards : null })),
    finished: state.finished,
    finishedRoles: state.finished.map((_, i) => roles[i]),
    exchange:
      mine && state.exchange?.pending[seat]
        ? { ...state.exchange.pending[seat], received: state.exchange.received[seat] }
        : null,
    waiting: waiting(state),
    roundResult: state.roundResult,
    winner: state.winner ?? null,
    events: state.events,
  };
}

// ---------------------------------------------------------------------------
// Robot

export function botAction(state, seat) {
  const hand = sortCards(state.hands[seat]);
  if (state.phase === 'exchange') {
    const p = state.exchange.pending[seat];
    return p ? { type: 'give', cards: hand.slice(0, p.count) } : null;
  }
  if (state.phase !== 'playing') return null;

  const groups = new Map();
  for (const c of hand) {
    const v = val(c);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(c);
  }
  const TWO = ORDER.indexOf('2');

  if (!state.pile) {
    // Ouvrir avec la plus petite valeur (on garde les 2 pour la fin).
    const vals = [...groups.keys()];
    const v = vals.find((x) => x !== TWO) ?? vals[0];
    return { type: 'play', cards: groups.get(v) };
  }
  const need = state.pile.cards.length;
  const pv = val(state.pile.cards[0]);
  const options = [...groups.entries()]
    .filter(([v, cards]) => v > pv && cards.length >= need)
    .sort((a, b) => (a[1].length !== need) - (b[1].length !== need) || a[0] - b[0]);
  if (!options.length) return { type: 'pass' };
  const [v, cards] = options[0];
  if (v === TWO && hand.length > 5) return { type: 'pass' };
  return { type: 'play', cards: cards.slice(0, need) };
}
