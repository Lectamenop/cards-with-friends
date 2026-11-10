// Logique commune aux jeux de plis à 4 joueurs en 2 équipes (belote, coinche).
// L'atout `trump` vaut une couleur ('S', 'H', 'C', 'D'), 'SA' (sans atout) ou 'TA' (tout atout).
//
// Sièges 0..3, joués dans l'ordre 0 → 1 → 2 → 3. Équipes : 0 & 2 contre 1 & 3.

import { SUITS, SUIT_SYMBOL, RANKS_32, suitOf, rankOf, pushEvent, cardLabel } from '../cards.js';

export const TRUMP_ORDER = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J']; // du plus faible au plus fort
export const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const TRUMP_POINTS = { J: 20, 9: 14, A: 11, 10: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const PLAIN_POINTS = { A: 11, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
// Barèmes sans-atout / tout-atout : 152 points de cartes + 10 de der = 162, comme à la couleur.
const SA_POINTS = { A: 19, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const TA_POINTS = { J: 14, 9: 9, A: 6, 10: 5, K: 3, Q: 1, 8: 0, 7: 0 };

export const next = (seat) => (seat + 1) % 4;
export const teamOf = (seat) => seat % 2;
export const isSuitTrump = (trump) => SUITS.includes(trump);
export const isTrump = (card, trump) => trump === 'TA' || suitOf(card) === trump;

export function trumpLabel(trump) {
  if (trump === 'SA') return 'Sans atout';
  if (trump === 'TA') return 'Tout atout';
  return SUIT_SYMBOL[trump] || '';
}

export function cardPoints(card, trump) {
  const r = rankOf(card);
  if (trump === 'SA') return SA_POINTS[r];
  if (trump === 'TA') return TA_POINTS[r];
  return (suitOf(card) === trump ? TRUMP_POINTS : PLAIN_POINTS)[r];
}

// Rang d'une carte à l'intérieur de sa couleur.
function rankIndex(card, trump) {
  return (isTrump(card, trump) ? TRUMP_ORDER : PLAIN_ORDER).indexOf(rankOf(card));
}

export function strength(card, trump, leadSuit) {
  const s = suitOf(card);
  if (isSuitTrump(trump) && s === trump) return 100 + TRUMP_ORDER.indexOf(rankOf(card));
  if (s === leadSuit) return rankIndex(card, trump);
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

// Cartes que `seat` a le droit de jouer (fournir, couper, surcouper, monter à l'atout).
export function legalCards(state, seat) {
  const hand = state.hands[seat];
  const trick = state.trick;
  if (trick.length === 0) return [...hand];

  const trump = state.trump;
  const lead = suitOf(trick[0].card);
  const follow = hand.filter((c) => suitOf(c) === lead);

  if (trump === 'SA') return follow.length ? follow : [...hand];

  if (trump === 'TA' || lead === trump) {
    // Couleur d'atout demandée : fournir et monter si possible.
    if (!follow.length) return [...hand];
    const best = Math.max(-1, ...trick.filter((p) => suitOf(p.card) === lead).map((p) => rankIndex(p.card, trump)));
    const higher = follow.filter((c) => rankIndex(c, trump) > best);
    return higher.length ? higher : follow;
  }

  if (follow.length) return follow; // obligation de fournir

  // Impossible de fournir : si le partenaire est maître, on joue ce qu'on veut.
  if (teamOf(trickWinner(trick, trump)) === teamOf(seat)) return [...hand];
  const trumps = hand.filter((c) => suitOf(c) === trump);
  if (trumps.length === 0) return [...hand];
  const bestTrump = Math.max(
    -1,
    ...trick.filter((p) => suitOf(p.card) === trump).map((p) => TRUMP_ORDER.indexOf(rankOf(p.card)))
  );
  const higher = trumps.filter((c) => TRUMP_ORDER.indexOf(rankOf(c)) > bestTrump);
  return higher.length ? higher : trumps; // couper, surcouper si possible
}

const DISPLAY_ORDER = ['S', 'H', 'C', 'D'];

export function sortHand(hand, trump) {
  const suitRank = (s) => (s === trump ? -1 : DISPLAY_ORDER.indexOf(s));
  return [...hand].sort((a, b) => suitRank(suitOf(a)) - suitRank(suitOf(b)) || rankIndex(b, trump) - rankIndex(a, trump));
}

// ---------------------------------------------------------------------------
// Annonces : suites (ordre naturel 7 8 9 10 V D R A) et carrés.

const SQUARE_POINTS = { J: 200, 9: 150, A: 100, 10: 100, K: 100, Q: 100 };
const SQUARE_NAME = { J: 'de valets', 9: 'de 9', A: "d'as", 10: 'de 10', K: 'de rois', Q: 'de dames' };
const TOP_NAME = { 9: 'au 9', 10: 'au 10', J: 'au valet', Q: 'à la dame', K: 'au roi', A: "à l'as" };

export function findAnnonces(hand) {
  const list = [];
  for (const r of Object.keys(SQUARE_POINTS)) {
    if (SUITS.every((s) => hand.includes(r + s))) {
      list.push({ kind: 'carre', points: SQUARE_POINTS[r], high: RANKS_32.indexOf(r), label: `Carré ${SQUARE_NAME[r]}` });
    }
  }
  for (const s of SUITS) {
    let run = 0;
    for (let i = 0; i <= RANKS_32.length; i++) {
      if (i < RANKS_32.length && hand.includes(RANKS_32[i] + s)) {
        run++;
        continue;
      }
      if (run >= 3) {
        const top = RANKS_32[i - 1];
        const [points, word] = run >= 5 ? [100, 'Cent'] : run === 4 ? [50, 'Cinquante'] : [20, 'Tierce'];
        list.push({ kind: 'suite', suit: s, points, high: i - 1, label: `${word} ${TOP_NAME[top]} ${SUIT_SYMBOL[s]}` });
      }
      run = 0;
    }
  }
  return list;
}

// Seule l'équipe qui a la meilleure annonce marque (toutes ses annonces).
// À égalité : carré avant suite, puis carte la plus haute, puis suite à l'atout, puis ordre de jeu.
export function resolveAnnonces(hands, trump, firstSeat) {
  const all = hands.map(findAnnonces);
  const key = (a) => a.points * 1000 + (a.kind === 'carre' ? 500 : 0) + a.high * 10 + (a.suit === trump ? 1 : 0);
  let bestSeat = null;
  let bestKey = -1;
  for (let k = 0; k < 4; k++) {
    const s = (firstSeat + k) % 4;
    for (const a of all[s]) {
      if (key(a) > bestKey) {
        bestKey = key(a);
        bestSeat = s;
      }
    }
  }
  const points = [0, 0];
  const declared = [];
  for (let s = 0; s < 4; s++) for (const a of all[s]) declared.push({ seat: s, label: a.label, points: a.points });
  if (bestSeat !== null) {
    const team = teamOf(bestSeat);
    for (const d of declared) if (teamOf(d.seat) === team) points[team] += d.points;
  }
  return { points, declared, team: bestSeat === null ? null : teamOf(bestSeat) };
}

export function announceAll(state) {
  const a = state.annonces;
  for (const d of a.declared) pushEvent(state, `${state.names[d.seat]} annonce : ${d.label} (${d.points}).`);
  if (a.team !== null) pushEvent(state, `Annonces : ${state.names[a.team]} & ${state.names[a.team + 2]} marquent ${a.points[a.team]}.`);
}

// Le joueur qui a roi + dame d'atout (couleur d'atout seulement).
export function findBelote(state) {
  state.beloteSeat = null;
  state.beloteCount = 0;
  if (!isSuitTrump(state.trump)) return;
  for (let s = 0; s < 4; s++) {
    if (state.hands[s].includes('K' + state.trump) && state.hands[s].includes('Q' + state.trump)) state.beloteSeat = s;
  }
}

// ---------------------------------------------------------------------------
// Déroulement des plis (partagé)

export function playCard(state, seat, a) {
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

// Ramasse le pli. Retourne true si c'était le dernier (dix de der compté).
export function collectTrick(state) {
  const w = state.trickWinner;
  const team = teamOf(w);
  const last = state.hands.every((h) => h.length === 0);
  const points = state.trick.reduce((sum, p) => sum + cardPoints(p.card, state.trump), 0) + (last ? 10 : 0); // dix de der
  const winCard = state.trick.find((p) => p.seat === w).card;
  state.trickPoints[team] += points;
  state.tricksWon[team]++;
  state.lastTrick = { cards: state.trick, winner: w, points };
  state.trick = [];
  state.trickWinner = null;
  pushEvent(state, `${state.names[w]} remporte le pli avec ${cardLabel(winCard)} (+${points}${last ? ', dix de der' : ''}).`);
  if (last) return true;
  state.phase = 'playing';
  state.turn = w;
  return false;
}

// ---------------------------------------------------------------------------
// Robot

// Force d'une main pour un atout donné (≥ 7 : jouable).
export function handScore(cards, trump) {
  if (trump === 'SA') {
    const aces = cards.filter((c) => rankOf(c) === 'A');
    const tens = cards.filter((c) => rankOf(c) === '10' && cards.includes('A' + suitOf(c)));
    return aces.length * 2 + tens.length;
  }
  if (trump === 'TA') {
    const jacks = cards.filter((c) => rankOf(c) === 'J');
    const nines = cards.filter((c) => rankOf(c) === '9' && cards.includes('J' + suitOf(c)));
    return jacks.length * 2 + nines.length;
  }
  const t = cards.filter((c) => suitOf(c) === trump).map(rankOf);
  const aces = cards.filter((c) => rankOf(c) === 'A' && suitOf(c) !== trump).length;
  let score = t.length + aces;
  if (t.includes('J')) score += 3;
  if (t.includes('9')) score += 2;
  if (t.includes('A')) score += 1;
  return score;
}

export function chooseCard(state, seat) {
  const legal = legalCards(state, seat);
  const trump = state.trump;
  const cost = (c) =>
    cardPoints(c, trump) + (isSuitTrump(trump) && suitOf(c) === trump ? 15 : 0) + strength(c, trump, suitOf(c)) / 100;
  const cheapest = (cards) => [...cards].sort((a, b) => cost(a) - cost(b))[0];

  if (state.trick.length === 0) {
    const master = legal.find((c) =>
      trump === 'TA' ? rankOf(c) === 'J' : rankOf(c) === 'A' && suitOf(c) !== trump
    );
    if (master) return master;
    if (isSuitTrump(trump) && teamOf(seat) === teamOf(state.taker) && legal.includes('J' + trump)) return 'J' + trump;
    return cheapest(legal);
  }

  const partnerWins = teamOf(trickWinner(state.trick, trump)) === teamOf(seat);
  if (partnerWins) {
    if (state.trick.length === 3) {
      const plain = legal.filter((c) => !isTrump(c, trump));
      if (plain.length) return [...plain].sort((a, b) => cardPoints(b, trump) - cardPoints(a, trump))[0];
    }
    return cheapest(legal);
  }

  const winning = legal.filter((c) => trickWinner([...state.trick, { seat, card: c }], trump) === seat);
  return cheapest(winning.length ? winning : legal);
}
