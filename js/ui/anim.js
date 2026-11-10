// Animations des cartes, communes à tous les jeux.
//
// L'écran est entièrement redessiné à chaque message de l'hôte. Pour qu'une animation ne redémarre
// pas à chaque fois, on retient l'instant où chaque élément animé est apparu (clé → instant) et on
// la reprend là où elle en était grâce à un animation-delay négatif.
//
// Trajets : un élément porte data-fly-from="<id>" (il arrive depuis cet élément) et/ou
// data-fly-to="<id>" (il part vers cet élément). Après insertion dans la page, afterRender()
// mesure les positions et renseigne les variables CSS --fx/--fy (départ) et --tx/--ty (arrivée).

export const FLY_MS = 420; // pile / main → centre
export const COLLECT_MS = 600; // centre → pile du gagnant
export const VERDICT_DELAY = 380; // la carte gagnante s'illumine une fois posée
export const INFO_MS = 1800; // durée d'un message d'info
export const HAND_MS = 380; // carte qui arrive dans la main
export const DEAL_MS = 360; // carte distribuée (centre → paquet)

const seen = new Map();
let used = new Set();

// À appeler autour de chaque rendu complet d'une partie (oublie les éléments disparus).
export function beginFrame() {
  used = new Set();
}
export function endFrame() {
  for (const k of seen.keys()) if (!used.has(k)) seen.delete(k);
}

// Temps écoulé (ms) depuis la première apparition de `key`.
export function since(key) {
  used.add(key);
  const now = performance.now();
  if (!seen.has(key)) seen.set(key, now);
  return now - seen.get(key);
}

// Style d'une animation encore en cours (ou null si elle est terminée).
export function running(elapsed, duration, delay = 0) {
  return elapsed < delay + duration ? `animation-delay:${Math.round(delay - elapsed)}ms` : null;
}

// Attributs d'un élément qui arrive au centre depuis l'élément `fromId`.
// `card` : si cette carte était visible juste avant (dans ma main), elle part de sa position exacte.
export function flyIn(key, fromId, duration = FLY_MS, card = null) {
  const a = running(since(key), duration);
  if (!a) return { cls: '', style: '', attrs: '' };
  return { cls: 'fly-in', style: a, attrs: `data-fly-from="${fromId}" ${card ? `data-from-card="${card}"` : ''}` };
}

// Animations d'entrée des cartes de ma main. Les cartes arrivées en même temps (distribution)
// arrivent l'une après l'autre. `sourceFor(card)` : identifiant de l'élément d'où vient la carte.
export function handAnims(cards, sourceFor) {
  const born = cards.map((c) => {
    since(`hand:${c}`);
    return seen.get(`hand:${c}`);
  });
  const now = performance.now();
  return cards.map((c, i) => {
    const group = born.map((b, j) => (b === born[i] ? j : -1)).filter((j) => j >= 0);
    const step = Math.min(40, 450 / group.length);
    const a = running(now - born[i], HAND_MS, group.indexOf(i) * step);
    return a ? { cls: 'hand-in', style: a, attrs: `data-fly-from="${sourceFor(c)}" data-from-card="${c}"` } : null;
  });
}

// Distribution : des dos de cartes partent du centre (#deal-src) vers les paquets des sièges `seats`,
// chacun son tour, `perSeat` cartes par siège.
export function dealGhosts(key, seats, { perSeat = 3, delay = 0, from = 'deal-src' } = {}) {
  const elapsed = since(key);
  let html = '';
  for (let k = 0; k < perSeat; k++) {
    seats.forEach((s, idx) => {
      const a = running(elapsed, DEAL_MS, delay + (k * seats.length + idx) * 40);
      if (a) {
        html += `<div class="fx-card deal" style="${a}" data-fly-from="${from}" data-fly-to="deck-${s}">
          <div class="card back-card"></div></div>`;
      }
    });
  }
  return html;
}

// Cartes qui passent d'un élément à un autre (échange, carte prise, défausse…).
// `cards` : faces connues, sinon dos. `fromCards` : partir de la position exacte de ces cartes si on les voyait.
export function passGhosts(key, fromId, toId, count, { cards = null, delay = 0, fromCards = false } = {}) {
  const elapsed = since(key);
  let html = '';
  for (let k = 0; k < count; k++) {
    const a = running(elapsed, 520, delay + k * 70);
    if (!a) continue;
    const c = cards?.[k];
    const face = c ? cardHTMLRef(c) : '<div class="card back-card"></div>';
    html += `<div class="fx-card fly-through" style="${a}" data-fly-from="${fromId}" ${
      fromCards && c ? `data-from-card="${c}"` : ''
    } data-fly-to="${toId}">${face}</div>`;
  }
  return html;
}

// Rendu d'une carte (injecté par common.js pour éviter une dépendance circulaire).
let cardHTMLRef = () => '<div class="card back-card"></div>';
export function setCardRenderer(fn) {
  cardHTMLRef = fn;
}

// Attributs d'un élément qui part vers `toId` (null quand c'est fini : on ne l'affiche plus).
export function flyOut(key, toId, duration = COLLECT_MS) {
  const a = running(since(key), duration);
  return a ? { cls: toId ? 'fly-out' : 'discard', style: a, attrs: toId ? `data-fly-to="${toId}"` : '' } : null;
}

// Mise en valeur de la carte gagnante (classe + style), à partir de l'apparition de `key`.
export function verdict(key, outcome) {
  const elapsed = since(key);
  return { cls: outcome, style: `animation-delay:${Math.round(VERDICT_DELAY - elapsed)}ms` };
}

// Message d'info : affiché quelques instants à la place de l'indication habituelle.
export function infoHTML(key, text, fallback = '') {
  const a = key && text ? running(since(key), INFO_MS) : null;
  return a ? `<div class="hint info" style="${a}">${text}</div>` : `<div class="hint">${fallback}</div>`;
}

// Positions des cartes visibles (data-cid) au rendu précédent :
// - `prevRects` sert à faire glisser les cartes de ma main qui changent de place ;
// - `recent` garde quelques instants la position d'une carte disparue (jouée, prise…)
//   pour qu'elle reparte de là où elle était.
let prevRects = new Map();
const recent = new Map(); // carte → { rect, t }

// À appeler juste avant de remplacer le contenu de la page.
export function snapshot(root) {
  const now = performance.now();
  prevRects = new Map();
  for (const el of root.querySelectorAll('[data-cid]:not(.hand-in)')) {
    const r = el.getBoundingClientRect();
    prevRects.set(el.dataset.cid, r);
    recent.set(el.dataset.cid, { rect: r, t: now });
  }
  for (const [c, { t }] of recent) if (now - t > 1500) recent.delete(c);
}

const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

export function afterRender(root) {
  for (const el of root.querySelectorAll('[data-fly-from], [data-fly-to]')) {
    const [cx, cy] = center(el.getBoundingClientRect());
    const known = el.dataset.fromCard && recent.get(el.dataset.fromCard);
    for (const [attr, x, y] of [
      ['flyFrom', '--fx', '--fy'],
      ['flyTo', '--tx', '--ty'],
    ]) {
      let b = null;
      if (attr === 'flyFrom' && known) b = known.rect;
      else if (el.dataset[attr]) b = document.getElementById(el.dataset[attr])?.getBoundingClientRect();
      if (!b) continue;
      const [bx, by] = center(b);
      el.style.setProperty(x, `${bx - cx}px`);
      el.style.setProperty(y, `${by - cy}px`);
    }
  }
  // Les cartes de ma main qui ont bougé glissent jusqu'à leur nouvelle place.
  for (const el of root.querySelectorAll('.hand [data-cid]:not(.hand-in)')) {
    const before = prevRects.get(el.dataset.cid);
    if (!before || !el.animate) continue;
    const after = el.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
  }
}
