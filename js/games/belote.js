// Moteur de règles de la belote classique (4 joueurs, 2 équipes).
// Ce module est "pur" : il ne touche ni au réseau ni à l'affichage.
// Il ne tourne que chez l'hôte, qui envoie à chaque joueur une vue filtrée (view).
//
// Sièges 0..3, joués dans l'ordre 0 → 1 → 2 → 3 (sens inverse des aiguilles d'une montre).
// Équipes : sièges 0 et 2 (équipe 0) contre sièges 1 et 3 (équipe 1).

import { SUITS, SUIT_SYMBOL, suitOf, rankOf, makeDeck, shuffle } from '../cards.js';

export const id = 'belote';
export const name = 'Belote';
export const seatCount = 4;
export const targets = [500, 1000, 1500, 2000];

const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const TRUMP_ORDER = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J']; // du plus faible au plus fort
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const TRUMP_POINTS = { J: 20, 9: 14, A: 11, 10: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const PLAIN_POINTS = { A: 11, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const MAX_EVENTS = 8;

const next = (seat) => (seat + 1) % 4;
export const teamOf = (seat) => seat % 2;

export function cardPoints(card, trump) {
  return (suitOf(card) === trump ? TRUMP_POINTS : PLAIN_POINTS)[rankOf(card)];
}

function strength(card, trump, leadSuit) {
  const s = suitOf(card);
  if (s === trump) return 100 + TRUMP_ORDER.indexOf(rankOf(card));
  if (s === leadSuit) return PLAIN_ORDER.indexOf(rankOf(card));
  return -1;
}

export function trickWinner(trick, trump) {
  const lead = suitOf(trick[0].card);
  let best = trick[0];
  for (const p of trick) {
    if (strength(p.card, trump, lead) > strength(best.card, trump, lead)) best = p;
  }
  return best.seat;
}

// Cartes que `seat` a le droit de jouer (règles officielles : fournir, couper, monter à l'atout).
export function legalCards(state, seat) {
  const hand = state.hands[seat];
  const trick = state.trick;
  if (trick.length === 0) return [...hand];

  const trump = state.trump;
  const lead = suitOf(trick[0].card);
  const trumps = hand.filter((c) => suitOf(c) === trump);
  const bestTrump = Math.max(
    -1,
    ...trick.filter((p) => suitOf(p.card) === trump).map((p) => TRUMP_ORDER.indexOf(rankOf(p.card)))
  );
  const higherTrumps = trumps.filter((c) => TRUMP_ORDER.indexOf(rankOf(c)) > bestTrump);

  if (lead === trump) {
    if (trumps.length === 0) return [...hand];
    return higherTrumps.length ? higherTrumps : trumps; // obligation de monter
  }

  const follow = hand.filter((c) => suitOf(c) === lead);
  if (follow.length) return follow; // obligation de fournir

  // Impossible de fournir : si le partenaire est maître, on joue ce qu'on veut.
  if (teamOf(trickWinner(trick, trump)) === teamOf(seat)) return [...hand];
  if (trumps.length === 0) return [...hand];
  return higherTrumps.length ? higherTrumps : trumps; // couper, surcouper si possible
}

function pushEvent(state, text) {
  state.eventSeq = (state.eventSeq || 0) + 1;
  state.events.push({ id: state.eventSeq, text });
  if (state.events.length > MAX_EVENTS) state.events.shift();
}

// ---------------------------------------------------------------------------
// Création et déroulement

export function createGame({ names, target = 1000 }) {
  const state = {
    game: id,
    names: [...names],
    target,
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
  const deck = shuffle(makeDeck(RANKS));
  state.hands = [[], [], [], []];
  let i = 0;
  for (const n of [3, 2]) {
    for (let k = 1; k <= 4; k++) {
      const s = (state.dealer + k) % 4;
      for (let j = 0; j < n; j++) state.hands[s].push(deck[i++]);
    }
  }
  state.turnCard = deck[i++];
  state.deck = deck.slice(i);
  state.phase = 'bidding1';
  state.turn = next(state.dealer);
  state.passes = 0;
  state.trump = null;
  state.taker = null;
  state.trick = [];
  state.trickWinner = null;
  state.lastTrick = null;
  state.trickPoints = [0, 0];
  state.tricksWon = [0, 0];
  state.beloteSeat = null;
  state.beloteCount = 0;
  state.roundResult = null;
  pushEvent(state, `Manche ${state.round} : ${state.names[state.dealer]} distribue.`);
}

function take(state, seat, suit) {
  state.trump = suit;
  state.taker = seat;
  state.hands[seat].push(state.turnCard);
  let i = 0;
  for (let k = 1; k <= 4; k++) {
    const s = (state.dealer + k) % 4;
    const n = s === seat ? 2 : 3;
    for (let j = 0; j < n; j++) state.hands[s].push(state.deck[i++]);
  }
  state.turnCard = null;
  state.deck = [];
  for (let s = 0; s < 4; s++) {
    if (state.hands[s].includes('K' + suit) && state.hands[s].includes('Q' + suit)) state.beloteSeat = s;
  }
  state.phase = 'playing';
  state.turn = next(state.dealer);
  pushEvent(state, `${state.names[seat]} prend à ${SUIT_SYMBOL[suit]}.`);
}

function bid(state, seat, a) {
  if (seat !== state.turn) return "Ce n'est pas ton tour.";
  if (a.type === 'pass') {
    pushEvent(state, `${state.names[seat]} passe.`);
    state.passes++;
    if (state.passes < 4) {
      state.turn = next(seat);
    } else if (state.phase === 'bidding1') {
      state.phase = 'bidding2';
      state.passes = 0;
      state.turn = next(state.dealer);
      pushEvent(state, "Deuxième tour d'enchères.");
    } else {
      pushEvent(state, 'Tout le monde passe : on redistribue.');
      state.dealer = next(state.dealer);
      startRound(state);
    }
    return null;
  }
  const turnSuit = suitOf(state.turnCard);
  if (a.type === 'take' && state.phase === 'bidding1') {
    take(state, seat, turnSuit);
    return null;
  }
  if (a.type === 'choose' && state.phase === 'bidding2' && SUITS.includes(a.suit) && a.suit !== turnSuit) {
    take(state, seat, a.suit);
    return null;
  }
  return 'Enchère invalide.';
}

function play(state, seat, a) {
  if (a.type !== 'play') return 'Action invalide.';
  if (seat !== state.turn) return "Ce n'est pas ton tour.";
  if (!legalCards(state, seat).includes(a.card)) return "Tu n'as pas le droit de jouer cette carte.";

  state.hands[seat] = state.hands[seat].filter((c) => c !== a.card);
  state.trick.push({ seat, card: a.card });

  if (seat === state.beloteSeat && (a.card === 'K' + state.trump || a.card === 'Q' + state.trump)) {
    state.beloteCount++;
    pushEvent(state, `${state.names[seat]} : ${state.beloteCount === 1 ? 'Belote !' : 'Rebelote !'}`);
  }

  if (state.trick.length === 4) {
    state.phase = 'trickEnd';
    state.trickWinner = trickWinner(state.trick, state.trump);
    state.turn = null;
  } else {
    state.turn = next(seat);
  }
  return null;
}

// Ramasse le pli (déclenché automatiquement par l'hôte après une courte pause).
function collect(state) {
  const w = state.trickWinner;
  const team = teamOf(w);
  state.trickPoints[team] += state.trick.reduce((sum, p) => sum + cardPoints(p.card, state.trump), 0);
  state.tricksWon[team]++;
  state.lastTrick = { cards: state.trick, winner: w };
  state.trick = [];
  state.trickWinner = null;
  if (state.hands.every((h) => h.length === 0)) {
    state.trickPoints[team] += 10; // dix de der
    endRound(state);
  } else {
    state.phase = 'playing';
    state.turn = w;
  }
}

function endRound(state) {
  const att = teamOf(state.taker);
  const def = 1 - att;
  const raw = [...state.trickPoints];
  const bel = [0, 0];
  if (state.beloteSeat !== null) bel[teamOf(state.beloteSeat)] = 20;

  const gained = [0, 0];
  let outcome;
  if (state.tricksWon[att] === 8) {
    gained[att] = 252 + bel[att];
    gained[def] = bel[def];
    outcome = 'Capot ! Le preneur fait tous les plis.';
  } else if (raw[att] + bel[att] > raw[def] + bel[def]) {
    gained[att] = raw[att] + bel[att];
    gained[def] = raw[def] + bel[def];
    outcome = 'Contrat rempli.';
  } else {
    gained[def] = (state.tricksWon[def] === 8 ? 252 : 162) + bel[def];
    gained[att] = bel[att];
    outcome = 'Dedans ! Le preneur chute.';
  }

  state.scores[0] += gained[0];
  state.scores[1] += gained[1];
  state.roundResult = { taker: state.taker, trump: state.trump, raw, bel, gained, outcome };
  state.history.push({ round: state.round, taker: state.taker, trump: state.trump, gained });
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

// Applique une action. Retourne null si OK, sinon un message d'erreur.
// `seat` vaut 'system' pour les actions automatiques de l'hôte.
export function applyAction(state, seat, a) {
  if (!a || typeof a !== 'object') return 'Action invalide.';
  switch (state.phase) {
    case 'bidding1':
    case 'bidding2':
      return bid(state, seat, a);
    case 'playing':
      return play(state, seat, a);
    case 'trickEnd':
      if (seat === 'system' && a.type === 'collect') {
        collect(state);
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

// Action automatique en attente (ramasser le pli), ou null.
export function systemAction(state) {
  return state.phase === 'trickEnd' ? { type: 'collect' } : null;
}

const SUIT_DISPLAY_ORDER = ['S', 'H', 'C', 'D'];

function sortHand(hand, trump) {
  const suitRank = (s) => (s === trump ? -1 : SUIT_DISPLAY_ORDER.indexOf(s));
  const order = (c) => (suitOf(c) === trump ? TRUMP_ORDER : PLAIN_ORDER).indexOf(rankOf(c));
  return [...hand].sort((a, b) => suitRank(suitOf(a)) - suitRank(suitOf(b)) || order(b) - order(a));
}

// Ce que voit le joueur assis en `seat` (-1 = spectateur) : jamais les mains des autres.
export function view(state, seat) {
  const mine = seat >= 0 && seat < 4;
  return {
    game: id,
    seat: mine ? seat : -1,
    names: state.names,
    phase: state.phase,
    round: state.round,
    dealer: state.dealer,
    turn: state.turn,
    trump: state.trump,
    taker: state.taker,
    target: state.target,
    scores: state.scores,
    hand: mine ? sortHand(state.hands[seat], state.trump) : [],
    handCounts: state.hands.map((h) => h.length),
    turnCard: state.turnCard,
    trick: state.trick,
    trickWinner: state.trickWinner,
    lastTrick: state.lastTrick,
    tricksWon: state.tricksWon,
    legal: mine && state.phase === 'playing' && state.turn === seat ? legalCards(state, seat) : [],
    roundResult: state.roundResult,
    history: state.history,
    winner: state.winner ?? null,
    events: state.events,
  };
}

// ---------------------------------------------------------------------------
// Robot simple (pour compléter une table ou remplacer un joueur absent)

function shouldTake(cards, suit) {
  const t = cards.filter((c) => suitOf(c) === suit).map(rankOf);
  const aces = cards.filter((c) => rankOf(c) === 'A' && suitOf(c) !== suit).length;
  let score = t.length + aces;
  if (t.includes('J')) score += 3;
  if (t.includes('9')) score += 2;
  if (t.includes('A')) score += 1;
  return score >= 7;
}

function chooseCard(state, seat) {
  const legal = legalCards(state, seat);
  const trump = state.trump;
  const cost = (c) => cardPoints(c, trump) + (suitOf(c) === trump ? 15 : 0) + strength(c, trump, suitOf(c)) / 100;
  const cheapest = (cards) => [...cards].sort((a, b) => cost(a) - cost(b))[0];

  if (state.trick.length === 0) {
    const ace = legal.find((c) => rankOf(c) === 'A' && suitOf(c) !== trump);
    if (ace) return ace;
    if (teamOf(seat) === teamOf(state.taker) && legal.includes('J' + trump)) return 'J' + trump;
    return cheapest(legal);
  }

  const partnerWins = teamOf(trickWinner(state.trick, trump)) === teamOf(seat);
  if (partnerWins) {
    if (state.trick.length === 3) {
      const plain = legal.filter((c) => suitOf(c) !== trump);
      if (plain.length) return [...plain].sort((a, b) => cardPoints(b, trump) - cardPoints(a, trump))[0];
    }
    return cheapest(legal);
  }

  const winning = legal.filter((c) => trickWinner([...state.trick, { seat, card: c }], trump) === seat);
  return cheapest(winning.length ? winning : legal);
}

export function botAction(state, seat) {
  switch (state.phase) {
    case 'bidding1':
      return shouldTake([...state.hands[seat], state.turnCard], suitOf(state.turnCard))
        ? { type: 'take' }
        : { type: 'pass' };
    case 'bidding2': {
      const banned = suitOf(state.turnCard);
      const suit = SUITS.find((s) => s !== banned && shouldTake(state.hands[seat], s));
      return suit ? { type: 'choose', suit } : { type: 'pass' };
    }
    case 'playing':
      return { type: 'play', card: chooseCard(state, seat) };
    default:
      return null;
  }
}
