import { SUIT_SYMBOL, RANK_LABEL, suitOf, rankOf, isRed } from '../cards.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Attribut data-payload contenant une action de jeu (JSON).
export const payload = (action) => `data-action="game" data-payload="${esc(JSON.stringify(action))}"`;

export function cardHTML(card, { playable = false, disabled = false, extra = '', attrs = '' } = {}) {
  const s = suitOf(card);
  const r = rankOf(card);
  const label = RANK_LABEL[r] || r;
  const cls = ['card', isRed(s) ? 'red' : 'black', playable ? 'playable' : '', disabled ? 'disabled' : '', extra]
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}" ${attrs} title="${label}${SUIT_SYMBOL[s]}">
    <span class="corner">${label}<br>${SUIT_SYMBOL[s]}</span>
    <span class="pip">${SUIT_SYMBOL[s]}</span>
    <span class="corner bottom">${label}<br>${SUIT_SYMBOL[s]}</span>
  </div>`;
}

export const backsHTML = (n) =>
  `<div class="backs">${Array.from({ length: Math.min(n, 8) }, () => '<span class="back"></span>').join('')}</div>`;

let toastTimer;
export function toast(text, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Position à l'écran de chaque place (la place 0 en bas), dans l'ordre de jeu.
const LAYOUTS = {
  2: ['bottom', 'top'],
  3: ['bottom', 'tr', 'tl'],
  4: ['bottom', 'right', 'top', 'left'],
  5: ['bottom', 'right', 'tr', 'tl', 'left'],
  6: ['bottom', 'right', 'tr', 'top', 'tl', 'left'],
};
export const seatPositions = (n) => LAYOUTS[n] || LAYOUTS[4];
