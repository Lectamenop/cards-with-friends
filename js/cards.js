// Utilitaires communs à tous les jeux de cartes.
// Une carte est une chaîne : rang + couleur, ex. "AS" (as de pique), "10H" (dix de cœur).

export const SUITS = ['S', 'H', 'C', 'D']; // ordre d'affichage : couleurs alternées
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
export const RANK_LABEL = { J: 'V', Q: 'D', K: 'R', A: 'A' }; // Valet, Dame, Roi, As
export const RANKS_32 = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANKS_52 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const suitOf = (card) => card.slice(-1);
export const rankOf = (card) => card.slice(0, -1);
export const isRed = (suit) => suit === 'H' || suit === 'D';
export const nextSeat = (seat, n) => (seat + 1) % n;

// Nom lisible d'une carte, ex. "R♥".
export const cardLabel = (card) => (RANK_LABEL[rankOf(card)] || rankOf(card)) + SUIT_SYMBOL[suitOf(card)];

export function makeDeck(ranks, suits = SUITS) {
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(r + s);
  return deck;
}

// Mélange de Fisher-Yates avec un générateur aléatoire cryptographique.
export function shuffle(array) {
  const a = [...array];
  const rnd = new Uint32Array(a.length);
  globalThis.crypto.getRandomValues(rnd);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const randomInt = (n) => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % n;

// Journal des derniers événements de la partie (affiché sous la table).
const MAX_EVENTS = 8;
export function pushEvent(state, text) {
  state.eventSeq = (state.eventSeq || 0) + 1;
  state.events.push({ id: state.eventSeq, text });
  if (state.events.length > MAX_EVENTS) state.events.shift();
}
