// Moteur de règles de la coinche (belote contrée), 4 joueurs en 2 équipes.
// Module pur (ni réseau ni affichage), même API que belote.js.
//
// Donne 3-2-3 sans carte retournée, puis un seul tour d'enchères continu :
// chaque joueur annonce un contrat (80 à 160, ou capot) dans une couleur
// (ou sans-atout / tout-atout si la variante est activée), passe, coinche ou surcoinche.

import { SUITS, RANKS_32, makeDeck, shuffle, randomInt, pushEvent } from '../cards.js';
import * as T from './trick-common.js';

const { next, teamOf } = T;

export const id = 'coinche';
export const name = 'Coinche';
export const minSeats = 4;
export const maxSeats = 4;
export const defaultSeats = 4;
export const teams = true;
export const targets = [1000, 1500, 2000, 3000];
export const defaultTarget = 2000;
export const targetLabel = (t) => `${t} points`;
// Rythme (ms) : délai des robots, et temps pour voir le pli avant qu'il soit ramassé.
export const delays = { bot: 700, system: 1000 };
export const variants = [
  { key: 'sansToutAtout', label: 'Sans-atout et tout-atout', default: true },
  { key: 'annonces', label: 'Annonces (tierce, cinquante, cent, carrés)', default: true },
];

export const CAPOT = 250;
export const BID_VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, CAPOT];
export const bidLabel = (value) => (value === CAPOT ? 'Capot' : String(value));
const COINCHE_LABEL = ['', 'coinché', 'surcoinché'];

export function trumpChoices(state) {
  return state.variants?.sansToutAtout ? [...SUITS, 'SA', 'TA'] : [...SUITS];
}

export const contractText = (c, coinche = 0) =>
  `${bidLabel(c.value)} ${T.trumpLabel(c.suit)}${coinche ? ` (${COINCHE_LABEL[coinche]})` : ''}`;

// ---------------------------------------------------------------------------
// Création et déroulement

export function createGame({ names, target = defaultTarget, variants: opts = {} }) {
  const state = {
    game: id,
    names: [...names],
    target,
    variants: { sansToutAtout: !!opts.sansToutAtout, annonces: !!opts.annonces },
    scores: [0, 0],
    dealer: Math.floor(Math.random() * 4),
    round: 0,
    history: [],
    events: [],
    eventSeq: 0,
  };
  startRound(state);
  return state;
}

function startRound(state) {
  state.round++;
  state.dealId = randomInt(1e9); // identifiant de la donne (animations)
  const deck = shuffle(makeDeck(RANKS_32));
  state.hands = [[], [], [], []];
  let i = 0;
  for (const n of [3, 2, 3]) {
    for (let k = 1; k <= 4; k++) {
      const s = (state.dealer + k) % 4;
      for (let j = 0; j < n; j++) state.hands[s].push(deck[i++]);
    }
  }
  state.phase = 'bidding';
  state.turn = next(state.dealer);
  state.passes = 0;
  state.contract = null;
  state.coinche = 0;
  state.lastBids = [null, null, null, null];
  state.trump = null;
  state.taker = null;
  state.trick = [];
  state.trickWinner = null;
  state.lastTrick = null;
  state.trickPoints = [0, 0];
  state.tricksWon = [0, 0];
  state.beloteSeat = null;
  state.beloteCount = 0;
  state.annonces = null;
  state.roundResult = null;
  pushEvent(state, `Manche ${state.round} : ${state.names[state.dealer]} distribue.`);
}

function startPlay(state) {
  const c = state.contract;
  state.trump = c.suit;
  state.taker = c.seat;
  T.findBelote(state);
  state.phase = 'playing';
  state.turn = next(state.dealer);
  pushEvent(state, `Contrat : ${state.names[c.seat]}, ${contractText(c, state.coinche)}.`);
  if (state.variants.annonces) {
    state.annonces = T.resolveAnnonces(state.hands, c.suit, state.turn);
    T.announceAll(state);
  }
}

function bid(state, seat, a) {
  if (seat !== state.turn) return "Ce n'est pas ton tour.";
  const c = state.contract;
  const who = state.names[seat];

  switch (a.type) {
    case 'pass':
      state.lastBids[seat] = 'Passe';
      pushEvent(state, `${who} passe.`);
      if (state.coinche) {
        startPlay(state); // le preneur ne surcoinche pas
        return null;
      }
      state.passes++;
      if (!c && state.passes === 4) {
        pushEvent(state, 'Tout le monde passe : on redistribue.');
        state.dealer = next(state.dealer);
        startRound(state);
      } else if (c && state.passes === 3) {
        startPlay(state);
      } else {
        state.turn = next(seat);
      }
      return null;

    case 'bid': {
      if (state.coinche) return 'Le contrat est coinché : les enchères sont closes.';
      const value = Number(a.value);
      if (!BID_VALUES.includes(value)) return 'Valeur de contrat invalide.';
      if (c && value <= c.value) return `Il faut annoncer plus que ${bidLabel(c.value)}.`;
      if (!trumpChoices(state).includes(a.suit)) return 'Atout invalide.';
      state.contract = { seat, value, suit: a.suit };
      state.lastBids[seat] = contractText(state.contract);
      state.passes = 0;
      state.turn = next(seat);
      pushEvent(state, `${who} annonce ${contractText(state.contract)}.`);
      return null;
    }

    case 'coinche':
      if (!c || state.coinche || teamOf(c.seat) === teamOf(seat)) return "On ne peut coincher que l'enchère adverse.";
      state.coinche = 1;
      state.lastBids[seat] = 'Coinche !';
      pushEvent(state, `${who} coinche ! ${state.names[c.seat]} peut surcoincher.`);
      state.turn = c.seat;
      return null;

    case 'surcoinche':
      if (state.coinche !== 1 || seat !== c.seat) return 'Surcoinche impossible.';
      state.coinche = 2;
      state.lastBids[seat] = 'Surcoinche !';
      pushEvent(state, `${who} surcoinche !`);
      startPlay(state);
      return null;

    default:
      return 'Enchère invalide.';
  }
}

function endRound(state) {
  const c = state.contract;
  const att = teamOf(c.seat);
  const def = 1 - att;
  const raw = [...state.trickPoints];
  const bel = [0, 0];
  if (state.beloteSeat !== null) bel[teamOf(state.beloteSeat)] = 20;
  const ann = state.annonces ? [...state.annonces.points] : [0, 0];
  // Points réalisés (un capot non annoncé vaut 252).
  const pts = [0, 1].map((t) => (state.tricksWon[t] === 8 ? 252 : raw[t]) + bel[t] + ann[t]);
  const mult = [1, 2, 4][state.coinche];

  const made = c.value === CAPOT ? state.tricksWon[att] === 8 : pts[att] >= c.value && pts[att] > pts[def];
  const gained = [0, 0];
  let outcome;
  if (made) {
    gained[att] = c.value * mult + pts[att];
    gained[def] = state.coinche ? bel[def] : pts[def];
    outcome = c.value === CAPOT ? 'Capot annoncé et réussi !' : 'Contrat rempli.';
  } else {
    gained[def] = (160 + c.value) * mult + bel[def] + ann[def];
    gained[att] = bel[att];
    outcome = 'Dedans ! Le contrat chute.';
  }

  state.scores[0] += gained[0];
  state.scores[1] += gained[1];
  state.roundResult = { contract: c, coinche: state.coinche, raw, bel, ann, pts, gained, made, outcome };
  state.history.push({ round: state.round, contract: c, coinche: state.coinche, gained });
  state.turn = null;
  pushEvent(state, outcome);

  const over = state.scores.some((s) => s >= state.target) && state.scores[0] !== state.scores[1];
  if (over) {
    state.phase = 'gameOver';
    state.winner = state.scores[0] > state.scores[1] ? 0 : 1;
  } else {
    state.phase = 'roundEnd';
  }
}

// ---------------------------------------------------------------------------
// API appelée par l'hôte

export function applyAction(state, seat, a) {
  if (!a || typeof a !== 'object') return 'Action invalide.';
  switch (state.phase) {
    case 'bidding':
      return bid(state, seat, a);
    case 'playing':
      return T.playCard(state, seat, a);
    case 'trickEnd':
      if (seat === 'system' && a.type === 'collect') {
        if (T.collectTrick(state)) endRound(state);
        return null;
      }
      return 'Patiente un instant…';
    case 'roundEnd':
      if (a.type === 'next') {
        state.dealer = next(state.dealer);
        startRound(state);
        return null;
      }
      return 'Action invalide.';
    default:
      return 'Action invalide.';
  }
}

export function systemAction(state) {
  return state.phase === 'trickEnd' ? { type: 'collect' } : null;
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < 4;
  return {
    game: id,
    seat: mine ? seat : -1,
    names: state.names,
    variants: state.variants,
    phase: state.phase,
    round: state.round,
    dealer: state.dealer,
    turn: state.turn,
    trump: state.trump,
    taker: state.taker,
    contract: state.contract,
    dealId: state.dealId,
    coinche: state.coinche,
    lastBids: state.lastBids,
    trumpChoices: trumpChoices(state),
    target: state.target,
    scores: state.scores,
    hand: mine ? T.sortHand(state.hands[seat], state.trump) : [],
    handCounts: state.hands.map((h) => h.length),
    trick: state.trick,
    trickWinner: state.trickWinner,
    lastTrick: state.lastTrick,
    tricksWon: state.tricksWon,
    trickPoints: state.trickPoints,
    annonces: state.annonces,
    legal: mine && state.phase === 'playing' && state.turn === seat ? T.legalCards(state, seat) : [],
    roundResult: state.roundResult,
    history: state.history,
    winner: state.winner ?? null,
    events: state.events,
  };
}

// ---------------------------------------------------------------------------
// Robot

function estimate(hand, trump) {
  const score = T.handScore(hand, trump);
  return score >= 8 ? Math.min(160, 80 + (score - 8) * 10) : 0;
}

function botBid(state, seat) {
  const hand = state.hands[seat];
  const c = state.contract;
  if (state.coinche) {
    return { type: estimate(hand, c.suit) >= c.value + 30 ? 'surcoinche' : 'pass' };
  }
  if (c && teamOf(c.seat) !== teamOf(seat)) {
    const t = c.suit;
    if (c.value >= 100 && T.isSuitTrump(t) && hand.includes('J' + t) && hand.includes('9' + t)) return { type: 'coinche' };
  }
  if (c && teamOf(c.seat) === teamOf(seat)) return { type: 'pass' }; // on laisse le partenaire
  let best = { est: 0, suit: null };
  for (const t of trumpChoices(state)) {
    const est = estimate(hand, t);
    if (est > best.est) best = { est, suit: t };
  }
  const min = c ? c.value + 10 : 80;
  if (!best.suit || min > 160 || best.est < min) return { type: 'pass' };
  return { type: 'bid', value: c ? min : Math.min(best.est, 100), suit: best.suit };
}

export function botAction(state, seat) {
  switch (state.phase) {
    case 'bidding':
      return botBid(state, seat);
    case 'playing':
      return { type: 'play', card: T.chooseCard(state, seat) };
    default:
      return null;
  }
}
