// Moteur de règles de la belote classique (4 joueurs, 2 équipes).
// Ce module est "pur" : il ne touche ni au réseau ni à l'affichage.
// Il ne tourne que chez l'hôte, qui envoie à chaque joueur une vue filtrée (view).
//
// Sièges 0..3, joués dans l'ordre 0 → 1 → 2 → 3 (sens inverse des aiguilles d'une montre).
// Équipes : sièges 0 et 2 (équipe 0) contre sièges 1 et 3 (équipe 1).

import { SUITS, RANKS_32, suitOf, makeDeck, shuffle, randomInt, pushEvent } from '../cards.js';
import * as T from './trick-common.js';

export { teamOf, cardPoints, trickWinner, legalCards } from './trick-common.js';

const { next, teamOf } = T;

export const id = 'belote';
export const name = 'Belote';
export const minSeats = 4;
export const maxSeats = 4;
export const defaultSeats = 4;
export const teams = true;
export const targets = [500, 1000, 1500, 2000];
export const defaultTarget = 1000;
export const targetLabel = (t) => `${t} points`;
// Rythme (ms) : délai des robots, et temps pour voir le pli avant qu'il soit ramassé.
export const delays = { bot: 700, system: 1000 };
export const variants = [
  { key: 'annonces', label: 'Annonces (tierce, cinquante, cent, carrés)', default: false },
  { key: 'sansToutAtout', label: 'Sans-atout et tout-atout au 2e tour', default: false },
];

// ---------------------------------------------------------------------------
// Création et déroulement

export function createGame({ names, target = defaultTarget, variants: opts = {} }) {
  const state = {
    game: id,
    names: [...names],
    target,
    variants: { annonces: !!opts.annonces, sansToutAtout: !!opts.sansToutAtout },
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
  state.takenCard = null;
  const deck = shuffle(makeDeck(RANKS_32));
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
  state.annonces = null;
  state.roundResult = null;
  pushEvent(state, `Manche ${state.round} : ${state.names[state.dealer]} distribue.`);
}

function take(state, seat, trump) {
  state.trump = trump;
  state.taker = seat;
  state.hands[seat].push(state.turnCard);
  state.takenCard = state.turnCard;
  let i = 0;
  for (let k = 1; k <= 4; k++) {
    const s = (state.dealer + k) % 4;
    const n = s === seat ? 2 : 3;
    for (let j = 0; j < n; j++) state.hands[s].push(state.deck[i++]);
  }
  state.turnCard = null;
  state.deck = [];
  T.findBelote(state);
  state.phase = 'playing';
  state.turn = next(state.dealer);
  pushEvent(state, `${state.names[seat]} prend à ${T.trumpLabel(trump)}.`);
  if (state.variants.annonces) {
    state.annonces = T.resolveAnnonces(state.hands, trump, state.turn);
    T.announceAll(state);
  }
}

export function secondRoundChoices(state) {
  const turnSuit = suitOf(state.turnCard);
  const list = SUITS.filter((s) => s !== turnSuit);
  if (state.variants?.sansToutAtout) list.push('SA', 'TA');
  return list;
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
  if (a.type === 'take' && state.phase === 'bidding1') {
    take(state, seat, suitOf(state.turnCard));
    return null;
  }
  if (a.type === 'choose' && state.phase === 'bidding2' && secondRoundChoices(state).includes(a.suit)) {
    take(state, seat, a.suit);
    return null;
  }
  return 'Enchère invalide.';
}

function endRound(state) {
  const att = teamOf(state.taker);
  const def = 1 - att;
  const raw = [...state.trickPoints];
  const bel = [0, 0];
  if (state.beloteSeat !== null) bel[teamOf(state.beloteSeat)] = 20;
  const ann = state.annonces ? [...state.annonces.points] : [0, 0];
  const total = (t) => raw[t] + bel[t] + ann[t];

  const gained = [0, 0];
  let outcome;
  if (state.tricksWon[att] === 8) {
    gained[att] = 252 + bel[att] + ann[att];
    gained[def] = bel[def] + ann[def];
    outcome = 'Capot ! Le preneur fait tous les plis.';
  } else if (total(att) > total(def)) {
    gained[att] = total(att);
    gained[def] = total(def);
    outcome = 'Contrat rempli.';
  } else {
    // Dedans : la défense prend les 162 points et les annonces.
    gained[def] = (state.tricksWon[def] === 8 ? 252 : 162) + bel[def] + ann[0] + ann[1];
    gained[att] = bel[att];
    outcome = 'Dedans ! Le preneur chute.';
  }

  state.scores[0] += gained[0];
  state.scores[1] += gained[1];
  state.roundResult = { taker: state.taker, trump: state.trump, raw, bel, ann, gained, outcome };
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

// Action automatique en attente (ramasser le pli), ou null.
export function systemAction(state) {
  return state.phase === 'trickEnd' ? { type: 'collect' } : null;
}

// Ce que voit le joueur assis en `seat` (-1 = spectateur) : jamais les mains des autres.
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
    target: state.target,
    scores: state.scores,
    hand: mine ? T.sortHand(state.hands[seat], state.trump) : [],
    handCounts: state.hands.map((h) => h.length),
    turnCard: state.turnCard,
    takenCard: state.takenCard,
    dealId: state.dealId,
    choices: state.phase === 'bidding2' ? secondRoundChoices(state) : [],
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
// Robot simple (pour compléter une table ou remplacer un joueur absent)

export function botAction(state, seat) {
  switch (state.phase) {
    case 'bidding1': {
      const cards = [...state.hands[seat], state.turnCard];
      return T.handScore(cards, suitOf(state.turnCard)) >= 7 ? { type: 'take' } : { type: 'pass' };
    }
    case 'bidding2': {
      const choice = secondRoundChoices(state).find((t) => T.handScore(state.hands[seat], t) >= 7);
      return choice ? { type: 'choose', suit: choice } : { type: 'pass' };
    }
    case 'playing':
      return { type: 'play', card: T.chooseCard(state, seat) };
    default:
      return null;
  }
}

